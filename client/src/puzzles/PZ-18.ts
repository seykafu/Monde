import { puzzle, vector, indices } from './core';
export const planks = [2,3,3,4,5,5,5], gaps = [7,9,11];
export const sums = (c: readonly number[]) => gaps.map((_,g)=>c.reduce((n,v,i)=>n+(v===g?planks[i]!:0),0));
export const PZ18 = puzzle({ id: 'PZ-18', title: 'Planks for the Footbridge', instructions: 'Assign every offcut to a gap: 7, 9 or 11 feet. Select a plank to move it to the next gap (or back to the pile). No waste.',
  hints: ['The planks add up to 27, exactly the gaps.', 'If the 4 goes in the 7 gap with a 3, nothing left adds up to 9.', 'The 2 goes in the 7.'],
  initial: [-1,-1,-1,-1,-1,-1,-1], valid: c=>vector(c,7,-1,2), legal: ()=>indices(7), move: (c,i)=>c.map((v,j)=>i===j?(v+2)%4-1:v),
  won: c=>c.every(v=>v>=0) && sums(c).every((v,i)=>v===gaps[i]) });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ18;
