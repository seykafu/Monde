import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { budgetCalls, aiLog, meta, residents, worlds } from '../db/schema.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import type { Config } from '../config.js';
import { MindUnavailableError, MindStreamError, tokensOf, type MindClient } from './mindClient.js';
import { costUsd } from './pricing.js';

export class BudgetError extends MindUnavailableError { override name = 'BudgetError'; }
const limits = new WeakMap<object, { world: number; global: number }>();
export function configureBudget(db: WorldDatabase, config: Config): void {
  limits.set(db, { world: config.WORLD_DAILY_BUDGET_USD, global: config.GLOBAL_DAILY_BUDGET_USD });
}
export const budgetLimits = (db: WorldDatabase) => limits.get(db) ?? { world: 0.06, global: 10 };
export const utcStart = () => new Date(new Date().toISOString().slice(0, 10));

/** Every charged API entry point uses this adapter, including retries and hedged streams. */
export function budgetMind(db: WorldDatabase, mind: MindClient, worldId: string, residentId: string | null, kind: string, jobDay?: number): MindClient {
  const run = async <T extends Awaited<ReturnType<MindClient['createMessage']>>>(params: Parameters<MindClient['createMessage']>[0], task: () => Promise<T>): Promise<T> => {
    const id = randomUUID();
    // GDD-GAP: reserve a conservative UTF-8-byte input bound + max output, at uncached/cache-write prices.
    const reserve = Buffer.byteLength(JSON.stringify(params)) * 0.125 / 1e6 + params.max_tokens * 0.5 / 1e6;
    await db.transaction(async tx => {
      // One world's calls are admitted one at a time (its own cap is exact); worlds never wait on each other. The global
      // cap is read without a lock, so concurrent admissions can overshoot it by at most the calls in flight.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${worldId}))`);
      const [world] = await tx.select().from(worlds).where(eq(worlds.id, worldId));
      if (!world) throw new BudgetError('budget');
      // Night claims advance worlds.day before its background jobs finish; charge those jobs to their source day.
      const day = jobDay ?? world.day;
      const participants = residentId ? await tx.select().from(residents).where(and(eq(residents.worldId, worldId), inArray(residents.id, residentId.split('+')))) : [];
      const resident = participants.find(r => r.tier === 'core') ?? participants.find(r => r.tier === 'acquainted') ?? participants[0];
      const since = utcStart();
      // Both sums ride an index (budget_calls_world_idx, budget_calls_day_idx); neither scans ai_log.
      const [own] = await tx.select({ cost: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls)
        .where(and(eq(budgetCalls.worldId, worldId), eq(budgetCalls.day, day)));
      const [everyone] = await tx.select({ cost: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls)
        .where(gte(budgetCalls.createdAt, since));
      // Spend logged before the guard existed (or before this day's first admitted call), read once and kept in meta.
      const baselineKey = `budget-baseline:${since.toISOString()}`;
      const worldKey = `budget-world-baseline:${worldId}:${day}`;
      const [hasBaseline] = await tx.select({ key: meta.key }).from(meta).where(eq(meta.key, baselineKey));
      if (!hasBaseline) {
        const [logged] = await tx.select({ cost: sql<string>`coalesce(sum(${aiLog.costUsd}), 0)` }).from(aiLog).where(gte(aiLog.createdAt, since));
        await tx.insert(meta).values({ key: baselineKey, value: String(Number(logged?.cost ?? 0)) }).onConflictDoNothing();
      }
      await tx.insert(meta).values({ key: worldKey, value: world.aiSpendDay === day ? world.aiSpendUsd : '0' }).onConflictDoNothing();
      const baselines = await tx.select().from(meta).where(sql`${meta.key} in (${baselineKey}, ${worldKey})`);
      const baseline = Number(baselines.find(r => r.key === baselineKey)?.value ?? 0);
      const worldBaseline = Number(baselines.find(r => r.key === worldKey)?.value ?? 0);
      const spend = Number(own?.cost ?? 0) + worldBaseline;
      const cap = budgetLimits(db);
      const coreDialogue = resident?.tier === 'core' && (kind === 'dialogue' || kind === 'precheck');
      if (Number(everyone?.cost ?? 0) + baseline + reserve > cap.global
        || (!coreDialogue && spend >= cap.world * 2)
        || (resident?.tier === 'ambient' && spend >= cap.world)
        || (resident?.tier === 'acquainted' && kind === 'plan' && spend >= cap.world * 1.5)) throw new BudgetError('budget');
      await tx.insert(budgetCalls).values({ id, worldId, day, kind, costUsd: String(reserve) });
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
  return { enabled: mind.enabled, warm: mind.warm?.bind(mind),
    createMessage: (params, options) => run(params, () => mind.createMessage(params, options)),
    streamMessage: (params, options) => run(params, () => mind.streamMessage(params, options)),
  };
}
