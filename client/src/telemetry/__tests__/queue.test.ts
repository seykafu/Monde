import { describe, it, expect, vi } from 'vitest';
import { TelemetryQueue, QUEUE_LIMIT } from '../queue';
import { readChoice, SurveyGate } from '../prefs';
const uuid = () => crypto.randomUUID();
function store() { const data = new Map<string,string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => { data.set(k,v); } }; }
describe('anonymous telemetry queue', () => {
  it('is off by default; caps, batches, persists, and retries only three times', async () => {
    const send = vi.fn(async (_items: unknown) => false), storage = store();
    const q = new TelemetryQueue(send,storage,uuid);
    q.add({ type: 'day_reached', day: 1 }); await q.flush(); expect(send).not.toHaveBeenCalled();
    q.setEnabled(true);
    for(let i=0;i<QUEUE_LIMIT+9;i++) q.add({ type: 'day_reached', day: i+1 });
    expect(q.size).toBe(200);
    await q.flush(); expect(send.mock.calls[0]![0]).toHaveLength(25);
    await q.flush(); expect(q.size).toBe(200);
    await q.flush(); expect(q.size).toBe(175);
    const restored = new TelemetryQueue(async () => true, storage, uuid); restored.setEnabled(true); restored.restore();
    expect(restored.size).toBe(175); await restored.flush(); expect(restored.size).toBe(150);
    restored.setEnabled(false); expect(restored.size).toBe(0);
    restored.setEnabled(true); restored.restore(); expect(restored.size).toBe(0);
  });
  it('groups by world and deduplicates concurrent flushes; opt-out aborts inflight and clears', async () => {
    let resolve!: (v: boolean) => void;
    const send = vi.fn((_items: unknown, _signal: AbortSignal) => new Promise<boolean>(r => { resolve = r; }));
    const q = new TelemetryQueue(send,store(),uuid); q.setEnabled(true);
    q.add({ type: 'day_reached', day: 1 },uuid()); q.add({ type: 'day_reached', day: 2 });
    const pending = q.flush(); await q.flush(); expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]![0]).toHaveLength(1);
    q.setEnabled(false); expect(send.mock.calls[0]![1].aborted).toBe(true);
    q.setEnabled(true); q.add({ type: 'day_reached', day: 3 }); resolve(false); await pending;
    expect(q.size).toBe(1);
  });
  it('silently tolerates throwing storage and transport', async () => {
    const storage = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
    expect(readChoice(storage)).toBeNull();
    const q = new TelemetryQueue(async () => { throw Error(); },storage,uuid); q.setEnabled(true); q.restore();
    q.add({ type: 'day_reached', day: 1 }); await q.flush(); await q.flush(); await q.flush(); expect(q.size).toBe(0);
  });
  it('surveys are opt-in, at their milestone, once including skips and reloads', () => {
    const storage = store(), gate = new SurveyGate(storage);
    expect(gate.claim('day7',false,7)).toBe(false); expect(gate.claim('day7',true,6)).toBe(false);
    expect(gate.claim('day7',true,7)).toBe(true); expect(gate.claim('day7',true,7)).toBe(false);
    expect(new SurveyGate(storage).claim('day7',true,7)).toBe(false);
    expect(gate.claim('spring',true,25)).toBe(false); expect(gate.claim('spring',true,26)).toBe(true);
  });
});
