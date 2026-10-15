import { describe, expect, it } from 'vitest';
import { weekdayOf } from '../../sim/clock';
import {
  LEAVING_NIGHTS, decideArrivals, householdsForAppeal, isArrivalDay, isFerryDay, nightlyStay, settleArrivals, settleDepartures,
  stayScore, type MigrationState, type ResidentStay
} from '../migration';
import { DAY1_PILLARS, createTownState, type Pillars, type TownFlags } from '../pillars';
import { runDawn } from '../townEngine';

const TUE = 1, WED = 2, FRI = 4, SAT = 5, TUE2 = 8;

describe('sailing days (§5.3, §6.4)', () => {
  it('the Gannet sails Tue and Fri', () => {
    expect([TUE, WED, FRI, SAT, TUE2].map(weekdayOf)).toEqual(['Tue', 'Wed', 'Fri', 'Sat', 'Tue']);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(d => isFerryDay(d))).toEqual([1, 4, 8, 11]);
  });
  it('every day is eligible once the ferry runs daily or the station is open', () => {
    expect(isArrivalDay(WED)).toBe(false);
    expect(isArrivalDay(WED, { project_ferry_done: true })).toBe(true);
    expect(isFerryDay(WED, { project_ferry_done: true })).toBe(true);
    expect(isArrivalDay(WED, { station_open: true })).toBe(true);
    expect(isFerryDay(WED, { station_open: true })).toBe(false);
  });
});

describe('households per dawn (§6.4)', () => {
  it('floor((Appeal − 35) / 6) + 1 from Appeal 35', () => {
    expect([0, 34, 34.99, 35, 40.99, 41, 46.9, 47, 53].map(a => householdsForAppeal(a))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 4]);
  });
  it('×1.5, rounded up, with the station open', () => {
    expect([34, 35, 41, 47].map(a => householdsForAppeal(a, true))).toEqual([0, 2, 3, 5]);
  });
  it('reads a float-dusted 41 as 41', () => {
    expect(householdsForAppeal(40.99999999999)).toBe(2);
  });

  type Row = [appeal: number, day: number, freeHomes: number, flags: TownFlags, households: number, outcome: string];
  const rows: Row[] = [
    // Ferry day (Tue), plenty of free homes.
    [34, TUE, 10, {}, 0, 'appeal_below_35'],
    [35, TUE, 10, {}, 1, 'arrivals'],
    [41, TUE, 10, {}, 2, 'arrivals'],
    [47, TUE, 10, {}, 3, 'arrivals'],
    // Ferry day (Fri), no free homes: the hard cap.
    [34, FRI, 0, {}, 0, 'appeal_below_35'],
    [35, FRI, 0, {}, 0, 'no_free_homes'],
    [41, FRI, 0, {}, 0, 'no_free_homes'],
    [47, FRI, 0, {}, 0, 'no_free_homes'],
    // Ferry day, one free home.
    [35, TUE, 1, {}, 1, 'arrivals'],
    [41, TUE, 1, {}, 1, 'capped_by_free_homes'],
    [47, TUE, 2, {}, 2, 'capped_by_free_homes'],
    // Not a ferry day: nobody comes, whatever the Appeal.
    [34, WED, 10, {}, 0, 'no_sailing'],
    [35, WED, 10, {}, 0, 'no_sailing'],
    [41, SAT, 10, {}, 0, 'no_sailing'],
    [47, WED, 10, {}, 0, 'no_sailing'],
    // …unless the ferry runs daily or the station is open (×1.5 round up).
    [41, WED, 10, { project_ferry_done: true }, 2, 'arrivals'],
    [35, WED, 10, { station_open: true }, 2, 'arrivals'],
    [47, SAT, 10, { station_open: true }, 5, 'arrivals'],
    [47, SAT, 3, { station_open: true }, 3, 'capped_by_free_homes'],
    // Never more than 6 a day.
    [80, TUE, 20, {}, 6, 'capped_at_6'],
    [65, TUE, 20, { station_open: true }, 6, 'capped_at_6']
  ];
  it.each(rows)('Appeal %s on Day %s with %s free homes %o → %s households (%s)', (appeal, day, freeHomes, flags, households, outcome) => {
    const d = decideArrivals({ day, appeal, youthShare: 0.48, flags, freeHomes });
    expect(d.households).toBe(households);
    expect(d.outcome).toBe(outcome);
    expect(d.youthShare).toBe(0.48);
  });
});

describe('booking arrivals and departures in', () => {
  it('arrivals take free homes and grow the census by household size', () => {
    const town = { ...createTownState(), homes: { occupied: 123, vacant_restorable: 58, restored_free: 3 } };
    const s = settleArrivals(town, [2, 1]);
    expect(s.census).toBe(213);
    expect(s.homes).toEqual({ occupied: 125, vacant_restorable: 58, restored_free: 1 });
    expect(settleArrivals(town, [2, 1, 3, 4]).homes.restored_free).toBe(0); // only three homes to give
  });
  it('departures shrink the census and free the homes they empty', () => {
    const s = settleDepartures(createTownState(), ['a', 'b'], 1);
    expect(s.census).toBe(208);
    expect(s.homes).toEqual({ occupied: 122, vacant_restorable: 61, restored_free: 1 });
  });
});

describe('Stay (§6.4)', () => {
  const even = { prosperity: 0.25, safety: 0.25, spirit: 0.25, charm: 0.25 };
  const resident = (over: Partial<ResidentStay> = {}): ResidentStay =>
    ({ id: 'r', values: even, friendsInTown: 0, hasJobOrPurpose: false, yearsInMonde: 0, ...over });

  it('60 · Σ(values · Pillar / 100) + 20 · min(1, friends / 4) + 10 · job + 10 · min(1, years / 10)', () => {
    // Day 1 Pillars weighed evenly: 60 · 0.2375 = 14.25.
    expect(stayScore(resident(), DAY1_PILLARS)).toBeCloseTo(14.25);
    expect(stayScore(resident({ friendsInTown: 2, hasJobOrPurpose: true, yearsInMonde: 5 }), DAY1_PILLARS)).toBeCloseTo(14.25 + 10 + 10 + 5);
    expect(stayScore(resident({ friendsInTown: 9, yearsInMonde: 40 }), DAY1_PILLARS)).toBeCloseTo(14.25 + 20 + 10);
    const full: Pillars = { prosperity: 100, safety: 100, spirit: 100, charm: 100 };
    expect(stayScore(resident({ friendsInTown: 4, hasJobOrPurpose: true, yearsInMonde: 10 }), full)).toBeCloseTo(100);
  });
  it('weighs the town by what the resident values', () => {
    const merchant = resident({ values: { prosperity: 0.7, safety: 0.1, spirit: 0.1, charm: 0.1 } });
    // 60 · (0.7·18 + 0.1·30 + 0.1·22 + 0.1·25) / 100
    expect(stayScore(merchant, DAY1_PILLARS)).toBeCloseTo(60 * (12.6 + 3 + 2.2 + 2.5) / 100);
  });
});

describe('the Leaving Notice: Stay under 25 for 5 nights in a row (§6.4)', () => {
  const lonely: ResidentStay = { id: 'lonely', values: { prosperity: 0.25, safety: 0.25, spirit: 0.25, charm: 0.25 }, friendsInTown: 0, hasJobOrPurpose: false, yearsInMonde: 0 };
  const settled: ResidentStay = { ...lonely, id: 'settled', friendsInTown: 4, hasJobOrPurpose: true, yearsInMonde: 30 };
  const empty: MigrationState = { lowStayNights: {}, notices: {} };

  it('gives notice on the fifth low night, once', () => {
    let m = empty;
    for (let night = 1; night <= LEAVING_NIGHTS - 1; night++) {
      const r = nightlyStay(m, [lonely, settled], DAY1_PILLARS, night + 1);
      expect(r.notices).toEqual([]);
      m = r.migration;
    }
    expect(m.lowStayNights).toEqual({ lonely: 4 });
    const fifth = nightlyStay(m, [lonely, settled], DAY1_PILLARS, 6);
    expect(fifth.notices).toEqual(['lonely']);
    expect(fifth.migration.notices).toEqual({ lonely: 6 });
    expect(fifth.stay.settled).toBeGreaterThanOrEqual(25);
    const sixth = nightlyStay(fifth.migration, [lonely, settled], DAY1_PILLARS, 7);
    expect(sixth.notices).toEqual([]);
    expect(sixth.migration.notices).toEqual({ lonely: 6 });
  });

  it('starts the count again after a good night', () => {
    let m = empty;
    for (let night = 0; night < 4; night++) m = nightlyStay(m, [lonely], DAY1_PILLARS, 2 + night).migration;
    // A friend for a night: Stay 14.25 + 10 + … over 25.
    m = nightlyStay(m, [{ ...lonely, friendsInTown: 3 }], DAY1_PILLARS, 6).migration;
    expect(m.lowStayNights).toEqual({});
    for (let night = 0; night < 4; night++) {
      const r = nightlyStay(m, [lonely], DAY1_PILLARS, 7 + night);
      expect(r.notices).toEqual([]);
      m = r.migration;
    }
    expect(nightlyStay(m, [lonely], DAY1_PILLARS, 11).notices).toEqual(['lonely']);
  });

  it('runs inside runDawn when residents are passed', () => {
    let s = createTownState();
    const given: string[][] = [];
    for (let d = 2; d <= 7; d++) {
      const r = runDawn(s, { day: d, residents: [lonely, settled] });
      given.push(r.report.departures.notices);
      s = r.state;
    }
    expect(given).toEqual([[], [], [], [], ['lonely'], []]);
    expect(s.migration.notices).toEqual({ lonely: 6 });
  });
});
