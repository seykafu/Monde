import { puzzle, vector, indices } from './core';
export const grid = ['.LTL.', 'LL.TI', 'TIIT.', 'ILIT.', 'LLIL.'].join('');
// N/E/S/W bits; solution also cross-checked against the Python network solver.
export const solution = [0,6,11,12,0,6,9,0,7,10,7,10,10,13,0,5,6,10,13,0,9,3,10,9,0];
export const rotate = (v: number) => ((v << 1) & 15) | (v >> 3);
const base: Record<string, number> = { '.': 0, I: 5, L: 3, T: 11 };
export const orientations = (i: number): number[] => { let v = base[grid[i]!]!; const out = new Set<number>(); for (let k = 0; k < 4; k++) { out.add(v); v = rotate(v); } return [...out]; };
export function connected(c: readonly number[]): boolean {
  if (c.length !== 25) return false;
  const steps = [-5, 1, 5, -1];
  for (const i of indices(25)) for (let d = 0; d < 4; d++) {
    const port = !!(c[i]! & (1 << d));
    const edge = d === 0 ? i < 5 : d === 1 ? i % 5 === 4 : d === 2 ? i >= 20 : i % 5 === 0;
    if (edge) { if (port !== ((i === 20 && d === 3) || (i === 2 && d === 0) || (i === 9 && d === 1))) return false; }
    else if (port !== !!(c[i + steps[d]!]! & (1 << ((d + 2) % 4)))) return false;
  }
  const seen = new Set<number>([20]), todo = [20];
  while (todo.length) { const i = todo.pop()!; for (let d = 0; d < 4; d++) if (c[i]! & (1 << d)) {
    const j = i + steps[d]!;
    if (j >= 0 && j < 25 && Math.abs(j % 5 - i % 5) <= 1 && !seen.has(j)) { seen.add(j); todo.push(j); }
  } }
  return indices(25).every(i => !c[i] || seen.has(i));
}
export const PZ01 = puzzle({ id: 'PZ-01', title: 'Under the Square', instructions: 'Turn pipes clockwise. Feed both the heron (top) and basin (right), with no leaks or disconnected pieces. The main enters at bottom left.',
  hints: ['Start from the main and follow the water.', 'A tee is a fork: one way in, two ways out.', 'The bottom-left piece turns the water north.'],
  initial: solution.map(rotate), valid: c => vector(c, 25, 0, 15) && c.every((v, i) => orientations(i).includes(v)),
  legal: () => indices(25).filter(i => grid[i] !== '.'), move: (c, i) => c.map((v, j) => j === i ? rotate(v) : v), won: connected });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ01;
