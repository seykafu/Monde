// The town's homes door by door, as the arrivals see them (GDD §6.4, A.1.3, A.3.4 rule 1): every home on the built
// boards, what each is called in the paper, and how many beds it has. Pure apart from the zone data it reads.
import { buildingHomes, type HomeDirectory, type HomeKey } from '../town/occupancy';
import type { ZoneDef } from './zoneFormat';

/** Every home on these boards, board by board in the zones' order (occupancy.ts buildingHomes). */
export function townHomeKeys(zones: Readonly<Record<string, ZoneDef>>, dir: HomeDirectory): HomeKey[] {
  const keys: HomeKey[] = [];
  for (const zone of Object.values(zones)) {
    for (const b of zone.town?.buildings ?? []) for (const key of buildingHomes(zone.id, b, dir)) if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * The streets the vacant stock stands on (the zone files' comments, §16.4.1): Heron Lane (39), Bell Row (40–44) and
 * Lamplighter Lane (45–47) in the Old Quarter; Net Lane (48–51) and Quay Street (52–55) on the Wharf.
 */
const STREETS: readonly { from: number; to: number; street: string }[] = [
  { from: 39, to: 39, street: 'Heron Lane' }, { from: 40, to: 44, street: 'Bell Row' }, { from: 45, to: 47, street: 'Lamplighter Lane' },
  { from: 48, to: 51, street: 'Net Lane' }, { from: 52, to: 55, street: 'Quay Street' }
];

/** "No. 47 Lamplighter Lane" for `old_quarter.vacant_house_47`; a named place otherwise. */
export function homeName(key: HomeKey): string {
  const n = Number(/vacant_house_(\d+)$/.exec(key)?.[1]);
  if (Number.isFinite(n) && n > 0) {
    const street = STREETS.find(s => n >= s.from && n <= s.to)?.street;
    return street ? `No. ${n} ${street}` : `No. ${n}`;
  }
  const local = key.slice(key.indexOf('.') + 1);
  return local.split('_').map(s => s[0]!.toUpperCase() + s.slice(1)).join(' ');
}

/**
 * Beds per home (A.3.4 rule 1: a household needs `beds >= ceil(size / 2)`).
 * GDD-GAP: homes carry no bed counts yet. The Old Quarter's and Market Row's terraced townhouses have three; the
 * Wharf's fishermen's cottages two; anything else two.
 */
export function homeBeds(key: HomeKey): number {
  return key.startsWith('old_quarter.') || key.startsWith('market_row.') ? 3 : 2;
}
