import { afterAll, beforeAll, expect, it } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '../../db/testDatabase.js';
import { aiLog, budgetCalls, devices, worlds } from '../../db/schema.js';
import { parseConfig } from '../../config.js';
import { registerUsageRoutes } from '../usage.js';
import { configureBudget, utcStart } from '../budget.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const app = Fastify();
const config = parseConfig({ ADMIN_TOKEN: 'usage-test-secret' });
const first = randomUUID(), second = randomUUID();
const today = utcStart();
const ago = (n: number) => new Date(today.getTime() - n * 86400000);
beforeAll(async () => {
  database = await createTestDatabase();
  await database.db.insert(devices).values({ id: 'usage-device', inviteCode: 'test' });
  await database.db.insert(worlds).values([first, second].map((id, i) => ({ id, deviceId: 'usage-device', seed: 1, status: 'active', branchId: randomUUID(), aiSpendDay: 1,
    player: i ? null : { name: 'Kasey', pronouns: 'they/them', background: 'tinkerer' as const, why: 'curious' as const, loves: 'tea' as const } })));
  const row = { worldId: first, kind: 'dialogue', model: 'haiku', promptVersion: 'test', inputTokens: 10, cachedTokens: 20, cacheWriteTokens: 30, outputTokens: 40, costUsd: '0.1', latencyMs: 1, stopReason: 'end_turn', validation: 'ok', fallback: false };
  await database.db.insert(aiLog).values([
    { ...row, createdAt: today }, { ...row, createdAt: ago(6), costUsd: '0.2' },
    { ...row, createdAt: ago(13), kind: 'plan', costUsd: '0.3' },
    { ...row, worldId: second, createdAt: ago(1), kind: 'reflect', model: 'large', costUsd: '0.4' },
    { ...row, createdAt: ago(20), costUsd: '0.5' },
    { ...row, createdAt: today, model: 'none', kind: 'chat_reservation', costUsd: '0' },
  ]);
  await database.db.insert(budgetCalls).values([
    { id: randomUUID(), worldId: first, day: 1, kind: 'dialogue', costUsd: '0.1', createdAt: today },
    { id: randomUUID(), worldId: first, day: 1, kind: 'dialogue', costUsd: '0.2', createdAt: ago(6) },
    { id: randomUUID(), worldId: first, day: 2, kind: 'plan', costUsd: '0.3', createdAt: ago(13) },
    { id: randomUUID(), worldId: first, day: 3, kind: 'plan', costUsd: '0', createdAt: today },
    { id: randomUUID(), worldId: first, day: 4, kind: 'plan', costUsd: '0.5', createdAt: ago(20) },
  ]);
  configureBudget(database.db, config);
  registerUsageRoutes(app, config, database.db);
}, 30000);
afterAll(async () => { await app.close(); await database.client.close(); });
it('aggregates totals, UTC days, kinds, models and world-day spend without bookkeeping calls', async () => {
  const response = await app.inject({ url: '/admin/usage.json?days=14', headers: { authorization: 'Bearer usage-test-secret' } });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const data = response.json();
  expect(data.totals.today).toEqual({ usd: 0.1, calls: 1, tokens: { input: 10, cacheRead: 20, cacheWrite: 30, output: 40 } });
  expect(data.totals.last7.usd).toBe(0.7);
  expect(data.totals.all.usd).toBe(1.5);
  expect(data.totals.all.calls).toBe(5);
  expect(data.totals.all.tokens.cacheWrite).toBe(150);
  expect(data.daily).toHaveLength(14);
  expect(data.daily[0]).toEqual({ day: ago(13).toISOString().slice(0, 10), usd: 0.3, calls: 1 });
  expect(data.daily[1].usd).toBe(0);
  expect(data.daily[1].calls).toBe(0);
  expect(data.byKind[0]).toEqual({ kind: 'reflect', usd: 0.4, calls: 1, avgUsd: 0.4 });
  expect(data.byKind.find((r: { kind: string }) => r.kind === 'dialogue').avgUsd).toBe(0.15);
  expect(data.byModel.find((r: { model: string }) => r.model === 'haiku').tokens.input).toBe(30);
  expect(data.worlds[0]).toMatchObject({ worldId: first, label: 'Kasey', usd: 0.6, gameDays: 2, usdPerGameDay: 0.3 });
  expect(data.worlds[1]).toMatchObject({ worldId: second, label: second.slice(0, 8), gameDays: 0, usdPerGameDay: null });
  expect(data.caps).toEqual({ worldDailyUsd: config.WORLD_DAILY_BUDGET_USD, globalDailyUsd: config.GLOBAL_DAILY_BUDGET_USD, globalTodayUsd: 0.1 });
  expect(data.pendingBatches).toBe(0);
});
it('protects the endpoint and validates the bounded range', async () => {
  for (const authorization of [undefined, 'Bearer wrong']) {
    const r = await app.inject({ url: '/admin/usage.json', headers: authorization ? { authorization } : {} });
    expect(r.statusCode).toBe(401); expect(r.headers['cache-control']).toBe('no-store');
  }
  for (const days of ['0', '366', '1.5', 'bad']) expect((await app.inject({ url: `/admin/usage.json?token=usage-test-secret&days=${days}` })).statusCode).toBe(400);
  const disabled = Fastify(); registerUsageRoutes(disabled, parseConfig({}));
  expect((await disabled.inject('/admin/usage.json')).statusCode).toBe(404); await disabled.close();
  const noDb = Fastify(); registerUsageRoutes(noDb, config);
  expect((await noDb.inject('/admin/usage.json?token=usage-test-secret')).statusCode).toBe(503); await noDb.close();
});
