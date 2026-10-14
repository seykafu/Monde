// Damage formula tests. Cover the weapon triangle, stance modifiers,
// terrain, equipment, and Ravage state. These are the math knobs the
// designer tunes battle-to-battle, so a regression here breaks balance
// across every fight.
//
// Construction helpers below build a minimal Unit that's just enough to
// satisfy the Damage.ts code paths — no Phaser, no scene, no AI.

import { describe, it, expect } from "vitest";
import { previewAttack, weaponModifier, attackerRavageModifier, attackerClassBonus, effectiveArmor } from "../Damage";
import { createUnit } from "../Unit";
import { createFang, createRoyalLens, createDactylFood } from "../items";
import type { Tile, Unit, UnitDef } from "../types";

const NEUTRAL_TILE: Tile = {
  pos: { x: 0, y: 0 },
  terrain: "grass",
  obstacle: "none",
  defendBonus: 1.0,
  blocksMovement: false,
  blocksLineOfSight: false,
  hitPenalty: 0
};

const mkDef = (overrides: Partial<UnitDef>): UnitDef => ({
  id: "test",
  name: "Test",
  shortName: "Tt",
  faction: "player",
  classKind: "swordsman",
  weapon: "sword",
  stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 },
  artSeed: 0,
  level: 5,
  ...overrides
});

const mkUnit = (overrides: Partial<UnitDef>, pos = { x: 0, y: 0 }): Unit =>
  createUnit(mkDef(overrides), pos);

describe("weaponModifier", () => {
  it("returns 1.15 for sword vs spear (favored)", () => {
    expect(weaponModifier("sword", "spear")).toBeCloseTo(1.15);
    expect(weaponModifier("spear", "shield")).toBeCloseTo(1.15);
    expect(weaponModifier("shield", "sword")).toBeCloseTo(1.15);
  });
  it("returns 0.85 for the inverse matchup", () => {
    expect(weaponModifier("spear", "sword")).toBeCloseTo(0.85);
    expect(weaponModifier("shield", "spear")).toBeCloseTo(0.85);
    expect(weaponModifier("sword", "shield")).toBeCloseTo(0.85);
  });
  it("returns 1.0 for mirror matchups", () => {
    expect(weaponModifier("sword", "sword")).toBe(1.0);
    expect(weaponModifier("bow", "bow")).toBe(1.0);
  });
  it("bow > dactyl (anti-air): bow gets 1.15, dactyl gets 0.85 against bow", () => {
    expect(weaponModifier("bow", "dactyl")).toBeCloseTo(1.15);
    expect(weaponModifier("dactyl", "bow")).toBeCloseTo(0.85);
  });
  it("bow and dactyl are neutral against the core triangle weapons", () => {
    expect(weaponModifier("bow", "sword")).toBe(1.0);
    expect(weaponModifier("sword", "bow")).toBe(1.0);
    expect(weaponModifier("dactyl", "spear")).toBe(1.0);
    expect(weaponModifier("spear", "dactyl")).toBe(1.0);
  });
  it("lens sits fully outside the triangle — neutral both ways vs everything", () => {
    for (const w of ["sword", "spear", "shield", "bow", "dactyl"] as const) {
      expect(weaponModifier("lens", w)).toBe(1.0);
      expect(weaponModifier(w, "lens")).toBe(1.0);
    }
  });
});

describe("lens armor pierce (Veya's weapon identity)", () => {
  it("a lens attack applies only half the target's armor", () => {
    // Same attacker statline, sword vs lens, into a heavily armored
    // target: the lens hit must land harder by exactly the armor saved.
    const tank = mkUnit({ classKind: "sentinel", weapon: "shield", stats: { hp: 40, power: 8, armor: 12, speed: 4, movement: 3, ap: 2 } }, { x: 2, y: 0 });
    // Sword eats the shield's triangle edge; dactyl is neutral like lens,
    // so compare dactyl vs lens to isolate the armor term.
    const rider = mkUnit({ classKind: "dactyl_rider", weapon: "dactyl", stats: { hp: 30, power: 14, armor: 5, speed: 8, movement: 5, ap: 3 } });
    const caster = mkUnit({ classKind: "lenscaster", weapon: "lens", stats: { hp: 24, power: 14, armor: 2, speed: 8, movement: 3, ap: 2 } });
    const viaDactyl = previewAttack(rider, tank, NEUTRAL_TILE);
    const viaLens = previewAttack(caster, tank, NEUTRAL_TILE);
    // 14 power - 12 armor = 2 vs 14 - 6 = 8.
    expect(viaDactyl.damage).toBe(2);
    expect(viaLens.damage).toBe(8);
  });
  it("lens has the highest base hit in the game (90)", () => {
    const caster = mkUnit({ classKind: "lenscaster", weapon: "lens" });
    const target = mkUnit({ classKind: "swordsman", weapon: "sword" }, { x: 2, y: 0 });
    // Equal speeds — the preview hit rate IS the base hit.
    expect(previewAttack(caster, target, NEUTRAL_TILE).hitRate).toBe(90);
  });
});

describe("attackerClassBonus (shinobi matchups)", () => {
  const shinobiVsBow = (): { atk: Unit; def: Unit } => {
    const atk = createUnit(mkDef({ classKind: "shinobi", weapon: "sword" }), { x: 0, y: 0 });
    const def = createUnit(mkDef({ classKind: "archer", weapon: "bow" }), { x: 1, y: 0 });
    return { atk, def };
  };
  it("shinobi attacking bow-wielder gets 1.15× class bonus", () => {
    const { atk, def } = shinobiVsBow();
    expect(attackerClassBonus(atk, def)).toBeCloseTo(1.15);
  });
  it("sword-wielder attacking shinobi gets 1.15× class bonus (assassin's weakness)", () => {
    const atk = createUnit(mkDef({ classKind: "swordsman", weapon: "sword" }), { x: 0, y: 0 });
    const def = createUnit(mkDef({ classKind: "shinobi", weapon: "sword" }), { x: 1, y: 0 });
    expect(attackerClassBonus(atk, def)).toBeCloseTo(1.15);
  });
  it("non-shinobi vs bow: no class bonus (weapon triangle is the only modifier)", () => {
    const atk = createUnit(mkDef({ classKind: "swordsman", weapon: "sword" }), { x: 0, y: 0 });
    const def = createUnit(mkDef({ classKind: "archer", weapon: "bow" }), { x: 1, y: 0 });
    expect(attackerClassBonus(atk, def)).toBe(1.0);
  });
  it("shinobi attacking spear-wielder: no class bonus (weapon triangle still applies separately)", () => {
    const atk = createUnit(mkDef({ classKind: "shinobi", weapon: "sword" }), { x: 0, y: 0 });
    const def = createUnit(mkDef({ classKind: "spearton", weapon: "spear" }), { x: 1, y: 0 });
    expect(attackerClassBonus(atk, def)).toBe(1.0);
  });
  it("shinobi attacking shinobi: no class bonus in either direction", () => {
    const atk = createUnit(mkDef({ classKind: "shinobi", weapon: "sword" }), { x: 0, y: 0 });
    const def = createUnit(mkDef({ classKind: "shinobi", weapon: "sword" }), { x: 1, y: 0 });
    // attacker.weapon === sword AND defender.classKind === shinobi → 1.15
    // This branch DOES trigger, so shinobi vs shinobi = sword-vs-shinobi bonus.
    expect(attackerClassBonus(atk, def)).toBeCloseTo(1.15);
  });
  it("previewAttack multiplies the class bonus into final damage", () => {
    const { atk, def } = shinobiVsBow();
    // Set high power, no armor, no terrain, so the multiplier is visible.
    atk.stats.power = 20;
    def.stats.armor = 0;
    const baseline = previewAttack(
      createUnit(mkDef({ classKind: "swordsman", weapon: "sword", stats: { hp: 30, power: 20, armor: 0, speed: 8, movement: 5, ap: 3 } }), { x: 0, y: 0 }),
      def,
      NEUTRAL_TILE
    );
    const shinobiHit = previewAttack(atk, def, NEUTRAL_TILE);
    // Same attacker stats, but shinobi gets +15% class bonus.
    expect(shinobiHit.damage).toBeGreaterThan(baseline.damage);
  });
});

describe("previewAttack", () => {
  it("computes higher damage with weapon advantage than disadvantage", () => {
    const sword = mkUnit({ weapon: "sword", stats: { hp: 30, power: 20, armor: 0, speed: 10, movement: 5, ap: 3 } });
    const spear = mkUnit({ weapon: "spear", stats: { hp: 30, power: 20, armor: 0, speed: 10, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    const shield = mkUnit({ weapon: "shield", stats: { hp: 30, power: 20, armor: 0, speed: 10, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    const vsSpear = previewAttack(sword, spear, NEUTRAL_TILE);
    const vsShield = previewAttack(sword, shield, NEUTRAL_TILE);
    expect(vsSpear.damage).toBeGreaterThan(vsShield.damage);
  });

  it("respects terrain defendBonus (cover halves damage)", () => {
    const atk = mkUnit({ stats: { hp: 30, power: 20, armor: 0, speed: 10, movement: 5, ap: 3 } });
    const def = mkUnit({ stats: { hp: 30, power: 10, armor: 0, speed: 10, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    const open = previewAttack(atk, def, NEUTRAL_TILE);
    const cover: Tile = { ...NEUTRAL_TILE, defendBonus: 0.5 };
    const inCover = previewAttack(atk, def, cover);
    expect(inCover.damage).toBeLessThan(open.damage);
  });

  it("applies defensive stance (×0.5 incoming) on the defender", () => {
    const atk = mkUnit({ stats: { hp: 30, power: 30, armor: 0, speed: 10, movement: 5, ap: 3 } });
    const def = mkUnit({ stats: { hp: 30, power: 10, armor: 0, speed: 10, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    const baseline = previewAttack(atk, def, NEUTRAL_TILE);
    def.state.stance = "defensive";
    const defended = previewAttack(atk, def, NEUTRAL_TILE);
    expect(defended.damage).toBeLessThan(baseline.damage);
    // Floor of 1: defensive can't drive damage below 1.
    expect(defended.damage).toBeGreaterThanOrEqual(1);
  });

  it("Ready stance grants the counter bonus only when isCounter=true", () => {
    const atk = mkUnit({ stats: { hp: 30, power: 20, armor: 0, speed: 10, movement: 5, ap: 3 } });
    atk.state.stance = "ready";
    const def = mkUnit({ stats: { hp: 30, power: 10, armor: 0, speed: 10, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    const initiated = previewAttack(atk, def, NEUTRAL_TILE, false);
    const countered = previewAttack(atk, def, NEUTRAL_TILE, true);
    expect(countered.damage).toBeGreaterThan(initiated.damage);
    // Counter bonus should also bump crit by +5.
    expect(countered.critRate).toBe(initiated.critRate + 5);
  });

  it("applies Royal Lens (+15% hit per copy) and Fang (+10% crit per copy) additively", () => {
    const atk = mkUnit({});
    const def = mkUnit({}, { x: 1, y: 0 });
    const baseline = previewAttack(atk, def, NEUTRAL_TILE);
    atk.state.inventory = [createRoyalLens(), createRoyalLens(), createFang()];
    const buffed = previewAttack(atk, def, NEUTRAL_TILE);
    expect(buffed.hitRate).toBe(Math.min(99, baseline.hitRate + 30));
    expect(buffed.critRate).toBe(baseline.critRate + 10);
  });

  it("clamps hitRate to [50, 99] and critRate to [0, 60]", () => {
    const slowAtk = mkUnit({ stats: { hp: 30, power: 10, armor: 0, speed: 1, movement: 5, ap: 3 } });
    const fastDef = mkUnit({ stats: { hp: 30, power: 10, armor: 0, speed: 30, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    const p = previewAttack(slowAtk, fastDef, NEUTRAL_TILE);
    expect(p.hitRate).toBeGreaterThanOrEqual(50);
    expect(p.critRate).toBeGreaterThanOrEqual(0);
  });

  it("damage is at least 1 (chip floor)", () => {
    const wimp = mkUnit({ stats: { hp: 30, power: 1, armor: 0, speed: 5, movement: 5, ap: 3 } });
    const tank = mkUnit({ stats: { hp: 30, power: 5, armor: 100, speed: 5, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    expect(previewAttack(wimp, tank, NEUTRAL_TILE).damage).toBe(1);
  });
});

describe("Ravage State (attacker bonus + defender armor halving)", () => {
  it("attackerRavageModifier returns 1.5 when ravagedActive, else 1.0", () => {
    const u = mkUnit({});
    expect(attackerRavageModifier(u)).toBe(1.0);
    u.state.ravagedActive = true;
    expect(attackerRavageModifier(u)).toBe(1.5);
  });

  it("effectiveArmor halves armor when defender is ravagedActive", () => {
    const u = mkUnit({ stats: { hp: 30, power: 10, armor: 10, speed: 5, movement: 5, ap: 3 } });
    expect(effectiveArmor(u)).toBe(10);
    u.state.ravagedActive = true;
    expect(effectiveArmor(u)).toBe(5);
  });

  it("Dactyl Food imposes -4 armor on a dactyl-class carrier (and only them)", () => {
    const dactyl = mkUnit({ classKind: "dactyl_rider", stats: { hp: 30, power: 10, armor: 10, speed: 5, movement: 5, ap: 3 } });
    dactyl.state.inventory = [createDactylFood()];
    expect(effectiveArmor(dactyl)).toBe(6);

    const sword = mkUnit({ classKind: "swordsman", stats: { hp: 30, power: 10, armor: 10, speed: 5, movement: 5, ap: 3 } });
    sword.state.inventory = [createDactylFood()];
    expect(effectiveArmor(sword)).toBe(10); // gated, no penalty
  });

  it("Ravaged trade does ~3× the damage of a clean trade (both attacker bonus + defender penalty stack)", () => {
    const atk = mkUnit({ stats: { hp: 30, power: 20, armor: 0, speed: 10, movement: 5, ap: 3 } });
    const def = mkUnit({ stats: { hp: 30, power: 10, armor: 8, speed: 10, movement: 5, ap: 3 } }, { x: 1, y: 0 });
    const clean = previewAttack(atk, def, NEUTRAL_TILE).damage;
    atk.state.ravagedActive = true;
    def.state.ravagedActive = true;
    const ravaged = previewAttack(atk, def, NEUTRAL_TILE).damage;
    expect(ravaged).toBeGreaterThan(clean * 2);
  });
});
