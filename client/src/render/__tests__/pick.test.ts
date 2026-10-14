import { describe, it, expect } from "vitest";
import { pickTile, type PickCandidate, type PickInput } from "../pick";

// The report: your unit (front) directly in front of an enemy (behind) on
// the same column. The enemy's figure and its tile are drawn under your
// unit's head and chest; the tile behind the enemy is an empty move tile.
const ME: PickCandidate = { id: "me", tile: { x: 5, y: 6 }, d: 0 };
const FOE: PickCandidate = { id: "foe", tile: { x: 5, y: 5 }, d: 0 };
const BEHIND = { x: 5, y: 4 };

const input = (over: Partial<PickInput>): PickInput => ({
  ground: null,
  hits: [],
  groundOccupant: null,
  actionable: new Set(),
  isEmptyDestination: () => false,
  ...over
});

describe("picking overlapping units", () => {
  it("gives an attack target the click where both figures are drawn", () => {
    const pick = pickTile(input({
      ground: FOE.tile,
      hits: [{ ...ME, d: 6 }, { ...FOE, d: 24 }],
      groundOccupant: { ...FOE, d: 24 },
      actionable: new Set(["foe"])
    }));
    expect(pick).toEqual(FOE.tile);
  });

  it("gives an attack target the click on its own tile, under the front unit's figure", () => {
    const pick = pickTile(input({
      ground: FOE.tile,
      hits: [{ ...ME, d: 10 }],
      groundOccupant: { ...FOE, d: 30 },
      actionable: new Set(["foe"])
    }));
    expect(pick).toEqual(FOE.tile);
  });

  it("prefers an attack target's figure over the empty move tile behind it", () => {
    // The old rule: the empty destination under the pointer beat any body,
    // so the enemy's head selected the tile behind it.
    const pick = pickTile(input({
      ground: BEHIND,
      hits: [{ ...FOE, d: 18 }],
      actionable: new Set(["foe"]),
      isEmptyDestination: (t) => t.x === BEHIND.x && t.y === BEHIND.y
    }));
    expect(pick).toEqual(FOE.tile);
  });

  it("still lets the front unit's own legs select it", () => {
    const pick = pickTile(input({
      ground: ME.tile,
      hits: [{ ...ME, d: 8 }],
      groundOccupant: { ...ME, d: 8 },
      actionable: new Set(["foe"])
    }));
    expect(pick).toEqual(ME.tile);
  });

  it("with no target in play, picks the body nearest the pointer, not the one in front", () => {
    const pick = pickTile(input({
      ground: FOE.tile,
      hits: [{ ...ME, d: 21 }, { ...FOE, d: 12 }],
      groundOccupant: { ...FOE, d: 12 }
    }));
    expect(pick).toEqual(FOE.tile);
    const pick2 = pickTile(input({
      ground: FOE.tile,
      hits: [{ ...ME, d: 5 }, { ...FOE, d: 30 }],
      groundOccupant: { ...FOE, d: 30 }
    }));
    expect(pick2).toEqual(ME.tile);
  });

  it("keeps walking behind a soldier who is not a target", () => {
    const pick = pickTile(input({
      ground: BEHIND,
      hits: [{ ...FOE, d: 18 }],
      isEmptyDestination: (t) => t.x === BEHIND.x && t.y === BEHIND.y
    }));
    expect(pick).toEqual(BEHIND);
  });

  it("falls through to the ground when no figure is under the pointer", () => {
    expect(pickTile(input({ ground: { x: 2, y: 3 } }))).toEqual({ x: 2, y: 3 });
    expect(pickTile(input({ ground: null }))).toBeNull();
  });

  it("chooses the nearer of two attack targets", () => {
    const A: PickCandidate = { id: "a", tile: { x: 1, y: 1 }, d: 20 };
    const Bc: PickCandidate = { id: "b", tile: { x: 1, y: 2 }, d: 9 };
    expect(pickTile(input({ hits: [A, Bc], actionable: new Set(["a", "b"]) }))).toEqual(Bc.tile);
  });
});
