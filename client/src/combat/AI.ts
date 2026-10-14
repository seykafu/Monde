import {
  BattleState,
  enterStance,
  moveUnit,
  performAttack,
  reachableForUnit,
  targetsForUnit,
  unitAt
} from "./Actions";
import { previewAttack } from "./Damage";
import { counterZoneTiles, hasReadyStance } from "./Stances";
import { isAlive } from "./Unit";
import type { TilePos, Unit } from "./types";
import { manhattan } from "../util/math";

interface PlannedAction {
  kind: "attack" | "move" | "ready" | "defend" | "end";
  movePos?: TilePos;
  targetId?: string;
  score: number;
}

const isInReadyZoneOf = (state: BattleState, p: TilePos, defender: Unit): boolean => {
  // alwaysCounters (boss second wind) threatens the same tiles a Ready
  // stance does, and permanently — the AI should read it as a threat
  // zone too rather than walking into free retaliation.
  if (!hasReadyStance(defender) && !defender.state.alwaysCounters) return false;
  for (const z of counterZoneTiles(defender)) if (z.x === p.x && z.y === p.y) return true;
  return false;
};

// Score a hypothetical "move to X then attack target" sequence.
const scoreAttackFromTile = (
  state: BattleState,
  unit: Unit,
  fromTile: TilePos,
  target: Unit
): number => {
  // pretend the unit is at fromTile for the preview
  const originalPos = unit.state.position;
  unit.state.position = fromTile;
  const tile = state.grid.tileAt(target.state.position);
  // Pass full unit list so Aide / BossFighter modifiers are reflected in the AI's score.
  const preview = previewAttack(unit, target, tile, false, state.units);
  unit.state.position = originalPos;
  // expected damage
  const expectedDamage = (preview.hitRate / 100) * preview.damage * (1 + preview.critRate / 100);
  let score = 50 + expectedDamage * 10;
  if (expectedDamage >= target.state.hp) score += 100;
  // penalize stepping into a Ready threat zone of any player unit
  for (const pu of state.units) {
    if (pu.faction === unit.faction || !isAlive(pu)) continue;
    if (hasReadyStance(pu) && isInReadyZoneOf(state, fromTile, pu)) {
      score -= 30;
    }
  }
  // small bonus for ending adjacent to a player unit (melee) or in attack range (ranged)
  if (unit.weapon === "bow" || unit.weapon === "lens") {
    let inRange = false;
    for (const tile of state.grid.attackTargetTiles(fromTile, 2, unit.weapon === "bow" ? 4 : 3)) {
      const t = unitAt(state, tile);
      if (t && t.faction !== unit.faction && isAlive(t)) {
        inRange = true;
        break;
      }
    }
    if (inRange) score += 30;
  } else {
    let adj = false;
    for (const n of state.grid.neighbors4(fromTile)) {
      const t = unitAt(state, n);
      if (t && t.faction !== unit.faction && isAlive(t)) {
        adj = true;
        break;
      }
    }
    if (adj) score += 20;
  }
  return score;
};

const closestPlayerDistance = (state: BattleState, p: TilePos): number => {
  let best = Infinity;
  for (const u of state.units) {
    if (u.faction === "enemy" || !isAlive(u)) continue;
    const d = manhattan(p.x, p.y, u.state.position.x, u.state.position.y);
    if (d < best) best = d;
  }
  return best;
};

// Plan and execute one full enemy turn. Returns a list of planned actions in execution order.
export const planEnemyTurn = (
  state: BattleState,
  unit: Unit
): PlannedAction[] => {
  // 0. Hold-position rule — see UnitDef.holdPositionUntil. Bosses with
  //    a guard detail (King Nebu in B1) skip their turn entirely until
  //    their faction is thinned out. Returns a single "end" action so
  //    executePlan still advances the FSM through this unit's turn.
  if (unit.holdPositionUntil) {
    const aliveAllies = state.units.filter(
      (u) => u.faction === unit.faction && u.id !== unit.id && isAlive(u)
    );
    if (aliveAllies.length > unit.holdPositionUntil.allyCount) {
      return [{ kind: "end", score: 0 }];
    }
  }

  const plan: PlannedAction[] = [];
  // 1. Try attacks from current position.
  let bestAttack: { target: Unit; score: number } | null = null;
  for (const t of targetsForUnit(state, unit)) {
    const s = scoreAttackFromTile(state, unit, unit.state.position, t);
    if (!bestAttack || s > bestAttack.score) bestAttack = { target: t, score: s };
  }
  // 2. Try move + attack across reachable tiles.
  let bestMoveAttack: { dest: TilePos; target: Unit; score: number } | null = null;
  if (unit.state.apRemaining >= 2) {
    for (const dest of reachableForUnit(state, unit)) {
      // simulate occupancy: dest must not be on another unit
      const occ = unitAt(state, dest);
      if (occ && occ !== unit) continue;
      // find best target from this dest
      const minR = unit.weapon === "bow" || unit.weapon === "lens" ? 2 : 1;
      const maxR = unit.weapon === "bow" ? 4 : unit.weapon === "lens" ? 3 : unit.weapon === "spear" ? 2 : 1;
      for (const tile of state.grid.attackTargetTiles(dest, minR, maxR)) {
        const target = unitAt(state, tile);
        if (!target || target.faction === unit.faction || !isAlive(target)) continue;
        const s = scoreAttackFromTile(state, unit, dest, target) - 5; // small move cost
        if (!bestMoveAttack || s > bestMoveAttack.score) {
          bestMoveAttack = { dest, target, score: s };
        }
      }
    }
  }
  if (bestMoveAttack && (!bestAttack || bestMoveAttack.score > bestAttack.score)) {
    plan.push({ kind: "move", movePos: bestMoveAttack.dest, score: 0 });
    plan.push({ kind: "attack", targetId: bestMoveAttack.target.id, score: bestMoveAttack.score });
    return plan;
  }
  if (bestAttack) {
    plan.push({ kind: "attack", targetId: bestAttack.target.id, score: bestAttack.score });
    return plan;
  }
  // 3. Otherwise, walk toward the nearest player.
  let bestApproach: { dest: TilePos; dist: number } | null = null;
  for (const dest of reachableForUnit(state, unit)) {
    const occ = unitAt(state, dest);
    if (occ && occ !== unit) continue;
    const d = closestPlayerDistance(state, dest);
    if (d === Infinity) continue;
    if (!bestApproach || d < bestApproach.dist) bestApproach = { dest, dist: d };
  }
  if (bestApproach) {
    plan.push({ kind: "move", movePos: bestApproach.dest, score: 0 });
  }
  plan.push({ kind: "end", score: 0 });
  return plan;
};

// Execute a planned enemy turn, returning the list of attack results for the UI to play back.
export const executePlan = (
  state: BattleState,
  unit: Unit,
  plan: PlannedAction[]
): { kind: "move" | "attack" | "end"; data?: unknown }[] => {
  const events: { kind: "move" | "attack" | "end"; data?: unknown }[] = [];
  for (const step of plan) {
    if (unit.state.apRemaining <= 0) break;
    if (!isAlive(unit)) break;
    if (step.kind === "move" && step.movePos) {
      moveUnit(state, unit, step.movePos);
      unit.state.apRemaining -= 1;
      events.push({ kind: "move", data: step.movePos });
    } else if (step.kind === "attack" && step.targetId) {
      const target = state.units.find((u) => u.id === step.targetId);
      if (!target || !isAlive(target)) continue;
      const result = performAttack(state, unit, target);
      unit.state.apRemaining -= 1;
      events.push({ kind: "attack", data: { targetId: target.id, result } });
    } else if (step.kind === "ready") {
      enterStance(unit, "ready");
      unit.state.apRemaining -= 1;
      events.push({ kind: "end" });
    } else if (step.kind === "defend") {
      enterStance(unit, "defensive");
      unit.state.apRemaining -= 1;
      events.push({ kind: "end" });
    } else if (step.kind === "end") {
      events.push({ kind: "end" });
      break;
    }
  }
  return events;
};
