// Equipment passive bonus tests. Bonuses STACK additively — five Fangs is
// +50% crit. The dactyl-class gate on Dactyl Food is the only conditional.

import { describe, it, expect } from "vitest";
import { equipmentBonuses, createFang, createMask, createRoyalLens, createDactylFood, createPotion, ITEM_CATALOG } from "../items";
import type { ItemKind } from "../types";
import { createUnit } from "../Unit";
import {
  DACTYL_FOOD_AP_BONUS,
  DACTYL_FOOD_ARMOR_PENALTY,
  FANG_CRIT_BONUS,
  MASK_MOV_BONUS,
  ROYAL_LENS_HIT_BONUS,
  type Unit,
  type UnitDef
} from "../types";

const mkUnit = (overrides: Partial<UnitDef>): Unit => {
  const def: UnitDef = {
    id: "u",
    name: "U",
    shortName: "U",
    faction: "player",
    classKind: "swordsman",
    weapon: "sword",
    stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 },
    artSeed: 0,
    level: 5,
    ...overrides
  };
  return createUnit(def, { x: 0, y: 0 });
};

describe("battle-end consumption rule", () => {
  // Every non-consumable (equipment) item is a single-fight tool: if it's
  // assigned to a deployed unit it's spent when the battle ends. Only the
  // on-demand consumables (potion, elixir) carry over. reconcilePostBattle-
  // Inventory keys off consumedOnBattleEnd, so this guards the catalog flags.
  const kinds = Object.keys(ITEM_CATALOG) as ItemKind[];

  it("flags EVERY non-consumable item as consumedOnBattleEnd", () => {
    for (const k of kinds) {
      const meta = ITEM_CATALOG[k];
      if (!meta.consumable) {
        expect(meta.consumedOnBattleEnd, `${k} should be consumed at battle end`).toBe(true);
      }
    }
  });

  it("never flags a consumable (potion/elixir) as consumedOnBattleEnd — they carry over if unused", () => {
    expect(ITEM_CATALOG.potion.consumedOnBattleEnd).toBeFalsy();
    expect(ITEM_CATALOG.elixir.consumedOnBattleEnd).toBeFalsy();
  });

  it("tells the player in the description that equipment is consumed at battle's end", () => {
    for (const k of kinds) {
      const meta = ITEM_CATALOG[k];
      if (!meta.consumable) {
        expect(meta.description.toLowerCase(), `${k} description`).toContain("battle's end");
      }
    }
  });
});

describe("equipmentBonuses", () => {
  it("returns NO_BONUSES for an empty bag", () => {
    const u = mkUnit({});
    const b = equipmentBonuses(u);
    expect(b).toEqual({ movement: 0, critPct: 0, hitPct: 0, apBonus: 0, armorPenalty: 0 });
  });

  it("stacks Masks additively for movement", () => {
    const u = mkUnit({});
    u.state.inventory = [createMask(), createMask(), createMask()];
    expect(equipmentBonuses(u).movement).toBe(MASK_MOV_BONUS * 3);
  });

  it("stacks Fangs additively for crit", () => {
    const u = mkUnit({});
    u.state.inventory = [createFang(), createFang()];
    expect(equipmentBonuses(u).critPct).toBe(FANG_CRIT_BONUS * 2);
  });

  it("stacks Royal Lenses additively for hit", () => {
    const u = mkUnit({});
    u.state.inventory = [createRoyalLens(), createRoyalLens(), createRoyalLens(), createRoyalLens()];
    expect(equipmentBonuses(u).hitPct).toBe(ROYAL_LENS_HIT_BONUS * 4);
  });

  it("Dactyl Food bonus + penalty apply to dactyl_rider", () => {
    const u = mkUnit({ classKind: "dactyl_rider" });
    u.state.inventory = [createDactylFood()];
    const b = equipmentBonuses(u);
    expect(b.apBonus).toBe(DACTYL_FOOD_AP_BONUS);
    expect(b.armorPenalty).toBe(DACTYL_FOOD_ARMOR_PENALTY);
  });

  it("Dactyl Food applies to dactyl_king (the Tier 2 promotion)", () => {
    const u = mkUnit({ classKind: "dactyl_king" });
    u.state.inventory = [createDactylFood()];
    expect(equipmentBonuses(u).apBonus).toBe(DACTYL_FOOD_AP_BONUS);
  });

  it("Dactyl Food is INERT on a non-dactyl class — no AP bonus, no armor penalty", () => {
    const u = mkUnit({ classKind: "swordsman" });
    u.state.inventory = [createDactylFood()];
    const b = equipmentBonuses(u);
    expect(b.apBonus).toBe(0);
    expect(b.armorPenalty).toBe(0);
  });

  it("Consumables (potion) contribute no passive bonus", () => {
    const u = mkUnit({});
    u.state.inventory = [createPotion(), createPotion()];
    expect(equipmentBonuses(u)).toEqual({ movement: 0, critPct: 0, hitPct: 0, apBonus: 0, armorPenalty: 0 });
  });

  it("Mixed bag: each effect contributes independently", () => {
    const u = mkUnit({ classKind: "dactyl_rider" });
    u.state.inventory = [createMask(), createFang(), createRoyalLens(), createDactylFood()];
    const b = equipmentBonuses(u);
    expect(b.movement).toBe(MASK_MOV_BONUS);
    expect(b.critPct).toBe(FANG_CRIT_BONUS);
    expect(b.hitPct).toBe(ROYAL_LENS_HIT_BONUS);
    expect(b.apBonus).toBe(DACTYL_FOOD_AP_BONUS);
    expect(b.armorPenalty).toBe(DACTYL_FOOD_ARMOR_PENALTY);
  });
});
