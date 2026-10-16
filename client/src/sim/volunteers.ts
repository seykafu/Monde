// Project shifts in residents' day plans (GDD §6.3: "Volunteers physically show up and work, so the player can watch
// the town pitch in"; MVP G-03). Pure: no Phaser, no DOM.
//
// A shift is a block at a Project's site, `volunteer` while they work, `work` for a lead minding it, `attend` at an
// opening, with the work area the executor stands them in (DayPlanBlock.area). It is spliced into the day plan the
// resident already has (their template routine, or the mind's live plan, §9.7): whatever they'd planned for those
// hours is cut back to make room, and they pick up the rest of their day afterwards. Later shifts in the list win
// where two overlap (an opening over a work shift). ResidentSim applies them through its plan adjuster, so a shift
// booked for tomorrow never moves anyone today.
import type { DayPlan, DayPlanBlock, PlanAction } from './plans';
import { minutesToHhmm } from './plans';

export interface Shift {
  resident: string;
  action: PlanAction;
  /** The `zone.place` their plan says (and they tell the server they're at). */
  place: string;
  /** The tile rectangle on that place's board where they stand. */
  area?: readonly [number, number, number, number];
  startMin: number;
  endMin: number;
  note: string;
}

/** One shift into one plan: the blocks it covers are trimmed or split around it. */
export function spliceShift(plan: DayPlan, shift: Shift): DayPlan {
  const { startMin: s, endMin: e } = shift;
  if (!(e > s)) return plan;
  const cut = (b: DayPlanBlock, from: number, to: number): DayPlanBlock =>
    ({ ...b, startMin: from, endMin: to, start: minutesToHhmm(from), end: minutesToHhmm(to) });
  const blocks: DayPlanBlock[] = [];
  for (const b of plan.blocks) {
    if (b.endMin <= s || b.startMin >= e) { blocks.push(b); continue; }
    if (b.startMin < s) blocks.push(cut(b, b.startMin, s));
    if (b.endMin > e) blocks.push(cut(b, e, b.endMin));
  }
  const block: DayPlanBlock = {
    start: minutesToHhmm(s), end: minutesToHhmm(e), action: shift.action, place: shift.place, with: [], note: shift.note,
    startMin: s, endMin: e, ...(shift.area ? { area: shift.area } : {})
  };
  blocks.push(block);
  blocks.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  return { ...plan, blocks };
}

/** Every shift into the day's plans (residents with none keep their plan object, so the executor's cache holds). */
export function withShifts(plans: readonly DayPlan[], shifts: readonly Shift[]): DayPlan[] {
  if (!shifts.length) return [...plans];
  const by = new Map<string, Shift[]>();
  for (const s of shifts) by.set(s.resident, [...(by.get(s.resident) ?? []), s]);
  return plans.map(p => (by.get(p.resident) ?? []).reduce(spliceShift, p));
}

/** A stable key for a day's shifts: the sim rebuilds its plans only when this changes. */
export const shiftsKey = (shifts: readonly Shift[]): string =>
  shifts.map(s => `${s.resident}:${s.action}:${s.place}:${s.startMin}-${s.endMin}:${s.area?.join(',') ?? ''}`).join('|');
