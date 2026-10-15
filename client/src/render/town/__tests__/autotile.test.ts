import { describe, expect, it } from 'vitest';
import { KIND_ID, TH, TW, groundMap, roadRuts, spillMask, winnerAt, type GroundMap } from '../autotile';
import { DEFAULT_LEGEND } from '../../../world/townTerrain';
import { bakeBoard, bakeContext } from '../terrainBake';
import { detectWindows } from '../windows';
import { RIPPLE_H, RIPPLE_W, flowVelocity, ripplePattern, waterStyle } from '../water';

const map = (rows: string[], elev?: string[]): GroundMap =>
  groundMap(rows[0]!.length, rows.length, (x, y) => DEFAULT_LEGEND[rows[y]![x]!]!.terrain, (x, y) => (elev ? Number(elev[y]![x]) : 0));
const SEED = 42;
const win = (m: GroundMap, gx: number, gy: number) => winnerAt(m, spillMask(m), gx, gy, SEED);
const K = KIND_ID;

describe('autotile: which kind covers each ground pixel', () => {
  // grass | path, with a pond under the grass.
  const m = map([
    ',,,::',
    ',,,::',
    ',oo::',
    ',oo..',
  ]);

  it('fills the middle of every tile with its own kind', () => {
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      expect(win(m, x * TW + TW / 2, y * TH + TH / 2), `${x},${y}`).toBe(m.kinds[y * m.width + x]);
    }
  });

  it('lets a soft, higher kind spill a few ragged pixels over a lower neighbour, and no further', () => {
    // Grass (x 2) beside gravel (x 3), row 0: right at the line the gravel tile shows grass…
    const edge = 3 * TW;
    let spilled = 0;
    for (let gy = 0; gy < TH; gy++) if (win(m, edge, gy) === K.grass) spilled++;
    expect(spilled).toBeGreaterThan(TH / 2);
    // …ten pixels in it never does, and the grass never shows gravel.
    for (let gy = 0; gy < TH; gy++) {
      expect(win(m, edge + 10, gy)).toBe(K.gravel);
      for (let gx = edge - 20; gx < edge; gx++) expect(win(m, gx, gy)).toBe(K.grass);
    }
  });

  it('keeps hard, laid edges straight: cobbles neither spill nor get spilled on by gravel', () => {
    // Gravel (3,2) above cobbles (3,3): gravel stacks lower than cobble, so the line stays put.
    for (let gx = 3 * TW; gx < 4 * TW; gx++) {
      expect(win(m, gx, 3 * TH)).toBe(K.cobble);
      expect(win(m, gx, 3 * TH - 1)).toBe(K.gravel);
    }
  });

  it('rounds the pond: grass fills the corner where two of its sides meet', () => {
    // The pond's top-left tile (1,2) has grass west and north: its very corner is grass, its far side water.
    expect(win(m, TW + 1, 2 * TH + 1)).toBe(K.grass);
    expect(win(m, TW + TW - 2, 2 * TH + TH - 2)).toBe(K.pond);
    // The fillet reaches further in along the diagonal than either straight side spills.
    let side = 0, diagonal = 0;
    while (win(m, TW + side, 2 * TH + TH / 2) === K.grass) side++;
    while (win(m, TW + diagonal, 2 * TH + Math.round(diagonal * TH / TW)) === K.grass) diagonal++;
    expect(diagonal).toBeGreaterThan(Math.min(side, 6));
  });

  it('does not blend across a step in elevation', () => {
    const raised = map([',:'], ['01']);
    expect(spillMask(raised)[1]).toBe(0);
    for (let gy = 0; gy < TH; gy++) expect(win(raised, TW, gy)).toBe(K.gravel);
  });

  it('is a function of world position: neighbouring chunks agree on every pixel', () => {
    const a = [] as number[], b = [] as number[];
    for (let gy = 0; gy < m.height * TH; gy += 3) for (let gx = 0; gx < m.width * TW; gx += 3) { a.push(win(m, gx, gy)); b.push(win(m, gx, gy)); }
    expect(a).toEqual(b);
  });

  it('flags only tiles that a higher soft neighbour at the same height spills onto', () => {
    const mask = spillMask(m);
    expect(mask[0 * 5 + 0]).toBe(0); // grass in a field of grass
    expect(mask[0 * 5 + 3]).toBe(1); // gravel beside grass
    expect(mask[3 * 5 + 4]).toBe(0); // cobbles: gravel stacks lower, nothing spills on them
    expect(mask[2 * 5 + 1]).toBe(1); // the pond
  });
});

describe('cart-road ruts', () => {
  it('run along the road, at a third and two thirds of its width; none at a crossing', () => {
    const roads = map([
      ',,r,,,',
      'rrrrrr',
      'rrrrrr',
      ',,r,,,',
      ',,r,,,',
      ',,r,,,',
    ]);
    const ruts = roadRuts(roads);
    const at = (x: number, y: number) => ruts[y * 6 + x];
    expect(at(0, 1)).toEqual({ axis: 'h', at: [Math.round(TH + 72 * 0.32), Math.round(TH + 72 * 0.68)] });
    expect(at(5, 2)!.axis).toBe('h');
    expect(at(2, 4)).toEqual({ axis: 'v', at: [Math.round(2 * TW + 48 * 0.32), Math.round(2 * TW + 48 * 0.68)] });
    expect(at(0, 0)).toBeNull();
  });
});

describe('baking the ground', () => {
  const m = map([
    ',,,,,,',
    ',,..,,',
    '~~~~~~',
  ]);
  const chunks = bakeBoard(bakeContext(m, { seed: SEED, elevStep: 14, slab: 30 }));
  const c = chunks[0]!;
  const alpha = (buf: Uint8ClampedArray, x: number, y: number) => buf[((y - c.y) * c.w + (x - c.x)) * 4 + 3]!;

  it('bakes land opaque, with holes where the water shows, and the slab below the front row', () => {
    expect(chunks).toHaveLength(1);
    expect(c.h).toBe(3 * TH + 30);
    expect(alpha(c.land, 20, 10)).toBe(255);
    expect(alpha(c.land, 100, 2 * TH + 30)).toBe(0); // open water
    expect(alpha(c.water!, 100, 2 * TH + 30)).toBe(255);
    expect(alpha(c.land, 100, 3 * TH + 10)).toBe(255); // the slab's face
  });

  it('shows a bank face under the land at the water\'s far edge', () => {
    // The first rows of water under the grass are the bank (part of the land layer).
    expect(alpha(c.land, 30, 2 * TH + 1)).toBe(255);
    expect(alpha(c.land, 30, 2 * TH + 20)).toBe(0);
  });

  it('is deterministic', () => {
    const again = bakeBoard(bakeContext(m, { seed: SEED, elevStep: 14, slab: 30 }))[0]!;
    expect(again.land).toEqual(c.land);
    expect(again.foam![0]).toEqual(c.foam![0]);
  });

  it('bakes no water layer where there is no water', () => {
    expect(bakeBoard(bakeContext(map([',,::', '..::']), { seed: 1, elevStep: 14, slab: 30 }))[0]!.water).toBeNull();
  });
});

describe('lit windows', () => {
  /** A cream wall with one dark pane in a white frame, and a slate roof sheet. */
  const W = 40, H = 40;
  const img = new Uint8ClampedArray(W * H * 4);
  const paint = (x0: number, y0: number, w: number, h: number, c: [number, number, number]) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.set([...c, 255], (y * W + x) * 4);
  };
  paint(0, 0, W, H, [222, 204, 170]);
  paint(0, 0, W, 12, [70, 82, 104]); // the roof: one big slate sheet
  paint(9, 19, 10, 12, [246, 244, 236]); // the frame
  paint(10, 20, 8, 10, [52, 66, 96]); // the pane

  it('finds a framed pane and lights it, but not a roof', () => {
    const found = detectWindows(img, W, H);
    expect(found.windows).toBe(1);
    expect(found.rgba[(25 * W + 14) * 4 + 3]).toBe(255);
    expect(found.rgba[(5 * W + 20) * 4 + 3]).toBe(0);
    expect(found.rgba[(35 * W + 5) * 4 + 3]).toBe(0);
  });
});

describe('moving water', () => {
  it('draws a seamless crest pattern per style, the same every time', () => {
    const a = ripplePattern('river-south', 3);
    expect(a.length).toBe(RIPPLE_W * RIPPLE_H * 4);
    expect(a).toEqual(ripplePattern('river-south', 3));
    expect(a).not.toEqual(ripplePattern('sea', 3));
  });

  it('carries a river downstream', () => {
    expect(waterStyle('river', 'east')).toBe('river-east');
    expect(flowVelocity('river-east')[0]).toBeGreaterThan(0);
    expect(flowVelocity('river-west')[0]).toBeLessThan(0);
    expect(flowVelocity('river-south')[1]).toBeGreaterThan(0);
    expect(flowVelocity('river-north')[1]).toBeLessThan(0);
    expect(waterStyle('grass')).toBeNull();
  });
});
