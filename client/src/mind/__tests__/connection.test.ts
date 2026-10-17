import { describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_MARKER, RECONNECT_DELAYS_MS, Reconnect, isQuiet, maskInvite, mindStatus, offlineMarker, statusDetail, statusLabel, validInvite,
  type MindSnapshot
} from '../connection';
import { MindClient, STORAGE_KEYS, type StorageLike } from '../api';

const base: MindSnapshot = { offline: false, hasSession: false, hasInvite: false, inviteRejected: false, coolingOff: false };

describe('mind status', () => {
  it('reads the client state the way the HUD and Settings need it', () => {
    expect(mindStatus(base)).toBe('no_invite');
    expect(mindStatus({ ...base, hasInvite: true })).toBe('connecting');
    expect(mindStatus({ ...base, hasInvite: true, inviteRejected: true })).toBe('no_invite');
    expect(mindStatus({ ...base, hasSession: true })).toBe('online');
    expect(mindStatus({ ...base, hasSession: true, coolingOff: true })).toBe('unreachable');
    expect(mindStatus({ ...base, hasInvite: true, coolingOff: true })).toBe('unreachable');
    expect(mindStatus({ ...base, offline: true, hasSession: true })).toBe('offline');
  });

  it('labels only the offline states, and says what to do about each', () => {
    expect(statusLabel('online')).toBe('');
    expect(statusLabel('connecting')).toBe('connecting');
    for (const s of ['unreachable', 'no_invite', 'offline'] as const) {
      expect(statusLabel(s)).toBe('offline');
      expect(isQuiet(s)).toBe(true);
      expect(statusDetail(s)).toMatch(/written lines/);
    }
    expect(isQuiet('online')).toBe(false);
    expect(isQuiet('connecting')).toBe(false);
    expect(statusDetail('no_invite')).toMatch(/Settings/);
  });
});

describe('the dialogue panel marker', () => {
  it('shows on Quiet Mode turns and on a server with no model, never on live or server-fallback turns', () => {
    expect(offlineMarker('quiet', 'no world')).toBe(OFFLINE_MARKER);
    expect(offlineMarker('quiet', 'offline')).toBe(OFFLINE_MARKER);
    expect(offlineMarker('quiet', 'cooling off after a network failure')).toBe(OFFLINE_MARKER);
    expect(offlineMarker('server', undefined, 'unavailable')).toBe(OFFLINE_MARKER);
    expect(offlineMarker('server')).toBeNull();
    // A model hiccup on a live server is a fallback line, not Quiet Mode.
    expect(offlineMarker('server', undefined, 'timeout')).toBeNull();
    expect(offlineMarker('server', undefined, 'max_tokens')).toBeNull();
    // The authored farewell is built locally on a live conversation: no reason, no marker.
    expect(offlineMarker('quiet')).toBeNull();
  });
});

describe('invite codes', () => {
  it('accepts what --invite= accepts and masks it for the screen', () => {
    expect(validInvite('SPRING-2026_a')).toBe(true);
    expect(validInvite(' SPRING ')).toBe(true);
    expect(validInvite('two words')).toBe(false);
    expect(validInvite('')).toBe(false);
    expect(validInvite('x'.repeat(65))).toBe(false);
    expect(maskInvite(null)).toBe('not set');
    expect(maskInvite('SPRING-1234')).toBe('SP•••••••34');
    expect(maskInvite('abc')).toBe('•••');
  });
});

describe('gentle reconnect', () => {
  it('retries an unreachable server at 15 s, 30 s, then every 60 s, and resets once back', () => {
    const r = new Reconnect();
    expect(r.due(0, 'unreachable')).toBe(false);
    expect(r.due(RECONNECT_DELAYS_MS[0]! - 1, 'unreachable')).toBe(false);
    expect(r.due(15_000, 'unreachable')).toBe(true);
    expect(r.due(15_000 + 29_999, 'unreachable')).toBe(false);
    expect(r.due(45_000, 'unreachable')).toBe(true);
    expect(r.due(105_000, 'unreachable')).toBe(true);
    expect(r.due(164_999, 'unreachable')).toBe(false);
    expect(r.due(165_000, 'unreachable')).toBe(true);
    expect(r.due(170_000, 'online')).toBe(false);
    // Back to the short delay after a recovery.
    expect(r.due(200_000, 'unreachable')).toBe(false);
    expect(r.due(215_000, 'unreachable')).toBe(true);
  });

  it("never retries a state a retry can't fix", () => {
    const r = new Reconnect();
    for (const status of ['online', 'connecting', 'no_invite', 'offline'] as const) expect(r.due(1e9, status)).toBe(false);
  });
});

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('MindClient status, invite and reconnect', () => {
  const make = (handler: (url: string) => Response | Promise<Response>, over: { inviteCode?: string | null; storage?: StorageLike; now?: () => number } = {}) => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => { calls.push(String(input)); return handler(String(input)); }) as unknown as typeof globalThis.fetch;
    const mind = new MindClient({ baseUrl: 'https://mind.test', inviteCode: over.inviteCode ?? null, storage: over.storage ?? new MemoryStorage(), fetch,
      randomUUID: () => 'device-1', log: () => {}, now: over.now });
    return { mind, calls };
  };

  it('is offline without an invite, and joins as soon as Settings sets one', async () => {
    const storage = new MemoryStorage();
    const { mind, calls } = make(() => json({ world_id: 'w1', token: 't'.repeat(64) }), { storage });
    expect(mind.status).toBe('no_invite');
    expect(mind.invite).toBeNull();
    expect(await mind.setInvite('  SPRING  ')).toBe('online');
    expect(mind.invite).toBe('SPRING');
    expect(storage.data.get(STORAGE_KEYS.invite)).toBe('SPRING');
    expect(calls).toEqual(['https://mind.test/v1/worlds']);
  });

  it('reports a refused invite, and forgets a cleared one', async () => {
    const storage = new MemoryStorage();
    const { mind } = make(() => json({ error: 'Invalid invite code' }, 403), { storage });
    expect(await mind.setInvite('WRONG')).toBe('no_invite');
    expect(await mind.setInvite(null)).toBe('no_invite');
    expect(storage.data.has(STORAGE_KEYS.invite)).toBe(false);
  });

  it('cools off when the server is unreachable, and a reconnect clears it once the server answers', async () => {
    let t = 0;
    let up = false;
    const { mind, calls } = make(url => {
      if (!up) throw new TypeError('fetch failed');
      return url.endsWith('/v1/worlds') ? json({ world_id: 'w1', token: 't'.repeat(64) }) : json({ ok: true });
    }, { inviteCode: 'SPRING', now: () => t });
    expect(mind.status).toBe('connecting');
    await mind.ensureWorld();
    expect(mind.status).toBe('unreachable');
    t += 5_000;
    expect(await mind.reconnect()).toBe('unreachable');
    up = true;
    expect(await mind.reconnect()).toBe('online');
    // With a world, a reconnect only asks the server's health.
    expect(await mind.reconnect()).toBe('online');
    expect(calls.at(-1)).toBe('https://mind.test/v1/health');
  });
});

it('marks a server budget fallback as written lines without a network retry', () => {
  expect(offlineMarker('server', null, 'budget')).toBe(OFFLINE_MARKER);
  expect(isQuiet('budget')).toBe(true);
  expect(new Reconnect().due(100_000, 'budget')).toBe(false);
});
