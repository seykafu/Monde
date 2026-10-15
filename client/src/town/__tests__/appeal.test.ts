import { describe, expect, it } from 'vitest';
import { computeAppeal, elderAppeal, momentumBase, momentumFrom, sevenDayGains, youthAppeal } from '../appeal';
import {
  DAY1_CENSUS, DAY1_FUND, DAY1_HOMES, DAY1_PILLARS, createTownState,
  type PillarSnapshot, type Pillars, type TownState
} from '../pillars';

const at = (day: number, pillars: Pillars): PillarSnapshot => ({ day, pillars });
const plus = (p: Pillars, d: Partial<Pillars>): Pillars =>
  ({ prosperity: p.prosperity + (d.prosperity ?? 0), safety: p.safety + (d.safety ?? 0), spirit: p.spirit + (d.spirit ?? 0), charm: p.charm + (d.charm ?? 0) });

describe('Day 1 (GDD §2.4, §6.2)', () => {
  const town = createTownState();

  it('starts with the §2.4 numbers', () => {
    expect(town.day).toBe(1);
    expect(town.pillars).toEqual({ prosperity: 18, safety: 30, spirit: 22, charm: 25 });
    expect(town.census).toBe(210);
    expect(town.fund).toBe(1800);
    expect(town.homes).toEqual({ occupied: 123, vacant_restorable: 61, restored_free: 0 });
    expect([DAY1_CENSUS, DAY1_FUND, DAY1_HOMES.vacant_restorable]).toEqual([210, 1800, 61]);
    expect(town.tollmenLevelMax).toBe(1);
  });

  it('reproduces Youth 22.3, Elder 24.6, Momentum 0, Appeal ≈ 23.45', () => {
    const a = computeAppeal(town);
    expect(a.youth).toBeCloseTo(22.3, 10);
    expect(a.elder).toBeCloseTo(24.6, 10);
    expect(a.momentum).toBe(0);
    expect(a.appeal).toBeCloseTo(23.45, 10);
    expect(Math.round(a.appeal)).toBe(23); // "Appeal ≈ 23"
  });

  it('splits the arrival mix by audience: youth / (youth + elder)', () => {
    expect(computeAppeal(town).youthShare).toBeCloseTo(22.3 / 46.9, 10);
  });

  it('does not share Day-1 objects between towns', () => {
    const a = createTownState(), b = createTownState();
    a.pillars.charm = 99;
    expect(b.pillars.charm).toBe(25);
    expect(DAY1_PILLARS.charm).toBe(25);
  });
});

describe('Appeal bonuses (§6.2)', () => {
  const p = DAY1_PILLARS;
  it('youth: station +10, daily ferry +5, open jobs up to +10, school saved +5 (§6.3)', () => {
    expect(youthAppeal(p, { station_open: true }) - youthAppeal(p)).toBeCloseTo(10);
    expect(youthAppeal(p, { project_ferry_done: true }) - youthAppeal(p)).toBeCloseTo(5);
    expect(youthAppeal(p, {}, 8) - youthAppeal(p)).toBeCloseTo(4);
    expect(youthAppeal(p, {}, 40) - youthAppeal(p)).toBeCloseTo(10);
    expect(youthAppeal(p, { school_saved: true }) - youthAppeal(p)).toBeCloseTo(5);
  });
  it('elder: clinic +10, daily ferry +5, streetlights +3', () => {
    expect(elderAppeal(p, { clinic_open: true }) - elderAppeal(p)).toBeCloseTo(10);
    expect(elderAppeal(p, { project_ferry_done: true }) - elderAppeal(p)).toBeCloseTo(5);
    expect(elderAppeal(p, { project_streetlights_done: true }) - elderAppeal(p)).toBeCloseTo(3);
    expect(elderAppeal(p, { station_open: true })).toBeCloseTo(elderAppeal(p));
  });
  it('both weightings sum to 1: a +g rise on every Pillar adds g to both audiences', () => {
    const up = plus(p, { prosperity: 7, safety: 7, spirit: 7, charm: 7 });
    expect(youthAppeal(up) - youthAppeal(p)).toBeCloseTo(7);
    expect(elderAppeal(up) - elderAppeal(p)).toBeCloseTo(7);
  });
});

describe('Momentum (§6.2)', () => {
  /** A town on `day` with one dawn snapshot per day from `first`, Pillars moving linearly to `now`. */
  const withHistory = (day: number, first: number, base: Pillars, now: Pillars): TownState => {
    const town = createTownState({ day });
    const history: PillarSnapshot[] = [];
    for (let d = first; d <= day; d++) {
      const t = (d - first) / Math.max(1, day - first);
      history.push(at(d, {
        prosperity: base.prosperity + (now.prosperity - base.prosperity) * t, safety: base.safety + (now.safety - base.safety) * t,
        spirit: base.spirit + (now.spirit - base.spirit) * t, charm: base.charm + (now.charm - base.charm) * t
      }));
    }
    return { ...town, pillars: now, history };
  };

  it('is 0.6 × the mean 7-day gain across the four Pillars', () => {
    const now = plus(DAY1_PILLARS, { prosperity: 10, safety: 4, spirit: 8, charm: 15 });
    // Day 10: the history holds Days 3–10; the base is Day 3's dawn.
    const town = withHistory(10, 3, DAY1_PILLARS, now);
    expect(momentumBase(town.history, 10)?.day).toBe(3);
    expect(sevenDayGains(town)).toEqual({ prosperity: 10, safety: 4, spirit: 8, charm: 15 });
    const a = computeAppeal(town);
    expect(a.meanGain7).toBeCloseTo(9.25);
    expect(a.momentum).toBeCloseTo(5.55);
    expect(a.appeal).toBeCloseTo((youthAppeal(now) + elderAppeal(now)) / 2 + 5.55);
  });

  it('only counts the last seven days', () => {
    // Flat for a week, then a rise: an old gain stops counting once it leaves the window.
    const town = createTownState({ day: 20 });
    const old = plus(DAY1_PILLARS, { charm: 20 });
    const history = [12, 13, 14, 15, 16, 17, 18, 19, 20].map(d => at(d, d >= 13 ? plus(old, { spirit: (d - 13) }) : DAY1_PILLARS));
    const now = plus(old, { spirit: 7 });
    // Day 20 measures from Day 13: Charm's rise was before it; Spirit +7 since.
    expect(momentumBase(history, 20)?.day).toBe(13);
    expect(computeAppeal({ ...town, history, pillars: now }).momentum).toBeCloseTo(0.6 * 7 / 4);
  });

  it('measures from Day 1 during the first week', () => {
    const town = withHistory(4, 1, DAY1_PILLARS, plus(DAY1_PILLARS, { charm: 8 }));
    expect(momentumBase(town.history, 4)?.day).toBe(1);
    expect(computeAppeal(town).momentum).toBeCloseTo(0.6 * 2);
  });

  it('is capped at 10', () => {
    expect(momentumFrom({ prosperity: 20, safety: 20, spirit: 20, charm: 20 })).toBe(10);
    expect(momentumFrom({ prosperity: 16, safety: 16, spirit: 17, charm: 17 })).toBeCloseTo(9.9);
  });

  it('nets losses against gains, and is never negative (GDD-GAP reading)', () => {
    expect(momentumFrom({ prosperity: 6, safety: -2, spirit: 0, charm: 0 })).toBeCloseTo(0.6);
    expect(momentumFrom({ prosperity: -8, safety: 0, spirit: -4, charm: 0 })).toBe(0);
  });

  it('is 0 with no history', () => {
    expect(computeAppeal({ ...createTownState(), history: [] }).momentum).toBe(0);
  });
});
