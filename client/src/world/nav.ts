// Navigation for residents (MVP W-05; GDD §9.7, §16.4, §19.2). Pure: no Phaser, no DOM.
//
// Two layers:
//   • Inside a zone: grid A* over the compiled walkability (8 directions, never cutting a corner past a
//     solid tile), then string-pulling so paths run in straight lines wherever there's room, and an LRU
//     cache for (from, to) pairs that residents walk every day.
//   • Across zones: a ZoneGraph built from every compiled zone's edges. It knows each edge's exit tile,
//     the distance from every door to every edge, and routes a walk through as many zones as it takes.
//
// Coordinates follow world/player.ts: integer cells [x, y] (`Point`) for grid search, continuous
// positions {x, y} in tile units with a cell's centre at +0.5.

import type { Edge, Point, ZoneDef } from './zoneFormat';

export interface Vec { x: number; y: number }
/** A walkable polyline in continuous tile coordinates. */
export interface NavPath { points: Vec[]; length: number }

/**
 * Half-width kept clear of solid tiles when straightening a path (art tuning, not a game rule): a
 * resident's body never brushes a wall or a lamp post on a shortcut. Must stay under 0.5 so every tile
 * centre fits.
 */
export const NAV_CLEARANCE = 0.3;
/** How far short of the map's edge a resident steps before leaving a zone. */
const BORDER_INSET = 0.02;

const SQRT2 = Math.SQRT2;
/** dx, dy, cost: orthogonal first, so ties resolve the same way every time. */
const MOVES: readonly (readonly [number, number, number])[] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
];

export const centre = ([x, y]: Point): Vec => ({ x: x + 0.5, y: y + 0.5 });
export const tileOf = (p: Vec): Point => [Math.floor(p.x), Math.floor(p.y)];
export const isWalkable = (walk: readonly (readonly boolean[])[], x: number, y: number): boolean => walk[y]?.[x] === true;
const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

/** Binary min-heap of cell indices keyed by priority. Equal priorities pop in insertion order. */
class Heap {
  private idx: number[] = [];
  private pri: number[] = [];
  private seq: number[] = [];
  private counter = 0;
  get size(): number { return this.idx.length; }
  private less(a: number, b: number): boolean {
    return this.pri[a]! < this.pri[b]! || (this.pri[a] === this.pri[b] && this.seq[a]! < this.seq[b]!);
  }
  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b]!, this.idx[a]!];
    [this.pri[a], this.pri[b]] = [this.pri[b]!, this.pri[a]!];
    [this.seq[a], this.seq[b]] = [this.seq[b]!, this.seq[a]!];
  }
  push(index: number, priority: number): void {
    this.idx.push(index); this.pri.push(priority); this.seq.push(this.counter++);
    let i = this.idx.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop(): number {
    const top = this.idx[0]!;
    const last = this.idx.length - 1;
    this.swap(0, last);
    this.idx.pop(); this.pri.pop(); this.seq.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.idx.length && this.less(l, m)) m = l;
      if (r < this.idx.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
    return top;
  }
}

/** Neighbours of a cell in the 8 directions, skipping diagonals that would clip a solid corner. */
function forEachMove(walk: readonly (readonly boolean[])[], x: number, y: number, visit: (nx: number, ny: number, cost: number) => void): void {
  for (const [dx, dy, cost] of MOVES) {
    const nx = x + dx, ny = y + dy;
    if (!isWalkable(walk, nx, ny)) continue;
    // No corner cutting: a diagonal step needs both orthogonal neighbours open.
    if (dx !== 0 && dy !== 0 && (!isWalkable(walk, x + dx, y) || !isWalkable(walk, x, y + dy))) continue;
    visit(nx, ny, cost);
  }
}

/**
 * Shortest 8-directional path between two walkable cells, start and goal included, or null when either
 * end is solid or the goal can't be reached. Octile heuristic (admissible, consistent).
 */
export function findPath(walk: readonly (readonly boolean[])[], from: Point, to: Point): Point[] | null {
  const width = walk[0]?.length ?? 0, height = walk.length;
  const [sx, sy] = from, [gx, gy] = to;
  if (!isWalkable(walk, sx, sy) || !isWalkable(walk, gx, gy)) return null;
  if (samePoint(from, to)) return [[sx, sy]];
  const n = width * height, start = sy * width + sx, goal = gy * width + gx;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // A hair over 1 breaks ties toward the goal; path costs differ by far more than it can reorder.
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * (1 + 1e-7);
  };
  const open = new Heap();
  g[start] = 0;
  open.push(start, h(sx, sy));
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % width, cy = (cur - cx) / width;
    forEachMove(walk, cx, cy, (nx, ny, cost) => {
      const ni = ny * width + nx;
      if (closed[ni]) return;
      const ng = g[cur]! + cost;
      if (ng < g[ni]! - 1e-9) { g[ni] = ng; parent[ni] = cur; open.push(ni, ng + h(nx, ny)); }
    });
  }
  if (!closed[goal]) return null;
  const path: Point[] = [];
  for (let i = goal; i !== -1; i = parent[i]!) path.push([i % width, Math.floor(i / width)]);
  return path.reverse();
}

/** Length of a cell path walked centre to centre. */
export const tilePathCost = (tiles: readonly Point[]): number =>
  tiles.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - tiles[i]![0], y - tiles[i]![1]), 0);

/** Octile walking distance from `from` to every cell (Infinity where unreachable), with A*'s move rules. */
export function distanceField(walk: readonly (readonly boolean[])[], from: Point): Float64Array {
  const width = walk[0]?.length ?? 0, height = walk.length;
  const dist = new Float64Array(width * height).fill(Infinity);
  if (!isWalkable(walk, from[0], from[1])) return dist;
  const open = new Heap();
  const start = from[1] * width + from[0];
  dist[start] = 0;
  open.push(start, 0);
  const done = new Uint8Array(width * height);
  while (open.size > 0) {
    const cur = open.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    const cx = cur % width, cy = (cur - cx) / width;
    forEachMove(walk, cx, cy, (nx, ny, cost) => {
      const ni = ny * width + nx, nd = dist[cur]! + cost;
      if (nd < dist[ni]! - 1e-9) { dist[ni] = nd; open.push(ni, nd); }
    });
  }
  return dist;
}

/** True when a square of half-width `r` centred on (x, y) lies entirely on walkable cells. */
export function fits(walk: readonly (readonly boolean[])[], x: number, y: number, r = NAV_CLEARANCE): boolean {
  return isWalkable(walk, Math.floor(x - r), Math.floor(y - r)) && isWalkable(walk, Math.floor(x + r), Math.floor(y - r))
    && isWalkable(walk, Math.floor(x - r), Math.floor(y + r)) && isWalkable(walk, Math.floor(x + r), Math.floor(y + r));
}

/** Line of sight for a body of half-width `r`: the whole sweep from a to b stays on walkable cells. */
export function clearLine(walk: readonly (readonly boolean[])[], a: Vec, b: Vec, r = NAV_CLEARANCE): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / 0.1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!fits(walk, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) return false;
  }
  return true;
}

/**
 * String-pulling: from each anchor, skip ahead to the farthest following cell still in clear line of
 * sight, so a staircase of diagonal and straight steps becomes one straight walk. The result only ever
 * keeps segments clearLine() accepts (the raw centre-to-centre path always does, as diagonals never cut
 * corners), so it never crosses a solid cell.
 */
export function smoothPath(walk: readonly (readonly boolean[])[], tiles: readonly Point[], r = NAV_CLEARANCE): Vec[] {
  const pts = tiles.map(centre);
  if (pts.length <= 2) return pts;
  const out: Vec[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && clearLine(walk, pts[i]!, pts[j + 1]!, r)) j++;
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

export const polylineLength = (points: readonly Vec[]): number =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);

/** Running distance at each vertex of a polyline (0 first, total length last). */
export function cumulative(points: readonly Vec[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return out;
}

/** The point `distance` along a polyline (clamped to its ends), and the unit direction of travel there. */
export function pointAlong(points: readonly Vec[], cum: readonly number[], distance: number): { at: Vec; dir: Vec | null } {
  const last = points.length - 1;
  if (last <= 0) return { at: { ...points[0]! }, dir: null };
  const d = Math.min(Math.max(distance, 0), cum[last]!);
  // Binary search for the segment holding d.
  let lo = 0, hi = last;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid]! <= d) lo = mid; else hi = mid; }
  const a = points[lo]!, b = points[hi]!, span = cum[hi]! - cum[lo]!;
  const t = span > 0 ? (d - cum[lo]!) / span : 1;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : null };
}

/** A small LRU map. `undefined` means "not cached"; store null for a known failure. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  hits = 0;
  misses = 0;
  constructor(readonly max = 4096) {}
  get size(): number { return this.map.size; }
  has(key: string): boolean { return this.map.has(key); }
  get(key: string): V | undefined {
    if (!this.map.has(key)) { this.misses++; return undefined; }
    const v = this.map.get(key)!;
    this.map.delete(key); this.map.set(key, v);
    this.hits++;
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

/** Pathfinding inside one zone, with a cache of smoothed paths for (from, to) pairs. */
export class ZoneNav {
  constructor(readonly zone: ZoneDef, readonly cache = new LruCache<NavPath | null>(2048)) {}

  path(from: Point, to: Point): NavPath | null {
    const key = `${from[0]},${from[1]}>${to[0]},${to[1]}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const tiles = findPath(this.zone.walkability, from, to);
    const points = tiles ? smoothPath(this.zone.walkability, tiles) : null;
    const result = points ? { points, length: polylineLength(points) } : null;
    this.cache.set(key, result);
    return result;
  }
}

// ── Zone graph ──────────────────────────────────────────────────────────────

const OPPOSITE: Readonly<Record<Edge['side'], Edge['side']>> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** The side of the map a border cell lies on, or null for an inner cell. */
export function borderSide(zone: Pick<ZoneDef, 'width' | 'height'>, [x, y]: Point): Edge['side'] | null {
  return x === 0 ? 'west' : x === zone.width - 1 ? 'east' : y === 0 ? 'north' : y === zone.height - 1 ? 'south' : null;
}

/** The point where a border cell meets the edge of the map: where a walker steps off (or on). */
export function borderPoint(zone: Pick<ZoneDef, 'width' | 'height'>, [x, y]: Point, side: Edge['side']): Vec {
  switch (side) {
    case 'west': return { x: BORDER_INSET, y: y + 0.5 };
    case 'east': return { x: zone.width - BORDER_INSET, y: y + 0.5 };
    case 'north': return { x: x + 0.5, y: BORDER_INSET };
    case 'south': return { x: x + 0.5, y: zone.height - BORDER_INSET };
  }
}

/** One way out of a zone: walk to `exit`, step off at `border`, appear at `arrive` in `to`. */
export interface Portal {
  id: string;
  zone: string;
  side: Edge['side'];
  /** The middle cell of the edge's span, on the border. */
  exit: Point;
  border: Vec;
  to: string;
  arrive: Point;
  /** Where the walker steps onto the target map, on its border next to `arrive` (null if none is clear). */
  entry: Vec | null;
}
/** A cell in a zone. */
export interface Loc { zone: string; tile: Point }
/** A walk inside one zone; `exit` is the portal it leaves by (absent on the last leg). */
export interface RouteLeg { zone: string; points: Vec[]; length: number; exit?: Portal }
export interface Route { legs: RouteLeg[]; length: number }

export class ZoneGraph {
  readonly nav: Readonly<Record<string, ZoneNav>>;
  readonly portals: Readonly<Record<string, readonly Portal[]>>;
  /** Walking distance (octile) from each place's door to each of its zone's edges: zone → place → portal id → tiles. */
  readonly doorToEdge: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>>;
  private readonly fields = new Map<string, Float64Array>();
  private readonly routes = new LruCache<Route | null>(4096);

  constructor(readonly zones: Readonly<Record<string, ZoneDef>>) {
    const nav: Record<string, ZoneNav> = {}, portals: Record<string, Portal[]> = {}, doors: Record<string, Record<string, Record<string, number>>> = {};
    for (const zone of Object.values(zones)) {
      nav[zone.id] = new ZoneNav(zone);
      portals[zone.id] = zone.edges.map((edge, i) => {
        const mid = Math.floor((edge.from + edge.to) / 2);
        const exit: Point = edge.side === 'east' ? [zone.width - 1, mid] : edge.side === 'west' ? [0, mid] : edge.side === 'north' ? [mid, 0] : [mid, zone.height - 1];
        const target = zones[edge.zone];
        let entry: Vec | null = null;
        if (target) {
          // Step on from the target's border cell beside the arrival, when that's open ground.
          const side = OPPOSITE[edge.side], [ax, ay] = edge.arrive;
          const cell: Point = side === 'west' ? [0, ay] : side === 'east' ? [target.width - 1, ay] : side === 'north' ? [ax, 0] : [ax, target.height - 1];
          const from = borderPoint(target, cell, side);
          if (isWalkable(target.walkability, cell[0], cell[1]) && clearLine(target.walkability, centre(cell), centre(edge.arrive), 0.2)) entry = from;
        }
        return { id: `${zone.id}#${i}`, zone: zone.id, side: edge.side, exit, border: borderPoint(zone, exit, edge.side), to: edge.zone, arrive: edge.arrive, entry };
      });
      doors[zone.id] = {};
      for (const place of zone.places) {
        doors[zone.id]![place.id] = Object.fromEntries(portals[zone.id]!.map(p => [p.id, this.field(p, zone)[place.door[1] * zone.width + place.door[0]]!]));
      }
    }
    this.nav = nav; this.portals = portals; this.doorToEdge = doors;
  }

  private field(portal: Portal, zone = this.zones[portal.zone]!): Float64Array {
    let f = this.fields.get(portal.id);
    if (!f) { f = distanceField(zone.walkability, portal.exit); this.fields.set(portal.id, f); }
    return f;
  }

  /** Octile walking distance from a cell to a portal's exit cell (Infinity if cut off). */
  edgeDistance(portal: Portal, [x, y]: Point): number {
    const zone = this.zones[portal.zone]!;
    return this.field(portal, zone)[y * zone.width + x] ?? Infinity;
  }

  /**
   * The shortest walk from one cell to another, through other zones when they're in different ones.
   * Dijkstra over "standing just inside zone Z at cell c" nodes, linked by the zones' portals; leg costs
   * are real smoothed path lengths (cached). Null if any needed walk is impossible.
   */
  route(from: Loc, to: Loc): Route | null {
    const key = `${from.zone}:${from.tile[0]},${from.tile[1]}>${to.zone}:${to.tile[0]},${to.tile[1]}`;
    const hit = this.routes.get(key);
    if (hit !== undefined) return hit;
    const result = this.search(from, to);
    this.routes.set(key, result);
    return result;
  }

  private search(from: Loc, to: Loc): Route | null {
    if (!this.zones[from.zone] || !this.zones[to.zone]) return null;
    // Node 0 is the start; node k+1 is "just arrived through portal k".
    const all = Object.values(this.portals).flat().filter(p => this.zones[p.to]);
    const where = (node: number): Loc => node === 0 ? from : { zone: all[node - 1]!.to, tile: all[node - 1]!.arrive };
    const dist = new Array<number>(all.length + 1).fill(Infinity), prev = new Array<number>(all.length + 1).fill(-1);
    const done = new Array<boolean>(all.length + 1).fill(false);
    dist[0] = 0;
    let best = Infinity, bestNode = -1;
    for (;;) {
      let u = -1;
      for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
      if (u < 0 || dist[u]! >= best) break;
      done[u] = true;
      const at = where(u);
      const nav = this.nav[at.zone]!;
      if (at.zone === to.zone) {
        const p = nav.path(at.tile, to.tile);
        if (p && dist[u]! + p.length < best) { best = dist[u]! + p.length; bestNode = u; }
      }
      all.forEach((portal, k) => {
        if (portal.zone !== at.zone || done[k + 1]) return;
        const p = nav.path(at.tile, portal.exit);
        if (!p) return;
        const cost = dist[u]! + p.length + Math.hypot(portal.border.x - portal.exit[0] - 0.5, portal.border.y - portal.exit[1] - 0.5);
        if (cost < dist[k + 1]!) { dist[k + 1] = cost; prev[k + 1] = u; }
      });
    }
    if (bestNode < 0) return null;
    // Unwind the portal chain, then lay each leg's path.
    const chain: number[] = [];
    for (let n = bestNode; n > 0; n = prev[n]!) chain.unshift(n);
    const legs: RouteLeg[] = [];
    let start: Loc = from, entry: Vec | null = null;
    for (const node of chain) {
      const portal = all[node - 1]!;
      const p = this.nav[start.zone]!.path(start.tile, portal.exit)!;
      const points = [...(entry ? [entry] : []), ...p.points, portal.border];
      legs.push({ zone: start.zone, points, length: polylineLength(points), exit: portal });
      start = { zone: portal.to, tile: portal.arrive };
      entry = portal.entry;
    }
    const last = this.nav[start.zone]!.path(start.tile, to.tile)!;
    const points = [...(entry ? [entry] : []), ...last.points];
    legs.push({ zone: start.zone, points, length: polylineLength(points) });
    return { legs, length: legs.reduce((s, l) => s + l.length, 0) };
  }

  /** Walking time between two cells in game minutes at `tilesPerMinute`, or null if there's no way. */
  estimateMinutes(from: Loc, to: Loc, tilesPerMinute: number): number | null {
    const r = this.route(from, to);
    return r ? r.length / tilesPerMinute : null;
  }
}

export const buildZoneGraph = (zones: Readonly<Record<string, ZoneDef>>): ZoneGraph => new ZoneGraph(zones);
