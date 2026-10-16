import { loadItems } from "../content/loadContent.js";
import { feasibleFavor } from "./favorFeasibility.js";
/**
 * The nightly reflection (GDD §9.6 beliefs, §9.7 step 1, §9.17 Reflect; MVP M-07).
 *
 *   gather today's memories (all of them, or the top 12 by the §9.6 score) + block 3 (beliefs, people, stances)
 *     → buildReflectRequest (effort "low", no sampling params) → callModel (deadline, stop_reason check)
 *     → validateReflection (schema, clampReflection, lexical filters, ids and targets)
 *     → one transaction: mood, emotion, beliefs, relationships, stances, Regard, dream note, a proposed Favor,
 *       a letter for the next dawn, the diary memory, and the ai_log row.
 * Any failure (no key, timeout, refusal, max_tokens, API error, invalid JSON) takes the deterministic rule
 * fallback instead: mood drifts 10% toward neutral and beliefs stay as they were (§9.8 lag tolerance, §9.14).
 *
 * The model proposes; the engine disposes (§9.1): every number is clamped, every id checked, every text filtered.
 */
import { and, count, eq, gte, inArray } from "drizzle-orm";
import {
  MVP_FAVOR_TEMPLATES, ROMANTIC_FEELINGS, ReflectionOutput, ResidentState, applyAffinity, clamp, clampReflection,
  romanceEligible, type FavorTemplate, type Memory, type PersonaCard,
} from "@monde/shared";
import { aiLog, favors, letters, memories, relationships, residents, worlds } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { callModel, type CallFailure } from "./callModel.js";
import { LIVE_FAVOR_STATUSES, loadResidentPrefix, type ResidentPrefix } from "./context.js";
import type { CallRecord } from "./dialogue.js";
import { lexicalHits } from "./filters.js";
import { nightLogRow, type NightJobDeps, type NightWorld } from "./nightJob.js";
import { apiParams, buildReflectRequest, promptVersion } from "./promptBuilder.js";
import { contentWords, retrieveMemories } from "./retrieval.js";

/** §9.6: the top 12 memories go into reflections. */
export const REFLECTION_MEMORIES = 12;
/** §9.9: one live Favor per resident and at most 6 across the town. */
export const MAX_OPEN_FAVORS = 6;
/** Proposed favors expire 5 days after the night that wrote them (§9.9: 2-5 days; M-09 sets the real window). */
export const FAVOR_EXPIRY_DAYS = 5;
/** The fallback: mood drifts this share of the way back to neutral each night. */
export const MOOD_DRIFT = 0.1;
/** GDD-GAP: "neutral" mood isn't defined; it is the Day-1 state createWorld gives everyone (valence 0, energy 50, stress 0). */
export const NEUTRAL_MOOD = { valence: 0, energy: 50, stress: 0, intensity: 0 } as const;
/** Favor templates a reflection may propose: the MVP set minus last_chance, which the engine triggers itself (§9.9). */
export const PROPOSABLE_FAVORS: readonly FavorTemplate[] = MVP_FAVOR_TEMPLATES.filter((t) => t !== "last_chance");

// GDD-GAP: §9.17 caps the deltas but not the text. These keep stored text to what a person would write in one go.
const BELIEF_CHARS = 200;
const DIARY_CHARS = 200; // Memory.text is at most 200 characters (§9.6)
const NOTE_CHARS = 200;
const FAVOR_CHARS = 280;
const LETTER_CHARS = 800;
// GDD-GAP: no per-night caps on how many people or issues a reflection touches. Block 3 shows the top 8 people,
// so 8 relationship deltas is the most a reflection can sensibly speak to; a resident holds at most 12 stances.
const MAX_RELATIONSHIP_DELTAS = 8;
const MAX_STANCES = 12;
const ISSUE_ID = /^[a-z][a-z0-9_]{0,39}$/;
/** The night's diary entry is the last memory of the day. */
const DIARY_MINUTE = 26 * 60;

// ---------------------------------------------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------------------------------------------

const chronological = (list: readonly Memory[]): Memory[] =>
  [...list].sort((a, b) => a.minute - b.minute || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * All of today's memories, or the top 12 by the §9.6 score if there are more, in the order they happened.
 * GDD-GAP: §9.6 scores relevance against "the current context"; at night that is the resident's own life: the
 * player and the people in block 3, their home, and the words of their beliefs and dream.
 */
export function selectReflectionMemories(today: readonly Memory[], prefix: Pick<ResidentPrefix, "card" | "state" | "relationships">, day: number): Memory[] {
  if (today.length <= REFLECTION_MEMORIES) return chronological(today);
  const top = retrieveMemories(today.map((memory) => ({ memory, tags: [] })), {
    today: day,
    who: new Set(["player", ...prefix.relationships.map((r) => r.id)]),
    place: prefix.card.home,
    terms: contentWords([...prefix.state.beliefs, prefix.card.dream.text].join(" ")),
  }, REFLECTION_MEMORIES);
  return chronological(top);
}

export async function loadMemoriesForDay(db: WorldDatabase, worldId: string, residentId: string, day: number): Promise<Memory[]> {
  const rows = await db.select().from(memories).where(and(
    eq(memories.worldId, worldId), eq(memories.residentId, residentId), eq(memories.day, day), eq(memories.archived, false),
  ));
  return rows.map((m) => ({
    id: m.id, resident_id: m.residentId, day: m.day, minute: m.minute, kind: m.kind as Memory["kind"], text: m.text,
    who: m.who, where: m.wherePlace, importance: m.importance, valence: m.valence,
    ...(m.sourceEvent ? { source_event: m.sourceEvent } : {}),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

export interface ReflectionValidationContext {
  residentId: string;
  itemIds?: ReadonlySet<string>;
  /** Every resident id in the world. */
  residentIds: ReadonlySet<string>;
  /** Everyone this resident already has a relationship row with (cards name a few non-residents, like Frye). */
  relationshipIds?: ReadonlySet<string>;
  /** Registered place ids. */
  places: ReadonlySet<string>;
  /** The resident's current stances (new issues are allowed up to 12 in all). */
  stances: Readonly<Record<string, number>>;
}

export type ReflectionValidation =
  | { ok: true; output: ReflectionOutput; adjustments: string[] }
  | { ok: false; category: "schema"; detail: string };

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Cheap proposal validation; feasibleFavor checks reachability, existing ties and the resident’s own place before storage. */
export function favorTargetExists(template: FavorTemplate, target: string, ctx: ReflectionValidationContext): boolean {
  const resident = target !== ctx.residentId && ctx.residentIds.has(target);
  switch (template) {
    case "deliver":
    case "introduce":
      return resident;
    case "help_chore":
      return target === ctx.residentId || resident || ctx.places.has(target);
    case "fetch":
    case "find":
      return ctx.itemIds?.has(target) ?? false;
    default:
      return false;
  }
}

/**
 * Parse, clamp and check one reflection. A malformed reply fails as a whole ("schema"); anything else that's wrong
 * is dropped item by item and listed in `adjustments`:
 *   beliefs        trimmed, deduplicated, ≤ 200 characters, no lexical hits, ≤ 12 (none left → yesterday's stay)
 *   relationships  the id must be another resident of this world, or someone they already have a relationship
 *                  with; one delta per person, ≤ 8
 *   stances        snake_case issue ids, one delta per issue, ≤ 12 issues held in all
 *   dream          the note only (stages are engine-checked), ≤ 200 characters, no lexical hits
 *   favor          an allowed template (§9.9 MVP set minus last_chance), an existing target, clean text
 *   letter         to "player", "lantern" or another resident; clean text ≤ 800 characters
 *   diary          clean, cut to 200 characters (a memory's length)
 */
export function validateReflection(raw: string, ctx: ReflectionValidationContext): ReflectionValidation {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, category: "schema", detail: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = ReflectionOutput.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, category: "schema", detail: issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid" };
  }
  const adjustments: string[] = [];
  const clean = (text: string, what: string, limit: number): string | null => {
    const line = oneLine(text);
    if (!line) return null;
    const hit = lexicalHits(line)[0];
    if (hit) { adjustments.push(`${what} dropped (lexical:${hit.group})`); return null; }
    if (line.length > limit) { adjustments.push(`${what} dropped (too long)`); return null; }
    return line;
  };
  const out = clampReflection(parsed.data);
  if (parsed.data.beliefs.length > out.beliefs.length) adjustments.push(`beliefs cut to ${out.beliefs.length}`);

  const beliefs: string[] = [];
  for (const belief of out.beliefs) {
    const line = clean(belief, "belief", BELIEF_CHARS);
    if (line && !beliefs.some((b) => b.toLowerCase() === line.toLowerCase())) beliefs.push(line);
  }
  if (beliefs.length === 0) adjustments.push("no usable beliefs; yesterday's stay");

  const people = new Set<string>();
  const relationshipDeltas = out.relationship_deltas.filter((r) => {
    const known = ctx.residentIds.has(r.id) || (ctx.relationshipIds?.has(r.id) ?? false);
    const ok = r.id !== ctx.residentId && known && !people.has(r.id) && people.size < MAX_RELATIONSHIP_DELTAS;
    if (ok) people.add(r.id);
    else adjustments.push(`relationship ${r.id} dropped`);
    return ok;
  });

  const held = new Set(Object.keys(ctx.stances));
  const issues = new Set<string>();
  const stanceDeltas = out.stance_deltas.filter((s) => {
    const known = held.has(s.issue);
    const ok = ISSUE_ID.test(s.issue) && !issues.has(s.issue) && (known || held.size < MAX_STANCES);
    if (ok) { issues.add(s.issue); held.add(s.issue); } else adjustments.push(`stance ${s.issue} dropped`);
    return ok;
  });

  let dream = out.dream_progress;
  if (dream) {
    const note = clean(dream.note, "dream note", NOTE_CHARS);
    dream = note ? { stage_done: dream.stage_done, note } : null;
  }

  let favor = out.favor;
  if (favor) {
    const text = clean(favor.text, "favor", FAVOR_CHARS);
    if (!PROPOSABLE_FAVORS.includes(favor.template)) { adjustments.push(`favor template ${favor.template} dropped`); favor = null; }
    else if (!favorTargetExists(favor.template, favor.target, ctx)) { adjustments.push(`favor target ${favor.target} dropped`); favor = null; }
    else favor = text ? { ...favor, text } : null;
  }

  let letter = out.letter;
  if (letter) {
    const to = letter.to.trim().toLowerCase();
    const text = clean(letter.text, "letter", LETTER_CHARS);
    const addressee = to === "player" || to === "lantern" || (to !== ctx.residentId && ctx.residentIds.has(to));
    if (!addressee) { adjustments.push(`letter to ${letter.to} dropped`); letter = null; }
    else letter = text ? { to, text } : null;
  }

  const diaryLine = oneLine(out.diary);
  const diaryHit = lexicalHits(diaryLine)[0];
  if (diaryHit) adjustments.push(`diary dropped (lexical:${diaryHit.group})`);
  const diary = diaryHit ? "" : diaryLine.slice(0, DIARY_CHARS).trim();

  return {
    ok: true,
    adjustments,
    output: {
      ...out, beliefs, relationship_deltas: relationshipDeltas, stance_deltas: stanceDeltas,
      dream_progress: dream, favor, letter, diary,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// State arithmetic (pure)
// ---------------------------------------------------------------------------------------------------------------

/**
 * GDD-GAP: the reflection contract has an emotion but no intensity. It is read off the mood: how far valence
 * sits from neutral, or the stress, whichever is stronger.
 */
export const moodIntensity = (valence: number, stress: number): number => clamp(Math.round(Math.max(Math.abs(valence), stress)), 0, 100);

/** A validated, clamped reflection applied to the resident's own state. */
export function applyReflectionToState(state: ResidentState, out: ReflectionOutput): ResidentState {
  const valence = clamp(state.mood.valence + out.mood_delta.valence, -100, 100);
  const energy = clamp(state.mood.energy + out.mood_delta.energy, 0, 100);
  const stress = clamp(state.mood.stress + out.mood_delta.stress, 0, 100);
  const stances = { ...state.stances };
  for (const s of out.stance_deltas) stances[s.issue] = clamp((stances[s.issue] ?? 0) + s.delta, -100, 100);
  return ResidentState.parse({
    ...state,
    mood: { valence, energy, stress, emotion: out.emotion, intensity: moodIntensity(valence, stress) },
    beliefs: out.beliefs.length ? out.beliefs : state.beliefs,
    stances,
    regard: clamp(state.regard + out.regard_delta, -100, 100),
    // Dream stages carry engine conditions (§9.3), so only the note is the model's to write.
    dream: out.dream_progress ? { ...state.dream, notes: out.dream_progress.note } : state.dream,
  });
}

const toward = (value: number, target: number): number => Math.round((target + (value - target) * (1 - MOOD_DRIFT)) * 100) / 100;

/** The rule fallback: mood drifts 10% of the way to neutral; emotion, beliefs and everything else stay. */
export function driftMood(state: ResidentState): ResidentState {
  const m = state.mood;
  return ResidentState.parse({
    ...state,
    mood: {
      ...m,
      valence: toward(m.valence, NEUTRAL_MOOD.valence),
      energy: toward(m.energy, NEUTRAL_MOOD.energy),
      stress: toward(m.stress, NEUTRAL_MOOD.stress),
      intensity: toward(m.intensity, NEUTRAL_MOOD.intensity),
    },
  });
}

export type FeelingKind = "crush" | "love" | "resentment" | "admiration";
export interface Feeling { kind: FeelingKind | null; intensity: number }

/**
 * GDD-GAP: §9.4 gives a relationship one feeling at a time but not how a different one replaces it. A delta for
 * the same kind (or when there is none) moves the intensity within 0..100. A positive delta for another kind
 * first wears the current feeling down and takes over with whatever is left; a negative one for a feeling they
 * don't have changes nothing.
 */
export function applyFeeling(current: Feeling, change: { kind: FeelingKind; delta: number } | null): Feeling {
  if (!change || change.delta === 0) return current;
  const has = current.kind !== null && current.intensity > 0;
  if (!has || current.kind === change.kind) {
    if (!has && change.delta < 0) return current;
    const intensity = clamp((has ? current.intensity : 0) + change.delta, 0, 100);
    return { kind: intensity > 0 ? change.kind : null, intensity };
  }
  // A different feeling from the one they have.
  if (change.delta < 0) return current;
  if (change.delta > current.intensity) return { kind: change.kind, intensity: clamp(change.delta - current.intensity, 0, 100) };
  const left = current.intensity - change.delta;
  return { kind: left > 0 ? current.kind : null, intensity: left };
}

/**
 * GDD-GAP: the diary memory's importance and valence aren't specified. A diary line is about as vivid as the day's
 * strongest memory less one (never below 3), and its valence follows tonight's mood shift (±15 → ±5).
 */
export const diaryImportance = (today: readonly Memory[]): number =>
  clamp(Math.max(3, ...today.map((m) => m.importance - 1)), 1, 10);
export const diaryValence = (moodValenceDelta: number): number => clamp(Math.round(moodValenceDelta / 3), -5, 5);

// ---------------------------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------------------------

export const diaryMemoryId = (residentId: string, day: number): string => `felt_diary_${residentId}_${day}`;
export const reflectionFavorId = (residentId: string, day: number): string => `favor_reflect_${residentId}_${day}`;
export const letterId = (residentId: string, day: number): string => `letter_${residentId}_${day}`;

interface PersistArgs {
  worldId: string;
  residentId: string;
  day: number;
  card: PersonaCard;
  /** Null: the rule fallback. */
  output: ReflectionOutput | null;
  today: readonly Memory[];
  call: CallRecord | null;
  promptVersion: string;
}

/** Apply a reflection (or the fallback) in one transaction. Returns what was dropped at write time. */
async function persistReflection(db: WorldDatabase, args: PersistArgs): Promise<string[]> {
  const { worldId, residentId, day, output } = args;
  const dropped: string[] = [];
  await db.transaction(async (tx) => {
    const where = and(eq(residents.worldId, worldId), eq(residents.id, residentId));
    const [row] = await tx.select({ state: residents.state }).from(residents).where(where).for("update");
    if (!row) throw new Error(`resident ${residentId} vanished during the night`);
    const state = output ? applyReflectionToState(row.state, output) : driftMood(row.state);
    await tx.update(residents).set({ state, updatedAt: new Date() }).where(where);

    if (output) {
      for (const delta of output.relationship_deltas) {
        // §9.11.3: crush and love only between residents who may court (adults, not family, not spoken for).
        let change = delta.feeling;
        if (change && ROMANTIC_FEELINGS.has(change.kind)) {
          const [other] = await tx.select({ card: residents.card, state: residents.state }).from(residents)
            .where(and(eq(residents.worldId, worldId), eq(residents.id, delta.id)));
          if (!other || !romanceEligible({ card: args.card, flags: row.state.flags }, { card: other.card, flags: other.state.flags })) {
            dropped.push(`${change.kind} for ${delta.id} dropped (romance rules)`);
            change = null;
          }
        }
        const edge = and(eq(relationships.worldId, worldId), eq(relationships.fromId, residentId), eq(relationships.toId, delta.id));
        const [existing] = await tx.select().from(relationships).where(edge).for("update");
        // §9.11.3: gossip heard moves affinity −10..+10, inside the pair's ±6 a day (with tonight's encounters).
        // GDD-GAP: the cap wins over the source's range, so a reflection moves a pair at most 6 a night.
        const moved = applyAffinity(
          existing ? { affinity: existing.affinity, netDay: existing.netDay, net: existing.net } : { affinity: 0, netDay: null, net: 0 },
          day, delta.affinity, "gossip",
        ).edge;
        if (existing) {
          const feeling = applyFeeling({ kind: existing.feelingKind as FeelingKind | null, intensity: existing.feelingIntensity }, change);
          await tx.update(relationships).set({
            affinity: moved.affinity, netDay: moved.netDay, net: moved.net,
            trust: clamp(existing.trust + delta.trust, -100, 100),
            feelingKind: feeling.kind, feelingIntensity: feeling.intensity,
          }).where(edge);
        } else {
          // GDD-GAP: someone new in their life. The tag vocabulary is authored per card; "acquaintance" until it isn't.
          const feeling = applyFeeling({ kind: null, intensity: 0 }, change);
          await tx.insert(relationships).values({
            worldId, fromId: residentId, toId: delta.id, affinity: moved.affinity, netDay: moved.netDay, net: moved.net,
            trust: delta.trust, tag: "acquaintance", note: "", feelingKind: feeling.kind, feelingIntensity: feeling.intensity,
          });
        }
      }

      if (output.favor) {
        // Lock the world row so concurrent reflections can't both take the town's sixth favor slot.
        await tx.select({ id: worlds.id }).from(worlds).where(eq(worlds.id, worldId)).for("update");
        const live = and(eq(favors.worldId, worldId), inArray(favors.status, [...LIVE_FAVOR_STATUSES]), gte(favors.expiresDay, day + 1));
        const [mine] = await tx.select({ n: count() }).from(favors).where(and(live, eq(favors.residentId, residentId)));
        const [town] = await tx.select({ n: count() }).from(favors).where(live);
        if ((mine?.n ?? 0) > 0) dropped.push("favor dropped (they already have one open)");
        else if ((town?.n ?? 0) >= MAX_OPEN_FAVORS) dropped.push(`favor dropped (${MAX_OPEN_FAVORS} already open in town)`);
        else {
          const contract = await feasibleFavor(tx, worldId, residentId, day, reflectionFavorId(residentId, day), output.favor);
          if (contract) await tx.insert(favors).values({
            worldId, id: reflectionFavorId(residentId, day), residentId, template: output.favor.template,
            target: output.favor.target, text: output.favor.text, status: "proposed", createdDay: day,
            expiresDay: day + FAVOR_EXPIRY_DAYS, reward: contract,
          }).onConflictDoNothing();
        }
      }

      if (output.letter) {
        // Written tonight, read at the next dawn.
        await tx.insert(letters).values({
          worldId, id: letterId(residentId, day), fromId: residentId, toId: output.letter.to, day: day + 1,
          text: output.letter.text, delivered: false,
        }).onConflictDoNothing();
      }

      if (output.diary) {
        await tx.insert(memories).values({
          worldId, id: diaryMemoryId(residentId, day), residentId, day, minute: DIARY_MINUTE, kind: "felt",
          text: output.diary, who: [], wherePlace: args.card.home, importance: diaryImportance(args.today),
          valence: diaryValence(output.mood_delta.valence),
        }).onConflictDoNothing();
      }
    }

    if (args.call) await tx.insert(aiLog).values(nightLogRow(worldId, residentId, "reflect", args.promptVersion, args.call, output === null));
  });
  return dropped;
}

// ---------------------------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------------------------

export interface ReflectResult {
  source: "model" | "fallback";
  /** "ok", or why the fallback ran (a call failure or a validation category). */
  reason: "ok" | CallFailure | "schema";
  adjustments: string[];
}

/** Reflect one resident on `world.day`. Null if the resident doesn't exist. Throws only on database errors. */
export async function reflectResident(deps: NightJobDeps, world: NightWorld, residentId: string): Promise<ReflectResult | null> {
  const { db, mind } = deps;
  const prefix = await loadResidentPrefix(db, world.worldId, residentId);
  if (!prefix) return null;
  const today = await loadMemoriesForDay(db, world.worldId, residentId, world.day);
  const version = promptVersion();
  const base = { worldId: world.worldId, residentId, day: world.day, card: prefix.card, today, promptVersion: version };

  const fallback = async (reason: ReflectResult["reason"], call: CallRecord | null, detail?: unknown): Promise<ReflectResult> => {
    // No key is Quiet Mode (§9.14), not a fault: log it quietly.
    (reason === "unavailable" ? deps.log.info : deps.log.warn).call(deps.log, { residentId, day: world.day, reason, detail },
      "reflection fell back to the mood-drift rule");
    await persistReflection(db, { ...base, output: null, call });
    return { source: "fallback", reason, adjustments: [] };
  };
  if (!mind.enabled) return fallback("unavailable", null);

  const itemIds = new Set((await loadItems()).map(i => i.id));
  const request = buildReflectRequest({
    card: prefix.card, state: prefix.state, relationships: prefix.relationships, flags: world.flags, names: prefix.names,
    day: world.day, memoriesToday: selectReflectionMemories(today, prefix, world.day), town: world.town,
    favorTemplates: PROPOSABLE_FAVORS,
  });
  request.messages[0]!.content = `${String(request.messages[0]!.content)}\nObtainable favor item ids: ${[...itemIds].join(", ")}. For help_chore target yourself (${residentId}) or your home (${prefix.card.home}).`;
  const result = await callModel(mind, apiParams("reflect", request), {
    timeoutMs: deps.callTimeoutMs, signal: deps.signal, gate: deps.gate, now: deps.now,
  });
  if (!result.ok) return fallback(result.failure, result.call, result.error instanceof Error ? result.error.message : undefined);

  const validated = validateReflection(result.text, {
    residentId, residentIds: world.residentIds, relationshipIds: new Set(prefix.relationships.map((r) => r.id)),
    itemIds, places: world.places.ids, stances: prefix.state.stances,
  });
  if (!validated.ok) return fallback("schema", { ...result.call, validation: validated.category }, validated.detail);

  if (validated.output.favor && !await feasibleFavor(db,world.worldId,residentId,world.day,reflectionFavorId(residentId,world.day),validated.output.favor)) {
    validated.output.favor = null; validated.adjustments.push('favor dropped (infeasible with current items, places or relationships)');
  }
  const dropped = await persistReflection(db, { ...base, output: validated.output, call: result.call });
  const adjustments = [...validated.adjustments, ...dropped];
  if (adjustments.length) deps.log.info({ residentId, day: world.day, adjustments }, "reflection adjusted");
  return { source: "model", reason: "ok", adjustments };
}
