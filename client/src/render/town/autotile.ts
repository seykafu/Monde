// Autotiling for the town's ground (GDD §16.4). Pure: no Phaser, no DOM.
//
// No hand-drawn 47-tile blob sets: every ground pixel asks which kind covers it. A tile is its own kind,
// except near an edge, where a neighbour that stacks higher (townTerrain.ts `layer`) and has a soft edge
// spills over by a few ragged pixels: grass over the lane, the lane over sand, sand into the sea. Where two
// sides of a tile spill the same kind, the corner between them is filled with a rounded fillet, so ponds
// and lawns have round corners rather than square ones. Hard, laid kinds (cobbles, boards, garden beds)
// stop at the tile line. Blending only happens between tiles at the same height; a step in elevation is a
// wall face instead.
//
// The ragged line is value noise in world position (a slow wave plus a 2 px grain, so edges step in clean
// pixel-art pairs), so neighbouring tiles agree on every shared pixel.

import { TERRAIN_INFO, TOWN_TERRAINS, type TownTerrain } from '../../world/townTerrain';
import { DIORAMA_TILE_H, DIORAMA_TILE_W } from '../dioramaConfig';

export const TW = DIORAMA_TILE_W;
export const TH = DIORAMA_TILE_H;
/** Ground px are foreshortened north–south; distances scale v by this to stay round on the ground. */
const V_SCALE = TW / TH;

/** Small integer ids for the kinds (index into TOWN_TERRAINS), so buffers can hold them. */
export const KIND_ID: Readonly<Record<TownTerrain, number>> = Object.fromEntries(TOWN_TERRAINS.map((k, i) => [k, i])) as Record<TownTerrain, number>;
export const KIND_OF: readonly TownTerrain[] = TOWN_TERRAINS;
export const LAYER = TOWN_TERRAINS.map(k => TERRAIN_INFO[k].layer);
export const SOFT = TOWN_TERRAINS.map(k => TERRAIN_INFO[k].soft);
export const IS_WATER = TOWN_TERRAINS.map(k => TERRAIN_INFO[k].water);
/** Kinds of one family meet without a lip or a shadow: a meadow is a lawn with flowers in it. */
export const FAMILY = TOWN_TERRAINS.map((k, i) => (k === 'meadow' ? TOWN_TERRAINS.indexOf('grass') : i));

/** The ground as the art sees it: kind ids and elevations, row-major. */
export interface GroundMap {
  width: number;
  height: number;
  kinds: Uint8Array;
  elevs: Int8Array;
}

export function groundMap(width: number, height: number, kind: (x: number, y: number) => TownTerrain, elev: (x: number, y: number) => number = () => 0): GroundMap {
  const kinds = new Uint8Array(width * height), elevs = new Int8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { kinds[y * width + x] = KIND_ID[kind(x, y)]; elevs[y * width + x] = elev(x, y); }
  return { width, height, kinds, elevs };
}

/** How far a soft edge spills over a lower neighbour, px, and how ragged it is (± px). Art tuning. */
export const SPILL: Readonly<Partial<Record<TownTerrain, readonly [number, number]>>> = {
  grass: [6, 4], meadow: [9, 7], sand: [8, 5], wet_sand: [6, 4], shingle: [5, 3],
  road: [3, 2], gravel: [3, 2], shallows: [10, 6]
};
const SPILL_ID = TOWN_TERRAINS.map(k => SPILL[k] ?? [3, 2]);
/** Corner fillet radius, px: the round where two spilling sides meet. */
const FILLET = 22;

// ── Noise ───────────────────────────────────────────────────────────────────

/** A well-mixed hash of two ints and a seed, as a float in [0, 1). */
export function hash01(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) on the integer lattice. */
export function vnoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash01(x0, y0, seed), b = hash01(x0 + 1, y0, seed), c = hash01(x0, y0 + 1, seed), d = hash01(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The ragged-edge offset at a ground pixel, in [-1, 1]: a slow wave and a 2 px grain. */
export const edgeNoise = (gx: number, gy: number, seed: number): number =>
  vnoise(gx / 21, gy / 15, seed) * 1.3 + vnoise((gx >> 1) / 2.4, (gy >> 1) / 1.9, seed + 7) * 0.7 - 1;

// ── Which kind covers a pixel ───────────────────────────────────────────────

/** Per tile: does any same-height neighbour spill onto it? Most tiles never need the neighbour test. */
export function spillMask(map: GroundMap): Uint8Array {
  const { width, height, kinds, elevs } = map;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, own = kinds[i]!, e = elevs[i]!;
    scan: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const k = kinds[ny * width + nx]!;
      if (SOFT[k] && LAYER[k]! > LAYER[own]! && elevs[ny * width + nx] === e) { out[i] = 1; break scan; }
    }
  }
  return out;
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];

/** The kind at a tile if it is at height `e`, else -1 (off the map too). */
function kindNear(map: GroundMap, x: number, y: number, e: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return -1;
  const i = y * map.width + x;
  return map.elevs[i] === e ? map.kinds[i]! : -1;
}

/**
 * The kind id covering ground pixel (gx, gy) (ground px: tile x·48 + u, tile y·36 + v; pixels off the
 * map read as the nearest edge tile). `mask` is spillMask(map).
 */
export function winnerAt(map: GroundMap, mask: Uint8Array, gx: number, gy: number, seed: number): number {
  const { width, height, kinds, elevs } = map;
  const tx = Math.min(width - 1, Math.max(0, Math.floor(gx / TW)));
  const ty = Math.min(height - 1, Math.max(0, Math.floor(gy / TH)));
  const ti = ty * width + tx;
  const own = kinds[ti]!;
  if (!mask[ti]) return own;
  const u = gx - tx * TW + 0.5, v = gy - ty * TH + 0.5;
  const e = elevs[ti]!;
  let best = own, bestLayer = LAYER[own]!;
  let noise = NaN;
  for (let n = 0; n < 8; n++) {
    const dx = DX[n]!, dy = DY[n]!;
    const k = kindNear(map, tx + dx, ty + dy, e);
    if (k < 0 || !SOFT[k] || LAYER[k]! <= bestLayer) continue;
    const ddx = dx < 0 ? u : dx > 0 ? TW - u : 0;
    const ddy = (dy < 0 ? v : dy > 0 ? TH - v : 0) * V_SCALE;
    let d = dx && dy ? Math.hypot(ddx, ddy) : ddx + ddy;
    // Over water every shore spills further and wanders more: banks and beaches are never ruled lines.
    const spill = SPILL_ID[k]!, wet = IS_WATER[own] ? 1 : 0;
    const reach = spill[0] + wet * 4, ragged = spill[1] * (1 + wet * 0.6);
    // Round the corner where this side and a perpendicular side both spill the same kind.
    if (!dx || !dy) {
      for (let s = -1; s <= 1; s += 2) {
        const cx = dx || s, cy = dy || s;
        if (kindNear(map, tx + (dx ? 0 : cx), ty + (dy ? 0 : cy), e) !== k) continue;
        const ex = cx < 0 ? u : TW - u, ey = (cy < 0 ? v : TH - v) * V_SCALE;
        if (ex < FILLET && ey < FILLET) d = Math.min(d, FILLET - Math.hypot(FILLET - ex, FILLET - ey));
      }
    }
    if (d > reach + ragged) continue;
    if (Number.isNaN(noise)) noise = edgeNoise(gx, gy, seed);
    if (d < reach + noise * ragged) { best = k; bestLayer = LAYER[k]!; }
  }
  return best;
}

// ── Cart-road ruts ──────────────────────────────────────────────────────────

/** Two wheel ruts along a road: their axis and their positions across it, in ground px. */
export interface Ruts { axis: 'h' | 'v'; at: readonly [number, number] }

/**
 * Ruts for every road tile: a road running east–west (more road beside it than above and below) carries
 * two ruts along it, at a third and two thirds of the way across the whole width of the road; north–south
 * likewise. Where both ways are equal (a lone tile, the middle of a square crossing) there are none.
 */
export function roadRuts(map: GroundMap): (Ruts | null)[] {
  const road = KIND_ID.road;
  const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.kinds[y * map.width + x] === road;
  const out: (Ruts | null)[] = new Array(map.width * map.height).fill(null);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (!isRoad(x, y)) continue;
    const run = (dx: number, dy: number) => { let n = 0; while (isRoad(x + dx * (n + 1), y + dy * (n + 1))) n++; return n; };
    const east = run(1, 0), west = run(-1, 0), south = run(0, 1), north = run(0, -1);
    const along = east + west, wide = north + south;
    if (along > wide) {
      const y0 = (y - north) * TH, span = (wide + 1) * TH;
      out[y * map.width + x] = { axis: 'h', at: [Math.round(y0 + span * 0.32), Math.round(y0 + span * 0.68)] };
    } else if (wide > along) {
      const x0 = (x - west) * TW, span = (along + 1) * TW;
      out[y * map.width + x] = { axis: 'v', at: [Math.round(x0 + span * 0.32), Math.round(x0 + span * 0.68)] };
    }
  }
  return out;
}
