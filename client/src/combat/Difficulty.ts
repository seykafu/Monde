// Per-battle difficulty bump applied at unit-instantiation time.
//
// Design intent — the original B1-B13 enemy stats were tuned to be
// approachable for new players in roughly the order they'd be played.
// Once the campaign filled out, B2-B13 felt a touch easy for a player
// who'd internalized stances + AP + the weapon triangle. This module
// applies a small global stat bump to every battle EXCEPT the tutorial
// (B1 — the palace coup, where the player's about to lose by design
// regardless of mechanics).
//
// Why not just edit each battle's enemy roster? Two reasons:
//   * Centralizing the knob means a future "easy / normal / hard"
//     difficulty selector lives in exactly one place, not 30.
//   * It cleanly opts B1 out without scattering "if (battleId === ...)"
//     guards through the data layer.
//
// Bosses are NOT bumped — they're already tuned to be the hardest part
// of their respective fights, and stacking +HP on a boss who already
// holds position until the squad has thinned the guards turns the
// closing minute of every battle into a slog.
//
// Future: a `DIFFICULTY_PROFILES` map keyed off save.difficulty (when
// that lands) will replace the simple is-tutorial check.

// Content-independent identifier; preserve the original baseline exception.
type BattleId = string;
import type { UnitDef } from "./types";

// Battle ids that play at the original baseline (no bump). Today this is
// just the tutorial. Add other "designed-to-be-easy" entries here if /
// when they land — e.g., a recovery battle after a story death.
const BASELINE_BATTLES: ReadonlySet<BattleId> = new Set<BattleId>([
  "b01_palace_coup"
]);

// The flat bump. Conservative — +2 HP / +1 power across the board is
// roughly "one extra clean swing of survival" on most mooks without
// tipping into "you cannot win this without a Royal Lens" territory.
const HP_BUMP = 2;
const POWER_BUMP = 1;

// ---- Level scaling -----------------------------------------------------------
//
// Enemy factories author stats against a REFERENCE level
// (UnitDef.statReferenceLevel — e.g. the Royal Guard's 30 HP was tuned
// for L6). Battles field those same factories at much higher authored
// levels, but until this pass the LEVEL only fed XP math — so a L16
// guard fought with a L6 statline while the squad arrived with sixteen
// levels of compounded growth and a promotion. The measured result
// (see BalanceSim + BalanceReport): from B12 onward, enemies needed
// 40-80 swings to kill a player. The war had no teeth.
//
// The scaling below grants per-level gains for every level above the
// reference, at rates tuned against the simulated campaign curve so
// rank-and-file stay killable in ~2-4 focused swings while genuinely
// threatening the squad, and bosses keep out-pressuring their escorts.
// Rates are per level; totals are rounded once at the end so partial
// gains accumulate instead of vanishing.
const MOOK_RATES = { hp: 1.25, power: 0.65, armor: 0.30, speed: 0.30 };
const BOSS_RATES = { hp: 3.0, power: 0.55, armor: 0.25, speed: 0.20 };

// Rank-and-file fielded far above their reference level also gain +1 AP
// — the answer to the squad's promotion AP. Kicks in at the same era
// promotions do (war-arc royal guards, late bandit veterans). Bosses
// already run 3 AP by design.
const MOOK_AP_BONUS_AT = 8;

export const applyDifficultyToEnemy = (def: UnitDef, battleId: BattleId): UnitDef => {
  if (BASELINE_BATTLES.has(battleId)) return def;
  const isBoss = def.classKind === "boss";
  const rates = isBoss ? BOSS_RATES : MOOK_RATES;
  const levelsAbove = Math.max(0, def.level - (def.statReferenceLevel ?? def.level));
  return {
    ...def,
    stats: {
      ...def.stats,
      hp: Math.round(def.stats.hp + rates.hp * levelsAbove) + (isBoss ? 0 : HP_BUMP),
      power: Math.round(def.stats.power + rates.power * levelsAbove) + (isBoss ? 0 : POWER_BUMP),
      armor: Math.round(def.stats.armor + rates.armor * levelsAbove),
      speed: Math.round(def.stats.speed + rates.speed * levelsAbove),
      ap: def.stats.ap + (!isBoss && levelsAbove >= MOOK_AP_BONUS_AT ? 1 : 0)
    }
  };
};
