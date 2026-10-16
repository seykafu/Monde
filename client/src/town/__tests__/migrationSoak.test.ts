// The G-02 mock soak (MVP_PLAN G-02: "A 25-day mock soak produces plausible arrivals and departures"). See
// migrationSoak.ts for the scenarios and the fake model.
import { describe, expect, it } from 'vitest';
import { isFerryDay } from '../migration';
import { MAX_DEPARTURES_PER_FERRY } from '../people';
import { runMigrationSoak, soakTable, type MigrationSoakResult } from './migrationSoak';
import { loadCards } from '../../sim/__tests__/content';

const cast = new Set(loadCards().map(c => c.id));
const SEEDS = Array.from({ length: 8 }, (_, i) => 1000 + i);

/** What holds for any run: boats only on sailing days, at most two leavers a boat, nobody from the cast leaving. */
function checkRules(r: MigrationSoakResult): void {
  for (const d of r.days) {
    if (d.households) expect(isFerryDay(d.day)).toBe(true);
    if (d.leaving.length) expect(isFerryDay(d.day)).toBe(true);
    expect(d.leaving.length).toBeLessThanOrEqual(MAX_DEPARTURES_PER_FERRY);
    for (const id of [...d.notices, ...d.leaving, ...d.departed]) expect(cast.has(id)).toBe(false);
    expect(d.freeHomes).toBeGreaterThanOrEqual(0);
  }
  expect(r.final.census).toBe(210 + r.people - r.days.reduce((s, d) => s + d.departed.length, 0));
  // Every household was written by the (fake) model; the broken first answers were sent back and fixed.
  expect(r.templates).toBe(0);
}

describe('G-02 25-day mock soak', () => {
  const strong = runMigrationSoak('strong');
  const passive = runMigrationSoak('passive');

  it('is deterministic', () => {
    expect(soakTable(runMigrationSoak('strong'))).toBe(soakTable(strong));
  });

  it('a strong player: the first arrival on Day 8 (S05), a household on every boat a home is ready for, nobody leaves', () => {
    checkRules(strong);
    expect(strong.firstArrivalDay).toBe(8);
    // Free homes are the cap (§6.4): the Sunday house and five restored by the `homes` Project.
    expect(strong.households).toHaveLength(6);
    expect(strong.people).toBeGreaterThanOrEqual(8);
    expect(strong.people).toBeLessThanOrEqual(20);
    expect(strong.departures).toBe(0);
    expect(strong.retried).toBeGreaterThan(0);
    expect(strong.final.census).toBe(210 + strong.people);
    // Both audiences come (§6.2): someone young and someone 60 or over.
    const ages = strong.households.flatMap(h => h.residents.map(r => r.card.age));
    expect(ages.some(a => a < 40)).toBe(true);
    expect(ages.some(a => a >= 60)).toBe(true);
  });

  it('a passive player: Appeal never reaches 35, so the boats come in empty and nobody leaves either', () => {
    checkRules(passive);
    expect(passive.firstArrivalDay).toBeNull();
    expect(passive.households).toHaveLength(0);
    expect(passive.departures).toBe(0);
    expect(passive.final.census).toBe(210);
  });

  it('across 8 worlds: strong runs keep everyone; lapsed runs lose some newcomers, and Last Chance Favors keep them', () => {
    const strongs = SEEDS.map(seed => runMigrationSoak('strong', 25, { seed }));
    const lapsed = SEEDS.map(seed => runMigrationSoak('lapsed', 25, { seed }));
    const kept = SEEDS.map(seed => runMigrationSoak('lapsed', 25, { seed, lastChance: true }));
    for (const r of [...strongs, ...lapsed, ...kept]) checkRules(r);
    expect(strongs.every(r => r.households.length === 6 && r.departures === 0)).toBe(true);
    expect(lapsed.every(r => r.households.length === 2)).toBe(true);
    const lost = lapsed.reduce((s, r) => s + r.departures, 0);
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(lapsed.reduce((s, r) => s + r.people, 0) / 2);
    // With every Last Chance Favor done in time, nobody goes (a resident whose Stay stays low can be noticed again).
    expect(kept.reduce((s, r) => s + r.departures, 0)).toBe(0);
    expect(kept.reduce((s, r) => s + r.savedByLastChance, 0)).toBeGreaterThanOrEqual(lost);
  });
});
