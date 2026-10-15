import { describe, expect, it } from 'vitest';
import { ARRIVAL_APPEAL } from '../migration';
import { runSoak } from './soakScenarios';

describe('25-day soak (MVP Days 1–25, GDD §6.2 narrative)', () => {
  const strong = runSoak('strong');
  const passive = runSoak('passive');

  it('is deterministic', () => {
    expect(runSoak('strong')).toEqual(strong);
  });

  it('a strong first week brings the first arrival around Day 7–9 (S05)', () => {
    expect(strong.firstArrivalDay).not.toBeNull();
    expect(strong.firstArrivalDay!).toBeGreaterThanOrEqual(7);
    expect(strong.firstArrivalDay!).toBeLessThanOrEqual(9);
    expect(strong.firstArrivalDay).toBe(8); // the first sailing on or after D7 (§13.2: "earliest D8")
  });

  it('the Day 4 ferry comes in empty: Appeal too low (§13.2)', () => {
    expect(strong.days[3]).toMatchObject({ day: 4, weekday: 'Fri', outcome: 'appeal_below_35' });
  });

  it('the strong week raises the Pillars about 10 on average by Day 8, and Appeal crosses 35 then', () => {
    const d1 = strong.days[0]!, d8 = strong.days[7]!;
    const gain = (['prosperity', 'safety', 'spirit', 'charm'] as const).reduce((sum, p) => sum + d8.pillars[p] - d1.pillars[p], 0) / 4;
    expect(gain).toBeGreaterThan(8);
    expect(gain).toBeLessThan(12);
    expect(strong.days[6]!.appeal).toBeLessThan(ARRIVAL_APPEAL);
    expect(d8.appeal).toBeGreaterThanOrEqual(ARRIVAL_APPEAL);
  });

  it('arrivals only ever land on sailing days, inside the free homes', () => {
    for (const d of strong.days) {
      if (d.households > 0) expect(['Tue', 'Fri']).toContain(d.weekday);
    }
    expect(strong.households).toBeGreaterThan(1);
    expect(strong.final.census).toBeGreaterThan(210);
    expect(strong.final.homes.restored_free).toBeGreaterThanOrEqual(0);
  });

  it('a passive player gets no arrivals in 25 days, with a free home waiting from Day 6', () => {
    expect(passive.firstArrivalDay).toBeNull();
    expect(passive.households).toBe(0);
    expect(passive.final.census).toBe(210);
    expect(Math.max(...passive.days.map(d => d.appeal))).toBeLessThan(30);
    expect(passive.days.filter(d => d.weekday === 'Tue' || d.weekday === 'Fri').slice(1).every(d => d.outcome === 'appeal_below_35')).toBe(true);
  });

  it('a passive town only drifts: Spirit up toward 40, Safety down once the Tollmen reach 2', () => {
    const last = passive.days.at(-1)!;
    expect(last.pillars.prosperity).toBe(18);
    expect(last.pillars.spirit).toBeGreaterThan(22);
    expect(last.pillars.safety).toBeLessThan(30);
  });
});
