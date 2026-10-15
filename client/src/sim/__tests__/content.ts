// Test helper: the shipped zones, place registry and persona cards, read from content/ with fs (the game
// loads the same files through Vite imports).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { PersonaCard } from '@monde/shared';
import { compileZone, validateZoneLinks, type ZoneDef } from '../../world/zoneFormat';
import { ZoneGraph } from '../../world/nav';
import type { ExecutorWorld, PlaceRegistry } from '../routineExecutor';

const content = resolve(import.meta.dirname, '../../../..', 'content');

export function loadZones(): Record<string, ZoneDef> {
  const zones = Object.fromEntries(readdirSync(resolve(content, 'zones')).filter(f => f.endsWith('.zone.yaml')).sort().map(file => {
    const z = compileZone(readFileSync(resolve(content, 'zones', file), 'utf8'));
    return [z.id, z];
  }));
  validateZoneLinks(zones);
  return zones;
}

export const loadRegistry = (): PlaceRegistry => parse(readFileSync(resolve(content, 'places/places.yaml'), 'utf8')) as PlaceRegistry;

export function loadCards(): PersonaCard[] {
  return readdirSync(resolve(content, 'residents')).filter(f => f.endsWith('.yaml')).sort()
    .map(f => PersonaCard.parse(parse(readFileSync(resolve(content, 'residents', f), 'utf8'))));
}

export function loadWorld(): ExecutorWorld {
  const zones = loadZones();
  return { zones, graph: new ZoneGraph(zones), registry: loadRegistry() };
}
