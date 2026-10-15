// The Fellowship application reaches the server whenever it can (W-07): signed offline it waits, and goes on the
// next connect; a refused name isn't retried forever.
import { describe, expect, it, vi } from 'vitest';
import { MindClient, STORAGE_KEYS, type MindOptions, type StorageLike } from '../api';
import type { PlayerProfile } from '../types';

const BASE = 'https://mind.test';
const WORLD = '3f2c1e8a-1111-4222-8333-444455556666';
const wren: PlayerProfile = { name: 'Wren', pronouns: 'xe/xem/xyr', background: 'homecomer', why: 'running', loves: 'tea' };

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, over: Partial<MindOptions> = {}, storage = new MemoryStorage()) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => { calls.push({ url: String(input), init }); return handler(String(input), init); });
  const mind = new MindClient({ baseUrl: BASE, inviteCode: 'SPRING', storage, fetch: fetch as unknown as typeof globalThis.fetch, randomUUID: () => 'device-1', log: () => {}, ...over });
  return { mind, calls, storage };
}
const patches = (calls: { url: string; init: RequestInit }[]) => calls.filter(c => c.init.method === 'PATCH');
const flush = () => new Promise(r => setTimeout(r, 0));

describe('sending the Fellowship application', () => {
  it('keeps it locally with ?offline and never calls the server', async () => {
    const { mind, calls, storage } = setup(() => json({}), { offline: true });
    expect(await mind.setPlayer(wren)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(mind.playerSynced).toBe(false);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.player)!)).toEqual(wren);
    expect(mind.playerName).toBe('Wren');
  });

  it('sends it as soon as a world exists, and once only', async () => {
    const { mind, calls } = setup((url, init) => init.method === 'PATCH' ? json({ player: wren }) : json({ world_id: WORLD, token: 't'.repeat(64) }));
    expect(await mind.setPlayer(wren)).toBe(true);
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.url).toBe(`${BASE}/v1/worlds/${WORLD}/player`);
    expect(JSON.parse(String(patches(calls)[0]!.init.body))).toEqual(wren);
    expect(mind.playerSynced).toBe(true);
    expect(await mind.syncPlayer()).toBe(true);
    expect(patches(calls)).toHaveLength(1);
  });

  it('waits out a failed send and goes on the next connect (a fresh start of the game)', async () => {
    const storage = new MemoryStorage();
    let up = false;
    const handler = (_url: string, init: RequestInit) => {
      if (!up && init.method === 'PATCH') throw new TypeError('Failed to fetch');
      return init.method === 'PATCH' ? json({ player: wren }) : json({ world_id: WORLD, token: 't'.repeat(64) });
    };
    const first = setup(handler, {}, storage);
    expect(await first.mind.setPlayer(wren)).toBe(false);
    expect(storage.getItem(STORAGE_KEYS.playerSynced)).toBe('0');
    // Next run: the stored application is still unsent; main.ts calls syncPlayer once the world is there.
    up = true;
    const next = setup(handler, {}, storage);
    expect(next.mind.player).toEqual(wren);
    expect(next.mind.playerSynced).toBe(false);
    await next.mind.ensureWorld();
    expect(await next.mind.syncPlayer()).toBe(true);
    expect(patches(next.calls)).toHaveLength(1);
    expect(storage.getItem(STORAGE_KEYS.playerSynced)).toBe('1');
  });

  it('sends it to a new world when the old one is gone', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.device, 'device-1');
    storage.setItem(STORAGE_KEYS.player, JSON.stringify(wren));
    storage.setItem(STORAGE_KEYS.playerSynced, '1');
    const { mind, calls } = setup((url, init) => init.method === 'PATCH' ? json({ player: wren }) : json({ world_id: WORLD, token: 't'.repeat(64) }), {}, storage);
    expect(mind.playerSynced).toBe(true);
    await mind.ensureWorld();
    await flush(); await flush();
    expect(patches(calls)).toHaveLength(1);
    expect(mind.playerSynced).toBe(true);
  });

  it('stops retrying a name the server refuses (its word filter is the authority)', async () => {
    const { mind, calls } = setup((url, init) => init.method === 'PATCH' ? json({ error: 'invalid player profile' }, 400) : json({ world_id: WORLD, token: 't'.repeat(64) }));
    expect(await mind.setPlayer(wren)).toBe(false);
    expect(mind.playerSynced).toBe(true);
    await mind.syncPlayer();
    expect(patches(calls)).toHaveLength(1);
    expect(mind.playerName).toBe('Wren');
  });
});
