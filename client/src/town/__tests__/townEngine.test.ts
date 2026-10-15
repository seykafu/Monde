import { describe, expect, it } from 'vitest';
import { MARKET_DAY_STALL_FEES, fundDay, isMarketDay, postToFund } from '../fund';
import { applyPillarDelta, createTownState, setTollmenLevelMax, setTownFlag, todayChange } from '../pillars';
import { runDawn, runDawnsThrough } from '../townEngine';

describe('the Town Fund (GDD §6.3)', () => {
  it('collects 1 coin per occupied household a day', () => {
    expect(fundDay(1, 123)).toMatchObject({ rates: 123, stallFees: 0, upkeep: [], net: 123 });
  });
  it('adds stall fees on market days (Saturdays)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].filter(isMarketDay)).toEqual([5, 12]);
    expect(fundDay(5, 123)).toMatchObject({ stallFees: MARKET_DAY_STALL_FEES, net: 123 + MARKET_DAY_STALL_FEES });
  });
  it('charges upkeep once the thing exists: streetlights 10, ferry fuel 20, clinic 15', () => {
    const f = fundDay(2, 123, { project_streetlights_done: true, project_ferry_done: true, clinic_open: true });
    expect(f.upkeep).toEqual([{ id: 'streetlights', coins: 10 }, { id: 'ferry_fuel', coins: 20 }, { id: 'clinic', coins: 15 }]);
    expect(f.net).toBe(123 - 45);
  });
  it('takes extra upkeep through the hook', () => {
    expect(fundDay(2, 100, {}, [{ id: 'bandstand_lamps', coins: 4 }]).net).toBe(96);
  });
  it('posts one-off entries', () => {
    expect(postToFund(createTownState(), -200).fund).toBe(1600);
  });
});

describe('runDawn', () => {
  it('runs drift → appeal → arrivals → option clause → fund, and reports it', () => {
    const { state, report } = runDawn(createTownState(), { day: 2 });
    expect(state.day).toBe(2);
    expect(report).toMatchObject({ day: 2, weekday: 'Wed', date: 'Wed · Spring 2', census: 210 });
    // Drift: Spirit +0.2 (the Tollmen level was 1 on Day 1, so Safety holds).
    expect(report.pillarChanges.spirit).toEqual({ from: 22, to: 22.2, delta: 0.2, drift: 0.2 });
    expect(report.pillarChanges.safety).toEqual({ from: 30, to: 30, delta: 0, drift: 0 });
    // Appeal on the drifted Pillars, Momentum from Day 1.
    expect(report.appeal.youth).toBeCloseTo(22.35);
    expect(report.appeal.elder).toBeCloseTo(24.65);
    expect(report.appeal.momentum).toBeCloseTo(0.6 * 0.05);
    // Wednesday: no sailing.
    expect(report.arrivals).toMatchObject({ eligible: false, households: 0, outcome: 'no_sailing' });
    // Day 1's books: 123 households.
    expect(report.fund).toMatchObject({ before: 1800, after: 1923 });
    expect(state.fund).toBe(1923);
    expect(report.optionClause).toMatchObject({ dawnsUnder: 0, triggered: false, exercised: false });
    expect(report.optionClause.gauge.visible).toBe(false);
  });

  it('reports yesterday’s changes plus the night’s drift, and starts today’s change from zero-plus-drift', () => {
    let s = createTownState();
    s = applyPillarDelta(s, 'charm', 6, 'project', 'fountain');
    s = setTollmenLevelMax(s, 2);
    const { state, report } = runDawn(s, { day: 2 });
    expect(report.pillarChanges.charm).toEqual({ from: 25, to: 31, delta: 6, drift: 0 });
    expect(report.pillarChanges.safety).toEqual({ from: 30, to: 29.7, delta: -0.3, drift: -0.3 });
    expect(todayChange(state)).toEqual({ prosperity: 0, safety: -0.3, spirit: 0.2, charm: 0 });
    expect(state.dayStart.charm).toBe(31);
  });

  it('keeps seven days of dawn history (plus today) and seven days of log', () => {
    let s = createTownState();
    for (let d = 2; d <= 12; d++) {
      s = applyPillarDelta(s, 'charm', 1, 'riddle');
      s = runDawn(s, { day: d }).state;
    }
    expect(s.history.map(h => h.day)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Math.min(...s.log.map(c => c.day))).toBe(6);
  });

  it('refuses a day that has already dawned', () => {
    const s = runDawn(createTownState(), { day: 2 }).state;
    expect(() => runDawn(s, { day: 2 })).toThrow(RangeError);
    expect(() => runDawn(s, { day: 1 })).toThrow(RangeError);
  });

  it('runs every skipped night on a jump', () => {
    const { state, reports } = runDawnsThrough(createTownState(), 6);
    expect(reports.map(r => r.day)).toEqual([2, 3, 4, 5, 6]);
    expect(state.pillars.spirit).toBe(23);
    expect(state.fund).toBe(1800 + 5 * 123 + MARKET_DAY_STALL_FEES);
  });

  it('decides arrivals on the dawn’s Appeal and free homes, without booking anyone in', () => {
    let s = createTownState();
    s = { ...s, homes: { ...s.homes, restored_free: 2 } };
    s = applyPillarDelta(s, 'charm', 30, 'dev');
    s = applyPillarDelta(s, 'prosperity', 20, 'dev');
    s = runDawnsThrough(s, 3).state; // Thursday
    const { state, report } = runDawn(s, { day: 4 }); // Friday: the Gannet sails
    expect(report.appeal.appeal).toBeGreaterThan(35);
    expect(report.arrivals).toMatchObject({ eligible: true, wanted: 2, households: 2, outcome: 'arrivals' });
    expect(report.arrivals.youthShare).toBeCloseTo(report.appeal.youth / (report.appeal.youth + report.appeal.elder));
    expect(state.census).toBe(210);
    expect(state.homes.restored_free).toBe(2);
  });

  it('reads the flags: streetlights add Elder Appeal and upkeep', () => {
    const s = setTownFlag(createTownState(), 'project_streetlights_done');
    const { report } = runDawn(s, { day: 2 });
    expect(report.appeal.elder).toBeCloseTo(24.65 + 3);
    expect(report.fund.books.net).toBe(123 - 10);
  });
});
