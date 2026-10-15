// The client's event log and its sender (mind/events.ts) with a fake API, and MindClient's /events and night calls.
import { describe, expect, it, vi } from 'vitest';
import { CLIENT_EVENT_BATCH_LIMIT, ClientEvent, type EventIngestionResult } from '@monde/shared';
import { MindClient, type StorageLike } from '../api';
import {
  EVENT_SYNC, EventSync, MAX_REVISION, REJECTED_KEPT, REVISION_EPOCH_MS, acknowledge, bareFlags, emptyEventLog, enqueue, enqueueFlags,
  nextRevision, pendingRegard, scriptedMemory, scriptedRegard, sendable, townEvent, type EventLog, type PostOutcome
} from '../events';

const cue = (n: number) => ({ scene_id: 's01a_ferry', cue_key: `s01a_ferry:${n}` });
const regard = (id: string, resident = 'pell', delta = 3, day = 1) => scriptedRegard({ id, day, minute: 600 }, cue(Number(id.replace(/\D/g, '')) || 0), { resident, delta });
const memory = (id: string, resident = 'moss', text = 'Brought the Fellow in.') =>
  scriptedMemory({ id, day: 1, minute: 600 }, cue(90), { resident, place: 'wharf.ferry_slip', text, importance: 4 });
const queued = (...events: unknown[]): EventLog => events.reduce<EventLog>((log, e) => enqueue(log, e).log, emptyEventLog());
const result = (over: Partial<EventIngestionResult> = {}): EventIngestionResult => ({ accepted: [], duplicates: [], rejected: [], regard: {}, ...over });

describe('the event log', () => {
  it('queues valid ClientEvents in order and keeps invalid ones aside with the reason', () => {
    let log = queued(regard('e1'), memory('e2'));
    expect(log.outbox.map(e => e.id)).toEqual(['e1', 'e2']);
    expect(log.outbox.every(e => ClientEvent.safeParse(e).success)).toBe(true);
    const tooLong = enqueue(log, memory('e3', 'moss', 'x'.repeat(201)));
    expect(tooLong.event).toBeNull();
    expect(tooLong.problem).toMatch(/text/);
    expect(tooLong.log.outbox).toHaveLength(2);
    expect(tooLong.log.rejected).toEqual([{ id: 'e3', kind: 'scripted_memory', raw: expect.stringContaining('"id":"e3"'), reason: expect.stringContaining('invalid locally') }]);
    log = enqueue(log, regard('e1')).log; // the same id twice
    expect(log.outbox).toHaveLength(2);
    expect(enqueue(log, { kind: 'nonsense' }).log.rejected.at(-1)).toMatchObject({ id: '', kind: 'nonsense' });
  });

  it('builds town events with the authored importance (§9.6) and clamps minutes', () => {
    const e = townEvent({ id: 't1', day: 3, minute: 700.4 }, { type: 'scuffle', place: 'market_row.bakery', participants: ['player', 'bru', 'bru'], summary: '  Wren won.  ' });
    expect(e).toEqual({ kind: 'town_event', id: 't1', day: 3, minute: 700, type: 'scuffle', place: 'market_row.bakery', participants: ['player', 'bru'], summary: 'Wren won.', importance: 7 });
    expect(ClientEvent.safeParse(e).success).toBe(true);
  });

  it('sends nothing held back (the arrival alias), nothing after the night, at most one batch', () => {
    const log = queued(regard('e1'), memory('e2', 'arrival'), regard('e3', 'pell', 1, 2));
    expect(sendable(log).map(e => e.id)).toEqual(['e1', 'e3']);
    expect(sendable(log, 1).map(e => e.id)).toEqual(['e1']);
    const big = queued(...Array.from({ length: CLIENT_EVENT_BATCH_LIMIT + 20 }, (_, i) => regard(`e${i}`)));
    expect(sendable(big)).toHaveLength(CLIENT_EVENT_BATCH_LIMIT);
  });

  it('adds the scripted Regard still queued to the mirror', () => {
    const log = queued(regard('e1', 'pell', 3), regard('e2', 'pell', -1), regard('e3', 'ada', 2));
    expect(pendingRegard(log, 'pell')).toBe(2);
    expect(pendingRegard(log, 'odile')).toBe(0);
    expect(pendingRegard(null, 'pell')).toBe(0);
  });
});

describe('flags snapshots', () => {
  const t0 = REVISION_EPOCH_MS + 1_000_000;
  it('queue a sorted, bare snapshot with an increasing revision, replacing an unsent older one', () => {
    let log = enqueueFlags(emptyEventLog(), ['met_pell', 's01a_done', '$story', 'met_pell'], { id: 'f1', day: 1, minute: 600 }, t0);
    expect(log.outbox).toEqual([{ kind: 'flags', id: 'f1', day: 1, minute: 600, revision: 1000, flags: ['met_pell', 's01a_done'] }]);
    expect(log.flags_revision).toBe(1000);
    expect(enqueueFlags(log, ['s01a_done', 'met_pell'], { id: 'f2', day: 1, minute: 601 }, t0 + 5000)).toBe(log); // unchanged
    log = enqueue(log, regard('e1')).log;
    log = enqueueFlags(log, ['met_pell', 's01a_done', 'met_moss'], { id: 'f2', day: 1, minute: 601 }, t0); // same second
    expect(log.outbox.map(e => e.id)).toEqual(['e1', 'f2']);
    expect(log.outbox[1]).toMatchObject({ revision: 1001, flags: ['met_moss', 'met_pell', 's01a_done'] });
  });

  it('revisions only go up, across an older loaded save too, and stay in range', () => {
    expect(nextRevision(0, REVISION_EPOCH_MS)).toBe(1);
    expect(nextRevision(5000, t0)).toBe(5001);
    expect(nextRevision(3, t0)).toBe(1000);
    expect(nextRevision(MAX_REVISION, t0)).toBe(MAX_REVISION);
    expect(bareFlags(['B', 'ok_1', '$story', '1x'])).toEqual(['ok_1']);
  });
});

describe('acknowledging an answer', () => {
  it('drops accepted and duplicate ids, keeps refusals with their reason, and keeps "not now" queued', () => {
    const log = enqueueFlags(queued(regard('e1'), regard('e2'), memory('e3'), regard('e4')), ['met_pell'], { id: 'f1', day: 1, minute: 600 }, REVISION_EPOCH_MS);
    const { log: next, rejected, done } = acknowledge(log, result({
      accepted: ['e1'], duplicates: ['e2'],
      rejected: [{ id: 'e3', reason: 'unknown resident' }, { id: 'e4', reason: 'event is outside this unprocessed night' }, { id: 'f1', reason: 'stale flags revision' }, { id: '', reason: 'events.0: bad' }]
    }));
    expect(done.sort()).toEqual(['e1', 'e2']);
    expect(next.outbox.map(e => e.id)).toEqual(['e4']);
    expect(rejected).toEqual([{ id: 'e3', kind: 'scripted_memory', event: expect.objectContaining({ id: 'e3' }), reason: 'unknown resident' }]);
    expect(next.rejected).toHaveLength(1);
    // The stale snapshot went, and the next change sends a fresh one.
    expect(next.flags).toBeNull();
  });

  it(`keeps the ${REJECTED_KEPT} most recent refusals`, () => {
    const many = queued(...Array.from({ length: REJECTED_KEPT + 5 }, (_, i) => regard(`e${i}`)));
    const { log } = acknowledge(many, result({ rejected: many.outbox.map(e => ({ id: e.id, reason: 'unknown resident' })) }));
    expect(log.rejected).toHaveLength(REJECTED_KEPT);
    expect(log.rejected.at(-1)!.id).toBe(`e${REJECTED_KEPT + 4}`);
  });
});

// ── The sender, with a fake API and fake timers ─────────────────────────────

function harness(opts: { enabled?: boolean; answer?: (events: readonly ClientEvent[]) => PostOutcome | Promise<PostOutcome> } = {}) {
  let log: EventLog | null = emptyEventLog();
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let ids = 0;
  const posts: string[][] = [];
  const regards: unknown[] = [];
  const warn = vi.fn();
  const answer = opts.answer ?? (events => ({ ok: true, result: result({ accepted: events.map(e => e.id), regard: { pell: 23 } }) }));
  const sync = new EventSync({
    read: () => log, write: next => { log = next; },
    post: async events => { posts.push(events.map(e => e.id)); return answer(events); },
    enabled: () => opts.enabled ?? true,
    setTimer: (fn, ms) => { const id = ++ids; timers.push({ fn, ms, id }); return id; },
    clearTimer: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onRegard: r => regards.push(r), warn
  });
  const add = (...events: unknown[]) => { for (const e of events) log = enqueue(log!, e).log; sync.notify(); };
  /** Run the next timer (and let its send finish). */
  const tick = async () => { const t = timers.shift(); if (!t) return null; t.fn(); await new Promise(r => setTimeout(r, 0)); return t.ms; };
  return { sync, add, tick, timers, posts, regards, warn, log: () => log, setLog: (l: EventLog | null) => { log = l; } };
}

describe('EventSync', () => {
  it('sends a burst as one request after the debounce, empties the queue and takes the Regard', async () => {
    const h = harness();
    h.add(regard('e1'));
    h.add(memory('e2'), regard('e3'));
    expect(h.timers).toHaveLength(1);
    expect(await h.tick()).toBe(EVENT_SYNC.debounceMs);
    expect(h.posts).toEqual([['e1', 'e2', 'e3']]);
    expect(h.log()!.outbox).toEqual([]);
    expect(h.regards).toEqual([{ pell: 23 }]);
  });

  it('backs off on failures (5 s, 10 s, 20 s…) and keeps everything until the server answers', async () => {
    let fail = 3;
    const h = harness({ answer: events => (fail-- > 0 ? { ok: false, status: fail === 2 ? 503 : null } : { ok: true, result: result({ accepted: events.map(e => e.id) }) }) });
    h.add(regard('e1'));
    expect(await h.tick()).toBe(EVENT_SYNC.debounceMs);
    expect(await h.tick()).toBe(5000);
    expect(await h.tick()).toBe(10000);
    expect(h.log()!.outbox).toHaveLength(1);
    expect(await h.tick()).toBe(20000);
    expect(h.log()!.outbox).toEqual([]);
    expect(h.posts).toHaveLength(4);
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    expect(h.sync.backoff(20)).toBe(EVENT_SYNC.maxRetryMs);
  });

  it('logs refusals and keeps them in the log', async () => {
    const h = harness({ answer: events => ({ ok: true, result: result({ accepted: [events[0]!.id], rejected: [{ id: events[1]!.id, reason: 'unknown place' }] }) }) });
    h.add(regard('e1'), memory('e2'));
    await h.tick();
    expect(h.log()!.outbox).toEqual([]);
    expect(h.log()!.rejected).toEqual([{ id: 'e2', kind: 'scripted_memory', event: expect.objectContaining({ id: 'e2' }), reason: 'unknown place' }]);
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('unknown place'), expect.objectContaining({ id: 'e2' }));
  });

  it('sends what arrived during a request right after it', async () => {
    let release: () => void = () => undefined;
    const h = harness({ answer: events => new Promise(resolve => { release = () => resolve({ ok: true, result: result({ accepted: events.map(e => e.id) }) }); }) });
    h.add(regard('e1'));
    const first = h.timers.shift()!;
    first.fn();
    await Promise.resolve();
    h.add(regard('e2')); // while sending
    release();
    await new Promise(r => setTimeout(r, 0));
    expect(await h.tick()).toBe(EVENT_SYNC.debounceMs);
    release();
    await new Promise(r => setTimeout(r, 0));
    expect(h.posts).toEqual([['e1'], ['e2']]);
    expect(h.log()!.outbox).toEqual([]);
  });

  it('in Quiet Mode keeps everything queued; it stops once the game is gone', async () => {
    const quiet = harness({ enabled: false });
    quiet.add(regard('e1'));
    await quiet.tick();
    expect(quiet.posts).toEqual([]);
    expect(quiet.log()!.outbox).toHaveLength(1);

    const gone = harness();
    gone.add(regard('e1'));
    gone.setLog(null);
    await gone.tick();
    expect(gone.posts).toEqual([]);
    gone.add();
    expect(gone.timers).toEqual([]);
  });

  it('applies a night ingestion the same way', () => {
    const h = harness();
    h.add(regard('e1'), regard('e2'));
    h.sync.apply(result({ duplicates: ['e1'], regard: { pell: 7 } }));
    expect(h.log()!.outbox.map(e => e.id)).toEqual(['e2']);
    expect(h.regards).toEqual([{ pell: 7 }]);
  });
});

// ── MindClient: POST /events and the night's ingestion ──────────────────────

describe("the mind client's event calls", () => {
  const storage = (): StorageLike => { const m = new Map<string, string>(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } }; };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const make = (handler: (url: string, init: RequestInit) => Response | Promise<Response>, offline = false) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => { calls.push({ url: String(input), init }); return handler(String(input), init); });
    let t = 0;
    const mind = new MindClient({ baseUrl: 'https://mind.test', inviteCode: 'SPRING', offline, storage: storage(), fetch: fetch as unknown as typeof globalThis.fetch, randomUUID: () => 'd', log: () => {}, now: () => t });
    return { mind, calls, advance: (ms: number) => { t += ms; } };
  };
  const world = (url: string) => url.endsWith('/v1/worlds') ? json({ world_id: 'w1', token: 't' }) : null;

  it('posts {events} under the world and reads the ingestion result', async () => {
    const events = [regard('e1'), memory('e2')].map(e => ClientEvent.parse(e));
    const answer = result({ accepted: ['e1'], duplicates: ['e2'], regard: { pell: 3, moss: 0 } });
    const { mind, calls } = make(url => world(url) ?? json(answer));
    expect(await mind.postEvents(events)).toEqual({ ok: true, result: answer });
    expect(calls[1]!.url).toBe('https://mind.test/v1/worlds/w1/events');
    expect(calls[1]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ events });
  });

  it('reports HTTP failures and malformed answers, goes quiet after a network failure, never calls offline', async () => {
    const down = make(url => world(url) ?? json({ error: 'Database unavailable' }, 503));
    expect(await down.mind.postEvents([])).toEqual({ ok: false, status: 503 });
    const odd = make(url => world(url) ?? json({ hello: 1 }));
    expect(await odd.mind.postEvents([])).toEqual({ ok: false, status: 200 });
    let broken = true;
    const net = make(url => { if (url.endsWith('/events') && broken) throw new TypeError('Failed to fetch'); return world(url) ?? json(result()); });
    expect(await net.mind.postEvents([])).toEqual({ ok: false, status: null });
    broken = false;
    expect(await net.mind.postEvents([])).toEqual({ ok: false, status: null }); // cooling off
    net.advance(60_000);
    expect(await net.mind.postEvents([])).toMatchObject({ ok: true });
    const off = make(() => json(result()), true);
    expect(await off.mind.postEvents([])).toEqual({ ok: false, status: null });
    expect(off.calls).toEqual([]);
  });

  it("returns the night's status and the ingestion of its client_events", async () => {
    const ingestion = result({ accepted: ['e1'], regard: { pell: 3 } });
    const { mind, calls } = make(url => world(url) ?? json({ day: 4, complete: true, ingestion }));
    const events = [ClientEvent.parse(regard('e1'))];
    expect(await mind.postNight({ day: 4, client_events: events })).toEqual({ status: 200, ingestion });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ day: 4, client_events: events });
    const passed = make(url => world(url) ?? json({ error: 'that night has already passed' }, 409));
    expect(await passed.mind.postNight({ day: 4 })).toEqual({ status: 409 });
  });
});
