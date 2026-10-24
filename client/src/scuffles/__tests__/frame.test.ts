import { describe, expect, it } from 'vitest';
import { ObliqueProjection } from '../../render/ObliqueProjection';
import { DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH, DIORAMA_TILE_H, DIORAMA_TILE_W } from '../../render/dioramaConfig';
import { frameArena, type ArenaFrame, type PageRect } from '../frame';

const PAGE: PageRect = { x: 12, y: 92, w: 706, h: 398 };
const FIT = { maxZoom: 1.5, headroom: 22, pad: 6 };
const board = (w: number, h: number, elevationAt?: (x: number, y: number) => number) => new ObliqueProjection({ originX: 0, originY: 0,
  tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H, elevStep: DIORAMA_ELEV_STEP, slabDepth: DIORAMA_SLAB_DEPTH, gridWidth: w, gridHeight: h, elevationAt });
// The world camera with a top-left pivot: design = page corner + (world − scroll) · zoom.
const toDesign = (f: ArenaFrame, x: number, y: number) => ({ x: PAGE.x + (x - f.scrollX) * f.zoom, y: PAGE.y + (y - f.scrollY) * f.zoom });
const toWorld = (f: ArenaFrame, x: number, y: number) => ({ x: f.scrollX + (x - PAGE.x) / f.zoom, y: f.scrollY + (y - PAGE.y) / f.zoom });

describe('Scuffle arena framing', () => {
  it('fits a 10×8 arena on the left page, centred, with room above the back row', () => {
    const b = board(10, 8).bounds(), f = frameArena(b, PAGE, FIT);
    const tl = toDesign(f, b.x, b.y), br = toDesign(f, b.x + b.w, b.y + b.h);
    expect(f.zoom).toBeGreaterThan(1);
    expect(tl.x).toBeGreaterThanOrEqual(PAGE.x + FIT.pad - 1e-9);
    expect(br.x).toBeLessThanOrEqual(PAGE.x + PAGE.w - FIT.pad + 1e-9);
    expect(tl.x - PAGE.x).toBeCloseTo(PAGE.x + PAGE.w - br.x);
    expect(br.y).toBeCloseTo(PAGE.y + PAGE.h - FIT.pad);
    expect(tl.y - FIT.headroom * f.zoom).toBeGreaterThanOrEqual(PAGE.y + FIT.pad - 1e-9);
  });

  it('never draws a small room closer than maxZoom', () => {
    expect(frameArena(board(4, 3).bounds(), PAGE, FIT).zoom).toBe(FIT.maxZoom);
  });

  it('a click on any tile picks that tile, raised ground included', () => {
    const p = board(10, 8, (x, y) => (y === 4 && x > 2 ? 1 : 0)), f = frameArena(p.bounds(), PAGE, FIT);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) {
      const c = p.tileToWorld({ x, y }), click = toDesign(f, c.x, c.y), at = toWorld(f, click.x, click.y);
      expect(p.worldToTile(at.x, at.y)).toEqual({ x, y });
    }
  });
});
