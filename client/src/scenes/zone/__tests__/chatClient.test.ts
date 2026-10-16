import { expect, it, vi } from 'vitest';
import { MindClient, STORAGE_KEYS } from '../../../mind/api';
import { ambientExchange } from '@monde/shared';
const body = { a: 'june', b: 'odile', day: 1, minute: 900, place: 'square', weather: 'clear' };
const reply = { lines: ambientExchange('june', 'odile'), fallback: false, reason: 'ok', effects: { a: { affinity: 1, trust: 0 }, b: { affinity: 1, trust: 0 }, feeling: null, news: [] }, applied: { ab: 1, ba: 1 } };
function client(fetcher: typeof fetch, offline = false) {
  const data = new Map<string, string>([[STORAGE_KEYS.device, 'device'], [STORAGE_KEYS.session, JSON.stringify({ device_id: 'device', world_id: 'world', token: 'secret', base_url: 'https://test.invalid' })]]);
  return new MindClient({ baseUrl: 'https://test.invalid', offline, storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } }, fetch: fetcher, randomUUID: () => 'uuid' });
}
it('authenticates chat and rejects an invalid speaker sequence', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(reply)).mockResolvedValueOnce(Response.json({ ...reply, lines: [...reply.lines].reverse() }));
  const mind = client(fetcher);
  expect(await mind.chat(body)).toEqual(reply);
  expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer secret' });
  expect(await mind.chat(body)).toBeNull();
});
it('returns control for offline, cancelled and failed requests', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  expect(await client(fetcher, true).chat(body)).toBeNull();
  const abort = new AbortController(); abort.abort();
  expect(await client(fetcher).chat(body, abort.signal)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  expect(await client(fetcher).chat(body)).toBeNull();
});
it('keeps the timeout alive while reading the response body', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => ({ ok: true,
      json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    }) as Response);
    const pending = client(fetcher).chat(body);
    await vi.advanceTimersByTimeAsync(16001);
    expect(await pending).toBeNull();
  } finally { vi.useRealTimers(); }
});
