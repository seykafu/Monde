// The place registry (GDD §9.5) and the homes registry (A.1.3, content/places/homes.yaml), loaded like the zones: Vite
// raw imports + the yaml parser.
import placesYaml from '../../../content/places/places.yaml?raw';
import homesYaml from '../../../content/places/homes.yaml?raw';
import { parse } from 'yaml';
import { parseHomes, type HomeRegistry } from '@monde/shared';
import type { PlaceRegistry } from '../sim/routineExecutor';

function load(text: string): PlaceRegistry {
  const raw = parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('places.yaml: expected a mapping of zone → place ids');
  for (const [zone, ids] of Object.entries(raw)) {
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error(`places.yaml: ${zone} must list place ids`);
  }
  return raw as PlaceRegistry;
}

export const placeRegistry: PlaceRegistry = load(placesYaml);
/** Every home, its address, beds and where it stands (shared/src/census/homes.ts). */
export const homeRegistry: HomeRegistry = parseHomes(parse(homesYaml));
