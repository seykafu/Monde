import type { TilePos, Unit } from "./types";
import { isAlive } from "./Unit";
import type { BattleState } from "./Actions";

// ---- Victory condition primitive -----------------------------------------
//
// Battles used to be hard-coded as "kill all enemies, don't die" via
// checkVictory in Actions.ts. That works for skirmishes but blocks every
// battle archetype the rest of the script needs:
//
//   - Boss-kill: defeat one specific enemy; let the mooks live.
//   - Survival/defense: hold for N rounds; enemies don't have to die.
//   - Escape: get a player unit (or a specific one) onto a target tile.
//   - Composites: "kill the king AND don't lose Lucian", "survive 5 rounds
//     OR defeat the boss".
//
// A VictoryCondition is a (state, round) → "player" | "enemy" | null
// evaluator paired with a player-facing label. The label is shown in the
// battle HUD so the player always knows what they're trying to do.
//
// BattleScene calls evaluate() at the end of every unit's turn (after the
// initiative cursor advances) so round-tied conditions like surviveTurns(N)
// trigger the moment the round counter ticks past N.

export type VictoryOutcome = "player" | "enemy" | null;

export interface VictoryContext {
  state: BattleState;
  round: number;          // 1-indexed; matches Initiative.round
}

export interface VictoryCondition {
  // Short HUD label, e.g. "Defeat all enemies", "Survive 5 rounds",
  // "Defeat King Nebu". Composites concatenate with " + " / " or ".
  readonly label: string;
  evaluate(ctx: VictoryContext): VictoryOutcome;
}

// All battles share the same defeat condition by default: lose all your
// units and you've lost. Conditions that need a different defeat (e.g.,
// "the king dies even though you survive") should bake it in themselves.
const allPlayersDead = (state: BattleState): boolean =>
  !state.units.some((u) => u.faction === "player" && isAlive(u));

// ---- Built-in conditions -------------------------------------------------

// Default. The classic skirmish: rout every enemy, don't get routed yourself.
// Used when a BattleNode doesn't specify .victory.
export const routEnemies: VictoryCondition = {
  label: "Defeat all enemies",
  evaluate: ({ state }) => {
    if (allPlayersDead(state)) return "enemy";
    const enemiesAlive = state.units.some((u) => u.faction === "enemy" && isAlive(u));
    if (!enemiesAlive) return "player";
    return null;
  }
};

// Boss kill: win when a specific unit dies. Other enemies can survive.
// `boss` may be the unit's id or a predicate that picks it out (useful when
// the boss is built from a factory and the id is generated).
export const defeatUnit = (
  match: string | ((u: Unit) => boolean),
  opts: { label?: string } = {}
): VictoryCondition => {
  const matches = typeof match === "string"
    ? (u: Unit) => u.id === match
    : match;
  return {
    label: opts.label ?? "Defeat the boss",
    evaluate: ({ state }) => {
      if (allPlayersDead(state)) return "enemy";
      const target = state.units.find(matches);
      if (!target || !isAlive(target)) return "player";
      return null;
    }
  };
};

// Survive N full rounds. Player wins as soon as the round counter exceeds
// N (so surviveRounds(5) means: hold through rounds 1–5; victory triggers
// the moment round 6 begins). Enemy wins if the player wipes first.
//
// Note: enemies do NOT need to die. The AI will still try to kill the
// player; the player decides whether to engage or just block tiles.
export const surviveRounds = (n: number): VictoryCondition => ({
  label: `Survive ${n} rounds`,
  evaluate: ({ state, round }) => {
    if (allPlayersDead(state)) return "enemy";
    if (round > n) return "player";
    return null;
  }
});

// Rout, but only once the scripted reinforcements have arrived.
//
// A pure surviveRounds(N) hold does NOT end when the field is cleared —
// the clock is the win condition, so a squad that wiped every wave by
// round 3 still had to click End Turn through empty rounds 4, 5 and 6.
// That reads as a broken battle, which is exactly how it was reported.
//
// Pairing this with surviveRounds gives "hold the line until the clock
// runs out, OR break every last one of them" — while `afterRound` keeps
// the early rounds honest, so clearing the opening roster before the
// waves land can't skip the fight they were written for.
export const routAfterReinforcements = (afterRound: number): VictoryCondition => ({
  label: "break them all",
  evaluate: ({ state, round }) => {
    if (allPlayersDead(state)) return "enemy";
    // Waves still to come — the field being empty means nothing yet.
    if (round < afterRound) return null;
    const enemiesAlive = state.units.some((u) => u.faction === "enemy" && isAlive(u));
    return enemiesAlive ? null : "player";
  }
});

// Get a player unit onto a target tile. By default any living player unit
// counts; pass `unitId` to require a specific character (e.g., the escort).
//
// IMPORTANT: this triggers at end-of-turn (BattleScene's checkEnd cadence),
// not the instant the move lands. Most "escape" battles want this — the
// player commits to ending their turn on the tile, and the enemy gets one
// last shot at them on the way out. If a battle ever needs instant-on-step
// escape, BattleScene would need an extra checkEnd call inside moveUnit.
export const escapeToTile = (
  target: TilePos,
  opts: { unitId?: string; label?: string } = {}
): VictoryCondition => ({
  label: opts.label ?? (opts.unitId ? `Escape to (${target.x}, ${target.y})` : `Reach (${target.x}, ${target.y})`),
  evaluate: ({ state }) => {
    if (allPlayersDead(state)) return "enemy";
    for (const u of state.units) {
      if (u.faction !== "player" || !isAlive(u)) continue;
      if (opts.unitId && u.id !== opts.unitId) continue;
      if (u.state.position.x === target.x && u.state.position.y === target.y) return "player";
    }
    return null;
  }
});

// Protect a unit (typically an escort or NPC) for N rounds. Player wins on
// round N+1 if the protected unit is still alive. Enemy wins immediately if
// the protected unit dies, OR if all players die.
export const protectUnit = (
  unitId: string,
  rounds: number,
  opts: { label?: string } = {}
): VictoryCondition => ({
  label: opts.label ?? `Protect ${unitId} for ${rounds} rounds`,
  evaluate: ({ state, round }) => {
    if (allPlayersDead(state)) return "enemy";
    const target = state.units.find((u) => u.id === unitId);
    if (!target || !isAlive(target)) return "enemy";
    if (round > rounds) return "player";
    return null;
  }
});

// ---- Combinators ---------------------------------------------------------

// Conjunction: player wins only when EVERY sub-condition reports "player".
// Enemy wins as soon as ANY sub-condition reports "enemy" (because any
// single failure dooms the run). Use for "kill the king AND keep Lucian
// alive" — protectUnit + defeatUnit.
export const allOf = (...conds: VictoryCondition[]): VictoryCondition => ({
  label: conds.map((c) => c.label).join(" + "),
  evaluate: (ctx) => {
    let allPlayer = true;
    for (const c of conds) {
      const r = c.evaluate(ctx);
      if (r === "enemy") return "enemy";
      if (r !== "player") allPlayer = false;
    }
    return allPlayer ? "player" : null;
  }
});

// Disjunction: player wins when ANY sub-condition reports "player". Enemy
// wins only when EVERY sub-condition reports "enemy" (so a hopeless run
// requires all paths to fail). Use for "survive 5 rounds OR kill the boss".
export const anyOf = (...conds: VictoryCondition[]): VictoryCondition => ({
  label: conds.map((c) => c.label).join(" or "),
  evaluate: (ctx) => {
    let allEnemy = true;
    for (const c of conds) {
      const r = c.evaluate(ctx);
      if (r === "player") return "player";
      if (r !== "enemy") allEnemy = false;
    }
    return allEnemy ? "enemy" : null;
  }
});
