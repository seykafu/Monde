// Who lives where (town/occupancy.ts): the homes on each board, the Day-1 numbers per district (Appendix A.1.3)
// and the move-in hook a vacant home swaps state through (G-02).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { compileZone, type ZoneDef } from '../../world/zoneFormat';
import { metaOf, resolveState } from '../../world/townSprites';
import {
  buildingHomes, countHomes, directoryFromCards, freeHomes, homeKind, isLit, isOccupied, occupiedFlag, occupyHomes,
  settleArrivalsAt, settleDeparturesFrom, vacatedFlag, vacateHomes, type HomeDirectory, type OccupancyLook
} from '../occupancy';
import { createTownState, type TownState } from '../pillars';

const content = resolve(import.meta.dirname, '../../../..', 'content');
const cards = readdirSync(resolve(content, 'residents')).filter(f => f.endsWith('.yaml'))
  .map(f => parse(readFileSync(resolve(content, 'residents', f), 'utf8')) as { id: string; home: string });
const dir: HomeDirectory = directoryFromCards(cards);
const zones: Record<string, ZoneDef> = Object.fromEntries(readdirSync(resolve(content, 'zones')).filter(f => f.endsWith('.zone.yaml'))
  .map(f => { const z = compileZone(readFileSync(resolve(content, 'zones', f), 'utf8')); return [z.id, z]; }));

const look = (...flags: string[]): OccupancyLook => ({ flag: f => flags.includes(f) });
/** The town engine's flags as the board's TownLook sees them. */
const townLook = (town: TownState, ...story: string[]): OccupancyLook => ({ flag: f => story.includes(f) || (town.flags as Record<string, boolean>)[f] === true });
const homesOf = (z: ZoneDef) => z.town!.buildings.flatMap(b => buildingHomes(z.id, b, dir));

describe('the home directory', () => {
  it('reads the cards: Bastien is a cat and Vane has no bed in town until Day 48 (A.1, §9.5)', () => {
    expect(dir.residents.get('old_quarter.okafor_house')).toEqual(expect.arrayContaining(['ada', 'tib']));
    expect([...dir.residents.values()].flat()).not.toContain('bastien');
    expect([...dir.residents.values()].flat()).not.toContain('vane');
    expect(dir.later).toContainEqual({ home: 'wharf.harbormaster_house', resident: 'vane', flag: 'vane_resident' });
  });

  it('sorts homes into residents\', the Fellow\'s, census households and vacant ones', () => {
    expect(homeKind('old_quarter.pell_house', dir)).toBe('resident');
    expect(homeKind('market_row.roz_flat', dir)).toBe('resident');
    expect(homeKind('wharf.harbormaster_house', dir)).toBe('resident');
    expect(homeKind('old_quarter.lamplighter_cottage', dir)).toBe('player');
    expect(homeKind('market_row.home_04', dir)).toBe('household');
    expect(homeKind('market_row.dunmore_flat', dir)).toBe('household');
    expect(homeKind('wharf.vacant_house_50', dir)).toBe('vacant');
    expect(homeKind('wharf.vacant', dir)).toBe('vacant');
  });
});

describe('who is home', () => {
  it('lights census households and residents\' homes, not vacant ones; the Fellow from S01c, Vane from Day 48', () => {
    expect(isOccupied('market_row.home_04', dir, look())).toBe(true);
    expect(isOccupied('old_quarter.okafor_house', dir, look())).toBe(true);
    expect(isOccupied('old_quarter.vacant_house_46', dir, look())).toBe(false);
    expect(isOccupied('old_quarter.lamplighter_cottage', dir, look())).toBe(false);
    expect(isOccupied('old_quarter.lamplighter_cottage', dir, look('cottage_keys_given'))).toBe(true);
    expect(isOccupied('wharf.harbormaster_house', dir, look())).toBe(false);
    expect(isOccupied('wharf.harbormaster_house', dir, look('vane_resident'))).toBe(true);
  });

  it('follows the doors the engine books: moved in, moved out, a plain vacant home never', () => {
    expect(isOccupied('old_quarter.vacant_house_46', dir, look(occupiedFlag('old_quarter.vacant_house_46')))).toBe(true);
    expect(isOccupied('market_row.home_04', dir, look(vacatedFlag('market_row.home_04')))).toBe(false);
    expect(isOccupied('wharf.vacant', dir, look(occupiedFlag('wharf.vacant')))).toBe(false);
  });

  it('keeps a workplace lit while it trades, an empty shop dark until it reopens, a home lit by its people', () => {
    const shop = { id: 'storefront_3', homes: [], faded: false, unlit: false };
    expect(isLit(shop, dir, look())).toBe(false);
    expect(isLit(shop, dir, look('project_storefront_3_done'))).toBe(true);
    expect(isLit({ id: 'town_hall', homes: [], faded: false, unlit: false }, dir, look())).toBe(true);
    expect(isLit({ id: 'cannery', homes: [], faded: true, unlit: false }, dir, look())).toBe(false);
    expect(isLit({ id: 'vane_office', homes: [], faded: false, unlit: true }, dir, look())).toBe(false);
    // Old Moss lives in the boathouse: lit though nobody works there after dark.
    expect(isLit({ id: 'boathouse', homes: ['wharf.boathouse'], faded: false, unlit: true }, dir, look())).toBe(true);
    expect(isLit({ homes: ['old_quarter.vacant_house_40'], faded: true, unlit: false }, dir, look())).toBe(false);
  });
});

describe('moving in and out (G-02)', () => {
  it('books arrivals into doors: the census, the counts and the flags the board reads', () => {
    let town = createTownState();
    town = { ...town, homes: { ...town.homes, vacant_restorable: 59, restored_free: 2 } };
    const free = freeHomes(['old_quarter.vacant_house_45', 'old_quarter.vacant_house_46', 'old_quarter.vacant_house_47'], dir,
      look('project_vacant_house_46_done', 'project_vacant_house_47_done'));
    expect(free).toEqual(['old_quarter.vacant_house_46', 'old_quarter.vacant_house_47']);
    const after = settleArrivalsAt(town, [{ home: 'old_quarter.vacant_house_47', size: 2 }]);
    expect(after.census).toBe(212);
    expect(after.homes).toEqual({ occupied: 124, vacant_restorable: 59, restored_free: 1 });
    expect(isOccupied('old_quarter.vacant_house_47', dir, townLook(after))).toBe(true);
    // More households than free homes: the rest are not housed.
    expect(settleArrivalsAt(town, [1, 1, 1].map((size, i) => ({ home: `old_quarter.home_0${i + 1}`, size }))).homes.occupied).toBe(125);
    const left = settleDeparturesFrom(after, ['someone', 'their_partner'], ['old_quarter.vacant_house_47']);
    expect(left.census).toBe(210);
    expect(left.homes).toEqual({ occupied: 123, vacant_restorable: 59, restored_free: 2 });
    expect(isOccupied('old_quarter.vacant_house_47', dir, townLook(left))).toBe(false);
    expect(freeHomes(['old_quarter.vacant_house_47'], dir, townLook(left, 'project_vacant_house_47_done'))).toEqual(['old_quarter.vacant_house_47']);
  });

  it('swaps a vacant house on the board: faded and dark, then restored and lit once a household moves in', () => {
    const zone = zones.old_quarter!;
    const b = zone.town!.buildings.find(x => x.id === 'vacant_house_47')!;
    const homes = buildingHomes(zone.id, b, dir);
    const state = (t: TownState) => {
      const l = townLook(t);
      const art = resolveState({ id: b.id, sprite: b.sprite, state: b.state, homes }, l);
      return { art, lit: isLit({ id: b.id, homes, faded: art === 'faded', unlit: !!metaOf(b.sprite).unlit }, dir, l) };
    };
    const day1 = createTownState();
    expect(state(day1)).toEqual({ art: 'faded', lit: false });
    const movedIn = occupyHomes(day1, homes);
    expect(state(movedIn)).toEqual({ art: 'restored', lit: true });
    expect(state(vacateHomes(movedIn, homes))).toEqual({ art: 'faded', lit: false });
  });
});

describe('the Spring boards (Appendix A.1.3)', () => {
  // Households and vacant homes per district on Day 1. A board shows part of its district, never more.
  const census: Record<string, { households: number; vacant: number }> = {
    old_quarter: { households: 29, vacant: 9 }, market_row: { households: 19, vacant: 0 },
    wharf: { households: 19, vacant: 8 }, commons: { households: 3, vacant: 0 }
  };

  it('gives every house an occupancy source: a resident, the Fellow, a census household or vacant', () => {
    for (const z of Object.values(zones)) for (const b of z.town!.buildings) {
      if (!metaOf(b.sprite).dwelling) continue;
      expect(buildingHomes(z.id, b, dir).length, `${z.id} ${b.id ?? b.sprite} at ${b.at.join(',')}`).toBeGreaterThan(0);
    }
  });

  it('keeps each district\'s Day-1 numbers and mood: the Old Quarter mostly lived in, Market Row\'s homes all lived in, the Wharf thinning', () => {
    const n = Object.fromEntries(Object.values(zones).map(z => [z.id, countHomes(homesOf(z), dir, look())]));
    for (const [id, c] of Object.entries(census)) {
      const board = n[id]!;
      expect(board.vacant, id).toBe(c.vacant); // every vacant home of the district is on its board (§9.5 registry)
      expect(board.resident + board.household, id).toBeLessThanOrEqual(c.households);
    }
    expect(n.old_quarter!.lit).toBeGreaterThan(n.old_quarter!.vacant);
    expect(n.market_row!.vacant).toBe(0);
    expect(n.wharf!.lit).toBeGreaterThanOrEqual(Math.round(n.wharf!.vacant * 0.75));
    expect(n.wharf!.lit).toBeLessThan(n.wharf!.vacant + 1);
  });

  it('names census households home_NN once per board', () => {
    for (const z of Object.values(zones)) {
      const ids = homesOf(z).filter(h => /\.home_\d\d$/.test(h));
      expect(new Set(ids).size, z.id).toBe(ids.length);
    }
  });
});
