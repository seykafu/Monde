// Gatherings (MVP polish; GDD §9.11.3, §16.4.1): the template days' outdoor stops bring residents together at the
// boards' social spots, and the executor stands them round one spot on cells of their own.
import { describe, expect, it } from 'vitest';
import { ALL_GATHERING_PLACES } from '@monde/shared';
import { dayPlan, type DayPlan, type DayPlanBlock } from '../plans';
import { RoutineExecutor, withSeats } from '../routineExecutor';
import { ResidentSim } from '../residentSim';
import { loadCards, loadWorld } from './content';
import type { Weekday } from '../clock';

const world = loadWorld();
const cards = loadCards();
const WEEK: readonly Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const block = (startMin: number, endMin: number, action: DayPlanBlock['action'], place: string): DayPlanBlock =>
  ({ start: '', end: '', action, place, with: [], note: '', startMin, endMin });
const plan = (resident: string, blocks: DayPlanBlock[]): DayPlan =>
  ({ resident, weekday: 'Wed', routine: 'weekday', startPlace: 'market_row.bakery_flat', startAction: 'sleep', blocks });
const lunchAtThePump = (resident: string) => plan(resident, [
  block(360, 735, 'work', 'market_row.bakery'), block(735, 775, 'socialize', 'market_row.market_street'), block(775, 1560, 'sleep', 'market_row.bakery_flat')]);

describe('seats', () => {
  it('number the residents meeting at a place in the same hours, and leave everyone else alone', () => {
    const quiet = plan('q', [block(360, 1560, 'work', 'market_row.bakery')]);
    const seated = withSeats([lunchAtThePump('a'), quiet, lunchAtThePump('b'),
      plan('c', [block(360, 1000, 'work', 'market_row.bakery'), block(1000, 1040, 'eat', 'market_row.market_street'), block(1040, 1560, 'sleep', 'market_row.bakery_flat')])]);
    expect(seated[1]).toBe(quiet);
    expect(seated[0]!.blocks[1]!.seat).toEqual({ group: 0, groups: 1, index: 0 });
    expect(seated[2]!.blocks[1]!.seat).toEqual({ group: 0, groups: 1, index: 1 });
    expect(seated[3]!.blocks[1]!.seat).toEqual({ group: 0, groups: 1, index: 0 }); // late afternoon is another gathering
  });
  it('split a crowd into twos and threes', () => {
    const seats = withSeats(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(lunchAtThePump)).map(p => p.blocks[1]!.seat!);
    const sizes = [0, 1, 2].map(g => seats.filter(s => s.group === g).length);
    expect(sizes).toEqual([3, 2, 2]);
    expect(seats.every(s => s.groups === 3)).toBe(true);
  });
});

describe('the executor at a social spot', () => {
  it("stands a gathering round the place's spots, a pair or three to a spot, each on a cell of their own, in the open", () => {
    const ex = new RoutineExecutor(world);
    const spots = world.zones.market_row!.social;
    const spotOf = (x: number, y: number) => spots.find(s => s.stand.some(([sx, sy]) => sx + 0.5 === x && sy + 0.5 === y))?.id;
    const three = withSeats(['ada', 'nell', 'odile'].map(lunchAtThePump)).map(p => ex.stateAt(p, 755));
    expect(three.every(s => s.visible && !s.moving && s.place === 'market_row.market_street')).toBe(true);
    const at = three.map(s => spotOf(s.position!.x, s.position!.y));
    expect(at.every(id => id && id === at[0])).toBe(true);
    expect(new Set(three.map(s => `${s.position!.x},${s.position!.y}`)).size).toBe(3);
    // Four: two pairs at two spots.
    const four = withSeats(['ada', 'nell', 'odile', 'june'].map(lunchAtThePump)).map(p => ex.stateAt(p, 755));
    const fourAt = four.map(s => spotOf(s.position!.x, s.position!.y)!);
    expect(new Set(fourAt).size).toBe(2);
    expect(fourAt[0]).toBe(fourAt[2]);
    expect(fourAt[1]).toBe(fourAt[3]);
    // A place with one spot keeps everyone on cells of their own.
    const quay = (id: string) => plan(id, [block(360, 735, 'work', 'wharf.fish_market'), block(735, 775, 'socialize', 'wharf.harbor_steps'), block(775, 1560, 'sleep', 'wharf.nell_cottage')]);
    const five = withSeats(['a', 'b', 'c', 'd', 'e'].map(quay)).map(p => ex.stateAt(p, 755));
    expect(new Set(five.map(s => `${s.position!.x},${s.position!.y}`)).size).toBe(5);
  });

  it("leaves strolls and work about an open place as they were", () => {
    const ex = new RoutineExecutor(world);
    const p = plan('w', [block(360, 900, 'walk', 'old_quarter.fountain_square'), block(900, 1560, 'sleep', 'old_quarter.pell_house')]);
    const moving = Array.from({ length: 60 }, (_, i) => ex.stateAt(p, 420 + i * 5).moving);
    expect(moving.some(Boolean)).toBe(true);
  });
});

describe('the shipped residents', () => {
  it('step out to a gathering place on a built board, where the executor finds a social spot', () => {
    const ex = new RoutineExecutor(world);
    for (const day of WEEK) for (const c of cards) for (const b of dayPlan(c, day).blocks) {
      if (!ALL_GATHERING_PLACES.includes(b.place) || !['socialize', 'eat'].includes(b.action)) continue;
      expect(ex.resolve(b.place).kind, b.place).toBe('open');
      expect(ex.socialSpots(b.place).length, b.place).toBeGreaterThan(0);
    }
  });

  it('meet in pairs outdoors most days, around lunch and late in the afternoon', () => {
    let together = 0;
    for (const day of WEEK) {
      const sim = new ResidentSim(cards, world);
      const dayNo = WEEK.indexOf(day) + 7; // Day 7 is a Monday (Day 1 a Tuesday)
      let daily = 0;
      for (const minute of [12 * 60 + 30, 17 * 60]) {
        const out = sim.tick(dayNo, minute).filter(s => s.visible && s.zone && s.position && ALL_GATHERING_PLACES.includes(s.place) && !s.traveling);
        const byPlace = new Map<string, number>();
        for (const s of out) byPlace.set(s.place, (byPlace.get(s.place) ?? 0) + 1);
        daily += [...byPlace.values()].filter(n => n >= 2).length;
      }
      if (daily > 0) together++;
    }
    expect(together, 'weekdays with two or more residents gathered at one place, at 12:30 or 17:00').toBeGreaterThanOrEqual(6);
  });
});
