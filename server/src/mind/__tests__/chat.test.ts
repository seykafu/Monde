import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../app.js';
import { parseConfig } from '../../config.js';
import { createTestDatabase } from '../../db/testDatabase.js';
import { createWorld } from '../../worlds/createWorld.js';
import { worldToken } from '../../worlds/routes.js';
import { aiLog, memories, relationships, tieMilestones } from '../../db/schema.js';
import { FakeNightMind } from './fakeNightMind.js';
import { CHAT_GAP_MS, CHAT_DAILY_BUDGET, reserveChat } from '../chatRoutes.js';
import { prepareFriendship } from '../ties.js';
import { DisabledMindClient } from '../mindClient.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const apps: ReturnType<typeof buildApp>[] = [];
beforeAll(async () => { database = await createTestDatabase(); }, 30000);
afterAll(async () => { for (const app of apps) await app.close(); await database?.client.close(); });
const output = { lines: [{ speaker: 'a', text: 'There you are.', expr: 'warm' }, { speaker: 'b', text: 'I saved you a seat.', expr: 'warm' }],
  a_delta: { affinity: 3, trust: 2 }, b_delta: { affinity: 3, trust: 1 }, news_passed: ['news_test'], feeling_change: null };
async function setup(mind = new FakeNightMind(() => ({ output }))) {
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const app = buildApp(parseConfig({ LOG_LEVEL: 'silent' }), database.db, { mind }); apps.push(app);
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, 'monde-local-development-only')}` };
  const body = { a: 'june', b: 'odile', place: 'market_row.gull_and_anchor', day: 1, minute: 1200, weather: 'clear' };
  const post = (patch = {}) => app.inject({ method: 'POST', url: `/v1/worlds/${world.id}/chat`, headers, payload: { ...body, ...patch } });
  return { world, app, headers, post, mind };
}
it('authenticates, validates resident ids, body and day', async () => {
  const env = await setup();
  expect((await env.app.inject({ method: 'POST', url: `/v1/worlds/${env.world.id}/chat`, payload: {} })).statusCode).toBe(401);
  expect((await env.post({ b: 'june' })).statusCode).toBe(400);
  expect((await env.post({ b: 'nobody' })).statusCode).toBe(404);
  expect((await env.post({ day: 2 })).statusCode).toBe(409);
  expect(env.mind.calls).toHaveLength(0);
});
it('applies capped live effects, news and milestones exactly once; night skips the pair', async () => {
  const env = await setup(), worldId = env.world.id;
  for (const [fromId, toId] of [['june', 'odile'], ['odile', 'june']] as const) {
    await database.db.insert(relationships).values({ worldId, fromId, toId, affinity: 39, trust: 0, tag: 'friend', note: '', netDay: 1, net: 5 })
      .onConflictDoUpdate({ target: [relationships.worldId, relationships.fromId, relationships.toId], set: { affinity: 39, trust: 0, netDay: 1, net: 5 } });
  }
  await database.db.insert(memories).values({ worldId, id: 'news_test', residentId: 'june', day: 1, minute: 600, kind: 'did', text: 'I saved a seat for Odile.', who: ['odile'], wherePlace: 'market_row.gull_and_anchor', importance: 5, valence: 1 });
  const reply = await env.post(); expect(reply.statusCode).toBe(200);
  expect(reply.json()).toMatchObject({ fallback: false, applied: { ab: 1, ba: 1 } });
  expect(reply.json().lines.map((l: { speaker: string }) => l.speaker)).toEqual(['june', 'odile']);
  const rows = await database.db.select().from(memories).where(eq(memories.worldId, worldId));
  expect(rows.filter(m => m.id.startsWith('met_'))).toHaveLength(2);
  expect(rows.find(m => m.kind === 'heard')).toMatchObject({ residentId: 'odile', importance: 4 });
  expect(await database.db.select().from(tieMilestones).where(eq(tieMilestones.worldId, worldId))).toHaveLength(1);
  expect((await env.post()).json()).toMatchObject({ reason: 'already_met', applied: { ab: 0, ba: 0 } });
  const prepared = await prepareFriendship(database.db, { worldId, day: 1, tiers: new Map(), flags: [], modelEnabled: false });
  expect(prepared.encounters.some(e => e.a === 'june' && e.b === 'odile')).toBe(false);
  expect(env.mind.calls).toHaveLength(1);
  expect((await database.db.select().from(relationships).where(and(eq(relationships.worldId, worldId), eq(relationships.fromId, 'june'), eq(relationships.toId, 'odile'))))[0]).toMatchObject({ affinity: 40, encounters: 1 });
});
it('reserves a durable daily budget and cooldown', async () => {
  const { world } = await setup(); const start = Date.now();
  expect(await reserveChat(database.db, world.id, 1, start)).toBeNull();
  expect(await reserveChat(database.db, world.id, 1, start + 1)).toBe('cooldown');
  for (let i = 1; i < CHAT_DAILY_BUDGET; i++) expect(await reserveChat(database.db, world.id, 1, start + i * CHAT_GAP_MS)).toBeNull();
  expect(await reserveChat(database.db, world.id, 1, start + CHAT_DAILY_BUDGET * CHAT_GAP_MS)).toBe('budget');
  expect(await reserveChat(database.db, world.id, 2, start + CHAT_DAILY_BUDGET * CHAT_GAP_MS)).toBeNull();
});
it('returns safe authored lines on refusal and rejects unsafe or nonalternating model lines', async () => {
  for (const bad of ['refusal', 'unsafe', 'speakers']) {
    const mind = new FakeNightMind(() => ({ output: { ...output, lines: bad === 'unsafe' ? [{ speaker: 'a', text: 'Use the internet.', expr: 'warm' }, output.lines[1]] : bad === 'speakers' ? [output.lines[0], output.lines[0]] : output.lines }, stopReason: bad === 'refusal' ? 'refusal' : 'end_turn' }));
    const env = await setup(mind); const result = (await env.post()).json();
    expect(result.fallback).toBe(true); expect(result.lines).toHaveLength(2);
    expect(JSON.stringify(result.lines)).not.toContain('internet');
    expect(mind.calls).toHaveLength(bad === 'refusal' ? 1 : 2);
  }
});
it('falls back during cooldown and when the model is offline', async () => {
  const env = await setup();
  await env.post();
  const result = (await env.post({ b: 'hollis' })).json();
  expect(result).toMatchObject({ reason: 'cooldown', fallback: true });
  expect(env.mind.calls).toHaveLength(1);
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const app = buildApp(parseConfig({ LOG_LEVEL: 'silent' }), database.db, { mind: new DisabledMindClient() }); apps.push(app);
  const reply = await app.inject({ method: 'POST', url: `/v1/worlds/${world.id}/chat`, headers: { authorization: `Bearer ${worldToken(world.id, world.deviceId, 'monde-local-development-only')}` }, payload: { a: 'june', b: 'odile', day: 1, minute: 900, weather: 'clear', place: 'market_row.gull_and_anchor' } });
  expect(reply.json()).toMatchObject({ fallback: true, reason: 'offline' });
  expect((await database.db.select().from(aiLog).where(and(eq(aiLog.worldId, world.id), eq(aiLog.kind, 'gossip'))))).toHaveLength(0);
});
it('allows only one live call in flight per world', async () => {
  const mind = new FakeNightMind(() => ({ output }), 150);
  const env = await setup(mind);
  const first = env.post();
  // Fastify injection starts when awaited/then-ed.
  const running = first.then(r => r);
  await expect.poll(() => mind.inFlight).toBe(1);
  const second = await env.post({ b: 'hollis' });
  expect(second.json()).toMatchObject({ reason: 'busy', fallback: true });
  await running;
  expect(mind.maxInFlight).toBe(1);
});
