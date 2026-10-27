// What a board needs from the town's sprites, and which boards to fetch ahead of the player. Pure: no Phaser, no DOM.
//
// A zone loads only its own board's art (render/town/TownBoard.ts preloadTownSprites), not the whole town's: the Old
// Quarter's buildings and props are a third of the 160 files. Every state of each sprite comes too, so a Project that
// restores a building mid-visit swaps its art in place without a wait. Hedges, walls and fences are painted in code
// (render/town/lineArt.ts) and need no file. The other boards follow in idle time, nearest first (boot/textureFetch.ts),
// so a door or a district edge rarely waits on the network.

import { DRESSING } from '../finale/fair';
import type { DoorLink } from './interiors';
import { TOWN_MANIFEST, spriteFile } from './townSprites';
import type { ZoneDef } from './zoneFormat';

/** Props drawn as autotiled runs in code (render/town/lineArt.ts LINE_SPRITES), not from their files. */
const PAINTED = new Set(['hedge', 'stone_wall', 'fence']);

/** Sprites a board shows that its zone file doesn't list: the Bloom Fair's dressing on the Commons (finale/fair.ts). */
const EXTRAS: Readonly<Record<string, readonly string[]>> = { commons: DRESSING.map(d => d.sprite) };

/** The town sprite files (`bakery`, `fountain__faded`) a board draws, sorted. Empty for a board without town art. */
export function boardSpriteFiles(zone: ZoneDef): string[] {
  const town = zone.town;
  if (!town) return [];
  const sprites = new Set<string>([...town.buildings.map(b => b.sprite), ...town.props.map(p => p.sprite), ...(EXTRAS[zone.id] ?? [])]);
  if (town.buildings.some(b => b.datestone !== undefined)) sprites.add('datestone');
  const files = new Set<string>();
  for (const sprite of sprites) {
    const art = TOWN_MANIFEST[sprite];
    if (!art || PAINTED.has(sprite)) continue;
    for (const state of art.states) files.add(spriteFile(sprite, state));
  }
  return [...files].sort();
}

/** Every board's neighbours: the boards across its edges, its rooms (doors in), and the district a room opens onto. */
export function boardLinks(boards: Readonly<Record<string, ZoneDef>>, doors: readonly DoorLink[]): Map<string, string[]> {
  const links = new Map<string, Set<string>>(Object.keys(boards).map(id => [id, new Set<string>()]));
  const join = (a: string, b: string) => { if (a !== b && links.has(a) && links.has(b)) { links.get(a)!.add(b); links.get(b)!.add(a); } };
  for (const board of Object.values(boards)) for (const edge of board.edges) join(board.id, edge.zone);
  for (const door of doors) join(door.district, door.interior);
  return new Map([...links].map(([id, next]) => [id, [...next].sort()]));
}

/**
 * The other boards in the order to fetch them: breadth-first from `from` (its neighbours, then theirs), districts
 * before rooms at the same distance (a district is a bigger wait and the more likely next step), then by id. Boards no
 * path reaches come last.
 */
export function prefetchOrder(from: string, boards: Readonly<Record<string, ZoneDef>>, links: ReadonlyMap<string, readonly string[]>): string[] {
  const distance = new Map<string, number>([[from, 0]]);
  for (let queue = [from]; queue.length;) {
    const next: string[] = [];
    for (const id of queue) for (const n of links.get(id) ?? []) if (!distance.has(n)) { distance.set(n, distance.get(id)! + 1); next.push(n); }
    queue = next;
  }
  const rank = (id: string) => distance.get(id) ?? Infinity;
  return Object.keys(boards).filter(id => id !== from)
    .sort((a, b) => rank(a) - rank(b) || Number(!!boards[a]!.interior) - Number(!!boards[b]!.interior) || a.localeCompare(b));
}
