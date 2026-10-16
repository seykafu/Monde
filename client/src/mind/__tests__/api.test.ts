import { describe, expect, it, vi } from 'vitest';
import { MindClient, mindConfig, STORAGE_KEYS, uuid, type MindOptions, type StorageLike } from '../api';
import { PrewarmGate } from '../prewarm';
import type { TalkRequest, TalkTurn } from '../types';

const BASE = 'https://mind.test';
const WORLD = '3f2c1e8a-1111-4222-8333-444455556666';
const TOKEN = 'a'.repeat(64);

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const throwingStorage: StorageLike = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); }
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sse = (chunks: string[], opts: { hang?: boolean } = {}) => new Response(new ReadableStream<Uint8Array>({
  start(c) {
    const enc = new TextEncoder();
    for (const chunk of chunks) c.enqueue(enc.encode(chunk));
    if (!opts.hang) c.close();
  }
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const client = (over: Partial<MindOptions>) => new MindClient({
  baseUrl: BASE, inviteCode: 'SPRING', storage: new MemoryStorage(), fetch: fakeFetch(() => json({})).fetch,
  randomUUID: () => 'device-1', log: () => {}, ...over
});

const request: TalkRequest = {
  resident_id: 'pell', conversation_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', input: { kind: 'open' },
  context: { day: 1, minute: 600, place: 'old_quarter.fountain_square', weather: 'sunny', current_activity: 'walk at old_quarter.fountain_square' }
};
const quietTurn: TalkTurn = {
  conversation_id: request.conversation_id, resident_id: 'pell', turn_index: 0, lines: [{ text: 'Morning, Fellow.', expr: 'neutral' }],
  choices: [{ id: 'leave', text: 'Leave', intent: 'leave' }], wrap_up: false, fallback: true
};
const serverTurn: TalkTurn = { ...quietTurn, lines: [{ text: 'Morning. The lamps held.', expr: 'warm' }], fallback: false };
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

describe('session bootstrap', () => {
  it('creates a world on first run and remembers device, world and token', async () => {
    const storage = new MemoryStorage();
    const { fetch, calls } = fakeFetch(() => json({ world_id: WORLD, token: TOKEN }));
    const mind = client({ storage, fetch });
    const session = await mind.ensureWorld();
    expect(session).toEqual({ device_id: 'device-1', world_id: WORLD, token: TOKEN, base_url: BASE });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/v1/worlds`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ device_id: 'device-1', invite_code: 'SPRING' });
    expect(storage.getItem(STORAGE_KEYS.device)).toBe('device-1');
    expect(storage.getItem(STORAGE_KEYS.invite)).toBe('SPRING');
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.session)!)).toEqual(session);
    expect(mind.online).toBe(true);
    // Concurrent and later calls share the one world.
    await Promise.all([mind.ensureWorld(), mind.ensureWorld()]);
    expect(calls).toHaveLength(1);
  });

  it('reuses a stored session and the remembered invite on the next run', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.device, 'device-9');
    storage.setItem(STORAGE_KEYS.session, JSON.stringify({ device_id: 'device-9', world_id: WORLD, token: TOKEN, base_url: BASE }));
    const { fetch, calls } = fakeFetch(() => json({}));
    const mind = client({ storage, fetch, inviteCode: null, randomUUID: () => 'unused' });
    expect(mind.deviceId).toBe('device-9');
    expect((await mind.ensureWorld())?.world_id).toBe(WORLD);
    expect(calls).toHaveLength(0);
    // A session for another server is ignored.
    const other = client({ storage, fetch, baseUrl: 'https://elsewhere.test', inviteCode: null });
    expect(await other.ensureWorld()).toBeNull();
  });

  it('works with storage that throws: nothing is remembered, nothing breaks', async () => {
    const { fetch, calls } = fakeFetch(() => json({ world_id: WORLD, token: TOKEN }));
    const mind = client({ storage: throwingStorage, fetch });
    expect(mind.deviceId).toBe('device-1');
    expect((await mind.ensureWorld())?.token).toBe(TOKEN);
    expect(await mind.ensureWorld()).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(mind.playerName).toBe('Fellow');
    expect(client({ storage: null, fetch, inviteCode: null }).enabled).toBe(false);
  });

  it('plays in Quiet Mode with no invite code, with ?offline, or when the server is unreachable', async () => {
    const none = fakeFetch(() => json({}));
    expect(await client({ fetch: none.fetch, inviteCode: null }).ensureWorld()).toBeNull();
    expect(await client({ fetch: none.fetch, offline: true }).ensureWorld()).toBeNull();
    expect(none.calls).toHaveLength(0);

    let now = 0;
    const down = fakeFetch(() => { throw new TypeError('Failed to fetch'); });
    const mind = client({ fetch: down.fetch, now: () => now });
    expect(await mind.ensureWorld()).toBeNull();
    expect(mind.online).toBe(false);
    expect(await mind.ensureWorld()).toBeNull(); // cooling off: no second attempt yet
    expect(down.calls).toHaveLength(1);
    now = 61_000;
    await mind.ensureWorld();
    expect(down.calls).toHaveLength(2);
  });

  it('stops asking after the invite code is refused', async () => {
    const { fetch, calls } = fakeFetch(() => json({ error: 'Invalid invite code' }, 403));
    const mind = client({ fetch });
    expect(await mind.ensureWorld()).toBeNull();
    expect(await mind.ensureWorld()).toBeNull();
    expect(calls).toHaveLength(1);
    expect(mind.enabled).toBe(false);
  });

  it("uses a build's own invite only when none is given or remembered", () => {
    expect(client({ inviteCode: null, defaultInvite: 'BUILD' }).invite).toBe('BUILD');
    expect(client({ inviteCode: 'URL', defaultInvite: 'BUILD' }).invite).toBe('URL');
    const storage = new MemoryStorage();
    client({ inviteCode: 'SAVED', storage });
    expect(client({ inviteCode: null, defaultInvite: 'BUILD', storage }).invite).toBe('SAVED');
    expect(client({ inviteCode: null, defaultInvite: '  ' }).invite).toBeNull();
  });

  it('reads the server and invite from the build and the URL', () => {
    expect(mindConfig('?invite=SPRING&dev')).toMatchObject({ inviteCode: 'SPRING', offline: false });
    expect(mindConfig('?offline').offline).toBe(true);
    expect(mindConfig('').baseUrl).toMatch(/^https:\/\//);
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('talk', () => {
  const online = (handler: Handler) => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.device, 'device-1');
    storage.setItem(STORAGE_KEYS.session, JSON.stringify({ device_id: 'device-1', world_id: WORLD, token: TOKEN, base_url: BASE }));
    const f = fakeFetch(handler);
    return { mind: client({ storage, fetch: f.fetch }), calls: f.calls, storage };
  };

  it('streams deltas and the thinking beat, and resolves with the server turn', async () => {
    const body = event('line_delta', { index: 0, text_so_far: 'Morning.', attempt: 1 }) + event('thinking', { text: 'Hm.' })
      + event('line_delta', { index: 0, text_so_far: 'Morning. The lamps held.', attempt: 1 }) + event('turn', serverTurn);
    const { mind, calls } = online(() => sse([body.slice(0, 40), body.slice(40, 41), body.slice(41)]));
    const deltas: string[] = [], thinking: string[] = [];
    const result = await mind.talk(request, { onLineDelta: d => deltas.push(d.text_so_far), onThinking: t => thinking.push(t), fallback: () => quietTurn });
    expect(result).toEqual({ turn: serverTurn, source: 'server' });
    expect(deltas).toEqual(['Morning.', 'Morning. The lamps held.']);
    expect(thinking).toEqual(['Hm.']);
    expect(calls[0]!.url).toBe(`${BASE}/v1/worlds/${WORLD}/talk`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(request);
  });

  it('maps a network failure, an HTTP error or a stream without a turn to a Quiet Mode turn', async () => {
    const down = online(() => { throw new TypeError('Failed to fetch'); });
    expect(await down.mind.talk(request, { fallback: () => quietTurn })).toMatchObject({ turn: quietTurn, source: 'quiet' });
    expect(down.mind.online).toBe(false); // the next turn goes straight to Quiet Mode
    const calls = down.calls.length;
    expect((await down.mind.talk(request, { fallback: () => quietTurn }))?.source).toBe('quiet');
    expect(down.calls.length).toBe(calls);

    const broken = online(() => json({ error: 'boom' }, 500));
    expect((await broken.mind.talk(request, { fallback: () => quietTurn }))?.source).toBe('quiet');
    const cut = online(() => sse([event('line_delta', { index: 0, text_so_far: 'Mor', attempt: 1 })]));
    expect(await cut.mind.talk(request, { fallback: () => quietTurn })).toMatchObject({ source: 'quiet', reason: 'stream ended without a turn' });
  });

  it('starts a new world when the old one is refused (401), then retries', async () => {
    let worlds = 0;
    const { mind, calls, storage } = online((url, init) => {
      if (url.endsWith('/v1/worlds')) { worlds++; return json({ world_id: 'new-world', token: 'b'.repeat(64) }); }
      const auth = (init.headers as Record<string, string>).authorization;
      return auth === `Bearer ${TOKEN}` ? json({ error: 'Unauthorized' }, 401) : sse([event('turn', serverTurn)]);
    });
    const result = await mind.talk(request, { fallback: () => quietTurn });
    expect(result?.source).toBe('server');
    expect(worlds).toBe(1);
    expect(calls.map(c => c.url)).toEqual([`${BASE}/v1/worlds/${WORLD}/talk`, `${BASE}/v1/worlds`, `${BASE}/v1/worlds/new-world/talk`]);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.session)!).world_id).toBe('new-world');
  });

  it('resolves null when the caller aborts mid-stream', async () => {
    const { mind } = online((_url, init) => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(event('line_delta', { index: 0, text_so_far: 'Mor', attempt: 1 })));
        init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      }
    }), { status: 200 }));
    const abort = new AbortController();
    const pending = mind.talk(request, { signal: abort.signal, onLineDelta: () => abort.abort(), fallback: () => quietTurn });
    expect(await pending).toBeNull();
    expect(mind.online).toBe(true); // an abort isn't an outage
  });

  it('gives up on a stalled stream and falls back', async () => {
    vi.useFakeTimers();
    try {
      const { mind } = online((_url, init) => new Response(new ReadableStream<Uint8Array>({
        start(c) { init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); }
      }), { status: 200 }));
      const pending = mind.talk(request, { fallback: () => quietTurn });
      await vi.advanceTimersByTimeAsync(10_500);
      expect(await pending).toMatchObject({ source: 'quiet', reason: 'stream stalled' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('prewarm', () => {
  it('posts at most once per resident per 4 in-game hours, and never throws', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.device, 'device-1');
    storage.setItem(STORAGE_KEYS.session, JSON.stringify({ device_id: 'device-1', world_id: WORLD, token: TOKEN, base_url: BASE }));
    const { fetch, calls } = fakeFetch(() => json({ warmed: true }));
    const mind = client({ storage, fetch });
    mind.prewarmNear('pell', 1, 600);
    mind.prewarmNear('pell', 1, 700);
    mind.prewarmNear('odile', 1, 700);
    mind.prewarmNear('pell', 1, 840);
    await new Promise(r => setTimeout(r, 0));
    expect(calls.map(c => [c.url.split('/').pop(), JSON.parse(String(c.init.body)).resident_id])).toEqual([['prewarm', 'pell'], ['prewarm', 'odile'], ['prewarm', 'pell']]);
    const down = client({ storage, fetch: fakeFetch(() => { throw new TypeError('offline'); }).fetch });
    await expect(down.prewarm('pell', 1)).resolves.toBeUndefined();
  });

  it('gates by game time, across days, and lets a rewound clock through', () => {
    const gate = new PrewarmGate();
    expect(gate.allow('pell', 1, 1500)).toBe(true);
    expect(gate.allow('pell', 2, 360 + 100)).toBe(false); // 160 game minutes later (26:00 and the next 06:00 are the same moment)
    expect(gate.allow('pell', 2, 360 + 180)).toBe(true);
    expect(gate.allow('pell', 2, 400)).toBe(true); // the dev keys moved the clock back
  });
});
