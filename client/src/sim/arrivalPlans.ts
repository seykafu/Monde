// The first and the last day of a generated resident (GDD §6.4; MVP G-02). Pure: no Phaser, no DOM.
//
//   landing   they step off the Gannet at 08:00, take in the slip for a few minutes, walk to their new home and
//             unpack until 11:00; then their own routine picks up for the rest of the day;
//   leaving   their routine runs until the morning, then they walk to the slip with a suitcase for 09:30 and wait
//             for the 10:00 sailing (presence takes them off the board when it sails).
import { minutesToHhmm, type DayPlan, type DayPlanBlock, type PlanAction } from './plans';

export const FERRY_SLIP = 'wharf.ferry_slip';
/** §6.4: off the ferry at 08:00. */
export const LAND_MINUTE = 8 * 60;
/** A few minutes on the slip before setting off (art tuning, not a rule). */
export const LOOK_AROUND_MINUTES = 25;
/** GDD-GAP: §6.4 doesn't say how long unpacking takes; until 11:00, when their routine picks up. */
export const UNPACK_UNTIL = 11 * 60;
/** §6.4: leavers walk to the slip with a suitcase at 09:30; the Gannet sails at 10:00. */
export const LEAVE_MINUTE = 9 * 60 + 30;
const END = 26 * 60;

const block = (startMin: number, endMin: number, action: PlanAction, place: string, note = ''): DayPlanBlock => ({
  start: minutesToHhmm(startMin), end: minutesToHhmm(endMin), action, place, with: [], note, startMin, endMin
});

/** The plan's blocks from `from` on, the first one cut to start there. */
const after = (blocks: readonly DayPlanBlock[], from: number): DayPlanBlock[] =>
  blocks.filter(b => b.endMin > from).map(b => (b.startMin >= from ? b : block(from, b.endMin, b.action, b.place, b.note)));

/** The plan's blocks until `to`, the last one cut to end there. */
const before = (blocks: readonly DayPlanBlock[], to: number): DayPlanBlock[] =>
  blocks.filter(b => b.startMin < to).map(b => (b.endMin <= to ? b : block(b.startMin, to, b.action, b.place, b.note)));

/** Landing day: the slip at 08:00, home to unpack, then their routine from 11:00. */
export function landingDayPlan(plan: DayPlan, home: string): DayPlan {
  const look = LAND_MINUTE + LOOK_AROUND_MINUTES;
  return {
    ...plan, startPlace: FERRY_SLIP, startAction: 'wander',
    blocks: [
      block(LAND_MINUTE, look, 'wander', FERRY_SLIP, 'just off the ferry'),
      block(look, UNPACK_UNTIL, 'clean', home, 'unpacking'),
      ...after(plan.blocks, UNPACK_UNTIL)
    ]
  };
}

/** Leaving day: their morning, then the slip with a suitcase from 09:30. */
export function leavingDayPlan(plan: DayPlan): DayPlan {
  const morning = before(plan.blocks, LEAVE_MINUTE);
  return { ...plan, blocks: [...morning, block(LEAVE_MINUTE, END, 'sit', FERRY_SLIP, 'waiting for the boat, a suitcase at their feet')] };
}
