import { LeavingFavorNotice } from "@monde/shared";
import { feasibleFavor } from "./favorFeasibility.js";
import { favors } from "../db/schema.js";
import { runPress } from "./press.js";
import { compactNight } from "./compaction.js";
import { ArrivalHousehold } from "@monde/shared";
import { ArrivalRequest, NoticeIn, adoptHouseholds, commitArrivals, departResidents, noticeMemories, refillBuffer } from "./arrivals.js";
/**
 * The night pass (GDD §9.7, §9.8; §19.4 POST /v1/worlds/:w/night; MVP M-07).
 *
 * When the player sleeps, the client posts the night for Day N. The runner:
 *   1. claims the night: worlds.day becomes N + 1 and minute 360, atomically, so a night runs once
 *      (a repeat of the same night reports its status; an older one is a 409);
 *   2. recomputes the tiers (tiers.ts);
 *   3. queues the jobs, Core first, then Acquainted, then Ambient:
 *        core        reflect, then a model plan for N + 1
 *        acquainted  reflect if they had an importance-5+ memory today or it's their every-third-day turn,
 *                    then a model plan
 *        ambient     reflect only if an importance-6+ memory touched them today; their plan is the template,
 *                    computed at dawn
 *      Residents doing both use one call: reflect first, then plan with tonight's conclusions. Model calls take a slot
 *      in the world's semaphore (8 in flight, §9.8), Core before Acquainted before Ambient;
 *      Before any of them, the friendship pass (G-13, §9.11; ties.ts, encounters.ts): neglect, weekly drift and
 *      tonight's encounters from Day N's plans. Encounter calls queue first, each at the priority of its better-
 *      detailed side (Core first), and a resident's reflection waits for their own encounters so it can mention
 *      them. When every job is done, the romance ladder runs (G-12, romance.ts: feelings from time together, who
 *      starts courting) and label changes are recorded as tie milestones for the dawn. Tomorrow's birthday parties
 *      (birthdays.ts) are scheduled before any of it, so tonight's plans see them;
 *   4. answers when everything is done or after 4 s, whichever comes first (§9.8 night pass budget, §19.7).
 *      Whatever isn't finished keeps running in the background and is still persisted; the response says how
 *      many residents are done and how many are pending. Until a plan lands, the dawn package serves the
 *      routine template for that resident (§9.8 lag tolerance).
 */
import { and, count, eq, inArray, lte, max } from "drizzle-orm";
import { z } from "zod";
import { CLIENT_EVENT_BATCH_LIMIT, TownEvent, type EventIngestionResult } from "@monde/shared";
import { events, memories, plans, residents, worlds } from "../db/schema.js";
import { ensureRoster, type WorldDatabase } from "../worlds/createWorld.js";
import { eventTransaction, ingestClientEvents, ingestInTransaction } from "./eventIngestion.js";
import { TIER_ORDER, persistRuleEncounters, resolveEncounter, ruleOutcome, type Encounter } from "./encounters.js";
import type { MindClient } from "./mindClient.js";
import { SILENT_LOG, type NightJobDeps, type NightLog, type NightWorld } from "./nightJob.js";
import { loadPlaceRegistry } from "./places.js";
import { combinedNight } from "./combinedNight.js";
import { planResident } from "./plan.js";
import { playerView, type PlayerProfile } from "./player.js";
import { clockTime } from "./promptBuilder.js";
import { reflectResident } from "./reflect.js";
import { WorldSemaphores } from "./semaphore.js";
import { DAY_START } from "./templatePlan.js";
import { prepareFriendship, recordMilestones, type FriendshipNight } from "./ties.js";
import { runRomance } from "./romance.js";
import { scheduleBirthdayParties } from "./birthdays.js";
import { countTiers, recomputeTiers, type Tier, type TierCounts } from "./tiers.js";

/** §9.8, §19.7: the night transition shows for at most 4 seconds. */
export const NIGHT_BUDGET_MS = 4000;
/** §9.8: 8 in-flight model calls per world. */
export const NIGHT_CONCURRENCY = 8;
/**
 * GDD-GAP: §9.8 bounds the response, not each call. A plan or reflection is ≤ 900 output tokens at effort "low",
 * a few seconds at Haiku speed; 30 s lets a slow call finish in the background without letting it hang forever.
 */
export const NIGHT_CALL_TIMEOUT_MS = 30_000;
/**
 * GDD-GAP: on shutdown, background night work gets this long to finish before its calls are aborted (and fall
 * back). Kept under Fly's default 5 s kill timeout.
 */
export const NIGHT_CLOSE_GRACE_MS = 4000;
/** §9.8: Acquainted residents reflect daily after an importance-5+ memory; Ambient ones only after a 6+. */
export const ACQUAINTED_REFLECT_IMPORTANCE = 5;
export const AMBIENT_REFLECT_IMPORTANCE = 6;
/**
 * GDD-GAP: §9.15 budgets "15 event reflections" for Ambient residents a day without making it a rule. With the Day-1
 * census (MVP M-03) a town event can touch most of the 190 Ambient residents at once, so tonight's Ambient reflections
 * are capped at 15, the most important memories first (then by id). Core and Acquainted are never capped.
 */
export const AMBIENT_REFLECTIONS_PER_NIGHT = 15;

/** GDD-GAP: defaults when the client sends no town facts: the Day-1 Pillars (§6.1) and census (§3). */
export const DAY_ONE_PILLARS = { prosperity: 18, safety: 30, spirit: 22, charm: 25 } as const;
export const DAY_ONE_CENSUS = 210;
/** GDD-GAP: no weather sent → the plan prompt says so rather than inventing one. */
export const UNKNOWN_FORECAST = "unknown";
/** GDD-GAP: §9.17 lists "events" among the town facts without a count; the 8 most important keep it short. */
const TOWN_EVENTS = 8;

const Pillar = z.number().min(0).max(100);
export const NightBody = z.object({
  day: z.number().int().min(1).max(100_000),
  leaving: z.array(LeavingFavorNotice).max(500).optional(),
  /** G-02: the town engine's arrival roll for the coming day, with the facts the draw reads (§6.4, A.3). */
  arrivals: ArrivalRequest.optional(),
  /** G-02: households the client wrote in Quiet Mode, for the server to adopt (A.3.8). */
  adopt: z.array(ArrivalHousehold).max(20).optional(),
  /** G-02: generated residents who left on the ferry during the night's day (§6.4). */
  departed: z.array(z.string().max(80)).max(50).optional(),
  /** G-02: Leaving Notices given at this dawn: memories for the resident and their friends (§6.4). */
  notices: z.array(NoticeIn).max(50).optional(),
  /** Today's town events (for the reflections' town facts) and tomorrow's scheduled ones (for the plans). */
  events: z.array(TownEvent).max(500).optional(),
  /** Offline log; identical envelope elements to POST /events. Per-item rejections are returned as ingestion. */
  client_events: z.array(z.unknown()).max(CLIENT_EVENT_BATCH_LIMIT).optional(),
  town: z.object({
    pillars: z.object({ prosperity: Pillar, safety: Pillar, spirit: Pillar, charm: Pillar }).optional(),
    census: z.number().int().min(0).max(100_000).optional(),
    fund: z.number().finite().optional(),
    weather_tomorrow: z.string().trim().min(1).max(40).optional(),
  }).optional(),
});
export type NightBody = z.infer<typeof NightBody>;

// ---------------------------------------------------------------------------------------------------------------
// Who does what tonight (pure)
// ---------------------------------------------------------------------------------------------------------------

export interface NightJob {
  residentId: string;
  tier: Tier;
  reflect: boolean;
  /** A model plan for tomorrow. Ambient residents get the template at dawn instead. */
  plan: boolean;
}

/**
 * §9.8 / Q-03: quiet Acquainted residents reflect on days divisible by three.
 * Importance-triggered reflections still run on intervening nights.
 */
export const acquaintedTurn = (day: number): boolean => day % 3 === 0;

/**
 * The night's jobs in queue order (Core, Acquainted, Ambient; by id within a tier). Ambient residents with nothing to
 * do are left out, and at most `ambientCap` reflect (AMBIENT_REFLECTIONS_PER_NIGHT, the most important first).
 */
export function nightJobs(tiers: ReadonlyMap<string, Tier>, topImportance: ReadonlyMap<string, number>, day: number, ambientCap = AMBIENT_REFLECTIONS_PER_NIGHT): NightJob[] {
  const jobs: NightJob[] = [];
  const ambient: { residentId: string; top: number }[] = [];
  for (const [residentId, tier] of tiers) {
    const top = topImportance.get(residentId) ?? 0;
    if (tier === "core") jobs.push({ residentId, tier, reflect: true, plan: true });
    else if (tier === "acquainted") {
      jobs.push({ residentId, tier, reflect: top >= ACQUAINTED_REFLECT_IMPORTANCE || acquaintedTurn(day), plan: true });
    } else if (top >= AMBIENT_REFLECT_IMPORTANCE) ambient.push({ residentId, top });
  }
  ambient.sort((a, b) => b.top - a.top || (a.residentId < b.residentId ? -1 : 1));
  for (const a of ambient.slice(0, Math.max(0, ambientCap))) jobs.push({ residentId: a.residentId, tier: "ambient", reflect: true, plan: false });
  return jobs.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.residentId < b.residentId ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------------------------

export interface NightRunnerOptions {
  db: WorldDatabase;
  mind: MindClient;
  budgetMs?: number;
  callTimeoutMs?: number;
  concurrency?: number;
  closeGraceMs?: number;
  /** Content root with places/places.yaml (MONDE_CONTENT_DIR). */
  contentDir?: string;
  log?: NightLog;
  now?: () => number;
}

export interface NightReport {
  ingestion?: EventIngestionResult;
  day: number;
  next_day: number;
  /** Residents whose night work has finished (model output or fallback). */
  done: number;
  /** Residents whose night work is still running in the background. */
  pending: number;
  /** True once every job (and the setup before them) has finished. */
  complete: boolean;
  tiers: TierCounts | null;
  elapsed_ms: number;
  /** Set when this night had already been started: nothing new was run. */
  already?: true;
}

export type NightResult =
  | { status: 200; body: NightReport }
  | { status: 409 | 503; body: { error: string; day: number; world_day?: number | null } };

interface NightRun {
  worldId: string;
  day: number;
  finished: boolean;
  tiers: TierCounts | null;
  jobs: Map<string, "pending" | "done">;
  work: Promise<void>;
  ingestion?: EventIngestionResult;
}

/** Resolve after `promise` settles or `ms` pass, whichever is first. */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }),
  ]).finally(() => clearTimeout(timer));
}

interface EventLine { id: string; day: number; minute: number; where: string; summary: string; importance: number }
const eventLine = (e: EventLine): string => `${clockTime(e.minute)} at ${e.where}: ${e.summary}`;

export class NightRunner {
  private readonly runs = new Map<string, Map<number, NightRun>>();
  private readonly active = new Set<NightRun>();
  private readonly gates: WorldSemaphores;
  /** G-02: arrival-buffer refills running after their night (never part of the night's own work). */
  private readonly refills = new Map<string, Promise<void>>();
  private readonly controller = new AbortController();
  private readonly log: NightLog;
  private readonly now: () => number;
  private closing = false;

  constructor(private readonly options: NightRunnerOptions) {
    this.gates = new WorldSemaphores(options.concurrency ?? NIGHT_CONCURRENCY);
    this.log = options.log ?? SILENT_LOG;
    this.now = options.now ?? (() => performance.now());
  }

  /** Run the night for `body.day`. Resolves within the budget; unfinished work continues in the background. */
  async start(worldId: string, body: NightBody): Promise<NightResult> {
    const started = this.now();
    const { day } = body;
    const elapsed = () => Math.round(this.now() - started);
    // A repeat of the world's latest night reports its live status. An older night this process ran is long past:
    // the database says so (409), and its run stays tracked for the dawn's pending count.
    const byDay = this.runs.get(worldId);
    const existing = byDay?.get(day);
    if (existing) {
      if (Math.max(...byDay!.keys()) === day) {
        const ingestion = body.client_events ? await ingestClientEvents(this.options.db, worldId, body.client_events, { contentDir: this.options.contentDir, nightDay: day }) : undefined;
        return { status: 200, body: { ...this.report(existing, elapsed()), ingestion, already: true } };
      }
      return this.alreadyPassed(worldId, day, elapsed());
    }
    if (this.closing) return { status: 503, body: { error: "the server is shutting down", day } };

    // Registered before the first await, so a concurrent repeat finds it instead of racing the claim.
    const run: NightRun = { worldId, day, finished: false, tiers: null, jobs: new Map(), work: Promise.resolve() };
    this.track(run);
    let claimed: boolean;
    try {
      const claim = await this.claim(worldId, day, body.client_events);
      claimed = claim.claimed;
      run.ingestion = claim.ingestion;
    } catch (error) {
      this.untrack(run);
      throw error;
    }
    if (!claimed) {
      this.untrack(run);
      const result = await this.alreadyPassed(worldId, day, elapsed());
      if (result.status === 200) result.body.ingestion = run.ingestion;
      return result;
    }

    this.active.add(run);
    run.work = this.execute(run, body)
      .catch((error: unknown) => { this.log.error({ err: error, worldId, day }, "night pass failed"); })
      .finally(() => { run.finished = true; this.active.delete(run); });
    await within(run.work, (this.options.budgetMs ?? NIGHT_BUDGET_MS) - elapsed());
    const report = this.report(run, elapsed());
    if (report.pending > 0 || !report.complete) {
      this.log.info({ worldId, day, done: report.done, pending: report.pending }, "night pass continues in the background");
    }
    return { status: 200, body: report };
  }

  /** Residents still being worked on for the plans of `planDay` (the night of planDay - 1), from this process. */
  status(worldId: string, planDay: number): { pending: number; complete: boolean } {
    const run = this.runs.get(worldId)?.get(planDay - 1);
    if (!run) return { pending: 0, complete: true };
    const { pending, complete } = this.report(run, 0);
    return { pending, complete };
  }

  /** Test and shutdown hook: resolves when every night run of `worldId` (or of every world) has finished. */
  async idle(worldId?: string): Promise<void> {
    const runs = [...this.active].filter((run) => worldId === undefined || run.worldId === worldId);
    await Promise.all(runs.map((run) => run.work));
  }

  /** Test hook: resolves when the world's arrival-buffer refill (started after its last night) has finished. */
  async refilled(worldId: string): Promise<void> {
    await this.refills.get(worldId);
  }

  /** Stop taking nights, give background work `graceMs` to finish, then abort its calls (they fall back). */
  async close(graceMs = this.options.closeGraceMs ?? NIGHT_CLOSE_GRACE_MS): Promise<void> {
    this.closing = true;
    if (this.active.size === 0 && this.refills.size === 0) return;
    const all = Promise.all([this.idle(), ...this.refills.values()]);
    await within(all, graceMs);
    if (this.active.size > 0) {
      this.log.warn({ runs: this.active.size }, "aborting unfinished night work for shutdown");
      this.controller.abort();
      await within(all, 2000);
    }
  }

  // -------------------------------------------------------------------------------------------------------------

  private track(run: NightRun): void {
    let byDay = this.runs.get(run.worldId);
    if (!byDay) { byDay = new Map(); this.runs.set(run.worldId, byDay); }
    byDay.set(run.day, run);
    // Keep the last few nights for status; older finished ones go.
    for (const [day, old] of byDay) if (day < run.day - 2 && old.finished) byDay.delete(day);
  }

  private untrack(run: NightRun): void {
    const byDay = this.runs.get(run.worldId);
    if (byDay?.get(run.day) === run) byDay.delete(run.day);
    if (byDay?.size === 0) this.runs.delete(run.worldId);
  }

  /** Advance the world past Day N if it isn't already. True if this call did it. */
  private async claim(worldId: string, day: number, batch?: unknown[]): Promise<{ claimed: boolean; ingestion?: EventIngestionResult }> {
    return eventTransaction(this.options.db, async tx => {
      // Ingestion and the day claim commit together, before reflections read any memory or flags.
      const ingestion = batch ? await ingestInTransaction(tx, worldId, batch, { contentDir: this.options.contentDir, nightDay: day }) : undefined;
      const rows = await tx.update(worlds).set({ day: day + 1, minute: DAY_START })
        .where(and(eq(worlds.id, worldId), lte(worlds.day, day))).returning();
      return { claimed: rows.length > 0, ingestion };
    });
  }

  /** The night was claimed before (by another request, process or an earlier run): report what's stored. */
  private async alreadyPassed(worldId: string, day: number, elapsedMs: number): Promise<NightResult> {
    const { db } = this.options;
    const [world] = await db.select({ day: worlds.day }).from(worlds).where(eq(worlds.id, worldId));
    if (world?.day !== day + 1) {
      return { status: 409, body: { error: "that night has already passed", day, world_day: world?.day ?? null } };
    }
    const [stored] = await db.select({ n: count() }).from(plans).where(and(eq(plans.worldId, worldId), eq(plans.day, day + 1)));
    return {
      status: 200,
      body: { day, next_day: day + 1, done: stored?.n ?? 0, pending: 0, complete: true, tiers: null, elapsed_ms: elapsedMs, already: true },
    };
  }

  private report(run: NightRun, elapsedMs: number): NightReport {
    let done = 0;
    let pending = 0;
    for (const state of run.jobs.values()) {
      if (state === "done") done++;
      else pending++;
    }
    return { day: run.day, next_day: run.day + 1, done, pending, complete: run.finished, tiers: run.tiers, elapsed_ms: elapsedMs, ingestion: run.ingestion };
  }

  private async execute(run: NightRun, body: NightBody): Promise<void> {
    const { db } = this.options;
    const { worldId, day } = run;
    // MVP M-03: a world made before the Day-1 census gets its residents before its first night here (a no-op after).
    await ensureRoster(db, worldId, this.options.contentDir)
      .catch((error: unknown) => { this.log.error({ err: error, worldId, day }, "roster backfill failed"); });
    await compactNight(this.deps(worldId, 0), worldId, day);
    // G-02: Quiet Mode households join and yesterday's leavers go before the tiers and the night's jobs see the town.
    const [seedRow] = await db.select({ seed: worlds.seed }).from(worlds).where(eq(worlds.id, worldId));
    const seed = seedRow?.seed ?? 0;
    try {
      if (body.adopt?.length) await adoptHouseholds(db, worldId, body.adopt);
      if (body.departed?.length) await departResidents(db, worldId, body.departed, day);
      if (body.notices?.length) await noticeMemories(db, worldId, day, body.notices);
      // Tomorrow's households, from the buffer (or templates), committed first so the very first dawn read has them:
      // it's database work only, the model never writes on a ferry day's clock.
      if (body.arrivals) await commitArrivals({ ...this.deps(worldId, 0), seed }, worldId, body.arrivals);
    } catch (error) {
      this.log.error({ err: error, worldId, day }, "arrivals bookkeeping failed");
    }
    const tiers = await recomputeTiers(db, worldId, day);
    run.tiers = countTiers(tiers);
    // G-12: tomorrow's birthday parties, before the town's events are read, so tonight's plans and the Lantern see them.
    await scheduleBirthdayParties(db, worldId, day)
      .catch((error: unknown) => { this.log.error({ err: error, worldId, day }, "scheduling birthday parties failed"); });

    const [registry, ids, tops, stored] = await Promise.all([
      loadPlaceRegistry(this.options.contentDir),
      db.select({ id: residents.id }).from(residents).where(eq(residents.worldId, worldId)),
      db.select({ residentId: memories.residentId, top: max(memories.importance) }).from(memories)
        .where(and(eq(memories.worldId, worldId), eq(memories.day, day), eq(memories.archived, false)))
        .groupBy(memories.residentId),
      db.select().from(events).where(and(eq(events.worldId, worldId), inArray(events.day, [day, day + 1]))),
    ]);

    // Town events: the client's batch plus anything already logged (M-06), one line each.
    const byId = new Map<string, EventLine>();
    for (const e of stored) byId.set(e.id, { id: e.id, day: e.day, minute: e.minute, where: e.wherePlace, summary: e.summary, importance: e.importance });
    for (const e of body.events ?? []) byId.set(e.id, { id: e.id, day: e.day, minute: e.minute, where: e.where, summary: e.summary, importance: e.importance });
    const all = [...byId.values()];
    const today = all.filter((e) => e.day === day)
      .sort((a, b) => b.importance - a.importance || a.minute - b.minute).slice(0, TOWN_EVENTS)
      .sort((a, b) => a.minute - b.minute);
    const tomorrow = all.filter((e) => e.day === day + 1).sort((a, b) => a.minute - b.minute);

    const town = body.town ?? {};
    const [worldRow] = await db.select({ flags: worlds.storyFlags, player: worlds.player }).from(worlds).where(eq(worlds.id, worldId));
    const fellow = playerView(worldRow?.player as PlayerProfile | null | undefined);
    const world: NightWorld = {
      worldId,
      day,
      residentIds: new Set(ids.map((r) => r.id)),
      places: registry,
      town: { pillars: town.pillars ?? DAY_ONE_PILLARS, census: town.census ?? DAY_ONE_CENSUS, events: today.map(eventLine) },
      forecast: town.weather_tomorrow ?? UNKNOWN_FORECAST,
      eventsTomorrow: tomorrow.map(eventLine),
      flags: worldRow?.flags ?? [],
      fellow: { name: fellow.name, pronouns: fellow.pronouns },
    };
    const jobs = nightJobs(tiers, new Map(tops.map((t) => [t.residentId, t.top ?? 0])), day);
    for (const job of jobs) run.jobs.set(job.residentId, "pending");

    // G-13: neglect, drift and tonight's encounters. Friendship never holds the night up: if it fails, the
    // reflections and plans run without it.
    let friendship: FriendshipNight | null = null;
    try {
      friendship = await prepareFriendship(db, { worldId, day, tiers, modelEnabled: this.options.mind.enabled, flags: world.flags });
    } catch (error) {
      this.log.error({ err: error, worldId, day }, "friendship pass failed; reflections run without encounters");
    }
    const waits = new Map<string, Promise<void>[]>();
    const wait = (encounter: Encounter, work: Promise<void>) => {
      for (const id of [encounter.a, encounter.b]) waits.set(id, [...(waits.get(id) ?? []), work]);
    };
    // The rule-mode encounters (Ambient pairs, past the night's model cap, or no API key) are written together in one
    // transaction (MVP M-03: a 212-resident night has a couple of hundred); the model's one by one, as before.
    const tonight = friendship?.encounters ?? [];
    const byRule = tonight.filter((e) => e.mode === "rule" || !this.options.mind.enabled);
    const bulk = byRule.length ? this.runRuleEncounters(run, friendship!, byRule) : null;
    if (bulk) for (const e of byRule) wait(e, bulk);
    const encounters = [...(bulk ? [bulk] : []), ...tonight.filter((e) => !byRule.includes(e)).map((encounter) => {
      const work = this.runEncounter(run, friendship!, encounter);
      wait(encounter, work);
      return work;
    })];
    await Promise.all([...encounters, ...jobs.map((job) => this.runJob(run, world, job, waits.get(job.residentId) ?? []))]);

    // G-12: the romance ladder reads tonight's encounters and reflections; the Lantern below prints who is courting.
    await runRomance(db, worldId, day)
      .then((romance) => { if (romance.courting.length) this.log.info({ worldId, day, courting: romance.courting.map((c) => `${c.a}+${c.b}`) }, "residents started courting"); })
      .catch((error: unknown) => { this.log.error({ err: error, worldId, day }, "romance ladder failed"); });
    if (friendship) {
      await recordMilestones(db, worldId, day, friendship.before)
        .catch((error: unknown) => { this.log.error({ err: error, worldId, day }, "recording tie milestones failed"); });
    }
    for (const notice of body.leaving ?? []) {
      if (notice.deadline < day + 1 || notice.deadline > day + 3) continue;
      await eventTransaction(db, async tx => {
        await tx.select({ id:worlds.id }).from(worlds).where(eq(worlds.id,worldId)).for('update');
        const id = `last_chance_${notice.resident}_${notice.deadline}`;
        const contract = await feasibleFavor(tx, worldId, notice.resident, day + 1, id, { template: 'last_chance', target: notice.resident, text: 'Before the ferry goes, could you help me put one thing right?' }, notice);
        const live = await tx.select().from(favors).where(eq(favors.worldId, worldId));
        const open = live.filter(f => ['proposed','accepted'].includes(f.status) && f.expiresDay >= day + 1);
        if (contract && open.length < 6 && !open.some(f => f.residentId === notice.resident)) await tx.insert(favors).values({ worldId, id, residentId: notice.resident, template: contract.template, target: contract.target, text: contract.text, createdDay: day + 1, expiresDay: notice.deadline, status: 'proposed', reward: contract }).onConflictDoNothing();
      });
    }
    await runPress(this.deps(worldId, 0), world, body.town?.fund);
    if (body.arrivals) this.refill(worldId, seed, body.arrivals);
  }

  /** Top the world's arrival buffer up in the background, at the lowest priority (one refill per world at a time). */
  private refill(worldId: string, seed: number, request: ArrivalRequest): void {
    if (this.closing || this.refills.has(worldId) || !this.options.mind.enabled) return;
    const work = refillBuffer({ ...this.deps(worldId, 3), seed }, worldId, request)
      .then(() => undefined, (error: unknown) => { this.log.error({ err: error, worldId }, "arrival buffer refill failed"); })
      .finally(() => { this.refills.delete(worldId); });
    this.refills.set(worldId, work);
  }

  private deps(worldId: string, priority: number): NightJobDeps {
    const signal = this.controller.signal;
    return {
      db: this.options.db,
      mind: this.options.mind,
      gate: (task) => this.gates.run(worldId, task, priority, signal),
      signal,
      callTimeoutMs: this.options.callTimeoutMs ?? NIGHT_CALL_TIMEOUT_MS,
      log: this.log,
      now: this.options.now,
    };
  }

  /** Tonight's rule-mode encounters in one transaction. Never rejects: a failure is logged and the reflections go ahead. */
  private async runRuleEncounters(run: NightRun, friendship: FriendshipNight, list: readonly Encounter[]): Promise<void> {
    const started = this.now();
    const items = list.map((encounter) => {
      const [a, b] = friendship.sides(encounter);
      // The Ambient rule, and the news each side carried (resolveEncounter's rule outcome).
      return { encounter, outcome: { ...ruleOutcome(a.state.mood.valence, b.state.mood.valence, encounter.mean), news: [...a.news, ...b.news].map((n) => n.id) } };
    });
    await persistRuleEncounters(this.options.db, friendship.context(list[0]!), items)
      .then(() => { this.log.info({ worldId: run.worldId, day: run.day, encounters: list.length, ms: Math.round(this.now() - started) }, "rule encounters written"); })
      .catch((error: unknown) => { this.log.error({ err: error, worldId: run.worldId, day: run.day, encounters: list.length }, "rule encounters failed"); });
  }

  /** One encounter. Never rejects: a failure is logged and the residents' reflections go ahead. */
  private async runEncounter(run: NightRun, friendship: FriendshipNight, encounter: Encounter): Promise<void> {
    const [a, b] = friendship.sides(encounter);
    await resolveEncounter(this.deps(run.worldId, encounter.priority), friendship.context(encounter), encounter, a, b)
      .catch((error: unknown) => {
        this.log.error({ err: error, worldId: run.worldId, day: run.day, pair: `${encounter.a}+${encounter.b}` }, "encounter failed");
      });
  }

  private async runJob(run: NightRun, world: NightWorld, job: NightJob, encounters: readonly Promise<void>[]): Promise<void> {
    const deps = this.deps(run.worldId, TIER_ORDER[job.tier]);
    const context = { worldId: run.worldId, day: run.day, residentId: job.residentId, tier: job.tier };
    try {
      // Tonight's reflection reads tonight's encounters.
      await Promise.all(encounters);
      if (job.reflect && job.plan && deps.mind.enabled) {
        await combinedNight(deps, world, job.residentId)
          .catch((error: unknown) => { this.log.error({ err: error, ...context }, "combined night failed"); });
        return;
      }
      if (job.reflect) {
        await reflectResident(deps, world, job.residentId)
          .catch((error: unknown) => { this.log.error({ err: error, ...context }, "reflection failed"); });
      }
      if (job.plan) {
        await planResident(deps, world, job.residentId, { model: true })
          .catch((error: unknown) => { this.log.error({ err: error, ...context }, "plan failed"); });
      }
    } finally {
      run.jobs.set(job.residentId, "done");
    }
  }
}
