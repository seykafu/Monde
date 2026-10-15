// The Next hint (story/hint.ts) against the real compiled Spring scenes and the real zones.
import { describe, expect, it } from 'vitest';
import { createTownState } from '../../town/pillars';
import { placeName } from '../../world/player';
import { zones } from '../../world/zones';
import { FlagStore } from '../flags';
import { CLOSING_WARNING_MINUTES, SCENE_REASONS, catchableToday, closingToast, storyHint, zoneRoute } from '../hint';
import { buildStoryContext, emptyLedger, type WorldNow } from '../host';
import { SPRING_SCENES } from '../session';

const places = {
  placeName,
  zoneName: (id: string) => zones[id]?.name ?? id,
  route: (from: string, to: string) => zoneRoute(zones, from, to)
};
const flags = (...set: string[]): FlagStore => { const f = new FlagStore({ dev: true }); for (const flag of set) f.set(flag); return f; };
const at = (over: Partial<WorldNow>) => buildStoryContext({ day: 1, minute: 600, zone: 'wharf', place: 'wharf.ferry_slip', town: createTownState({ day: over.day ?? 1 }), ...over }, emptyLedger());
const AFTER_S01A = ['s01a_done', 'met_pell', 'met_moss', 'met_ada'];
/** Every Spring beat up to S07 done. */
const TO_S07 = ['s01a_done', 's01b_done', 's01c_done', 's02_done', 's03_done', 's04_done', 's05_done', 's06_done', 's07_done'];

describe('the Next hint', () => {
  it('after S01a, points from the Wharf through Market Row to Fountain Square for S01b', () => {
    const hint = storyHint(SPRING_SCENES, at({ minute: 592 }), flags(...AFTER_S01A), places);
    expect(hint).toMatchObject({
      sceneId: 's01b_walk', place: 'old_quarter.fountain_square', placeName: 'Fountain Square', zoneName: 'Old Quarter', via: 'Market Row',
      start: 640, end: 690, open: false, summoned: false, where: 'Market Row, then Fountain Square', when: '10:40–11:30', reason: 'Pell is waiting.'
    });
    expect(hint!.text).toBe('Market Row, then Fountain Square, 10:40–11:30 — Pell is waiting');
  });

  it('names the zone from next door, the place alone once there, and "before" once the window is open', () => {
    const fromMarket = storyHint(SPRING_SCENES, at({ minute: 650, zone: 'market_row', place: '' }), flags(...AFTER_S01A), places);
    expect(fromMarket).toMatchObject({ where: 'Fountain Square, Old Quarter', when: 'before 11:30', open: true, via: null });
    const there = storyHint(SPRING_SCENES, at({ minute: 650, zone: 'old_quarter', place: 'old_quarter.library' }), flags(...AFTER_S01A), places);
    expect(there).toMatchObject({ where: 'Fountain Square', text: 'Fountain Square, before 11:30 — Pell is waiting' });
  });

  it('moves on to the cottage after S01b, and to nothing once the day has nothing left', () => {
    const cottage = storyHint(SPRING_SCENES, at({ minute: 680, zone: 'old_quarter', place: '' }), flags(...AFTER_S01A, 's01b_done'), places);
    expect(cottage).toMatchObject({ sceneId: 's01c_cottage', when: '11:30–13:00', reason: SCENE_REASONS.s01c_cottage });
    // S01b missed: its window has closed and S01c waits on it, so nothing more today…
    expect(storyHint(SPRING_SCENES, at({ minute: 700, zone: 'old_quarter', place: '' }), flags(...AFTER_S01A), places)).toBeNull();
    // …and the next morning it's S01b again (a scene's day is its earliest).
    expect(storyHint(SPRING_SCENES, at({ day: 2, minute: 400, zone: 'old_quarter', place: '' }), flags(...AFTER_S01A), places)).toMatchObject({ sceneId: 's01b_walk' });
  });

  it('skips completed and playing scenes, and anything while asleep', () => {
    const ctx = at({ minute: 592 });
    expect(catchableToday(SPRING_SCENES, ctx, flags(...AFTER_S01A), new Set(['s01b_walk']))).toEqual([]);
    expect(catchableToday(SPRING_SCENES, ctx, flags(...AFTER_S01A), new Set(), 's01b_walk')).toEqual([]);
    expect(catchableToday(SPRING_SCENES, { ...ctx, asleep: true }, flags(...AFTER_S01A))).toEqual([]);
  });

  it('uses the generic line where the calendar gives no reason (S08 at the Lantern)', () => {
    const hint = storyHint(SPRING_SCENES, at({ day: 18, minute: 700, zone: 'old_quarter', place: '' }), flags(...TO_S07), places);
    expect(hint).toMatchObject({ sceneId: 's08_option', when: '14:00–17:30', reason: 'Someone is expecting you at The Lantern.' });
  });

  it("puts Bloom Fair's opening before its closing, and needs no route for a summons", () => {
    const hint = storyHint(SPRING_SCENES, at({ day: 25, minute: 600, zone: 'wharf', place: '' }), flags(...TO_S07, 's08_done', 's09_done'), places);
    expect(hint).toMatchObject({ sceneId: 's10a_bloom_open', summoned: true, via: null, where: 'Sundial Lawn, The Commons', reason: 'The Bloom Fair is opening.' });
    const later = storyHint(SPRING_SCENES, at({ day: 25, minute: 900, zone: 'commons', place: '' }), flags(...TO_S07, 's08_done', 's09_done', 's10a_done'), places);
    expect(later).toMatchObject({ sceneId: 's10b_bloom_close', where: 'Bandstand' });
  });
});

describe('the closing toast', () => {
  const open = () => storyHint(SPRING_SCENES, at({ minute: 670, zone: 'market_row', place: '' }), flags(...AFTER_S01A), places);

  it(`warns once, ${CLOSING_WARNING_MINUTES} minutes or less before an open window closes, when the player isn't there`, () => {
    const warned = new Set<string>();
    expect(closingToast(open(), { day: 1, minute: 650, place: '' }, warned)).toBeNull(); // 40 minutes left
    expect(closingToast(open(), { day: 1, minute: 670, place: '' }, warned)).toBe('Nearly 11:30. Fountain Square: Pell is waiting.');
    expect(closingToast(open(), { day: 1, minute: 675, place: '' }, warned)).toBeNull(); // once
    expect(closingToast(open(), { day: 1, minute: 675, place: 'old_quarter.fountain_square' }, new Set())).toBeNull(); // already there
    expect(closingToast(null, { day: 1, minute: 675, place: '' }, new Set())).toBeNull();
  });

  it('has a generic line too', () => {
    const s08 = storyHint(SPRING_SCENES, at({ day: 18, minute: 1030, zone: 'market_row', place: '' }), flags(...TO_S07), places);
    expect(closingToast(s08, { day: 18, minute: 1030, place: '' }, new Set())).toBe('Nearly 17:30. The Lantern: someone is still expecting you.');
  });
});

describe('zoneRoute', () => {
  it('walks the districts by their edges', () => {
    expect(zoneRoute(zones, 'wharf', 'old_quarter')).toEqual(['market_row', 'old_quarter']);
    expect(zoneRoute(zones, 'commons', 'wharf')).toEqual(['market_row', 'wharf']);
    expect(zoneRoute(zones, 'market_row', 'old_quarter')).toEqual(['old_quarter']);
    expect(zoneRoute(zones, 'wharf', 'wharf')).toEqual([]);
    expect(zoneRoute(zones, 'wharf', 'briar_woods')).toBeNull();
  });
});
