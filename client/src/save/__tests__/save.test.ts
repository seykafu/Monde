import { describe, expect, it, vi } from 'vitest';
import { migrateSave, SaveGame } from '@monde/shared';
import { Clock } from '../../sim/clock';
import { dailyWeather } from '../../sim/weather';
import { createTownState, applyPillarDelta } from '../../town/pillars';
import { runDawnsThrough } from '../../town/townEngine';
import { emptyQuietState } from '../../mind/quietMode';
import { MindClient } from '../../mind/api';
import { collect, type GameState } from '../collect';
import { restore } from '../restore';
import { AUTO_SLOTS, chooseAutosaveSlot, checkpointSlot, formatSummary, sortForMenu } from '../slots';
import { DesktopSaveStorage, IndexedDBSaveStorage, MemorySaveStorage } from '../storage';

function state(): GameState {
  return { clock: new Clock({ day: 4, minute: 783 }),
    town: applyPillarDelta(runDawnsThrough(createTownState(), 4).state, 'charm', 2, 'story'),
    player: { zone: 'market_row', x: 5.23, y: 9.15, facing: 1.2 },
    weather: { seed: 42, daily: dailyWeather(42, 4), override: null },
    story_flags: { station_open: true }, quiet: { ...emptyQuietState(), player: ['GR-001'] },
    offline_events: [{ day: 4, minute: 780, resident_id: 'pell', type: 'talk', data: { text: 'Hello' } }],
    player_name: 'Fellow', playtime: 325 };
}
const save = () => collect(state(), 'manual', 'Slot 1', '2026-10-14T12:00:00.000Z');

describe('save format and restore', () => {
  it('round trips JSON, validates all sections and detaches nested engine state', () => {
    const source = state();
    const file = collect(source, 'manual', 'Home');
    expect(SaveGame.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
    source.town.pillars.charm = 99;
    expect(file.town.pillars.charm).not.toBe(99);
    expect(() => migrateSave({ ...file, town: {} })).toThrow();
    expect(() => migrateSave({ ...file, inventory: { arbitrary: 1 } })).toThrow();
  });
  it('migrates v1 and rejects unknown future and pre-format versions cleanly', () => {
    const file = save();
    expect(migrateSave(file)).toEqual(file);
    expect(() => migrateSave({ ...file, schema_version: 2 })).toThrow('Unsupported save schema version 2');
    expect(() => migrateSave({ ...file, schema_version: 0 })).toThrow('Unsupported save schema version 0');
  });
  it('collect → restore retains the clock, town, player, memory, weather and offline log', () => {
    const source = state();
    const restored = restore(collect(source, 'manual', 'Home'));
    expect(restored.clock.time).toEqual(source.clock.time);
    expect({ ...restored, clock: null }).toEqual({ ...source, clock: null });
    restored.town.pillars.charm++;
    expect(restored.town.pillars.charm).not.toEqual(source.town.pillars.charm);
    expect(runDawnsThrough(restored.town, 5).state.day).toBe(5);
  });
  it('preserves pass-out rather than silently advancing a day', () => {
    const source = state(); source.clock.setTime(4, 1559); source.clock.advanceMinutes(1);
    expect(restore(collect(source, 'manual', 'Night')).clock.time).toEqual(source.clock.time);
  });
});

describe('slots', () => {
  it('fills three slots then replaces the oldest dawn, never a manual or checkpoint', () => {
    const entries = [{ slot: 'manual:1', save: save() }, { slot: checkpointSlot('campaign_season'), save: save() }];
    for (const [i, slot] of AUTO_SLOTS.entries()) {
      expect(chooseAutosaveSlot(entries)).toBe(slot);
      entries.push({ slot, save: { ...save(), kind: 'autosave', saved_at: `2026-10-1${i + 5}T06:00:00.000Z` } });
    }
    expect(chooseAutosaveSlot(entries)).toBe('dawn:1');
    expect(sortForMenu(entries)[0]!.slot).toBe('dawn:3');
    expect(entries[0]!.slot).toBe('manual:1');
    expect(formatSummary(save())).toContain('13:03');
    expect(() => checkpointSlot('../escape')).toThrow();
  });
});

for (const kind of ['memory', 'unavailable IndexedDB'] as const) {
  describe(kind, () => {
    it('lists, overwrites, reads detached saves and deletes', async () => {
      const storage = kind === 'memory' ? new MemorySaveStorage() : new IndexedDBSaveStorage(() => { throw new Error('SecurityError'); });
      expect(await storage.list()).toEqual([]);
      expect(await storage.read('missing')).toBeNull();
      const file = save(); await storage.write('manual:1', file); file.town.fund = -100;
      expect((await storage.read('manual:1'))!.town.fund).not.toBe(-100);
      const copy = (await storage.list())[0]!; copy.save.label = 'mutated';
      expect((await storage.read('manual:1'))!.label).toBe('Slot 1');
      await storage.write('manual:1', { ...save(), label: 'Replacement' });
      expect(await storage.list()).toHaveLength(1);
      expect((await storage.read('manual:1'))!.label).toBe('Replacement');
      await storage.delete('manual:1'); await storage.delete('missing');
      expect(await storage.list()).toEqual([]);
    });
  });
}
it('desktop bridge validates reads and excludes unsupported entries from Continue', async () => {
  const bridge = { list: vi.fn(async () => [{ slot: 'future', save: { schema_version: 50 } }, { slot: 'manual:1', save: save() }]),
    read: vi.fn(async () => ({ schema_version: 50 })), write: vi.fn(), delete: vi.fn() };
  const storage = new DesktopSaveStorage(bridge);
  expect(await storage.list()).toHaveLength(1);
  await expect(storage.read('future')).rejects.toThrow('Unsupported save');
  await storage.write('manual:1', save()); expect(bridge.write).toHaveBeenCalled();
});

function mindWith(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, offline = false) {
  const data = new Map<string, string>([['monde.mind.device', 'device'], ['monde.mind.session', JSON.stringify({ device_id: 'device', world_id: 'world', token: 'token', base_url: 'https://mind.test' })]]);
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  return { fetcher, mind: new MindClient({ baseUrl: 'https://mind.test', offline,
    storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } },
    fetch: fetcher, randomUUID: () => 'device' }) };
}
it('snapshots the current world and switches future requests to the restored branch', async () => {
  const { mind, fetcher } = mindWith(url => Response.json(url.endsWith('/restore') ? { world_id: 'branch-world', token: 'new-token', branch_id: 'branch' } : { snapshot_id: 'snapshot' }));
  const link = await mind.createSnapshot(4, 783, 'Slot 1');
  expect(link.snapshot_id).toBe('snapshot');
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ day: 4, minute: 783, label: 'Slot 1' });
  expect(await mind.restoreSnapshot(link)).toBe(true);
  expect(mind.worldId).toBe('branch-world');
  const next = await mind.createSnapshot(4, 800, 'Next');
  expect(next.branch_id).toBe('branch');
  expect(fetcher.mock.calls.at(-1)![0]).toBe('https://mind.test/v1/worlds/branch-world/snapshots');
});
it('missing endpoints, offline mode and network failures leave the current world usable', async () => {
  for (const handler of [() => new Response('', { status: 404 }), () => { throw new Error('Offline'); }]) {
    const { mind } = mindWith(handler);
    expect((await mind.createSnapshot(1, 360, 'Dawn')).snapshot_id).toBeNull();
    expect(await mind.restoreSnapshot({ world_id: 'world', snapshot_id: 'snap' })).toBe(false);
    expect(mind.worldId).toBe('world');
  }
  const { mind, fetcher } = mindWith(() => Response.json({}), true);
  await mind.createSnapshot(1, 360, 'Dawn'); await mind.restoreSnapshot({ world_id: 'world', snapshot_id: 'snap' });
  expect(fetcher).not.toHaveBeenCalled();
});
