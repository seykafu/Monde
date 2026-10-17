import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import { aiLog, meta, budgetCalls, dialogueTurns, reportedTurns, worlds } from '../db/schema.js';
import { budgetLimits, utcStart } from './budget.js';

// GDD-GAP: §9.13 has no report rate or reason length. Ten reports/world/UTC day, 500-character reasons; duplicates are idempotent.
export const REPORT_DAILY_LIMIT = 10;
const hash = (s: string) => createHash('sha256').update(s).digest();
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function registerAdminRoutes(app: FastifyInstance, config: Config, db?: WorldDatabase): void {
  for (const path of ['/admin', '/admin/costs.json']) app.get<{ Querystring: { token?: string } }>(path, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (!config.ADMIN_TOKEN) return reply.code(404).send({ error: 'not found' });
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? request.query.token ?? '';
    if (typeof token !== 'string' || !timingSafeEqual(hash(token), hash(config.ADMIN_TOKEN))) return reply.code(401).send({ error: 'unauthorized' });
    if (!db) return reply.code(503).send({ error: 'database unavailable' });
    const cap = budgetLimits(db);
    const perWorldDay = await db.select({ worldId: budgetCalls.worldId, day: budgetCalls.day, kind: budgetCalls.kind, costUsd: sql<string>`sum(${budgetCalls.costUsd})` }).from(budgetCalls).groupBy(budgetCalls.worldId, budgetCalls.day, budgetCalls.kind);
    const [global] = await db.select({ usd: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls).where(gte(budgetCalls.createdAt, utcStart()));
    const [legacy] = await db.select({ usd: sql<string>`coalesce(sum(${aiLog.costUsd}), 0)` }).from(aiLog).where(gte(aiLog.createdAt, utcStart()));
    const [baseline] = await db.select().from(meta).where(eq(meta.key, `budget-baseline:${utcStart().toISOString()}`));
    const globalUsd = Math.max(Number(global?.usd ?? 0) + Number(baseline?.value ?? 0), Number(legacy?.usd ?? 0));
    const allWorlds = await db.select().from(worlds);
    const cappedWorlds = allWorlds.filter(w => globalUsd >= cap.global || Math.max(w.aiSpendDay === w.day ? Number(w.aiSpendUsd) : 0,
      perWorldDay.filter(r => r.worldId === w.id && r.day === w.day).reduce((n, r) => n + Number(r.costUsd), 0)) >= cap.world * 2).map(w => w.id);
    const reports = await db.select().from(reportedTurns).orderBy(desc(reportedTurns.createdAt));
    const data = { perWorldDay, global: { utcDay: utcStart().toISOString().slice(0, 10), spendUsd: globalUsd, capUsd: cap.global }, worldTargetUsd: cap.world, cappedWorlds, reports };
    if (path.endsWith('.json')) return data;
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    return reply.type('text/html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Monde costs and review</title><h1>Monde costs and review</h1><p>Costs include outstanding reservations. Core dialogue remains available at the world cap. Historical calls before migration 0009 have no world-day attribution.</p><h2>Costs and report queue</h2><pre>${escape(JSON.stringify(data, null, 2))}</pre></html>`);
  });
  app.post<{ Params: { w: string } }>('/v1/worlds/:w/reports', async (request, reply) => {
    const parsed = z.object({ conversation_id: z.uuid(), turn_index: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid report' });
    if (!db) return reply.code(503).send({ error: 'database unavailable' });
    const b = parsed.data, worldId = request.params.w;
    const status = await db.transaction(async tx => {
      await tx.select().from(worlds).where(eq(worlds.id, worldId)).for('update');
      const [turn] = await tx.select().from(dialogueTurns).where(and(eq(dialogueTurns.worldId, worldId), eq(dialogueTurns.conversationId, b.conversation_id), eq(dialogueTurns.turnIndex, b.turn_index)));
      if (!turn) return 404;
      const existing = await tx.select().from(reportedTurns).where(and(eq(reportedTurns.worldId, worldId), gte(reportedTurns.createdAt, utcStart())));
      if (existing.some(r => r.conversationId === b.conversation_id && r.turnIndex === b.turn_index)) return 200;
      if (existing.length >= REPORT_DAILY_LIMIT) return 429;
      await tx.insert(reportedTurns).values({ id: randomUUID(), worldId, conversationId: b.conversation_id, turnIndex: b.turn_index, residentId: turn.residentId, lines: turn.output.lines, playerInput: turn.playerInput, reason: b.reason });
      return 200;
    });
    return reply.code(status).send({ recorded: status === 200 });
  });
}
