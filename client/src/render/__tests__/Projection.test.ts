// Projection pixel-identity tests.
//
// These are the contract that makes the Phase-1 HD-2D refactor SAFE: they
// pin OrthographicProjection to the EXACT pre-refactor formulas that used to
// live inline in UnitArt.tileToPixel and BattleScene.screenToTile. If a
// future projection swap (2.5D / 3D) is wired in behind this seam, flipping
// back to OrthographicProjection must stay byte-identical to today — these
// tests prove it, with zero browser/WebGL dependency.

import { describe, it, expect } from "vitest";
import { OrthographicProjection } from "../Projection";

// The legacy formulas, copied verbatim from the original call sites so the
// test fails if the projection ever drifts from the shipped 2D math.
const legacyTileToPixel = (
  tile: { x: number; y: number },
  originX: number,
  originY: number,
  tileSize: number
) => ({
  x: originX + tile.x * tileSize + tileSize / 2,
  y: originY + tile.y * tileSize + tileSize / 2
});

const legacyScreenToTile = (
  worldX: number,
  worldY: number,
  originX: number,
  originY: number,
  tileSize: number,
  gridWidth: number,
  gridHeight: number
) => {
  const x = Math.floor((worldX - originX) / tileSize);
  const y = Math.floor((worldY - originY) / tileSize);
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
  return { x, y };
};

// A spread of origins/tile sizes that mirror real battle layouts (the
// centered-origin math in BattleScene produces non-round offsets like these).
const CASES = [
  { originX: 0, originY: 0, tileSize: 48, gridWidth: 10, gridHeight: 10 },
  { originX: 20, originY: 96, tileSize: 48, gridWidth: 13, gridHeight: 11 },
  { originX: 137, originY: 54, tileSize: 48, gridWidth: 14, gridHeight: 9 },
  { originX: 20, originY: 96, tileSize: 32, gridWidth: 8, gridHeight: 8 }
];

describe("OrthographicProjection — tileToWorld pixel identity", () => {
  for (const c of CASES) {
    it(`matches legacy tileToPixel for origin (${c.originX},${c.originY}) tile ${c.tileSize}`, () => {
      const proj = new OrthographicProjection(c);
      for (let ty = 0; ty < c.gridHeight; ty++) {
        for (let tx = 0; tx < c.gridWidth; tx++) {
          const got = proj.tileToWorld({ x: tx, y: ty });
          const want = legacyTileToPixel({ x: tx, y: ty }, c.originX, c.originY, c.tileSize);
          expect(got).toEqual(want);
        }
      }
    });
  }
});

describe("OrthographicProjection — worldToTile pixel identity + bounds", () => {
  for (const c of CASES) {
    it(`matches legacy screenToTile across the grid for origin (${c.originX},${c.originY})`, () => {
      const proj = new OrthographicProjection(c);
      // Sample several world points per tile (corners + center) plus a margin
      // of out-of-bounds points, so the floor() boundaries and the bounds
      // rejection are both exercised.
      const span = c.tileSize;
      for (let ty = -1; ty <= c.gridHeight; ty++) {
        for (let tx = -1; tx <= c.gridWidth; tx++) {
          for (const [fx, fy] of [[0.01, 0.01], [0.5, 0.5], [0.99, 0.99]]) {
            const worldX = c.originX + (tx + fx) * span;
            const worldY = c.originY + (ty + fy) * span;
            const got = proj.worldToTile(worldX, worldY);
            const want = legacyScreenToTile(
              worldX, worldY, c.originX, c.originY, c.tileSize, c.gridWidth, c.gridHeight
            );
            expect(got).toEqual(want);
          }
        }
      }
    });
  }
});

describe("OrthographicProjection — round trip", () => {
  it("tileToWorld → worldToTile recovers the original tile for every cell", () => {
    const c = { originX: 137, originY: 54, tileSize: 48, gridWidth: 14, gridHeight: 9 };
    const proj = new OrthographicProjection(c);
    for (let ty = 0; ty < c.gridHeight; ty++) {
      for (let tx = 0; tx < c.gridWidth; tx++) {
        const world = proj.tileToWorld({ x: tx, y: ty });
        expect(proj.worldToTile(world.x, world.y)).toEqual({ x: tx, y: ty });
      }
    }
  });

  it("rejects points outside the grid", () => {
    const proj = new OrthographicProjection({
      originX: 0, originY: 0, tileSize: 48, gridWidth: 5, gridHeight: 5
    });
    expect(proj.worldToTile(-1, 10)).toBeNull();
    expect(proj.worldToTile(10, -1)).toBeNull();
    expect(proj.worldToTile(5 * 48, 10)).toBeNull();
    expect(proj.worldToTile(10, 5 * 48)).toBeNull();
    expect(proj.worldToTile(0, 0)).toEqual({ x: 0, y: 0 });
    expect(proj.worldToTile(5 * 48 - 1, 5 * 48 - 1)).toEqual({ x: 4, y: 4 });
  });
});
