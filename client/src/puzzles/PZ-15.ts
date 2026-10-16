import { puzzle, indices } from './core';
export const gears = [8,10,12,16,24,30,32,40,48];
export const PZ15 = puzzle({ id: 'PZ-15', title: 'The Founder’s Gears', instructions: 'Choose a → b, then c → d. Each gear is used once. Both pairs must have equal tooth sums and reduce speed: (a/b) × (c/d) = 1/12.',
  hints: ['12 can be split as 3 × 4.', 'Find a pair that’s 1:3 and a pair that’s 1:4 with the same tooth sum.', 'The lantern pinion drives the 32.'], initial: [],
  valid: c => c.length<=4 && new Set(c).size===c.length && c.every(v=>gears.includes(v)),
  legal: c => c.length<4 ? indices(gears.length).filter(i=>!c.includes(gears[i]!)) : [], move: (c,i) => [...c,gears[i]!],
  // GDD-GAP: the verifier requires each mesh to reduce speed (a<b, c<d); §15's prose omits that constraint.
  won: c => { const [a,b,d,e]=c; return c.length===4 && a!<b! && d!<e! && a! + b! === d! + e! && a! * d! * 12 === b! * e!; } });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ15;
