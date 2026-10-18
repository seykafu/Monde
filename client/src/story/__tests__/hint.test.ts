// The Next hint (story/hint.ts) against the real compiled Spring scenes and the real zones.
import { describe, expect, it } from 'vitest';
import { createTownState } from '../../town/pillars';
import { placeName } from '../../world/player';
import { zones } from '../../world/zones';
import { FlagStore } from '../flags';
import { CLOSING_WARNING_MINUTES, SCENE_REASONS, catchableToday, closingToast, storyHint, upcomingBeat, zoneRoute } from '../hint';
import { minutes } from '../triggers';
import { isFerryDay } from '../../town/migration';
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

  it('explains S08 at the Lantern', () => {
    const hint = storyHint(SPRING_SCENES, at({ day: 18, minute: 700, zone: 'old_quarter', place: '' }), flags(...TO_S07), places);
    expect(hint).toMatchObject({ sceneId: 's08_option', when: '14:00–17:30', reason: 'Sable has found the Option in the town records.' });
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

  it('keeps S08 specific in its closing toast', () => {
    const s08 = storyHint(SPRING_SCENES, at({ day: 18, minute: 1030, zone: 'market_row', place: '' }), flags(...TO_S07), places);
    expect(closingToast(s08, { day: 18, minute: 1030, place: '' }, new Set())).toBe('Nearly 17:30. The Lantern: Sable has found the Option in the town records.');
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

it('explains Pell’s S09 invitation', () => { expect(SCENE_REASONS.s09_pell_confession).toBe('Pell is waiting to talk about the Option.'); });

describe('between beats: the next beat on a later day', () => {
  const ferry = (d: number) => isFerryDay(d);
  const next = (over: Partial<WorldNow>, set: string[], done: string[] = []) =>
    upcomingBeat(SPRING_SCENES, at(over), flags(...set), places, new Set(done), undefined, { ferryDay: ferry });
  const S01 = [...AFTER_S01A, 's01b_done', 's01c_done', 'cottage_keys_given'];

  it('after the cottage on Day 1, points at Margo and the library tomorrow', () => {
    expect(storyHint(SPRING_SCENES, at({ minute: 13 * 60, zone: 'old_quarter', place: '' }), flags(...S01), places)).toBeNull();
    expect(next({ minute: 13 * 60, zone: 'old_quarter', place: '' }, S01)).toMatchObject({
      sceneId: 's02_marks', day: 2, dayText: 'Tomorrow', when: 'Tomorrow, 10:00–12:00', where: 'Monde Free Library, Old Quarter', reason: SCENE_REASONS.s02_marks,
      text: 'Tomorrow, 10:00–12:00: Monde Free Library, Old Quarter — Margo is opening the Marks log'
    });
  });

  it('on Day 4 points at the fountain on Day 5, and after Pell’s confession at the Bloom Fair', () => {
    expect(next({ day: 4, minute: 600, zone: 'market_row', place: '' }, [...S01, 's02_done', 's03_done'])).toMatchObject({ sceneId: 's04_water_again', day: 5, dayText: 'Tomorrow' });
    expect(next({ day: 19, minute: 600, zone: 'market_row', place: '' }, [...TO_S07, 's08_done', 's09_done'])).toMatchObject({ sceneId: 's10a_bloom_open', day: 25, dayText: 'Day 25', summoned: true });
  });

  it('is nothing once the Spring’s last scene is done', () => {
    expect(next({ day: 25, minute: 22 * 60, zone: 'commons', place: '' }, [...TO_S07, 's08_done', 's09_done', 's10a_done', 's10b_done', 's10c_done'])).toBeNull();
  });

  it('covers every hour of the Spring: a scene to catch today, or the next one, until the Straw Poll is taken', () => {
    // A player who turns up for every scene the moment its window opens (S05 waits for Appeal: the empty boat plays).
    const f = flags(), completed = new Set<string>();
    const gaps: string[] = [];
    let hours = 0;
    for (let day = 1; day <= 25 && !f.has('s10c_done'); day++) {
      for (let minute = 6 * 60; minute < 24 * 60; minute += 30) {
        const ctx = at({ day, minute, zone: 'old_quarter', place: '' });
        if (day === 1 && minute < 9 * 60 + 50) continue; // a New Game opens 09:50 on the ferry slip
        const today = storyHint(SPRING_SCENES, ctx, f, places, completed);
        const later = today ? null : upcomingBeat(SPRING_SCENES, ctx, f, places, completed, undefined, { ferryDay: ferry });
        if (!today && !later && !f.has('s10c_done')) gaps.push(`D${day} ${minute}`);
        hours++;
        // Play what's open now (as the director would, the player standing there).
        for (const scene of catchableToday(SPRING_SCENES, ctx, f, completed)) {
          if (minute < minutes(scene.scene.header!.time.start)) continue;
          completed.add(scene.scene.id);
          for (const flag of scene.scene.header!.sets) f.set(flag);
        }
      }
    }
    expect(hours).toBeGreaterThan(800);
    expect(gaps).toEqual([]);
    expect(f.has('s10c_done')).toBe(true);
    expect([...completed]).toEqual(['s01a_ferry', 's01b_walk', 's01c_cottage', 's02_marks', 's03_tolls', 's04_water_again', 's05b_empty_boat', 's06_good_coat',
      's07b_chime_loan', 's08_option', 's09_pell_confession', 's10a_bloom_open', 's10b_bloom_close', 's10c_straw_poll']);
  });
});
