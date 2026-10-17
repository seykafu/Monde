// G-07 in the community-work flow (economy/attach.ts): the Mail Round and Library Returns prompts open their board, and
// the job pays exactly as G-09 does (coins, Stamina, minutes, capped Pillar effect, XP, the community_work event) only
// once the saved board is won within par. Leaving (or claiming a win the board doesn't show) pays nothing. The other
// jobs keep their plain timed beat.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { COMMUNITY_TASKS, baseSkills, emptyEconomy, emptyEventLog, type Economy } from '@monde/shared';
import { Clock } from '../../sim/clock';
import { createTownState, type TownState } from '../../town/pillars';
import { getFellow, setFellow } from '../../fellow/state';
import type { WorkPuzzleKind } from '../../puzzles/work';
vi.mock('phaser', () => ({ default: { Scene: class {}, Textures: { FilterMode: { NEAREST: 0 } }, Math: { Clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(max, n)) } } }));
// The player at the board: leaves it, claims a win without one, or plays the solver's round (what WorkPuzzleScene saves).
const player = vi.hoisted(() => ({ mode: 'leave' as 'leave' | 'claim' | 'solve' }));
vi.mock('../../puzzles/scenes/WorkPuzzleScene', () => ({
  openWorkPuzzle: vi.fn(async (host: Phaser.Scene, clock: Clock, kind: WorkPuzzleKind) => {
    if (player.mode === 'solve') {
      const { storeWork, workBoard, workSolution } = await import('../../puzzles/work');
      const board = workBoard(host.registry, kind, clock.day, 1);
      const won = workSolution(board).reduce((s, m) => board.puzzle.move(s, m), board.puzzle.reset());
      storeWork(host.registry, board, { ...won, solved: true });
    }
    return player.mode !== 'leave';
  })
}));
const { attachEconomy } = await import('../attach');
const { openWorkPuzzle } = await import('../../puzzles/scenes/WorkPuzzleScene');
const { workBoard } = await import('../../puzzles/work');

function harness(day = 3, stamina = 100) {
  const data = new Map<string, unknown>();
  const registry = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return registry; }, has: (k: string) => data.has(k), remove: (k: string) => data.delete(k) };
  registry.set('monde.town', { ...createTownState(), day }); registry.set('monde.coins', { balance: 0 }); registry.set('monde.events', emptyEventLog());
  registry.set('monde.economy', { ...emptyEconomy(), day, stamina });
  setFellow(registry, { profile: null, look: null, skills: baseSkills() });
  const display = (): object => { const o: object = new Proxy({}, { get: () => () => o }); return o; };
  const events = new EventEmitter(), keyboard = Object.assign(new EventEmitter(), { resetKeys: vi.fn() });
  const scene = { registry, events, input: { keyboard }, cameras: { main: { ignore: vi.fn() } }, time: { delayedCall: (_ms: number, fn: () => void) => fn() },
    add: { text: display, graphics: display, rectangle: display } } as unknown as Phaser.Scene;
  const clock = new Clock({ day, minute: 600 }), toast = vi.fn();
  const economy = attachEconomy(scene, clock, toast, vi.fn());
  const r = registry as unknown as Phaser.Data.DataManager;
  const state = () => ({ coins: (registry.get('monde.coins') as { balance: number }).balance, economy: registry.get('monde.economy') as Economy,
    town: registry.get('monde.town') as TownState, minute: clock.minute, events: (registry.get('monde.events') as ReturnType<typeof emptyEventLog>).outbox });
  const run = async (place: string) => { economy.interaction(place)!.run(); for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { r, clock, toast, economy, state, run };
}
const task = (id: string) => COMMUNITY_TASKS.find(t => t.id === id)!;

describe('the community-work boards pay as G-09’s jobs, once won', () => {
  for (const [id, place] of [['mail', 'wharf.ticket_booth'], ['library', 'old_quarter.library']] as const) {
    it(`${id}: leaving or a claimed win pays nothing; a won board pays the job once`, async () => {
      const h = harness(), t = task(id), before = h.state();
      expect(h.economy.interaction(place)?.label).toBe(`${t.name} (${t.stamina} Stamina · ${t.minutes} min · ${t.pay} coins)`);
      for (const mode of ['leave', 'claim'] as const) {
        player.mode = mode; await h.run(place);
        expect(h.state()).toEqual(before);
      }
      expect(openWorkPuzzle).toHaveBeenLastCalledWith(expect.anything(), h.clock, id);
      player.mode = 'solve'; await h.run(place);
      const after = h.state();
      expect(after.coins).toBe(t.pay); expect(after.economy.stamina).toBe(100 - t.stamina);
      expect(after.minute).toBe(600 + t.minutes); expect(after.economy.work[id]).toBe(1);
      expect(after.town.pillars[t.pillar] - before.town.pillars[t.pillar]).toBeCloseTo(t.effect);
      expect(getFellow(h.r)!.skills[t.skill].xp).toBe(t.xp);
      expect(after.events.filter(e => e.kind === 'community_work').map(e => e.kind === 'community_work' && e.task)).toEqual([id]);
      // The next run today is a fresh board; the paid one is not paid again.
      expect(workBoard(h.r, id, 3, 1).key).toBe(`work:${id}:3:1:1`);
      expect(workBoard(h.r, id, 3, 1).state.solved).toBe(false);
    });
  }
  it('a refused job never opens its board; the timed jobs keep their beat', async () => {
    vi.mocked(openWorkPuzzle).mockClear();
    const tired = harness(3, 5);
    await tired.run('wharf.ticket_booth');
    expect(openWorkPuzzle).not.toHaveBeenCalled(); expect(tired.toast).toHaveBeenLastCalledWith('A meal or a fresh morning would help.');
    const early = harness(1);
    await early.run('old_quarter.library');
    expect(openWorkPuzzle).not.toHaveBeenCalled(); expect(early.toast).toHaveBeenLastCalledWith('This job opens on Day 2.');
    const sweep = harness();
    await sweep.run('market_row.market_street');
    expect(openWorkPuzzle).not.toHaveBeenCalled(); expect(sweep.state().coins).toBe(task('sweep').pay);
    expect(sweep.clock.paused).toBe(false);
  });
});
