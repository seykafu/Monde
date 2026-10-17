/**
 * G-07: the procedural community-work boards (§15.21) behind the Mail Round and Library Returns place prompts. The day's
 * board is seeded by the world seed, the job, the day and how many times the job has been done today, so a reload (or
 * leaving and coming back) gives the same instance. Its progress lives in `SaveGame.puzzles.entries` under
 * `work:<job>:<day>:<run>:<wits>`: the Wits level the board was first drawn at is kept, so a level gained mid-round
 * doesn't change the board under the player. Only the current board of each job is kept.
 *
 * The economy (economy/attach.ts) pays the job exactly as G-09 does once `workSolved` re-checks the saved board.
 */
import { Economy, hashParts } from '@monde/shared';
import type { RegistryLike } from '../fellow/state';
import type { Puzzle, PuzzleState } from './core';
import { PUZZLES_KEY, puzzleSave } from './runtime';
import { generateMailRound, mailPuzzle, solveMailRound, MAIL_ID, type MailRound } from './mailRound';
import { mailMaps } from './mailMaps';
import { generateLibraryReturns, libraryPuzzle, shelveSwaps, swapMove, LIBRARY_ID, type LibraryReturns } from './libraryReturns';

/** The §8 jobs (shared COMMUNITY_TASKS ids) that are played as boards, who gives them and the board's backdrop. */
export const WORK_PUZZLES = {
  mail: { id: MAIL_ID, resident: 'ada', backdrop: 'bg_ferry_slip_morning' },
  library: { id: LIBRARY_ID, resident: 'margo', backdrop: 'bg_library_reading_room' }
} as const;
export type WorkPuzzleKind = keyof typeof WORK_PUZZLES;
export const isWorkPuzzle = (task: string): task is WorkPuzzleKind => Object.prototype.hasOwnProperty.call(WORK_PUZZLES, task);

export type WorkBoard = { key: string; puzzle: Puzzle; state: PuzzleState } & ({ kind: 'mail'; round: MailRound } | { kind: 'library'; shelf: LibraryReturns });

/** The world seed (the save's weather seed, as ZoneScene and migration read it). */
export function worldSeed(r: RegistryLike): number {
  const saved = (r.get('monde.save.weather') as { seed?: unknown } | undefined)?.seed;
  if (typeof saved === 'number' && Number.isFinite(saved)) return saved;
  const query = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('seed');
  return Number(query) || 1;
}
const level = (wits: number) => Math.min(10, Math.max(1, Math.floor(Number.isFinite(wits) ? wits : 1)));
const prefixOf = (kind: WorkPuzzleKind) => `work:${kind}:`;

/** Today's board for a job (the saved progress if there is any), as the next completion of it would be. */
export function workBoard(r: RegistryLike, kind: WorkPuzzleKind, day: number, wits: number): WorkBoard {
  const run = Economy.parse(r.get('monde.economy') ?? {}).work[kind] ?? 0;
  const prefix = `${prefixOf(kind)}${day}:${run}:`, entries = puzzleSave(r).entries;
  const held = Object.keys(entries).find(k => k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)));
  const drawn = level(held ? Number(held.slice(prefix.length)) : wits);
  const key = `${prefix}${drawn}`, seed = hashParts(worldSeed(r), WORK_PUZZLES[kind].id, day, run);
  if (kind === 'mail') {
    const round = generateMailRound(mailMaps(), seed, drawn), puzzle = mailPuzzle(round);
    return { kind, key, round, puzzle, state: puzzle.restore(entries[key]) };
  }
  const shelf = generateLibraryReturns(seed, drawn), puzzle = libraryPuzzle(shelf);
  return { kind, key, shelf, puzzle, state: puzzle.restore(entries[key]) };
}

/** Save the board's progress; yesterday's (or an earlier run's) board of the same job is dropped. */
export function storeWork(r: RegistryLike, board: Pick<WorkBoard, 'kind' | 'key'>, state: PuzzleState): void {
  const save = puzzleSave(r), prefix = prefixOf(board.kind);
  const entries = Object.fromEntries(Object.entries(save.entries).filter(([k]) => !k.startsWith(prefix)));
  r.set(PUZZLES_KEY, { ...save, entries: { ...entries, [board.key]: state } });
}

/** The saved board, re-checked: the economy pays only for one that really is won within par. */
export const workSolved = (r: RegistryLike, board: WorkBoard): boolean => {
  const saved = board.puzzle.restore(puzzleSave(r).entries[board.key]);
  return saved.solved && board.puzzle.win(saved);
};

/** The solver's moves from the board's start: an optimal round, or a perfect re-shelving (the QA bot plays these). */
export function workSolution(board: WorkBoard): number[] {
  if (board.kind === 'mail') return solveMailRound(board.round);
  const n = board.shelf.initial.length;
  return shelveSwaps(board.shelf.initial).map(([a, b]) => swapMove(n, a, b));
}
