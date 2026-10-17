// G-07 (§15.21): the procedural community-work boards. 1,000 generated instances of each are solved by the solver
// within par, par is what the GDD says, the exact search agrees with an independent brute force, and generation is
// deterministic per seed. Also the boards' pure state transitions (what WorkPuzzleScene drives).
import { describe, expect, it } from 'vitest';
import { zones } from '../../world/zones';
import { MAIL_DISTRICTS, mailMaps, stepField } from '../mailMaps';
import { bestRound, delivered, generateMailRound, lettersFor, mailPar, mailPuzzle, mailSteps, neighbours, solveMailRound, stepsBetween, type MailMap } from '../mailRound';
import { booksFor, cycles, generateLibraryReturns, inOrder, leastWork, libraryPuzzle, minimumSwaps, shelveSwaps, swapMove } from '../libraryReturns';
import type { Puzzle, PuzzleState } from '../core';

const INSTANCES = 1000;
const play = (p: Puzzle, moves: readonly number[], from: PuzzleState = p.reset()) => moves.reduce((s, m) => {
  const next = p.move(s, m);
  if (next === s) throw new Error(`move ${m} refused`);
  return next;
}, from);
function permutations(a: readonly number[]): number[][] { return a.length ? a.flatMap((v, i) => permutations(a.filter((_, j) => i !== j)).map(p => [v, ...p])) : [[]]; }
/** Independent of Floyd–Warshall: Dijkstra over the streets from one node. */
function dijkstra(map: MailMap, from: number): number[] {
  const dist = map.nodes.map(() => Infinity), done = map.nodes.map(() => false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) return dist;
    done[u] = true;
    for (const [a, b, w] of map.edges) {
      const v = a === u ? b : b === u ? a : -1;
      if (v >= 0 && dist[u]! + w < dist[v]!) dist[v] = dist[u]! + w;
    }
  }
}

describe('Mail Round: the district place graphs', () => {
  const maps = mailMaps();
  it('are the real boards: every door a node, every street the shortest walk between two doors', () => {
    expect(maps.map(m => m.district)).toEqual([...MAIL_DISTRICTS]);
    for (const map of maps) {
      const zone = zones[map.district]!;
      // Each node stands on a walkable tile, and each street's steps are the board's own shortest walk.
      for (const n of map.nodes) expect(zone.walkability[Math.floor(n.y)]?.[Math.floor(n.x)], `${map.district} ${n.id}`).toBe(true);
      for (const [a, b, w] of map.edges) {
        const p = map.nodes[a]!, q = map.nodes[b]!;
        expect(stepField(zone, [Math.floor(p.x), Math.floor(p.y)])[Math.floor(q.y) * zone.width + Math.floor(q.x)]).toBe(w);
        expect(a).toBeLessThan(b);
      }
      // Connected, with enough addresses for eight letters, and the start takes none.
      expect(dijkstra(map, map.start).every(Number.isFinite)).toBe(true);
      expect(map.nodes.filter((n, i) => n.address && i !== map.start).length).toBeGreaterThanOrEqual(8);
      expect(map.nodes[map.start]!.address).toBe(false);
      // Sparse: a street map, not every door to every door.
      expect(map.edges.length).toBeLessThan(map.nodes.length * 2);
      // Empty houses, empty shopfronts and the Fellow's own cottage take no letters.
      for (const n of map.nodes) if (/^(vacant_house_|storefront_|lamplighter_cottage)/.test(n.id)) expect(n.address, n.id).toBe(false);
    }
    expect(maps.find(m => m.district === 'wharf')!.nodes[maps.find(m => m.district === 'wharf')!.start]!.id).toBe('ticket_booth');
    // The Commons is left out: too few doors for even four letters.
    expect((zones.commons!.town?.buildings ?? []).filter(b => b.door).length).toBeLessThan(lettersFor(1));
  });
});

describe('Mail Round: 1,000 generated rounds', () => {
  const maps = mailMaps();
  const rounds = Array.from({ length: INSTANCES }, (_, seed) => generateMailRound(maps, seed, 1 + seed % 10));
  it('k = 4 + Wits/2 (max 8) distinct addressed doors; par = the exact optimum + 15%', () => {
    for (const r of rounds) {
      expect(r.letters).toHaveLength(Math.min(8, 4 + Math.floor(r.wits / 2)));
      expect(new Set(r.letters).size).toBe(r.letters.length);
      for (const l of r.letters) { expect(r.map.nodes[l]!.address).toBe(true); expect(l).not.toBe(r.map.start); }
      expect(r.par).toBe(Math.ceil(r.optimal * 1.15 - 1e-9));
      expect(r.par).toBeGreaterThanOrEqual(r.optimal);
    }
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(lettersFor)).toEqual([4, 5, 5, 6, 6, 7, 7, 8, 8, 8]);
    expect(mailPar(100)).toBe(115); expect(mailPar(101)).toBe(117); expect(mailPar(20)).toBe(23);
  });
  it('every one is solved by the solver within par, in exactly the optimal steps', () => {
    for (const r of rounds) {
      const p = mailPuzzle(r), s = play(p, solveMailRound(r));
      expect(p.win(s), `seed ${r.seed}`).toBe(true);
      expect(mailSteps(r.map, s.cells)).toBe(r.optimal);
      expect(delivered(r, s.cells)).toHaveLength(r.letters.length);
    }
  });
  it('the exact search agrees with a brute force over every order of the letters', () => {
    const tables = new Map<MailMap, number[][]>();
    const table = (m: MailMap) => { let t = tables.get(m); if (!t) { t = m.nodes.map((_, i) => dijkstra(m, i)); tables.set(m, t); } return t; };
    const orders = new Map<number, number[][]>();
    for (const r of rounds) {
      const d = table(r.map), k = r.letters.length;
      let all = orders.get(k); if (!all) { all = permutations(Array.from({ length: k }, (_, i) => i)); orders.set(k, all); }
      let best = Infinity;
      for (const order of all) {
        let cost = 0, at = r.map.start;
        for (const i of order) { cost += d[at]![r.letters[i]!]!; at = r.letters[i]!; if (cost >= best) break; }
        best = Math.min(best, cost);
      }
      expect(r.optimal, `seed ${r.seed}`).toBe(best);
    }
  });
  it('is deterministic per seed and varies across seeds', () => {
    for (const seed of [0, 1, 17, 999, 123456789]) expect(generateMailRound(maps, seed, 4)).toEqual(generateMailRound(maps, seed, 4));
    expect(new Set(rounds.map(r => r.map.district))).toEqual(new Set(MAIL_DISTRICTS));
    expect(new Set(rounds.map(r => `${r.map.district}:${r.letters.join(',')}`)).size).toBeGreaterThan(INSTANCES * 0.95);
  });
});

describe('Mail Round: the board', () => {
  const round = generateMailRound(mailMaps(), 42, 1), p = mailPuzzle(round), { map } = round;
  it('steps along streets only; undo walks back; reset returns to the start', () => {
    const s0 = p.reset();
    expect(s0.cells).toEqual([map.start]);
    const legal = p.legalMoves(s0);
    expect(legal).toEqual([...legal].sort((a, b) => a - b));
    expect(legal.every(n => stepsBetween(map, map.start, n) < Infinity)).toBe(true);
    const far = map.nodes.findIndex((_, i) => i !== map.start && !legal.includes(i));
    expect(p.move(s0, far)).toBe(s0);
    const s1 = p.move(s0, legal[0]!);
    expect(s1.cells).toEqual([map.start, legal[0]]);
    expect(mailSteps(map, s1.cells)).toBe(stepsBetween(map, map.start, legal[0]!));
    expect(p.undo(s1).cells).toEqual([map.start]);
    expect(p.legalMoves(s1)).toEqual((neighbours(map)[legal[0]!] ?? []).filter((_, i) => i % 2 === 0).sort((a, b) => a - b));
  });
  it('wins only with every letter delivered and within par; over par is not a win', () => {
    const moves = solveMailRound(round), won = play(p, moves);
    expect(p.win(won)).toBe(true);
    expect(p.win(play(p, moves.slice(0, -1)))).toBe(false);
    // The same round with a detour that pushes it over par: every letter, but not a win.
    const back = p.legalMoves(p.reset())[0]!;
    let detour = p.reset();
    while (mailSteps(map, detour.cells) + round.optimal <= round.par) detour = play(p, [back, map.start], detour);
    const over = play(p, moves, detour);
    expect(delivered(round, over.cells)).toHaveLength(round.letters.length);
    expect(mailSteps(map, over.cells)).toBeGreaterThan(round.par);
    expect(p.win(over)).toBe(false);
    // Solving from the middle of a walk still finds the shortest way on.
    const partway = play(p, moves.slice(0, 3));
    expect(p.win(play(p, solveMailRound(round, partway.cells), partway))).toBe(true);
    expect(bestRound(map, [], map.start)).toEqual({ steps: 0, order: [] });
  });
  it('restores a saved walk, and refuses one that jumps between doors or leaves from elsewhere', () => {
    const s = play(p, solveMailRound(round).slice(0, 4));
    expect(p.restore(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const far = map.nodes.findIndex((_, i) => i !== map.start && stepsBetween(map, map.start, i) === Infinity);
    expect(p.restore({ ...s, cells: [map.start, far] }).cells).toEqual([map.start]);
    expect(p.restore({ ...s, cells: s.cells.slice(1) }).cells).toEqual([map.start]);
    expect(p.restore({ ...s, solved: true }).solved).toBe(false);
  });
});

describe('Library Returns: 1,000 generated trolleys', () => {
  const trolleys = Array.from({ length: INSTANCES }, (_, seed) => generateLibraryReturns(seed, 1 + seed % 10));
  it('6–12 books by Wits with distinct call numbers; minimum = n − cycles; par = minimum + 1', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(booksFor)).toEqual([6, 7, 7, 8, 9, 9, 10, 11, 11, 12]);
    for (const t of trolleys) {
      const n = t.initial.length;
      expect(n).toBe(booksFor(t.wits));
      expect(new Set(t.calls).size).toBe(n);
      expect([...t.calls].sort()).toEqual(t.calls);
      expect([...t.initial].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(t.minimum).toBe(n - cycles(t.initial));
      expect(t.minimum).toBeGreaterThanOrEqual(leastWork(n));
      expect(t.par).toBe(t.minimum + 1);
    }
  });
  it('every one is re-shelved by the solver within par, in exactly the minimum swaps', () => {
    for (const t of trolleys) {
      const n = t.initial.length, swaps = shelveSwaps(t.initial), p = libraryPuzzle(t);
      expect(swaps).toHaveLength(t.minimum);
      const s = play(p, swaps.map(([a, b]) => swapMove(n, a, b)));
      expect(inOrder(s.cells.slice(1))).toBe(true);
      expect(s.cells[0]).toBe(t.minimum);
      expect(p.win(s), `seed ${t.seed}`).toBe(true);
      expect(t.first).toEqual(swaps[0]);
    }
  });
  it('the minimum is the true fewest swaps (breadth-first search over every shelf order)', () => {
    for (const t of trolleys.filter(t => t.initial.length <= 7).slice(0, 120)) {
      const n = t.initial.length, goal = Array.from({ length: n }, (_, i) => i).join(',');
      const seen = new Set([t.initial.join(',')]);
      let frontier = [[...t.initial]], depth = 0;
      while (!seen.has(goal)) {
        const next: number[][] = [];
        for (const s of frontier) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const c = [...s]; [c[i], c[j]] = [c[j]!, c[i]!];
          const key = c.join(',');
          if (!seen.has(key)) { seen.add(key); next.push(c); }
        }
        frontier = next; depth++;
      }
      expect(depth, `seed ${t.seed}`).toBe(t.minimum);
    }
  });
  it('is deterministic per seed and varies across seeds', () => {
    for (const seed of [0, 1, 17, 999, 123456789]) expect(generateLibraryReturns(seed, 7)).toEqual(generateLibraryReturns(seed, 7));
    expect(new Set(trolleys.map(t => `${t.calls.join(',')}|${t.initial.join(',')}`)).size).toBe(INSTANCES);
  });
});

describe('Library Returns: the board', () => {
  // A trolley with at least two loops of books, so a wasted swap (one that joins two loops) exists.
  const t = Array.from({ length: 50 }, (_, i) => generateLibraryReturns(7 + i, 4)).find(x => cycles(x.initial) >= 2)!;
  const n = t.initial.length, p = libraryPuzzle(t);
  it('a swap exchanges two books and counts; undo puts them back', () => {
    const s0 = p.reset();
    expect(s0.cells).toEqual([0, ...t.initial]);
    expect(p.legalMoves(s0)).toHaveLength(n * (n - 1) / 2);
    const s1 = p.move(s0, swapMove(n, 3, 1));
    expect(s1.cells[0]).toBe(1);
    expect(s1.cells[2]).toBe(t.initial[3]); expect(s1.cells[4]).toBe(t.initial[1]);
    expect(p.move(s0, n * n)).toBe(s0);
    expect(p.undo(s1).cells).toEqual(s0.cells);
  });
  it('a wasted swap can never be won back within par (parity): only a perfect re-shelving wins', () => {
    const swaps = shelveSwaps(t.initial).map(([a, b]) => swapMove(n, a, b));
    expect(p.win(play(p, swaps))).toBe(true);
    // Swap two books from different loops (a book already home is a loop of one): it joins them into one loop.
    const shelf = [...t.initial];
    const loopOf = (i: number) => { const loop = new Set<number>(); for (let j = i; !loop.has(j); j = shelf[j]!) loop.add(j); return loop; };
    const a = shelf.findIndex((v, i) => v !== i), b = shelf.findIndex((_, j) => !loopOf(a).has(j));
    const wasted = p.move(p.reset(), swapMove(n, a, b));
    expect(minimumSwaps(wasted.cells.slice(1))).toBe(t.minimum + 1);
    const then = play(p, shelveSwaps(wasted.cells.slice(1)).map(([x, y]) => swapMove(n, x, y)), wasted);
    expect(inOrder(then.cells.slice(1))).toBe(true);
    expect(then.cells[0]).toBe(t.minimum + 2);
    expect(p.win(then)).toBe(false);
  });
  it('restores a saved trolley, and refuses a shelf that lost or doubled a book', () => {
    const s = p.move(p.reset(), swapMove(n, 0, n - 1));
    expect(p.restore(JSON.parse(p.serialize(s)))).toEqual(s);
    expect(p.restore({ ...s, cells: [1, ...Array<number>(n).fill(0)] }).cells).toEqual([0, ...t.initial]);
    expect(p.restore({ ...s, cells: [-1, ...t.initial] }).cells).toEqual([0, ...t.initial]);
    expect(p.restore({ ...s, cells: s.cells.slice(0, -1) }).cells).toEqual([0, ...t.initial]);
  });
});
