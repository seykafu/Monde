import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { budgetCalls, reflectionBatches } from '../db/schema.js';
import { budgetAdmission, reservationUsd, BudgetError } from './budget.js';
import { tokensOf, type BatchResult } from './mindClient.js';
import { BATCH_FACTOR, costUsd, NO_TOKENS } from './pricing.js';
import { applyReflectionOutput, type PreparedReflection } from './reflect.js';
import type { NightJobDeps } from './nightJob.js';
import type { ModelCall } from './callModel.js';

/** Stop reasons are checked before content, including successful batch envelopes containing a refusal. */
export function batchModelCall(prepared: PreparedReflection, result: BatchResult['result']): ModelCall {
  const message = result.type === 'succeeded' ? result.message : null;
  const tokens = message ? tokensOf(message.usage) : NO_TOKENS;
  const stop = message?.stop_reason ?? result.type;
  const call = { attempt: 1, model: prepared.params.model, tokens, costUsd: costUsd(tokens, prepared.params.model, BATCH_FACTOR),
    latencyMs: 0, firstTokenMs: null, stopReason: stop, validation: result.type };
  if (!message) return { ok: false, failure: 'api_error', call };
  if (stop === 'refusal' || stop === 'max_tokens') return { ok: false, failure: stop, call: { ...call, validation: stop } };
  if (stop !== 'end_turn' && stop !== 'stop_sequence') return { ok: false, failure: `stop:${stop}`, call };
  return { ok: true, text: message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join(''), call: { ...call, validation: 'ok' } };
}

/** One batch per world/night. Reservations and snapshots are durable before the network call. */
export async function submitReflections(deps: NightJobDeps, prepared: PreparedReflection[]): Promise<void> {
  const admitted: { customId: string; prepared: PreparedReflection }[] = [];
  for (const item of prepared) {
    const customId = randomUUID();
    const reservationId = randomUUID();
    const reserve = reservationUsd(item.params, BATCH_FACTOR);
    const { worldId, residentId, day } = item.base;
    try {
      await deps.db.transaction(async tx => {
        await budgetAdmission(deps.db, worldId, residentId, 'reflect', day)(tx, reserve);
        await tx.insert(budgetCalls).values({ id: reservationId, worldId, day, kind: 'reflect', costUsd: String(reserve) });
        await tx.insert(reflectionBatches).values({ customId, worldId, residentId, day, reservationId, reservationUsd: String(reserve), prepared: item });
      });
      admitted.push({ customId, prepared: item });
    } catch (error) {
      if (!(error instanceof BudgetError)) throw error;
      await applyReflectionOutput(deps, item, { ok: false, failure: 'budget', call: null });
    }
  }
  if (!admitted.length) return;
  // Do not retry an ambiguous create: the API may already be processing it.
  let batch;
  try {
    batch = await deps.mind.createBatch(admitted.map(r => ({ custom_id: r.customId, params: r.prepared.params })), { signal: deps.signal });
  } catch (err) {
    // Definitive rejection means no billed work. A dropped response is ambiguous: preserve the reservation
    // and recover by matching custom_ids in completed workspace batches, never submit a duplicate.
    if (err instanceof Anthropic.APIError && err.status && err.status >= 400 && err.status < 500 && err.status !== 408) {
      for (const row of admitted) await applyReflectionOutput(deps, row.prepared,
        batchModelCall(row.prepared, { type: 'canceled' }), { customId: row.customId, status: 'rejected' });
    }
    deps.log.error({ err }, 'reflection batch submission failed; ambiguous submissions will be reconciled');
    return;
  }
  await deps.db.update(reflectionBatches).set({ batchId: batch.id, status: 'pending' })
    .where(and(inArray(reflectionBatches.customId, admitted.map(r => r.customId)), isNull(reflectionBatches.settledAt)));
}

/** One indexed query when idle; one retrieve per distinct pending batch, never one per resident. */
export class ReflectionBatchPoller {
  private timer?: ReturnType<typeof setInterval>;
  private work?: Promise<void>;
  private closing = false;
  private readonly controller = new AbortController();
  constructor(private readonly deps: NightJobDeps) {}
  start(): void {
    if (this.timer || this.closing) return;
    void this.poll();
    // GDD-GAP: lag-tolerant work is checked every minute; no client request needs to wait for it.
    this.timer = setInterval(() => { void this.poll(); }, 60_000);
    this.timer.unref();
  }
  poll(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.work) return this.work;
    this.work = this.run().catch((err: unknown) => { this.deps.log.error({ err }, 'reflection batch poll failed; will retry'); })
      .finally(() => { this.work = undefined; });
    return this.work;
  }
  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    this.controller.abort();
    await this.work;
  }
  private async run(): Promise<void> {
    const pending = await this.deps.db.select().from(reflectionBatches).where(isNull(reflectionBatches.settledAt));
    const orphaned = pending.filter(r => !r.batchId);
    if (orphaned.length) {
      // Rare recovery path: create may have succeeded immediately before a process died or lost its response.
      // The API has no create idempotency key. Match our durable UUIDs against ended batches instead of retrying.
      const earliest = Math.min(...orphaned.map(r => r.createdAt.getTime()));
      const unmatched = new Map(orphaned.map(r => [r.customId, r]));
      for await (const batch of this.deps.mind.listBatches({ signal: this.controller.signal })) {
        // GDD-GAP: allow one minute of clock skew between the database and the API.
        if (Date.parse(batch.created_at) < earliest - 60_000) break;
        if (batch.processing_status !== 'ended') continue;
        for await (const item of this.deps.mind.batchResults(batch.id, { signal: this.controller.signal })) {
          const row = unmatched.get(item.custom_id);
          if (!row) continue;
          await this.deps.db.update(reflectionBatches).set({ batchId: batch.id }).where(eq(reflectionBatches.customId, row.customId));
          await applyReflectionOutput(this.deps, row.prepared, batchModelCall(row.prepared, item.result),
            { customId: row.customId, status: item.result.type });
          unmatched.delete(row.customId);
        }
      }
      // Batches expire after 24h. GDD-GAP: allow an extra hour for recovery; unknown usage keeps its reservation.
      for (const row of unmatched.values()) if (Date.now() - row.createdAt.getTime() > 25 * 60 * 60_000) {
        const failed = batchModelCall(row.prepared, { type: 'expired' });
        if (failed.call) failed.call.costUsd = Number(row.reservationUsd);
        await applyReflectionOutput(this.deps, row.prepared, failed, { customId: row.customId, status: 'submission_unknown' });
      }
    }
    for (const batchId of new Set(pending.map(r => r.batchId).filter((id): id is string => id !== null))) {
      if (this.closing) return;
      try {
        const status = await this.deps.mind.retrieveBatch(batchId, { signal: this.controller.signal });
        if (status.processing_status !== 'ended') continue;
        const requests = new Map(pending.filter(r => r.batchId === batchId).map(r => [r.customId, r]));
        for await (const item of this.deps.mind.batchResults(batchId, { signal: this.controller.signal })) {
          const row = requests.get(item.custom_id);
          if (!row) continue;
          await applyReflectionOutput(this.deps, row.prepared, batchModelCall(row.prepared, item.result),
            { customId: row.customId, status: item.result.type });
        }
      } catch (err) { this.deps.log.error({ err, batchId }, 'reflection batch unavailable; will retry'); }
    }
  }
}
