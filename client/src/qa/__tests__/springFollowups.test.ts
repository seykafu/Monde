import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { emptyFriendship, fallbackPress } from '@monde/shared';
vi.mock('phaser', () => import('./phaserStub'));
const { localTemplateFavors, favorBook, chooseFavor, favorInteraction, reachableFavorPlace } = await import('../../friendship/favors');
const { meetResident, regardFor, regardMap } = await import('../../scenes/friendship');
const { optionCalendar } = await import('../../story/optionCalendar');
const { getEventLog } = await import('../../scenes/events');
const { Clock } = await import('../../sim/clock');
const { standingPlace } = await import('../../world/interiors');
const { interiors } = await import('../../world/zones');
const { StorySession } = await import('../../story/session');
function registry() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return r; }, has: (k: string) => data.has(k), remove: (k: string) => data.delete(k) };
  r.set('monde.friendship', emptyFriendship());
  return r as unknown as Phaser.Data.DataManager;
}
describe('Quiet Mode ordinary Favors', () => {
  it.each(['bru', 'nettie'])('offers a met peripheral resident %s a Favor without server tier data', id => {
    const r = registry(); meetResident(r, id, 2); localTemplateFavors(r, 2);
    expect(favorBook(r)).toHaveLength(1);
    expect(reachableFavorPlace(favorBook(r)[0]!.task.place)).toBe(true);
  });
  it('offers reachable chores to met residents, once per window, capped at six, and completes upstairs chores', () => {
    const r = registry();
    for (const id of ['odile', 'bru', 'delphine', 'felix', 'hollis', 'kasimir', 'nettie', 'priya', 'rook', 'vane']) meetResident(r, id, 2);
    localTemplateFavors(r, 2);
    expect(favorBook(r)).toHaveLength(6);
    expect(favorBook(r).every(f => reachableFavorPlace(f.task.place))).toBe(true);
    localTemplateFavors(r, 2);
    expect(favorBook(r)).toHaveLength(6);
    const upstairs = registry(); meetResident(upstairs, 'odile', 2); localTemplateFavors(upstairs, 2);
    const f = favorBook(upstairs)[0]!;
    expect(chooseFavor(upstairs, f.id, 2, true)).toBe(true);
    const clock = new Clock({ day: 2, minute: 600 });
    const before = regardFor(upstairs, 'odile');
    favorInteraction(upstairs, clock, standingPlace(interiors, f.task.place))!.run();
    expect(favorBook(upstairs)[0]?.status).toBe('completed');
    expect(clock.minute).toBe(630);
    expect(regardFor(upstairs, 'odile')).toBe(before + f.reward.regard);
    // The story's batch read (MVP M-03: every card on each refresh) is regardFor, resident by resident.
    const ids = ['odile', 'pell', 'june', 'nobody'];
    expect(regardMap(upstairs, ids)).toEqual(Object.fromEntries(ids.map(id => [id, regardFor(upstairs, id)])));
    localTemplateFavors(upstairs, 3);
    expect(favorBook(upstairs)).toHaveLength(1);
    expect(getEventLog(upstairs).outbox.map(e => e.kind)).toEqual(['favor_choice', 'favor_done']);
  });
});
describe('the Option calendar', () => {
  it('leads Day 19 with public contract facts, without a secrecy penalty', () => {
    const r = registry(); r.set('monde.story.flags', { option_public: true });
    const p = optionCalendar(r, 19, fallbackPress(19, [], []));
    expect(p.headline).toContain('OPTION'); expect(p.stories[0]?.text).toContain('seven consecutive days');
    expect(getEventLog(r).outbox).toEqual([]);
  });
  it('publishes Day 21 once, persists both flags and drops Pell’s Regard by ten', () => {
    const r = registry(), session = new StorySession({ world: null });
    session.flags.set('option_kept_secret'); r.set('monde.story.session', { session }); r.set('monde.story.flags', session.snapshot());
    const before = regardFor(r, 'pell');
    optionCalendar(r, 20, fallbackPress(20, [], [])); expect(getEventLog(r).outbox).toEqual([]);
    expect(optionCalendar(r, 21, fallbackPress(21, [], [])).headline).toContain('OPTION');
    expect(session.flags.has('option_public')).toBe(true); expect(session.flags.has('pell_promise_broken')).toBe(true);
    expect(regardFor(r, 'pell')).toBe(before - 10);
    optionCalendar(r, 21, fallbackPress(21, [], [])); expect(regardFor(r, 'pell')).toBe(before - 10);
    expect(r.get('monde.story.flags')).toMatchObject({ option_public: true, pell_promise_broken: true });
  });
  it('honours Sable’s extra week and leaves unrelated editions alone', () => {
    const r = registry(); r.set('monde.story.flags', { option_kept_secret: true, sable_week_granted: true });
    const p = fallbackPress(21, [], []); expect(optionCalendar(r, 21, p)).toBe(p);
    expect(optionCalendar(r, 25, fallbackPress(25, [], [])).headline).toContain('OPTION');
    expect(getEventLog(r).outbox).toEqual([]);
    expect(r.get('monde.story.flags')).not.toHaveProperty('pell_promise_broken');
    const empty = registry(); expect(optionCalendar(empty, 21, p)).toBe(p);
  });
});
