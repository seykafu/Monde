import { describe, expect, it } from 'vitest';
import type { PersonaCard, RoutineBlock } from '@monde/shared';
import { blocksFromPlanOutput, blocksFromRoutine, dayPlan, dayPlansFor, hhmmToMinutes, jitterPlan, minutesToHhmm, routineKind, syntheticPlans } from '../plans';
import { loadCards } from './content';

const cards = loadCards();
const card = (id: string): PersonaCard => cards.find(c => c.id === id)!;
const r = (at: string, where = 'old_quarter.library', d: RoutineBlock['do'] = 'read'): RoutineBlock => ({ at, do: d, where });

describe('plan conversion', () => {
  it('uses the weekday routine Mon–Fri and the weekend one Sat–Sun', () => {
    expect((['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map(routineKind))
      .toEqual(['weekday', 'weekday', 'weekday', 'weekday', 'weekday', 'weekend', 'weekend']);
    const odile = card('odile');
    expect(dayPlan(odile, 'Mon', { lingers: false }).blocks.map(b => b.place)).toEqual(odile.routine.weekday.map(b => b.where));
    expect(dayPlan(odile, 'Sun', { lingers: false }).blocks.map(b => b.place)).toEqual(odile.routine.weekend.map(b => b.where));
    expect(dayPlan(odile, 'Sun').blocks[1]).toMatchObject({ action: 'attend', place: 'old_quarter.st_brigids', start: '09:30' });
    // Day 1 is a Tuesday (§3.2); Day 5 a Saturday.
    expect(dayPlansFor([odile], 1)[0]!.routine).toBe('weekday');
    expect(dayPlansFor([odile], 5)[0]!.routine).toBe('weekend');
  });

  it('ends each block where the next starts, and the last at 26:00', () => {
    const plan = dayPlan(card('margo'), 'Tue');
    plan.blocks.slice(0, -1).forEach((b, i) => { expect(b.endMin).toBe(plan.blocks[i + 1]!.startMin); expect(b.end).toBe(plan.blocks[i + 1]!.start); });
    expect(plan.blocks.at(-1)).toMatchObject({ action: 'sleep', start: '22:30', end: '26:00', endMin: 1560 });
    // The shape of a server PlanOutput block, plus minutes.
    expect(Object.keys(plan.blocks[0]!).sort()).toEqual(['action', 'end', 'endMin', 'note', 'place', 'start', 'startMin', 'with']);
  });

  it('reads times past midnight up to 26:00', () => {
    expect(hhmmToMinutes('24:30')).toBe(1470);
    expect(hhmmToMinutes('26:00')).toBe(1560);
    expect(() => hhmmToMinutes('26:01')).toThrow(/26:00/);
    expect(() => hhmmToMinutes('9h30')).toThrow(/HH:MM/);
    expect(minutesToHhmm(1500)).toBe('25:00');
    // Sable writes at the Lantern till 01:00 and sleeps at 25:00.
    expect(dayPlan(card('sable'), 'Wed').blocks.at(-1)).toMatchObject({ startMin: 1500, start: '25:00', endMin: 1560 });
    // A time that goes backwards is after midnight; a leading early time is that morning.
    const blocks = blocksFromRoutine([r('04:00'), r('09:00'), r('23:00'), r('00:30')]);
    expect(blocks.map(b => b.startMin)).toEqual([240, 540, 1380, 1470]);
    expect(blocks.map(b => b.endMin)).toEqual([540, 1380, 1470, 1560]);
    expect(() => blocksFromRoutine([r('23:00'), r('02:30')])).toThrow(/26:00/);
  });

  it('starts the day where last night ended', () => {
    const ines = card('ines');
    // Monday follows a weekend in the city; Tuesday follows a night in the pub rooms.
    expect(dayPlan(ines, 'Mon')).toMatchObject({ startPlace: 'offmap.city', startAction: 'sleep' });
    expect(dayPlan(ines, 'Tue')).toMatchObject({ startPlace: 'market_row.pub_rooms', startAction: 'sleep' });
    expect(dayPlan(card('bastien'), 'Tue').outdoors).toBe(true);
    expect(dayPlan(card('odile'), 'Tue').outdoors).toBe(false);
  });

  it('takes live PlanOutput blocks as they are', () => {
    const blocks = blocksFromPlanOutput([
      { start: '07:00', end: '09:00', action: 'eat', place: 'market_row.cafe_liss', with: ['june'], note: 'Breakfast' },
      { start: '23:30', end: '01:00', action: 'socialize', place: 'market_row.gull_and_anchor', with: [], note: '' }
    ]);
    expect(blocks.map(b => [b.startMin, b.endMin])).toEqual([[420, 540], [1410, 1500]]);
    expect(blocks[0]).toMatchObject({ with: ['june'], note: 'Breakfast' });
  });

  it('jitters synthetic copies deterministically, in order, within the window', () => {
    const base = dayPlan(card('pell'), 'Thu');
    const a = jitterPlan(base, 'pell_7', 'seed'), b = jitterPlan(base, 'pell_7', 'seed');
    expect(a).toEqual(b);
    expect(a.resident).toBe('pell_7');
    a.blocks.forEach((blk, i) => {
      expect(Math.abs(blk.startMin - base.blocks[i]!.startMin)).toBeLessThanOrEqual(20);
      if (i > 0) expect(blk.startMin).toBeGreaterThanOrEqual(a.blocks[i - 1]!.startMin + 5);
      expect(blk.endMin).toBe(a.blocks[i + 1]?.startMin ?? 1560);
    });
    const crowd = syntheticPlans(cards.map(c => dayPlan(c, 'Thu')), 30);
    expect(crowd).toHaveLength(30);
    expect(new Set(crowd.map(p => p.resident)).size).toBe(30);
  });
});
