import { describe, expect, it } from 'vitest';
import { clearLine, distanceField, findPath, LruCache, pointAlong, cumulative, polylineLength, smoothPath, tilePathCost, ZoneGraph, ZoneNav } from '../nav';
import { compileZone, type Point } from '../zoneFormat';
import { loadZones } from '../../sim/__tests__/content';

/** '#' is solid, anything else walkable. Row-major, like ZoneDef.walkability. */
const grid = (...rows: string[]): boolean[][] => rows.map(r => [...r].map(c => c !== '#'));
const SQRT2 = Math.SQRT2;

/** Every step is to a neighbour, on open ground, and no diagonal squeezes past a solid corner. */
function assertLegal(walk: boolean[][], path: Point[]): void {
  for (const [x, y] of path) expect(walk[y]![x], `cell ${x},${y}`).toBe(true);
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!, [bx, by] = path[i]!;
    expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay))).toBe(1);
    if (ax !== bx && ay !== by) {
      expect(walk[ay]![bx], `corner at ${bx},${ay}`).toBe(true);
      expect(walk[by]![ax], `corner at ${ax},${by}`).toBe(true);
    }
  }
}

describe('A*', () => {
  const wall = grid(
    '.......',
    '...#...',
    '...#...',
    '...#...',
    '.......');

  it('finds the shortest path around a wall', () => {
    const path = findPath(wall, [1, 2], [5, 2])!;
    expect(path[0]).toEqual([1, 2]);
    expect(path.at(-1)).toEqual([5, 2]);
    assertLegal(wall, path);
    // Over (or under) the wall: two diagonals and four straight steps; no corner may be clipped at x=3.
    expect(tilePathCost(path)).toBeCloseTo(4 + 2 * SQRT2, 9);
    // Matches an independent Dijkstra.
    expect(tilePathCost(path)).toBeCloseTo(distanceField(wall, [1, 2])[2 * 7 + 5]!, 9);
  });

  it('returns null when the goal is unreachable or solid', () => {
    const split = grid('..#..', '..#..', '..#..');
    expect(findPath(split, [0, 1], [4, 1])).toBeNull();
    expect(findPath(wall, [0, 0], [3, 2])).toBeNull();
    expect(findPath(wall, [3, 1], [0, 0])).toBeNull();
  });

  it('never cuts a corner past a solid tile', () => {
    // The only diagonal squeezes between two solid cells: no way through.
    expect(findPath(grid('.#', '#.'), [0, 0], [1, 1])).toBeNull();
    // One solid corner: go round it, two straight steps instead of one diagonal.
    const corner = grid('..', '#.');
    const path = findPath(corner, [0, 0], [1, 1])!;
    expect(path).toEqual([[0, 0], [1, 0], [1, 1]]);
    expect(tilePathCost(path)).toBe(2);
  });

  it('is deterministic and returns a single cell for from = to', () => {
    expect(findPath(wall, [0, 0], [6, 4])).toEqual(findPath(wall, [0, 0], [6, 4]));
    expect(findPath(wall, [2, 2], [2, 2])).toEqual([[2, 2]]);
  });
});

describe('path smoothing', () => {
  it('straightens open ground into one segment', () => {
    const open = grid(...Array.from({ length: 6 }, () => '..........'));
    const smooth = smoothPath(open, findPath(open, [0, 0], [9, 3])!);
    expect(smooth).toEqual([{ x: 0.5, y: 0.5 }, { x: 9.5, y: 3.5 }]);
  });

  it('keeps every shortcut clear of walls and never makes the walk longer', () => {
    const walk = grid(
      '..........',
      '.####.....',
      '.#........',
      '.#..####..',
      '.#.....#..',
      '.......#..');
    const tiles = findPath(walk, [0, 5], [9, 0])!;
    const smooth = smoothPath(walk, tiles);
    expect(smooth.length).toBeLessThan(tiles.length);
    for (let i = 1; i < smooth.length; i++) expect(clearLine(walk, smooth[i - 1]!, smooth[i]!)).toBe(true);
    expect(polylineLength(smooth)).toBeLessThanOrEqual(tilePathCost(tiles) + 1e-9);
  });

  it('interpolates along a polyline', () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const cum = cumulative(pts);
    expect(cum).toEqual([0, 3, 7]);
    expect(pointAlong(pts, cum, 5)).toEqual({ at: { x: 3, y: 2 }, dir: { x: 0, y: 1 } });
    expect(pointAlong(pts, cum, 99).at).toEqual({ x: 3, y: 4 });
  });
});

describe('path cache', () => {
  it('reuses (from, to) pairs', () => {
    const zone = compileZone(`id: t\nname: T\nsize: [6, 3]\nlegend:\n  '.': { terrain: cobblestone }\ntiles: |\n  ......\n  ......\n  ......\nspawn: [0, 0]\n`);
    const nav = new ZoneNav(zone);
    const a = nav.path([0, 0], [5, 2]);
    expect(nav.path([0, 0], [5, 2])).toBe(a);
    expect(nav.cache.hits).toBe(1);
    expect(nav.cache.misses).toBe(1);
  });

  it('evicts the least recently used entry', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });
});

describe('zone graph', () => {
  const zones = loadZones();
  const graph = new ZoneGraph(zones);

  it('builds portals from every edge, with door-to-edge distances', () => {
    expect(graph.portals.old_quarter!.map(p => [p.to, p.exit])).toEqual([['market_row', [39, 16]]]);
    expect(graph.portals.market_row!.map(p => [p.to, p.exit])).toEqual([['old_quarter', [0, 10]], ['commons', [8, 0]], ['wharf', [18, 19]]]);
    for (const zone of Object.values(zones)) for (const place of zone.places) {
      for (const d of Object.values(graph.doorToEdge[zone.id]![place.id]!)) expect(d, `${zone.id}.${place.id}`).toBeLessThan(Infinity);
    }
    // The constabulary is next to the east road; Lamplighter's Cottage is across town from it.
    const east = graph.portals.old_quarter![0]!.id;
    expect(graph.doorToEdge.old_quarter!.constabulary![east]).toBeLessThan(graph.doorToEdge.old_quarter!.lamplighter_cottage![east]!);
  });

  it('routes across zones through the shared edge', () => {
    const cottage = zones.old_quarter!.places.find(p => p.id === 'lamplighter_cottage')!.door;
    const cafe = zones.market_row!.places.find(p => p.id === 'cafe_liss')!.door;
    const route = graph.route({ zone: 'old_quarter', tile: cottage }, { zone: 'market_row', tile: cafe })!;
    expect(route.legs.map(l => l.zone)).toEqual(['old_quarter', 'market_row']);
    expect(route.legs[0]!.points.at(-1)!.x).toBeGreaterThan(39.9); // steps off the east edge
    expect(route.legs[1]!.points[0]!.x).toBeLessThan(0.1);          // and on at Market Row's west edge
    for (const leg of route.legs) {
      const walk = zones[leg.zone]!.walkability;
      for (const p of leg.points) expect(walk[Math.floor(p.y)]![Math.floor(p.x)], `${leg.zone} ${p.x},${p.y}`).toBe(true);
    }
    expect(route.length).toBeCloseTo(route.legs.reduce((s, l) => s + l.length, 0), 9);
    expect(graph.estimateMinutes({ zone: 'old_quarter', tile: cottage }, { zone: 'market_row', tile: cafe }, 2)).toBeCloseTo(route.length / 2, 9);
    // Same-zone routes are a single leg; unknown zones have no route.
    expect(graph.route({ zone: 'market_row', tile: cafe }, { zone: 'market_row', tile: [4, 7] })!.legs).toHaveLength(1);
    expect(graph.route({ zone: 'millbrook', tile: [0, 0] }, { zone: 'market_row', tile: cafe })).toBeNull();
  });
});
