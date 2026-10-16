import { puzzle, vector, indices, cycle } from './core';
export const wiring = ['ABC','DE','AEF','BD','AE','CD'];
export const circuits = (c: readonly number[]) => [...'ABCDEF'].map(letter => wiring.reduce((n,w,i) => n+(w.includes(letter)? c[i]!:0),0)%2);
export const PZ13 = puzzle({ id: 'PZ-13', title: 'Lamplight', instructions: 'Flip breakers to light all six circuits. Each breaker toggles every circuit on its wiring card.',
  hints: ['Each circuit must be toggled an odd number of times.', 'F is only on breaker 3, so 3 must be on.', 'With 3 on, A and E need one more toggle each, and breaker 5 does both.'],
  initial: [0,0,0,0,0,0], valid: c => vector(c,6,0,1), legal: () => indices(6), move: (c,i) => cycle(c,i,2), won: c => circuits(c).every(v=>v===1) });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ13;
