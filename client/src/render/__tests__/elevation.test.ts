// Presentation-only elevation, checked against every battle in the game.
//
// Height is what makes the ¾ board read as a place, and it is also the one
// thing that can make it unplayable: a raised tile in front of a standable
// one hides it. These tests hold the whole campaign to "every tile a unit
// can stand on is visible and clickable at its centre".

import { describe, it, expect } from "vitest";
import * as mapFixtures from "../../combat/__tests__/fixtures/maps";
import { Grid } from "../../combat/Grid";
import type { MapDef } from "../../combat/types";
import { elevationFor, MAX_RISE_IN_FRONT, TERRAIN_ELEVATION } from "../elevation";
import { ObliqueProjection } from "../ObliqueProjection";
import {
  DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH, DIORAMA_TILE_H, DIORAMA_TILE_W
} from "../dioramaConfig";

// Every distinct map a battle can be fought on.
const maps: MapDef[] = Object.values(mapFixtures);

const project = (map: MapDef) => new ObliqueProjection({
  originX: 20, originY: 200,
  tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H,
  elevStep: DIORAMA_ELEV_STEP, slabDepth: DIORAMA_SLAB_DEPTH,
  gridWidth: map.width, gridHeight: map.height,
  elevationAt: elevationFor(map)
});

const byId = (id: string): MapDef => {
  const m = maps.find((x) => x.id === id);
  if (!m) throw new Error(`no battle uses map ${id}`);
  return m;
};

describe("terrain defaults", () => {
  it("stands walls up and sinks water", () => {
    expect(TERRAIN_ELEVATION.wall).toBeGreaterThan(0);
    expect(TERRAIN_ELEVATION.water).toBeLessThan(0);
  });
});

describe("maps designed around height", () => {
  it("puts Ndari's parapet above the snowfield", () => {
    const m = byId("mountain_pass");
    const e = elevationFor(m);
    expect(e(10, 1), "Ndari's tile on the parapet").toBe(2);
    expect(e(10, 8), "the open snow approach").toBe(0);
  });

  it("descends the cliff staircase from the clifftop to the ship deck", () => {
    const m = byId("cliffs");
    const e = elevationFor(m);
    const top = e(8, 2), deck = e(8, 17);
    expect(top).toBeGreaterThan(deck);
    // Strictly downhill, row by row, all the way down the stair column.
    for (let y = 6; y < 17; y++) expect(e(8, y + 1), `row ${y + 1}`).toBeLessThan(e(8, y));
  });

  it("raises the palace gallery and puts the throne on a dais above it", () => {
    const m = byId("palace_coup");
    const e = elevationFor(m);
    const hall = e(5, 6), gallery = e(0, 6), throne = e(9, 0);
    expect(gallery).toBeGreaterThan(hall);
    expect(throne).toBeGreaterThan(gallery);
  });
});

describe("every battle map stays playable in the ¾ view", () => {
  it("never raises a tile more than one step above standable ground behind it", () => {
    for (const m of maps) {
      const g = new Grid(m);
      const e = elevationFor(m);
      for (let y = 1; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if (g.tileAt({ x, y: y - 1 }).blocksMovement) continue;
          expect(e(x, y) - e(x, y - 1), `${m.id} (${x},${y})`).toBeLessThanOrEqual(MAX_RISE_IN_FRONT);
        }
      }
    }
  });

  it("keeps every standable tile clickable at its centre", () => {
    for (const m of maps) {
      const g = new Grid(m);
      const p = project(m);
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if (g.tileAt({ x, y }).blocksMovement) continue;
          const c = p.tileToWorld({ x, y });
          expect(p.worldToTile(c.x, c.y), `${m.id} (${x},${y})`).toEqual({ x, y });
        }
      }
    }
  });

  it("keeps every deployment tile clickable", () => {
    for (const m of maps) {
      const p = project(m);
      const starts = [...m.startPositions.player, ...m.startPositions.enemy, ...(m.startPositions.ally ?? [])];
      for (const s of starts) {
        const c = p.tileToWorld(s);
        expect(p.worldToTile(c.x, c.y), `${m.id} start (${s.x},${s.y})`).toEqual(s);
      }
    }
  });
});
