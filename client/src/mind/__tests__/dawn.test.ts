import { describe, expect, it, vi } from 'vitest';
import type { PlanOutput } from '@monde/shared';
import { DAWN_SYNC, modelPlans, parseDawnPackage, syncDawn, type DawnPackage, type DawnSyncDeps } from '../dawn';
import { MindClient, type StorageLike } from '../api';
import { asTurn } from '../talkStream';

const plan: PlanOutput = {
  blocks: [{ start: '06:00', end: '12:00', action: 'work', place: 'market_row.bakery', with: [], note: 'Rye first.' }],
  whim: null, barks: ['Rye.', 'Two.', 'Shut the door.'], seek_player: null, intentions: []
};
const wire = (over: Record<string, unknown> = {}) => ({
  day: 5, weekday: 'Sat',
  plans: [{ resident_id: 'odile', tier: 'core', source: 'model', plan }, { resident_id: 'june', tier: 'core', source: 'template', plan: { blocks: [] } }],
  letters: [{ id: 'l1', from: 'odile', to: 'player', day: 4, text: 'Door.' }, { id: 7 }],
  favors: [], ties: { pairs: [{ a: 'june', b: 'odile', label: 'friends', romance: null }, { a: 'x', b: 'y', label: 'strangers', romance: null }], milestones: [] },
  pending: 0, complete: true, ...over
});

describe('the dawn package off the wire', () => {
  it('keeps well-formed items and drops the rest', () => {
    const pkg = parseDawnPackage(wire())!;
    expect(pkg.day).toBe(5);
    expect(pkg.letters.map(l => l.id)).toEqual(['l1']);
    expect(pkg.ties.pairs).toEqual([{ a: 'june', b: 'odile', label: 'friends', romance: null }]);
    expect(pkg.complete).toBe(true);
    expect(parseDawnPackage(wire({ complete: false, pending: 3 }))).toMatchObject({ complete: false, pending: 3 });
    expect(parseDawnPackage({ day: 0, plans: [] })).toBeNull();
    expect(parseDawnPackage('nope')).toBeNull();
  });

  it('takes only model plans that pass the plan schema', () => {
    const pkg = parseDawnPackage(wire({ plans: [...wire().plans as object[], { resident_id: 'rook', tier: 'core', source: 'model', plan: { blocks: 'soon' } }] }))!;
    expect(modelPlans(pkg.plans)).toEqual({ odile: plan });
  });
});

/** A fake server: `ready` reads after which the package is complete; the clock moves only by sleeping. */
function fakeServer(opts: { ready?: number; night?: number | null; dawnFails?: number } = {}) {
  let t = 0, reads = 0;
  const calls: string[] = [];
  const deps: DawnSyncDeps = {
    postNight: vi.fn(async body => { calls.push(`night ${body.day}`); t += 400; return opts.night === undefined ? 200 : opts.night; }),
    getDawn: vi.fn(async day => {
      calls.push(`dawn ${day}`);
      reads++;
      t += 50;
      if (opts.dawnFails !== undefined && reads >= opts.dawnFails) return null;
      return parseDawnPackage(wire({ day, complete: reads >= (opts.ready ?? 1), pending: reads >= (opts.ready ?? 1) ? 0 : 4 }));
    }),
    sleep: vi.fn(async ms => { t += ms; }),
    now: () => t
  };
  return { deps, calls };
}

describe('syncing a dawn (§9.8: polling briefly, then templates)', () => {
  it('posts the night of yesterday, then reads today\'s package', async () => {
    const { deps, calls } = fakeServer();
    const r = await syncDawn(deps, 5, { day: 4 });
    expect(r.status).toBe('complete');
    expect(calls).toEqual(['night 4', 'dawn 5']);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('asks again while the night is still working', async () => {
    const { deps, calls } = fakeServer({ ready: 3 });
    const r = await syncDawn(deps, 5, { day: 4 });
    expect(r).toMatchObject({ status: 'complete', polls: 3 });
    expect(calls).toEqual(['night 4', 'dawn 5', 'dawn 5', 'dawn 5']);
    expect(deps.sleep).toHaveBeenCalledWith(DAWN_SYNC.pollMs);
  });

  it('stops at the budget and takes what it has', async () => {
    const { deps } = fakeServer({ ready: 1000 });
    const r = await syncDawn(deps, 5, { day: 4 });
    expect(r.status).toBe('partial');
    expect(r.pkg?.complete).toBe(false);
    // 400 ms for the night, then reads a second apart until the next would pass 6 s.
    expect(r.polls).toBe(6);
  });

  it('is offline when the night can\'t be posted, and never reads the dawn', async () => {
    const { deps, calls } = fakeServer({ night: null });
    expect(await syncDawn(deps, 5, { day: 4 })).toMatchObject({ status: 'offline', pkg: null });
    expect(calls).toEqual(['night 4']);
  });

  it('goes on after a 409 (the night already ran)', async () => {
    const { deps } = fakeServer({ night: 409 });
    expect((await syncDawn(deps, 5, { day: 4 })).status).toBe('complete');
  });

  it('keeps the last package when a later read fails, and is offline if the first does', async () => {
    const later = fakeServer({ ready: 1000, dawnFails: 3 });
    expect(await syncDawn(later.deps, 5, { day: 4 })).toMatchObject({ status: 'partial', polls: 3 });
    const first = fakeServer({ dawnFails: 1 });
    expect(await syncDawn(first.deps, 5, { day: 4 })).toMatchObject({ status: 'offline', reason: 'dawn unreachable' });
  });

  it('resumes a day without posting its night again', async () => {
    const { deps, calls } = fakeServer();
    await syncDawn(deps, 7, null);
    expect(calls).toEqual(['dawn 7']);
  });
});

describe('the mind client\'s night and dawn calls', () => {
  const storage = (): StorageLike => { const m = new Map<string, string>(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } }; };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const make = (handler: (url: string, init: RequestInit) => Response, offline = false) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => { calls.push({ url: String(input), init }); return handler(String(input), init); });
    const mind = new MindClient({ baseUrl: 'https://mind.test', inviteCode: 'SPRING', offline, storage: storage(), fetch: fetch as unknown as typeof globalThis.fetch, randomUUID: () => 'd', log: () => {} });
    return { mind, calls };
  };

  it('posts the night and reads the package under the world', async () => {
    const { mind, calls } = make((url) => url.endsWith('/v1/worlds') ? json({ world_id: 'w1', token: 't' })
      : url.endsWith('/night') ? json({ day: 4, complete: true }) : json(wire()));
    expect(await mind.postNight({ day: 4 })).toEqual({ status: 200 });
    const pkg: DawnPackage | null = await mind.getDawn(5);
    expect(pkg?.ties.pairs).toHaveLength(1);
    expect(calls.map(c => `${c.init.method} ${c.url}`)).toEqual([
      'POST https://mind.test/v1/worlds', 'POST https://mind.test/v1/worlds/w1/night', 'GET https://mind.test/v1/worlds/w1/dawn/5'
    ]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ day: 4 });
  });

  it('never calls out in Quiet Mode', async () => {
    const { mind, calls } = make(() => json({}), true);
    expect(await mind.postNight({ day: 4 })).toBeNull();
    expect(await mind.getDawn(5)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reads a network failure as no server', async () => {
    const { mind } = make(url => { if (url.endsWith('/v1/worlds')) return json({ world_id: 'w1', token: 't' }); throw new TypeError('offline'); });
    expect(await mind.postNight({ day: 4 })).toBeNull();
    expect(await mind.getDawn(5)).toBeNull();
  });
});

describe('the turn event\'s applied Regard (G-13)', () => {
  const base = { conversation_id: 'c', resident_id: 'odile', turn_index: 0, lines: [{ text: 'Rye.', expr: 'neutral' }], choices: [], wrap_up: false, fallback: false };
  it('reads it when it\'s there, null when the server saved nothing, absent when not sent', () => {
    const regard = { before: 18, after: 24, delta: 6, hearts_before: 1.5, hearts_after: 2, first_chat: true, capped: false };
    expect(asTurn({ ...base, regard })?.regard).toEqual(regard);
    expect(asTurn({ ...base, regard: null })?.regard).toBeNull();
    expect(asTurn({ ...base, regard: { before: 'x' } })?.regard).toBeNull();
    expect(asTurn(base)).not.toHaveProperty('regard');
  });
});
