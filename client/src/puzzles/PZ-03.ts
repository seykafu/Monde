import { puzzle, indices } from './core';
export const lines = [
  'In the sixth month the tides run high and the herring come in close.',
  'Sleep with a window open in May, and you will wake with the gulls.',
  'Keep a lamp in the window for my neighbours who fish late.',
  'A map is a promise that the road will be there in the morning.',
  'Mend your nets in the shade; the sun makes the twine proud.',
  "Plant beans on Saint Brigid's day, and talk to them kindly.",
  'The clock in the square keeps the time of the whole town, not of the mayor.',
  'Book your passage early, for the packet boat fills before the tide.',
  'Bread rises best in a warm kitchen and a quiet house.',
  'Of all the things a town can own, the shore is the one it sleeps beside.'
];
export const codes = [[3,8],[4,2],[10,15],[1,1],[1,2],[1,3],[8,1],[7,9],[1,6]] as const;
export const words = lines.flatMap((line,r) => line.split(' ').map((text,c) => ({ text, word: text.replace(/[^A-Za-z']/g,'').toLowerCase(), line: r+1, column: c+1 })));
export const decode = (c: readonly number[]) => c.map(i => words[i]?.word ?? '').join(' ');
export const PZ03 = puzzle({ id: 'PZ-03', title: 'The Almanac', instructions: 'Each pair is line.word. Select nine words from the page to build the message.\n3.8 · 4.2 · 10.15 · 1.1 · 1.2 · 1.3 · 8.1 · 7.9 · 1.6',
  hints: ['The first number is a line.', 'The second number counts words along that line.', '3.8 is “my.”'], initial: [],
  valid: c => c.length <= 9 && c.every(v => Number.isInteger(v) && v >= 0 && v < words.length),
  legal: c => c.length < 9 ? indices(words.length) : [], move: (c,i) => [...c,i], won: c => decode(c) === 'my map sleeps in the sixth book of tides' });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ03;
