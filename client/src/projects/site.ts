// Where a Project happens on the board (GDD §6.3: "Projects take place on site"). Pure: zones come in as data.
//
// A Project's `site.place` is where the player works, hands over materials and opens it; `site.work` is where the
// volunteers stand while they work: a place (what their plan says, and what they tell the server they're at) and a
// tile rectangle on its board (sim/routineExecutor.ts stands them on its open cells). A restored house's site is
// the house itself, and its work area the pavement in front of its door.
import type { ZoneDef } from '../world/zoneFormat';
import type { Progress } from './engine';
import type { ProjectDef, Rect } from './schema';

export interface Site {
  /** `zone.place` the player works at (a restored house: the house). */
  place: string;
  zone: string;
  /** The volunteers' place and tiles. */
  work: { place: string; area: Rect };
}

type Zones = Readonly<Record<string, Pick<ZoneDef, 'id' | 'places'>>>;

/** The pavement in front of a door: three tiles wide, two deep. */
export const doorArea = (door: readonly [number, number]): Rect => [Math.max(0, door[0] - 1), door[1], 3, 2];

export function siteOf(def: ProjectDef, progress: Pick<Progress, 'target'> | undefined, zones: Zones): Site | null {
  const house = def.site.place === 'house';
  const place = house ? progress?.target ?? null : def.site.place;
  if (!place) return null;
  const zone = place.slice(0, place.indexOf('.'));
  const workPlace = house ? place : def.site.work.place;
  let area = def.site.work.area;
  if (area === 'door') {
    const local = workPlace.slice(workPlace.indexOf('.') + 1);
    const door = zones[zone]?.places.find(p => p.id === local)?.door;
    if (!door) return null;
    area = doorArea(door);
  }
  return { place, zone, work: { place: workPlace, area } };
}

/** Is a tile inside a rectangle (the work area, with a margin of `pad` tiles)? */
export const inArea = ([x, y, w, h]: Rect, at: { x: number; y: number }, pad = 0): boolean =>
  at.x >= x - pad && at.x < x + w + pad && at.y >= y - pad && at.y < y + h + pad;
