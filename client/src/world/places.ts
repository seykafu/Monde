// The place registry (GDD §9.5), loaded like the zones: Vite raw import + the yaml parser.
import placesYaml from '../../../content/places/places.yaml?raw';
import { parse } from 'yaml';
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
