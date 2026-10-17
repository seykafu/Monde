// The Day-1 town the cards make (MVP M-03 step 3; GDD Appendix A.1): with the full roster loaded, the cards are the
// census the town engine starts from (pillars.ts DAY1_CENSUS, people.ts DAY1_PUPILS), household for household.
import { describe, expect, it } from 'vitest';
import { GENERATED, HOMED, HOUSEHOLDS } from '@monde/shared';
import { DAY1_CENSUS } from '../pillars';
import { DAY1_PUPILS } from '../people';
import { directoryFromCards, residentsOf } from '../occupancy';
import { loadCards, loadDay1Cards } from '../../sim/__tests__/content';

const hand = loadCards();
const day1 = await loadDay1Cards();
const all = [...hand, ...day1];
const homed = all.filter(c => c.kind !== 'animal' && !c.home.startsWith('offmap.'));

describe('the Day-1 census, from the cards (A.1)', () => {
  it('is 210 homed residents in 123 households, nine of them pupils: the town engine\'s Day 1', () => {
    expect(day1).toHaveLength(GENERATED - 4);
    expect(all).toHaveLength(212);
    expect(homed).toHaveLength(HOMED);
    expect(DAY1_CENSUS).toBe(HOMED);
    // A household to a home (A.1.3): the census's 107 written households and the 16 the hand-written cards hold.
    expect(new Set(homed.map(c => c.home)).size).toBe(HOUSEHOLDS);
    expect(new Set(day1.map(c => c.household))).toHaveProperty('size', 107);
    const pupils = homed.filter(c => c.age >= 5 && c.age <= 12);
    expect(pupils).toHaveLength(DAY1_PUPILS);
    expect(pupils.filter(c => c.employment).every(c => c.employment === 'pupil')).toBe(true);
  });

  it('puts every census resident in their household\'s home, and nobody in two', () => {
    const dir = directoryFromCards(all);
    const look = { flag: () => false };
    for (const c of day1) expect(residentsOf(c.home, dir, look), c.id).toContain(c.id);
    expect(new Set(all.map(c => c.id)).size).toBe(all.length);
  });
});
