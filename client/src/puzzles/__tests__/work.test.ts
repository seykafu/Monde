// G-07: the day's community-work boards (puzzles/work.ts) and their paper scene (scenes/WorkPuzzleScene.ts): seeded per
// day and run so a reload gives the same board, the Wits level it was drawn at is kept, progress survives leaving, and
// the scene's keys and mouse drive the boards' own moves, with reduced motion and text size respected.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { baseSkills, emptyEconomy } from '@monde/shared';
import { Clock } from '../../sim/clock';
import { setFellow } from '../../fellow/state';
import { setAccessibility } from '../../accessibility/runtime';
import { puzzleSave, storePuzzle } from '../runtime';
import { puzzles } from '../catalog';
import { storeWork, workBoard, workSolution, workSolved, worldSeed, type WorkBoard } from '../work';
import { swapMove } from '../libraryReturns';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../scenes/friendship', () => ({ regardFor: () => 0 }));
vi.mock('../../audio/Sfx', () => ({ sfxCineChime: vi.fn(), installAudioUnlock: vi.fn() }));
const { WorkPuzzleScene } = await import('../scenes/WorkPuzzleScene');

function registry() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => data.set(k, v), remove: (k: string) => data.delete(k), data };
  r.set('monde.economy', { ...emptyEconomy(), day: 3 });
  setFellow(r, { profile: null, look: null, skills: baseSkills() });
  return r;
}
/** What the board is: the round's district and letters, or the trolley's books. */
const instance = (board: WorkBoard) => board.kind === 'mail' ? [board.round.map.district, ...board.round.letters] : [...board.shelf.calls, ...board.shelf.initial];
const solvedState = (board: WorkBoard) => ({ ...workSolution(board).reduce((s, m) => board.puzzle.move(s, m), board.puzzle.reset()), solved: true });

describe('the day’s boards', () => {
  it('a day and a run name one board; a reload gives the same board and its progress', () => {
    for (const kind of ['mail', 'library'] as const) {
      const r = registry(), a = workBoard(r, kind, 3, 1), b = workBoard(registry(), kind, 3, 1);
      expect(b.key).toBe(a.key); expect(instance(b)).toEqual(instance(a));
      expect(a.key).toBe(`work:${kind}:3:0:1`);
      const moved = a.puzzle.move(a.state, a.puzzle.legalMoves(a.state)[0]!);
      storeWork(r, a, moved);
      // A reload: the save round trip.
      const reloaded = registry(); reloaded.set('monde.puzzles', JSON.parse(JSON.stringify(puzzleSave(r))));
      expect(workBoard(reloaded, kind, 3, 1).state.cells).toEqual(moved.cells);
      // Another day, or the next run of the job today, is another board.
      expect(instance(workBoard(r, kind, 4, 1))).not.toEqual(instance(a));
      r.set('monde.economy', { ...emptyEconomy(), day: 3, work: { [kind]: 1 } });
      const next = workBoard(r, kind, 3, 1);
      expect(next.key).toBe(`work:${kind}:3:1:1`); expect(instance(next)).not.toEqual(instance(a));
    }
  });
  it('the world seed comes from the save; the board keeps the Wits it was drawn at', () => {
    const r = registry(); expect(worldSeed(r)).toBe(1);
    const one = workBoard(r, 'mail', 3, 1);
    r.set('monde.save.weather', { seed: 77 }); expect(worldSeed(r)).toBe(77);
    expect(instance(workBoard(r, 'mail', 3, 1))).not.toEqual(instance(one));
    const drawn = workBoard(r, 'library', 3, 1); storeWork(r, drawn, drawn.state);
    const later = workBoard(r, 'library', 3, 9);
    expect(later.key).toBe(drawn.key); expect(later.kind === 'library' && later.shelf.initial.length).toBe(6);
    expect(workBoard(registry(), 'library', 3, 9).key).toBe('work:library:3:0:9');
  });
  it('keeps one board per job and leaves the authored puzzles alone', () => {
    const r = registry();
    storePuzzle(r, 'PZ-02', puzzles['PZ-02']!.reset());
    const old = workBoard(r, 'mail', 2, 1); storeWork(r, old, old.state);
    const lib = workBoard(r, 'library', 3, 1); storeWork(r, lib, lib.state);
    const now = workBoard(r, 'mail', 3, 1); storeWork(r, now, now.state);
    expect(Object.keys(puzzleSave(r).entries).sort()).toEqual(['PZ-02', lib.key, now.key].sort());
  });
  it('pays only for a board that is really won: a claimed or over-par board is not', () => {
    for (const kind of ['mail', 'library'] as const) {
      const r = registry(), board = workBoard(r, kind, 3, 5);
      expect(workSolved(r, board)).toBe(false);
      storeWork(r, board, { ...board.state, solved: true });
      expect(workSolved(r, board)).toBe(false);
      storeWork(r, board, solvedState(board));
      expect(workSolved(r, board)).toBe(true);
    }
  });
});

function panel(kind: 'mail' | 'library', r = registry()) {
  const events = new EventEmitter(), keyboard = new EventEmitter();
  const nodes: { text: string; x: number; y: number; size: string; color?: string; emit(e: string): boolean }[] = [];
  const display = (x = 0, y = 0, text = '', style?: { fontSize?: string }) => {
    const e = new EventEmitter();
    const raw = { x, y, text, size: style?.fontSize ?? '', color: '', setColor: (color: string) => { raw.color = color; return obj; }, setText: (t: string) => { raw.text = t; return obj; },
      on: (ev: string, fn: (...a: unknown[]) => void) => { e.on(ev, fn); return obj; }, emit: e.emit.bind(e) };
    nodes.push(raw);
    const obj: object = new Proxy(raw, { get: (target, key) => key in target ? Reflect.get(target, key) : (..._args: unknown[]) => obj });
    return obj;
  };
  const host = { input: { enabled: true, keyboard: { enabled: true, resetKeys: vi.fn() } } };
  const clock = new Clock({ day: 3, minute: 600 }), done = vi.fn(), tweens = { add: vi.fn(), killAll: vi.fn() };
  const scene = new WorkPuzzleScene();
  Object.assign(scene, { registry: r, events, input: { keyboard }, game: { hasFocus: true }, textures: { exists: () => false }, tweens,
    add: { text: display, rectangle: () => display(), container: () => display(), graphics: () => display(), image: () => display() },
    scene: { get: () => host, stop: () => events.emit('shutdown') } });
  scene.init({ kind, host: 'Zone', clock, done }); scene.create();
  const press = (key: string, times = 1) => { for (let i = 0; i < times; i++) keyboard.emit('keydown', { key, repeat: false, preventDefault: () => undefined }); };
  const board = () => workBoard(r, kind, 3, 1), saved = () => board().state;
  return { scene, clock, host, r, done, press, nodes, tweens, board, saved };
}

describe('the Mail Round on paper', () => {
  it('Enter walks a street, U walks back, Esc leaves with the walk and hint clock saved and only its own clock hold released', () => {
    const h = panel('mail'), start = h.board().puzzle.reset().cells;
    expect(h.clock.pauseReasons).toContain('work-puzzle'); expect(h.host.input.enabled).toBe(false);
    h.press('Enter'); expect(h.saved().cells).toHaveLength(2);
    h.press('u'); expect(h.saved().cells).toEqual(start);
    h.press('Enter'); h.scene.update(1000, 1000);
    h.clock.pause('story'); h.press('Escape');
    expect(h.done).toHaveBeenCalledWith(false); expect(h.host.input.enabled).toBe(true);
    expect(h.clock.pauseReasons).toEqual(['story']);
    expect(h.saved().elapsed).toBe(1); expect(h.saved().cells).toHaveLength(2);
    const again = panel('mail', h.r);
    expect((again.scene as unknown as { state: { cells: number[] } }).state.cells).toEqual(h.saved().cells);
  });
  it('played by keys along the solver’s round, it is won and leaving reports it', () => {
    const h = panel('mail'), board = h.board();
    let state = board.puzzle.reset();
    for (const move of workSolution(board)) {
      h.press('ArrowRight', board.puzzle.legalMoves(state).indexOf(move)); h.press('Enter');
      state = board.puzzle.move(state, move);
    }
    expect(h.saved().solved).toBe(true); expect(workSolved(h.r, board)).toBe(true);
    expect(h.nodes.some(n => n.text === 'Done. Collect the pay →')).toBe(true);
    h.press('Enter'); expect(h.done).toHaveBeenCalledWith(true);
  });
  it('the first hint waits three minutes (Wits 1); the third is the first stop', () => {
    const h = panel('mail');
    h.press('h'); expect(h.saved().hints).toBe(0);
    expect(h.nodes.some(n => n.text.startsWith('Take your time'))).toBe(true);
    h.scene.update(0, 181_000); h.press('h'); h.press('h');
    expect(h.saved().hints).toBe(2);
    h.press('h'); expect(h.saved().hints).toBe(2);
    expect(h.nodes.some(n => n.text.includes('Friend Regard (40) with Ada'))).toBe(true);
  });
  it('walks with a little tween, or straight there with reduced motion; text follows the text size', () => {
    const moving = panel('mail'); moving.press('Enter');
    expect(moving.tweens.add).toHaveBeenCalled();
    // Reduced motion on (Settings: on), and the largest text.
    setAccessibility({ motion: 'on', textSize: 'larger' });
    try {
      const still = panel('mail'); still.press('Enter');
      expect(still.tweens.add).not.toHaveBeenCalled();
      expect(still.nodes.find(n => n.text.startsWith('Mail Round ·'))?.size).toBe('39px');
    } finally { setAccessibility({ motion: 'system', textSize: 'normal' }); }
  });
});

describe('Library Returns on paper', () => {
  it('pick a book, then another: they swap and count; undo; the mouse picks too', () => {
    const h = panel('library'), board = h.board();
    const n = board.kind === 'library' ? board.shelf.initial.length : 0, start = board.puzzle.reset().cells;
    h.press('Enter'); h.press('ArrowRight', 2); h.press('Enter');
    expect(h.saved().cells).toEqual(board.puzzle.move(board.puzzle.reset(), swapMove(n, 0, 2)).cells);
    h.press('u'); expect(h.saved().cells).toEqual(start);
    // Picking the same book twice puts it back; nothing is counted.
    h.press('Enter'); h.press('Enter'); expect(h.saved().cells).toEqual(start);
    const calls = board.kind === 'library' ? board.shelf.calls : [];
    const spine = (slot: number) => h.nodes.filter(x => x.text === calls[start[slot + 1]!]).at(-1)!;
    spine(1).emit('pointerup'); spine(3).emit('pointerup');
    expect(h.saved().cells[0]).toBe(1);
    h.press('Escape'); expect(h.done).toHaveBeenCalledWith(false);
  });
  it('re-shelved by keys in the minimum swaps, it is won', () => {
    const h = panel('library'), board = h.board(), moves = workSolution(board);
    const n = board.kind === 'library' ? board.shelf.initial.length : 0, slots = n + 4;
    let focus = 0;
    const go = (slot: number) => { h.press('ArrowRight', (slot - focus + slots) % slots); focus = slot; h.press('Enter'); };
    for (const m of moves) { go(Math.floor(m / n)); go(m % n); }
    expect(h.saved().solved).toBe(true); expect(h.saved().cells[0]).toBe(moves.length);
    h.press('Escape'); expect(h.done).toHaveBeenCalledWith(true);
  });
});
