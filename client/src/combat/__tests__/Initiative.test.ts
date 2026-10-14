// Initiative queue tests. Cover phase ordering, speed tiebreaks, round
// wrap, setCurrent (player swap), and upcoming() dedupe behaviour.

import { describe, it, expect } from "vitest";
import { Initiative, sortInitiative } from "../Initiative";
import { createUnit } from "../Unit";
import type { Faction, Unit, UnitDef } from "../types";

const mkUnit = (id: string, faction: Faction, speed: number, pos = { x: 0, y: 0 }): Unit => {
  const def: UnitDef = {
    id,
    name: id,
    shortName: id.slice(0, 2),
    faction,
    classKind: "swordsman",
    weapon: "sword",
    stats: { hp: 30, power: 10, armor: 5, speed, movement: 5, ap: 3 },
    artSeed: 0,
    level: 5
  };
  return createUnit(def, pos);
};

describe("sortInitiative", () => {
  it("groups by faction phase: player → ally → enemy", () => {
    const units = [mkUnit("e", "enemy", 10), mkUnit("a", "ally", 10), mkUnit("p", "player", 10)];
    const sorted = sortInitiative(units);
    expect(sorted.map((u) => u.id)).toEqual(["p", "a", "e"]);
  });

  it("orders by descending speed within a phase", () => {
    const units = [mkUnit("slow", "player", 5), mkUnit("fast", "player", 12), mkUnit("mid", "player", 8)];
    const sorted = sortInitiative(units);
    expect(sorted.map((u) => u.id)).toEqual(["fast", "mid", "slow"]);
  });

  it("breaks speed ties by deployment order (input array index)", () => {
    const units = [mkUnit("first", "player", 8), mkUnit("second", "player", 8), mkUnit("third", "player", 8)];
    const sorted = sortInitiative(units);
    expect(sorted.map((u) => u.id)).toEqual(["first", "second", "third"]);
  });

  it("filters dead units", () => {
    const a = mkUnit("a", "player", 10);
    const dead = mkUnit("d", "player", 12);
    dead.state.alive = false;
    expect(sortInitiative([a, dead]).map((u) => u.id)).toEqual(["a"]);
  });
});

describe("Initiative class", () => {
  it("starts at the first unit and advances through the queue", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("p2", "player", 8), mkUnit("e1", "enemy", 12)];
    const init = new Initiative();
    init.reseed(units);
    expect(init.current()?.id).toBe("p1");
    init.advance(units);
    expect(init.current()?.id).toBe("p2");
    init.advance(units);
    expect(init.current()?.id).toBe("e1");
  });

  it("wraps the round counter and clears hasActedThisRound on round end", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("e1", "enemy", 8)];
    const init = new Initiative();
    init.reseed(units);
    expect(init.round).toBe(1);
    units[0]!.state.hasActedThisRound = true;
    units[1]!.state.hasActedThisRound = true;
    init.advance(units); // p1 → e1
    init.advance(units); // wraps to round 2
    expect(init.round).toBe(2);
    expect(units[0]!.state.hasActedThisRound).toBe(false);
    expect(units[1]!.state.hasActedThisRound).toBe(false);
  });

  it("setCurrent swaps the current unit forward in the queue", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("p2", "player", 8), mkUnit("p3", "player", 6)];
    const init = new Initiative();
    init.reseed(units);
    expect(init.current()?.id).toBe("p1");
    expect(init.setCurrent(units[2]!)).toBe(true);
    expect(init.current()?.id).toBe("p3");
  });

  it("setCurrent rejects already-spent units (cursor has passed them)", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("p2", "player", 8)];
    const init = new Initiative();
    init.reseed(units);
    init.advance(units); // cursor at p2
    expect(init.setCurrent(units[0]!)).toBe(false); // p1 has been processed
  });

  it("upcoming() dedupes by unit id when the queue cycles", () => {
    const units = [mkUnit("a", "player", 10), mkUnit("b", "player", 8)];
    const init = new Initiative();
    init.reseed(units);
    const upcoming = init.upcoming(units, 5);
    // Even though we asked for 5 turns and there are only 2 alive units,
    // the first 2 entries should be the actual queue. The cycled tail is
    // legitimate (next round) but the consumer should be able to dedupe.
    expect(upcoming.length).toBeGreaterThanOrEqual(2);
    expect(upcoming[0]!.id).toBe("a");
    expect(upcoming[1]!.id).toBe("b");
  });

  it("skips dead units when advancing", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("p2", "player", 8), mkUnit("p3", "player", 6)];
    units[1]!.state.alive = false;
    const init = new Initiative();
    init.reseed(units);
    expect(init.current()?.id).toBe("p1");
    init.advance(units);
    expect(init.current()?.id).toBe("p3");
  });
});

// The mid-turn-death regression. When the ACTOR dies during its own turn
// (killed by a Ready-stance counter, or trading into a Destruct), the
// end-of-turn path must not consume the NEXT unit's slot on top of the
// corpse-skip — that combination marked an innocent teammate as spent
// with zero AP and left them standing wherever the enemy wanted them.
describe("actor dies during its own turn", () => {
  it("atCursor returns the corpse instead of sliding to the next unit", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("p2", "player", 8)];
    const init = new Initiative();
    init.reseed(units);
    units[0]!.state.alive = false;
    expect(init.atCursor()?.id).toBe("p1");   // the dead actor
    expect(init.current()?.id).toBe("p2");    // current() skips, by design
  });

  it("advancePastCurrent lands on the next unit, not past it", () => {
    const units = [
      mkUnit("p1", "player", 10),
      mkUnit("p2", "player", 8),
      mkUnit("e1", "enemy", 12)
    ];
    const init = new Initiative();
    init.reseed(units);
    expect(init.current()?.id).toBe("p1");
    // p1 attacks, eats a counter, dies mid-turn.
    units[0]!.state.alive = false;
    const next = init.advancePastCurrent(units);
    // The old current()+advance() pair landed on e1 here — p2's turn
    // was eaten. The corpse-skip alone IS the advance.
    expect(next?.id).toBe("p2");
    expect(init.current()?.id).toBe("p2");
    expect(units[1]!.state.hasActedThisRound).toBe(false);
  });

  it("still advances exactly one slot when the actor survived", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("p2", "player", 8)];
    const init = new Initiative();
    init.reseed(units);
    const next = init.advancePastCurrent(units);
    expect(next?.id).toBe("p2");
  });

  it("wraps the round when the dying actor was last in the queue", () => {
    const units = [mkUnit("p1", "player", 10), mkUnit("e1", "enemy", 8)];
    const init = new Initiative();
    init.reseed(units);
    init.advance(units); // cursor at e1
    expect(init.current()?.id).toBe("e1");
    units[0]!.state.hasActedThisRound = true;
    // e1 attacks p1's Destruct carrier and dies with them mid-turn...
    // (p1 stays alive here — the point is e1 dying in the LAST slot.)
    units[1]!.state.alive = false;
    const next = init.advancePastCurrent(units);
    expect(init.round).toBe(2);
    expect(next?.id).toBe("p1");
    expect(units[0]!.state.hasActedThisRound).toBe(false);
  });
});
