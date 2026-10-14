// Unit lifecycle tests — turn refill idempotency, damage / kill, useItem.
// These guard the per-turn AP economy + Ravage threshold + item consumption.

import { describe, it, expect } from "vitest";
import { beginUnitTurn, createUnit, damageUnit, effectiveMaxAp, endUnitTurn, healUnit, isAlive, useItem } from "../Unit";
import { createDactylFood, createElixir, createFang, createPotion } from "../items";
import { ELIXIR_HEAL, POTION_HEAL, RAVAGE_THRESHOLD_PCT, type Unit, type UnitDef } from "../types";

const mkUnit = (overrides: Partial<UnitDef>, pos = { x: 0, y: 0 }): Unit => {
  const def: UnitDef = {
    id: overrides.id ?? "u",
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
  return createUnit(def, pos);
};

describe("beginUnitTurn / endUnitTurn", () => {
  it("refills AP on first call of the round", () => {
    const u = mkUnit({});
    u.state.apRemaining = 0;
    beginUnitTurn(u);
    expect(u.state.apRemaining).toBe(3);
  });

  it("is idempotent — second call within the same round does NOT refill", () => {
    const u = mkUnit({});
    beginUnitTurn(u);
    u.state.apRemaining = 1;
    beginUnitTurn(u);
    expect(u.state.apRemaining).toBe(1);
  });

  it("clears Ready / Defensive stances on the next turn start", () => {
    const u = mkUnit({});
    u.state.stance = "ready";
    beginUnitTurn(u);
    // hasStartedTurnThisRound is set; the next turn requires the round to wrap.
    u.state.hasStartedTurnThisRound = false;
    beginUnitTurn(u);
    expect(u.state.stance).toBe("none");
  });

  it("endUnitTurn flips hasActedThisRound and zeroes AP", () => {
    const u = mkUnit({});
    beginUnitTurn(u);
    u.state.apRemaining = 2;
    endUnitTurn(u);
    expect(u.state.hasActedThisRound).toBe(true);
    expect(u.state.apRemaining).toBe(0);
    expect(u.state.ravagedActive).toBe(false);
  });
});

describe("effectiveMaxAp — Dactyl Food AP bonus", () => {
  it("equals the base AP stat with no equipment", () => {
    const u = mkUnit({ stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    expect(effectiveMaxAp(u)).toBe(3);
  });

  it("a dactyl carrying Dactyl Food has max AP 4 (so the HUD reads 4/4, not 4/3)", () => {
    const u = mkUnit({ classKind: "dactyl_rider", stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    u.state.inventory = [createDactylFood()];
    expect(effectiveMaxAp(u)).toBe(4);
    // The turn refill must agree with the displayed maximum.
    beginUnitTurn(u);
    expect(u.state.apRemaining).toBe(effectiveMaxAp(u));
  });

  it("the promoted dactyl_king still benefits from Dactyl Food AP", () => {
    const u = mkUnit({ classKind: "dactyl_king", stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    u.state.inventory = [createDactylFood()];
    expect(effectiveMaxAp(u)).toBe(4);
  });

  it("Dactyl Food on a non-dactyl class is inert — max AP stays at the base stat", () => {
    const u = mkUnit({ classKind: "swordsman", stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    u.state.inventory = [createDactylFood()];
    expect(effectiveMaxAp(u)).toBe(3);
  });
});

describe("damageUnit + Ravage threshold", () => {
  it("kills a unit at exactly 0 HP and clears alive flag", () => {
    const u = mkUnit({ stats: { hp: 10, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    damageUnit(u, 10);
    expect(u.state.hp).toBe(0);
    expect(u.state.alive).toBe(false);
    expect(isAlive(u)).toBe(false);
  });

  it("over-kill clamps HP to 0 (not negative)", () => {
    const u = mkUnit({ stats: { hp: 10, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    damageUnit(u, 9999);
    expect(u.state.hp).toBe(0);
  });

  it("queues Ravage on next turn when damage >= 50% max HP since last turn", () => {
    const u = mkUnit({ stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    expect(u.state.ravagedNextTurn).toBe(false);
    damageUnit(u, Math.ceil(30 * RAVAGE_THRESHOLD_PCT));
    expect(u.state.ravagedNextTurn).toBe(true);
  });

  it("Ravage queue is sticky — additional damage doesn't double-flag (promotion is in beginUnitTurn)", () => {
    const u = mkUnit({ stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    damageUnit(u, 20);
    expect(u.state.ravagedNextTurn).toBe(true);
    damageUnit(u, 5);
    expect(u.state.ravagedNextTurn).toBe(true);
    // Promote on next turn:
    u.state.hasStartedTurnThisRound = false;
    beginUnitTurn(u);
    expect(u.state.ravagedActive).toBe(true);
    expect(u.state.ravagedNextTurn).toBe(false);
    expect(u.state.damageTakenSinceLastTurn).toBe(0);
  });

  it("dead units don't queue Ravage (no zombies)", () => {
    const u = mkUnit({ stats: { hp: 10, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    damageUnit(u, 10);
    expect(u.state.alive).toBe(false);
    expect(u.state.ravagedNextTurn).toBe(false);
  });
});

describe("healUnit", () => {
  it("returns the actual amount healed (clamped to max HP)", () => {
    const u = mkUnit({ stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    u.state.hp = 25;
    expect(healUnit(u, 100)).toBe(5);
    expect(u.state.hp).toBe(30);
  });

  it("returns 0 when already at max HP", () => {
    const u = mkUnit({});
    expect(healUnit(u, 50)).toBe(0);
  });
});

describe("useItem", () => {
  it("consumes a potion and heals POTION_HEAL", () => {
    const u = mkUnit({ stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    u.state.hp = 10;
    const potion = createPotion();
    u.state.inventory = [potion];
    const r = useItem(u, potion.id);
    expect(r.ok).toBe(true);
    expect(r.healed).toBe(POTION_HEAL);
    expect(u.state.inventory).toHaveLength(0);
    expect(u.state.hp).toBe(20);
  });

  it("consumes an elixir and heals ELIXIR_HEAL", () => {
    const u = mkUnit({ stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 5, ap: 3 } });
    u.state.hp = 1;
    const elixir = createElixir();
    u.state.inventory = [elixir];
    const r = useItem(u, elixir.id);
    expect(r.healed).toBe(ELIXIR_HEAL);
    expect(u.state.inventory).toHaveLength(0);
  });

  it("rejects equipment items (uses === 0) — no silent destruction of a Fang", () => {
    const u = mkUnit({});
    const fang = createFang();
    u.state.inventory = [fang];
    const r = useItem(u, fang.id);
    expect(r.ok).toBe(false);
    expect(u.state.inventory).toHaveLength(1);
  });

  it("returns ok:false for an unknown item id", () => {
    const u = mkUnit({});
    const r = useItem(u, "nonexistent_id");
    expect(r.ok).toBe(false);
  });
});
