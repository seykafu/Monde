/**
 * §15.21 Mail Round (MVP G-07): Ada's satchel of letters, delivered over a district's place graph. Pure: no Phaser, no
 * DOM, no zone files (mailMaps.ts builds the graphs from the boards).
 *
 * The board is a session of core.ts (`puzzle()`), so it has the same undo, reset, hint ladder and save shape as the
 * authored puzzles. Its cells are the walk so far: node indices from the start, each step along a street of the graph.
 * Standing at an address delivers its letter (passing a door on the way counts). Win: every letter delivered within par.
 */
import { SeededRng } from '@monde/shared';
import { puzzle, type Puzzle } from './core';

export interface MailNode { id: string; label: string; x: number; y: number; address: boolean }
/** A district's place graph: its doors (and the round's start), linked by the streets between neighbours, in steps. */
export interface MailMap {
  district: string; name: string; width: number; height: number;
  /** Where the round begins: Ada's booth on the Wharf, else where the walk up from the post enters the district. */
  start: number;
  nodes: readonly MailNode[];
  /** [a, b, steps], a < b. */
  edges: readonly (readonly [number, number, number])[];
}
export interface MailRound {
  seed: number; wits: number; map: MailMap;
  /** The addressed nodes, in satchel order. */
  letters: readonly number[];
  /** The exact shortest round (every letter, from the start; it ends at the last door). */
  optimal: number;
  par: number;
  /** The first stop of an optimal round: the third hint's "first step" (§15.1). */
  first: number;
}

export const MAIL_ID = 'mail_round';
export const MAIL_MAX_LETTERS = 8;
/** A walk this long is far past any par; the board stops taking steps (undo or reset still work). */
export const MAIL_MAX_WALK = 400;
/** §15.21: k = 4 + Wits/2, max 8. GDD-GAP: an odd level rounds down (Wits 1 → 4, Wits 3 → 5). */
export const lettersFor = (wits: number): number => Math.min(MAIL_MAX_LETTERS, 4 + Math.floor(Math.max(1, wits) / 2));
/** §15.21: par is the optimal route + 15%. GDD-GAP: rounding is unstated; round up to a whole step (integer maths). */
export const mailPar = (optimal: number): number => Math.floor((optimal * 115 + 99) / 100);

const adjacency = new WeakMap<MailMap, number[][]>();
/** Each node's neighbours and the steps to them: `[node, steps, …]` flattened per node. */
export function neighbours(map: MailMap): number[][] {
  let out = adjacency.get(map);
  if (!out) {
    out = map.nodes.map(() => []);
    for (const [a, b, w] of map.edges) { out[a]!.push(b, w); out[b]!.push(a, w); }
    adjacency.set(map, out);
  }
  return out;
}
export const stepsBetween = (map: MailMap, a: number, b: number): number => {
  const n = neighbours(map)[a] ?? [];
  for (let i = 0; i < n.length; i += 2) if (n[i] === b) return n[i + 1]!;
  return Infinity;
};

const pairs = new WeakMap<MailMap, { dist: number[][]; next: number[][] }>();
/** All-pairs shortest walks over the streets (Floyd–Warshall with next hops). */
export function shortestWalks(map: MailMap): { dist: number[][]; next: number[][] } {
  let hit = pairs.get(map);
  if (hit) return hit;
  const n = map.nodes.length;
  const dist = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : Infinity));
  const next = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? j : -1));
  for (const [a, b, w] of map.edges) if (w < dist[a]![b]!) { dist[a]![b] = dist[b]![a] = w; next[a]![b] = b; next[b]![a] = a; }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const dik = dist[i]![k]!;
    if (dik === Infinity) continue;
    for (let j = 0; j < n; j++) if (dik + dist[k]![j]! < dist[i]![j]!) { dist[i]![j] = dik + dist[k]![j]!; next[i]![j] = next[i]![k]!; }
  }
  hit = { dist, next };
  pairs.set(map, hit);
  return hit;
}
/** The nodes walked from `a` to `b` (excluding `a`). */
export function walkTo(map: MailMap, a: number, b: number): number[] {
  const { next } = shortestWalks(map), out: number[] = [];
  for (let at = a; at !== b; at = next[at]![b]!) { if (next[at]![b]! < 0) throw new Error(`no street from ${a} to ${b}`); out.push(next[at]![b]!); }
  return out;
}

/**
 * Exact search (§15.21, k ≤ 8): Held–Karp over the letters still to deliver, from `from`. Returns the fewest steps and
 * the order of stops. Deterministic: ties keep the first order found.
 */
export function bestRound(map: MailMap, targets: readonly number[], from: number): { steps: number; order: number[] } {
  const m = targets.length;
  if (!m) return { steps: 0, order: [] };
  const { dist } = shortestWalks(map), size = 1 << m;
  const dp = new Float64Array(size * m).fill(Infinity), parent = new Int8Array(size * m).fill(-1);
  for (let j = 0; j < m; j++) dp[(1 << j) * m + j] = dist[from]![targets[j]!]!;
  for (let mask = 1; mask < size; mask++) for (let j = 0; j < m; j++) {
    const here = dp[mask * m + j]!;
    if (!(mask & (1 << j)) || here === Infinity) continue;
    for (let t = 0; t < m; t++) {
      if (mask & (1 << t)) continue;
      const nm = mask | (1 << t), cost = here + dist[targets[j]!]![targets[t]!]!;
      if (cost < dp[nm * m + t]!) { dp[nm * m + t] = cost; parent[nm * m + t] = j; }
    }
  }
  let end = 0;
  for (let j = 1; j < m; j++) if (dp[(size - 1) * m + j]! < dp[(size - 1) * m + end]!) end = j;
  const order: number[] = [];
  for (let mask = size - 1, j = end; j >= 0;) { order.unshift(targets[j]!); const p = parent[mask * m + j]!; mask &= ~(1 << j); j = p; }
  return { steps: dp[(size - 1) * m + end]!, order };
}

export const mailSteps = (map: MailMap, path: readonly number[]): number =>
  path.reduce((sum, node, i) => i === 0 ? 0 : sum + stepsBetween(map, path[i - 1]!, node), 0);
export const delivered = (round: MailRound, path: readonly number[]): number[] => round.letters.filter(l => path.includes(l));

/** The solver: an optimal walk from the start, as the moves (nodes stepped onto) that deliver every letter. */
export function solveMailRound(round: MailRound, path: readonly number[] = [round.map.start]): number[] {
  const at = path[path.length - 1]!, left = round.letters.filter(l => !path.includes(l));
  const moves: number[] = [];
  let here = at;
  for (const stop of bestRound(round.map, left, at).order) { moves.push(...walkTo(round.map, here, stop)); here = stop; }
  return moves;
}

/** A district for the day (any with room for k letters), k addresses from it, and the exact par. */
export function generateMailRound(maps: readonly MailMap[], seed: number, wits: number): MailRound {
  const k = lettersFor(wits), rng = new SeededRng(seed);
  const addresses = (m: MailMap) => m.nodes.flatMap((n, i) => n.address && i !== m.start ? [i] : []);
  const eligible = maps.filter(m => addresses(m).length >= k);
  if (!eligible.length) throw new Error(`no district has ${k} addresses for a Mail Round`);
  const map = rng.pick(eligible), pool = addresses(map);
  // A partial Fisher–Yates draw: k distinct doors, in the order they come out of the satchel.
  for (let i = 0; i < k; i++) { const j = i + Math.floor(rng.next() * (pool.length - i)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  const letters = pool.slice(0, k), best = bestRound(map, letters, map.start);
  if (!Number.isFinite(best.steps)) throw new Error(`${map.district}: a letter's door can't be walked to`);
  return { seed, wits, map, letters, optimal: best.steps, par: mailPar(best.steps), first: best.order[0]! };
}

export function mailPuzzle(round: MailRound): Puzzle {
  const { map } = round, n = map.nodes.length;
  const valid = (c: readonly number[]) => c.length >= 1 && c.length <= MAIL_MAX_WALK && c[0] === map.start
    && c.every((v, i) => Number.isInteger(v) && v >= 0 && v < n && (i === 0 || stepsBetween(map, c[i - 1]!, v) < Infinity));
  return puzzle({
    id: MAIL_ID, title: `Mail Round · ${map.name}`,
    instructions: `Ada’s satchel holds ${round.letters.length} letters for ${map.name}. Walk from door to door along the streets and deliver every ✉ within par (${round.par} steps). Passing a door delivers its letter.`,
    hints: ['A round that doubles back pays for the same street twice. Sweep through the district in one direction.',
      'Ada: “Leave the out-of-the-way door for last, so you never have to walk back from it.”',
      `Ada runs a finger along the map: “Start with ${map.nodes[round.first]!.label}.”`],
    initial: [map.start], valid,
    legal: c => c.length >= MAIL_MAX_WALK ? [] : (neighbours(map)[c[c.length - 1]!] ?? []).filter((_, i) => i % 2 === 0).sort((a, b) => a - b),
    move: (c, node) => [...c, node],
    won: c => delivered(round, c).length === round.letters.length && mailSteps(map, c) <= round.par
  });
}
