// The event log's registry glue (scenes/events.ts) with a fake Phaser registry: flags snapshots after the story's
// steps settle, appendEvent's checks, and a game replaced by another. No Phaser at runtime (only its types).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { Clock } from '../../sim/clock';
import { EVENTS_KEY, FLAGS_DEBOUNCE_MS, appendEvent, attachEventSync, eventSyncFor, getEventLog } from '../events';

/** Phaser's DataManager as these functions use it: `setdata` for a new key, `changedata-<key>` for a change. */
function fakeRegistry() {
  const data = new Map<string, unknown>();
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const events = {
    on(name: string, fn: (...args: unknown[]) => void) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn); return events; },
    off(name: string, fn: (...args: unknown[]) => void) { handlers.get(name)?.delete(fn); return events; },
    emit(name: string, ...args: unknown[]) { for (const fn of [...(handlers.get(name) ?? [])]) fn(...args); }
  };
  const registry = {
    events, data, handlers,
    get: (key: string) => data.get(key),
    has: (key: string) => data.has(key),
    set(key: string, value: unknown) {
      const had = data.has(key), before = data.get(key);
      data.set(key, value);
      if (!had) events.emit('setdata', registry, key, value);
      else if (before !== value) events.emit(`changedata-${key}`, registry, value, before);
      return registry;
    }
  };
  return registry;
}
type Fake = ReturnType<typeof fakeRegistry>;
const asRegistry = (r: Fake) => r as unknown as Phaser.Data.DataManager;

describe('the event log in the registry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function start() {
    const r = fakeRegistry();
    const clock = new Clock({ day: 1, minute: 590 });
    r.set('monde.clock', clock);
    const onRegard = vi.fn();
    const sync = attachEventSync(asRegistry(r), clock, { onRegard });
    return { r, clock, sync, onRegard };
  }

  it('starts an empty log once per game clock', () => {
    const { r, clock, sync } = start();
    expect(getEventLog(asRegistry(r)).outbox).toEqual([]);
    expect(attachEventSync(asRegistry(r), clock, { onRegard: vi.fn() })).toBe(sync);
    expect(eventSyncFor(asRegistry(r))).toBe(sync);
  });

  it('queues one flags snapshot a moment after the story flags settle, and none for unchanged flags', () => {
    const { r } = start();
    r.set('monde.story.flags', { s01a_done: true, $story: '{}' });
    r.set('monde.story.flags', { s01a_done: true, met_pell: true, $story: '{}' });
    expect(getEventLog(asRegistry(r)).outbox).toEqual([]);
    vi.advanceTimersByTime(FLAGS_DEBOUNCE_MS);
    const [flags] = getEventLog(asRegistry(r)).outbox;
    expect(flags).toMatchObject({ kind: 'flags', day: 1, minute: 590, flags: ['met_pell', 's01a_done'] });
    expect(flags!.kind === 'flags' && flags.revision).toBeGreaterThan(0);
    r.set('monde.story.flags', { met_pell: true, s01a_done: true, $story: '{"queue":[]}' });
    vi.advanceTimersByTime(FLAGS_DEBOUNCE_MS);
    expect(getEventLog(asRegistry(r)).outbox).toHaveLength(1);
  });

  it('checks events against the contract before queueing them', () => {
    const { r } = start();
    const ok = appendEvent(asRegistry(r), { kind: 'scripted_regard', id: 'e1', day: 1, minute: 590, resident: 'pell', delta: 3, scene_id: 's01a_ferry', cue_key: 's01a_ferry:12' });
    expect(ok).toMatchObject({ id: 'e1' });
    const bad = appendEvent(asRegistry(r), { kind: 'scripted_memory', id: 'e2', day: 1, minute: 590, resident: 'pell', place: 'nowhere', text: 'Hm.', importance: 4, scene_id: 's', cue_key: 'k' });
    expect(bad).toBeNull();
    const log = r.get(EVENTS_KEY) as ReturnType<typeof getEventLog>;
    expect(log.outbox.map(e => e.id)).toEqual(['e1']);
    expect(log.rejected[0]).toMatchObject({ id: 'e2', kind: 'scripted_memory', raw: expect.stringContaining('nowhere'), reason: expect.stringContaining('place') });
  });

  it("stops listening once another game's clock replaces this one", () => {
    const { r, sync } = start();
    const stop = vi.spyOn(sync, 'stop');
    r.set('monde.clock', new Clock({ day: 1, minute: 360 }));
    r.set('monde.story.flags', { s01a_done: true });
    vi.advanceTimersByTime(FLAGS_DEBOUNCE_MS);
    expect(stop).toHaveBeenCalled();
    expect(getEventLog(asRegistry(r)).outbox).toEqual([]);
    expect(r.handlers.get('setdata')?.size ?? 0).toBe(0);
  });
});
