import { puzzle, vector, indices, cycle } from './core';
export const grid = ['..#..','MM..#','MMPM.','.#...','.....'].join('');
export const mirrors = indices(25).filter(i => grid[i] === 'M');
export function trace(c: readonly number[]): { path: number[]; prism: boolean; exit: number | null; direction: number } {
  let r=2, col=0, d=1, prism=false; const seen = new Set<string>(), path: number[] = [];
  while (r>=0 && r<5 && col>=0 && col<5) {
    const i=r*5+col, key=`${i}:${d}`;
    if (seen.has(key) || grid[i] === '#') return { path, prism, exit: null, direction: d };
    seen.add(key); path.push(i); prism ||= i===12;
    const m=mirrors.indexOf(i); if (m>=0) d = (c[m] === 0 ? [1,0,3,2] : [3,2,1,0])[d]!;
    r += [-1,0,1,0][d]!; col += [0,1,0,-1][d]!;
  }
  return { path, prism, exit: path[path.length-1] ?? null, direction: d };
}
export const PZ05 = puzzle({ id: 'PZ-05', title: 'The Lens', instructions: 'Tilt the five mirrors. Send the lamp east from row 3, through the prism, then out the sea window above column 4. Pillars block light.',
  hints: ['The beam has to go up and back down to reach the prism.', 'The mirror after the prism sends it north.', 'The first mirror sends the beam north.'],
  // GDD-GAP: no initial mirror settings authored; begin with all mirrors /.
  initial: [0,0,0,0,0], valid: c => vector(c,5,0,1), legal: () => indices(5), move: (c,i) => cycle(c,i,2),
  won: c => { const t=trace(c); return t.prism && t.exit===3 && t.direction===0; } });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ05;
