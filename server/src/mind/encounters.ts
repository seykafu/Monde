import { budgetMind } from "./budget.js";
/**
 * Resident ↔ resident encounters in the night pass (GDD §9.11.3 "Encounters"; MVP G-13).
 *
 *   Day N's plans (the stored plan, else the routine template)
 *     → findMeetings: pairs at the same place in overlapping blocks (30+ minutes, or any overlap when one of them
 *       named the other in that block's `with`), asleep doesn't count
 *     → chooseEncounters: a seeded roll per world + day + pair against encounterChance (shared/friendship.ts),
 *       at most 3 encounters per resident, Core pairs first
 *     → resolveEncounter: Core/Acquainted pairs get one summary-mode Gossip call (no lines, only effects) through
 *       the world's semaphore; Ambient pairs, calls over the night's cap, and any call that fails take the Ambient
 *       rule. Then one transaction: affinity (±3 an encounter, +1 for planned time together, inside the pair's ±6
 *       a day), trust, a feeling (romance only between residents who may court), last_seen_day, the encounter
 *       count, a short memory for each side (tonight's reflection reads it) and the ai_log row.
 * Live chats share persistEncounter; the memory receipt prevents a second encounter in the night pass.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  AFFINITY_SOURCES, BIRTHDAY_PARTY, CAFE_DATE, GossipOutput, ROMANTIC_FEELINGS, ambientEncounterDelta, applyAffinity, clamp, clampGossip,
  encounterChance, encounterRoll, orderedPair, pairKey, pairMean, pairLabel, tieMilestone,
  type PersonaCard, type PlanOutput, type ResidentState,
} from "@monde/shared";
import { aiLog, memories, relationships, tieMilestones } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { callModel, type CallFailure } from "./callModel.js";
import { weekdayOf } from "./context.js";
import type { CallRecord } from "./dialogue.js";
import { nightLogRow, type NightJobDeps } from "./nightJob.js";
import { apiParams, buildGossipRequest, promptVersion, type RelationshipView } from "./promptBuilder.js";
import { applyFeeling, type FeelingKind } from "./reflect.js";
import { hhmmToMinutes } from "./templatePlan.js";
import type { Tier } from "./tiers.js";

/** GDD-GAP: §9.11.3 doesn't bound encounters per resident; 3 a day keeps a busy market from flooding one evening. */
export const ENCOUNTERS_PER_RESIDENT = 3;
/** GDD-GAP: §9.15 budgets 80 summary-mode gossips a day; past that, encounters take the Ambient rule. */
export const MODEL_ENCOUNTERS_PER_NIGHT = 80;
/** GDD-GAP: "the same place" needs a duration; half an hour together is a meeting, a nod in passing isn't. */
export const MIN_OVERLAP_MINUTES = 30;
/** Asleep or napping at the same address (June and Ines at the pub rooms) isn't meeting. */
const APART_VERBS: ReadonlySet<string> = new Set(["sleep", "nap"]);
/** Up to this many of each side's notable memories of the day go into the prompt as news. */
export const NEWS_PER_SIDE = 3;
/** GDD-GAP: stop at importance 1 instead of circulating minimum-importance news forever. */
export const NEWS_IMPORTANCE = 2;

export const TIER_ORDER: Readonly<Record<Tier, number>> = { core: 0, acquainted: 1, ambient: 2 };

// ---------------------------------------------------------------------------------------------------------------
// Who meets (pure)
// ---------------------------------------------------------------------------------------------------------------

export interface DayPlan { residentId: string; blocks: readonly PlanOutput["blocks"][number][] }

export interface Meeting {
  /** Ids in order (a < b). */
  a: string;
  b: string;
  place: string;
  /** When the overlap starts (minutes since midnight). */
  minute: number;
  /** Minutes they share at `place`. */
  overlap: number;
  /** One of them named the other in the block they shared (`with`): planned time together. */
  planned: boolean;
}

interface Interval { resident: string; start: number; end: number; with: ReadonlySet<string> }

const minutes = (text: string): number | null => {
  try { return hhmmToMinutes(text); } catch { return null; }
};

/** Prefer the planned meeting, then the longer one, then the earlier one. */
const better = (x: Meeting, y: Meeting): boolean =>
  x.planned !== y.planned ? x.planned : x.overlap !== y.overlap ? x.overlap > y.overlap : x.minute < y.minute;

/**
 * Every pair whose plans put them at the same place at the same time: planned (named in `with`) with any overlap,
 * otherwise for 30 minutes or more. One meeting per pair, at the place that mattered most.
 */
export function findMeetings(plans: readonly DayPlan[], minOverlap = MIN_OVERLAP_MINUTES): Meeting[] {
  const byPlace = new Map<string, Interval[]>();
  for (const plan of plans) {
    for (const block of plan.blocks) {
      if (APART_VERBS.has(block.action) || block.place.startsWith("offmap.")) continue;
      const start = minutes(block.start);
      const end = minutes(block.end);
      if (start === null || end === null || end <= start) continue;
      let list = byPlace.get(block.place);
      if (!list) { list = []; byPlace.set(block.place, list); }
      list.push({ resident: plan.residentId, start, end, with: new Set(block.with) });
    }
  }
  const best = new Map<string, Meeting>();
  for (const [place, list] of byPlace) {
    list.sort((x, y) => x.start - y.start || x.end - y.end || (x.resident < y.resident ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      const x = list[i]!;
      for (let j = i + 1; j < list.length && list[j]!.start < x.end; j++) {
        const y = list[j]!;
        if (x.resident === y.resident) continue;
        const overlap = Math.min(x.end, y.end) - Math.max(x.start, y.start);
        if (overlap <= 0) continue;
        const [a, b] = orderedPair(x.resident, y.resident);
        const meeting: Meeting = {
          a, b, place, minute: Math.max(x.start, y.start), overlap, planned: x.with.has(y.resident) || y.with.has(x.resident),
        };
        const key = pairKey(a, b);
        const seen = best.get(key);
        if (!seen || better(meeting, seen)) best.set(key, meeting);
      }
    }
  }
  return [...best.values()]
    .filter((m) => m.planned || m.overlap >= minOverlap)
    .sort((x, y) => (pairKey(x.a, x.b) < pairKey(y.a, y.b) ? -1 : 1));
}

/** A scheduled outing as the night reads it: a town event of type `date` (a pair) or `birthday_party` (host first). */
export interface ScheduledOuting { type: string; minute: number; wherePlace: string; who: readonly string[] }

/**
 * Engine-scheduled time together on the day (G-12): a courting pair's café date (shared romance.ts CAFE_DATE) and a
 * birthday party, host with each guest (BIRTHDAY_PARTY). The engine put them there, so they are planned meetings
 * whatever the plans say. Residents not in town are left out.
 */
export function scheduledMeetings(outings: readonly ScheduledOuting[], present: ReadonlySet<string>): Meeting[] {
  const out: Meeting[] = [];
  // A café date first: a couple at a birthday party the same day still met at the café (mergeMeetings keeps the first).
  const order = [...outings].sort((x, y) => Number(y.type === "date") - Number(x.type === "date") || x.minute - y.minute);
  for (const o of order) {
    const minutes = o.type === "date" ? CAFE_DATE.minutes : o.type === "birthday_party" ? BIRTHDAY_PARTY.minutes : 0;
    const [host, ...guests] = o.who;
    if (!minutes || !host || !present.has(host)) continue;
    for (const guest of o.type === "date" ? guests.slice(0, 1) : guests) {
      if (guest === host || !present.has(guest)) continue;
      const [a, b] = orderedPair(host, guest);
      out.push({ a, b, place: o.wherePlace, minute: o.minute, overlap: minutes, planned: true });
    }
  }
  return out;
}

/**
 * The day's meetings with the scheduled ones folded in: one per pair. A scheduled outing takes the pair's meeting
 * unless the plans already had a better one (planned, longer, earlier); between two outings, the first listed.
 */
export function mergeMeetings(found: readonly Meeting[], scheduled: readonly Meeting[]): Meeting[] {
  const best = new Map(found.map((m) => [pairKey(m.a, m.b), m]));
  const outing = new Set<string>();
  for (const m of scheduled) {
    const key = pairKey(m.a, m.b);
    const seen = best.get(key);
    if (outing.has(key) || (seen && !better(m, seen))) continue;
    best.set(key, m);
    outing.add(key);
  }
  return [...best.values()].sort((x, y) => (pairKey(x.a, x.b) < pairKey(y.a, y.b) ? -1 : 1));
}

export interface Encounter extends Meeting {
  /** The pair's mean affinity when the night began (null: strangers). */
  mean: number | null;
  chance: number;
  roll: number;
  /** Who judges it: one summary-mode Gossip call, or the Ambient rule. */
  mode: "model" | "rule";
  /** Semaphore priority: the better-detailed side's tier (a Core resident's reflection waits on it). */
  priority: number;
}

export interface ChooseOptions {
  seed: number | string;
  day: number;
  /** The pair's mean affinity, or null if they've never met. */
  mean: (a: string, b: string) => number | null;
  tier: (id: string) => Tier;
  /** False with no API key: everything takes the rule. */
  modelEnabled: boolean;
  perResident?: number;
  modelCap?: number;
}

/**
 * Roll every meeting (seeded per world, day and pair, so a night replays the same), keep the ones that happen,
 * Core pairs first (then planned, known before strangers, the surest rolls), at most 3 per resident; pairs with
 * a Core or Acquainted side are model-judged up to the night's cap.
 */
export function chooseEncounters(meetings: readonly Meeting[], options: ChooseOptions): Encounter[] {
  const perResident = options.perResident ?? ENCOUNTERS_PER_RESIDENT;
  const modelCap = options.modelCap ?? MODEL_ENCOUNTERS_PER_NIGHT;
  const rank = (m: Meeting) => TIER_ORDER[options.tier(m.a)] + TIER_ORDER[options.tier(m.b)];
  const happened = meetings.flatMap((m) => {
    const mean = options.mean(m.a, m.b);
    const chance = encounterChance(mean, m.planned);
    const roll = encounterRoll(options.seed, options.day, m.a, m.b);
    return roll < chance ? [{ ...m, mean, chance, roll }] : [];
  });
  happened.sort((x, y) => rank(x) - rank(y)
    || Number(y.planned) - Number(x.planned)
    || Number(y.mean !== null) - Number(x.mean !== null)
    || x.roll - y.roll
    || (pairKey(x.a, x.b) < pairKey(y.a, y.b) ? -1 : 1));

  const count = new Map<string, number>();
  let models = 0;
  const chosen: Encounter[] = [];
  for (const m of happened) {
    if ((count.get(m.a) ?? 0) >= perResident || (count.get(m.b) ?? 0) >= perResident) continue;
    count.set(m.a, (count.get(m.a) ?? 0) + 1);
    count.set(m.b, (count.get(m.b) ?? 0) + 1);
    const ambientPair = options.tier(m.a) === "ambient" && options.tier(m.b) === "ambient";
    const model = options.modelEnabled && !ambientPair && models < modelCap;
    if (model) models++;
    chosen.push({
      ...m, mode: model ? "model" : "rule",
      priority: Math.min(TIER_ORDER[options.tier(m.a)], TIER_ORDER[options.tier(m.b)]),
    });
  }
  return chosen;
}

// ---------------------------------------------------------------------------------------------------------------
// Judging the encounter
// ---------------------------------------------------------------------------------------------------------------

export interface SideDelta { affinity: number; trust: number }
export interface EncounterOutcome {
  /** How a's view of b changes, and b's of a: −3..+3 each (§9.11.3). */
  a: SideDelta;
  b: SideDelta;
  /** A feeling change for one side, already checked against the romance rules. */
  feeling: { who: "a" | "b"; kind: FeelingKind; delta: number } | null;
  /** Ids of the news that changed hands (propagation itself is M-08). */
  news: string[];
}

export type EncounterValidation =
  | { ok: true; outcome: EncounterOutcome; adjustments: string[] }
  | { ok: false; category: "schema"; detail: string };

/**
 * Parse and clamp one summary-mode Gossip reply. Deltas are clamped to ±3 (clampGossip), lines are dropped (summary
 * mode has none), news ids must be ones offered, and a crush or love between residents who may not court (a child,
 * family, someone spoken for, an opt-out) is dropped.
 */
export function validateEncounter(raw: string, ctx: { offered: ReadonlySet<string>; romanceAllowed: boolean }): EncounterValidation {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, category: "schema", detail: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = GossipOutput.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, category: "schema", detail: issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid" };
  }
  const adjustments: string[] = [];
  const out = clampGossip(parsed.data);
  if (parsed.data.lines?.length) adjustments.push("lines dropped (summary mode)");
  let feeling = out.feeling_change;
  if (feeling && ROMANTIC_FEELINGS.has(feeling.kind) && !ctx.romanceAllowed) {
    adjustments.push(`${feeling.kind} dropped (romance rules)`);
    feeling = null;
  }
  const news = [...new Set(out.news_passed)].filter((id) => ctx.offered.has(id));
  if (news.length !== out.news_passed.length) adjustments.push("unknown news ids dropped");
  return { ok: true, adjustments, outcome: { a: out.a_delta, b: out.b_delta, feeling, news } };
}

/** The Ambient rule as an outcome: the same small step both ways, no trust, no feelings. */
export function ruleOutcome(valenceA: number, valenceB: number, mean: number | null): EncounterOutcome {
  const delta = ambientEncounterDelta(valenceA, valenceB, mean);
  return { a: { affinity: delta, trust: 0 }, b: { affinity: delta, trust: 0 }, feeling: null, news: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Memories (pure)
// ---------------------------------------------------------------------------------------------------------------

const OUTCOME_TEXT: Readonly<Record<string, string>> = {
  "-3": "It went badly.",
  "-2": "We got on each other's nerves.",
  "-1": "It was a little stiff.",
  "0": "Nothing much passed between us.",
  "1": "Pleasant enough.",
  "2": "We got on well.",
  "3": "It was the best part of the day.",
};

/** The memory one side keeps of an encounter (first person about self, third about the other, §9.6). */
export function encounterMemoryText(otherName: string, planned: boolean, change: number): string {
  const step = String(clamp(Math.round(change), -3, 3));
  return `${planned ? "Spent time with" : "Ran into"} ${otherName}. ${OUTCOME_TEXT[step]}`;
}

/**
 * GDD-GAP: §9.6 has no importance for meeting someone. An ordinary encounter is 3, one that moved how they feel by
 * 2 or more is 4: below the Acquainted reflection trigger (5, §9.8), so meeting someone never buys a reflection on
 * its own, but tonight's reflection sees it.
 */
export const encounterImportance = (change: number): number => (Math.abs(change) >= 2 ? 4 : 3);
export const encounterValence = (change: number): number => clamp(Math.round(change), -3, 3);
export const encounterMemoryId = (day: number, a: string, b: string, self: string): string => `met_${day}_${pairKey(a, b)}_${self}`;

// ---------------------------------------------------------------------------------------------------------------
// Resolving one encounter (I/O)
// ---------------------------------------------------------------------------------------------------------------

/** One side of an encounter as the night pass loaded it. */
export interface EncounterSide {
  card: PersonaCard;
  state: ResidentState;
  /** This side's view of the other when the night began, or null. */
  view: RelationshipView | null;
  /** What this side could tell the other: notable memories of the day. */
  news: readonly { id: string; text: string }[];
}

export interface EncounterContext {
  worldId: string;
  day: number;
  flags: readonly string[];
  names: Readonly<Record<string, string>>;
  romanceAllowed: boolean;
}

export interface EncounterResult {
  key: string;
  mode: "model" | "rule";
  /** "ok", or why the rule stood in for the model. */
  reason: "ok" | "rule" | CallFailure | "schema";
  /** Affinity actually applied, each direction (encounter + together, after the daily cap). */
  applied: { ab: number; ba: number };
  adjustments: string[];
}

/** Resolve one chosen encounter: the model (or the rule), then persist. Throws only on database errors. */
export async function resolveEncounter(
  deps: NightJobDeps, ctx: EncounterContext, encounter: Encounter, a: EncounterSide, b: EncounterSide,
): Promise<EncounterResult> {
  const key = pairKey(encounter.a, encounter.b);
  const [met] = await deps.db.select({ id: memories.id }).from(memories).where(and(
    eq(memories.worldId, ctx.worldId), eq(memories.id, encounterMemoryId(ctx.day, encounter.a, encounter.b, encounter.a)),
  ));
  if (met) return { key, mode: "rule", reason: "rule", applied: { ab: 0, ba: 0 }, adjustments: ["already met today"] };
  const propagated = [...a.news, ...b.news].map(n => n.id);
  const rule = () => ({ ...ruleOutcome(a.state.mood.valence, b.state.mood.valence, encounter.mean), news: propagated });
  if (encounter.mode === "rule" || !deps.mind.enabled) {
    const applied = await persistEncounter(deps.db, ctx, encounter, rule(), null, null);
    return { key, mode: "rule", reason: "rule", applied, adjustments: [] };
  }

  const version = promptVersion();
  const request = buildGossipRequest({
    a: { card: a.card, view: a.view, news: a.news }, b: { card: b.card, view: b.view, news: b.news },
    flags: ctx.flags, names: ctx.names, day: ctx.day, weekday: weekdayOf(ctx.day), minute: encounter.minute,
    place: encounter.place, mode: "summary",
  });
  const result = await callModel(budgetMind(deps.db, deps.mind, ctx.worldId, `${encounter.a}+${encounter.b}`, "gossip", ctx.day), apiParams("gossip", request), {
    timeoutMs: deps.callTimeoutMs, signal: deps.signal, gate: deps.gate, now: deps.now,
  });
  const fallback = async (reason: EncounterResult["reason"], call: CallRecord | null, detail?: unknown): Promise<EncounterResult> => {
    (reason === "unavailable" ? deps.log.info : deps.log.warn).call(deps.log, { pair: key, day: ctx.day, reason, detail },
      "encounter fell back to the Ambient rule");
    const applied = await persistEncounter(deps.db, ctx, encounter, rule(), call, version);
    return { key, mode: "rule", reason, applied, adjustments: [] };
  };
  if (!result.ok) return fallback(result.failure, result.call, result.error instanceof Error ? result.error.message : undefined);

  const offered = new Set([...a.news, ...b.news].map((n) => n.id));
  const validated = validateEncounter(result.text, { offered, romanceAllowed: ctx.romanceAllowed });
  if (!validated.ok) return fallback("schema", { ...result.call, validation: validated.category }, validated.detail);
  const applied = await persistEncounter(deps.db, ctx, encounter, { ...validated.outcome, news: [...new Set([...validated.outcome.news, ...propagated])] }, result.call, version, true);
  if (validated.adjustments.length) deps.log.info({ pair: key, day: ctx.day, adjustments: validated.adjustments }, "encounter adjusted");
  return { key, mode: "model", reason: "ok", applied, adjustments: validated.adjustments };
}

type RelationshipRow = typeof relationships.$inferSelect;

/**
 * One transaction: both directed rows (created at 0 if this is their first meeting), affinity under the daily cap,
 * trust, the feeling, last_seen_day and the encounter count; a memory for each side; the ai_log row. Rows are
 * locked in id order so two encounters can't deadlock.
 */
/** The news itself, without the "X told me: " a heard memory already carries (one teller per hop, never a chain). */
const heardText = (text: string): string => text.replace(/^[^:]{1,40} told me: /, "");

export async function persistEncounter(
  db: WorldDatabase, ctx: EncounterContext, encounter: Encounter, outcome: EncounterOutcome,
  call: CallRecord | null, version: string | null, model = false,
): Promise<{ ab: number; ba: number }> {
  const { worldId, day } = ctx;
  const { a, b } = encounter;
  const applied = { ab: 0, ba: 0 };
  await db.transaction(async (tx) => {
    // GDD-GAP: someone new in their life, as in reflect.ts: "acquaintance" until the card vocabulary says otherwise.
    await tx.insert(relationships).values([
      { worldId, fromId: a, toId: b, affinity: 0, trust: 0, tag: "acquaintance", note: "" },
      { worldId, fromId: b, toId: a, affinity: 0, trust: 0, tag: "acquaintance", note: "" },
    ]).onConflictDoNothing();
    const rows = await tx.select().from(relationships).where(and(
      eq(relationships.worldId, worldId), inArray(relationships.fromId, [a, b]), inArray(relationships.toId, [a, b]),
    )).orderBy(relationships.fromId).for("update");
    const edge = (from: string, to: string): RelationshipRow => rows.find((r) => r.fromId === from && r.toId === to)!;

    // The encounter memory is the durable receipt. Check AFTER locking both edges: live/night races are safe.
    const [receipt] = await tx.select({ id: memories.id }).from(memories).where(and(
      eq(memories.worldId, worldId), eq(memories.id, encounterMemoryId(day, a, b, a)),
    ));
    if (receipt) return;
    const before = pairLabel(edge(a, b).affinity, edge(b, a).affinity);
    const update = async (row: RelationshipRow, side: "a" | "b"): Promise<number> => {
      const delta = side === "a" ? outcome.a : outcome.b;
      let next = applyAffinity({ affinity: row.affinity, netDay: row.netDay, net: row.net }, day, delta.affinity, "encounter");
      let total = next.applied;
      if (encounter.planned) {
        next = applyAffinity(next.edge, day, AFFINITY_SOURCES.together, "together");
        total += next.applied;
      }
      const feeling = outcome.feeling?.who === side
        ? applyFeeling({ kind: row.feelingKind as FeelingKind | null, intensity: row.feelingIntensity }, outcome.feeling)
        : { kind: row.feelingKind as FeelingKind | null, intensity: row.feelingIntensity };
      await tx.update(relationships).set({
        affinity: next.edge.affinity, netDay: next.edge.netDay, net: next.edge.net,
        trust: clamp(row.trust + delta.trust, -100, 100),
        feelingKind: feeling.kind, feelingIntensity: feeling.intensity,
        lastSeenDay: Math.max(row.lastSeenDay ?? day, day), encounters: row.encounters + 1,
      }).where(and(eq(relationships.worldId, worldId), eq(relationships.fromId, row.fromId), eq(relationships.toId, row.toId)));
      return total;
    };
    applied.ab = await update(edge(a, b), "a");
    applied.ba = await update(edge(b, a), "b");

    const memory = (self: string, other: string, change: number) => ({
      worldId, id: encounterMemoryId(day, a, b, self), residentId: self, day, minute: encounter.minute, kind: "did",
      text: encounterMemoryText(ctx.names[other] ?? other, encounter.planned, change), who: [other], wherePlace: encounter.place,
      importance: encounterImportance(change), valence: encounterValence(change),
    });
    await tx.insert(memories).values([memory(a, b, applied.ab), memory(b, a, applied.ba)]).onConflictDoNothing();
    // Only offered memory ids survive validation; copy provenance and reduce importance by one hop.
    for (const id of outcome.news) {
      const [source] = await tx.select().from(memories).where(and(eq(memories.worldId, worldId), eq(memories.id, id)));
      if (!source || ![a, b].includes(source.residentId)) continue;
      const recipient = source.residentId === a ? b : a;
      const provenance = source.sourceEvent ?? source.id;
      const [known] = await tx.select({ id: memories.id }).from(memories).where(and(
        eq(memories.worldId, worldId), eq(memories.residentId, recipient), eq(memories.sourceEvent, provenance),
      ));
      if (known) continue;
      await tx.insert(memories).values({ ...source, id: `heard_${recipient}_${provenance}`, sourceEvent: provenance, residentId: recipient,
        day, minute: encounter.minute, kind: "heard", text: `${ctx.names[source.residentId] ?? source.residentId} told me: ${heardText(source.text)}`, importance: Math.max(1, source.importance - 1),
        who: [...new Set([...source.who, source.residentId])], wherePlace: encounter.place,
      }).onConflictDoNothing();
    }
    const after = pairLabel(edge(a, b).affinity + applied.ab, edge(b, a).affinity + applied.ba);
    const kind = tieMilestone(before, after);
    if (kind) await tx.insert(tieMilestones).values({ worldId, day, aId: orderedPair(a, b)[0], bId: orderedPair(a, b)[1], kind, fromLabel: before, toLabel: after }).onConflictDoNothing();
    if (call) await tx.insert(aiLog).values(nightLogRow(worldId, pairKey(a, b), "gossip", version ?? promptVersion(), call, !model));
  });
  return applied;
}

/** One rule-mode encounter for the bulk writer: the encounter and its Ambient-rule outcome. */
export interface RuleEncounter { encounter: Encounter; outcome: EncounterOutcome }

/** Rows per statement in the bulk writer (one VALUES list per chunk). */
const BULK_CHUNK = 100;
const chunks = <T>(rows: readonly T[], n = BULK_CHUNK): T[][] => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, (i + 1) * n));

/**
 * The night's rule-mode encounters (Ambient pairs, calls over the night's cap, no API key), all in one transaction
 * (MVP M-03: with 212 residents a night can have a couple of hundred): the same writes persistEncounter makes for
 * each, batched. Every directed edge belongs to one pair and a pair meets once a night, so the order doesn't matter
 * and the result is the one the encounters would have written one by one. Edges are locked in (from, to) order, then
 * the receipts are checked, as persistEncounter does; an encounter already met today (a live chat) is skipped.
 * Returns what each applied, by pair key.
 */
export async function persistRuleEncounters(
  db: WorldDatabase, ctx: Pick<EncounterContext, "worldId" | "day" | "names">, items: readonly RuleEncounter[],
): Promise<Map<string, { ab: number; ba: number }>> {
  const { worldId, day } = ctx;
  const applied = new Map<string, { ab: number; ba: number }>();
  if (!items.length) return applied;
  await db.transaction(async (tx) => {
    const ids = [...new Set(items.flatMap((i) => [i.encounter.a, i.encounter.b]))];
    for (const part of chunks(items)) {
      await tx.insert(relationships).values(part.flatMap(({ encounter: { a, b } }) => [
        { worldId, fromId: a, toId: b, affinity: 0, trust: 0, tag: "acquaintance", note: "" },
        { worldId, fromId: b, toId: a, affinity: 0, trust: 0, tag: "acquaintance", note: "" },
      ])).onConflictDoNothing();
    }
    const locked = await tx.select().from(relationships).where(and(
      eq(relationships.worldId, worldId), inArray(relationships.fromId, ids), inArray(relationships.toId, ids),
    )).orderBy(relationships.fromId, relationships.toId).for("update");
    const edges = new Map(locked.map((r) => [`${r.fromId}>${r.toId}`, r]));
    const receiptIds = items.map(({ encounter: { a, b } }) => encounterMemoryId(day, a, b, a));
    const receipts = new Set<string>();
    for (const part of chunks(receiptIds)) {
      for (const r of await tx.select({ id: memories.id }).from(memories).where(and(eq(memories.worldId, worldId), inArray(memories.id, part)))) receipts.add(r.id);
    }
    const updates: RelationshipRow[] = [];
    const newMemories: (typeof memories.$inferInsert)[] = [];
    const milestones: (typeof tieMilestones.$inferInsert)[] = [];
    const news: { id: string; recipientOf: (owner: string) => string | null; encounter: Encounter }[] = [];
    for (const { encounter, outcome } of items) {
      const { a, b } = encounter;
      if (receipts.has(encounterMemoryId(day, a, b, a))) continue;
      const ab = edges.get(`${a}>${b}`)!, ba = edges.get(`${b}>${a}`)!;
      const before = pairLabel(ab.affinity, ba.affinity);
      const step = (row: RelationshipRow, delta: SideDelta): { row: RelationshipRow; total: number } => {
        let next = applyAffinity({ affinity: row.affinity, netDay: row.netDay, net: row.net }, day, delta.affinity, "encounter");
        let total = next.applied;
        if (encounter.planned) {
          next = applyAffinity(next.edge, day, AFFINITY_SOURCES.together, "together");
          total += next.applied;
        }
        // The Ambient rule moves no feelings (ruleOutcome); a feeling the model gave never comes here.
        return {
          row: { ...row, affinity: next.edge.affinity, netDay: next.edge.netDay, net: next.edge.net, trust: clamp(row.trust + delta.trust, -100, 100),
            lastSeenDay: Math.max(row.lastSeenDay ?? day, day), encounters: row.encounters + 1 },
          total,
        };
      };
      const x = step(ab, outcome.a), y = step(ba, outcome.b);
      updates.push(x.row, y.row);
      applied.set(pairKey(a, b), { ab: x.total, ba: y.total });
      const memory = (self: string, other: string, change: number) => ({
        worldId, id: encounterMemoryId(day, a, b, self), residentId: self, day, minute: encounter.minute, kind: "did",
        text: encounterMemoryText(ctx.names[other] ?? other, encounter.planned, change), who: [other], wherePlace: encounter.place,
        importance: encounterImportance(change), valence: encounterValence(change),
      });
      newMemories.push(memory(a, b, x.total), memory(b, a, y.total));
      for (const id of outcome.news) news.push({ id, recipientOf: (owner) => (owner === a ? b : owner === b ? a : null), encounter });
      const after = pairLabel(x.row.affinity, y.row.affinity);
      const kind = tieMilestone(before, after);
      if (kind) milestones.push({ worldId, day, aId: orderedPair(a, b)[0], bId: orderedPair(a, b)[1], kind, fromLabel: before, toLabel: after });
    }
    // Every edge in one statement per chunk: UPDATE … FROM (VALUES …).
    for (const part of chunks(updates)) {
      const values = sql.join(part.map((r) => sql`(${r.fromId}::text, ${r.toId}::text, ${r.affinity}::int, ${r.netDay}::int, ${r.net}::int, ${r.trust}::int, ${r.lastSeenDay}::int, ${r.encounters}::int)`), sql`, `);
      await tx.execute(sql`update ${relationships} as r set affinity = v.affinity, net_day = v.net_day, net = v.net, trust = v.trust,
        last_seen_day = v.last_seen_day, encounters = v.encounters
        from (values ${values}) as v(from_id, to_id, affinity, net_day, net, trust, last_seen_day, encounters)
        where r.world_id = ${worldId} and r.from_id = v.from_id and r.to_id = v.to_id`);
    }
    for (const part of chunks(newMemories)) await tx.insert(memories).values(part).onConflictDoNothing();
    // News that changed hands: copy provenance, one hop less important (as persistEncounter does, in bulk).
    if (news.length) {
      const sources = new Map<string, typeof memories.$inferSelect>();
      for (const part of chunks([...new Set(news.map((n) => n.id))])) {
        for (const m of await tx.select().from(memories).where(and(eq(memories.worldId, worldId), inArray(memories.id, part)))) sources.set(m.id, m);
      }
      const wanted: { source: typeof memories.$inferSelect; recipient: string; provenance: string; encounter: Encounter }[] = [];
      for (const n of news) {
        const source = sources.get(n.id);
        const recipient = source ? n.recipientOf(source.residentId) : null;
        if (!source || !recipient) continue;
        wanted.push({ source, recipient, provenance: source.sourceEvent ?? source.id, encounter: n.encounter });
      }
      const known = new Set<string>();
      const recipients = [...new Set(wanted.map((w) => w.recipient))];
      for (const part of chunks([...new Set(wanted.map((w) => w.provenance))])) {
        const rows = await tx.select({ residentId: memories.residentId, sourceEvent: memories.sourceEvent }).from(memories).where(and(
          eq(memories.worldId, worldId), inArray(memories.residentId, recipients), inArray(memories.sourceEvent, part),
        ));
        for (const r of rows) known.add(`${r.residentId}|${r.sourceEvent}`);
      }
      const heard: (typeof memories.$inferInsert)[] = [];
      for (const { source, recipient, provenance, encounter } of wanted) {
        if (known.has(`${recipient}|${provenance}`)) continue;
        known.add(`${recipient}|${provenance}`);
        heard.push({ ...source, id: `heard_${recipient}_${provenance}`, sourceEvent: provenance, residentId: recipient,
          day, minute: encounter.minute, kind: "heard", text: `${ctx.names[source.residentId] ?? source.residentId} told me: ${heardText(source.text)}`, importance: Math.max(1, source.importance - 1),
          who: [...new Set([...source.who, source.residentId])], wherePlace: encounter.place });
      }
      for (const part of chunks(heard)) await tx.insert(memories).values(part).onConflictDoNothing();
    }
    for (const part of chunks(milestones)) await tx.insert(tieMilestones).values(part).onConflictDoNothing();
  });
  return applied;
}

/** A side's view of the other as the prompt builder takes it. */
export function relationshipView(row: RelationshipRow | undefined): RelationshipView | null {
  if (!row) return null;
  return {
    id: row.toId, affinity: row.affinity, trust: row.trust, tag: row.tag,
    feeling: row.feelingKind ? { kind: row.feelingKind as FeelingKind, intensity: row.feelingIntensity } : null,
  };
}

/** The mean affinity of a pair from rows keyed "from>to" (null: they've never met). */
export function meanOf(rows: ReadonlyMap<string, Pick<RelationshipRow, "affinity">>, a: string, b: string): number | null {
  return pairMean(rows.get(`${a}>${b}`)?.affinity, rows.get(`${b}>${a}`)?.affinity);
}
