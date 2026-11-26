import { expect, it } from 'vitest';
import { describeWhereabouts, whereabouts } from '../whereabouts';

const square = 'old_quarter.fountain_square', tower = 'old_quarter.clocktower', shop = 'old_quarter.bertrand_house';
const stay = (place: string, t0: number, t1: number, block: number) => ({ place, t0, t1, block, journey: null });
const stops = [
  stay(square, 600, 625, 0),
  { ...stay(tower, 625, 630, 1), journey: { from: square, to: tower, t0: 625, t1: 630 } },
  stay(tower, 630, 750, 1),
  { ...stay(shop, 750, 755, 2), journey: { from: tower, to: shop, t0: 750, t1: 755 } },
  stay(shop, 755, 800, 2),
  stay(shop, 800, 900, 3),
  stay(tower, 900, Infinity, 4)
];
const unlocked = (place: string) => place !== tower;

it('gives the departure from the square and the destination during a walk', () => {
  expect(whereabouts(stops, 624, unlocked)).toEqual({ place: square, until: 625 });
  expect(whereabouts(stops, 752, unlocked)).toEqual({ place: shop, walking: true, until: 900 });
});

it('gives the tower departure and the actual next arrival, including the walk', () => {
  expect(whereabouts(stops, 700, unlocked)).toMatchObject({ place: shop, inside: tower, until: 750, from: 755 });
});

it('keeps an accessible room through consecutive activities and skips a locked one', () => {
  expect(whereabouts(stops, 755, unlocked)).toEqual({ place: shop, until: 900 });
  expect(whereabouts(stops, 755, p => p === tower)).toMatchObject({ inside: shop, until: 900, place: tower, from: 900 });
});

it('points to tomorrow when no stop remains reachable in the plan', () => {
  expect(whereabouts(stops, 900, unlocked)).toBeNull();
  expect(whereabouts([], 700, unlocked)).toBeNull();
  expect(describeWhereabouts(null, shop, () => 'Achterberg Horlogerie')).toEqual({ place: shop, where: 'Achterberg Horlogerie, tomorrow' });
});

it('uses the supplied indoor place name while walking to an unreachable stop', () => {
  const names = (id: string) => id === tower ? 'Clocktower' : 'Achterberg Horlogerie';
  expect(describeWhereabouts(whereabouts(stops, 626, unlocked), shop, names)).toEqual({
    place: shop, where: 'Heading indoors at Clocktower, then at Achterberg Horlogerie from 12:35'
  });
});
