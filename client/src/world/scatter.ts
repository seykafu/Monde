// Seeded scatter (zone format v2 `scatter:`): grass tufts, flowers, bushes, reeds by the water, lilies on a
// calm pond, rocks. Pure and deterministic: the same rule on the same map always lays the same items, so
// the town looks the same on every machine and every visit. No Phaser, no DOM.

import type { TownTerrain } from './townTerrain';

export type Point = [number, number];

export interface ScatterRule {
  /** Sprite ids, picked uniformly per item (repeat an id to weight it). */
  sprites: string[];
  /** Ground kinds an item may stand on. */
  on: TownTerrain[];
  /** Chance per eligible tile, 0..1. */
  density: number;
  seed: number;
  /** Only within `radius` tiles (Chebyshev) of one of these kinds: reeds by the water. */
  near?: { kinds: TownTerrain[]; radius: number };
  /** Not within `radius` tiles of these kinds (default 1), nor within `doors` tiles of a door. */
  keepout?: { kinds?: TownTerrain[]; radius?: number; doors?: number };
  /** Items block movement (default false: scatter is set dressing you walk through or past). */
  solid?: boolean;
}

export interface ScatterItem {
  sprite: string;
  at: Point;
  /** Offset inside the tile, world px, so a field of tufts doesn't sit on a grid. */
  dx: number;
  dy: number;
  flip: boolean;
}

export interface ScatterMap {
  width: number;
  height: number;
  terrain(x: number, y: number): TownTerrain;
  /** False where something already stands (a building, a prop, a door, an edge cell, the spawn). */
  free(x: number, y: number): boolean;
  doors: readonly Point[];
}

/** murmur3's finalizer over a few integers: a well-mixed 32-bit hash. */
export function mix(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Chebyshev distance from (x, y) to the nearest tile matching `test`, searching out to `max` (Infinity beyond). */
function nearest(map: ScatterMap, x: number, y: number, max: number, test: (x: number, y: number) => boolean): number {
  for (let r = 0; r <= max; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (test(nx, ny)) return r;
    }
  }
  return Infinity;
}

/** Lay one rule's items. `index` (the rule's position in the zone) keeps two rules with one seed apart. */
export function scatter(rule: ScatterRule, map: ScatterMap, index = 0): ScatterItem[] {
  const out: ScatterItem[] = [];
  if (!rule.sprites.length || rule.density <= 0) return out;
  const on = new Set(rule.on);
  const near = rule.near ? new Set(rule.near.kinds) : null;
  const keep = rule.keepout?.kinds?.length ? new Set(rule.keepout.kinds) : null;
  const keepR = rule.keepout?.radius ?? 1;
  const doorR = rule.keepout?.doors;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (!on.has(map.terrain(x, y)) || !map.free(x, y)) continue;
    const h = mix(rule.seed, index, x, y);
    if (h / 4294967296 >= rule.density) continue;
    if (near && nearest(map, x, y, rule.near!.radius, (nx, ny) => near.has(map.terrain(nx, ny))) > rule.near!.radius) continue;
    if (keep && nearest(map, x, y, keepR, (nx, ny) => keep.has(map.terrain(nx, ny))) <= keepR) continue;
    if (doorR !== undefined && map.doors.some(([dx, dy]) => Math.max(Math.abs(dx - x), Math.abs(dy - y)) <= doorR)) continue;
    const pick = mix(h, 1);
    out.push({
      sprite: rule.sprites[pick % rule.sprites.length]!,
      at: [x, y],
      dx: (mix(h, 2) % 25) - 12,
      dy: (mix(h, 3) % 17) - 8,
      flip: (mix(h, 4) & 1) === 1
    });
  }
  return out;
}
