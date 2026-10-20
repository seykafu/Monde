import { budgetMind } from "./budget.js";
/**
 * Tomorrow's plan (GDD §9.7 step 2, §9.17 Plan; MVP M-07).
 *
 *   routine + needs + forecast + tomorrow's town events + open places + the verb list
 *     → buildPlanRequest (effort "low", no sampling params) → callModel (deadline, stop_reason check)
 *     → validatePlan → the `plans` row for Day N + 1 (source "model"), with an ai_log row.
 * Anything that fails (no key, timeout, refusal, max_tokens, API error, a malformed or overlapping timetable)
 * stores the template plan instead (source "template"), which is what the client's executor would run anyway.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ANIMAL_VERBS, PlanOutput, VERBS, clamp, type PersonaCard, type Verb } from "@monde/shared";
import { aiLog, plans } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { callModel, type CallFailure, type ModelCall } from "./callModel.js";
import { loadResidentPrefix, weekdayOf } from "./context.js";
import type { CallRecord } from "./dialogue.js";
import { lexicalHits } from "./filters.js";
import { nightLogRow, type NightJobDeps, type NightWorld } from "./nightJob.js";
import { openPlacesFor } from "./places.js";
import { apiParams, buildPlanRequest, promptVersion } from "./promptBuilder.js";
import {
  MIDNIGHT, PASS_OUT, minutesToHhmm, overnight, routineBlocks, templatePlan, timedBlock, withoutMinutes,
  type RoutineCard, type TimedBlock,
} from "./templatePlan.js";

/** §9.17: "Change at most 2 blocks". */
export const MAX_CHANGES = 2;
/** §9.7: up to 3 barks. */
export const MAX_BARKS = 3;
/** PlanOutput: seek_player urgency runs 0 to 3. */
export const MAX_URGENCY = 3;
// GDD-GAP: §9.17 sets no lengths for plan text. Barks are spoken aloud, so they stay one short line; notes,
// topics and intentions are for the engine and the next plan prompt.
const BARK_CHARS = 140;
const NOTE_CHARS = 120;
const TOPIC_CHARS = 120;
const INTENTION_CHARS = 140;
const MAX_INTENTIONS = 5;

/** Verbs a plan may use: the animal subset for animals (matches promptBuilder's list for the prompt). */
export function planVerbs(card: Pick<PersonaCard, "kind">): readonly Verb[] {
  if (card.kind !== "animal") return VERBS;
  return VERBS.filter((verb) => (ANIMAL_VERBS as readonly string[]).includes(verb));
}

/**
 * A model time → clock minutes, regardless of block order: 00:00-02:00 are after midnight (24:00-26:00, the end
 * of the game day), anything later is that morning or day. Null if unparseable or past 26:00.
 */
/** An evening block (from 18:00) whose end is a morning time (up to noon) means "through the night" (validatePlan). */
const OVERNIGHT_FROM = 18 * 60, OVERNIGHT_UNTIL = 12 * 60;

export function modelMinutes(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const minutes = Number(m[2]);
  let total = Number(m[1]) * 60 + minutes;
  if (minutes > 59) return null;
  if (total <= PASS_OUT - MIDNIGHT) total += MIDNIGHT;
  return total > PASS_OUT ? null : total;
}

/** The plan as the model may have written it: verbs are checked block by block, not by the schema. */
const LoosePlan = z.object({
  blocks: z.array(z.object({
    start: z.string(), end: z.string(), action: z.string(), place: z.string(), with: z.array(z.string()), note: z.string(),
  })),
  whim: z.object({ at: z.string(), action: z.string(), place: z.string(), reason: z.string() }).nullable(),
  barks: z.array(z.string()),
  seek_player: z.object({ topic: z.string(), urgency: z.number() }).nullable(),
  intentions: z.array(z.string()),
});

export interface PlanValidationContext {
  card: RoutineCard;
  /** The day the plan is for (tomorrow). */
  day: number;
  /** Registered place ids. */
  places: ReadonlySet<string>;
  /** Every resident id in the world (for `with`). */
  residentIds: ReadonlySet<string>;
}

export type PlanValidationCategory = "schema" | "empty" | "times" | "overlap";
export type PlanValidation =
  | { ok: true; plan: PlanOutput; changed: number; adjustments: string[] }
  | { ok: false; category: PlanValidationCategory; detail: string };

type Origin = "model" | "routine";
type Segment = TimedBlock & { origin: Origin };

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
const sameWith = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join() === [...b].sort().join();

/** Join neighbours that do the same thing at the same place with the same people. The first note wins. */
function mergeAdjacent(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.endMin === s.startMin && prev.action === s.action && prev.place === s.place && sameWith(prev.with, s.with)) {
      out[out.length - 1] = {
        ...timedBlock(prev.startMin, s.endMin, prev.action, prev.place, prev.with, prev.note || s.note),
        origin: prev.origin === "model" || s.origin === "model" ? "model" : "routine",
      };
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Check one plan against the routine and the registry. Hard failures (unparseable JSON, no blocks, bad times,
 * overlapping blocks) reject the whole plan, and the caller stores the template. Everything else is repaired:
 *   - blocks are sorted by start; gaps, and the stretch before the first block or after the last one, are filled
 *     from the routine, so the plan covers the day from the routine's first block (or earlier) to 26:00;
 *   - a block with a verb the resident can't use or an unregistered place is replaced by the routine over its time;
 *   - a block that isn't exactly a routine block (same start, end, verb and place, after joining neighbours that do
 *     the same thing) is a change: the first 2 are kept, the rest revert to the routine;
 *   - `with` keeps only other residents of this world; notes, barks, topics and intentions go through the lexical
 *     filters; at most 3 barks; seek_player urgency is clamped to 0..3; a whim needs a known verb and place and a
 *     time inside the day, or it's dropped.
 */
export function validatePlan(raw: string, ctx: PlanValidationContext): PlanValidation {
  const fail = (category: PlanValidationCategory, detail: string): PlanValidation => ({ ok: false, category, detail });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return fail("schema", `not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = LoosePlan.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("schema", issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid");
  }
  const loose = parsed.data;
  // No blocks is "keep my routine" (the plan lists only its changes): the gaps below fill the whole day.

  const adjustments: string[] = [];
  const template = routineBlocks(ctx.card, ctx.day);
  const night = overnight(ctx.card, ctx.day);
  const verbs = new Set<string>(planVerbs(ctx.card));
  const clean = (text: string, what: string, limit: number, cut = false): string => {
    const line = oneLine(text);
    if (!line) return "";
    const hit = lexicalHits(line)[0];
    if (hit) { adjustments.push(`${what} dropped (lexical:${hit.group})`); return ""; }
    if (line.length <= limit) return line;
    if (cut) return line.slice(0, limit).trim();
    adjustments.push(`${what} dropped (too long)`);
    return "";
  };

  // Times.
  type LooseBlock = z.infer<typeof LoosePlan>["blocks"][number];
  const timed: (LooseBlock & { startMin: number; endMin: number; index: number })[] = [];
  for (const [index, b] of loose.blocks.entries()) {
    const startMin = modelMinutes(b.start);
    let endMin = modelMinutes(b.end);
    // An evening block that runs into the next morning ("21:30-06:00", sleep) ends when the plan's day does (02:00):
    // the model writes tomorrow's wake time. 17% of plans were thrown away for it (soak, 2026-10-19).
    if (startMin !== null && endMin !== null && endMin <= startMin && startMin >= OVERNIGHT_FROM && endMin <= OVERNIGHT_UNTIL) {
      endMin = PASS_OUT;
      adjustments.push(`block ${index} ends at 02:00 (was ${b.end})`);
    }
    if (startMin === null || endMin === null || endMin <= startMin) return fail("times", `block ${index}: ${b.start}-${b.end}`);
    timed.push({ ...b, startMin, endMin, index });
  }
  const sorted = [...timed].sort((a, b) => a.startMin - b.startMin || a.index - b.index);
  if (sorted.some((b, i) => b !== timed[i])) adjustments.push("blocks sorted by start");
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.startMin < sorted[i - 1]!.endMin) {
      return fail("overlap", `${sorted[i - 1]!.start}-${sorted[i - 1]!.end} and ${sorted[i]!.start}-${sorted[i]!.end}`);
    }
  }

  /** What the routine has the resident doing over [from, to): clipped routine blocks, or last night's place before them. */
  const routineOver = (from: number, to: number): Segment[] => {
    const out: Segment[] = [];
    const first = template[0]!.startMin;
    if (from < first) out.push({ ...timedBlock(from, Math.min(to, first), night.action, night.place, [], ""), origin: "routine" });
    for (const t of template) {
      const lo = Math.max(from, t.startMin);
      const hi = Math.min(to, t.endMin);
      if (lo < hi) out.push({ ...timedBlock(lo, hi, t.action, t.place, t.with, ""), origin: "routine" });
    }
    return out;
  };

  // Blocks, with the gaps filled and the impossible ones swapped for the routine.
  const segments: Segment[] = [];
  let cursor = Math.min(sorted[0]?.startMin ?? Infinity, template[0]!.startMin);
  for (const b of sorted) {
    if (b.startMin > cursor) {
      adjustments.push(`${minutesToHhmm(cursor)}-${minutesToHhmm(b.startMin)} filled from the routine`);
      segments.push(...routineOver(cursor, b.startMin));
    }
    const problem = !verbs.has(b.action) ? `verb ${b.action}` : !ctx.places.has(b.place) ? `place ${b.place}` : null;
    if (problem) {
      adjustments.push(`${b.start}-${b.end}: ${problem} not allowed, routine kept`);
      segments.push(...routineOver(b.startMin, b.endMin));
    } else {
      const withIds = [...new Set(b.with)].filter((id) => id !== ctx.card.id && ctx.residentIds.has(id));
      if (withIds.length !== b.with.length) adjustments.push(`${b.start}-${b.end}: unknown companions dropped`);
      const note = clean(b.note, "note", NOTE_CHARS, true);
      segments.push({ ...timedBlock(b.startMin, b.endMin, b.action as Verb, b.place, withIds, note), origin: "model" });
    }
    cursor = b.endMin;
  }
  if (cursor < PASS_OUT) {
    adjustments.push(`${minutesToHhmm(cursor)}-26:00 filled from the routine`);
    segments.push(...routineOver(cursor, PASS_OUT));
  }

  // At most 2 changes against the routine.
  const merged = mergeAdjacent(segments);
  const isRoutine = (s: Segment) => template.some((t) =>
    t.startMin === s.startMin && t.endMin === s.endMin && t.action === s.action && t.place === s.place);
  const changes = merged.filter((s) => s.origin === "model" && !isRoutine(s));
  const reverted = new Set(changes.slice(MAX_CHANGES));
  if (reverted.size) adjustments.push(`${changes.length} changed blocks; kept the first ${MAX_CHANGES}`);
  const blocks = mergeAdjacent(merged.flatMap((s) => (reverted.has(s) ? routineOver(s.startMin, s.endMin) : [s])));

  // The whim.
  let whim: PlanOutput["whim"] = null;
  if (loose.whim) {
    const at = modelMinutes(loose.whim.at);
    const reason = clean(loose.whim.reason, "whim reason", NOTE_CHARS, true);
    if (at === null || at < blocks[0]!.startMin || at >= PASS_OUT) adjustments.push(`whim at ${loose.whim.at} dropped`);
    else if (!verbs.has(loose.whim.action)) adjustments.push(`whim verb ${loose.whim.action} dropped`);
    else if (!ctx.places.has(loose.whim.place)) adjustments.push(`whim place ${loose.whim.place} dropped`);
    else if (reason) whim = { at: minutesToHhmm(at), action: loose.whim.action as Verb, place: loose.whim.place, reason };
  }

  const barks = loose.barks.map((bark) => clean(bark, "bark", BARK_CHARS)).filter(Boolean);
  if (barks.length > MAX_BARKS) adjustments.push(`barks cut to ${MAX_BARKS}`);

  let seek: PlanOutput["seek_player"] = null;
  if (loose.seek_player) {
    const topic = clean(loose.seek_player.topic, "seek_player topic", TOPIC_CHARS, true);
    const urgency = Math.round(clamp(loose.seek_player.urgency, 0, MAX_URGENCY));
    if (urgency !== loose.seek_player.urgency) adjustments.push(`seek_player urgency ${loose.seek_player.urgency}→${urgency}`);
    seek = topic ? { topic, urgency } : null;
  }

  const intentions: string[] = [];
  for (const text of loose.intentions) {
    const line = clean(text, "intention", INTENTION_CHARS);
    if (line && !intentions.some((i) => i.toLowerCase() === line.toLowerCase())) intentions.push(line);
  }
  if (intentions.length > MAX_INTENTIONS) adjustments.push(`intentions cut to ${MAX_INTENTIONS}`);

  const plan = PlanOutput.parse({
    blocks: withoutMinutes(blocks), whim, barks: barks.slice(0, MAX_BARKS), seek_player: seek,
    intentions: intentions.slice(0, MAX_INTENTIONS),
  });
  return { ok: true, plan, changed: Math.min(changes.length, MAX_CHANGES), adjustments };
}

// ---------------------------------------------------------------------------------------------------------------
// Persistence and the job
// ---------------------------------------------------------------------------------------------------------------

interface StoreArgs {
  worldId: string;
  residentId: string;
  day: number;
  plan: PlanOutput;
  source: "model" | "template";
  /** The prompt version of the call that made (or failed to make) this plan; null when no call was made. */
  promptVersion: string | null;
  call: CallRecord | null;
}

export async function storePlan(db: WorldDatabase, args: StoreArgs): Promise<void> {
  const { worldId, residentId, day, plan, source } = args;
  await db.transaction(async (tx) => {
    await tx.insert(plans).values({ worldId, residentId, day, plan, source, promptVersion: args.promptVersion })
      .onConflictDoUpdate({ target: [plans.worldId, plans.residentId, plans.day], set: { plan, source, promptVersion: args.promptVersion } });
    if (args.call) {
      await tx.insert(aiLog).values(nightLogRow(worldId, residentId, "plan", args.promptVersion ?? promptVersion(), args.call, source === "template"));
    }
  });
}

export interface PlanResult {
  source: "model" | "template";
  /** "ok", "template" (no model plan was asked for), or why the template replaced the model's plan. */
  reason: "ok" | "template" | CallFailure | PlanValidationCategory;
  changed: number;
  adjustments: string[];
}

/** Prepare the prompt and shared validation/persistence path for a separate or combined call. */
export async function preparePlan(deps: NightJobDeps, world: NightWorld, residentId: string) {
  const { db } = deps;
  const prefix = await loadResidentPrefix(db, world.worldId, residentId);
  if (!prefix) return null;
  const { card } = prefix;
  const day = world.day + 1;
  const template = templatePlan(card, day);
  const base = { worldId: world.worldId, residentId, day };

  const version = promptVersion();
  const fallback = async (reason: PlanResult["reason"], call: CallRecord | null, detail?: unknown): Promise<PlanResult> => {
    deps.log.warn({ residentId, day, reason, detail }, "plan fell back to the routine template");
    await storePlan(db, { ...base, plan: template, source: "template", promptVersion: version, call });
    return { source: "template", reason, changed: 0, adjustments: [] };
  };

  const [today] = await db.select({ plan: plans.plan }).from(plans)
    .where(and(eq(plans.worldId, world.worldId), eq(plans.residentId, residentId), eq(plans.day, world.day)));
  const request = buildPlanRequest({
    card, state: prefix.state, relationships: prefix.relationships, flags: world.flags, names: prefix.names, voices: prefix.voices,
    day: world.day, tomorrowWeekday: weekdayOf(day), forecast: world.forecast, events: world.eventsTomorrow,
    intentions: today?.plan.intentions ?? [], openPlaces: openPlacesFor(world.places, card), fellow: world.fellow,
  });
  return { request, finish: async (result: ModelCall): Promise<PlanResult> => {
    if (!result.ok) return fallback(result.failure, result.call, result.error instanceof Error ? result.error.message : undefined);

    const validated = validatePlan(result.text, { card, day, places: world.places.ids, residentIds: world.residentIds });
    if (!validated.ok) return fallback(validated.category, { ...result.call, validation: validated.category }, validated.detail);

    await storePlan(db, { ...base, plan: validated.plan, source: "model", promptVersion: version, call: result.call });
    if (validated.adjustments.length) deps.log.info({ residentId, day, adjustments: validated.adjustments }, "plan adjusted");
    return { source: "model", reason: "ok", changed: validated.changed, adjustments: validated.adjustments };
  } };
}

/**
 * Plan Day `world.day + 1` for one resident and store it. With `model: false` (or no key) the template is stored
 * without a call. Null if the resident doesn't exist. Throws only on database errors.
 */
export async function planResident(deps: NightJobDeps, world: NightWorld, residentId: string, options: { model: boolean }): Promise<PlanResult | null> {
  if (!options.model || !deps.mind.enabled) {
    const prefix = await loadResidentPrefix(deps.db, world.worldId, residentId);
    if (!prefix) return null;
    await storePlan(deps.db, { worldId: world.worldId, residentId, day: world.day + 1,
      plan: templatePlan(prefix.card, world.day + 1), source: "template", promptVersion: null, call: null });
    return { source: "template", reason: options.model ? "unavailable" : "template", changed: 0, adjustments: [] };
  }
  const prepared = await preparePlan(deps, world, residentId);
  if (!prepared) return null;
  const result = await callModel(budgetMind(deps.db, deps.mind, world.worldId, residentId, "plan", world.day), apiParams("plan", prepared.request), {
    timeoutMs: deps.callTimeoutMs, signal: deps.signal, gate: deps.gate, now: deps.now,
  });
  return prepared.finish(result);
}
