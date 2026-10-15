// Day plans from persona routines (MVP W-05; GDD §9.3, §9.7). Pure: no Phaser, no DOM.
//
// A persona card carries two template routines, `weekday` (Mon–Fri) and `weekend` (Sat–Sun), as a list
// of `{at, do, where}` starts. The routine executor runs day plans: blocks with a start AND an end, in
// the same shape as the server's PlanOutput blocks (§9.17), so a live plan from the mind can replace the
// template one without the executor noticing (M-07). Each block also carries its times in minutes since
// midnight, the clock's units (sim/clock.ts).
//
// Times: "HH:MM", with hours past midnight written on as 24:30, 25:00… up to 26:00, when the day ends
// (§5.2). A routine reads in order, so a time earlier than the one before it is after midnight ("00:30"
// after "23:00" is 24:30). Times before 06:00 at the head of a routine are that morning, before the
// player's day starts (Odile is at her ovens from 04:00).

import type { PersonaCard, PlanOutput, RoutineBlock } from '@monde/shared';
import { MIDNIGHT, PASS_OUT, weekdayOf, type Weekday } from './clock';
import { Rng } from '../util/rng';

export type PlanAction = RoutineBlock['do'];

/** A PlanOutput block, plus its times in clock minutes. */
export interface DayPlanBlock {
  start: string;
  end: string;
  action: PlanAction;
  place: string;
  with: string[];
  note: string;
  startMin: number;
  endMin: number;
}

export interface DayPlan {
  resident: string;
  weekday: Weekday;
  routine: 'weekday' | 'weekend' | 'live';
  /** Animals (Bastien) stay out on the doorstep instead of going inside. */
  outdoors?: boolean;
  /** Where the resident spent the night (yesterday's last block) and what they were doing there. */
  startPlace: string;
  startAction: PlanAction;
  blocks: DayPlanBlock[];
}

export type RoutineCard = Pick<PersonaCard, 'id' | 'routine'> & Partial<Pick<PersonaCard, 'kind'>>;

export const isWeekend = (day: Weekday): boolean => day === 'Sat' || day === 'Sun';
export const routineKind = (day: Weekday): 'weekday' | 'weekend' => isWeekend(day) ? 'weekend' : 'weekday';
export const routineFor = (card: RoutineCard, day: Weekday): readonly RoutineBlock[] => card.routine[routineKind(day)];

/** "25:30" → 1530, "04:00" → 240. Throws on anything that isn't HH:MM between 00:00 and 26:00. */
export function hhmmToMinutes(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Bad time "${text}": expected HH:MM`);
  const total = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59 || total > PASS_OUT) throw new Error(`Bad time "${text}": the day ends at 26:00`);
  return total;
}

/** 1530 → "25:30" (the plan format keeps hours past midnight as 24–26). */
export const minutesToHhmm = (minute: number): string => {
  const m = Math.round(minute);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Read a list of times in order, carrying anything that goes backwards past midnight. */
function orderedMinutes(times: readonly string[]): number[] {
  let prev = -Infinity;
  return times.map(text => {
    let m = hhmmToMinutes(text);
    if (m < prev) m += MIDNIGHT;
    if (m > PASS_OUT) throw new Error(`Time "${text}" runs past 26:00`);
    prev = m;
    return m;
  });
}

const block = (startMin: number, endMin: number, action: PlanAction, place: string, withIds: string[], note: string): DayPlanBlock => ({
  start: minutesToHhmm(startMin), end: minutesToHhmm(endMin), action, place, with: withIds, note, startMin, endMin
});

/** Routine starts → blocks. Each block ends when the next starts; the last (sleep) runs to 26:00. */
export function blocksFromRoutine(routine: readonly RoutineBlock[]): DayPlanBlock[] {
  const starts = orderedMinutes(routine.map(b => b.at));
  return routine.map((b, i) =>
    block(starts[i]!, i + 1 < routine.length ? starts[i + 1]! : Math.max(PASS_OUT, starts[i]!), b.do, b.where, b.with ?? [], ''));
}

/** A live plan from the mind (§9.17) → executor blocks. Its own ends are kept. */
export function blocksFromPlanOutput(blocks: PlanOutput['blocks']): DayPlanBlock[] {
  const starts = orderedMinutes(blocks.map(b => b.start));
  return blocks.map((b, i) => {
    let end = hhmmToMinutes(b.end);
    while (end < starts[i]! && end + MIDNIGHT <= PASS_OUT) end += MIDNIGHT;
    return block(starts[i]!, Math.max(end, starts[i]!), b.action, b.place, b.with, b.note);
  });
}

/** The template plan for one resident on one weekday. Last night is yesterday's routine's last block. */
export function dayPlan(card: RoutineCard, day: Weekday): DayPlan {
  const blocks = blocksFromRoutine(routineFor(card, day));
  const yesterday = routineFor(card, previousWeekday(day));
  const last = yesterday[yesterday.length - 1]!;
  return {
    resident: card.id, weekday: day, routine: routineKind(day), outdoors: card.kind === 'animal',
    startPlace: last.where, startAction: last.do, blocks
  };
}

/** Template plans for a game day (Day 1 is a Tuesday, §3.2). */
export const dayPlansFor = (cards: readonly RoutineCard[], gameDay: number): DayPlan[] =>
  cards.map(card => dayPlan(card, weekdayOf(gameDay)));

const WEEK: readonly Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const previousWeekday = (day: Weekday): Weekday => WEEK[(WEEK.indexOf(day) + 6) % 7]!;

/** FNV-1a: a stable 32-bit hash for seeding per-resident choices. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * A copy of a plan under a new resident id with every start nudged by up to ±maxShift minutes
 * (deterministic in `seed`). Order is kept, starts stay at least 5 minutes apart, and nothing moves
 * past 26:00. Used for synthetic crowds (the W-05 soak's 30 residents, `?npcs=` in the game).
 */
export function jitterPlan(plan: DayPlan, id: string, seed: string, maxShift = 20): DayPlan {
  const rng = new Rng(hashString(seed));
  const starts: number[] = [];
  plan.blocks.forEach((b, i) => {
    const shifted = b.startMin + Math.round((rng.next() * 2 - 1) * maxShift);
    const floor = i === 0 ? -Infinity : starts[i - 1]! + 5;
    starts.push(Math.max(0, Math.min(PASS_OUT - 5 * (plan.blocks.length - i), Math.max(floor, shifted))));
  });
  const blocks = plan.blocks.map((b, i) =>
    block(starts[i]!, i + 1 < starts.length ? starts[i + 1]! : Math.max(PASS_OUT, starts[i]!), b.action, b.place, b.with, b.note));
  return { ...plan, resident: id, blocks };
}

/**
 * `n` plans built from `base`: copies cycle through the base plans with jittered times. With
 * `keepOriginals`, the base plans come first unchanged and only the extras are jittered.
 */
export function syntheticPlans(base: readonly DayPlan[], n: number, keepOriginals = false): DayPlan[] {
  return Array.from({ length: n }, (_, k) => {
    const src = base[k % base.length]!;
    if (keepOriginals && k < base.length) return src;
    return jitterPlan(src, `${src.resident}_${k}`, `${src.resident}#${k}`);
  });
}
