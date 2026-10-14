import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { compileZone, validateZoneLinks } from '../zoneFormat';
import { movePlayer, nearbyPlace, resolveEdge } from '../player';
import { ObliqueProjection } from '../../render/ObliqueProjection';
import { elevationFor } from '../../render/elevation';
import { DIORAMA_TILE_W, DIORAMA_TILE_H, DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH } from '../../render/dioramaConfig';

const fixture = `id: test
name: Test
size: [5, 4]
legend:
  '.': { terrain: cobblestone }
  B: { terrain: wall, solid: true, building: shop }
tiles: |
  .....
  ..BB.
  ..BB.
  .....
places:
  - { id: shop, rect: [2, 1, 2, 2], door: [2, 3] }
edges:
  - { side: west, from: 0, to: 0, zone: other, arrive: [1, 1] }
spawn: [0, 0]
`;
const zone = compileZone(fixture);
describe('zone compiler', () => {
  it('compiles valid text and building collision', () => { expect(zone.width).toBe(5); expect(zone.walkability[1]![2]).toBe(false); });
  it('rejects bad row lengths', () => expect(() => compileZone(fixture.replace('  .....', '  ....'))).toThrow(/rows/));
  it('rejects solid doors', () => expect(() => compileZone(fixture.replace('door: [2, 3]', 'door: [2, 2]'))).toThrow(/Door on solid/));
  it('rejects unknown legend characters', () => expect(() => compileZone(fixture.replace('  .....', '  ....?'))).toThrow(/legend character/));
  it('overrides legend elevation', () => expect(compileZone(fixture + 'elevation: |\n  11111\n  11111\n  11111\n  11111\n').tiles[0]!.elev).toBe(1));
  it.each([
    ['terrain: wall', 'terrain: unknown'], ['rect: [2, 1, 2, 2]', 'rect: [4, 1, 2, 2]'],
    ['from: 0, to: 0', 'from: 0, to: 4'], ['spawn: [0, 0]', 'spawn: [2, 1]'],
  ])('rejects invalid %s', (before, after) => expect(() => compileZone(fixture.replace(before, after))).toThrow());
});
describe('player', () => {
  it('cannot enter a building and slides along its wall', () => {
    let p = { x: 1.8, y: 1.5 };
    for (let i = 0; i < 10; i++) p = movePlayer(zone, p, { x: 1, y: 0 }, 0.1).position;
    expect(p.x).toBeLessThan(2);
    const moved = movePlayer(zone, p, { x: 1, y: 1 }, 0.1).position;
    expect(moved.x).toBe(p.x); expect(moved.y).toBeGreaterThan(p.y);
  });
  it('normalizes diagonal speed', () => {
    const p = movePlayer(zone, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }, 0.1).position;
    expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeCloseTo(0.4);
  });
  it('blocks unmarked boundaries and exits marked edges', () => {
    expect(movePlayer(zone, { x: 0.3, y: 2.5 }, { x: -1, y: 0 }, 0.25).position.x).toBeGreaterThan(0);
    expect(movePlayer(zone, { x: 0.3, y: 0.5 }, { x: -1, y: 0 }, 0.25).edge?.zone).toBe('other');
    expect(resolveEdge(zone, { x: -0.01, y: 1 })).toBeUndefined();
    expect(resolveEdge(zone, { x: 0.01, y: 0.5 })).toBeUndefined();
  });
  it('prompts within one tile of a door', () => {
    expect(nearbyPlace(zone, { x: 2.5, y: 3.5 })?.id).toBe('shop');
    expect(nearbyPlace(zone, { x: 0.5, y: 0.5 })).toBeUndefined();
  });
});
const content = resolve(import.meta.dirname, '../../../..', 'content');
const registry = parse(readFileSync(resolve(content, 'places/places.yaml'), 'utf8')) as Record<string, string[]>;
const zones = Object.fromEntries(readdirSync(resolve(content, 'zones')).filter(f => f.endsWith('.zone.yaml')).map(file => {
  const z = compileZone(readFileSync(resolve(content, 'zones', file), 'utf8')); return [z.id, z];
}));
it('compiles all shipped zones with reciprocal, walkable arrivals', () => validateZoneLinks(zones));
it('rejects missing targets and blocked arrivals', () => {
  expect(() => validateZoneLinks({ test: zone })).toThrow(/Missing target/);
  expect(() => validateZoneLinks({ test: zone, other: { ...zone, id: 'other' } })).toThrow(/reciprocal/);
});
const interiorOnly = new Set(['mayor_office', 'margo_flat', 'sable_flat', 'bakery_flat', 'dunmore_flat', 'roz_flat', 'pub_rooms']);
for (const z of Object.values(zones)) {
  it(`${z.id}: includes exactly the outdoor registry places`, () => {
    expect(z.places.map(p => p.id).sort()).toEqual(registry[z.id]!.filter(id => !interiorOnly.has(id)).sort());
  });
  it(`${z.id}: all doors and exits are reachable from spawn`, () => {
    const seen = new Set<string>(), queue = [z.spawn];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;
      if (seen.has(key) || !z.walkability[y]?.[x]) continue;
      seen.add(key); queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
    for (const p of z.places) expect(seen.has(p.door.join(',')), p.id).toBe(true);
    for (const e of z.edges) for (let n = e.from; n <= e.to; n++) {
      const p = e.side === 'east' ? [z.width - 1, n] : e.side === 'west' ? [0, n] : e.side === 'north' ? [n, 0] : [n, z.height - 1];
      expect(seen.has(p.join(','))).toBe(true);
    }
  });
  it(`${z.id}: standable tile centres remain pickable`, () => {
    const projection = new ObliqueProjection({ originX: 0, originY: 0, gridWidth: z.width, gridHeight: z.height, tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H, elevStep: DIORAMA_ELEV_STEP, slabDepth: DIORAMA_SLAB_DEPTH, elevationAt: elevationFor(z) });
    for (let y = 0; y < z.height; y++) for (let x = 0; x < z.width; x++) if (z.walkability[y]![x]) {
      const p = projection.tileToWorld({ x, y });
      expect(projection.worldToTile(p.x, p.y)).toEqual({ x, y });
    }
  });
}
