// Danger-zone tests: the move+attack union that drives the enemy-range
// overlay. Balance-sensitive — a wrong zone teaches the player wrong
// safety lessons.

import { describe, it, expect } from "vitest";
import { allEnemyDanger, dangerZoneTiles } from "../Danger";
import { Grid } from "../Grid";
import { createUnit } from "../Unit";
import type { BattleState } from "../Actions";
import type { MapDef, TilePos, Unit, UnitDef } from "../types";
import { Rng } from "../../util/rng";

const MINI_MAP: MapDef = {
  id: "mini",
  name: "Mini",
  width: 12,
  height: 12,
  tiles: Array.from({ length: 144 }, () => ({ terrain: "grass" as const, obstacle: "none" as const })),
  startPositions: { player: [], enemy: [] }
};

const mkUnit = (overrides: Partial<UnitDef>, pos: TilePos): Unit => {
  const def: UnitDef = {
    id: overrides.id ?? "u",
    name: "U",
    shortName: "U",
    faction: "enemy",
    classKind: "swordsman",
    weapon: "sword",
    stats: { hp: 30, power: 10, armor: 5, speed: 8, movement: 2, ap: 3 },
    artSeed: 0,
    level: 5,
    ...overrides
  };
  return createUnit(def, pos);
};

const mkState = (units: Unit[]): BattleState => ({
  units,
  grid: new Grid(MINI_MAP),
  rng: new Rng(1)
});

const has = (tiles: TilePos[], x: number, y: number): boolean =>
  tiles.some((t) => t.x === x && t.y === y);

describe("dangerZoneTiles", () => {
  it("sword + movement 2 threatens the manhattan-3 diamond, not distance 4", () => {
    const e = mkUnit({}, { x: 6, y: 6 });
    const zone = dangerZoneTiles(mkState([e]), e);
    expect(has(zone, 9, 6)).toBe(true);   // move 2 + reach 1
    expect(has(zone, 6, 3)).toBe(true);
    expect(has(zone, 10, 6)).toBe(false); // distance 4 — out of reach
  });

  it("a static archer leaves the min-range hole (adjacent tiles are safe)", () => {
    const archer = mkUnit({
      weapon: "bow",
      classKind: "archer",
      stats: { hp: 20, power: 8, armor: 2, speed: 9, movement: 0, ap: 2 }
    }, { x: 6, y: 6 });
    const zone = dangerZoneTiles(mkState([archer]), archer);
    expect(has(zone, 7, 6)).toBe(false);  // adjacent — inside min range
    expect(has(zone, 8, 6)).toBe(true);   // distance 2
    expect(has(zone, 6, 2)).toBe(true);   // distance 4
    expect(has(zone, 6, 1)).toBe(false);  // distance 5
  });

  it("a mobile archer covers adjacent tiles by stepping back first", () => {
    const archer = mkUnit({
      weapon: "bow",
      classKind: "archer",
      stats: { hp: 20, power: 8, armor: 2, speed: 9, movement: 2, ap: 2 }
    }, { x: 6, y: 6 });
    const zone = dangerZoneTiles(mkState([archer]), archer);
    // From (4,6) the archer can shoot (6,6)'s neighbour (5,6)... and (7,6)
    // is distance 3 from (4,6) — the "safe ring" disappears once they can move.
    expect(has(zone, 7, 6)).toBe(true);
  });
});

describe("allEnemyDanger", () => {
  it("unions enemy zones and ignores players and the dead", () => {
    const e1 = mkUnit({ id: "e1" }, { x: 2, y: 2 });
    const e2 = mkUnit({ id: "e2" }, { x: 9, y: 9 });
    const dead = mkUnit({ id: "e3" }, { x: 6, y: 6 });
    dead.state.alive = false;
    const player = mkUnit({ id: "p1", faction: "player" }, { x: 5, y: 5 });
    const zone = allEnemyDanger(mkState([e1, e2, dead, player]));
    expect(has(zone, 3, 2)).toBe(true);   // e1's reach
    expect(has(zone, 9, 8)).toBe(true);   // e2's reach
    expect(has(zone, 6, 7)).toBe(false);  // only the dead unit reached here
    expect(has(zone, 5, 6)).toBe(false);  // player zones don't render
  });
});
