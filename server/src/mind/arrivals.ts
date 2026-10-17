import { budgetMind } from "./budget.js";
/**
 * Arrivals and departures on the server (GDD §6.4, Appendix A.3; MVP G-02).
 *
 * The client's town engine decides how many households the ferry brings (§6.4) and posts the count with the night
 * (`arrivals`). This module decides who they are and writes them:
 *   - the buffer (§9.2): a few households per world are drawn and written ahead by Haiku (A.3.6, one call per
 *     household at effort "low", repaired where the engine can (shared arrivals/repair.ts), validated against A.3.7
 *     and the content filters, two retries with the remaining errors fed back), with `home.own` for a home, so a ferry
 *     day never waits on the model. It's refilled after each night, in the background;
 *   - the commit, inside the night: each slot takes the buffered household that best fits the roll (its lean, the
 *     gates on today's town, a free home with enough beds) or, if none does, a template household written on the spot
 *     (A.3.8). The residents are inserted (tier Ambient, §9.8), their home bound, the household's own ties written, an
 *     `arrival` town event logged for the paper, and the dawn package hands them to the client;
 *   - Quiet Mode households the client wrote offline are adopted with the next night (`adopt`);
 *   - leavers the client reports (`departed`) are let go: their rows, ties and plans removed and their open Favors
 *     expired (their memories stay with everyone who remembers them), and a `departure` event logged;
 *   - Leaving Notices (`notices`) become memories: the resident's own decision, and a word to each friend ("they tell
 *     friends", §6.4), important enough that tonight's reflection writes it (§9.8: Ambient reflects on 6+).
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ARCHETYPES, ARRIVAL_SYSTEM_PROMPT, ArrivalHousehold, HOME_TOKEN, PersonaCard, RESERVED_FIRST_NAMES, ResidentState,
  arrivalMaxTokens, arrivalUserMessage, bindHome, cardsFromHousehold, drawHousehold, hashParts, HOUSEHOLD_JSON_BLOCK, parseJsonObject,
  repairHousehold, templateHousehold, validateHousehold, whimFor, ArrivalHouseholdOutput, type ArrivalFacts, type HouseholdDraw, type PromptContext,
  type RecentHousehold,
} from "@monde/shared";
import { aiLog, arrivals, events, favors, memories, plans, relationships, residents, worlds } from "../db/schema.js";
import { initialState, type WorldDatabase } from "../worlds/createWorld.js";
import { callModel } from "./callModel.js";
import { weekdayOf } from "./context.js";
import { aiLogRow } from "./effects.js";
import { lexicalHits } from "./filters.js";
import type { NightJobDeps } from "./nightJob.js";
import { loadPlaceRegistry } from "./places.js";
import { MIND_MODEL } from "./promptBuilder.js";

/** GDD-GAP: §9.2 keeps "a small buffer" without a size. Three households cover any Spring ferry (≤ 2 at Appeal < 47). */
export const ARRIVAL_BUFFER_SIZE = 3;
/** A.3.8: a failed check gets two retries with the errors fed back. */
export const ARRIVAL_ATTEMPTS = 3;
export const ARRIVAL_PROMPT_VERSION = "arrival-v1";
/** GDD-GAP: the arrival buffer is optional background work: it stops at the §9.15 daily target, like summaries. */
export const ARRIVAL_BUDGET_USD = 0.09;
/** A.3.7 V03: names of residents who left in the last 30 days can't come back as someone else. */
export const RECENT_DEPARTURE_DAYS = 30;
/** GDD-GAP: §9.6's event table has no importance for arrivals and departures; both are news a town talks about. */
export const ARRIVAL_EVENT_IMPORTANCE = 5;
/** A Leaving Notice is a decision: important enough for an Ambient resident's reflection (§9.8: 6+). */
export const NOTICE_MEMORY_IMPORTANCE = 7;
export const NOTICE_FRIEND_IMPORTANCE = 6;

const Pillar = z.number().min(0).max(100);
/** The night's `arrivals` (client → server): the town engine's roll for the coming day. */
export const ArrivalRequest = z.object({
  /** The day they step off the ferry: the night's day + 1. */
  day: z.number().int().min(1),
  households: z.number().int().min(0).max(6),
  youth_share: z.number().min(0).max(1),
  free_homes: z.array(z.object({ home: z.string().max(80), beds: z.number().int().min(1).max(8), name: z.string().max(80).optional() })).max(200),
  pillars: z.object({ prosperity: Pillar, safety: Pillar, spirit: Pillar, charm: Pillar }),
  census: z.number().int().min(0).max(100_000).optional(),
  flags: z.array(z.string().max(120)).max(1000).optional(),
  pupils: z.number().int().min(0).max(1000).optional(),
  unrestored_homes: z.number().int().min(0).max(1000).optional(),
});
export type ArrivalRequest = z.infer<typeof ArrivalRequest>;

export const NoticeIn = z.object({
  resident: z.string().max(80), day: z.number().int().min(1), deadline: z.number().int().min(1),
  friends: z.array(z.string().max(80)).max(40).optional(),
});
export type NoticeIn = z.infer<typeof NoticeIn>;

export interface ArrivalDeps extends NightJobDeps { seed: number }

type Database = WorldDatabase;
type Row = typeof arrivals.$inferSelect;

/** What the gates and the prompt read about the town (A.2 Requires, A.3.6 TOWN). */
export function factsFrom(request: ArrivalRequest, homes: readonly { home: string; beds: number }[] = request.free_homes): ArrivalFacts {
  return {
    day: request.day, pillars: request.pillars, flags: new Set(request.flags ?? []), freeHomes: homes,
    unrestoredHomes: request.unrestored_homes ?? 61, pupils: request.pupils ?? 9, storefrontsFree: 0,
  };
}

const seasonOf = (day: number): string => ["Spring", "Summer", "Autumn", "Winter"][Math.min(3, Math.floor((day - 1) / 25))]!;

/** A.3.6's ctx: the town, the people they might know, names to avoid. */
async function promptContext(db: Database, worldId: string, request: ArrivalRequest, whim: string, home: PromptContext["home"]): Promise<PromptContext> {
  const rows = await db.select({ id: residents.id, card: residents.card, tier: residents.tier }).from(residents).where(eq(residents.worldId, worldId));
  const flags = request.flags ?? [];
  const projectsDone = flags.filter(f => /^project_[a-z_]+_done$/.test(f) && !/vacant_house/.test(f)).map(f => f.slice(8, -5));
  const projectsActive = flags.filter(f => /^project_[a-z_]+_started$/.test(f)).map(f => f.slice(8, -8)).filter(p => !projectsDone.includes(p));
  // People they might know: the cast who meet newcomers (A.3.6 asks for 6–10).
  const known = rows.filter(r => r.card.kind === "canon" || r.card.kind === "resident").sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, 40).filter((_, i) => i % 3 === hashParts(whim) % 3).slice(0, 8)
    .map(r => ({ id: r.id, name: r.card.name, line: r.card.occupation }));
  return {
    town: {
      day: request.day, season: seasonOf(request.day), weekday: weekdayOf(request.day), pillars: request.pillars,
      census: request.census ?? 210, shopsOpen: 6, pupils: request.pupils ?? 9, projectsDone, projectsActive,
    },
    mode: "arrival", home, knownResidents: known,
    avoidFirst: [...RESERVED_FIRST_NAMES, ...rows.map(r => r.card.name.replace(/"[^"]*"\s*/g, "").split(" ")[0]!)].filter((v, i, a) => a.indexOf(v) === i),
    avoidFull: rows.filter(r => r.card.kind === "arrival").map(r => r.card.name),
    // The name pool leaves out every living household's surname (V03 would refuse one).
    avoidFamily: [...new Set(rows.map(r => r.card.name.replace(/"[^"]*"\s*/g, "").trim().split(/\s+/).at(-1) ?? "").filter(Boolean))].sort(),
    whim,
  };
}

async function validationContext(db: Database, worldId: string, day: number) {
  const [rows, gone, registry] = await Promise.all([
    db.select({ id: residents.id, card: residents.card }).from(residents).where(eq(residents.worldId, worldId)),
    db.select({ summary: events.summary, who: events.who, day: events.day }).from(events)
      .where(and(eq(events.worldId, worldId), eq(events.type, "departure"))),
    loadPlaceRegistry(),
  ]);
  return {
    places: registry.ids,
    residents: new Map(rows.map(r => [r.id, { name: r.card.name }])),
    reservedFull: gone.filter(e => e.day > day - RECENT_DEPARTURE_DAYS).map(e => e.summary.split(",")[0]!.trim()),
    banned: (text: string) => lexicalHits(text).map(h => h.group),
  };
}

/** One household's Haiku request (A.3.6): cached system prompt, the user message, low effort, the contract. */
export function arrivalRequest(draw: HouseholdDraw, ctx: PromptContext) {
  return {
    model: MIND_MODEL, max_tokens: arrivalMaxTokens(draw.members.length),
    // The card contract rides in the cached system prompt, not output_config.format (shared householdJson.ts: the API
    // rejects this schema's compiled grammar as too large, so the strict format failed every call).
    system: [{ type: "text" as const, text: ARRIVAL_SYSTEM_PROMPT }, { type: "text" as const, text: HOUSEHOLD_JSON_BLOCK, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: arrivalUserMessage(draw, ctx) }],
    // Thinking off, as for the census (census.ts): thinking spent the card's token budget.
    thinking: { type: "disabled" as const },
    output_config: { effort: "low" as const },
  };
}

export interface Written {
  output: ArrivalHouseholdOutput;
  source: "model" | "template";
  attempts: number;
  errors: string[];
}

async function spentToday(db: Database, worldId: string, day: number): Promise<number> {
  const [world] = await db.select({ day: worlds.aiSpendDay, usd: worlds.aiSpendUsd }).from(worlds).where(eq(worlds.id, worldId));
  return world && world.day >= day ? Number(world.usd) : 0;
}

/**
 * Write one household (A.3.1 steps 5–6): the model with two retries, then the template (A.3.8). Never throws for a
 * model failure; every call is logged to ai_log and counted against the world's spend.
 */
export async function writeHousehold(deps: ArrivalDeps, worldId: string, draw: HouseholdDraw, request: ArrivalRequest, home: PromptContext["home"] = null): Promise<Written> {
  const vctx = await validationContext(deps.db, worldId, request.day);
  const template = (): ArrivalHouseholdOutput => templateHousehold(draw, vctx, deps.seed);
  if (!deps.mind.enabled || (await spentToday(deps.db, worldId, request.day)) >= ARRIVAL_BUDGET_USD) {
    return { output: template(), source: "template", attempts: 0, errors: [deps.mind.enabled ? "budget" : "offline"] };
  }
  let errors: string[] = [];
  for (let attempt = 1; attempt <= ARRIVAL_ATTEMPTS; attempt++) {
    // A.3.8: each retry gets a fresh whim seed (§9.17's 500-entry list).
    const whim = whimFor(deps.seed, draw.id, attempt);
    const ctx = await promptContext(deps.db, worldId, request, whim, home);
    if (errors.length) ctx.validatorErrors = errors;
    const call = await callModel(budgetMind(deps.db, deps.mind, worldId, null, "arrival", request.day), arrivalRequest(draw, ctx), { timeoutMs: deps.callTimeoutMs, gate: deps.gate, signal: deps.signal });
    let verdict: ReturnType<typeof validateHousehold> | null = null;
    if (call.ok) {
      const raw = parseJsonObject(call.text);
      if (raw === undefined) verdict = { ok: false, errors: ["V01 not one JSON object"] };
      else {
        // The engine fixes what it can (lengths, tags, place ids, tie numbers, likes, Big Five); the validator judges
        // the rest, and only that is fed back on a retry.
        const repaired = repairHousehold(raw, draw, vctx);
        if (repaired.adjustments.length) deps.log.info({ worldId, household: draw.id, attempt, adjustments: repaired.adjustments }, "arrival card repaired");
        verdict = validateHousehold(repaired.output, draw, vctx);
      }
    }
    if (call.call) {
      await deps.db.insert(aiLog).values(aiLogRow({
        worldId, residentId: draw.id, kind: "arrival", promptVersion: ARRIVAL_PROMPT_VERSION,
        call: { ...call.call, attempt, validation: verdict?.ok ? "ok" : verdict ? "validator" : call.call.validation }, fallback: !verdict?.ok,
      }));
      await deps.db.transaction(async tx => {
        const [row] = await tx.select().from(worlds).where(eq(worlds.id, worldId)).for("update");
        if (row) await tx.update(worlds).set({ aiSpendDay: Math.max(row.aiSpendDay, request.day), aiSpendUsd: String((row.aiSpendDay >= request.day ? Number(row.aiSpendUsd) : 0) + call.call!.costUsd) }).where(eq(worlds.id, worldId));
      });
    }
    if (verdict?.ok) return { output: verdict.output, source: "model", attempts: attempt, errors };
    if (!call.ok) {
      // A refusal, a timeout or an API error isn't a validation problem: retrying can't fix the wording.
      if (call.failure !== "max_tokens") return { output: template(), source: "template", attempts: attempt, errors: [call.failure] };
      errors = ["V20 the answer ran past the token budget: keep every field to its limit"];
    } else errors = verdict && !verdict.ok ? verdict.errors : errors;
    deps.log.warn({ worldId, household: draw.id, attempt, errors }, "arrival card failed validation");
  }
  return { output: template(), source: "template", attempts: ARRIVAL_ATTEMPTS, errors };
}

const recentFrom = (rows: readonly Row[]): RecentHousehold[] => rows.filter(r => r.status === "committed" && r.arrivalDay)
  .sort((a, b) => a.arrivalDay! - b.arrivalDay!)
  .map(r => ({ archetype: r.archetype, day: r.arrivalDay!, ages: r.cards.map(c => c.age) }));

const counts = <T>(xs: readonly T[], key: (x: T) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};

/** Living generated residents per archetype (the oddball cap, A.3.4 rule 6). */
const aliveByArchetype = (rows: readonly Row[], living: readonly string[]): Map<string, number> => {
  const ids = new Set(living);
  const out = new Map<string, number>();
  for (const r of rows) if (r.status === "committed") {
    const n = r.cards.filter(c => ids.has(c.id)).length;
    if (n) out.set(r.archetype, (out.get(r.archetype) ?? 0) + n);
  }
  return out;
};

/** Draw the next buffer household for this world (A.3.1 steps 1–4), seeded by world, day and buffer slot. */
async function drawForBuffer(db: Database, worldId: string, seed: number, request: ArrivalRequest, slot: number, today: readonly string[]): Promise<HouseholdDraw | null> {
  const [rows, living] = await Promise.all([
    db.select().from(arrivals).where(eq(arrivals.worldId, worldId)),
    db.select({ card: residents.card }).from(residents).where(eq(residents.worldId, worldId)),
  ]);
  const generated = living.filter(r => r.card.kind === "arrival");
  const buffered = rows.filter(r => r.status === "buffered");
  // Every living resident's portrait counts as worn (MVP M-03: the Day-1 census wears 90 library busts, not only the
  // arrivals), and so do the buffered ones: the buffer shouldn't fill with one face.
  const uses = counts([...living.map(r => r.card.portrait), ...buffered.flatMap(r => r.cards.map(c => c.portrait))], x => x);
  // The buffer is written before anyone knows the homes: any free home size the town has, else a three-bed house.
  const homes = request.free_homes.length ? request.free_homes : [{ home: HOME_TOKEN, beds: 3 }];
  return drawHousehold({
    seed, day: request.day, slot: 100 + slot, facts: factsFrom(request, homes), youthShare: request.youth_share,
    recent: recentFrom(rows), alive: aliveByArchetype(rows, generated.map(r => r.card.id)),
    portraitUses: uses, today,
  });
}

/**
 * Top the world's buffer up to ARRIVAL_BUFFER_SIZE written households (background work after the night). Returns how
 * many were written. Without a model it writes nothing: a ferry day then writes templates itself.
 */
export async function refillBuffer(deps: ArrivalDeps, worldId: string, request: ArrivalRequest, size = ARRIVAL_BUFFER_SIZE): Promise<number> {
  if (!deps.mind.enabled) return 0;
  const rows = await deps.db.select().from(arrivals).where(and(eq(arrivals.worldId, worldId), eq(arrivals.status, "buffered")));
  let written = 0;
  for (let slot = rows.length; slot < size; slot++) {
    const draw = await drawForBuffer(deps.db, worldId, deps.seed, request, slot + written * 7, rows.map(r => r.archetype));
    if (!draw) break;
    const result = await writeHousehold(deps, worldId, draw, request);
    // A template in the buffer would only stand in for a better one later: keep the slot for the model.
    if (result.source !== "model") break;
    const taken = new Set((await deps.db.select({ id: residents.id }).from(residents).where(eq(residents.worldId, worldId))).map(r => r.id));
    const built = cardsFromHousehold(result.output, draw, taken);
    await deps.db.insert(arrivals).values({
      worldId, id: draw.id, status: "buffered", archetype: draw.archetype, draw, cards: built.map(b => b.card),
      dreamTemplates: built.map(b => b.dream_template), summary: result.output.household.summary, source: "model", createdDay: request.day,
    }).onConflictDoNothing();
    written++;
  }
  return written;
}

/** Does a buffered household still fit today: its gate (A.2 Requires) on today's town, and a home with its beds. */
function fits(row: Row, facts: ArrivalFacts, freeHomes: readonly { home: string; beds: number }[]): { home: string; beds: number } | null {
  const archetype = ARCHETYPES.find(a => a.id === row.archetype);
  if (!archetype?.requires(facts)) return null;
  const need = Math.max(1, Math.ceil(row.cards.length / 2));
  return [...freeHomes].filter(h => h.beds >= need).sort((a, b) => a.beds - b.beds)[0] ?? null;
}

const kinRows = (worldId: string, cards: readonly PersonaCard[]) => cards.flatMap(card => card.relationships.map(({ id, ...r }) => ({ worldId, fromId: card.id, toId: id, ...r })));

/** Insert a household's residents and ties (tier Ambient, §9.8: arrivals start Ambient). */
async function insertHousehold(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], worldId: string, cards: readonly PersonaCard[]): Promise<void> {
  const ids = new Set((await tx.select({ id: residents.id }).from(residents).where(eq(residents.worldId, worldId))).map(r => r.id));
  const fresh = cards.filter(c => !ids.has(c.id));
  if (!fresh.length) return;
  await tx.insert(residents).values(fresh.map(card => {
    const state = ResidentState.parse({ ...initialState(card, worldId), tier: "ambient", location: card.home });
    return { worldId, id: card.id, card, state, tier: "ambient" };
  }));
  const known = new Set([...ids, ...fresh.map(c => c.id)]);
  const ties = kinRows(worldId, fresh).filter(r => known.has(r.toId));
  if (ties.length) await tx.insert(relationships).values(ties).onConflictDoNothing();
}

/** The paper's line for the event log. */
const arrivalSummary = (cards: readonly PersonaCard[], homeName: string): string => {
  const [first, ...rest] = cards;
  const others = rest.length ? `, with ${rest.map(c => c.name.split(" ")[0]).join(" and ")}` : "";
  return `${first!.name}, ${first!.age}, ${first!.occupation.toLowerCase()}, has taken ${homeName}${others}.`;
};

/**
 * Commit the day's households (A.3.1 step 7) from the roll: buffered ones that fit, else templates. Idempotent per
 * day (a repeated night returns what was committed). Returns the households for the dawn package.
 */
export async function commitArrivals(deps: ArrivalDeps, worldId: string, request: ArrivalRequest): Promise<ArrivalHousehold[]> {
  const existing = await deps.db.select().from(arrivals).where(and(eq(arrivals.worldId, worldId), eq(arrivals.status, "committed"), eq(arrivals.arrivalDay, request.day)));
  if (existing.length || request.households <= 0) return existing.map(toHousehold);
  let free = [...request.free_homes];
  const names = new Map(request.free_homes.map(h => [h.home, h.name ?? h.home]));
  const out: ArrivalHousehold[] = [];
  const today: string[] = [];
  for (let slot = 0; slot < request.households && free.length; slot++) {
    const facts = factsFrom(request, free);
    const rng = hashParts(deps.seed, request.day, slot, "lean") / 4294967296;
    const youth = rng < request.youth_share;
    const buffered = (await deps.db.select().from(arrivals).where(and(eq(arrivals.worldId, worldId), eq(arrivals.status, "buffered"))))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const lean = (r: Row) => ARCHETYPES.find(a => a.id === r.archetype)?.lean === "Y";
    const pick = [...buffered.filter(r => lean(r) === youth), ...buffered.filter(r => lean(r) !== youth)]
      .find(r => today.filter(t => t === r.archetype).length < 2 && fits(r, facts, free));
    let id: string, archetype: string, cards: PersonaCard[], templates: string[], summary: string, source: "model" | "template", draw: unknown;
    let home: { home: string; beds: number };
    if (pick) {
      home = fits(pick, facts, free)!;
      // Names may have been taken since it was written (another household committed first): re-id the clashes.
      const taken = new Set((await deps.db.select({ id: residents.id }).from(residents).where(eq(residents.worldId, worldId))).map(r => r.id));
      cards = pick.cards.map(c => bindHome(c, home.home));
      if (cards.some(c => taken.has(c.id))) {
        const rebuilt = cardsFromHousehold(templateHousehold(pick.draw as HouseholdDraw, { residents: new Map() }, deps.seed), pick.draw as HouseholdDraw, taken, home.home);
        cards = cards.map((c, i) => (taken.has(c.id) ? { ...c, id: rebuilt[i]!.card.id, sprite: rebuilt[i]!.card.id } : c));
      }
      ({ id, archetype, summary, source, draw } = pick);
      templates = pick.dreamTemplates;
    } else {
      const fresh = drawHousehold({
        seed: deps.seed, day: request.day, slot, facts, youthShare: request.youth_share, recent: [], alive: new Map(),
        // Every living resident's portrait is worn (the Day-1 census's busts too, MVP M-03).
        portraitUses: counts(await deps.db.select({ portrait: sql<string>`${residents.card}->>'portrait'` }).from(residents).where(eq(residents.worldId, worldId)), r => r.portrait),
        today,
      });
      if (!fresh) break;
      home = [...free].filter(h => h.beds >= fresh.beds).sort((a, b) => a.beds - b.beds)[0] ?? free[0]!;
      // The ferry doesn't wait: on the spot it's always the template (A.3.8), the model only ever writes ahead.
      const vctx = await validationContext(deps.db, worldId, request.day);
      const output = templateHousehold(fresh, vctx, deps.seed);
      const taken = new Set(vctx.residents.keys());
      const built = cardsFromHousehold(output, fresh, taken, home.home);
      id = fresh.id; archetype = fresh.archetype; cards = built.map(b => b.card); templates = built.map(b => b.dream_template);
      summary = output.household.summary; source = "template"; draw = fresh;
    }
    free = free.filter(h => h.home !== home.home);
    today.push(archetype);
    await deps.db.transaction(async tx => {
      await insertHousehold(tx, worldId, cards);
      await tx.insert(arrivals).values({
        worldId, id, status: "committed", archetype, draw, cards, dreamTemplates: templates, summary, source,
        createdDay: request.day - 1, arrivalDay: request.day, home: home.home,
      }).onConflictDoUpdate({ target: [arrivals.worldId, arrivals.id], set: { status: "committed", cards, arrivalDay: request.day, home: home.home } });
      await tx.insert(events).values({
        worldId, id: `arrival_${id}`, day: request.day, minute: 8 * 60, type: "arrival", wherePlace: "wharf.ferry_slip",
        who: cards.map(c => c.id), importance: ARRIVAL_EVENT_IMPORTANCE, tags: ["arrival", archetype],
        summary: arrivalSummary(cards, names.get(home.home) ?? home.home),
      }).onConflictDoNothing();
    });
    out.push({
      id, archetype, day: request.day, home: home.home, summary, generated_by: source,
      residents: cards.map((card, i) => ({ card, household: id, archetype, arrived_day: request.day, dream_template: templates[i] ?? `${archetype}.d1` })),
    });
  }
  return out;
}

function toHousehold(r: Row): ArrivalHousehold {
  return {
    id: r.id, archetype: r.archetype, day: r.arrivalDay ?? r.createdDay, home: r.home ?? HOME_TOKEN, summary: r.summary, generated_by: r.source,
    residents: r.cards.map((card, i) => ({ card, household: r.id, archetype: r.archetype, arrived_day: r.arrivalDay ?? r.createdDay, dream_template: r.dreamTemplates[i] ?? `${r.archetype}.d1` })),
  };
}

/** The households that land on `day` (the dawn package's `arrivals`). */
export async function arrivalsFor(db: Database, worldId: string, day: number): Promise<ArrivalHousehold[]> {
  const rows = await db.select().from(arrivals).where(and(eq(arrivals.worldId, worldId), eq(arrivals.status, "committed"), eq(arrivals.arrivalDay, day)));
  return rows.sort((a, b) => a.id.localeCompare(b.id)).map(toHousehold);
}

/** Every generated resident the world has (the client re-sends households the server lacks). */
export async function generatedIds(db: Database, worldId: string): Promise<string[]> {
  const rows = await db.select({ id: residents.id, card: residents.card }).from(residents).where(eq(residents.worldId, worldId));
  return rows.filter(r => r.card.kind === "arrival").map(r => r.id).sort();
}

/** Quiet Mode households from the client (written from templates while the server was out of reach). */
export async function adoptHouseholds(db: Database, worldId: string, households: readonly ArrivalHousehold[]): Promise<number> {
  let adopted = 0;
  for (const h of households) {
    const cards = h.residents.map(r => PersonaCard.parse({ ...r.card, kind: "arrival" }));
    await db.transaction(async tx => {
      const [row] = await tx.select({ id: arrivals.id }).from(arrivals).where(and(eq(arrivals.worldId, worldId), eq(arrivals.id, h.id)));
      if (row) return;
      // The server already landed its own households that morning (the client missed the dawn package): keeping both
      // would put two families in one house.
      const [same] = await tx.select({ id: arrivals.id }).from(arrivals).where(and(eq(arrivals.worldId, worldId), eq(arrivals.status, "committed"), eq(arrivals.arrivalDay, h.day), eq(arrivals.home, h.home)));
      if (same) return;
      await insertHousehold(tx, worldId, cards);
      await tx.insert(arrivals).values({
        worldId, id: h.id, status: "committed", archetype: h.archetype, draw: { adopted: true }, cards, dreamTemplates: h.residents.map(r => r.dream_template),
        summary: h.summary, source: "template", createdDay: h.day, arrivalDay: h.day, home: h.home,
      });
      adopted++;
    });
  }
  return adopted;
}

/** Leavers the client reports (§6.4): their rows, ties and plans go; a `departure` event stays for the paper. */
export async function departResidents(db: Database, worldId: string, ids: readonly string[], day: number): Promise<number> {
  if (!ids.length) return 0;
  return db.transaction(async tx => {
    // Only generated residents ever leave in Spring (the cast is protected).
    const rows = (await tx.select({ id: residents.id, card: residents.card }).from(residents)
      .where(and(eq(residents.worldId, worldId), inArray(residents.id, [...ids])))).filter(r => r.card.kind === "arrival");
    if (!rows.length) return 0;
    const gone = rows.map(r => r.id);
    await tx.delete(relationships).where(and(eq(relationships.worldId, worldId), or(inArray(relationships.fromId, gone), inArray(relationships.toId, gone))));
    await tx.delete(plans).where(and(eq(plans.worldId, worldId), inArray(plans.residentId, gone)));
    // Their open asks go with them (a Favor nobody is left to thank for).
    await tx.update(favors).set({ status: "expired" }).where(and(eq(favors.worldId, worldId), inArray(favors.residentId, gone), inArray(favors.status, ["proposed", "accepted"])));
    await tx.delete(residents).where(and(eq(residents.worldId, worldId), inArray(residents.id, gone)));
    await tx.insert(events).values(rows.map(r => ({
      worldId, id: `departure_${r.id}_${day}`, day, minute: 10 * 60, type: "departure", wherePlace: "wharf.ferry_slip",
      who: [r.id], importance: ARRIVAL_EVENT_IMPORTANCE, tags: ["departure"], summary: `${r.card.name}, left on the Gannet.`,
    }))).onConflictDoNothing();
    return gone.length;
  });
}

/** A Leaving Notice as memories (§6.4): the resident's decision, and a word to each friend. */
export async function noticeMemories(db: Database, worldId: string, day: number, notices: readonly NoticeIn[]): Promise<number> {
  if (!notices.length) return 0;
  const ids = [...new Set(notices.flatMap(n => [n.resident, ...(n.friends ?? [])]))];
  const rows = await db.select({ id: residents.id, card: residents.card }).from(residents).where(and(eq(residents.worldId, worldId), inArray(residents.id, ids)));
  const byId = new Map(rows.map(r => [r.id, r.card]));
  const values: (typeof memories.$inferInsert)[] = [];
  for (const n of notices) {
    const card = byId.get(n.resident);
    if (!card) continue;
    const ferry = `${weekdayOf(n.deadline)}'s boat`;
    values.push({
      worldId, id: `notice_${n.resident}_${n.day}`, residentId: n.resident, day, minute: 22 * 60, kind: "felt",
      text: `I've been circling it for days and I've decided: I'm leaving Monde on ${ferry}, unless something changes.`,
      who: [n.resident], wherePlace: card.home, importance: NOTICE_MEMORY_IMPORTANCE, valence: -3, sourceEvent: null,
    });
    for (const friend of n.friends ?? []) {
      if (!byId.has(friend) || friend === n.resident) continue;
      values.push({
        worldId, id: `notice_${n.resident}_${n.day}_${friend}`, residentId: friend, day, minute: 21 * 60, kind: "heard",
        text: `${card.name.split(" ")[0]} told me they're leaving Monde on ${ferry}.`,
        who: [friend, n.resident], wherePlace: card.home, importance: NOTICE_FRIEND_IMPORTANCE, valence: -2, sourceEvent: null,
      });
    }
  }
  if (values.length) await db.insert(memories).values(values).onConflictDoNothing();
  return values.length;
}
