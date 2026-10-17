// The routine executor (MVP W-05; GDD §9.5, §9.7, §19.2). Pure: no Phaser, no DOM.
//
// Day plans in, positions out. For each resident the executor lays out a timeline once per plan: stays
// at places, walks along smoothed paths between them (across zones through the zone graph), and
// off-board stretches when a place is in a zone that isn't built yet. A resident's state at any minute is
// then a lookup in that timeline plus interpolation along a path, so it is a pure function of
// (plan, minute): sample the same minute twice, or in any order, and get the same answer. Nothing
// accumulates between samples, which is what lets off-screen residents tick at 1 Hz and the zone you walk
// into show everybody exactly where they should be.
//
// Timing: a resident leaves early enough to arrive when the next block starts (walking time comes from
// the route's real path length). When a block is shorter than the walk, they leave as soon as they get
// there and arrive late; lateness carries forward and is absorbed by the next long block.
//
// Places (§9.5):
//   open      open ground (fountain_square, market_street…): they stand at a spot of their own inside it
//             and stay visible; walk / wander / exercise blocks stroll between spots; socialize / eat blocks
//             stand round one of the place's social spots (the benches, the pump), the same one for everybody
//             there at the time, so they're together.
//   building  a place with walls: they walk to its door and go in (invisible) until they leave.
//   interior  a room with no street door of its own (bakery_flat, pub_rooms, mayor_office…): the
//             building it's in, as above.
//   offboard  a place in a zone that isn't built (millbrook, station_hill…): they walk to the road
//             toward it on a built board, step off the edge, and come back the same way.
//   lane      a home on a street its own board doesn't draw (content/places/homes.yaml `lane`): they walk to
//             that edge cell of the board and step off it, a few minutes from the door.
//   unresolved an id no zone knows: treated as off-board, and recorded in `warnings`.
//
// Homes (§9.5, A.1.3) resolve through the homes registry: a home inside a drawn building is that building's door (a
// flat over a shop is an interior of the shop; a flat in a census townhouse is the townhouse), a lane home is `lane`,
// and a home in an unbuilt zone is off-board as before.

import type { HomeRegistry } from '@monde/shared';
import type { Point, SocialSpot, ZoneDef } from '../world/zoneFormat';
import { borderPoint, borderSide, centre, cumulative, isWalkable, pointAlong, type Loc, type Vec, type ZoneGraph } from '../world/nav';
import { MS_PER_GAME_MINUTE } from './clock';
import { hashString, type DayPlan, type DayPlanBlock, type PlanAction } from './plans';
import { Rng } from '../util/rng';

/**
 * GDD-GAP: §19.2 moves residents "at path-time rates" without a speed. Residents walk at 0.8× the
 * player's 4 tiles/s (W-02), a stroll beside the player's brisk walk: 3.2 tiles per real second, which at
 * 0.75 s per game minute (§5.3) is 2.4 tiles per game minute. Crossing the Old Quarter (≈ 48 tiles) takes
 * about 20 game minutes; Lamplighter Lane to Café Liss about 25.
 */
export const RESIDENT_SPEED = 3.2;
export const TILES_PER_GAME_MINUTE = (RESIDENT_SPEED * MS_PER_GAME_MINUTE) / 1000;
/**
 * GDD-GAP: unbuilt zones have no maps, so the walk between a built board's edge and a place inside one is
 * a flat 15 game minutes (≈ 36 tiles, one district across). Moving between two places in the same
 * unbuilt zone takes 8.
 */
export const OFFBOARD_LEG_MINUTES = 15;
export const OFFBOARD_LOCAL_MINUTES = 8;
/**
 * GDD-GAP: a lane home stands on a street just past its board's edge (Kasey's D3 for M-03), so the walk between that
 * edge and the door is short: 4 game minutes (about ten tiles).
 */
export const LANE_LEG_MINUTES = 4;
/** When even the zone graph can't find a way (a data error), the resident vanishes for this long instead. */
const FAILED_ROUTE_MINUTES = 5;
/** Verbs that wander about an open place instead of standing at one spot. */
const STROLL_VERBS: ReadonlySet<string> = new Set(['walk', 'wander', 'exercise']);
/**
 * Verbs that work about a site: a few minutes' walk to another spot now and then, a long while at each (fetching,
 * carrying, measuring), so a Project's volunteers are seen working (GDD §6.3). Art tuning, not a game rule.
 */
const WORK_VERBS: ReadonlySet<string> = new Set(['volunteer']);
const WORK_DWELL: readonly [number, number] = [12, 18];
/**
 * Verbs that gather residents at their place's social spots (zone `social:`, §16.4.1) instead of a spot of their own:
 * the template days' lunch and late-afternoon stops (shared/src/gathering.ts), and any plan's time in company there.
 */
export const GATHER_VERBS: ReadonlySet<string> = new Set(['socialize', 'eat']);
/**
 * Residents gathering at the same place on the same weekday share a spot when their blocks' middles fall in the same
 * three hours (12:00-15:00 holds every lunch stop, 15:00-18:00 every late-afternoon one). Art tuning, not a game rule.
 */
export const GATHER_BAND = 180;
const gatherKey = (b: Pick<DayPlanBlock, 'place' | 'startMin' | 'endMin'>): string => `${b.place}|${Math.floor((b.startMin + b.endMin) / 2 / GATHER_BAND)}`;

/** At most this many residents stand round one social spot; a bigger gathering spreads over the place's spots. */
const GROUP = 3;

/**
 * Seats for the day's gatherings: the socialize / eat blocks at the same place and in the same band are one gathering;
 * it splits into groups of two or three (one spot each, round the place's spots) and each member gets a cell of their
 * own at their group's spot. Plans with no such block are returned as they were (the executor caches timelines by plan).
 */
export function withSeats(plans: readonly DayPlan[]): DayPlan[] {
  const isGathering = (b: DayPlanBlock) => GATHER_VERBS.has(b.action) && !b.area;
  const size = new Map<string, number>();
  for (const p of plans) for (const b of p.blocks) if (isGathering(b)) size.set(gatherKey(b), (size.get(gatherKey(b)) ?? 0) + 1);
  const taken = new Map<string, number>();
  return plans.map(plan => {
    if (!plan.blocks.some(isGathering)) return plan;
    return { ...plan, blocks: plan.blocks.map(b => {
      if (!isGathering(b)) return b;
      const key = gatherKey(b), n = taken.get(key) ?? 0, groups = Math.ceil(size.get(key)! / GROUP);
      taken.set(key, n + 1);
      return { ...b, seat: { group: n % groups, groups, index: Math.floor(n / groups) } };
    }) };
  });
}
const STROLL_DWELL: readonly [number, number] = [3, 7];

/**
 * GDD-GAP: §2.3 names the districts but not how they join. §16.4.1 now lays out the four Spring boards; until
 * the other zones exist and their edges link up, a resident bound for one leaves the board by one of these
 * provisional roads (the road ends drawn at the built boards' borders). A built zone's real edge into a zone
 * always wins over this table.
 */
export const OFFBOARD_ROADS: Readonly<Record<string, Loc>> = {
  millbrook: { zone: 'old_quarter', tile: [0, 12] },    // west, the High Street out to the Millbrook road
  briar_woods: { zone: 'old_quarter', tile: [21, 35] }, // south, the cart road past the green
  station_hill: { zone: 'old_quarter', tile: [37, 0] }, // north, the cart road between Bertrand's and the Constabulary
  commons: { zone: 'market_row', tile: [30, 0] },       // north, Commons Lane from the Market Cross
  wharf: { zone: 'market_row', tile: [30, 33] },        // south, Wharf Road from the Market Cross
  offmap: { zone: 'market_row', tile: [55, 12] }        // east, Market Street out along the coast road
};

/**
 * Rooms with no street door of their own (GDD §9.5), by the building they're in. From §9.5: the mayor's
 * office is in the Town Hall, Margo's flat above the Library, Sable's above the Lantern, the pub rooms at
 * the Gull & Anchor. bakery_flat is the Fournier flat over the bakery; dunmore_flat is over Dunmore's
 * General Store. GDD-GAP: roz_flat's building isn't stated; Roz runs the Gull & Anchor, so it's above it.
 */
export const INTERIOR_HOSTS: Readonly<Record<string, string>> = {
  'old_quarter.mayor_office': 'town_hall',
  'old_quarter.margo_flat': 'library',
  'old_quarter.sable_flat': 'lantern_office',
  'market_row.bakery_flat': 'bakery',
  'market_row.dunmore_flat': 'general_store',
  'market_row.roz_flat': 'gull_and_anchor',
  'market_row.pub_rooms': 'gull_and_anchor'
};

export type PlaceRegistry = Readonly<Record<string, readonly string[]>>;
export type PlaceKind = 'open' | 'building' | 'interior' | 'offboard' | 'lane' | 'unresolved';

export interface PlaceInfo {
  /** Full place id, `zone.place`. */
  id: string;
  kind: PlaceKind;
  /** The built zone it's on; null off-board. */
  zone: string | null;
  /** The zone place whose door (or ground) is used: the host building for an interior. */
  local: string | null;
  door: Point | null;
  /** Open ground only: the cells a resident may stand on, row-major. */
  spots: readonly Point[];
  /** Off-board and lane only: the unbuilt zone (a lane home's own key), and the board cell where its road leaves. */
  offZone?: string;
  road?: Loc;
}

export interface ExecutorWorld {
  zones: Readonly<Record<string, ZoneDef>>;
  graph: ZoneGraph;
  /** The §9.5 registry (zone → place ids); used to tell unbuilt places from unknown ones. */
  registry?: PlaceRegistry;
  /** content/places/homes.yaml: where each home stands (a building's door, a lane off the board, or off-board). */
  homes?: HomeRegistry;
}

export interface Travel { from: string; to: string; progress: number }

export interface ResidentState {
  id: string;
  /** The built zone they're on, or null (off-board, or in an unbuilt zone). */
  zone: string | null;
  /** Continuous tile coordinates (cell centres at +0.5) when on a built board. */
  position: Vec | null;
  tile: Point | null;
  /** The block's verb (the next block's while on the way to it). */
  activity: PlanAction;
  /** Where they are, or where they're headed while traveling. */
  place: string;
  traveling: Travel | null;
  /** False off-board and inside a building whose door they've passed. */
  visible: boolean;
  /** Walking right now (traveling, or strolling about an open place). */
  moving: boolean;
  /** Unit direction of travel while moving. */
  facing: Vec | null;
  /** Index into the plan's blocks; -1 before the first (still on last night's). */
  block: number;
  /** While walking: the current polyline and how far along it they are (dev overlay, on-screen actors). */
  path: { points: readonly Vec[]; distance: number } | null;
  /** Where the current place (or the destination, while traveling) is on the board, if it's on one. */
  target: { zone: string; at: Vec } | null;
}

interface Journey { from: string; to: string; t0: number; t1: number }
interface Segment {
  t0: number;
  t1: number;
  zone: string | null;
  at: Vec | null;
  points: Vec[] | null;
  cum: number[] | null;
  visible: boolean;
  activity: PlanAction;
  place: string;
  block: number;
  journey: Journey | null;
  target: { zone: string; at: Vec } | null;
}

export interface Timeline {
  resident: string;
  segments: readonly Segment[];
  /** Walks the zone graph couldn't route (each "from → to"); empty when the maps are sound. */
  failures: readonly string[];
}

interface Anchor { info: PlaceInfo; zone: string | null; tile: Point | null; visible: boolean; key: string }
interface Piece { minutes: number; zone: string | null; points: Vec[] | null; visible: boolean }

const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

export class RoutineExecutor {
  /** Place ids no built zone could place (dev warnings). */
  readonly warnings = new Set<string>();
  private readonly places = new Map<string, PlaceInfo>();
  private readonly areas = new Map<string, PlaceInfo>();
  private readonly timelines = new WeakMap<DayPlan, Timeline>();
  private readonly roads = new Map<string, Loc>();
  private readonly social = new Map<string, readonly SocialSpot[]>();

  constructor(readonly world: ExecutorWorld) {}

  /** The social spots of an open place (zone `social:`), in file order. */
  socialSpots(placeId: string): readonly SocialSpot[] {
    let spots = this.social.get(placeId);
    if (!spots) {
      const info = this.resolve(placeId);
      const zone = info.kind === 'open' && info.zone ? this.world.zones[info.zone] : undefined;
      spots = zone?.social?.filter(s => s.place === placeId) ?? [];
      this.social.set(placeId, spots);
    }
    return spots;
  }

  // ── Places ────────────────────────────────────────────────────────────────

  resolve(id: string): PlaceInfo {
    let info = this.places.get(id);
    if (!info) { info = this.resolveUncached(id); this.places.set(id, info); }
    return info;
  }

  private resolveUncached(id: string): PlaceInfo {
    const dot = id.indexOf('.');
    const zoneId = dot > 0 ? id.slice(0, dot) : id, local = dot > 0 ? id.slice(dot + 1) : '';
    const zone = this.world.zones[zoneId];
    if (!zone) {
      const known = !this.world.registry || this.world.registry[zoneId]?.includes(local) === true;
      if (!known) this.warnings.add(id);
      return { id, kind: known ? 'offboard' : 'unresolved', zone: null, local: null, door: null, spots: [], offZone: zoneId, road: this.roadTo(zoneId) };
    }
    const place = zone.places.find(p => p.id === local);
    if (place) {
      const walled = zone.tiles.some(t => t.building === local);
      return walled
        ? { id, kind: 'building', zone: zoneId, local, door: place.door, spots: [] }
        : { id, kind: 'open', zone: zoneId, local, door: place.door, spots: spotsIn(zone, place.rect, place.door) };
    }
    const home = this.homeOf(zone, id, local);
    if (home) return home;
    const host = this.hostOf(zone, id, local);
    if (host) return { id, kind: 'interior', zone: zoneId, local: host.id, door: host.door, spots: [] };
    this.warnings.add(id);
    return { id, kind: 'unresolved', zone: null, local: null, door: null, spots: [], offZone: zoneId, road: this.roadTo(zoneId) };
  }

  /**
   * A place with a work area (a block's `area`): the place as resolve() has it, but stood on outdoors at the open
   * cells inside the rectangle. A place off the board, or an area with no open cells, is the place itself.
   */
  resolveArea(id: string, area: readonly [number, number, number, number]): PlaceInfo {
    const key = `${id}@${area.join(',')}`;
    let info = this.areas.get(key);
    if (!info) {
      const base = this.resolve(id);
      const zone = base.zone ? this.world.zones[base.zone] : undefined;
      const spots = zone ? spotsIn(zone, area, base.door ?? [-1, -1]) : [];
      info = zone && spots.length ? { ...base, kind: 'open', spots } : base;
      this.areas.set(key, info);
    }
    return info;
  }

  /**
   * A home on a built board, through the homes registry: inside the building that holds it (the building's own place
   * when it has one, so a flat over a shop is that shop's interior), or on a lane off the board's edge.
   */
  private homeOf(zone: ZoneDef, id: string, local: string): PlaceInfo | null {
    const host = this.world.homes?.get(id)?.host;
    if (!host || host === 'offboard') return null;
    if ('lane' in host) {
      const road: Loc = { zone: zone.id, tile: [host.lane[0], host.lane[1]] };
      return { id, kind: 'lane', zone: null, local: null, door: null, spots: [], offZone: `${zone.id}~${local}`, road };
    }
    const b = zone.town?.buildings.find(x => x.id === host.building || x.homes.includes(host.building));
    if (!b) return null;
    const place = b.id ? zone.places.find(p => p.id === b.id) : undefined;
    if (place) return { id, kind: 'interior', zone: zone.id, local: place.id, door: place.door, spots: [] };
    return b.door ? { id, kind: 'building', zone: zone.id, local, door: b.door, spots: [] } : null;
  }

  /** The building an interior is in: the §9.5 table, else an obvious name match (`bakery_flat` → `bakery`). */
  private hostOf(zone: ZoneDef, id: string, local: string): ZoneDef['places'][number] | undefined {
    const buildings = zone.places.filter(p => zone.tiles.some(t => t.building === p.id));
    const named = INTERIOR_HOSTS[id];
    if (named) return buildings.find(p => p.id === named);
    const stem = local.replace(/_(flat|rooms?|upstairs|attic|cellar|back|kitchen|loft)$/, '');
    return stem === local ? undefined : buildings.find(p => p.id === stem);
  }

  /** Where the road to an unbuilt zone leaves the board. */
  private roadTo(zoneId: string): Loc {
    let road = this.roads.get(zoneId);
    if (road) return road;
    const zones = Object.values(this.world.zones).sort((a, b) => a.id.localeCompare(b.id));
    // 0. An unknown place on a built board: off that board by its own first edge.
    const own = this.world.zones[zoneId];
    if (own) zones.sort((a, b) => Number(b === own) - Number(a === own));
    // 1. A real edge into that zone (a built map that already links to it).
    for (const zone of own ? [] : zones) {
      const portal = this.world.graph.portals[zone.id]?.find(p => p.to === zoneId);
      if (portal) { road = { zone: zone.id, tile: portal.exit }; break; }
    }
    // 2. The provisional road, if its board is built and the cell is open.
    const provisional = own ? undefined : OFFBOARD_ROADS[zoneId];
    const pz = provisional && this.world.zones[provisional.zone];
    if (!road && provisional && pz && isWalkable(pz.walkability, provisional.tile[0], provisional.tile[1])) road = provisional;
    // 3. Any way off the first board: an edge, else its first open border cell.
    if (!road) {
      const first = zones[0]!;
      const portal = this.world.graph.portals[first.id]?.[0];
      road = portal ? { zone: first.id, tile: portal.exit } : { zone: first.id, tile: firstBorderCell(first) ?? first.spawn };
    }
    this.roads.set(zoneId, road);
    return road;
  }

  private anchor(plan: DayPlan, placeId: string, block?: DayPlanBlock): Anchor {
    const area = block?.area;
    const info = area ? this.resolveArea(placeId, area) : this.resolve(placeId);
    if (!info.zone) return { info, zone: null, tile: null, visible: false, key: `off:${info.offZone}:${placeId}` };
    const gather = !area && block && GATHER_VERBS.has(block.action) ? this.socialSpots(placeId) : [];
    if (gather.length) {
      // A group to a spot; groups that must share one (a place with fewer spots) interleave, so no two share a cell.
      const seat = block!.seat, n = gather.length;
      const spot = gather[(hashString(`${gatherKey(block!)}|${plan.weekday}`) + (seat?.group ?? 0)) % n]!;
      const cell = seat ? seat.index * Math.ceil(seat.groups / n) + Math.floor(seat.group / n) : hashString(`${plan.resident}@${spot.id}`);
      const tile = spot.stand[(cell + (seat ? hashString(spot.id) : 0)) % spot.stand.length]!;
      return { info: { ...info, spots: spot.stand }, zone: info.zone, tile, visible: true, key: `${info.zone}:${tile[0]},${tile[1]}` };
    }
    const tile = info.kind === 'open' && info.spots.length > 0
      ? info.spots[hashString(`${plan.resident}@${placeId}`) % info.spots.length]!
      : info.door!;
    const visible = info.kind === 'open' || plan.outdoors === true;
    return { info, zone: info.zone, tile, visible, key: `${info.zone}:${tile[0]},${tile[1]}${area ? `@${area.join(',')}` : ''}` };
  }

  // ── Timelines ─────────────────────────────────────────────────────────────

  /** The resident's whole day, laid out once per plan (cached by plan identity). */
  timeline(plan: DayPlan): Timeline {
    let tl = this.timelines.get(plan);
    if (!tl) { tl = this.layOut(plan); this.timelines.set(plan, tl); }
    return tl;
  }

  private layOut(plan: DayPlan): Timeline {
    const segments: Segment[] = [], failures: string[] = [];
    let here = this.anchor(plan, plan.startPlace);
    let activity: PlanAction = plan.startAction, place = plan.startPlace, block = -1;
    let free = -Infinity;
    plan.blocks.forEach((b, index) => {
      if (!(b.endMin > b.startMin)) return; // a zero-length block is a no-op
      const next = this.anchor(plan, b.place, b);
      const pieces = this.journey(here, next, failures);
      const minutes = pieces.reduce((sum, p) => sum + p.minutes, 0);
      const depart = Math.max(free, b.startMin - minutes);
      this.stay(segments, plan, here, free, depart, activity, place, block);
      const journey: Journey | null = pieces.length > 0 ? { from: place, to: b.place, t0: depart, t1: depart + minutes } : null;
      const target = next.zone && next.tile ? { zone: next.zone, at: centre(next.tile) } : null;
      let t = depart;
      for (const piece of pieces) {
        segments.push({
          t0: t, t1: t + piece.minutes, zone: piece.zone, at: null, points: piece.points, cum: piece.points ? cumulative(piece.points) : null,
          visible: piece.visible, activity: b.action, place: b.place, block: index, journey, target
        });
        t += piece.minutes;
      }
      free = t;
      here = next; activity = b.action; place = b.place; block = index;
    });
    this.stay(segments, plan, here, free, Infinity, activity, place, block);
    return { resident: plan.resident, segments, failures };
  }

  /** The walk (and off-board stretches) between two anchors, in order; empty if they're the same spot. */
  private journey(from: Anchor, to: Anchor, failures: string[]): Piece[] {
    if (from.key === to.key) return [];
    const off = (minutes: number): Piece => ({ minutes, zone: null, points: null, visible: false });
    const leg = (info: PlaceInfo) => (info.kind === 'lane' ? LANE_LEG_MINUTES : OFFBOARD_LEG_MINUTES);
    const fromOff = from.zone === null, toOff = to.zone === null;
    if (fromOff && toOff && from.info.offZone === to.info.offZone) return [off(OFFBOARD_LOCAL_MINUTES)];
    const a: Loc = fromOff ? from.info.road! : { zone: from.zone!, tile: from.tile! };
    const b: Loc = toOff ? to.info.road! : { zone: to.zone!, tile: to.tile! };
    const pieces: Piece[] = [];
    if (fromOff) pieces.push(off(leg(from.info)));
    if (a.zone !== b.zone || !samePoint(a.tile, b.tile)) {
      const route = this.world.graph.route(a, b);
      if (!route) {
        failures.push(`${from.info.id} → ${to.info.id}`);
        pieces.push(off(FAILED_ROUTE_MINUTES));
      } else {
        route.legs.forEach((leg, i) => {
          let points = leg.points;
          // Off-board roads start and end at the very edge of the map, so walkers step on and off it.
          if (i === 0 && fromOff) points = [...this.edgeOf(a), ...points];
          if (i === route.legs.length - 1 && toOff) points = [...points, ...this.edgeOf(b)];
          const length = cumulative(points).at(-1)!;
          if (length > 1e-6) pieces.push({ minutes: length / TILES_PER_GAME_MINUTE, zone: leg.zone, points, visible: true });
        });
      }
    }
    if (toOff) pieces.push(off(leg(to.info)));
    return pieces;
  }

  private edgeOf(loc: Loc): Vec[] {
    const zone = this.world.zones[loc.zone]!;
    const side = borderSide(zone, loc.tile);
    return side ? [borderPoint(zone, loc.tile, side)] : [];
  }

  /** Time spent at a place: standing (or, for walk / wander on open ground, strolling and coming back). */
  private stay(out: Segment[], plan: DayPlan, at: Anchor, t0: number, t1: number, activity: PlanAction, place: string, block: number): void {
    if (!(t1 > t0)) return;
    const target = at.zone && at.tile ? { zone: at.zone, at: centre(at.tile) } : null;
    const base = { zone: at.zone, visible: at.visible && at.zone !== null, activity, place, block, journey: null, target };
    const still = (s: number, e: number, cell: Point | null) => {
      if (e > s) out.push({ ...base, t0: s, t1: e, at: cell ? centre(cell) : null, points: null, cum: null });
    };
    const spots = at.info.spots;
    const working = WORK_VERBS.has(activity);
    if (at.info.kind !== 'open' || !(STROLL_VERBS.has(activity) || working) || spots.length < 2 || !Number.isFinite(t0) || !Number.isFinite(t1) || !at.tile || !at.zone) {
      still(t0, t1, at.tile);
      return;
    }
    const nav = this.world.graph.nav[at.zone]!, home = at.tile;
    const rng = new Rng(hashString(`${plan.resident}|${place}|${Math.round(t0)}`));
    let t = t0, cell = home;
    for (let tries = 0; tries < 48; tries++) {
      const [dwellMin, dwellSpan] = working ? WORK_DWELL : STROLL_DWELL;
      const dwell = dwellMin + rng.next() * dwellSpan;
      const next = spots[rng.intRange(0, spots.length)]!;
      if (samePoint(next, cell)) continue;
      const go = nav.path(cell, next), back = nav.path(next, home);
      if (!go || !back) continue;
      if (t + dwell + (go.length + back.length) / TILES_PER_GAME_MINUTE + 1 > t1) break;
      still(t, t + dwell, cell);
      t += dwell;
      const minutes = go.length / TILES_PER_GAME_MINUTE;
      out.push({ ...base, t0: t, t1: t + minutes, at: null, points: go.points, cum: cumulative(go.points) });
      t += minutes;
      cell = next;
    }
    const back = samePoint(cell, home) ? null : nav.path(cell, home);
    if (!back) { still(t, t1, cell); return; }
    const minutes = back.length / TILES_PER_GAME_MINUTE;
    still(t, t1 - minutes, cell);
    out.push({ ...base, t0: Math.max(t, t1 - minutes), t1, at: null, points: back.points, cum: cumulative(back.points) });
  }

  // ── Sampling ──────────────────────────────────────────────────────────────

  /** Where a resident is and what they're doing at `minute` (fractional minutes interpolate smoothly). */
  stateAt(plan: DayPlan, minute: number): ResidentState {
    const segs = this.timeline(plan).segments;
    // The last segment starting at or before `minute` (the first starts at -Infinity).
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid]!.t0 <= minute) lo = mid; else hi = mid - 1; }
    const seg = segs[lo]!;
    let position: Vec | null = seg.at ? { ...seg.at } : null, facing: Vec | null = null, path: ResidentState['path'] = null;
    if (seg.points && seg.cum) {
      const span = seg.t1 - seg.t0, total = seg.cum[seg.cum.length - 1]!;
      const distance = span > 0 ? Math.min(total, Math.max(0, ((minute - seg.t0) / span) * total)) : total;
      const p = pointAlong(seg.points, seg.cum, distance);
      position = p.at; facing = p.dir; path = { points: seg.points, distance };
    }
    const j = seg.journey;
    return {
      id: plan.resident,
      zone: seg.zone,
      position: seg.zone ? position : null,
      tile: seg.zone && position ? [Math.floor(position.x), Math.floor(position.y)] : null,
      activity: seg.activity,
      place: seg.place,
      traveling: j ? { from: j.from, to: j.to, progress: j.t1 > j.t0 ? Math.min(1, Math.max(0, (minute - j.t0) / (j.t1 - j.t0))) : 1 } : null,
      visible: seg.visible,
      moving: seg.points !== null,
      facing,
      block: seg.block,
      path,
      target: seg.target
    };
  }

  statesAt(plans: readonly DayPlan[], minute: number): ResidentState[] {
    return plans.map(plan => this.stateAt(plan, minute));
  }
}

/** Cells to stand on in an open place: walkable, off the map border, and not in front of anyone's door. */
function spotsIn(zone: ZoneDef, [x0, y0, w, h]: readonly [number, number, number, number], ownDoor: Point): Point[] {
  const doors = new Set(zone.places.map(p => `${p.door[0]},${p.door[1]}`));
  doors.add(`${ownDoor[0]},${ownDoor[1]}`);
  const out: Point[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x <= 0 || y <= 0 || x >= zone.width - 1 || y >= zone.height - 1) continue;
    if (!isWalkable(zone.walkability, x, y) || doors.has(`${x},${y}`)) continue;
    out.push([x, y]);
  }
  return out;
}

function firstBorderCell(zone: ZoneDef): Point | null {
  for (let x = 0; x < zone.width; x++) if (isWalkable(zone.walkability, x, 0)) return [x, 0];
  return null;
}
