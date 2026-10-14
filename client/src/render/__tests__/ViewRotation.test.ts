// Turning the ¾ board: the view mapping, and the playability guarantee
// (every standable tile visible and clickable at its centre) from all four
// sides of every battle map.

import { describe, it, expect } from "vitest";
import * as mapFixtures from "../../combat/__tests__/fixtures/maps";
import { Grid } from "../../combat/Grid";
import type { MapDef } from "../../combat/types";
import { elevationFor, MAX_RISE_IN_FRONT } from "../elevation";
import { ObliqueProjection } from "../ObliqueProjection";
import { OrthographicProjection } from "../Projection";
import { RotatedProjection, toGrid, toView, viewSize, type ViewRotation } from "../ViewRotation";
import { DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH, DIORAMA_TILE_H, DIORAMA_TILE_W } from "../dioramaConfig";

const ROTATIONS: ViewRotation[] = [0, 1, 2, 3];

const maps: MapDef[] = Object.values(mapFixtures);

const project = (map: MapDef, r: ViewRotation): RotatedProjection => {
  const { w, h } = viewSize(map.width, map.height, r);
  return new RotatedProjection(new ObliqueProjection({
    originX: 20, originY: 200,
    tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H,
    elevStep: DIORAMA_ELEV_STEP, slabDepth: DIORAMA_SLAB_DEPTH,
    gridWidth: w, gridHeight: h,
    elevationAt: elevationFor(map, r)
  }), map.width, map.height, r);
};

describe("view mapping", () => {
  it("round-trips every cell of a non-square grid at every rotation", () => {
    const W = 7, H = 4;
    for (const r of ROTATIONS) {
      const vs = viewSize(W, H, r);
      const seen = new Set<string>();
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const v = toView({ x, y }, W, H, r);
          expect(v.x >= 0 && v.x < vs.w && v.y >= 0 && v.y < vs.h, `r${r} (${x},${y}) -> (${v.x},${v.y})`).toBe(true);
          seen.add(`${v.x},${v.y}`);
          expect(toGrid(v, W, H, r)).toEqual({ x, y });
        }
      }
      expect(seen.size, `r${r} is a bijection`).toBe(W * H);
    }
  });

  it("turns clockwise: north goes right, then to the front, then left", () => {
    const W = 5, H = 5;
    const northMid = { x: 2, y: 0 };
    expect(toView(northMid, W, H, 0)).toEqual({ x: 2, y: 0 }); // back
    expect(toView(northMid, W, H, 1)).toEqual({ x: 4, y: 2 }); // right
    expect(toView(northMid, W, H, 2)).toEqual({ x: 2, y: 4 }); // front
    expect(toView(northMid, W, H, 3)).toEqual({ x: 0, y: 2 }); // left
  });

  it("four quarter-turns bring every cell home", () => {
    const W = 6, H = 3;
    let t = { x: 1, y: 2 };
    let dims = { w: W, h: H };
    for (let i = 0; i < 4; i++) {
      t = toView(t, dims.w, dims.h, 1);
      dims = { w: dims.h, h: dims.w };
    }
    expect(t).toEqual({ x: 1, y: 2 });
  });
});

describe("RotatedProjection", () => {
  it("is the identity wrapper at rotation 0", () => {
    const inner = new OrthographicProjection({ originX: 10, originY: 20, tileSize: 48, gridWidth: 6, gridHeight: 4 });
    const rp = new RotatedProjection(inner, 6, 4, 0);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
      expect(rp.tileToWorld({ x, y })).toEqual(inner.tileToWorld({ x, y }));
    }
  });

  it("puts each screen neighbour where the screen says", () => {
    const m = maps[0]!;
    for (const r of ROTATIONS) {
      const p = project(m, r);
      const t = { x: Math.floor(m.width / 2), y: Math.floor(m.height / 2) };
      const f = p.topFace(t);
      const right = p.topFace(p.neighborOnScreen(t, "right"));
      const left = p.topFace(p.neighborOnScreen(t, "left"));
      expect(right.x, `r${r} right`).toBe(f.x + f.w);
      expect(left.x, `r${r} left`).toBe(f.x - f.w);
      // Up / down: the same column, one row back / forward.
      const up = p.neighborOnScreen(t, "up"), down = p.neighborOnScreen(t, "down");
      expect(p.topFace(up).x).toBe(f.x);
      expect(p.topFace(down).x).toBe(f.x);
      expect(p.view(up).y).toBe(p.view(t).y - 1);
      expect(p.view(down).y).toBe(p.view(t).y + 1);
    }
  });
});

describe("every battle map stays playable from every side", () => {
  it("never raises a tile more than one step above standable ground behind it, on screen", () => {
    for (const m of maps) {
      const g = new Grid(m);
      for (const r of ROTATIONS) {
        const { w, h } = viewSize(m.width, m.height, r);
        const e = elevationFor(m, r);
        for (let y = 1; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (g.tileAt(toGrid({ x, y: y - 1 }, m.width, m.height, r)).blocksMovement) continue;
            expect(e(x, y) - e(x, y - 1), `${m.id} r${r} view (${x},${y})`).toBeLessThanOrEqual(MAX_RISE_IN_FRONT);
          }
        }
      }
    }
  });

  it("keeps every standable tile clickable at its centre", () => {
    for (const m of maps) {
      const g = new Grid(m);
      for (const r of ROTATIONS) {
        const p = project(m, r);
        for (let y = 0; y < m.height; y++) {
          for (let x = 0; x < m.width; x++) {
            if (g.tileAt({ x, y }).blocksMovement) continue;
            const c = p.tileToWorld({ x, y });
            expect(p.worldToTile(c.x, c.y), `${m.id} r${r} (${x},${y})`).toEqual({ x, y });
          }
        }
      }
    }
  });

  it("keeps every deployment tile clickable", () => {
    for (const m of maps) {
      const starts = [...m.startPositions.player, ...m.startPositions.enemy, ...(m.startPositions.ally ?? [])];
      for (const r of ROTATIONS) {
        const p = project(m, r);
        for (const s of starts) {
          const c = p.tileToWorld(s);
          expect(p.worldToTile(c.x, c.y), `${m.id} r${r} start (${s.x},${s.y})`).toEqual(s);
        }
      }
    }
  });

  it("matches the unrotated heights exactly at rotation 0", () => {
    for (const m of maps) {
      const a = elevationFor(m), b = elevationFor(m, 0);
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) expect(b(x, y)).toBe(a(x, y));
    }
  });
});
