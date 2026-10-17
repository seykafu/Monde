// Test helper: the shipped zones, place and homes registries and persona cards, read from content/ with fs (the game
// loads the same files through Vite imports).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { PersonaCard, parseHomes, type HomeRegistry } from '@monde/shared';
import { compileZone, validateZoneLinks, type ZoneDef } from '../../world/zoneFormat';
import { ZoneGraph } from '../../world/nav';
import type { ExecutorWorld, PlaceRegistry } from '../routineExecutor';
import { templateRoster } from '../../../../tools/census-inputs';

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
export const loadHomes = (): HomeRegistry => parseHomes(parse(readFileSync(resolve(content, 'places/homes.yaml'), 'utf8')));

/** The hand-written cards (content/residents/*.yaml, not the Day-1 census's a folder down), in file order. */
export function loadCards(): PersonaCard[] {
  return readdirSync(resolve(content, 'residents')).filter(f => f.endsWith('.yaml')).sort()
    .map(f => PersonaCard.parse(parse(readFileSync(resolve(content, 'residents', f), 'utf8'))));
}

/**
 * The Day-1 census's 188 cards (MVP M-03), by id: content/residents/day1/ once the census is written, else every
 * household's template card (tools/census-inputs.ts, built in memory and cached), so the full-roster tests run either way.
 */
export async function loadDay1Cards(): Promise<PersonaCard[]> {
  const dir = resolve(content, 'residents/day1');
  const written = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()
    .map(f => PersonaCard.parse(parse(readFileSync(resolve(dir, f), 'utf8')))) : [];
  return written.length ? written : templateRoster();
}

/** The whole town's cards in the game's order: the hand-written ones, then the Day-1 census's by id (212). */
export async function loadFullRoster(): Promise<PersonaCard[]> {
  return [...loadCards(), ...await loadDay1Cards()];
}

/**
 * For `vi.mock('…/world/residents', async importOriginal => withFullRoster(await importOriginal()))`: the game's roster
 * module with the whole Day-1 town in it, so a test that plays the game (the Spring bot, the Straw Poll) sees the same
 * 212 whether or not the census's cards are in content/ yet.
 */
export async function withFullRoster<T extends { personaCards: readonly PersonaCard[]; handWrittenCards: readonly PersonaCard[]; day1Cards: readonly PersonaCard[] }>(actual: T): Promise<T> {
  if (actual.day1Cards.length) return actual;
  const day1 = await templateRoster();
  return { ...actual, personaCards: [...actual.handWrittenCards, ...day1], day1Cards: day1 };
}

/** `n` of `items`, evenly spaced and always the same: a sample that keeps a sweep's runtime sane. */
export function sampleOf<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);
}

export function loadWorld(): ExecutorWorld {
  const zones = loadZones();
  return { zones, graph: new ZoneGraph(zones), registry: loadRegistry(), homes: loadHomes() };
}
