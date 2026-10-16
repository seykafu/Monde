// Residents inside a room (MVP W-03). Pure: no Phaser, no DOM.
//
// The routine executor (sim/routineExecutor.ts) knows nothing of rooms: a resident at a building walks to its door on
// the district's board and goes in, out of sight, until their next block takes them out again. A room shows that
// stay: everybody whose routine has them inside its building (at its place or one it hosts, §9.5) stands at a spot of
// theirs in the room: a post of their own if the room gives them one (Odile behind the counter, Margo at her desk,
// Roz at the bar), else one of the room's free spots: the one a hash of who they are and where prefers, or the next free
// one if somebody's already standing there, kept for as long as they stay. They walk in from the doorway when they
// arrive and out to it when they leave, at the residents' pace; the walk takes the minutes it would, cut from the start
// (or end) of their stay, so the room agrees with the street to the minute.
//
// Out of sight indoors: rooms upstairs (a flat over the shop, `upstairs:`), and anyone asleep (in the back) unless the
// room gives them a post (Bastien by the oven).
//
// Where everyone is comes from the executor's samples alone; only who has which free spot is remembered (released when
// they leave the roster, `keep`), so two customers never stand on one spot.

import { centre, cumulative, pointAlong, ZoneNav, type Vec } from './nav';
import type { Point, ZoneDef } from './zoneFormat';
import type { ResidentState } from '../sim/routineExecutor';
import { TILES_PER_GAME_MINUTE } from '../sim/routineExecutor';
import { hashString } from '../sim/plans';

/** What the view needs of the executor: where a place is (its kind, board and host building). */
export interface PlaceResolver {
  resolve(id: string): { kind: string; zone: string | null; local: string | null };
}

/** A resident's routine state at a (fractional) minute, or null when they aren't about. */
export type Sampler = (id: string, day: number, minute: number) => ResidentState | null;

/** Where a resident's routine has them, as this room sees it. */
export type Whereabouts = 'here' | 'upstairs' | null;

interface Walk { points: Vec[]; cum: number[]; minutes: number }

/** Bisection steps when finding the minute a resident came in or goes out. */
const STEPS = 14;

export class IndoorView {
  private readonly nav: ZoneNav;
  private readonly walks = new Map<string, Walk>();
  private readonly district: string;
  private readonly building: string;
  private readonly upstairs: ReadonlySet<string>;
  private readonly posts: ReadonlySet<string>;
  /** Free spots handed out: resident → the spot (and the place it's for), and the spots taken. */
  private readonly assigned = new Map<string, { place: string; at: Point }>();
  private readonly taken = new Map<string, string>();

  constructor(readonly room: ZoneDef, private readonly resolver: PlaceResolver, private readonly sample: Sampler) {
    const def = room.interior;
    if (!def) throw new Error(`${room.id} is not a room`);
    this.district = def.district;
    this.building = def.building;
    this.upstairs = new Set(def.upstairs);
    this.posts = new Set(def.spots.flatMap(s => s.who));
    this.nav = new ZoneNav(room);
  }

  /** Is this routine state inside the room's building, and if so, on this floor or out of sight? */
  where(s: ResidentState | null): Whereabouts {
    if (!s || s.moving || s.traveling || s.zone !== this.district) return null;
    const info = this.resolver.resolve(s.place);
    if (info.zone !== this.district || info.local !== this.building || (info.kind !== 'building' && info.kind !== 'interior')) return null;
    const local = s.place.slice(s.place.indexOf('.') + 1);
    if (this.upstairs.has(local)) return 'upstairs';
    if ((s.activity === 'sleep') && !this.posts.has(s.id)) return 'upstairs';
    return 'here';
  }

  /** The tile a resident stands at in the room while their routine has them at `place`. */
  spotFor(id: string, place: string): Point {
    const def = this.room.interior!, local = place.slice(place.indexOf('.') + 1);
    const fits = (s: { place?: string }) => !s.place || s.place === local;
    const own = def.spots.find(s => s.who.includes(id) && fits(s));
    if (own) return own.at;
    const held = this.assigned.get(id);
    if (held?.place === local) return held.at;
    let pool = def.spots.filter(s => !s.who.length && fits(s));
    if (!pool.length) pool = def.spots.filter(s => !s.who.length);
    if (!pool.length) return this.room.spawn;
    const first = hashString(`${id}|${local}`) % pool.length;
    let at = pool[first]!.at;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[(first + i) % pool.length]!, key = s.at.join(',');
      const by = this.taken.get(key);
      if (by === undefined || by === id) { at = s.at; break; }
    }
    if (held) this.taken.delete(held.at.join(','));
    this.assigned.set(id, { place: local, at });
    this.taken.set(at.join(','), id);
    return at;
  }

  /** Free the spots of residents no longer in the room (the on-screen roster, once a second). */
  keep(ids: ReadonlySet<string>): void {
    for (const [id, a] of this.assigned) {
      if (ids.has(id)) continue;
      this.assigned.delete(id);
      if (this.taken.get(a.at.join(',')) === id) this.taken.delete(a.at.join(','));
    }
  }

  /** The way from the doorway to a spot (cached), and how long it takes at the residents' pace. */
  private walk(to: Point): Walk {
    const key = to.join(',');
    let w = this.walks.get(key);
    if (!w) {
      const from = this.room.spawn;
      const path = this.nav.path(from, to);
      const points = path?.points.length ? path.points : [centre(from), centre(to)];
      // Start in the doorway itself, so they come in through it.
      const door = this.room.interior!.door;
      points.unshift({ x: door[0] + 0.5, y: door[1] + 0.6 });
      const cum = cumulative(points);
      w = { points, cum, minutes: Math.max(0.5, cum[cum.length - 1]! / TILES_PER_GAME_MINUTE) };
      this.walks.set(key, w);
    }
    return w;
  }

  /** The first minute in (lo, hi] at which `inside` holds, given it doesn't at lo and does at hi. */
  private edge(id: string, day: number, lo: number, hi: number, inside: boolean): number {
    for (let i = 0; i < STEPS; i++) {
      const mid = (lo + hi) / 2;
      if ((this.where(this.sample(id, day, mid)) === 'here') === inside) hi = mid; else lo = mid;
    }
    return hi;
  }

  /**
   * The resident as the room shows them at `minute`: standing at their spot, walking in from the doorway or out to it;
   * null when their routine doesn't have them on this floor of the building.
   */
  stateAt(id: string, day: number, minute: number): ResidentState | null {
    const s = this.sample(id, day, minute);
    if (this.where(s) !== 'here') return null;
    const spot = this.spotFor(id, s!.place);
    const w = this.walk(spot);
    const total = w.cum[w.cum.length - 1]!;
    let along = total, dir: Vec | null = null, moving = false;
    if (this.where(this.sample(id, day, minute - w.minutes)) !== 'here') {
      // Coming in: they reached the door at `since`.
      const since = this.edge(id, day, minute - w.minutes, minute, true);
      const t = Math.min(1, Math.max(0, (minute - since) / w.minutes));
      if (t < 1) { along = total * t; moving = true; }
    } else if (this.where(this.sample(id, day, minute + w.minutes)) !== 'here') {
      // Going out: they're due through the door at `until`.
      const until = this.edge(id, day, minute, minute + w.minutes, false);
      const t = Math.min(1, Math.max(0, (until - minute) / w.minutes));
      if (t < 1) { along = total * t; moving = true; }
    }
    const p = pointAlong(w.points, w.cum, along);
    if (moving) {
      // Facing the way they walk: in along the path, or back out along it.
      const out = this.where(this.sample(id, day, minute - w.minutes)) === 'here';
      dir = p.dir ? (out ? { x: -p.dir.x, y: -p.dir.y } : p.dir) : null;
    }
    const at = moving ? p.at : centre(spot);
    return {
      ...s!, zone: this.room.id, position: { ...at }, tile: [Math.floor(at.x), Math.floor(at.y)], visible: true, moving, facing: dir,
      traveling: null, path: moving ? { points: w.points, distance: along } : null, target: { zone: this.room.id, at: centre(spot) }
    };
  }

  /** Who is in the room at `minute`, or will be within `lookahead` minutes (the on-screen roster). */
  roster(states: (minute: number) => readonly ResidentState[], minute: number, lookahead: number): Set<string> {
    const ids = new Set<string>();
    for (const s of states(minute)) if (this.where(s) === 'here') ids.add(s.id);
    for (const s of states(minute + lookahead)) if (this.where(s) === 'here') ids.add(s.id);
    this.keep(ids);
    return ids;
  }
}
