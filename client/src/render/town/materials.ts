// Ground materials for the town (GDD §16.1: Stardew-style pixel art, warm bright palette, clean dithering).
// Pure: no Phaser, no DOM.
//
// Each kind is a seamless periodic texture (MAT_W × MAT_H world px, 8 × 8 tiles) drawn once, pixel by pixel,
// in a handful of colours: cobbles as Voronoi stones with mortar and a lit upper edge, brick in running bond,
// flagstones, planks with gaps and nails, tilled soil, speckled gravel and sand, grass with patches and
// blades, meadow flowers. The bake (terrainBake.ts) samples them by world position and lays a slow,
// non-periodic brightness drift over the top so a square of cobbles never visibly repeats.
// Colours are packed 0xRRGGBB.

import { TOWN_TERRAINS, type TownTerrain } from '../../world/townTerrain';
import { hash01 } from './autotile';

export const MAT_W = 384;
export const MAT_H = 288;

/** Ordered-dither threshold for a pixel, in [0, 1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
export const bayer = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)]!;

export function shade(c: number, f: number): number {
  let r = (((c >> 16) & 0xff) * f + 0.5) | 0, g = (((c >> 8) & 0xff) * f + 0.5) | 0, b = ((c & 0xff) * f + 0.5) | 0;
  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
  return (r << 16) | (g << 8) | b;
}
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  return ((ar + (((b >> 16) & 0xff) - ar) * t + 0.5) << 16) | ((ag + (((b >> 8) & 0xff) - ag) * t + 0.5) << 8) | ((ab + ((b & 0xff) - ab) * t + 0.5) | 0);
}

/** Periodic value noise: lattice `cw × ch` px, wrapping over the material period. */
function pnoise(x: number, y: number, cw: number, ch: number, seed: number): number {
  const nx = MAT_W / cw, ny = MAT_H / ch;
  const fx = x / cw, fy = y / ch;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const i0 = ((x0 % nx) + nx) % nx, i1 = (i0 + 1) % nx, j0 = ((y0 % ny) + ny) % ny, j1 = (j0 + 1) % ny;
  const a = hash01(i0, j0, seed), b = hash01(i1, j0, seed), c = hash01(i0, j1, seed), d = hash01(i1, j1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The palette, warm and bright (sampled from art_sources/style_bible_v2/gameplay_mockup.png and the sprites). */
export const PAL = {
  grass: [0x56903a, 0x619b40, 0x6ca547, 0x84b957] as const,
  grassBlade: 0x44792e,
  grassTip: 0x8fc15c,
  grassEdge: 0x2f5f26,
  flowers: [0xfff6e0, 0xffd94a, 0xf28fb0, 0x8fb4f0, 0xc69bea, 0xff9f5a] as const,
  cobble: [0xd8b490, 0xe4c09c, 0xcca884, 0xc4a07e, 0xdcb898, 0xd0ac8a] as const,
  mortar: 0x9c8472,
  mortarDark: 0x84705e,
  brick: [0xb45c3e, 0xa85238, 0xbe6848, 0x9e4c34, 0xb86444] as const,
  brickMortar: 0x8a6a56,
  plaza: [0xe6d6b4, 0xdccaa6, 0xeadcbe, 0xd4c29e] as const,
  plazaSeam: 0xb09c80,
  gravel: 0xccb48c,
  gravelSpecks: [0xa89070, 0xe2d0ac, 0x8e7c64, 0xbca47e, 0xf0e2c4] as const,
  road: [0xb08a5c, 0xa88254, 0xb89464] as const,
  roadSpecks: [0x8e6c46, 0xc8a676, 0x9a7a52] as const,
  sand: [0xecd8a4, 0xe6d09a, 0xf2e0b4] as const,
  sandDark: 0xd6be8a,
  shingle: 0x958a80,
  pebbles: [0xbab2a6, 0x8a8078, 0xcac2b6, 0x7a7068, 0xa89c8c, 0xd8d0c4] as const,
  wetSand: [0xcdbb94, 0xc4b18a, 0xd4c39e] as const,
  wetSheen: 0xe4d8b8,
  soil: 0x6e4a2e,
  soilRidge: 0x86593a,
  soilTrench: 0x52361f,
  boards: [0xae7a42, 0xa0703a, 0xb88448, 0x9a6834, 0xa47440] as const,
  boardGap: 0x4a3018,
  nail: 0x3a2a1a,
  stepTop: [0xd6cab4, 0xccc0a8, 0xdcd0bc] as const,
  stepRiser: 0x8e8272,
  weedy: [0x8c8a78, 0x7e7e6c, 0x969480] as const,
  moss: [0x5e7a3a, 0x6e8c44, 0x52703a] as const
};

type Gen = (x: number, y: number) => number;

/** Jittered-grid Voronoi on the period: nearest two feature points and the nearest cell's id. */
function voronoi(x: number, y: number, cw: number, ch: number, seed: number, jitter = 0.8): { d1: number; d2: number; cell: number; cx: number; cy: number } {
  const nx = MAT_W / cw, ny = MAT_H / ch;
  const gx = Math.floor(x / cw), gy = Math.floor(y / ch);
  let d1 = Infinity, d2 = Infinity, cell = 0, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const ci = gx + i, cj = gy + j;
    const wi = ((ci % nx) + nx) % nx, wj = ((cj % ny) + ny) % ny;
    // Rows of stones shift half a stone, like a laid street.
    const shift = (wj & 1) * 0.5;
    const px = (ci + shift + 0.5 + (hash01(wi, wj, seed) - 0.5) * jitter * 0.6) * cw;
    const py = (cj + 0.5 + (hash01(wi, wj, seed + 1) - 0.5) * jitter * 0.5) * ch;
    const d = Math.hypot((x - px) / cw, (y - py) / ch);
    if (d < d1) { d2 = d1; d1 = d; cell = wj * nx + wi; cx = px; cy = py; } else if (d < d2) d2 = d;
  }
  return { d1, d2, cell, cx, cy };
}

const GENERATORS: Partial<Record<TownTerrain, Gen>> = {
  grass(x, y) {
    // Patches of three greens, dithered at their borders; short dark blades with a lit tip.
    const n = pnoise(x, y, 24, 18, 11) * 0.6 + pnoise(x, y, 8, 6, 12) * 0.4;
    const t = n * 3 - 0.5 + (bayer(x, y) - 0.5) * 0.9;
    let c: number = PAL.grass[Math.max(0, Math.min(2, Math.floor(t)))]!;
    const bx = Math.floor(x / 4), by = Math.floor(y / 6);
    const h = hash01(bx % 96, by % 48, 13);
    if (h < 0.62) {
      const ox = Math.floor(hash01(bx % 96, by % 48, 14) * 3), oy = Math.floor(hash01(bx % 96, by % 48, 15) * 3);
      const lx = x - bx * 4, ly = y - by * 6;
      // A tuft: a dark blade, a shorter one leaning beside it, and now and then a lit tip.
      if (lx === ox && ly >= oy + 1 && ly <= oy + 3) c = PAL.grassBlade;
      else if (lx === ox + 1 && ly >= oy + 2 && ly <= oy + 3 && h < 0.4) c = PAL.grassBlade;
      else if (lx === ox && ly === oy && h < 0.25) c = PAL.grassTip;
    }
    if (hash01(x, y, 16) < 0.012) c = PAL.grass[3];
    return c;
  },
  meadow(x, y) {
    // The lawn itself (the grass's own patches and blades), with wildflowers through it.
    let c = GENERATORS.grass!(x, y);
    // Flower clusters: a coloured cross with a yellow eye, one per lucky 7×6 cell.
    const fx = Math.floor(x / 8), fy = Math.floor(y / 6);
    const wx = ((fx % 48) + 48) % 48, wy = ((fy % 48) + 48) % 48;
    const h = hash01(wx, wy, 22);
    const lx = x - fx * 8, ly = y - fy * 6;
    if (h < 0.45) {
      const cx = 2 + Math.floor(hash01(wx, wy, 23) * 4), cy = 2 + Math.floor(hash01(wx, wy, 24) * 2);
      const petal = PAL.flowers[Math.floor(hash01(wx, wy, 25) * PAL.flowers.length)]!;
      const dx = lx - cx, dy = ly - cy;
      if (!dx && !dy) c = petal === 0xffd94a ? 0xfff6e0 : 0xffd94a;
      else if (Math.abs(dx) + Math.abs(dy) === 1) c = petal;
      else if (dx === 0 && dy === 2) c = PAL.grassBlade;
    } else if (h < 0.75) {
      const ox = Math.floor(hash01(wx, wy, 26) * 7);
      if (lx === ox && ly >= 2 && ly <= 4) c = PAL.grassBlade;
    }
    return c;
  },
  cobble(x, y) {
    const v = voronoi(x, y, 12, 9, 31);
    const edge = v.d2 - v.d1;
    if (edge < 0.11) return edge < 0.05 ? PAL.mortarDark : PAL.mortar;
    let c: number = PAL.cobble[Math.floor(hash01(v.cell, 0, 32) * PAL.cobble.length)]!;
    // Lit from above-left: brighter on the stone's upper rim, darker toward its foot.
    const up = (v.cy - y) / 9, left = (v.cx - x) / 12;
    if (edge < 0.24 && up + left * 0.5 > 0.12) c = shade(c, 1.09);
    else if (edge < 0.22 && up < -0.15) c = shade(c, 0.88);
    if (hash01(x, y, 33) < 0.04) c = shade(c, 0.93);
    return c;
  },
  brick(x, y) {
    const row = Math.floor(y / 6), ly = y - row * 6;
    const off = (row & 1) * 6;
    const col = Math.floor((x + off) / 12), lx = x + off - col * 12;
    if (ly === 5 || lx === 11) return PAL.brickMortar;
    let c: number = PAL.brick[Math.floor(hash01(((col % 32) + 32) % 32, row % 48, 41) * PAL.brick.length)]!;
    if (ly === 0) c = shade(c, 1.1);
    else if (ly === 4) c = shade(c, 0.9);
    if (hash01(x, y, 42) < 0.05) c = shade(c, 0.94);
    return c;
  },
  plaza(x, y) {
    const row = Math.floor(y / 18), ly = y - row * 18;
    const off = (row & 1) * 12;
    const col = Math.floor((x + off) / 24), lx = x + off - col * 24;
    if (ly === 17 || lx === 23) return PAL.plazaSeam;
    let c: number = PAL.plaza[Math.floor(hash01(((col % 16) + 16) % 16, row % 16, 51) * PAL.plaza.length)]!;
    if (ly === 0 || lx === 0) c = shade(c, 1.05);
    const n = pnoise(x, y, 6, 6, 52);
    if (n > 0.72 && bayer(x, y) < 0.5) c = shade(c, 0.95);
    if (hash01(x, y, 53) < 0.03) c = shade(c, 0.92);
    return c;
  },
  gravel(x, y) {
    let c: number = PAL.gravel;
    const h = hash01(x, y, 61);
    if (h < 0.3) c = PAL.gravelSpecks[Math.floor(hash01(x, y, 62) * PAL.gravelSpecks.length)]!;
    // A few 2 px pebbles with a lit top.
    const px = Math.floor(x / 6), py = Math.floor(y / 4);
    const ph = hash01(px % 64, py % 72, 63);
    if (ph < 0.3) {
      const lx = x - px * 6, ly = y - py * 4;
      if (lx >= 1 && lx <= 2 && ly >= 1 && ly <= 2) c = ly === 1 ? 0xe8d8b8 : 0x9a8668;
    }
    return c;
  },
  road(x, y) {
    const n = pnoise(x, y, 16, 12, 71);
    let c: number = PAL.road[Math.max(0, Math.min(2, Math.floor(n * 3 + (bayer(x, y) - 0.5) * 0.6)))]!;
    const h = hash01(x, y, 72);
    if (h < 0.08) c = PAL.roadSpecks[Math.floor(hash01(x, y, 73) * PAL.roadSpecks.length)]!;
    return c;
  },
  sand(x, y) {
    let c: number = PAL.sand[Math.max(0, Math.min(2, Math.floor(pnoise(x, y, 16, 12, 81) * 3 + (bayer(x, y) - 0.5) * 0.5)))]!;
    // Wind ripples: short wavy darker lines.
    const wave = (y + 9 + Math.round(Math.sin((x * Math.PI * 80) / MAT_W) * 1.5 + pnoise(x, y, 32, 24, 82) * 3)) % 9;
    if (wave === 0 && pnoise(x, y, 12, 9, 83) > 0.45) c = PAL.sandDark;
    if (hash01(x, y, 84) < 0.04) c = 0xf8ecc8;
    return c;
  },
  shingle(x, y) {
    const v = voronoi(x, y, 6, 4, 91, 1);
    if (v.d1 > 0.42) return shade(PAL.shingle, 0.9);
    let c: number = PAL.pebbles[Math.floor(hash01(v.cell, 0, 92) * PAL.pebbles.length)]!;
    if (y < v.cy - 0.5 && v.d1 < 0.35) c = shade(c, 1.12);
    return c;
  },
  wet_sand(x, y) {
    let c: number = PAL.wetSand[Math.max(0, Math.min(2, Math.floor(pnoise(x, y, 16, 12, 101) * 3 + (bayer(x, y) - 0.5) * 0.5)))]!;
    if ((y % 8) === 0 && pnoise(x, y, 12, 8, 102) > 0.55) c = PAL.wetSheen;
    return c;
  },
  soil(x, y) {
    // Tilled rows: a lit ridge, the earth, a dark trench.
    const ly = y % 6;
    let c = ly < 2 ? PAL.soilRidge : ly === 5 ? PAL.soilTrench : PAL.soil;
    if (ly === 0 && hash01(x, y, 111) < 0.3) c = shade(PAL.soilRidge, 1.08);
    if (hash01(x, y, 112) < 0.05) c = PAL.soilTrench;
    return c;
  },
  boards(x, y) {
    const row = Math.floor(y / 8), ly = y - row * 8;
    if (ly === 7) return PAL.boardGap;
    // Planks of uneven length (each divides the period), joints staggered row to row.
    const len = [48, 64, 96][Math.floor(hash01(row, 0, 121) * 3)]!;
    const off = Math.floor(hash01(row, 1, 122) * len);
    const col = Math.floor((x + off) / len), lx = (x + off) - col * len;
    if (lx === 0) return PAL.boardGap;
    let c: number = PAL.boards[Math.floor(hash01(col % (MAT_W / len), row, 123) * PAL.boards.length)]!;
    if (ly === 0) c = shade(c, 1.1);
    else if (ly === 6) c = shade(c, 0.86);
    // Grain and nails.
    if (ly > 0 && ly < 6 && pnoise(x, y, 24, 2, 124) > 0.78) c = shade(c, 0.9);
    if ((lx === 3 || lx === len - 4) && (ly === 1 || ly === 5)) c = PAL.nail;
    return c;
  },
  steps(x, y) {
    const ly = y % 12;
    if (ly >= 9) return ly === 9 ? shade(PAL.stepRiser, 0.85) : PAL.stepRiser;
    const sx = x + (Math.floor(y / 12) & 1) * 12;
    const col = Math.floor(sx / 24);
    let c: number = PAL.stepTop[Math.floor(hash01(col % 16, Math.floor(y / 12) % 24, 131) * PAL.stepTop.length)]!;
    if (ly === 0) c = shade(c, 1.07);
    if (sx % 24 === 0) c = shade(c, 0.85);
    return c;
  },
  weedy(x, y) {
    const row = Math.floor(y / 12), off = (row & 1) * 8;
    const col = Math.floor((x + off) / 16);
    if (y % 12 === 11 || (x + off) % 16 === 15) return 0x5e5c50;
    let c: number = PAL.weedy[Math.floor(hash01(col % 24, row % 24, 141) * PAL.weedy.length)]!;
    const m = pnoise(x, y, 12, 9, 142);
    if (m + (bayer(x, y) - 0.5) * 0.25 > 0.55) c = PAL.moss[Math.floor(hash01(x, y, 143) * PAL.moss.length)]!;
    return c;
  }
};

const cache = new Map<TownTerrain, Uint32Array>();

/** The periodic texture for a land kind (water kinds have none: the water layer colours them). */
export function material(kind: TownTerrain): Uint32Array {
  let m = cache.get(kind);
  if (m) return m;
  const gen = GENERATORS[kind] ?? GENERATORS.grass!;
  m = new Uint32Array(MAT_W * MAT_H);
  for (let y = 0; y < MAT_H; y++) for (let x = 0; x < MAT_W; x++) m[y * MAT_W + x] = gen(x, y);
  cache.set(kind, m);
  return m;
}

/** The land kinds' materials by kind id (null for water and for kinds not in `used`, a set of kind ids). */
export function materials(used?: ReadonlySet<number>): (Uint32Array | null)[] {
  return TOWN_TERRAINS.map((k, i) => (GENERATORS[k] && (!used || used.has(i)) ? material(k) : null));
}
