// The map of Monde (Kasey, 2026-10-24: "a teleport feature with a full map of Monde to skip to each part"). Pure: no
// Phaser, no DOM; scenes/TownMapScene.ts draws it and ZoneScene travels.
//
//   layout        every district board placed as the town connects: a board's edge opening lines up with the opening it
//                 leads to on the next board, MAP_GAP tiles apart (the road between them). Boards nothing reaches go
//                 in a row underneath, so a district added to content/zones always shows.
//   places        the named places on each board at their doors (map tiles); homes nobody lives in and the empty
//                 storefronts are `minor` (a dot, no label).
//   placeOnMap    any place id on the map: a room's place, or a flat upstairs, is its building's door on the street.
//   destination   where travel puts the player for a place or a district: into the place's room when it has one (at
//                 the place's own spot inside, world/interiors.ts placeArrival; a flat upstairs is the shop floor
//                 under it, standingPlace), else its doorstep; a district's spawn. A locked room leaves the player
//                 on its doorstep, saying why.
//   travelBlocked §5.3 stops time for scenes, dialogue, puzzles, riddles, Scuffles and menus: travel waits for all of
//                 them, and for a door or edge already fading.
import { placeArrival, roomOf, standingPlace, type DoorLink } from './interiors';
import type { TownTerrain } from './townTerrain';
import type { Edge, Point, ZoneDef, ZoneTile } from './zoneFormat';

export type MapZone = Pick<ZoneDef, 'id' | 'name' | 'width' | 'height' | 'edges' | 'places' | 'spawn'>;

export interface MapBoard { id: string; name: string; x: number; y: number; w: number; h: number }
/** Two boards joined at an edge: the openings' centres (map tiles) on each board's border. */
export interface MapLink { from: string; to: string; a: [number, number]; b: [number, number] }
export interface TownMapLayout { boards: MapBoard[]; links: MapLink[]; width: number; height: number }

/** Tiles of road drawn between two joined boards. Art tuning, not a game rule. */
export const MAP_GAP = 4;

const OPPOSITE = { east: 'west', west: 'east', north: 'south', south: 'north' } as const;

/** The centre of an edge's opening on its board's border (tile units; `from`–`to` are inclusive). */
export function edgeOpening(zone: Pick<ZoneDef, 'width' | 'height'>, e: Pick<Edge, 'side' | 'from' | 'to'>): [number, number] {
  const m = (e.from + e.to + 1) / 2;
  switch (e.side) {
    case 'east': return [zone.width, m];
    case 'west': return [0, m];
    case 'north': return [m, 0];
    case 'south': return [m, zone.height];
  }
}

/** The edge on `b` that leads back to `a` (the opposite side first; a one-way edge meets the middle of that side). */
function backEdge(b: MapZone, a: string, side: Edge['side']): Pick<Edge, 'side' | 'from' | 'to'> {
  const opposite = OPPOSITE[side], middle = Math.floor((opposite === 'east' || opposite === 'west' ? b.height : b.width) / 2);
  return b.edges.find(e => e.zone === a && e.side === opposite) ?? b.edges.find(e => e.zone === a) ?? { side: opposite, from: middle, to: middle };
}

/** Every board laid out as the town connects (map tiles, top left at 0,0). The hub (most edges) is placed first. */
export function layoutTown(zones: Readonly<Record<string, MapZone>>, gap = MAP_GAP): TownMapLayout {
  const ids = Object.keys(zones).sort((a, b) => zones[b]!.edges.length - zones[a]!.edges.length || a.localeCompare(b));
  const at = new Map<string, { x: number; y: number }>();
  const links: MapLink[] = [];
  for (const root of ids) {
    if (at.has(root)) continue;
    // A part of the town nothing joins to what's placed: a row underneath it.
    const placed = [...at].map(([id, p]) => ({ ...p, z: zones[id]! }));
    const bottom = placed.length ? Math.max(...placed.map(p => p.y + p.z.height)) + gap * 2 : 0;
    const left = placed.length ? Math.min(...placed.map(p => p.x)) : 0;
    at.set(root, { x: left, y: bottom });
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!, a = zones[id]!, pa = at.get(id)!;
      for (const e of a.edges) {
        const b = zones[e.zone];
        if (!b) continue;
        const [ax, ay] = edgeOpening(a, e), back = backEdge(b, id, e.side), [bx, by] = edgeOpening(b, back);
        if (!at.has(e.zone)) {
          const dx = e.side === 'east' ? gap : e.side === 'west' ? -gap : 0, dy = e.side === 'south' ? gap : e.side === 'north' ? -gap : 0;
          at.set(e.zone, { x: pa.x + ax + dx - bx, y: pa.y + ay + dy - by });
          queue.push(e.zone);
        }
        if (id < e.zone || !zones[e.zone]!.edges.some(f => f.zone === id)) {
          const pb = at.get(e.zone)!;
          links.push({ from: id, to: e.zone, a: [pa.x + ax, pa.y + ay], b: [pb.x + bx, pb.y + by] });
        }
      }
    }
  }
  const minX = Math.min(...[...at.values()].map(p => p.x)), minY = Math.min(...[...at.values()].map(p => p.y));
  const boards = ids.map(id => { const p = at.get(id)!, z = zones[id]!; return { id, name: z.name, x: p.x - minX, y: p.y - minY, w: z.width, h: z.height }; });
  for (const l of links) { l.a = [l.a[0] - minX, l.a[1] - minY]; l.b = [l.b[0] - minX, l.b[1] - minY]; }
  return {
    boards, links,
    width: Math.max(...boards.map(b => b.x + b.w)),
    height: Math.max(...boards.map(b => b.y + b.h))
  };
}

/** The map's inks for the ground, a muted hand-coloured palette on the Journal's paper. Art tuning. */
export const MAP_GROUND: Readonly<Record<TownTerrain, number>> = {
  sea: 0x6d9cb8, river: 0x7aa9c2, pond: 0x7aa9c2, shallows: 0x8db8c9, wet_sand: 0xd3c294, sand: 0xdcc89a, shingle: 0xb3aa98,
  road: 0xd2bb8e, gravel: 0xc9b996, cobble: 0xc2b39a, brick: 0xb88a6c, plaza: 0xddd2b8, grass: 0xa9bf84, meadow: 0xb7c88f,
  soil: 0x9c7b58, boards: 0xa88160, steps: 0xcfc4ab, weedy: 0x9faa84, floor: 0xb08a62, tile: 0xd8d0bf, flags: 0xb9b2a4, rug: 0xa45a4c, wall: 0x6b5a4a
};
/** Roofs: a few tones, picked by the building, so neighbours stand apart. */
export const MAP_ROOFS: readonly number[] = [0x8a5b45, 0x7d6250, 0x93604a, 0x84584f];
const FALLBACK_GROUND = 0xcbbf9f;

/** A tile's colour on the map: its building's roof, else its ground. */
export function mapTileColor(t: Pick<ZoneTile, 'kind' | 'building'>): number {
  if (t.building) {
    let h = 0;
    for (const c of t.building) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return MAP_ROOFS[h % MAP_ROOFS.length]!;
  }
  return t.kind ? MAP_GROUND[t.kind] : FALLBACK_GROUND;
}

export interface MapPlace {
  /** `zone.place` */
  id: string;
  zone: string;
  name: string;
  /** The door, map tiles (its centre). */
  x: number;
  y: number;
  /** A room behind the door (W-03). */
  room: boolean;
  /** An empty home or storefront: a dot without a label. */
  minor: boolean;
}

/** Places drawn as dots without a label: the vacant homes and the empty storefronts (No. 9 has its room). */
export const MINOR_PLACE = /^(vacant_house_\d+|storefront_[1-8]|home_\d+)$/;

/** Every place on the boards, at its door. */
export function mapPlaces(layout: TownMapLayout, zones: Readonly<Record<string, MapZone>>, links: readonly Pick<DoorLink, 'district' | 'building'>[],
  name: (place: string) => string): MapPlace[] {
  return layout.boards.flatMap(b => zones[b.id]!.places.map(p => ({
    id: `${b.id}.${p.id}`, zone: b.id, name: name(`${b.id}.${p.id}`), x: b.x + p.door[0] + 0.5, y: b.y + p.door[1] + 0.5,
    room: links.some(l => l.district === b.id && l.building === p.id), minor: MINOR_PLACE.test(p.id)
  })));
}

/** Where a place is on the map (a room's place or a flat upstairs: its building's door), or null if no board has it. */
export function placeOnMap(layout: TownMapLayout, zones: Readonly<Record<string, MapZone>>, interiors: Readonly<Record<string, ZoneDef>>,
  place: string): [number, number] | null {
  const room = roomOf(interiors, place);
  const zone = room?.interior?.district ?? place.slice(0, Math.max(0, place.indexOf('.')));
  const local = room?.interior?.building ?? place.slice(place.indexOf('.') + 1);
  const board = layout.boards.find(b => b.id === zone), door = zones[zone]?.places.find(p => p.id === local)?.door;
  return board && door ? [board.x + door[0] + 0.5, board.y + door[1] + 0.5] : null;
}

/** Where the player is on the map: their spot on a district, or their room's front door. */
export function playerOnMap(layout: TownMapLayout, links: readonly Pick<DoorLink, 'interior' | 'district' | 'outside'>[],
  board: string, pos: { x: number; y: number }): [number, number] | null {
  const b = layout.boards.find(q => q.id === board);
  if (b) return [b.x + Math.min(Math.max(pos.x, 0), b.w), b.y + Math.min(Math.max(pos.y, 0), b.h)];
  const link = links.find(l => l.interior === board), d = link && layout.boards.find(q => q.id === link.district);
  return link && d ? [d.x + link.outside[0] + 0.5, d.y + link.outside[1] + 0.5] : null;
}

export interface Destination {
  /** The board to restart on, and the tile to arrive at (ZoneScene's `{ zone, arrive }`). */
  zone: string;
  arrive: Point;
  /** Why it isn't quite where you asked: the room is locked, so the doorstep. */
  note: string | null;
}

export interface TravelWorld {
  zones: Readonly<Record<string, ZoneDef>>;
  interiors: Readonly<Record<string, ZoneDef>>;
  links: readonly DoorLink[];
  /** Why a room's door won't open now (scenes/zone/indoors.ts doorLocked), or null. */
  locked(link: DoorLink): string | null;
}

/** Where travel to a place (`zone.place`) or a district (`zone`) puts the player; null for somewhere no board has. */
export function destination(target: string, w: TravelWorld): Destination | null {
  if (!target.includes('.')) {
    const z = w.zones[target];
    return z ? { zone: z.id, arrive: [z.spawn[0], z.spawn[1]], note: null } : null;
  }
  const arrival = placeArrival(w.zones, w.interiors, standingPlace(w.interiors, target));
  if (!arrival) return null;
  const link = w.interiors[arrival.zone] ? w.links.find(l => l.interior === arrival.zone) : undefined;
  const locked = link ? w.locked(link) : null;
  if (link && locked) return { zone: link.district, arrive: [link.outside[0], link.outside[1]], note: locked };
  return { zone: arrival.zone, arrive: [arrival.arrive[0], arrival.arrive[1]], note: null };
}

export interface TravelState {
  /** Why the clock is held (Clock.pauseReasons); the map's and the Tasks menu's own holds don't count. */
  pauses: readonly string[];
  /** Scene keys running over the zone. */
  scenes: readonly string[];
  /** A scripted scene is under way (the story session's `active`), even between its pages. */
  storyActive: boolean;
  /** A door or edge fade is already taking the player somewhere. */
  moving: boolean;
}

/** The holds of the map and the Tasks menu: open menus, which travel closes. */
export const TRAVEL_MENU_HOLDS: readonly string[] = ['map', 'tasks'];
const PUZZLE_HOLDS = ['puzzle', 'puzzle-choice', 'work-puzzle'];
const WORK_HOLDS = ['community-work', 'project', 'project-choice', 'project-work'];

/** Why the player can't travel now (§5.3: time is stopped for something), or null when they can. */
export function travelBlocked(s: TravelState): string | null {
  const held = (keys: readonly string[]) => keys.some(k => s.pauses.includes(k) || s.scenes.includes(k));
  if (s.moving) return 'You’re already on your way.';
  if (s.storyActive || held(['story', 'Story', 'Fellowship'])) return 'Not while a scene is playing.';
  if (held(['dialogue', 'Dialogue'])) return 'Not in the middle of a conversation.';
  if (held(['scuffle', 'Scuffle'])) return 'Not during a Scuffle.';
  if (held([...PUZZLE_HOLDS, 'SpringPuzzle', 'WorkPuzzle'])) return 'Finish the puzzle first.';
  if (held([...WORK_HOLDS, 'ProjectBeat'])) return 'Not in the middle of work.';
  if (s.pauses.some(p => !TRAVEL_MENU_HOLDS.includes(p))) return 'Not while time is stopped.';
  return null;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * The point to move a map selection to when an arrow is pressed: the nearest one in that direction (within a 60°
 * cone each side, nearer the axis preferred), or null at the edge of the map.
 */
export function nearestInDirection<T extends { x: number; y: number }>(points: readonly T[], from: { x: number; y: number }, dir: Direction): T | null {
  const [ux, uy] = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
  let best: T | null = null, bestScore = Infinity;
  for (const p of points) {
    const dx = p.x - from.x, dy = p.y - from.y;
    const along = dx * ux + dy * uy, across = Math.abs(dx * uy - dy * ux);
    if (along <= 0.01 || across > along * 1.75) continue;
    const score = along + across * 2;
    if (score < bestScore) { best = p; bestScore = score; }
  }
  return best;
}
