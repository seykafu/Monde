// G-02 arrivals and departures, the client's pass (GDD §6.4, §6.1, §6.6; town/people.ts): the Sunday house, the
// morning boat and its doors, the Stay pass and Leaving Notices, the walk to the slip, departures, the Last Chance,
// the server's households replacing the local templates, and the save round trip.
import { describe, expect, it } from 'vitest';
import { SavedTown, livingArrivals } from '@monde/shared';
import { loadCards, loadWorld, loadZones } from '../../sim/__tests__/content';
import { landingDayPlan, leavingDayPlan, FERRY_SLIP } from '../../sim/arrivalPlans';
import { dayPlan } from '../../sim/plans';
import { ResidentSim } from '../../sim/residentSim';
import { homeBeds, homeName, townHomeKeys } from '../../world/townHomes';
import type { ArrivalDecision } from '../migration';
import { directoryFromCards, occupiedFlag, vacatedFlag } from '../occupancy';
import {
  ARRIVAL_MINUTE, SAILING_MINUTE, SUNDAY_HOUSE, adoptServerArrivals, bookArrivals, departureDay, markSynced, migrationDawn,
  movementLines, peopleOf, presentAt, resolveNotice, sailingToday, templateArrivals, type MigrationWorld
} from '../people';
import { createTownState, type TownState } from '../pillars';
import { restore, serialize } from '../townEngine';

const cards = loadCards();
const dir = directoryFromCards(cards);
const HOMES = townHomeKeys(loadZones(), dir);
const world = (over: Partial<MigrationWorld> = {}): MigrationWorld => ({
  seed: 11, homes: HOMES, dir, beds: homeBeds, homeName, storyFlags: new Set(), cast: new Map(cards.map(c => [c.id, { name: c.name }])),
  friends: () => 0, regard: () => 0, ...over
});
const roll = (day: number, households: number, youthShare = 0.5): { decision: ArrivalDecision } =>
  ({ decision: { day, eligible: true, appeal: 41, wanted: households, households, youthShare, outcome: 'arrivals' } });

/** A town on `day` with the Sunday house restored (as Day 6's dawn leaves it). */
function sundayTown(day = 7): TownState {
  return migrationDawn(createTownState({ day: day - 1 }), day, world(), { decision: null }).state;
}

/** Land one household of `archetype` on `day` in `state`. */
function landOne(state: TownState, day: number, archetype: string): TownState {
  const households = templateArrivals(state, world(), day, 1, 0.5, { archetype });
  const people = peopleOf(state);
  return bookArrivals({ ...state, people: { ...people, pending: [...people.pending, ...households] } }, day, ARRIVAL_MINUTE).state;
}

describe('the Sunday house (S05)', () => {
  it('restores No. 47 Lamplighter Lane on Day 6 and frees it for the first arrival', () => {
    const before = createTownState({ day: 5 });
    const after = migrationDawn(before, 6, world(), { decision: null }).state;
    expect(after.flags).toMatchObject({ [`project_${SUNDAY_HOUSE.split('.')[1]}_done`]: true });
    expect(after.homes.restored_free).toBe(before.homes.restored_free + 1);
    expect(migrationDawn(after, 7, world(), { decision: null }).state.homes.restored_free).toBe(after.homes.restored_free);
  });
});

describe('the morning boat (§6.4)', () => {
  it('draws today\'s households into free homes, holds them on the boat until 08:00, then books them in', () => {
    const town = sundayTown(8);
    const dawn = migrationDawn(town, 8, world(), roll(8, 1));
    expect(dawn.arriving).toHaveLength(1);
    const h = dawn.arriving[0]!;
    expect(h.home).toBe(SUNDAY_HOUSE);
    expect(dawn.state.census).toBe(town.census); // not off the boat yet
    const id = h.residents[0]!.card.id;
    expect(presentAt(dawn.state, id, 8, ARRIVAL_MINUTE - 1)).toBe(false);
    expect(bookArrivals(dawn.state, 8, ARRIVAL_MINUTE - 1).booked).toEqual([]);
    const { state, booked } = bookArrivals(dawn.state, 8, ARRIVAL_MINUTE);
    expect(booked).toHaveLength(1);
    expect(state.census).toBe(town.census + h.residents.length);
    expect(state.flags).toMatchObject({ [occupiedFlag(SUNDAY_HOUSE)]: true });
    expect(state.homes.restored_free).toBe(town.homes.restored_free - 1);
    expect(presentAt(state, id, 8, ARRIVAL_MINUTE)).toBe(true);
    expect(movementLines(state, 8, homeName).lines[0]).toMatch(/has taken No\. 47 Lamplighter Lane/);
  });

  it('brings nobody without a free restored home, whatever the roll says', () => {
    const dawn = migrationDawn(createTownState({ day: 2 }), 3, world(), roll(3, 2));
    expect(dawn.arriving).toEqual([]);
  });

  it('is the same households for the same world and day (A.3.1)', () => {
    const a = migrationDawn(sundayTown(8), 8, world(), roll(8, 1)).arriving;
    const b = migrationDawn(sundayTown(8), 8, world(), roll(8, 1)).arriving;
    expect(a.map(h => h.residents.map(r => r.card.name))).toEqual(b.map(h => h.residents.map(r => r.card.name)));
  });

  it('lets the server\'s households replace the local templates before they land, and tracks what the server has', () => {
    const dawn = migrationDawn(sundayTown(8), 8, world(), roll(8, 1));
    const local = dawn.arriving[0]!;
    const server = { ...local, id: 'hh_server', generated_by: 'model' as const, residents: local.residents.map(r => ({ ...r, card: { ...r.card, id: `${r.card.id}_m`, name: 'Ilse Maertens' }, household: 'hh_server' })) };
    const adopted = adoptServerArrivals(dawn.state, 8, [server]);
    expect(peopleOf(adopted).pending.map(h => h.id)).toEqual(['hh_server']);
    expect(peopleOf(adopted).unsynced).toEqual([]);
    // Offline the templates stand and wait to be adopted; once the server lists them, they're synced.
    expect(peopleOf(dawn.state).unsynced).toEqual([local.id]);
    expect(peopleOf(markSynced(dawn.state, new Set(local.residents.map(r => r.card.id)))).unsynced).toEqual([]);
  });
});

describe('Stay, Leaving Notices and departures (§6.4)', () => {
  /** A lone newcomer with nothing to do, in a town at its lowest: Stay well under 25. */
  function lonely(): { state: TownState; id: string } {
    let state = landOne(sundayTown(8), 8, 'widowed_elder');
    state = { ...state, pillars: { prosperity: 10, safety: 10, spirit: 10, charm: 10 } };
    const resident = livingArrivals(state.people).find(r => r.card.age >= 18)!;
    return { state, id: resident.card.id };
  }

  it('gives a Leaving Notice after 5 nights under 25, and the ferry they\'d leave on', () => {
    let state = lonely().state;
    const { id } = lonely();
    const notices: number[] = [];
    for (let day = 9; day <= 13; day++) {
      const dawn = migrationDawn(state, day, world(), { decision: null });
      state = dawn.state;
      if (dawn.notices.some(n => n.resident === id)) notices.push(day);
    }
    expect(notices).toEqual([13]);
    expect(state.migration.notices[id]).toBe(13);
    expect(departureDay(13, state.flags)).toBe(15); // Day 15 is a Tuesday sailing
  });

  it('walks them to the slip on their ferry, takes them at 10:00, and lets them go at the next dawn', () => {
    const start = lonely();
    const id = start.id;
    let state = start.state;
    for (let day = 9; day <= 14; day++) state = migrationDawn(state, day, world(), { decision: null }).state;
    const census = state.census;
    const ferry = migrationDawn(state, 15, world(), { decision: null });
    expect(ferry.leaving).toContain(id);
    expect(sailingToday(ferry.state, 15).has(id)).toBe(true);
    expect(presentAt(ferry.state, id, 15, SAILING_MINUTE - 1)).toBe(true);
    expect(presentAt(ferry.state, id, 15, SAILING_MINUTE)).toBe(false);
    expect(movementLines(ferry.state, 15, homeName).lines.some(l => l.includes("leaves on this morning's Gannet"))).toBe(true);
    const next = migrationDawn(ferry.state, 16, world({ friends: () => 2 }), { decision: null });
    expect(next.departed.map(d => d.id)).toContain(id);
    expect(livingArrivals(next.state.people).some(r => r.card.id === id)).toBe(false);
    expect(next.state.census).toBeLessThan(census);
    const household = peopleOf(ferry.state).households.find(h => h.residents.some(r => r.card.id === id))!;
    if (!livingArrivals(next.state.people).some(r => r.household === household.id)) {
      expect(next.state.flags).toMatchObject({ [vacatedFlag(household.home)]: true });
      expect(next.state.homes.restored_free).toBe(ferry.state.homes.restored_free + 1);
    }
    // Well-liked (two friends in town): Spirit takes the hit.
    expect(next.state.pillars.spirit).toBeLessThan(ferry.state.pillars.spirit);
    expect(next.state.migration.notices[id]).toBeUndefined();
  });

  it('keeps them when the Last Chance Favor is done in time', () => {
    const start = lonely();
    const id = start.id;
    let state = start.state;
    for (let day = 9; day <= 14; day++) state = migrationDawn(state, day, world(), { decision: null }).state;
    const ferry = migrationDawn(state, 15, world(), { decision: null }).state;
    const saved = resolveNotice(ferry, id, 15);
    expect(presentAt(saved, id, 15, SAILING_MINUTE + 30)).toBe(true);
    const next = migrationDawn(saved, 16, world(), { decision: null });
    expect(next.departed).toEqual([]);
    expect(peopleOf(next.state).stayed.map(s => s.id)).toContain(id);
  });

  it('sends at most two a ferry day; the rest wait for the next boat', () => {
    let state = sundayTown(8);
    for (const n of [40, 41, 42, 43]) state = { ...state, flags: { ...state.flags, [`project_vacant_house_${n}_done`]: true } as TownState['flags'], homes: { ...state.homes, restored_free: state.homes.restored_free + 1 } };
    for (const a of ['widowed_elder', 'widowed_elder', 'widowed_elder', 'drifter']) state = landOne(state, 8, a);
    state = { ...state, pillars: { prosperity: 5, safety: 5, spirit: 5, charm: 5 } };
    for (let day = 9; day <= 14; day++) state = migrationDawn(state, day, world(), { decision: null }).state;
    const noticed = Object.keys(state.migration.notices).length;
    expect(noticed).toBeGreaterThan(2);
    expect(migrationDawn(state, 15, world(), { decision: null }).leaving).toHaveLength(2);
  });

  it('never gives the authored cast a Stay pass in Spring', () => {
    let state = sundayTown(8);
    state = { ...state, pillars: { prosperity: 0, safety: 0, spirit: 0, charm: 0 } };
    for (let day = 9; day <= 20; day++) state = migrationDawn(state, day, world(), { decision: null }).state;
    expect(Object.keys(state.migration.notices)).toEqual([]);
  });
});

describe('a newcomer\'s first and last day in the simulation', () => {
  it('appears on the slip at 08:00, walks home to unpack, and is gone when the boat sails', () => {
    const town = landOne(sundayTown(8), 8, 'cartographer');
    const resident = livingArrivals(town.people)[0]!;
    const sim = new ResidentSim(cards, loadWorld());
    sim.setGenerated([resident.card]);
    expect(sim.profiles.at(-1)!.id).toBe(resident.card.id);
    let state = town;
    sim.setPresence((id, day, minute) => presentAt(state, id, day, minute));
    sim.setAdjuster({ key: () => 'k', apply: plans => plans.map(p => (p.resident === resident.card.id ? landingDayPlan(p, resident.card.home) : p)) }, 'migration');
    expect(sim.sample(resident.card.id, 8, ARRIVAL_MINUTE - 5)).toBeNull();
    const landed = sim.sample(resident.card.id, 8, ARRIVAL_MINUTE + 1)!;
    expect(landed.zone).toBe('wharf');
    const home = sim.sample(resident.card.id, 8, 10 * 60 + 30)!;
    expect(home.place).toBe(resident.card.home);
    // A leaving day: at the slip from 09:30, off the board at 10:00.
    state = { ...state, migration: { ...state.migration, notices: { [resident.card.id]: 10 } }, people: { ...peopleOf(state), leaving: [{ id: resident.card.id, day: 12 }] } };
    const leaving = leavingDayPlan(dayPlan(resident.card, 'Fri'));
    expect(leaving.blocks.at(-1)).toMatchObject({ place: FERRY_SLIP, startMin: 9 * 60 + 30 });
    expect(sim.sample(resident.card.id, 12, SAILING_MINUTE + 5)).toBeNull();
  });
});

describe('saving (SavedTown.people)', () => {
  it('round-trips the generated residents, the boat and the leavers', () => {
    let state = migrationDawn(sundayTown(8), 8, world(), roll(8, 1)).state;
    state = { ...state, people: { ...peopleOf(state), leaving: [{ id: 'x', day: 12 }], stayed: [{ id: 'y', day: 9 }] } };
    const back = restore(JSON.parse(JSON.stringify(serialize(state))));
    expect(back.people).toEqual(state.people);
    expect(SavedTown.parse(JSON.parse(JSON.stringify(state))).people!.pending[0]!.residents[0]!.card.kind).toBe('arrival');
    // A save from before G-02 has no people at all, and the pass starts from nothing.
    const old = restore(JSON.parse(JSON.stringify({ ...serialize(createTownState()), people: undefined })));
    expect(old.people).toBeUndefined();
    expect(peopleOf(old).households).toEqual([]);
  });
});
