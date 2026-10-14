// ObliqueProjection — the tilted ¾ diorama view.
//
// The load-bearing property is input picking: once terrain has height, a
// raised tile covers screen area that belongs to the rows behind it. If
// worldToTile disagrees with what the renderer painted, the player clicks a
// wall and moves to the floor behind it. So the headline test below builds
// an independent painter (draw back-to-front, last writer owns the pixel)
// and demands the projection agree with it pixel for pixel.

import { describe, it, expect } from "vitest";
import { ObliqueProjection, type ObliqueParams } from "../ObliqueProjection";
import { DIORAMA_ELEV_STEP, DIORAMA_TILE_H, DIORAMA_FOOT_DY } from "../dioramaConfig";

const BASE: Omit<ObliqueParams, "elevationAt"> = {
  originX: 20, originY: 100, tileW: 48, tileH: 32, elevStep: 18, slabDepth: 26,
  gridWidth: 8, gridHeight: 6
};

const make = (heights?: number[][]): ObliqueProjection =>
  new ObliqueProjection({
    ...BASE,
    elevationAt: heights ? (x, y) => heights[y]?.[x] ?? 0 : undefined
  });

// Deterministic PRNG so the property tests are reproducible.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

describe("flat board", () => {
  const p = make();

  it("places tile centres on a foreshortened grid", () => {
    expect(p.tileToWorld({ x: 0, y: 0 })).toEqual({ x: 20 + 24, y: 100 + 16 });
    expect(p.tileToWorld({ x: 3, y: 2 })).toEqual({ x: 20 + 3 * 48 + 24, y: 100 + 2 * 32 + 16 });
  });

  it("round-trips every tile centre exactly", () => {
    for (let y = 0; y < BASE.gridHeight; y++) {
      for (let x = 0; x < BASE.gridWidth; x++) {
        const w = p.tileToWorld({ x, y });
        expect(p.worldToTile(w.x, w.y)).toEqual({ x, y });
      }
    }
  });

  it("maps every point of a top face to that tile, edges included", () => {
    const f = p.topFace({ x: 4, y: 3 });
    expect(p.worldToTile(f.x, f.y)).toEqual({ x: 4, y: 3 });                    // top-left corner
    expect(p.worldToTile(f.x + f.w - 0.01, f.y + f.h - 0.01)).toEqual({ x: 4, y: 3 });
    expect(p.worldToTile(f.x + f.w, f.y)).toEqual({ x: 5, y: 3 });              // next column
  });

  it("shows no interior walls, only the slab under the front row", () => {
    expect(p.frontFaceHeight({ x: 2, y: 2 })).toBe(0);
    expect(p.frontFaceHeight({ x: 2, y: BASE.gridHeight - 1 })).toBe(BASE.slabDepth);
  });

  it("lets the slab itself be clicked as the front row", () => {
    const f = p.frontFace({ x: 1, y: BASE.gridHeight - 1 });
    expect(p.worldToTile(f.x + 5, f.y + f.h - 1)).toEqual({ x: 1, y: BASE.gridHeight - 1 });
  });

  it("rejects points off the board", () => {
    expect(p.worldToTile(19, 120)).toBeNull();                      // left of column 0
    expect(p.worldToTile(20 + 8 * 48, 120)).toBeNull();             // right of the last column
    expect(p.worldToTile(50, 99)).toBeNull();                       // above row 0
    expect(p.worldToTile(50, 100 + 6 * 32 + 26)).toBeNull();        // below the slab
  });
});

describe("elevation", () => {
  const heights = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 3, 0, 0, 0, 0],   // a tall pillar at (3,2)
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, -1, 0, 0],  // a sunken tile at (5,4)
    [0, 0, 0, 0, 0, 0, 0, 0]
  ];
  const p = make(heights);

  it("lifts a raised tile's top face by its elevation", () => {
    const flat = make().topFace({ x: 3, y: 2 });
    expect(p.topFace({ x: 3, y: 2 }).y).toBe(flat.y - 3 * BASE.elevStep);
  });

  it("gives a raised tile a wall down to the ground in front of it", () => {
    expect(p.frontFaceHeight({ x: 3, y: 2 })).toBe(3 * BASE.elevStep);
  });

  it("gives the tile BEHIND a sunken tile a wall down into it", () => {
    expect(p.frontFaceHeight({ x: 5, y: 3 })).toBe(1 * BASE.elevStep);
    expect(p.frontFaceHeight({ x: 5, y: 4 })).toBe(0);  // it is below its front neighbour
  });

  it("picks the pillar where it occludes the floor behind it", () => {
    // The pillar's top face sits over what would be row 0/1 on a flat board.
    const top = p.topFace({ x: 3, y: 2 });
    expect(p.worldToTile(top.x + 10, top.y + 2)).toEqual({ x: 3, y: 2 });
    // Clicking the pillar's own wall also picks the pillar, not the floor.
    const wall = p.frontFace({ x: 3, y: 2 });
    expect(p.worldToTile(wall.x + 10, wall.y + wall.h - 1)).toEqual({ x: 3, y: 2 });
  });

  it("still picks the floor beside the pillar", () => {
    const beside = p.tileToWorld({ x: 2, y: 1 });
    expect(p.worldToTile(beside.x, beside.y)).toEqual({ x: 2, y: 1 });
  });

  it("sorts a raised tile after a flat one in the same row", () => {
    expect(p.depthKey({ x: 3, y: 2 })).toBeGreaterThan(p.depthKey({ x: 2, y: 2 }));
    expect(p.depthKey({ x: 0, y: 3 })).toBeGreaterThan(p.depthKey({ x: 3, y: 2 }));
  });

  it("sizes the bounds to include terrain that rises above row 0", () => {
    const tall = make([[5, 0, 0, 0, 0, 0, 0, 0], ...heights.slice(1)]);
    const b = tall.bounds();
    expect(b.y).toBe(BASE.originY - 5 * BASE.elevStep);
    expect(b.y + b.h).toBe(BASE.originY + BASE.gridHeight * BASE.tileH + BASE.slabDepth);
  });
});

describe("what you see is what you click", () => {
  // Independent reference: paint every tile's visible surface back-to-front
  // (row 0 first, as the renderer does) and let the last writer own each
  // pixel. The projection's front-to-back first-hit search must agree
  // everywhere, on random rugged terrain.
  const paintedOwner = (p: ObliqueProjection, wx: number, wy: number) => {
    let owner: { x: number; y: number } | null = null;
    for (let y = 0; y < p.gridHeight; y++) {
      for (let x = 0; x < p.gridWidth; x++) {
        const top = p.topFace({ x, y });
        const bottom = top.y + top.h + p.frontFaceHeight({ x, y });
        if (wx >= top.x && wx < top.x + top.w && wy >= top.y && wy < bottom) owner = { x, y };
      }
    }
    return owner;
  };

  it("agrees with a back-to-front painter on random terrain", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed);
      const heights = Array.from({ length: BASE.gridHeight }, () =>
        Array.from({ length: BASE.gridWidth }, () => Math.floor(r() * 5) - 1)
      );
      const p = make(heights);
      const b = p.bounds();
      for (let i = 0; i < 400; i++) {
        const wx = b.x + r() * b.w;
        const wy = b.y + r() * b.h;
        expect(p.worldToTile(wx, wy), `seed ${seed} at (${wx.toFixed(1)}, ${wy.toFixed(1)})`)
          .toEqual(paintedOwner(p, wx, wy));
      }
    }
  });

  it("keeps every tile centre clickable on gently sloped terrain", () => {
    // The invariant is a one-level step UNDER HALF a tile's depth: a rise
    // in front then covers less than half of the tile behind it, so that
    // tile's centre stays visible. (The first draft of this test claimed
    // "under a whole tile's depth" was enough, and failed — which is how
    // the half-depth rule got pinned on the shipped constants below.)
    const r = rng(99);
    const heights = Array.from({ length: BASE.gridHeight }, () =>
      Array.from({ length: BASE.gridWidth }, () => (r() < 0.3 ? 1 : 0))
    );
    const p = new ObliqueProjection({
      ...BASE,
      elevStep: BASE.tileH / 2 - 2,
      elevationAt: (x, y) => heights[y]?.[x] ?? 0
    });
    for (let y = 0; y < BASE.gridHeight; y++) {
      for (let x = 0; x < BASE.gridWidth; x++) {
        const c = p.tileToWorld({ x, y });
        expect(p.worldToTile(c.x, c.y), `tile (${x},${y}) centre`).toEqual({ x, y });
      }
    }
  });
});

describe("shipped diorama geometry", () => {
  it("keeps a one-level step under half a tile's depth", () => {
    expect(DIORAMA_ELEV_STEP).toBeLessThan(DIORAMA_TILE_H / 2);
  });

  it("stands units on the front half of their tile, inside it", () => {
    // Feet in front of centre, but not past the tile's front edge — or a
    // unit would read as standing on the tile in front.
    expect(DIORAMA_FOOT_DY).toBeGreaterThan(0);
    expect(DIORAMA_FOOT_DY).toBeLessThan(DIORAMA_TILE_H / 2);
  });
});
