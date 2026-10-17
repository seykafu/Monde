// The town's homes door by door, as the arrivals see them (GDD §6.4, A.1.3, A.3.4 rule 1): every home on the built
// boards, what each is called in the paper, and how many beds it has (content/places/homes.yaml). Pure apart from the
// zone and homes data it reads.
import { homeLabel } from '@monde/shared';
import { buildingHomes, type HomeDirectory, type HomeKey } from '../town/occupancy';
import { homeRegistry } from './places';
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
 * "No. 47 Lamplighter Lane" for `old_quarter.vacant_house_47`, "Flat B, No. 37 Heron Lane", "the flat over the bakery":
 * the address in content/places/homes.yaml (shared/src/census/homes.ts homeLabel). A home it doesn't list (the
 * Lamplighter's Cottage, the Harbormaster's House) is named after its place id.
 */
export function homeName(key: HomeKey): string {
  const entry = homeRegistry.get(key);
  if (entry) return homeLabel(entry);
  const local = key.slice(key.indexOf('.') + 1);
  return local.split('_').map(s => s[0]!.toUpperCase() + s.slice(1)).join(' ');
}

/**
 * Beds per home (A.3.4 rule 1: a household needs `beds >= ceil(size / 2)`), from homes.yaml. The vacant houses keep
 * the beds the arrivals have always seen (three in the Old Quarter, two on the Wharf). A home it doesn't list: two.
 */
export function homeBeds(key: HomeKey): number {
  return homeRegistry.get(key)?.beds ?? 2;
}
