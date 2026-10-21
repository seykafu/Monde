import { and, count, desc, eq, gt, gte, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import { aiLog, budgetCalls, meta, reflectionBatches, worlds } from '../db/schema.js';
import { adminTokenMatches } from './admin.js';
import { budgetLimits, utcStart } from './budget.js';

const sums = {
  usd: sql<string>`coalesce(sum(${aiLog.costUsd}), 0)`, calls: count(),
  input: sql<string>`coalesce(sum(${aiLog.inputTokens}), 0)`,
  cacheRead: sql<string>`coalesce(sum(${aiLog.cachedTokens}), 0)`,
  cacheWrite: sql<string>`coalesce(sum(${aiLog.cacheWriteTokens}), 0)`,
  output: sql<string>`coalesce(sum(${aiLog.outputTokens}), 0)`,
};
function amounts(row: { usd: string; calls: number; input: string; cacheRead: string; cacheWrite: string; output: string }) {
  return { usd: Number(row.usd), calls: Number(row.calls), tokens: {
    input: Number(row.input), cacheRead: Number(row.cacheRead), cacheWrite: Number(row.cacheWrite), output: Number(row.output),
  } };
}

export function registerUsageRoutes(app: FastifyInstance, config: Config, db?: WorldDatabase): void {
  app.get<{ Querystring: { days?: string; token?: string } }>('/admin/usage.json', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (!config.ADMIN_TOKEN) return reply.code(404).send({ error: 'not found' });
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? request.query.token ?? '';
    if (!adminTokenMatches(config, token)) return reply.code(401).send({ error: 'unauthorized' });
    if (!db) return reply.code(503).send({ error: 'database unavailable' });
    const days = Number(request.query.days ?? 14);
    // Operational range bound, not a game rule.
    if (!Number.isInteger(days) || days < 1 || days > 365) return reply.code(400).send({ error: 'days must be an integer from 1 to 365' });
    const today = utcStart();
    const since = new Date(today.getTime() - (days - 1) * 86400000);
    const real = and(ne(aiLog.model, 'none'), ne(aiLog.kind, 'chat_reservation'));
    const range = and(real, gte(aiLog.createdAt, since));
    const day = sql<string>`to_char(${aiLog.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const total = async (start?: Date) => amounts((await db.select(sums).from(aiLog).where(and(real, start ? gte(aiLog.createdAt, start) : undefined)))[0]!);
    const [todayTotal, last7, all, dailyRows, kinds, models, recent, pending, reserved, baseline, gameDays] = await Promise.all([
      total(today), total(new Date(today.getTime() - 6 * 86400000)), total(),
      db.select({ day, usd: sums.usd, calls: count() }).from(aiLog).where(range).groupBy(day).orderBy(day),
      db.select({ kind: aiLog.kind, usd: sums.usd, calls: count() }).from(aiLog).where(range).groupBy(aiLog.kind).orderBy(desc(sums.usd)),
      db.select({ model: aiLog.model, ...sums }).from(aiLog).where(range).groupBy(aiLog.model).orderBy(desc(sums.usd)),
      db.select({ worldId: worlds.id, label: sql<string>`coalesce(nullif(trim(${worlds.player}->>'name'), ''), left(${worlds.id}::text, 8))`,
        lastActive: sql<string>`max(${aiLog.createdAt})`, usd: sums.usd }).from(aiLog).innerJoin(worlds, eq(worlds.id, aiLog.worldId))
        .where(range).groupBy(worlds.id).orderBy(desc(sql`max(${aiLog.createdAt})`)).limit(8),
      db.select({ count: count() }).from(reflectionBatches).where(isNull(reflectionBatches.settledAt)),
      db.select({ usd: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls).where(gte(budgetCalls.createdAt, today)),
      db.select({ value: meta.value }).from(meta).where(eq(meta.key, `budget-baseline:${today.toISOString()}`)),
      db.select({ worldId: budgetCalls.worldId, days: sql<number>`count(distinct ${budgetCalls.day})` }).from(budgetCalls)
        .where(and(gte(budgetCalls.createdAt, since), gt(budgetCalls.costUsd, '0'))).groupBy(budgetCalls.worldId),
    ]);
    const cap = budgetLimits(db);
    const byDay = new Map(dailyRows.map(r => [r.day, r]));
    const worldDays = new Map(gameDays.map(r => [r.worldId, Number(r.days)]));
    return {
      generatedAt: new Date().toISOString(), range: { days }, totals: { today: todayTotal, last7, all },
      daily: Array.from({ length: days }, (_, i) => {
        const key = new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10);
        const row = byDay.get(key);
        return { day: key, usd: Number(row?.usd ?? 0), calls: Number(row?.calls ?? 0) };
      }),
      byKind: kinds.map(r => ({ kind: r.kind, usd: Number(r.usd), calls: Number(r.calls), avgUsd: Number(r.usd) / Number(r.calls) })),
      byModel: models.map(r => ({ model: r.model, ...amounts(r) })),
      worlds: recent.map(r => {
        const n = worldDays.get(r.worldId) ?? 0;
        return { ...r, lastActive: new Date(r.lastActive).toISOString(), usd: Number(r.usd), gameDays: n, usdPerGameDay: n ? Number(r.usd) / n : null };
      }),
      // Match /admin's read-only cap view, including reservations and any legacy baseline.
      caps: { worldDailyUsd: cap.world, globalDailyUsd: cap.global,
        globalTodayUsd: Math.max(Number(reserved[0]?.usd ?? 0) + Number(baseline[0]?.value ?? 0), todayTotal.usd) },
      pendingBatches: Number(pending[0]?.count ?? 0),
    };
  });
}
