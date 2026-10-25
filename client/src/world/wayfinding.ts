// Where the objective marker points on the board the player is on (Kasey, 2026-10-24: "an indicator of what to do to
// progress and where"). Pure: no Phaser, no DOM; quests/marker.ts draws it.
//
//   place   the objective's place is on this board: its spot (a room's place inside the room, else its door);
//   person  the objective is someone to see (a Favor to be asked, a dream's next step) and they're on this board;
//   door    the place is in a room behind a door on this board: that door;
//   exit    the place is elsewhere: indoors, the room's way out; outdoors, the edge toward the next district on the
//           way there (story/hint.ts zoneRoute, as the objective line's "→ Market Row").
// Positions are tile coordinates with tile centres at k + 0.5, as the player's are.
import { zoneRoute } from '../story/hint';
import { placeArrival, standingPlace, type DoorLink } from './interiors';
import type { Edge, ZoneDef } from './zoneFormat';

export interface GuideWorld {
  /** The districts (the zone graph). */
  zones: Readonly<Record<string, ZoneDef>>;
  interiors: Readonly<Record<string, ZoneDef>>;
  links: readonly DoorLink[];
  zoneName(id: string): string;
  /** "Fountain Square" for `old_quarter.fountain_square`. */
  placeName(place: string): string;
  personName(id: string): string;
}

export interface GuideAim {
  /** `zone.place`, or null when the objective is anywhere. */
  place: string | null;
  /** Who it involves (resident ids). */
  people: readonly string[];
  /** Point at the person over the place when they're here (someone to talk to, not a place to be). */
  preferPerson: boolean;
}

export interface GuideTarget {
  kind: 'place' | 'person' | 'door' | 'exit';
  x: number;
  y: number;
  /** A short label over the marker: "Fountain Square", "Go in: Café Liss", "→ Market Row". */
  label: string;
}

/** Where to stand to use an edge: the middle of its opening, half a tile in from the border. */
export function edgeStand(zone: Pick<ZoneDef, 'width' | 'height'>, e: Pick<Edge, 'side' | 'from' | 'to'>): { x: number; y: number } {
  const m = (e.from + e.to + 1) / 2;
  switch (e.side) {
    case 'east': return { x: zone.width - 0.5, y: m };
    case 'west': return { x: 0.5, y: m };
    case 'north': return { x: m, y: 0.5 };
    case 'south': return { x: m, y: zone.height - 0.5 };
  }
}

/** The objective kinds that are someone to see rather than somewhere to be (quests/objective.ts ObjectiveKind). */
export const PERSON_KINDS: readonly string[] = ['offer', 'dream'];

/** What the marker points at on `board` (a district or a room), or null when there's nothing to point at. */
export function guideTarget(w: GuideWorld, board: string, aim: GuideAim, personAt: (id: string) => { x: number; y: number } | null): GuideTarget | null {
  const here = w.zones[board] ?? w.interiors[board];
  if (!here) return null;
  if (aim.preferPerson) for (const id of aim.people) {
    const p = personAt(id);
    if (p) return { kind: 'person', x: p.x, y: p.y, label: w.personName(id) };
  }
  if (!aim.place) return null;
  // A flat upstairs is seen to from the shop floor under it (world/interiors.ts standingPlace).
  const arrival = placeArrival(w.zones, w.interiors, standingPlace(w.interiors, aim.place));
  if (!arrival) return null;
  const name = w.placeName(aim.place);
  if (arrival.zone === board) return { kind: 'place', x: arrival.arrive[0] + 0.5, y: arrival.arrive[1] + 0.5, label: name };
  const target = w.zones[arrival.zone] ? arrival.zone : w.interiors[arrival.zone]?.interior?.district ?? null;
  if (!target) return null;
  // Indoors: the way out (a room's one edge, to its district).
  if (here.interior) {
    const exit = here.edges[0];
    if (!exit) return null;
    const at = edgeStand(here, exit);
    return { kind: 'exit', ...at, label: target === here.interior.district ? `Out, then ${name}` : `Out → ${w.zoneName(target)}` };
  }
  // On the right district, the place is in a room: its door.
  if (target === board) {
    const link = w.links.find(l => l.interior === arrival.zone);
    return link ? { kind: 'door', x: link.outside[0] + 0.5, y: link.outside[1] + 0.5, label: `Go in: ${name}` } : null;
  }
  // Another district: the edge toward the next one on the way.
  const next = zoneRoute(w.zones, board, target)?.[0];
  const edge = next ? here.edges.find(e => e.zone === next) : undefined;
  if (!edge) return null;
  return { kind: 'exit', ...edgeStand(here, edge), label: `→ ${w.zoneName(edge.zone)}` };
}

export interface ScreenFrame {
  /** The screen's size, and the margin kept clear at each side. */
  w: number;
  h: number;
  x: number;
  top: number;
  bottom: number;
  /** Boxes the arrow keeps out of (the clock and the objective line, the menu buttons). */
  avoid?: readonly { x0: number; y0: number; x1: number; y1: number }[];
}

/**
 * The arrow at the screen's edge for a marker at (sx, sy) on screen: null while the marker is inside the margin (it
 * shows itself); else where the line from the screen's centre to it crosses the margin, and the way it points.
 */
export function edgeArrow(f: ScreenFrame, sx: number, sy: number): { x: number; y: number; angle: number } | null {
  if (sx >= f.x && sx <= f.w - f.x && sy >= f.top && sy <= f.h - f.bottom) return null;
  const cx = f.w / 2, cy = f.h / 2, dx = sx - cx, dy = sy - cy;
  const tx = dx > 0 ? (f.w - f.x - cx) / dx : dx < 0 ? (f.x - cx) / dx : Infinity;
  const ty = dy > 0 ? (f.h - f.bottom - cy) / dy : dy < 0 ? (f.top - cy) / dy : Infinity;
  const t = Math.min(tx, ty);
  let x = cx + dx * t, y = cy + dy * t;
  // In a box: slide along the edge to just past it, below it or beside it, whichever is nearer (and on screen).
  for (const a of f.avoid ?? []) {
    if (x < a.x0 || x > a.x1 || y < a.y0 || y > a.y1) continue;
    const below = a.y1 - y, beside = x - a.x0, above = y - a.y0;
    if (below <= beside && a.y1 <= f.h - f.bottom) y = a.y1;
    else if (above <= beside && a.y0 >= f.top) y = a.y0;
    else x = a.x0;
  }
  return { x, y, angle: Math.atan2(dy, dx) };
}
