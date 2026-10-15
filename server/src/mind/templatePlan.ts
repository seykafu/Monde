/**
 * Template plans (GDD §9.7, §9.8 lag tolerance, §9.14 Quiet Mode): a resident's persona routine turned into a
 * PlanOutput-shaped day. It is the plan whenever the model's is missing or invalid, and the plan Ambient residents
 * get every day.
 *
 * It must match the client's routine executor (client/src/sim/plans.ts, `blocksFromRoutine`), so a dawn package
 * and an offline client build the same day:
 *   - weekday routine Mon-Fri, weekend routine Sat-Sun; Day 1 is a Tuesday (context.weekdayOf);
 *   - each block runs from its `at` to the next block's `at`, and the last one (sleep) runs to 26:00;
 *   - times read in order, so one earlier than the one before it is after midnight ("00:30" after "23:00" is
 *     24:30); times before 06:00 at the head of a routine are that morning (Odile is at her ovens from 04:00).
 * Plan times are "HH:MM" with hours past midnight written on as 24:xx-26:00, as the client parses them.
 *
 * Pure: no I/O.
 */
import type { PersonaCard, PlanOutput, RoutineBlock, Verb } from "@monde/shared";
import { weekdayOf } from "./context.js";

/** §5.2: the day starts at 06:00 and the player passes out at 26:00 (02:00). Minutes since midnight. */
export const DAY_START = 6 * 60;
export const MIDNIGHT = 24 * 60;
export const PASS_OUT = 26 * 60;

export type RoutineCard = Pick<PersonaCard, "id" | "kind" | "routine">;
export type PlanBlock = PlanOutput["blocks"][number];
/** A plan block with its times in clock minutes. */
export interface TimedBlock extends PlanBlock { startMin: number; endMin: number }

export const isWeekend = (day: number): boolean => ["Sat", "Sun"].includes(weekdayOf(day));
export const routineKind = (day: number): "weekday" | "weekend" => (isWeekend(day) ? "weekend" : "weekday");
export const routineFor = (card: RoutineCard, day: number): readonly RoutineBlock[] => card.routine[routineKind(day)];

/** "25:30" → 1530, "04:00" → 240. Throws on anything that isn't HH:MM between 00:00 and 26:00. */
export function hhmmToMinutes(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Bad time "${text}": expected HH:MM`);
  const total = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59 || total > PASS_OUT) throw new Error(`Bad time "${text}": the day ends at 26:00`);
  return total;
}

/** 1530 → "25:30" (hours past midnight stay 24-26). */
export function minutesToHhmm(minute: number): string {
  const m = Math.round(minute);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Routine verbs → plan verbs. GDD-GAP: Bastien's `follow` and `beg` (§9.7) aren't in the PlanOutput verb enum;
 * shared/verbs.ts describes `follow` as a wander toward a person and `beg` as sitting near food with intent, so
 * the plan carries those. No current routine uses either.
 */
export function planVerb(action: RoutineBlock["do"]): Verb {
  if (action === "follow") return "wander";
  if (action === "beg") return "sit";
  return action;
}

/** Read starts in order, carrying anything that goes backwards past midnight (the client's orderedMinutes). */
function orderedMinutes(times: readonly string[]): number[] {
  let previous = -Infinity;
  return times.map((text) => {
    let minute = hhmmToMinutes(text);
    if (minute < previous) minute += MIDNIGHT;
    if (minute > PASS_OUT) throw new Error(`Time "${text}" runs past 26:00`);
    previous = minute;
    return minute;
  });
}

export function timedBlock(startMin: number, endMin: number, action: Verb, place: string, withIds: readonly string[], note: string): TimedBlock {
  return { start: minutesToHhmm(startMin), end: minutesToHhmm(endMin), action, place, with: [...withIds], note, startMin, endMin };
}

/** The routine for `day` as contiguous blocks: each ends when the next starts, the last runs to 26:00. */
export function routineBlocks(card: RoutineCard, day: number): TimedBlock[] {
  const routine = routineFor(card, day);
  const starts = orderedMinutes(routine.map((b) => b.at));
  return routine.map((b, i) => timedBlock(
    starts[i]!, i + 1 < routine.length ? starts[i + 1]! : Math.max(PASS_OUT, starts[i]!),
    planVerb(b.do), b.where, b.with ?? [], "",
  ));
}

/** Where and how the resident spent the night before `day`: yesterday's last routine block (the client's startPlace). */
export function overnight(card: RoutineCard, day: number): { action: Verb; place: string } {
  const yesterday = routineFor(card, day - 1);
  const last = yesterday[yesterday.length - 1]!;
  return { action: planVerb(last.do), place: last.where };
}

const strip = ({ startMin: _s, endMin: _e, ...block }: TimedBlock): PlanBlock => block;

/** The template plan for one resident on one game day. No whim, barks, seek_player or intentions. */
export function templatePlan(card: RoutineCard, day: number): PlanOutput {
  return { blocks: routineBlocks(card, day).map(strip), whim: null, barks: [], seek_player: null, intentions: [] };
}

export const withoutMinutes = (blocks: readonly TimedBlock[]): PlanBlock[] => blocks.map(strip);
