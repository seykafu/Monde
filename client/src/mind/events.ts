// The client's events for monde-mind (GDD §9.6 memory, §9.12 town events, §9.14 Quiet Mode; MVP M-06 client side).
// Pure: no Phaser, no DOM. The network, the timers and the registry are injected, so the queue, its retries and the
// acknowledgements run under vitest with a fake API.
//
// The log (a SavedEventLog, saved with the game) holds ClientEvents (shared/src/events.ts) in the order they happened:
//   - story cues: {memory} → scripted_memory, {regard} → scripted_regard, each with its scene id and cue key;
//   - the story flags: a full `flags` snapshot with an increasing revision whenever they change (an unsent older
//     snapshot is replaced, never queued behind the new one);
//   - town events the client witnesses that match a §9.6 type (`town_event`; today only a story {scuffle}).
// Every event gets its id once, when it's queued; retries reuse it. When a world is reachable, EventSync sends the
// queue to POST /v1/worlds/:w/events a moment after something new arrives (and backs off on failures); the night POST
// carries whatever is still unsent (scenes/friendship.ts). Accepted and duplicate ids leave the queue; a rejection is
// kept in `rejected` with its reason (and logged), except the ones that are only "not now" (see acknowledge).
import {
  CLIENT_EVENT_BATCH_LIMIT, ClientEvent, EVENT_IMPORTANCE, emptyEventLog, type EventIngestionResult, type RegardSnapshot,
  type SavedEventLog
} from '@monde/shared';

export type EventLog = SavedEventLog;
export { emptyEventLog };

// ── What can be sent ────────────────────────────────────────────────────────

/**
 * Resident ids the server can't know yet. GDD-GAP: S05's `arrival` is an alias for the first generated arrival
 * (§6.4, Appendix A), whose generator isn't built; their memories and Regard stay queued (and saved) until it is,
 * rather than being refused as an unknown resident.
 */
export const HELD_RESIDENTS: ReadonlySet<string> = new Set(['arrival']);

/**
 * G-02: S05's `arrival` has become a real resident (the first arrival, known to the server): every held event for the
 * alias now names them, and goes with the next batch. Ids stay the same (they were given when queued).
 */
export function resolveHeld(log: EventLog, alias: string, id: string): EventLog {
  let changed = false;
  const outbox = log.outbox.map(e => {
    let next = e;
    if ('resident' in e && e.resident === alias) next = { ...next, resident: id } as ClientEvent;
    if ('participants' in e && e.participants.includes(alias)) next = { ...next, participants: e.participants.map(p => (p === alias ? id : p)) } as ClientEvent;
    if (next !== e) changed = true;
    return next;
  });
  return changed ? { ...log, outbox } : log;
}

export const isHeld = (e: ClientEvent): boolean =>
  ('resident' in e && HELD_RESIDENTS.has(e.resident)) || ('participants' in e && e.participants.some(p => HELD_RESIDENTS.has(p)));

/** The events to send now, oldest first: not held, on or before `maxDay` (the night being posted), at most one batch. */
export function sendable(log: EventLog, maxDay = Number.POSITIVE_INFINITY): ClientEvent[] {
  return log.outbox.filter(e => !isHeld(e) && e.day <= maxDay).slice(0, CLIENT_EVENT_BATCH_LIMIT);
}

/** Scripted Regard queued but not acknowledged yet, for one resident: the mirror shows it before the server does. */
export function pendingRegard(log: EventLog | null | undefined, residentId: string): number {
  let sum = 0;
  for (const e of log?.outbox ?? []) if (e.kind === 'scripted_regard' && e.resident === residentId) sum += e.delta;
  return sum;
}

// ── Queueing ────────────────────────────────────────────────────────────────

/** GDD-GAP: how many refused events a save keeps for inspection; the oldest go first. */
export const REJECTED_KEPT = 50;

const keep = (rejected: EventLog['rejected']): EventLog['rejected'] => rejected.slice(-REJECTED_KEPT);

export interface Queued { log: EventLog; event: ClientEvent | null; problem?: string }

/**
 * Queue one event. It's checked against the shared contract first: one that isn't a valid ClientEvent (a memory over
 * 200 characters, a place that isn't `zone.place`) never reaches the server and goes to `rejected` with the reason.
 */
export function enqueue(log: EventLog, raw: unknown): Queued {
  const parsed = ClientEvent.safeParse(raw);
  if (parsed.success) {
    if (log.outbox.some(e => e.id === parsed.data.id)) return { log, event: null, problem: `duplicate id ${parsed.data.id}` };
    return { log: { ...log, outbox: [...log.outbox, parsed.data] }, event: parsed.data };
  }
  const problem = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
  const shaped = (raw && typeof raw === 'object' ? raw : {}) as { id?: unknown; kind?: unknown };
  // Kept for inspection as its JSON (it can't go in the save as an event).
  let json = '';
  try { json = JSON.stringify(raw) ?? ''; } catch { json = String(raw); }
  const entry = {
    id: typeof shaped.id === 'string' ? shaped.id : '', kind: typeof shaped.kind === 'string' ? shaped.kind : 'unknown',
    reason: `invalid locally: ${problem}`, raw: json.slice(0, 2000)
  };
  return { log: { ...log, rejected: keep([...log.rejected, entry]) }, event: null, problem };
}

/** Story flag names as the server stores them (shared/src/events.ts). */
const FLAG_NAME = /^[a-z][a-z0-9_]*$/;
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** The bare flag names the server takes, sorted and deduplicated (the save's `$story` entry and anything else go). */
export function bareFlags(flags: Iterable<string>): string[] {
  return [...new Set([...flags].filter(f => FLAG_NAME.test(f) && f.length <= 200))].sort();
}

/**
 * GDD-GAP: the revision only has to increase (EVENTS.md). It's the larger of the last one + 1 and the seconds since
 * 2026-01-01, so it also increases across a loaded older save (whose last revision the server has already passed),
 * and stays well inside the contract's 2^31 − 1 for decades.
 */
export const REVISION_EPOCH_MS = Date.UTC(2026, 0, 1);
export const MAX_REVISION = 2_147_483_647;
export function nextRevision(last: number, nowMs: number): number {
  return Math.min(MAX_REVISION, Math.max(last + 1, Math.floor((nowMs - REVISION_EPOCH_MS) / 1000)));
}

/**
 * The story flags now: a full snapshot with the next revision, replacing any unsent older snapshot. Unchanged flags
 * (the same as the last snapshot this log queued) queue nothing.
 */
export function enqueueFlags(log: EventLog, flags: Iterable<string>, stamp: { id: string; day: number; minute: number }, nowMs: number): EventLog {
  const bare = bareFlags(flags).slice(0, 1000);
  if (log.flags && sameList(log.flags, bare)) return log;
  const revision = nextRevision(log.flags_revision, nowMs);
  const event = ClientEvent.parse({ kind: 'flags', id: stamp.id, day: stamp.day, minute: Math.round(stamp.minute), revision, flags: bare });
  return { ...log, outbox: [...log.outbox.filter(e => e.kind !== 'flags'), event], flags_revision: revision, flags: bare };
}

// ── Building events ─────────────────────────────────────────────────────────

export interface Stamp { id: string; day: number; minute: number }
export interface CueIdentity { scene_id: string; cue_key: string }

const minuteOf = (m: number): number => Math.max(0, Math.min(1560, Math.round(m)));

/** {memory: resident, "text", importance: n} → scripted_memory (first-person text, substituted, never cut). */
export const scriptedMemory = (s: Stamp, cue: CueIdentity, m: { resident: string; place: string; text: string; importance: number }) =>
  ({ kind: 'scripted_memory' as const, id: s.id, day: s.day, minute: minuteOf(s.minute), ...cue, resident: m.resident, place: m.place, text: m.text, importance: m.importance });

/** {regard: resident ±n} → scripted_regard. */
export const scriptedRegard = (s: Stamp, cue: CueIdentity, r: { resident: string; delta: number }) =>
  ({ kind: 'scripted_regard' as const, id: s.id, day: s.day, minute: minuteOf(s.minute), ...cue, resident: r.resident, delta: Math.round(r.delta) });

/**
 * A §9.6 town event: importance from the authored type table, never chosen here.
 *
 * What the client knows of the town, against §9.6's table (scuffle 7, project_open 6, sweeping 2):
 *   a story {scuffle} (story/host.ts scuffleEvent)      → `scuffle`, the player and the §7.9 enemies taking part;
 *   a Project's opening ceremony (G-03, projects/runtime.ts openProject) → `project_open`, the player and everyone
 *            gathered at the site taking part (a story {project} cue only unlocks one, so it sends nothing);
 *   GDD-GAP: `sweeping` is community work (§8), which has no client system yet;
 *   GDD-GAP: {pillar} cues, the night's drift, the dawn's arrivals, departures and Leaving Notices and the Option
 *            Clause change the town but have no type in §9.6's table ("refers to an event table but only supplies
 *            these three values", shared/src/events.ts), so they stay client-side; story milestones reach the server
 *            as the flags snapshot.
 */
export const townEvent = (s: Stamp, e: { type: keyof typeof EVENT_IMPORTANCE; place: string; participants: readonly string[]; summary: string }) =>
  ({ kind: 'town_event' as const, id: s.id, day: s.day, minute: minuteOf(s.minute), type: e.type, place: e.place,
    participants: [...new Set(e.participants)], summary: e.summary.trim().slice(0, 200), importance: EVENT_IMPORTANCE[e.type] });

// ── Answers ─────────────────────────────────────────────────────────────────

/** Rejections that only mean "not in this request": the event stays queued for /events (EVENTS.md, night retries). */
export const RETRY_LATER = new Set(['event is outside this unprocessed night']);

export interface Acknowledged {
  log: EventLog;
  /** Refused for good, now in `log.rejected` (for the log line). */
  rejected: { id: string; kind: string; event: ClientEvent; reason: string }[];
  /** Ids that left the queue (accepted or duplicates). */
  done: string[];
}

/**
 * Fold an ingestion result in: accepted and duplicate ids leave the queue; a refused event moves to `rejected` with
 * its reason, except a stale flags snapshot (a newer revision supersedes it, so it just goes) and a night's "not
 * now", which stays queued. Ids the result doesn't mention stay queued.
 */
export function acknowledge(log: EventLog, result: EventIngestionResult): Acknowledged {
  const done = new Set([...result.accepted, ...result.duplicates]);
  const reasons = new Map(result.rejected.filter(r => r.id && !RETRY_LATER.has(r.reason)).map(r => [r.id, r.reason] as const));
  const outbox: ClientEvent[] = [];
  const rejected: Acknowledged['rejected'] = [];
  let flags = log.flags;
  for (const e of log.outbox) {
    if (done.has(e.id)) continue;
    const reason = reasons.get(e.id);
    if (reason === undefined) { outbox.push(e); continue; }
    if (e.kind === 'flags') {
      // Superseded (or the server has a newer one from elsewhere): forget it, so the next change sends a fresh snapshot.
      flags = null;
      continue;
    }
    rejected.push({ id: e.id, kind: e.kind, event: e, reason });
  }
  return { log: { ...log, outbox, flags, rejected: keep([...log.rejected, ...rejected]) }, rejected, done: [...done] };
}

// ── Sending ─────────────────────────────────────────────────────────────────

export type PostOutcome = { ok: true; result: EventIngestionResult } | { ok: false; status: number | null };

/**
 * GDD-GAP: transport timing isn't specified. A batch goes 1.5 s after the last new event (a scene's burst of cues
 * goes as one request); failures retry after 5 s, doubling to at most 5 minutes.
 */
export const EVENT_SYNC = { debounceMs: 1500, retryMs: 5000, maxRetryMs: 300_000 } as const;

export interface EventSyncDeps {
  /** The log now, or null once this game is gone (a load or New Game replaced it): the sync stops. */
  read(): EventLog | null;
  write(log: EventLog): void;
  post(events: readonly ClientEvent[]): Promise<PostOutcome>;
  /** A server could be reached at all (an invite or a session, and not `?offline`): Quiet Mode keeps everything queued. */
  enabled(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Every answer carries the town's Regard (EVENTS.md): the mirror takes it. */
  onRegard?(regard: RegardSnapshot): void;
  /** Refusals and failures (development logging). */
  warn(message: string, detail?: unknown): void;
}

export class EventSync {
  private timer: unknown = null;
  private sending = false;
  private again = false;
  private failures = 0;
  private stopped = false;

  constructor(private readonly deps: EventSyncDeps, private readonly rules: { debounceMs: number; retryMs: number; maxRetryMs: number } = EVENT_SYNC) {}

  /** Something was queued: send it shortly (one request for a burst). */
  notify(): void {
    if (this.stopped) return;
    if (this.sending) { this.again = true; return; }
    if (this.timer === null) this.schedule(this.rules.debounceMs);
  }

  /** The delay before the next attempt after `failures` failures in a row. */
  backoff(failures = this.failures): number {
    return Math.min(this.rules.maxRetryMs, this.rules.retryMs * 2 ** Math.max(0, failures - 1));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** Send what's queued now (one batch; another follows at once if more is waiting). */
  async flush(): Promise<void> {
    if (this.stopped || this.sending) return;
    if (this.timer !== null) { this.deps.clearTimer(this.timer); this.timer = null; }
    const log = this.deps.read();
    if (!log) { this.stop(); return; }
    if (!this.deps.enabled()) return;
    const batch = sendable(log);
    if (!batch.length) return;
    this.sending = true;
    let more = false;
    try {
      const outcome = await this.deps.post(batch);
      if (!outcome.ok) {
        this.failures++;
        if (outcome.status !== null) this.deps.warn(`[events] POST /events: HTTP ${outcome.status}; retrying in ${Math.round(this.backoff() / 1000)} s`);
        if (!this.stopped) this.schedule(this.backoff());
        return;
      }
      this.failures = 0;
      const next = this.apply(outcome.result);
      more = !!next && sendable(next).some(e => !batch.some(b => b.id === e.id));
    } catch (error) {
      this.failures++;
      this.deps.warn('[events] send failed', error);
      if (!this.stopped) this.schedule(this.backoff());
    } finally {
      this.sending = false;
      if (more || this.again) { this.again = false; this.notify(); }
    }
  }

  /** An ingestion result from /events or the night: acknowledge it and take its Regard. Returns the new log. */
  apply(result: EventIngestionResult): EventLog | null {
    const now = this.deps.read();
    if (!now) { this.stop(); return null; }
    const { log, rejected } = acknowledge(now, result);
    this.deps.write(log);
    for (const r of rejected) this.deps.warn(`[events] the server refused ${r.event.kind} ${r.event.id}: ${r.reason}`, r.event);
    this.deps.onRegard?.(result.regard);
    return log;
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => { this.timer = null; void this.flush(); }, ms);
  }
}
