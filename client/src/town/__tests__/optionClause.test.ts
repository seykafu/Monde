import { SavedFriendship } from '@monde/shared';
import { applyOptionRegard, emptyFriendship } from '../../friendship/state';
import { describe, expect, it } from 'vitest';
import { OPTION_DAWNS, optionClosesPlace, optionClauseDawn, optionGauge, type OptionClauseState } from '../optionClause';
import { createTownState, setTownFlag, type TownState } from '../pillars';
import { restore, serialize, runDawn } from '../townEngine';

const fresh: OptionClauseState = { dawnsUnder: 0, exercised: false, exercisedDay: null };

/** Feed the counter one census per dawn, from Day 2. */
const dawns = (censuses: number[], oc = fresh) => {
  const triggeredOn: number[] = [];
  censuses.forEach((census, i) => {
    const r = optionClauseDawn(oc, census, i + 2);
    if (r.triggered) triggeredOn.push(i + 2);
    oc = r.state;
  });
  return { oc, triggeredOn };
};

describe('the Option Clause counter (GDD §6.5)', () => {
  it('triggers on the 7th consecutive dawn under 200', () => {
    const six = dawns([199, 199, 198, 197, 199, 199]);
    expect(six.oc).toEqual({ dawnsUnder: 6, exercised: false, exercisedDay: null });
    expect(six.triggeredOn).toEqual([]);
    const seven = dawns([199, 199, 198, 197, 199, 199, 199]);
    expect(seven.triggeredOn).toEqual([8]);
    expect(seven.oc).toEqual({ dawnsUnder: OPTION_DAWNS, exercised: true, exercisedDay: 8 });
  });

  it('resets when the census recovers to 200', () => {
    const r = dawns([199, 199, 199, 199, 199, 199, 200, 199, 199, 199, 199, 199, 199]);
    expect(r.triggeredOn).toEqual([]);
    expect(r.oc.dawnsUnder).toBe(6);
    expect(dawns([199, 199, 199, 199, 199, 199, 200, 199, 199, 199, 199, 199, 199, 199]).triggeredOn).toEqual([15]);
  });

  it('triggers once, and stops counting after', () => {
    expect(dawns(Array(20).fill(150)).triggeredOn).toEqual([8]);
  });

  it('counts nothing once the Charter voids it', () => {
    let oc = fresh;
    for (let d = 2; d < 20; d++) {
      const r = optionClauseDawn(oc, 150, d, { charter_found: true });
      expect(r.triggered).toBe(false);
      oc = r.state;
    }
    expect(oc.dawnsUnder).toBe(0);
  });

  it('runs inside runDawn on the census at dawn', () => {
    let s: TownState = { ...createTownState(), census: 196 };
    const triggered: boolean[] = [];
    for (let d = 2; d <= 9; d++) {
      const r = runDawn(s, { day: d });
      triggered.push(r.report.optionClause.triggered);
      s = r.state;
    }
    expect(triggered).toEqual([false, false, false, false, false, false, true, false]);
    expect(s.optionClause).toEqual({ dawnsUnder: 7, exercised: true, exercisedDay: 8 });
  });
});

describe('the census gauge (§6.5 UI)', () => {
  const town = (census: number, known: boolean): TownState => {
    const s = { ...createTownState(), census };
    return known ? setTownFlag(s, 'option_known') : s;
  };

  it('stays hidden until the clause is known (S08, Day 18)', () => {
    expect(optionGauge(town(190, false)).visible).toBe(false);
  });
  it('shows once known, whenever the census is under 205', () => {
    expect(optionGauge(town(210, true)).visible).toBe(false);
    expect(optionGauge(town(205, true)).visible).toBe(false);
    expect(optionGauge(town(204, true))).toMatchObject({ visible: true, census: 204, line: 200, dawnsUnder: 0, dawnsNeeded: 7 });
  });
  it('becomes known when it triggers', () => {
    const s: TownState = { ...town(190, false), optionClause: { dawnsUnder: 7, exercised: true, exercisedDay: 12 } };
    expect(optionGauge(s)).toMatchObject({ visible: true, known: true, exercised: true, exercisedDay: 12 });
  });
  it('goes away once the Charter voids the clause', () => {
    expect(optionGauge(setTownFlag(town(190, true), 'charter_found')).visible).toBe(false);
  });
});

it('G-04: a forced census drop triggers the Wharf setback once, survives save/restore, and the Charter reopens it', () => {
  let s = { ...createTownState(), census: 199 };
  for (let day = 2; day <= 7; day++) s = restore(serialize(runDawn(s, { day }).state));
  const baseline = runDawn({ ...s, census: 200 }, { day: 8 }).state;
  s = runDawn(s, { day: 8 }).state;
  expect(s.pillars.prosperity).toBeCloseTo(baseline.pillars.prosperity - 8);
  expect(s.pillars.spirit).toBeCloseTo(baseline.pillars.spirit - 4);
  expect(s.flags.option_known).toBe(true);
  for (const place of ['wharf.fish_market', 'wharf.boathouse']) expect(optionClosesPlace(s, place)).toBe(true);
  expect(optionClosesPlace(s, 'wharf.ferry_slip')).toBe(false);
  s = restore(serialize(s));
  expect(runDawn(s, { day: 9 }).report.optionClause.triggered).toBe(false);
  const reopened = setTownFlag(s, 'charter_found');
  expect(reopened.pillars.spirit).toBe(s.pillars.spirit + 6);
  expect(optionClosesPlace(reopened, 'wharf.fish_market')).toBe(false);
  expect(setTownFlag(restore(serialize(reopened)), 'charter_found').pillars).toEqual(reopened.pillars);
  expect(setTownFlag(createTownState(), 'charter_found').pillars).toEqual(createTownState().pillars);
});

it('drops Nell and every current fisher to Wary toward Pell, preserving player Regard and saved consequences', () => {
  const cards = [
    { id: 'nell', occupation: 'Shopkeeper' }, { id: 'fisher_1', occupation: 'Herring fisher' },
    { id: 'moss', occupation: 'Skipper; former herring fisher' }, { id: 'odile', occupation: 'Baker' },
  ];
  const before = { ...emptyFriendship(), regard: { nell: 70 }, resident_regard: { fisher_1: { pell: -20 } } };
  const after = SavedFriendship.parse(applyOptionRegard(before, cards));
  expect(after.resident_regard).toEqual({ nell: { pell: -1 }, fisher_1: { pell: -20 } });
  expect(after.regard).toEqual({ nell: 70 });
  expect(applyOptionRegard(after, cards)).toBe(after);
});
