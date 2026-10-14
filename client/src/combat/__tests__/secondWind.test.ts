// Boss second-phase tests (UnitDef.secondWind).
//
// The B28 finale hangs on this: every path's final opponent refuses the
// first killing blow, comes back tougher, and retaliates against anything
// that closes. Three classes of bug would each quietly ruin the fight —
//
//   1. The phase never fires, or fires twice (an unkillable boss).
//   2. The victory condition resolves on the FIRST death, ending the
//      battle before phase two is ever seen.
//   3. "Twice as tough" floors most of the squad at 1 damage, so the
//      finale is two characters plinking while six watch. That is the
//      exact reason toughness is a damage multiplier here and not a
//      doubled armor stat — armor is subtractive in this game.
//
// so all three are pinned down below.

import { describe, it, expect } from "vitest";
import { createUnit, damageUnit, isAlive } from "../Unit";
import { performAttack } from "../Actions";
import { previewAttack } from "../Damage";
import { canTriggerRelentlessCounter } from "../Stances";
import { Grid } from "../Grid";
import { defeatUnit } from "../Victory";
import { Rng } from "../../util/rng";
import type { MapDef, Tile, Unit, UnitDef } from "../types";

const MINI_MAP: MapDef = {
  id: "mini",
  name: "Mini",
  width: 8,
  height: 8,
  tiles: Array.from({ length: 64 }, () => ({ terrain: "grass" as const, obstacle: "none" as const })),
  startPositions: { player: [], enemy: [] }
};
const GRID = new Grid(MINI_MAP);
const NEUTRAL_TILE = {
  terrain: "grass", obstacle: "none", defendBonus: 1, hitPenalty: 0, blocksMovement: false
} as unknown as Tile;

const mkUnit = (overrides: Partial<UnitDef>, pos = { x: 0, y: 0 }): Unit => createUnit({
  id: "u", name: "U", shortName: "U", faction: "player", classKind: "swordsman",
  weapon: "sword", stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 },
  artSeed: 0, level: 5, ...overrides
}, pos);

const PHASE = { hpFraction: 0.5, damageTaken: 0.5, announce: "It stands." };

describe("second wind — the phase change itself", () => {
  it("refuses the first killing blow and comes back at the authored fraction", () => {
    const boss = mkUnit({ id: "boss", faction: "enemy", secondWind: PHASE });
    expect(damageUnit(boss, 999)).toBe(true);
    expect(isAlive(boss), "boss must survive the first lethal hit").toBe(true);
    expect(boss.state.hp).toBe(15);          // 50% of 30
    expect(boss.state.secondWindUsed).toBe(true);
    expect(boss.state.alwaysCounters).toBe(true);
    expect(boss.state.damageTakenMult).toBe(0.5);
  });

  it("fires exactly once — the second killing blow lands normally", () => {
    const boss = mkUnit({ id: "boss", faction: "enemy", secondWind: PHASE });
    damageUnit(boss, 999);
    expect(damageUnit(boss, 999), "no second phase two").toBe(false);
    expect(isAlive(boss), "boss must actually die the second time").toBe(false);
    expect(boss.state.hp).toBe(0);
  });

  it("leaves ordinary units completely alone", () => {
    const mook = mkUnit({ id: "mook", faction: "enemy" });
    expect(damageUnit(mook, 999)).toBe(false);
    expect(isAlive(mook)).toBe(false);
    expect(mook.state.damageTakenMult).toBe(1);
  });

  it("starts the Ravage counter clean so the blow that 'killed' them doesn't carry over", () => {
    const boss = mkUnit({ id: "boss", faction: "enemy", secondWind: PHASE });
    damageUnit(boss, 999);
    expect(boss.state.damageTakenSinceLastTurn).toBe(0);
    expect(boss.state.ravagedNextTurn).toBe(false);
  });

  it("does NOT hand the battle to the player on the first death", () => {
    // The bug this guards: defeatUnit evaluating on the killing blow that
    // the second wind refused would end B28 before phase two exists.
    const boss = mkUnit({ id: "boss", faction: "enemy", secondWind: PHASE }, { x: 1, y: 1 });
    const hero = mkUnit({ id: "hero" }, { x: 0, y: 0 });
    const state = { units: [hero, boss], grid: GRID, rng: new Rng(1) };
    const cond = defeatUnit("boss");
    damageUnit(boss, 999);
    expect(cond.evaluate({ state, round: 1 }), "phase two must not read as victory").toBeNull();
    damageUnit(boss, 999);
    expect(cond.evaluate({ state, round: 1 }), "the real death must win").toBe("player");
  });
});

describe("second wind — halved damage", () => {
  it("halves what lands, and halves it for EVERY attacker equally", () => {
    // The squad's damage spread must be preserved. Doubling a subtractive
    // armor stat instead would floor the weaker attackers at 1 while the
    // heaviest hitter barely noticed — six of eight characters benched.
    const boss = mkUnit({ id: "boss", faction: "enemy", secondWind: PHASE }, { x: 1, y: 0 });
    const attackers = [8, 14, 20, 32].map((power, i) =>
      mkUnit({ id: `a${i}`, stats: { hp: 30, power, armor: 5, speed: 8, movement: 5, ap: 3 } })
    );
    const before = attackers.map((a) => previewAttack(a, boss, NEUTRAL_TILE, false, []).damage);
    damageUnit(boss, 999);
    const after = attackers.map((a) => previewAttack(a, boss, NEUTRAL_TILE, false, []).damage);
    for (let i = 0; i < attackers.length; i++) {
      expect(after[i]!, `attacker ${i} should take ~half`).toBe(Math.max(1, Math.round(before[i]! * 0.5)));
      expect(after[i]!, `attacker ${i} must not be floored to chip damage`).toBeGreaterThan(1);
    }
  });
});

describe("second wind — unconditional counters", () => {
  it("retaliates with no Ready stance and no speed advantage", () => {
    const boss = mkUnit({
      id: "boss", faction: "enemy", secondWind: PHASE,
      stats: { hp: 60, power: 12, armor: 2, speed: 1, movement: 5, ap: 3 }  // slower: no speed counter
    }, { x: 1, y: 0 });
    const hero = mkUnit({ id: "hero", stats: { hp: 60, power: 6, armor: 0, speed: 20, movement: 5, ap: 3 } });
    const state = { units: [hero, boss], grid: GRID, rng: new Rng(7) };
    expect(canTriggerRelentlessCounter(boss, hero), "not armed before the phase").toBe(false);
    damageUnit(boss, 999);
    expect(canTriggerRelentlessCounter(boss, hero)).toBe(true);
    const res = performAttack(state, hero, boss);
    expect(res.counterTriggered, "phase two must hit back").toBe(true);
  });

  it("still obeys weapon reach — a bow at melee cannot retaliate", () => {
    const boss = mkUnit({ id: "boss", faction: "enemy", weapon: "bow", secondWind: PHASE }, { x: 1, y: 0 });
    const hero = mkUnit({ id: "hero" }, { x: 0, y: 0 });
    damageUnit(boss, 999);
    expect(canTriggerRelentlessCounter(boss, hero), "bows do not counter in the face").toBe(false);
  });
});

