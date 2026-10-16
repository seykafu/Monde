import { evaluate, gameContext, type CompiledScene, type ExprContext } from "@monde/shared";
import type { FlagStore } from "./flags";

export interface StoryContext {
  day: number;
  /** Minutes since the start of this game day, including 24:00–26:00 (§5.3). */
  minute: number;
  weekday: string;
  zone: string;
  place: string;
  pillar: Record<string, number>;
  regard: Record<string, number>;
  /** Additional expression/interpolation values: player, appeal, ferry_day, outcomes, etc. */
  values?: Record<string, unknown>;
  asleep?: boolean;
  inScuffle?: boolean;
}

export function expressionContext(context: StoryContext, flags: FlagStore): ExprContext {
  const player = context.values?.player;
  return gameContext({ flags: flags.snapshot(), values: {
    ...context.values, day: context.day, minute: context.minute, weekday: context.weekday,
    pillar: context.pillar, regard: context.regard,
    player: { ...(typeof player === "object" && player !== null ? player : {}), zone: context.zone, place: context.place },
  } });
}

export const minutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
};

/** Appointments summoned by §13.3 (and G-11's Straw Poll at the fair's close); the host supplies confirmation and travel. */
export function isSummoned(scene: CompiledScene): boolean {
  return ["s10a_bloom_open", "s10b_bloom_close", "s10c_straw_poll", "s11_station"].includes(scene.id);
}

export function sceneDone(scene: CompiledScene, flags: FlagStore, completed: ReadonlySet<string>): boolean {
  if (completed.has(scene.id)) return true;
  // Header sets is a manifest, not an instruction to apply every possible branch effect.
  return !!scene.header?.sets.some((flag) => /^s\d{2}[a-z]?_done$/.test(flag) && flags.has(flag));
}

/** Calendar beat order, then lettered parts; early S07a remains eligible on D6. */
export function calendarOrder(a: CompiledScene, b: CompiledScene): number {
  return a.id.localeCompare(b.id, "en", { numeric: true });
}

export function eligibleScenes(
  scenes: readonly CompiledScene[], context: StoryContext, flags: FlagStore,
  completed: ReadonlySet<string> = new Set(),
): CompiledScene[] {
  if (context.asleep || context.inScuffle) return [];
  return scenes.filter((scene) => {
    const h = scene.header;
    if (!h || h.calledFrom || sceneDone(scene, flags, completed) || context.day < h.day) return false;
    // GDD-GAP: window endpoint inclusivity is unspecified; use [start, end) to avoid overlap.
    if (context.minute < minutes(h.time.start) || context.minute >= minutes(h.time.end)) return false;
    if (!isSummoned(scene) && context.place !== h.place) return false;
    return evaluate(h.trigger, expressionContext(context, flags));
  }).sort(calendarOrder);
}
