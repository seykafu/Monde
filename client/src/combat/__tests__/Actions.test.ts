// Movement-economy tests — the mount bonus and how it composes with the
// base movement stat. Guards the regression where a promoted dactyl
// (dactyl_king) silently lost its +2 mounted movement.

import { describe, it, expect } from "vitest";
import { mountBonus, effectiveMovement } from "../Actions";
import { createUnit } from "../Unit";
import type { ClassKind, Unit, UnitDef } from "../types";

const mkUnit = (classKind: ClassKind, movement = 5): Unit => {
  const def: UnitDef = {
    id: "u",
    name: "U",
    shortName: "U",
    faction: "player",
    classKind,
    weapon: "sword",
    stats: { hp: 30, power: 10, armor: 5, speed: 8, movement, ap: 3 },
    artSeed: 0,
    level: 5
  };
  return createUnit(def, { x: 0, y: 0 });
};

describe("mountBonus", () => {
  it("grants +2 to knights", () => {
    expect(mountBonus(mkUnit("knight"))).toBe(2);
  });

  it("grants +2 to dactyl_rider (Leo, Tier 1)", () => {
    expect(mountBonus(mkUnit("dactyl_rider"))).toBe(2);
  });

  it("grants +2 to dactyl_king (Leo's Tier 2 promotion — still mounted)", () => {
    expect(mountBonus(mkUnit("dactyl_king"))).toBe(2);
  });

  it("grants nothing to infantry classes", () => {
    expect(mountBonus(mkUnit("swordsman"))).toBe(0);
    expect(mountBonus(mkUnit("archer"))).toBe(0);
  });

  it("a dactyl keeps its effective movement across the dactyl_king promotion", () => {
    expect(effectiveMovement(mkUnit("dactyl_rider", 5))).toBe(7);
    expect(effectiveMovement(mkUnit("dactyl_king", 6))).toBe(8); // +1 mov from STANDARD_BOOST, +2 mount preserved
  });
});
