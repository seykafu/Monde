/**
 * The Mail Round's place graphs (§15.21 "the district's place graph"), built from the real boards: every door on a
 * district's board is a node, the steps between two doors are the shortest walk on the board's walkable tiles (four
 * directions, so whole steps), and a street joins two doors when no third door sits between them (a relative
 * neighbourhood graph: sparse, connected, and only the hops a walk would make). Pure apart from reading the content.
 */
import { zones } from '../world/zones';
import { homeRegistry } from '../world/places';
import { placeName } from '../world/player';
import type { Point, ZoneDef } from '../world/zoneFormat';
import type { MailMap, MailNode } from './mailRound';

/**
 * §15.21 "any district": the boards with room for eight letters. GDD-GAP: the Commons has three doors (the glasshouse,
 * Teo's cottage, the bandstand), too few for even k = 4, so it takes no rounds.
 */
export const MAIL_DISTRICTS = ['wharf', 'market_row', 'old_quarter'] as const;
/**
 * GDD-GAP: where a round starts is unstated. On the Wharf it starts at Ada's booth; elsewhere where the walk up from her
 * booth enters the district. The round ends at its last door (no walk back to the post).
 */
const ENTERED_FROM: Readonly<Record<string, string>> = { market_row: 'wharf', old_quarter: 'market_row' };
const POST = 'ticket_booth';
/** GDD-GAP: doors that take no letters: empty houses and shopfronts (until someone moves in) and the Fellow's own cottage. */
const NO_MAIL = /^(vacant(_house_\d+)?|storefront_\d+|lamplighter_cottage)$/;

const titled = (id: string) => id.split('_').map(s => s[0]!.toUpperCase() + s.slice(1)).join(' ');
/** A business by its name; a home by its street address (content/places/homes.yaml); open ground by its place name. */
function label(district: string, id: string): string {
  const named = placeName(id);
  if (named !== titled(id)) return named;
  const home = homeRegistry.get(`${district}.${id}`);
  return home ? `${home.number} ${home.street}` : named;
}

/** Whole steps from one tile to every other (−1: cut off). */
export function stepField(zone: Pick<ZoneDef, 'width' | 'height' | 'walkability'>, [sx, sy]: Point): Int32Array {
  const { width, height } = zone, out = new Int32Array(width * height).fill(-1), queue = [sy * width + sx];
  out[queue[0]!] = 0;
  for (let q = 0; q < queue.length; q++) {
    const at = queue[q]!, x = at % width, y = (at - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, i = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || out[i] !== -1 || !zone.walkability[ny]?.[nx]) continue;
      out[i] = out[at]! + 1; queue.push(i);
    }
  }
  return out;
}

/** One district's graph. `start` is the round's first node (an existing door, or a new node at a tile). */
export function buildMailMap(zone: ZoneDef, start: { id: string; label: string; at: Point }): MailMap {
  const nodes: (MailNode & { at: Point })[] = [];
  const byTile = new Map<string, number>();
  const add = (id: string, at: Point, address: boolean, text: string) => {
    const key = `${at[0]},${at[1]}`, seen = byTile.get(key);
    // Two places at one door: the one that takes letters names it.
    if (seen !== undefined) { if (address && !nodes[seen]!.address) nodes[seen] = { ...nodes[seen]!, id, label: text, address }; return seen; }
    byTile.set(key, nodes.length);
    nodes.push({ id, label: text, x: at[0] + 0.5, y: at[1] + 0.5, address, at });
    return nodes.length - 1;
  };
  const buildings = zone.town?.buildings ?? [];
  const built = new Set(buildings.flatMap(b => b.id ? [b.id] : []));
  const startIndex = zone.places.some(p => p.id === start.id) ? -1 : add(start.id, start.at, false, start.label);
  for (const place of zone.places) add(place.id, place.door, built.has(place.id) && !NO_MAIL.test(place.id), place.id === start.id ? start.label : label(zone.id, place.id));
  for (const b of buildings) if (!b.id && b.door && b.homes.length) add(b.homes[0]!, b.door, !b.homes.every(h => NO_MAIL.test(h)), label(zone.id, b.homes[0]!));
  const first = startIndex >= 0 ? startIndex : nodes.findIndex(n => n.id === start.id);
  if (first >= 0 && nodes[first]!.address) nodes[first] = { ...nodes[first]!, address: false };
  const d = nodes.map(n => { const f = stepField(zone, n.at); return nodes.map(m => f[m.at[1] * zone.width + m.at[0]]!); });
  const edges: [number, number, number][] = [];
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const ab = d[a]![b]!;
    if (ab < 0) continue;
    // A street from a to b unless some door c is nearer to both of them than they are to each other.
    let between = false;
    for (let c = 0; c < nodes.length && !between; c++) {
      if (c === a || c === b || d[a]![c]! < 0 || d[c]![b]! < 0) continue;
      between = Math.max(d[a]![c]!, d[c]![b]!) < ab;
    }
    if (!between) edges.push([a, b, ab]);
  }
  return { district: zone.id, name: zone.name, width: zone.width, height: zone.height, start: first,
    nodes: nodes.map(({ at: _at, ...n }) => n), edges };
}

let built: readonly MailMap[] | null = null;
/** The districts' graphs, built once from the boards. */
export function mailMaps(): readonly MailMap[] {
  if (built) return built;
  built = MAIL_DISTRICTS.map(id => {
    const zone = zones[id]!;
    if (id === 'wharf') return buildMailMap(zone, { id: POST, label: 'Ada’s booth', at: zone.places.find(p => p.id === POST)!.door });
    const from = zones[ENTERED_FROM[id]!]!, edge = from.edges.find(e => e.zone === id)!;
    return buildMailMap(zone, { id: `from_${from.id}`, label: `Up from ${from.name}`, at: edge.arrive });
  });
  return built;
}
