import type { TilePos, Unit } from "./types";
import { reachableForUnit, type BattleState } from "./Actions";
import { isAlive } from "./Unit";

// Danger-zone computation — the FE-style "danger area" primitive.
//
// A unit's danger zone is every tile it could ATTACK on its coming turn:
// the attack ring around its current tile plus the ring around every tile
// it can move to. Deliberately conservative (ignores AP economics — a
// 1-AP unit can't actually move AND attack) because the overlay's job is
// "could I possibly be hit standing here", and overstating is the safe
// direction for that question.

// Weapon reach — must mirror targetsForUnit in Actions.ts.
export const weaponRange = (u: Unit): { min: number; max: number } => ({
  min: u.weapon === "bow" || u.weapon === "lens" ? 2 : 1,
  max: u.weapon === "bow" ? 4 : u.weapon === "lens" ? 3 : u.weapon === "spear" ? 2 : 1
});

export const dangerZoneTiles = (state: BattleState, u: Unit): TilePos[] => {
  const { min, max } = weaponRange(u);
  const seen = new Set<string>();
  const out: TilePos[] = [];
  const landings = [u.state.position, ...reachableForUnit(state, u)];
  for (const l of landings) {
    for (const t of state.grid.attackTargetTiles(l, min, max)) {
      const k = `${t.x},${t.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
};

// Union across every living enemy-faction unit — what the danger overlay
// renders.
export const allEnemyDanger = (state: BattleState): TilePos[] => {
  const seen = new Set<string>();
  const out: TilePos[] = [];
  for (const u of state.units) {
    if (u.faction !== "enemy" || !isAlive(u)) continue;
    for (const t of dangerZoneTiles(state, u)) {
      const k = `${t.x},${t.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
};
