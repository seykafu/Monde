// Project shifts in residents' days (MVP G-03): splicing a shift into a plan, the executor standing a volunteer in a
// site's work area (outdoors, even when the place is a building), and ResidentSim's plan adjuster.
import { describe, expect, it } from 'vitest';
import { dayPlan, type DayPlan } from '../plans';
import { RoutineExecutor } from '../routineExecutor';
import { ResidentSim } from '../residentSim';
import { shiftsKey, spliceShift, withShifts, type Shift } from '../volunteers';
import { loadCards, loadWorld } from './content';

const world = loadWorld();
const cards = loadCards();
const card = (id: string) => cards.find(c => c.id === id)!;
const FOUNTAIN: Shift = { resident: 'kasimir', action: 'volunteer', place: 'old_quarter.fountain_square', area: [17, 17, 10, 6], startMin: 600, endMin: 780, note: 'Lending a hand with the fountain' };

describe('spliceShift', () => {
  it('cuts what the resident had planned around the shift and keeps the rest of their day', () => {
    const plan = dayPlan(card('pell'), 'Wed');
    const out = spliceShift(plan, { ...FOUNTAIN, resident: 'pell' });
    const covering = out.blocks.filter(b => b.endMin > 600 && b.startMin < 780);
    expect(covering).toHaveLength(1);
    expect(covering[0]).toMatchObject({ action: 'volunteer', place: 'old_quarter.fountain_square', start: '10:00', end: '13:00', area: [17, 17, 10, 6] });
    // Pell's 08:30 office block is cut back to 10:00, her 12:30 lunch to its last half hour; her afternoon at the Town Hall stands.
    expect(out.blocks.find(b => b.startMin === 510)).toMatchObject({ action: 'work', place: 'old_quarter.mayor_office', end: '10:00', endMin: 600 });
    expect(out.blocks.find(b => b.place === 'market_row.cafe_liss')).toMatchObject({ start: '13:00', end: '13:30' });
    expect(out.blocks.find(b => b.startMin === 810)).toMatchObject({ place: 'old_quarter.town_hall' });
    for (let i = 1; i < out.blocks.length; i++) expect(out.blocks[i]!.startMin).toBeGreaterThanOrEqual(out.blocks[i - 1]!.endMin);
    expect(plan.blocks.some(b => b.action === 'volunteer')).toBe(false); // the input is untouched
  });

  it('splits a block the shift falls inside, and leaves residents without a shift as they were', () => {
    const plan: DayPlan = { resident: 'x', weekday: 'Wed', routine: 'weekday', startPlace: 'old_quarter.pell_house', startAction: 'sleep',
      blocks: [{ start: '08:00', end: '18:00', action: 'work', place: 'old_quarter.library', with: [], note: '', startMin: 480, endMin: 1080 }] };
    const out = spliceShift(plan, { ...FOUNTAIN, resident: 'x' });
    expect(out.blocks.map(b => [b.start, b.end, b.action])).toEqual([['08:00', '10:00', 'work'], ['10:00', '13:00', 'volunteer'], ['13:00', '18:00', 'work']]);
    const plans = [plan, dayPlan(card('odile'), 'Wed')];
    const shifted = withShifts(plans, [{ ...FOUNTAIN, resident: 'x' }]);
    expect(shifted[1]).toBe(plans[1]);
    expect(shiftsKey([FOUNTAIN])).toBe(shiftsKey([{ ...FOUNTAIN }]));
    expect(shiftsKey([FOUNTAIN])).not.toBe(shiftsKey([{ ...FOUNTAIN, startMin: 610 }]));
  });
});

describe('the executor at a work site', () => {
  it('walks a volunteer to the site and keeps them working about the work area in the open', () => {
    const ex = new RoutineExecutor(world);
    const plan = spliceShift(dayPlan(card('kasimir'), 'Wed'), FOUNTAIN);
    const spots = new Set<string>();
    // On site from 10:00 until they leave in time for the next block (his workshop, off this board, at 13:00).
    for (let m = 600; m < 750; m += 3) {
      const s = ex.stateAt(plan, m);
      expect(s).toMatchObject({ zone: 'old_quarter', place: 'old_quarter.fountain_square', activity: 'volunteer', visible: true });
      expect(s.traveling).toBeNull();
      const [x, y] = [s.position!.x, s.position!.y];
      expect(x >= 17 && x < 27 && y >= 17 && y < 23).toBe(true);
      if (!s.moving) spots.add(`${Math.floor(x)},${Math.floor(y)}`);
    }
    // Fetching and carrying: more than one spot over three hours, a long while at each.
    expect(spots.size).toBeGreaterThan(1);
    expect(spots.size).toBeLessThan(15);
    // Before the shift he was on his way from Millbrook (off this board); after it, on his way back.
    expect(ex.stateAt(plan, 580)).toMatchObject({ place: 'old_quarter.fountain_square', traveling: { to: 'old_quarter.fountain_square' } });
    expect(ex.stateAt(plan, 770)).toMatchObject({ place: 'millbrook.kasimir_workshop' });
  });

  it('stands a volunteer outdoors in front of a building site (the bakery ovens, from Market Street)', () => {
    const ex = new RoutineExecutor(world);
    const plan = spliceShift(dayPlan(card('june'), 'Wed'), { ...FOUNTAIN, resident: 'june', place: 'market_row.bakery', area: [24, 10, 6, 2] });
    const s = ex.stateAt(plan, 700);
    expect(s).toMatchObject({ zone: 'market_row', place: 'market_row.bakery', visible: true });
    expect(s.position!.y).toBeGreaterThanOrEqual(10);
    expect(s.position!.y).toBeLessThan(12);
    // Without the area the bakery is a building: inside, unseen.
    const inside = spliceShift(dayPlan(card('june'), 'Wed'), { resident: 'june', action: 'work', place: 'market_row.bakery', startMin: 600, endMin: 780, note: '' });
    expect(ex.stateAt(inside, 700).visible).toBe(false);
  });
});

describe("ResidentSim's plan adjuster", () => {
  it('rebuilds the day only when the shifts for that day change', () => {
    const sim = new ResidentSim(cards, world);
    let shifts: Shift[] = [];
    let applied = 0;
    sim.setAdjuster({ key: () => shiftsKey(shifts), apply: (plans) => { applied++; return withShifts(plans, shifts); } });
    const before = sim.plansFor(3);
    expect(sim.plansFor(3)).toBe(before);
    expect(sim.sample('kasimir', 3, 700)!.activity).not.toBe('volunteer');
    shifts = [FOUNTAIN];
    const after = sim.plansFor(3);
    expect(after).not.toBe(before);
    expect(sim.sample('kasimir', 3, 700)).toMatchObject({ zone: 'old_quarter', activity: 'volunteer', place: 'old_quarter.fountain_square' });
    expect(sim.plansFor(3)).toBe(after);
    expect(applied).toBe(2);
  });
});
