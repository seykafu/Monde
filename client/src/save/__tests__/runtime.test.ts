import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { beforeEach, expect, it, vi } from 'vitest';
import { Clock } from '../../sim/clock';
import { createTownState } from '../../town/pillars';
import { runDawnsThrough } from '../../town/townEngine';
import { MemorySaveStorage } from '../storage';
import { attachSaves, loadGame, requestCheckpoint, resetGame, saveGame, saveStorage } from '../runtime';
vi.mock('../storage', async importOriginal => {
  const original = await importOriginal<typeof import('../storage')>();
  return { ...original, createSaveStorage: () => new original.MemorySaveStorage() };
});
vi.mock('../../mind/api', () => ({ getMind: () => ({
  playerName: 'Fellow', createSnapshot: async () => ({ world_id: null, branch_id: null, snapshot_id: null }), restoreSnapshot: async () => false
}) }));
function host(day = 1) {
  const data = new Map<string, unknown>();
  const events = new EventEmitter();
  const keyboard = new EventEmitter();
  const clock = new Clock({ day, minute: 1559 });
  data.set('monde.clock', clock); data.set('monde.town', createTownState({ day }));
  clock.onDawn(t => data.set('monde.town', runDawnsThrough(data.get('monde.town') as ReturnType<typeof createTownState>, t.day).state));
  const scene = { registry: { get: (k: string) => data.get(k), set: (k: string, v: unknown) => data.set(k, v), remove: (k: string) => data.delete(k) },
    events, input: { keyboard }, scene: { isActive: () => false, pause: vi.fn(), launch: vi.fn(), stop: vi.fn(() => events.emit('shutdown')), start: vi.fn() } };
  attachSaves(scene as unknown as Phaser.Scene, clock, () => ({ zone: 'old_quarter', x: 5.5, y: 5.5, facing: 0 }), 42);
  return { scene: scene as unknown as Phaser.Scene, data, clock, events };
}
beforeEach(async () => {
  for (const e of await saveStorage.list()) await saveStorage.delete(e.slot);
});
it('autosaves after town dawn and pins Day 70 independently of rolling slots', async () => {
  expect(saveStorage).toBeInstanceOf(MemorySaveStorage);
  const h = host(69);
  h.clock.advanceMinutes(2);
  await requestCheckpoint('campaign_season');
  const pinned = await saveStorage.read('checkpoint:campaign_season');
  expect(pinned?.clock).toMatchObject({ day: 70, minute: 360 });
  expect(pinned?.town.day).toBe(70);
  expect(pinned?.town.history.at(-1)?.day).toBe(70);
  for (let i = 0; i < 4; i++) { h.clock.startNextDay(); await requestCheckpoint('campaign_season'); }
  expect(await saveStorage.read('checkpoint:campaign_season')).toEqual(pinned);
  expect((await saveStorage.list()).filter(e => e.save.kind === 'autosave')).toHaveLength(3);
  h.events.emit('shutdown'); resetGame(h.scene);
});
it('late Campaign Season cue cannot pin the wrong day; ordinary checkpoints are named', async () => {
  const h = host(75);
  await requestCheckpoint('campaign_season');
  expect(await saveStorage.read('checkpoint:campaign_season')).toBeNull();
  await requestCheckpoint('before_festival');
  expect((await saveStorage.read('checkpoint:before_festival'))?.kind).toBe('checkpoint');
  h.events.emit('shutdown'); resetGame(h.scene);
});
it('captures before asynchronous work and restores without retaining the outgoing clock or playtime', async () => {
  const h = host();
  const write = saveGame('manual:1', 'manual', 'Slot 1');
  h.clock.setTime(5, 900);
  await write;
  const file = (await saveStorage.read('manual:1'))!;
  expect(file.clock.day).toBe(1);
  file.summary.playtime = 123;
  await loadGame(h.scene, file);
  expect(h.data.get('monde.save.playtime')).toBe(123);
  expect(h.data.get('monde.clock')).not.toBe(h.clock);
  expect(h.scene.scene.start).toHaveBeenCalledWith('Zone', { zone: file.player.zone, savedPlayer: file.player });
  resetGame(h.scene);
});


it('New Game clears the entire economy, including daily gift and work limits', () => {
  const h = host();
  const keys = ['monde.inventory', 'monde.coins', 'monde.economy', 'monde.save.wakePlayer'];
  for (const key of keys) h.data.set(key, { old: true });
  h.events.emit('shutdown');
  resetGame(h.scene);
  for (const key of keys) expect(h.data.has(key)).toBe(false);
});
