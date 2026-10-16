/** §15.1: immutable, serializable puzzle sessions. No renderer or wall clock dependencies. */
export interface PuzzleState { cells: number[]; undo: number[][]; elapsed: number; hints: number; solved: boolean }
export interface HintContext { askResident?: boolean; regard?: number; wits?: number }
export interface PuzzleDefinition {
  id: string; title: string; instructions: string; hints: readonly [string, string, string];
  initial: readonly number[];
  valid(cells: readonly number[]): boolean;
  legal(cells: readonly number[]): number[];
  move(cells: readonly number[], move: number): number[];
  won(cells: readonly number[]): boolean;
}
export function puzzle(def: PuzzleDefinition) {
  const reset = (): PuzzleState => ({ cells: [...def.initial], undo: [], elapsed: 0, hints: 0, solved: false });
  const legalMoves = (s: PuzzleState) => s.solved ? [] : def.legal(s.cells);
  const move = (s: PuzzleState, m: number): PuzzleState => legalMoves(s).includes(m)
    ? { ...s, cells: def.move(s.cells, m), undo: [...s.undo, [...s.cells]] } : s;
  const undo = (s: PuzzleState): PuzzleState => !s.solved && s.undo.length
    ? { ...s, cells: [...s.undo[s.undo.length - 1]!], undo: s.undo.slice(0, -1) } : s;
  const win = (s: PuzzleState) => def.valid(s.cells) && def.won(s.cells);
  const hint = (s: PuzzleState, ctx: HintContext = {}): string | null => {
    if (s.hints >= 3) return def.hints[2];
    if (s.hints === 0 && s.elapsed < 180 && (ctx.wits ?? 1) < 3) return null;
    if (s.hints >= 1 && !ctx.askResident) return null;
    if (s.hints >= 2 && (ctx.regard ?? 0) < 40) return null;
    return def.hints[s.hints] ?? null;
  };
  const serialize = (s: PuzzleState): string => JSON.stringify(s);
  const restore = (raw: unknown): PuzzleState => {
    try {
      const s = (typeof raw === 'string' ? JSON.parse(raw) : raw) as PuzzleState;
      if (!s || !Array.isArray(s.cells) || !def.valid(s.cells) || !Array.isArray(s.undo)
        || !s.undo.every(c => Array.isArray(c) && def.valid(c)) || !Number.isFinite(s.elapsed) || s.elapsed < 0
        || !Number.isInteger(s.hints) || s.hints < 0 || s.hints > 3 || typeof s.solved !== 'boolean') return reset();
      return { cells: [...s.cells], undo: s.undo.map(c => [...c]), elapsed: s.elapsed, hints: s.hints, solved: s.solved && win(s) };
    } catch { return reset(); }
  };
  return { ...def, reset, legalMoves, move, undo, win, hint, serialize, restore };
}
export type Puzzle = ReturnType<typeof puzzle>;
export const indices = (n: number) => Array.from({ length: n }, (_, i) => i);
export const vector = (c: readonly number[], n: number, min: number, max: number) =>
  c.length === n && c.every(v => Number.isInteger(v) && v >= min && v <= max);
export const cycle = (c: readonly number[], i: number, n: number): number[] => c.map((v, j) => j === i ? (v + 1) % n : v);
