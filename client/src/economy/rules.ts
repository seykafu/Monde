import { gainXp, type CommunityTask, type Economy, type Skills, type ClientEvent } from '@monde/shared';
import { applyPillarDelta } from '../town/pillars';
import type { TownState } from '../town/pillars';
import { PASS_OUT, MIDNIGHT } from '../sim/clock';
export function spendStamina(state: Economy, cost: number): Economy | null {
  return Number.isFinite(cost) && cost >= 0 && state.stamina >= cost ? { ...state, stamina: state.stamina - cost } : null;
}
export const eat = (state: Economy, restore: number): Economy => ({ ...state, stamina: Math.min(state.maxStamina, state.stamina + Math.max(0, restore)) });
export const awakeMinute = (state: Economy, minute: number): Economy => minute > MIDNIGHT ? { ...state, stamina: Math.max(0, state.stamina - 1) } : state;
export const mustPassOut = (minute: number): boolean => minute >= PASS_OUT;
/** GDD-GAP: interpret §11.3’s bonus as capacity for that day, so an early night starts at 110, a pass-out at 70. */
export function sleep(state: Economy, day: number, minute: number): Economy {
  const max = minute < MIDNIGHT ? 110 : 100;
  return { ...state, day: day + 1, stamina: mustPassOut(minute) ? 70 : max, maxStamina: max, work: {} };
}
export function completeWork(args: { state: Economy; task: CommunityTask; day: number; minute: number; coins: number; town: TownState; skills: Skills; organizer?: boolean; id: string }) {
  const { task, day, minute } = args;
  if (day < task.opens || minute + task.minutes > PASS_OUT || args.state.day !== day) return null;
  const spent = spendStamina(args.state, task.stamina); if (!spent) return null;
  const repeats = spent.work[task.id] ?? 0;
  const effect = task.effect * (repeats === 0 ? 1 : repeats === 1 ? 0.5 : 0) * (args.organizer ? 1.25 : 1);
  const town = applyPillarDelta(args.town, task.pillar, effect, 'community_work', task.name);
  const event: ClientEvent = { kind: 'community_work', id: args.id, day, minute, task: task.id, place: task.place, participants: ['player'] };
  return { state: { ...spent, work: { ...spent.work, [task.id]: repeats + 1 } }, coins: args.coins + task.pay, town,
    skills: gainXp(args.skills, task.skill, task.xp), minutes: task.minutes, event };
}
