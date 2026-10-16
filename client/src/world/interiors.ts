// Interiors and their doors (MVP W-03; GDD §2.3 "hand-built outdoor zones … plus interiors", §16.4). Pure: no Phaser,
// no DOM.
//
// A room (zone `kind: interior`, world/zoneFormat.ts) sits behind a building's door on its district's board. Walking
// into that door (up against the building, from its doorstep) or pressing E there fades into the room, arriving just
// inside its doorway; walking out through the doorway fades back to the same doorstep. The room's places are the
// district's (`market_row.bakery` is the bakery's shop floor, inside), so every system keyed by place ids (story
// triggers, Projects, puzzles, favors, community work, the Next hint) works the same indoors.

import type { Point, ZoneDef } from './zoneFormat';
import type { Position } from './player';

/** A building's door and the room behind it. */
export interface DoorLink {
  /** The room's board id. */
  interior: string;
  /** The district's board, and the building's place id on it. */
  district: string;
  building: string;
  /** The building's door on the district's board: where you stand to go in, and arrive coming out. */
  outside: Point;
  /** Where you arrive inside: just within the room's doorway. */
  inside: Point;
}

function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

/**
 * Join every room to its building's door: the district's board must hold the building (a building place with a door),
 * one room per building, ids distinct from the boards'. Points each room's way out at the door (its exit edge's
 * arrival). Returns the links, in room order.
 */
export function linkInteriors(zones: Readonly<Record<string, ZoneDef>>, interiors: Readonly<Record<string, ZoneDef>>): DoorLink[] {
  const links: DoorLink[] = [];
  const taken = new Map<string, string>();
  for (const room of Object.values(interiors)) {
    const def = room.interior;
    check(def, `${room.id}: not an interior`);
    check(!zones[room.id], `${room.id}: a room's id is a board's id`);
    const board = zones[def.district];
    check(board, `${room.id}: no board for district ${def.district}`);
    const place = board.places.find(p => p.id === def.building);
    check(place && board.tiles.some(t => t.building === def.building), `${room.id}: ${def.district} has no building ${def.building}`);
    const key = `${def.district}.${def.building}`;
    check(!taken.has(key), `${room.id}: ${key} already leads into ${taken.get(key)}`);
    taken.set(key, room.id);
    check(room.places.some(p => p.id === def.building), `${room.id}: the room must hold its building's own place, ${def.building}`);
    for (const p of room.places) check(p.id === def.building || !board.places.some(b => b.id === p.id), `${room.id}: ${p.id} is a place outdoors on ${def.district}`);
    const exit = room.edges[0];
    check(exit && room.edges.length === 1 && exit.zone === def.district, `${room.id}: a room's one way out is to ${def.district}`);
    exit.arrive = [place.door[0], place.door[1]];
    links.push({ interior: room.id, district: def.district, building: def.building, outside: place.door, inside: room.spawn });
  }
  return links;
}

/** The link whose door the player is beside on this board (within a tile, as the E prompt has it), if any. */
export function doorAt(links: readonly DoorLink[], zone: Pick<ZoneDef, 'id'>, p: Position): DoorLink | undefined {
  let best: DoorLink | undefined, bestD = 1;
  for (const l of links) {
    if (l.district !== zone.id) continue;
    const d = Math.hypot(p.x - l.outside[0] - 0.5, p.y - l.outside[1] - 0.5);
    if (d <= bestD) { best = l; bestD = d; }
  }
  return best;
}

/** How close to the building (tile fraction from the doorstep's back edge) walking up counts as going in. */
const PUSH = 0.3;

/**
 * Walking in: on the doorstep, pressed up against the building (moving north, within PUSH of the step's back edge, and
 * in front of the door rather than its corner).
 */
export function walkingIn(links: readonly DoorLink[], zone: Pick<ZoneDef, 'id'>, p: Position, input: Position): DoorLink | undefined {
  if (!(input.y < 0) || Math.abs(input.x) > Math.abs(input.y) * 1.5) return undefined;
  return links.find(l => l.district === zone.id && Math.floor(p.x) === l.outside[0] && Math.floor(p.y) === l.outside[1]
    && p.y - l.outside[1] <= PUSH && Math.abs(p.x - l.outside[0] - 0.5) <= 0.42);
}

/** The room that holds a place (`market_row.bakery`), if one does. */
export function roomOf(interiors: Readonly<Record<string, ZoneDef>>, place: string): ZoneDef | undefined {
  const dot = place.indexOf('.');
  if (dot < 0) return undefined;
  const district = place.slice(0, dot), local = place.slice(dot + 1);
  return Object.values(interiors).find(r => r.interior?.district === district && (r.places.some(p => p.id === local) || r.interior.upstairs.includes(local)));
}

/**
 * Where to take the player for a place: into its room (at the place's own door, where E acts on it: the bed, the
 * counter) when it has one, else to its door on its board. Undefined for a place no board knows.
 */
export function placeArrival(zones: Readonly<Record<string, ZoneDef>>, interiors: Readonly<Record<string, ZoneDef>>, place: string): { zone: string; arrive: Point } | undefined {
  const room = roomOf(interiors, place);
  const local = place.slice(place.indexOf('.') + 1);
  if (room) {
    const p = room.places.find(q => q.id === local);
    return { zone: room.id, arrive: p ? p.door : room.spawn };
  }
  const zoneId = place.slice(0, Math.max(0, place.indexOf('.')));
  const door = zones[zoneId]?.places.find(p => p.id === local)?.door;
  return door ? { zone: zoneId, arrive: door } : undefined;
}

/**
 * GDD-GAP: §16.4 plans about 30 interiors; the Spring MVP (W-03) builds the rooms its routines, scenes, riddles and
 * Projects use. Every other building on the four Spring boards stays door-only for now (its business happens at its
 * door, as before), for the reason given. A test checks every indoor place (§9.5) is in a room or listed here.
 */
export const DOOR_ONLY: readonly { place: RegExp; why: string }[] = [
  { place: /^old_quarter\.clocktower$/, why: 'the works and the stair (PZ-15; S07 plays at its door); §16.3 has a stair backdrop for later' },
  { place: /^old_quarter\.founders_house$/, why: 'the museum is locked (§2.3)' },
  { place: /^old_quarter\.st_brigids$/, why: 'the chapel: services are attended at its door' },
  { place: /^old_quarter\.pell_house$/, why: 'Pell’s home; S09 plays over its kitchen backdrop at the door' },
  { place: /^old_quarter\.(okafor_house|augusta_house)$/, why: 'residents’ homes' },
  { place: /^old_quarter\.constabulary$/, why: 'Augusta’s station; nothing in the Spring happens inside' },
  { place: /^(old_quarter|wharf)\.vacant_house_\d+$/, why: 'vacant homes (the homes Project restores them from the door)' },
  { place: /^market_row\.storefront_[1-8]$/, why: 'empty storefronts (No. 9, MR-5’s, has its room)' },
  { place: /^wharf\.cannery$/, why: 'shuttered until the cannery co-op' },
  { place: /^wharf\.ticket_booth$/, why: 'a kiosk: Ada serves through its window (the Mail Round starts there)' },
  { place: /^wharf\.lighthouse$/, why: 'the lantern room (PZ-05, WF-5) is reached from its door until the light is relit and climbed' },
  { place: /^wharf\.(nell_cottage|harbormaster_house|home_bunkhouse)$/, why: 'homes' },
  { place: /^wharf\.vane_office$/, why: 'Vane’s trailer: his scenes use its backdrop (bg_vane_trailer_interior)' },
  { place: /^commons\.(bandstand|glasshouse|teo_cottage)$/, why: 'the bandstand is open-sided; the glasshouse and Teo’s cottage open after Spring' }
];

/** Why a building is door-only (DOOR_ONLY), or undefined. */
export const doorOnly = (place: string): string | undefined => DOOR_ONLY.find(d => d.place.test(place))?.why;
