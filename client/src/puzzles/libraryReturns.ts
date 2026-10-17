/**
 * §15.21 Library Returns (MVP G-07): Margo's returns trolley, re-shelved in call-number order with as few swaps as the
 * books allow. Pure: no Phaser, no DOM.
 *
 * The board is a core.ts session (`puzzle()`). Its cells are `[swaps, ...shelf]`: the swaps made so far, then each
 * slot's book as its rank in call-number order (0 belongs at the left). A move swaps two slots (`swapMove`). Win: the
 * shelf in order within par. Minimum swaps = n − (number of cycles); par = minimum + 1 (§15.21).
 *
 * A swap changes the permutation's parity, so a shelf put right always took the minimum plus an even number of swaps:
 * par's one spare swap can never be used, and only a perfect re-shelving wins. Every swap that puts a book home is a
 * perfect move; any other costs two.
 */
import { SeededRng } from '@monde/shared';
import { puzzle, type Puzzle } from './core';

export interface LibraryReturns {
  seed: number; wits: number;
  /** Call numbers in shelf order (index = rank). */
  calls: readonly string[];
  /** The trolley as it comes: slot → rank. */
  initial: readonly number[];
  minimum: number; par: number;
  /** The first swap of a perfect re-shelving (slots, left first): the third hint's "first step" (§15.1). */
  first: readonly [number, number];
}

export const LIBRARY_ID = 'library_returns';
/**
 * §15.21: 6–12 books, difficulty by Wits. GDD-GAP: the steps between are unstated; spread them over the ten levels
 * (Wits 1 → 6, 4 → 8, 7 → 10, 10 → 12).
 */
export const booksFor = (wits: number): number => 6 + Math.round((Math.min(10, Math.max(1, wits)) - 1) * 2 / 3);
export const libraryPar = (minimum: number): number => minimum + 1;
/**
 * GDD-GAP: a shuffle can come out nearly in order. Draw again until it needs at least half as many swaps as books
 * (so the trolley is real work at every size).
 */
export const leastWork = (n: number): number => Math.ceil(n / 2);

export function cycles(shelf: readonly number[]): number {
  const seen = new Array<boolean>(shelf.length).fill(false);
  let count = 0;
  for (let i = 0; i < shelf.length; i++) {
    if (seen[i]) continue;
    count++;
    for (let j = i; !seen[j]; j = shelf[j]!) seen[j] = true;
  }
  return count;
}
export const minimumSwaps = (shelf: readonly number[]): number => shelf.length - cycles(shelf);
export const inOrder = (shelf: readonly number[]): boolean => shelf.every((v, i) => v === i);
export const swapMove = (n: number, a: number, b: number): number => Math.min(a, b) * n + Math.max(a, b);
export const swapSlots = (n: number, move: number): [number, number] => [Math.floor(move / n), move % n];

/**
 * The solver: fill the shelf from the left, swapping into each wrong slot the book that belongs there. Each swap sends
 * one book home (it splits a cycle), so it takes exactly n − cycles swaps: the minimum.
 */
export function shelveSwaps(shelf: readonly number[]): [number, number][] {
  const s = [...shelf], out: [number, number][] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === i) continue;
    const j = s.indexOf(i);
    [s[i], s[j]] = [s[j]!, s[i]!];
    out.push([i, j]);
  }
  return out;
}

/** n books with distinct call numbers (Dewey-style, one decimal), shuffled onto the trolley. */
export function generateLibraryReturns(seed: number, wits: number): LibraryReturns {
  const n = booksFor(wits), rng = new SeededRng(seed);
  const numbers = new Set<number>();
  while (numbers.size < n) numbers.add(rng.int(0, 9999));
  const calls = [...numbers].sort((a, b) => a - b).map(v => `${String(Math.floor(v / 10)).padStart(3, '0')}.${v % 10}`);
  let shelf: number[] = [];
  for (let attempt = 0; attempt < 64; attempt++) {
    shelf = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = rng.int(0, i); [shelf[i], shelf[j]] = [shelf[j]!, shelf[i]!]; }
    if (minimumSwaps(shelf) >= leastWork(n)) break;
  }
  // Unreachable in practice; a single loop of every book is still a fair trolley.
  if (minimumSwaps(shelf) < leastWork(n)) shelf = Array.from({ length: n }, (_, i) => (i + 1) % n);
  const minimum = minimumSwaps(shelf), first = shelveSwaps(shelf)[0]!;
  return { seed, wits, calls, initial: shelf, minimum, par: libraryPar(minimum), first };
}

export function libraryPuzzle(lib: LibraryReturns): Puzzle {
  const n = lib.initial.length;
  const valid = (c: readonly number[]) => c.length === n + 1 && Number.isInteger(c[0]) && c[0]! >= 0 && c[0]! <= 999
    && c.slice(1).every(v => Number.isInteger(v) && v >= 0 && v < n) && new Set(c.slice(1)).size === n;
  const moves = Array.from({ length: n }, (_, a) => Array.from({ length: n - a - 1 }, (_, k) => swapMove(n, a, a + k + 1))).flat();
  const [a, b] = lib.first;
  return puzzle({
    id: LIBRARY_ID, title: 'Library Returns',
    instructions: `Margo’s returns trolley: put the ${n} books back in call-number order, smallest at the left, within par (${lib.par} swaps). Pick a book, then the one to swap it with.`,
    hints: ['A swap that sends a book to its right place is never wasted. Any other swap costs you two.',
      'Margo: “Find the first slot with the wrong book, fetch the book that belongs there and swap it in. Then do it again.”',
      `Margo taps two spines: “Swap ${lib.calls[lib.initial[a]!]} and ${lib.calls[lib.initial[b]!]} first.”`],
    initial: [0, ...lib.initial], valid,
    legal: c => c[0]! >= 999 ? [] : moves,
    move: (c, m) => { const [i, j] = swapSlots(n, m), s = c.slice(1); [s[i], s[j]] = [s[j]!, s[i]!]; return [c[0]! + 1, ...s]; },
    won: c => inOrder(c.slice(1)) && c[0]! <= lib.par
  });
}
