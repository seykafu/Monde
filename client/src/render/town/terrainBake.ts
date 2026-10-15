// Bakes the town's ground into pixel buffers, one chunk of tiles at a time (GDD §16.4). Pure: no Phaser, no
// DOM; render/town/TownBoard.ts uploads the buffers as textures.
//
// Per chunk, three layers in world px (screen space at the board's scale, elevation already applied):
//
//   water  the water's floor colour: light at the shore, deepening with distance from land, dithered bands
//   foam   two broken lines of foam at every waterline (phase A and B; the board cross-fades them, so the
//          surf laps)
//   land   everything else, opaque, with holes where water shows through: the ground materials, the
//          autotiled edges (a dark lip under grass, a lit rim on top, a shadow cast on the path below, kerbs
//          on paved edges, plank borders round garden beds, ruts down the cart road), the bank of earth,
//          quay stone or pier timber you see above the water's far edge, and the front faces of raised
//          tiles and of the slab the board stands on.
//
// The animated ripples go between water and land (TownWater.ts), so the bank and the lips cover them.

import type { TownTerrain } from '../../world/townTerrain';
import { FAMILY, IS_WATER, KIND_ID, KIND_OF, LAYER, SOFT, TH, TW, edgeNoise, hash01, roadRuts, spillMask, vnoise, winnerAt, type GroundMap, type Ruts } from './autotile';
import { MAT_H, MAT_W, PAL, bayer, materials, mix, shade } from './materials';
import { TERRAIN_INFO } from '../../world/townTerrain';

export interface BakeOptions {
  seed: number;
  /** World px per elevation level. */
  elevStep: number;
  /** The slab under the board's front row, world px. */
  slab: number;
}

export interface BakedChunk {
  /** World px of the buffers' top-left, and their size. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The tile rows it covers (for depth). */
  row0: number;
  row1: number;
  land: Uint8ClampedArray;
  /** Null when the chunk has no water. */
  water: Uint8ClampedArray | null;
  foam: [Uint8ClampedArray, Uint8ClampedArray] | null;
}

export interface BakeContext {
  map: GroundMap;
  opts: BakeOptions;
  mask: Uint8Array;
  ruts: (Ruts | null)[];
  mats: (Uint32Array | null)[];
}

export const bakeContext = (map: GroundMap, opts: BakeOptions): BakeContext =>
  ({ map, opts, mask: spillMask(map), ruts: roadRuts(map), mats: materials(new Set(map.kinds)) });
const id = (k: TownTerrain) => KIND_ID[k];
const K = {
  grass: id('grass'), meadow: id('meadow'), cobble: id('cobble'), brick: id('brick'), plaza: id('plaza'), road: id('road'),
  soil: id('soil'), boards: id('boards'), steps: id('steps'), weedy: id('weedy'), sand: id('sand'), wet: id('wet_sand'),
  shingle: id('shingle'), sea: id('sea'), river: id('river'), pond: id('pond'), shallows: id('shallows'), gravel: id('gravel')
};
const PAVED = new Set([K.cobble, K.brick, K.plaza]);
/** Beaches slope into the water: no bank face above them, just surf. */
const BEACH = new Set([K.sand, K.wet, K.shingle, K.shallows]);
type Face = 'earth' | 'stone' | 'timber' | 'sand';
const faceOf = (k: number): Face =>
  k === K.boards ? 'timber' : PAVED.has(k) || k === K.steps || k === K.weedy ? 'stone' : k === K.sand || k === K.wet || k === K.shingle ? 'sand' : 'earth';

/** Rows of bank face showing above the water, by the land's material. */
const BANK_H: Readonly<Record<Face, number>> = { earth: 9, stone: 9, timber: 10, sand: 0 };
/** Margin of ground px computed around a chunk: edges look one px out, the water's depth up to 28. */
const MARGIN = 30;
const DEPTH_CAP = 40;

/** Water palettes, shore to deep, with the distances (px) where each band starts. */
const WATER: Readonly<Record<number, { cols: readonly number[]; at: readonly number[]; foam: number }>> = {
  [K.sea]: { cols: [0x6ccadc, 0x47aad6, 0x318ec8, 0x2676b8], at: [3, 11, 26], foam: 5 },
  [K.river]: { cols: [0x6cbed8, 0x4aa2d2, 0x3a8cc6], at: [3, 9], foam: 2.5 },
  [K.pond]: { cols: [0x7fc4b4, 0x5eacac, 0x4a96a2], at: [3, 10], foam: 2 },
  [K.shallows]: { cols: [0xa2e0d4, 0x86d2d2, 0x6cc4d2], at: [3, 9], foam: 4 }
};

const FOAM_RGB = 0xf2fbff;

function put(buf: Uint8ClampedArray, i: number, c: number, a = 255): void {
  buf[i] = (c >> 16) & 0xff; buf[i + 1] = (c >> 8) & 0xff; buf[i + 2] = c & 0xff; buf[i + 3] = a;
}

/** The bank face above water: row r (0 at the land's edge) of a face of material `face`. */
function bankColour(face: Face, r: number, gx: number, gy: number): number {
  const h = BANK_H[face];
  const wet = r >= h - 2;
  switch (face) {
    case 'stone': {
      if (r === 0) return 0xeadfc8;
      const course = Math.floor((r - 1) / 4), lr = (r - 1) % 4;
      const off = (course & 1) * 7;
      const joint = (gx + off) % 14 === 0;
      if (lr === 3 || joint) return wet ? 0x3e4640 : 0x6e6252;
      let c: number = mix(0xb0a084, 0x7a6e5e, r / h);
      if (hash01(Math.floor((gx + off) / 14), Math.floor(gy / 4) + course, 7) < 0.3) c = shade(c, 0.92);
      if (wet) c = hash01(gx, gy, 8) < 0.45 ? 0x4e6a3a : mix(c, 0x3e4a44, 0.5);
      return c;
    }
    case 'timber': {
      if (r === 0) return 0x2c1c10;
      const post = ((gx % 24) + 24) % 24 < 4;
      let c = post ? mix(0x765232, 0x4a321e, r / h) : mix(0x4e3420, 0x2e2016, r / h);
      if (post && ((gx % 24) + 24) % 24 === 0) c = shade(c, 1.2);
      if (wet) c = mix(c, 0x23302e, 0.5);
      return c;
    }
    default: {
      if (r === 0) return 0x3a2a1c;
      let c: number = mix(0x82603e, 0x5a3e26, r / h);
      const s = hash01(gx, gy, 9);
      if (s < 0.08) c = 0x9a8a74; else if (s < 0.14) c = 0x46301c;
      if (wet) c = r === h - 1 ? 0x2e3c42 : 0x3c3632;
      return c;
    }
  }
}

/** A raised tile's front face (or the slab), row r of fh. */
function faceColour(face: Face, r: number, fh: number, gx: number): number {
  const t = r / Math.max(1, fh);
  switch (face) {
    case 'stone': {
      const course = Math.floor(r / 5), lr = r % 5;
      if (lr === 4 || (gx + (course & 1) * 8) % 16 === 0) return mix(0x7a6c5a, 0x4a4036, t);
      return mix(0xb4a488, 0x6e6252, t);
    }
    case 'timber':
      return ((gx % 24) + 24) % 24 < 4 ? mix(0x7a5636, 0x40301e, t) : mix(0x5a3c24, 0x2e2016, t);
    case 'sand':
      return mix(0xd2b680, 0x9a8058, t);
    default: {
      const strata = r === Math.round(fh * 0.4) || r === Math.round(fh * 0.75);
      const c = mix(0x8a6440, 0x4a3420, t);
      return strata ? shade(c, 0.8) : hash01(gx, r, 5) < 0.06 ? 0x9a8a74 : c;
    }
  }
}

/** Bake the tiles [tx0, tx1) × [ty0, ty1). */
export function bakeChunk(ctx: BakeContext, tx0: number, ty0: number, tx1: number, ty1: number): BakedChunk {
  const { map, opts, mask, ruts, mats } = ctx;
  const seed = opts.seed;
  const step = opts.elevStep;
  const elev = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? 0 : map.elevs[y * map.width + x]!);
  const faceH = (x: number, y: number) => (y === map.height - 1 ? elev(x, y) * step + opts.slab : Math.max(0, elev(x, y) - elev(x, y + 1)) * step);

  // Screen extent: raised tops poke up, faces and the slab hang down.
  let top = Infinity, bottom = -Infinity;
  for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) {
    const sy = y * TH - elev(x, y) * step;
    top = Math.min(top, sy);
    bottom = Math.max(bottom, sy + TH + faceH(x, y));
  }
  const X = tx0 * TW, Y = top, W = (tx1 - tx0) * TW, H = bottom - top;

  // Ground winners with a margin: wide where there is water near (its depth looks 30 px out), else a hair.
  let wet = false;
  for (let y = Math.max(0, ty0 - 1); y < Math.min(map.height, ty1 + 1) && !wet; y++) for (let x = Math.max(0, tx0 - 1); x < Math.min(map.width, tx1 + 1); x++) if (IS_WATER[map.kinds[y * map.width + x]!]) { wet = true; break; }
  const margin = wet ? MARGIN : 3;
  const gx0 = tx0 * TW - margin, gy0 = ty0 * TH - margin;
  const GW = (tx1 - tx0) * TW + margin * 2, GH = (ty1 - ty0) * TH + margin * 2;
  const win = new Uint8Array(GW * GH);
  // Tile by tile: a tile nobody spills onto is all its own kind.
  for (let ty = Math.floor(gy0 / TH); ty * TH < gy0 + GH; ty++) for (let tx = Math.floor(gx0 / TW); tx * TW < gx0 + GW; tx++) {
    const cx = Math.min(map.width - 1, Math.max(0, tx)), cy = Math.min(map.height - 1, Math.max(0, ty));
    const ti = cy * map.width + cx;
    const i0 = Math.max(0, tx * TW - gx0), i1 = Math.min(GW, (tx + 1) * TW - gx0);
    const j0 = Math.max(0, ty * TH - gy0), j1 = Math.min(GH, (ty + 1) * TH - gy0);
    if (!mask[ti]) {
      const k = map.kinds[ti]!;
      for (let j = j0; j < j1; j++) win.fill(k, j * GW + i0, j * GW + i1);
    } else {
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) win[j * GW + i] = winnerAt(map, mask, gx0 + i, gy0 + j, seed);
    }
  }
  let anyWater = false;
  for (let n = 0; n < win.length && !anyWater; n++) anyWater = IS_WATER[win[n]!]!;
  // The slow brightness drift, sampled every 8 px and blended.
  const DS = 8, DW = Math.ceil(GW / DS) + 2, DH = Math.ceil(GH / DS) + 2;
  const driftGrid = new Float32Array(DW * DH);
  for (let j = 0; j < DH; j++) for (let i = 0; i < DW; i++) {
    const x = gx0 + i * DS, y = gy0 + j * DS;
    driftGrid[j * DW + i] = vnoise(x / 150, y / 110, seed + 21) * 0.7 + vnoise(x / 53, y / 41, seed + 22) * 0.3;
  }
  const drift = (gx: number, gy: number): number => {
    const fx = (gx - gx0) / DS, fy = (gy - gy0) / DS;
    const i = fx | 0, j = fy | 0, ax = fx - i, ay = fy - j, n = j * DW + i;
    const a = driftGrid[n]!, b = driftGrid[n + 1]!, c = driftGrid[n + DW]!, d = driftGrid[n + DW + 1]!;
    const v = a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay;
    const step = Math.max(0, Math.min(2, Math.floor(v * 3 + (bayer(gx, gy) - 0.5) * 0.7)));
    return 0.95 + step * 0.04;
  };

  // Bank faces and water depth.
  let bank: Uint8Array | null = null, bankFace: Uint8Array | null = null, depth: Float32Array | null = null;
  if (anyWater) {
    bank = new Uint8Array(GW * GH); bankFace = new Uint8Array(GW * GH);
    for (let i = 0; i < GW; i++) {
      let run = 0, face: Face = 'sand', banked = false;
      for (let j = 0; j < GH; j++) {
        const k = win[j * GW + i]!;
        if (!IS_WATER[k]) { banked = !BEACH.has(k); face = faceOf(k); run = 0; continue; }
        run++;
        if (banked && run <= BANK_H[face]) { bank[j * GW + i] = run; bankFace[j * GW + i] = face === 'stone' ? 1 : face === 'timber' ? 2 : 0; }
        else banked = false;
      }
    }
    // Chamfer distance from land (and bank faces) for every water pixel.
    depth = new Float32Array(GW * GH);
    for (let n = 0; n < GW * GH; n++) depth[n] = IS_WATER[win[n]!] && !bank[n] ? DEPTH_CAP : 0;
    const D = 1.4142;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const n = j * GW + i;
      let d = depth[n]!;
      if (d === 0) continue;
      if (i > 0) d = Math.min(d, depth[n - 1]! + 1);
      if (j > 0) {
        d = Math.min(d, depth[n - GW]! + 1);
        if (i > 0) d = Math.min(d, depth[n - GW - 1]! + D);
        if (i < GW - 1) d = Math.min(d, depth[n - GW + 1]! + D);
      }
      depth[n] = d;
    }
    for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) {
      const n = j * GW + i;
      let d = depth[n]!;
      if (d === 0) continue;
      if (i < GW - 1) d = Math.min(d, depth[n + 1]! + 1);
      if (j < GH - 1) {
        d = Math.min(d, depth[n + GW]! + 1);
        if (i < GW - 1) d = Math.min(d, depth[n + GW + 1]! + D);
        if (i > 0) d = Math.min(d, depth[n + GW - 1]! + D);
      }
      depth[n] = d;
    }
  }

  const land = new Uint8ClampedArray(W * H * 4);
  const water = anyWater ? new Uint8ClampedArray(W * H * 4) : null;
  const foamA = anyWater ? new Uint8ClampedArray(W * H * 4) : null;
  const foamB = anyWater ? new Uint8ClampedArray(W * H * 4) : null;

  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      const sx0 = tx * TW - X, sy0 = ty * TH - elev(tx, ty) * step - Y;
      const own = map.kinds[ty * map.width + tx]!;
      const r = own === K.road ? ruts[ty * map.width + tx] : null;
      const nW = tx > 0 ? map.kinds[ty * map.width + tx - 1]! : own, nE = tx < map.width - 1 ? map.kinds[ty * map.width + tx + 1]! : own;
      const nN = ty > 0 ? map.kinds[(ty - 1) * map.width + tx]! : own, nS = ty < map.height - 1 ? map.kinds[(ty + 1) * map.width + tx]! : own;
      const kerb = (n: number) => !PAVED.has(n) && LAYER[n]! < LAYER[own]! && !IS_WATER[n];
      const kerbW = kerb(nW), kerbE = kerb(nE), kerbN = kerb(nN), kerbS = kerb(nS);
      for (let v = 0; v < TH; v++) {
        const sy = sy0 + v;
        if (sy < 0 || sy >= H) continue;
        for (let u = 0; u < TW; u++) {
          const gx = tx * TW + u, gy = ty * TH + v;
          const gi = (gy - gy0) * GW + (gx - gx0);
          const k = win[gi]!;
          const o = (sy * W + sx0 + u) * 4;
          if (IS_WATER[k]) {
            const b = bank![gi]!;
            if (b) { put(land, o, bankColour(bankFace![gi] === 1 ? 'stone' : bankFace![gi] === 2 ? 'timber' : 'earth', b - 1, gx, gy)); continue; }
            const pal = WATER[k] ?? WATER[K.sea]!;
            const d = depth![gi]!;
            const dith = d + (bayer(gx, gy) - 0.5) * 2.5;
            let band = 0;
            while (band < pal.at.length && dith >= pal.at[band]!) band++;
            let c = pal.cols[band]!;
            if (band >= 2 && vnoise(gx / 46, gy / 18, seed + 3) > 0.68 && bayer(gx, gy) < 0.6) c = shade(c, 0.94);
            // The bank shades the water at its foot.
            for (let up = 1; up <= 3; up++) if (bank![gi - up * GW]) { c = shade(c, 0.78 + up * 0.04); break; }
            put(water!, o, c);
            if (d <= pal.foam) {
              const near = d <= 1.5;
              const t = 0.22 + (d / pal.foam) * 0.55;
              if (vnoise(gx / 3.1, gy / 2.2, seed + 11) > t || (near && hash01(gx, gy, seed + 12) < 0.5)) put(foamA!, o, FOAM_RGB, near ? 235 : 170);
              if (vnoise(gx / 3.1 + 17.3, gy / 2.2 + 5.1, seed + 13) > t || (near && hash01(gx, gy, seed + 14) < 0.5)) put(foamB!, o, FOAM_RGB, near ? 235 : 170);
            }
            continue;
          }
          const mat = mats[k]!;
          let c = mat[(gy % MAT_H) * MAT_W + (gx % MAT_W)]!;
          c = shade(c, drift(gx, gy));
          // Ruts down the cart road.
          if (r && k === K.road) {
            const along = r.axis === 'h' ? gy : gx;
            for (const at of r.at) {
              const d = along - at;
              if (d === 0 || d === 1) c = shade(c, 0.8);
              else if (d === -1) c = shade(c, 1.06);
              else if (d === 2) c = shade(c, 0.92);
            }
          }
          const up = win[gi - GW]!, down = win[gi + GW]!, left = win[gi - 1]!, right = win[gi + 1]!;
          const fam = FAMILY[k]!, lk = LAYER[k]!;
          if (SOFT[k]) {
            if (LAYER[down]! < lk && FAMILY[down] !== fam) c = k === K.grass || k === K.meadow ? PAL.grassEdge : shade(c, 0.74);
            else if (LAYER[up]! < lk && FAMILY[up] !== fam) c = shade(c, 1.12);
            else if ((LAYER[left]! < lk && FAMILY[left] !== fam) || (LAYER[right]! < lk && FAMILY[right] !== fam)) c = shade(c, 0.84);
          } else if (k === K.soil) {
            // A plank border round the bed.
            const edge = (nW !== K.soil && u < 3) || (nE !== K.soil && u >= TW - 3) || (nN !== K.soil && v < 3) || (nS !== K.soil && v >= TH - 3);
            if (edge) {
              const ring = Math.min(nW !== K.soil ? u : 9, nE !== K.soil ? TW - 1 - u : 9, nN !== K.soil ? v : 9, nS !== K.soil ? TH - 1 - v : 9);
              c = ring === 0 ? 0x5a3c22 : ring === 1 ? 0xa67a46 : 0x8a6236;
              if (ring === 1 && hash01(gx >> 3, gy >> 3, 15) < 0.2) c = 0x7a5430;
            }
          } else if (PAVED.has(k)) {
            // Kerbs where paving meets lower, softer ground; a lit rim along a quay edge.
            const ring = Math.min(kerbW ? u : 9, kerbE ? TW - 1 - u : 9, kerbN ? v : 9, kerbS ? TH - 1 - v : 9);
            if (ring === 0) c = 0x8e8270; else if (ring === 1) c = 0xd2c6ae; else if (ring === 2) c = 0xc4b89e;
            if (IS_WATER[nS] && v === TH - 1) c = 0xf0e6d0;
          } else if (k === K.boards) {
            if ((u === 0 && nW !== K.boards && !IS_WATER[nW]) || (u === TW - 1 && nE !== K.boards && !IS_WATER[nE])) c = PAL.boardGap;
            if ((IS_WATER[nW] && u === 0) || (IS_WATER[nE] && u === TW - 1)) c = 0x3a2414;
          }
          // The shadow a soft lip throws on the ground below it.
          const up2 = win[gi - 2 * GW]!;
          if (LAYER[up]! > LAYER[k]! && SOFT[up] && FAMILY[up] !== fam) c = shade(c, 0.76);
          else if (LAYER[up2]! > LAYER[k]! && SOFT[up2] && FAMILY[up2] !== fam) c = shade(c, 0.9);
          put(land, o, c);
        }
      }
      // The face this tile shows above the tile in front (or the slab under the front row).
      const fh = faceH(tx, ty);
      if (fh > 0) {
        const face = IS_WATER[own] ? 'stone' : faceOf(own);
        const lipped = own === K.grass || own === K.meadow;
        for (let rr = 0; rr < fh; rr++) {
          const sy = sy0 + TH + rr;
          if (sy < 0 || sy >= H) continue;
          for (let u = 0; u < TW; u++) {
            const gx = tx * TW + u;
            let c = faceColour(face, rr, fh, gx);
            // Turf hangs a ragged pixel or two over the edge.
            if (lipped && rr < 3 && rr < 1 + Math.floor((edgeNoise(gx, ty, seed) + 1) * 1.2)) c = rr === 0 ? PAL.grass[0] : PAL.grassEdge;
            put(land, (sy * W + sx0 + u) * 4, c);
          }
        }
      }
    }
  }
  return { x: X, y: Y, w: W, h: H, row0: ty0, row1: ty1, land, water, foam: foamA && foamB ? [foamA, foamB] : null };
}

/** Chunks for the whole board, row-major. */
export function bakeBoard(ctx: BakeContext, cols = 16, rows = 10): BakedChunk[] {
  const out: BakedChunk[] = [];
  for (let y = 0; y < ctx.map.height; y += rows) for (let x = 0; x < ctx.map.width; x += cols) {
    out.push(bakeChunk(ctx, x, y, Math.min(ctx.map.width, x + cols), Math.min(ctx.map.height, y + rows)));
  }
  return out;
}

/** The water kind (if any) drawn at a tile, for the ripple layer. */
export const waterKind = (k: TownTerrain): TownTerrain | null => (TERRAIN_INFO[k].water ? k : null);
export { KIND_OF };
