import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { budgetCalls, aiLog, meta, residents, worlds } from '../db/schema.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import type { Config } from '../config.js';
import { MindUnavailableError, MindStreamError, tokensOf, type MindClient } from './mindClient.js';
import { costUsd } from './pricing.js';

/** What an Ambient resident keeps doing past 100% of the world's day budget (§9.15): being talked to. */
const AMBIENT_TALK: ReadonlySet<string> = new Set(['dialogue', 'precheck']);

export class BudgetError extends MindUnavailableError { override name = 'BudgetError'; }
const limits = new WeakMap<object, { world: number; global: number }>();
export function configureBudget(db: WorldDatabase, config: Config): void {
  limits.set(db, { world: config.WORLD_DAILY_BUDGET_USD, global: config.GLOBAL_DAILY_BUDGET_USD });
}
export const budgetLimits = (db: WorldDatabase) => limits.get(db) ?? { world: 0.06, global: 10 };
export const utcStart = () => new Date(new Date().toISOString().slice(0, 10));

export type BudgetTx = Parameters<Parameters<WorldDatabase['transaction']>[0]>[0];

/**
 * Everything spent since the UTC day began, across every world (the global cap's measure), inside an admission
 * transaction: budget_calls plus the spend logged before the guard existed (read once a day and kept in meta).
 */
export async function globalSpendTx(tx: BudgetTx): Promise<number> {
  const since = utcStart();
  // Rides budget_calls_day_idx; never scans ai_log after the day's first admission.
  const [everyone] = await tx.select({ cost: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls)
    .where(gte(budgetCalls.createdAt, since));
  const baselineKey = `budget-baseline:${since.toISOString()}`;
  const [hasBaseline] = await tx.select({ key: meta.key }).from(meta).where(eq(meta.key, baselineKey));
  if (!hasBaseline) {
    const [logged] = await tx.select({ cost: sql<string>`coalesce(sum(${aiLog.costUsd}), 0)` }).from(aiLog).where(gte(aiLog.createdAt, since));
    await tx.insert(meta).values({ key: baselineKey, value: String(Number(logged?.cost ?? 0)) }).onConflictDoNothing();
  }
  const [baseline] = await tx.select().from(meta).where(eq(meta.key, baselineKey));
  return Number(everyone?.cost ?? 0) + Number(baseline?.value ?? 0);
}

/** Who a reservation is charged to, once a call is admitted. */
export interface Admission { worldId: string; day: number; kind: string }

/**
 * A MindClient whose every call is admitted first: `admit` runs in a transaction with the call's reservation (a
 * conservative bound on its cost) and throws BudgetError to refuse it; an admitted call's reservation is written to
 * budget_calls and settled to the real cost when the response comes back. budgetMind is the game's policy; the census
 * endpoint (census.ts) has its own.
 */
export function reservingMind(db: WorldDatabase, mind: MindClient, admit: (tx: BudgetTx, reserve: number) => Promise<Admission>): MindClient {
  const run = async <T extends Awaited<ReturnType<MindClient['createMessage']>>>(params: Parameters<MindClient['createMessage']>[0], task: () => Promise<T>): Promise<T> => {
    const id = randomUUID();
    // GDD-GAP: reserve a conservative UTF-8-byte input bound + max output, at uncached/cache-write prices.
    const reserve = reservationUsd(params);
    await db.transaction(async tx => {
      const charge = await admit(tx, reserve);
      await tx.insert(budgetCalls).values({ id, worldId: charge.worldId, day: charge.day, kind: charge.kind, costUsd: String(reserve) });
    });
    try {
      const message = await task();
      await db.update(budgetCalls).set({ pending: false, costUsd: String(costUsd(tokensOf(message.usage))) }).where(eq(budgetCalls.id, id));
      return message;
    } catch (error) {
      // Unknown usage keeps its reservation: losing a response must never reopen the budget.
      if (error instanceof MindStreamError) await db.update(budgetCalls).set({ pending: false, costUsd: String(costUsd(error.tokens)) }).where(eq(budgetCalls.id, id));
      throw error;
    }
  };
  return {
    enabled: mind.enabled, warm: mind.warm?.bind(mind),
    // Batch admission must use submitReflections: this adapter cannot settle deferred usage.
    createBatch: async () => { throw new Error('use submitReflections for budgeted batches'); },
    listBatches: mind.listBatches.bind(mind),
    retrieveBatch: mind.retrieveBatch.bind(mind), batchResults: mind.batchResults.bind(mind),
    createMessage: (params, options) => run(params, () => mind.createMessage(params, options)),
    streamMessage: (params, options) => run(params, () => mind.streamMessage(params, options)),
  };
}

/** Every charged API entry point uses this adapter, including retries and hedged streams. */
export function budgetMind(db: WorldDatabase, mind: MindClient, worldId: string, residentId: string | null, kind: string, jobDay?: number): MindClient {
  return reservingMind(db, mind, budgetAdmission(db, worldId, residentId, kind, jobDay));
}

export function budgetAdmission(db: WorldDatabase, worldId: string, residentId: string | null, kind: string, jobDay?: number) {
  return async (tx: BudgetTx, reserve: number): Promise<Admission> => {
    // One world's calls are admitted one at a time (its own cap is exact); worlds never wait on each other. The global
    // cap is read without a lock, so concurrent admissions can overshoot it by at most the calls in flight.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${worldId}))`);
    const [world] = await tx.select().from(worlds).where(eq(worlds.id, worldId));
    if (!world) throw new BudgetError('budget');
    // Night claims advance worlds.day before its background jobs finish; charge those jobs to their source day.
    const day = jobDay ?? world.day;
    const participants = residentId ? await tx.select().from(residents).where(and(eq(residents.worldId, worldId), inArray(residents.id, residentId.split('+')))) : [];
    const resident = participants.find(r => r.tier === 'core') ?? participants.find(r => r.tier === 'acquainted') ?? participants[0];
    // Rides budget_calls_world_idx.
    const [own] = await tx.select({ cost: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls)
      .where(and(eq(budgetCalls.worldId, worldId), eq(budgetCalls.day, day)));
    const global = await globalSpendTx(tx);
    // The world's spend logged before this day's first admitted call, read once and kept in meta.
    const worldKey = `budget-world-baseline:${worldId}:${day}`;
    await tx.insert(meta).values({ key: worldKey, value: world.aiSpendDay === day ? world.aiSpendUsd : '0' }).onConflictDoNothing();
    const [worldBaseline] = await tx.select().from(meta).where(eq(meta.key, worldKey));
    const spend = Number(own?.cost ?? 0) + Number(worldBaseline?.value ?? 0);
    const cap = budgetLimits(db);
    const coreDialogue = resident?.tier === 'core' && (kind === 'dialogue' || kind === 'precheck');
    if (global + reserve > cap.global
      || (!coreDialogue && spend >= cap.world * 2)
      // §9.15: past 100% Ambient *work* pauses (plans, reflections, encounters, summaries, and the optional prewarm);
      // talking to them goes on until 200%, when only Core dialogue does. (Playtest 2026-10-18: Ambient residents fell
      // to written lines at 100%, half the budget the GDD gives their conversations.)
      || (resident?.tier === 'ambient' && !AMBIENT_TALK.has(kind) && spend >= cap.world)
      || (resident?.tier === 'acquainted' && kind === 'plan' && spend >= cap.world * 1.5)) throw new BudgetError('budget');
    return { worldId, day, kind };
  };
}

export const reservationUsd = (params: Parameters<MindClient["createMessage"]>[0], factor = 1): number =>
  (Buffer.byteLength(JSON.stringify(params)) * 0.125 / 1e6 + params.max_tokens * 0.5 / 1e6) * factor;
