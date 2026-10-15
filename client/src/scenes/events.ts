// The event log in the running game (GDD §9.6, §9.14; MVP M-06 client). The pure queue and its sender live in
// mind/events.ts; this file keeps the log in the game registry (`monde.events`, saved as SaveGame.client_events) and
// runs one EventSync per game clock:
//   - story cues land here through appendEvent (scenes/story/attach.ts → story/host.ts);
//   - whenever the story flags change (the registry entry the save writes as SaveGame.story_flags), a full `flags`
//     snapshot is queued a moment later (one per burst of steps);
//   - online, the queue goes to POST /v1/worlds/:w/events shortly after anything new; the night POST takes the rest
//     (scenes/friendship.ts), and each answer's Regard replaces the friendship mirror (the caller's onRegard).
// In Quiet Mode nothing is sent: the log waits in the save for a session that can reach the server.
import type Phaser from 'phaser';
import type { ClientEvent, RegardSnapshot, SaveGame } from '@monde/shared';
import { getMind, uuid } from '../mind/api';
import { EventSync, emptyEventLog, enqueue, enqueueFlags, type EventLog } from '../mind/events';
import type { Clock } from '../sim/clock';

/** The SavedEventLog in the registry (save/runtime.ts saves and restores it). */
export const EVENTS_KEY = 'monde.events';
/** save/runtime.ts: SaveGame.story_flags (story/host.ts encodeStory: flags as `true`, the rest under `$story`). */
const FLAGS_KEY = 'monde.story.flags';
const CLOCK_KEY = 'monde.clock';
const DEV = import.meta.env.DEV || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'));
/** GDD-GAP: no number for it; a burst of story steps settles within a couple of real seconds. */
export const FLAGS_DEBOUNCE_MS = 2000;

type Registry = Phaser.Data.DataManager;

export const getEventLog = (registry: Pick<Registry, 'get'>): EventLog => (registry.get(EVENTS_KEY) as EventLog | undefined) ?? emptyEventLog();

const syncs = new WeakMap<Clock, EventSync>();
/** The sender for this game (null before ZoneScene attached it, e.g. under tests). */
export const eventSyncFor = (registry: Pick<Registry, 'get'>): EventSync | null => {
  const clock = registry.get(CLOCK_KEY) as Clock | undefined;
  return clock ? syncs.get(clock) ?? null : null;
};

/** Queue one ClientEvent (checked against the contract) and nudge the sender. The event as queued, or null. */
export function appendEvent(registry: Registry, raw: unknown): ClientEvent | null {
  const { log, event, problem } = enqueue(getEventLog(registry), raw);
  if (problem && DEV) console.warn(`[events] not queued: ${problem}`, raw);
  if (log !== getEventLog(registry)) registry.set(EVENTS_KEY, log);
  if (event) eventSyncFor(registry)?.notify();
  return event;
}

/** The bare flag names in a story_flags record. */
const flagsIn = (record: SaveGame['story_flags'] | undefined): string[] =>
  Object.entries(record ?? {}).filter(([k, v]) => v === true && !k.startsWith('$')).map(([k]) => k);

export interface EventSyncOptions {
  /** The town's Regard from an answer (replace the friendship mirror). */
  onRegard(regard: RegardSnapshot): void;
}

/** Start this game's sender (once per clock; it outlives zone changes and stops when another game replaces it). */
export function attachEventSync(registry: Registry, clock: Clock, opts: EventSyncOptions): EventSync {
  const have = syncs.get(clock);
  if (have) return have;
  if (!registry.has(EVENTS_KEY)) registry.set(EVENTS_KEY, emptyEventLog());
  const mine = () => registry.get(CLOCK_KEY) === clock;
  const mind = getMind();
  const sync = new EventSync({
    read: () => (mine() ? getEventLog(registry) : null),
    write: log => { if (mine()) registry.set(EVENTS_KEY, log); },
    post: events => mind.postEvents(events),
    enabled: () => mind.enabled,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onRegard: regard => { if (mine()) opts.onRegard(regard); },
    warn: (message, detail) => { if (DEV) console.warn(message, detail ?? ''); }
  });
  syncs.set(clock, sync);

  // The story flags: a snapshot a moment after they settle.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queueFlags = () => {
    timer = null;
    if (!mine()) return;
    const before = getEventLog(registry);
    const after = enqueueFlags(before, flagsIn(registry.get(FLAGS_KEY) as SaveGame['story_flags'] | undefined),
      { id: uuid(), day: clock.day, minute: clock.minute }, Date.now());
    if (after !== before) { registry.set(EVENTS_KEY, after); sync.notify(); }
  };
  const onFlags = () => {
    if (!mine()) { stop(); return; }
    if (timer === null) timer = setTimeout(queueFlags, FLAGS_DEBOUNCE_MS);
  };
  // Phaser's DataManager: `changedata-<key>` for a change, the generic `setdata` (with the key) for a first set.
  const onSet = (_parent: unknown, key: string) => { if (key === FLAGS_KEY) onFlags(); };
  const stop = () => {
    registry.events.off(`changedata-${FLAGS_KEY}`, onFlags).off('setdata', onSet);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    sync.stop();
  };
  registry.events.on(`changedata-${FLAGS_KEY}`, onFlags).on('setdata', onSet);
  // A loaded save whose flags the log hasn't sent yet (or an old save migrated with none sent).
  if (registry.has(FLAGS_KEY)) onFlags();
  // Anything left from the saved session goes as soon as there's a world.
  void mind.ensureWorld().then(() => sync.notify());
  return sync;
}
