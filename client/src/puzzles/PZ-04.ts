import { puzzle, vector, indices, cycle } from './core';
export const vendors = ['Nell','Kasimir','June','Odile','Teo'];
export const awnings = ['white','blue','yellow','red','green'];
export const gifts = ['herring','kites','songs','jam','cuttings'];
export const requests = [
  'Nell: Fish goes by the west door (stall 1).', 'Kasimir: Stall two has the good beam.', 'Teo: Green. Obviously.',
  'The red awning hangs directly west of green.', 'June gives songs, under yellow.', 'Tib: Kites go next to the music.',
  'Odile gives jam, and won’t sit next to Nell.', 'Herring goes under white.', 'Teo gives cuttings.'
];
export function constraints(c: readonly number[]): boolean {
  const v = c.slice(0,5), a = c.slice(5,10), g = c.slice(10);
  if ([v,a,g].some(row => row.includes(-1) || new Set(row).size !== 5)) return false;
  return v[0] === 0 && v[1] === 1 && a[v.indexOf(4)] === 4 && a.indexOf(3)+1 === a.indexOf(4)
    && g[v.indexOf(2)] === 2 && a[v.indexOf(2)] === 2 && Math.abs(g.indexOf(1)-g.indexOf(2)) === 1
    && g[v.indexOf(3)] === 3 && g[a.indexOf(0)] === 0 && g[v.indexOf(4)] === 4 && Math.abs(v.indexOf(3)-v.indexOf(0)) !== 1;
}
export const PZ04 = puzzle({ id: 'PZ-04', title: 'Market Day', instructions: 'Assign a vendor, awning and giveaway to each stall, west to east. Use each once. Select a card to cycle its choice.',
  hints: ['Place the people whose stall is fixed first.', 'Green must be in stall 3, 4 or 5, with red just west of it, and Teo is green.', 'Teo is in stall 5.'],
  initial: Array<number>(15).fill(-1), valid: c => vector(c,15,-1,4), legal: () => indices(15), move: (c,i) => cycle(c,i,5), won: constraints });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ04;
