import { puzzle, vector, indices } from './core';
export const PZ02 = puzzle({ id: 'PZ-02', title: "The Old Lady’s Flues", instructions: 'Press a damper to flip it and its four neighbours. Open all nine flues. Dark means shut.',
  hints: ['Every press flips a little plus-shape.', 'Pressing the same damper twice undoes it.', 'Start in the middle row.'],
  initial: [1,0,1,0,1,1,1,0,0], valid: c => vector(c,9,0,1), legal: () => indices(9),
  move: (c,i) => c.map((v,j) => Math.abs(Math.floor(i/3)-Math.floor(j/3)) + Math.abs(i%3-j%3) <= 1 ? 1-v : v), won: c => c.every(v => v === 0) });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ02;
