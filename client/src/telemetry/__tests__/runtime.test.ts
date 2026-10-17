import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ data: new Map<string,string>(), fetch: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../mind/api', () => ({
  browserStorage: () => ({ getItem: (k: string) => state.data.get(k) ?? null, setItem: (k: string,v: string) => state.data.set(k,v) }),
  getMind: () => ({ worldId: null }), mindConfig: () => ({ baseUrl: 'https://example.test' }),
}));
import { chooseTelemetry, queue } from '../runtime';
import { telemetry } from '../emit';
it('only sends after consent, omits cookies/referrers, and stops on opt-out', async () => {
  vi.stubGlobal('fetch',state.fetch);
  try {
    telemetry({type:'day_reached',day:1}); await queue.flush(); expect(state.fetch).not.toHaveBeenCalled();
    chooseTelemetry(true); telemetry({type:'day_reached',day:1}); await queue.flush();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = state.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/telemetry');
    expect(init).toMatchObject({credentials:'omit',referrerPolicy:'no-referrer'});
    const body = JSON.parse(String(init.body)); expect(body.telemetry_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual(['events','telemetry_id']);
    chooseTelemetry(false); telemetry({type:'day_reached',day:2}); await queue.flush();
    expect(state.fetch).toHaveBeenCalledTimes(1);
  } finally { chooseTelemetry(false); vi.unstubAllGlobals(); }
});
