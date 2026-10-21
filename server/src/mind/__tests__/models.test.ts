import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { HouseholdDraw, NativePromptContext, PromptContext } from '@monde/shared';
import { arrivalRequest } from '../arrivals.js';
import { censusRequest, censusBudgetMind, ensureCensusWorld } from '../census.js';
import { summaryRequest } from '../compaction.js';
import { randomUUID, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import { buildApp } from '../../app.js';
import { worldToken } from '../../worlds/routes.js';
import { batchModelCall } from '../reflectionBatches.js';
import type { PreparedReflection } from '../reflect.js';
import { parseConfig } from '../../config.js';
import { createTestDatabase } from '../../db/testDatabase.js';
import { budgetCalls, meta as metadata } from '../../db/schema.js';
import { createWorld } from '../../worlds/createWorld.js';
import { ModelRouter, MODEL_IDS, MODEL_ROLES, modelParams, DEFAULT_MODEL, bindModelRouter } from '../models.js';
import { apiParams, type MindCallKind, type MindRequest } from '../promptBuilder.js';
import { pressRequest } from '../press.js';
import { costUsd, BATCH_FACTOR } from '../pricing.js';
import { reservationUsd, reservingMind } from '../budget.js';
import { registerModelRoutes } from '../modelRoutes.js';
import { FakeMind, message } from './fakeMind.js';
import { prewarmParams, dialogueParams, generateTurn } from '../dialogue.js';
import { loadResidentPrefix, type ResidentPrefix } from '../context.js';
import { precheck, precheckRequest } from '../safety.js';
import { callModel } from '../callModel.js';

const fixtureDir = import.meta.dirname;
const before = JSON.parse(readFileSync(resolve(fixtureDir, 'fixtures/model-params-before.json'), 'utf8')) as {
  request: MindRequest; params: Record<MindCallKind, Anthropic.MessageCreateParamsNonStreaming>; press: unknown;
};
const flush = () => new Promise(resolve => setImmediate(resolve));
let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database.client.close(); });

it('preserves byte-for-byte default API bodies captured before routing was introduced', () => {
  for (const role of Object.keys(before.params) as MindCallKind[]) {
    expect(JSON.stringify(apiParams(role, before.request))).toBe(JSON.stringify(before.params[role]));
  }
  expect(JSON.stringify(pressRequest([]))).toBe(JSON.stringify(before.press));
});

it.each(MODEL_IDS)('%s obeys thinking and sampling rules for every role', model => {
  const router = new ModelRouter(parseConfig({ MIND_MODEL: model }));
  for (const role of MODEL_ROLES) {
    const legacy = role in before.params ? before.params[role as MindCallKind] : {
      model: DEFAULT_MODEL, max_tokens: 500, messages: [{ role: 'user' as const, content: 'fixture' }],
      ...(role === 'arrival' ? { thinking: { type: 'disabled' as const } } : {}), output_config: { effort: 'low' as const },
    };
    const params = modelParams(role, legacy, router);
    expect(params.model).toBe(model);
    expect(params.max_tokens).toBe(legacy.max_tokens);
    expect(params.output_config?.format).toEqual(legacy.output_config?.format);
    if (legacy.thinking && model === MODEL_IDS[1]) {
      expect(params.thinking).toEqual({ type: 'between_tools' });
      expect(params.output_config?.effort).toBe('low');
    } else if (model === MODEL_IDS[2] || model === MODEL_IDS[3]) {
      expect(params).not.toHaveProperty('thinking');
      expect(params.output_config?.effort).toBe('low');
    } else expect(params.thinking).toEqual(legacy.thinking);
    for (const field of ['temperature', 'top_p', 'top_k']) expect(params).not.toHaveProperty(field);
    expect(params.messages.at(-1)?.role).toBe('user');
  }
});

it('validates every environment value, including values shadowed by a role override', () => {
  for (const key of ['MIND_MODEL', ...MODEL_ROLES.map(r => `MIND_MODEL_${r.toUpperCase()}`)]) {
    expect(() => parseConfig({ [key]: 'unknown' })).toThrow();
  }
  expect(() => parseConfig({ MIND_MODEL: 'unknown', MIND_MODEL_DIALOGUE: MODEL_IDS[1] })).toThrow();
  expect(new ModelRouter().resolve('dialogue')).toEqual({ model: DEFAULT_MODEL, source: 'default' });
});

it('applies admin > role env > global env > default, clears overrides and reloads persisted changes', async () => {
  await database.db.delete(metadata).where(eq(metadata.key, 'model-routing'));
  const config = parseConfig({ MIND_MODEL: MODEL_IDS[1], MIND_MODEL_DIALOGUE: MODEL_IDS[2] });
  const router = new ModelRouter(config, database.db);
  await router.refresh();
  expect(router.resolve('dialogue')).toEqual({ model: MODEL_IDS[2], source: 'env' });
  expect(router.resolve('plan')).toEqual({ model: MODEL_IDS[1], source: 'env' });
  await router.set('dialogue', MODEL_IDS[3]);
  expect(router.resolve('dialogue')).toEqual({ model: MODEL_IDS[3], source: 'admin' });
  const restarted = new ModelRouter(config, database.db);
  await restarted.refresh();
  expect(restarted.status()).toEqual(router.status());
  await router.set('dialogue', null);
  expect(router.resolve('dialogue').model).toBe(MODEL_IDS[2]);
  await router.set('plan', DEFAULT_MODEL);
  await restarted.refresh();
  expect(restarted.resolve('plan')).toEqual({ model: DEFAULT_MODEL, source: 'admin' });
  await database.db.update(metadata).set({ value: '{"dialogue":"unknown"}' }).where(eq(metadata.key, 'model-routing'));
  await expect(router.refresh()).rejects.toThrow();
  await database.db.delete(metadata).where(eq(metadata.key, 'model-routing'));
});

it('protects GET/PUT exactly like admin and rejects unknown roles/models before writing', async () => {
  const app = Fastify();
  registerModelRoutes(app, parseConfig({ ADMIN_TOKEN: 'secret' }), database.db, new FakeMind());
  const headers = { authorization: 'Bearer secret' };
  try {
    expect((await app.inject({ url: '/admin/models' })).statusCode).toBe(401);
    for (const payload of [{ role: 'bogus', model: DEFAULT_MODEL }, { role: 'plan', model: 'bogus' }]) {
      expect((await app.inject({ method: 'PUT', url: '/admin/models', headers, payload })).statusCode).toBe(400);
    }
    const result = await app.inject({ method: 'PUT', url: '/admin/models', headers, payload: { role: 'plan', model: MODEL_IDS[1] } });
    expect(result.json().roles.plan).toEqual({ model: MODEL_IDS[1], source: 'admin' });
    expect(result.json().models).toHaveLength(4);
    expect((await app.inject({ url: '/admin/models?token=secret' })).json()).toEqual(result.json());
    expect((await app.inject({ method: 'PUT', url: '/admin/models', headers, payload: { role: 'plan', model: null } })).json().roles.plan.source).toBe('default');
  } finally { await app.close(); }
  const hidden = Fastify();
  registerModelRoutes(hidden, parseConfig({}), database.db, new FakeMind());
  expect((await hidden.inject({ url: '/admin/models' })).statusCode).toBe(404);
  await hidden.close();
});

it('fails startup loudly for invalid persisted overrides', async () => {
  await database.db.insert(metadata).values({ key: 'model-routing', value: '{"plan":"unknown"}' }).onConflictDoUpdate({ target: metadata.key, set: { value: '{"plan":"unknown"}' } });
  const app = Fastify();
  registerModelRoutes(app, parseConfig({}), database.db, new FakeMind());
  await expect(app.ready()).rejects.toThrow();
  await app.close();
  await database.db.delete(metadata).where(eq(metadata.key, 'model-routing'));
});

it('prefers Models API capabilities, never blocks a request, and lazily retries a failed startup probe', async () => {
  let finish!: (value: unknown) => void;
  const probe = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const router = new ModelRouter({}, database.db, probe);
  await router.refresh();
  expect(modelParams('dialogue', before.params.dialogue, router).thinking).toEqual({ type: 'disabled' });
  expect(probe).toHaveBeenCalledTimes(1);
  finish({ capabilities: { thinking: { types: { disabled: { supported: false }, between_tools: { supported: true } } } } });
  await flush();
  expect(modelParams('dialogue', before.params.dialogue, router)).toMatchObject({ thinking: { type: 'between_tools' }, output_config: { effort: 'low' } });
  const failed = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ capabilities: { thinking: { types: { disabled: { supported: true }, between_tools: { supported: false } } } } });
  const fallback = new ModelRouter(parseConfig({ MIND_MODEL: MODEL_IDS[1] }), database.db, failed);
  await fallback.refresh();
  await flush();
  expect(modelParams('dialogue', before.params.dialogue, fallback).thinking).toEqual({ type: 'between_tools' });
  await flush();
  expect(modelParams('dialogue', before.params.dialogue, fallback).thinking).toEqual({ type: 'disabled' });
  expect(failed).toHaveBeenCalledTimes(2);
});

it.each(MODEL_IDS)('charges and reserves %s at its own prices, including batches', async model => {
  const index = MODEL_IDS.indexOf(model);
  const input = [.1, 2, 4, 10][index]!;
  const output = [.5, 10, 20, 50][index]!;
  const read = [.1, .05, .05, .025][index]!;
  const tokens = { input: 100, output: 200, cacheRead: 300, cacheWrite: 400 };
  const expected = (100 * input + 200 * output + 300 * input * read + 400 * input * 1.25) / 1e6;
  expect(costUsd(tokens, model)).toBeCloseTo(expected, 12);
  expect(costUsd(tokens, model, BATCH_FACTOR)).toBeCloseTo(expected / 2, 12);
  const params = { ...before.params.plan, model };
  const reserve = (Buffer.byteLength(JSON.stringify(params)) * input * 1.25 + params.max_tokens * output) / 1e6;
  expect(reservationUsd(params)).toBeCloseTo(reserve, 12);
  expect(reservationUsd(params, BATCH_FACTOR)).toBeCloseTo(reserve / 2, 12);
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const mind = new FakeMind();
  mind.createMessage = async () => message('{}', 'end_turn', { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 300, cache_creation_input_tokens: 400 });
  let admitted = 0;
  const wrapped = reservingMind(database.db, mind, async (_tx, amount) => { admitted = amount; return { worldId: world.id, day: 1, kind: 'plan' }; });
  const result = await callModel(wrapped, params, { timeoutMs: 5000 });
  expect(admitted).toBeCloseTo(reserve, 12);
  expect(result.call?.costUsd).toBeCloseTo(expected, 12);
  const [charge] = await database.db.select().from(budgetCalls).where(eq(budgetCalls.worldId, world.id));
  expect(Number(charge!.costUsd)).toBeCloseTo(expected, 12);
  expect(charge!.pending).toBe(false);
  const batch = batchModelCall({ params } as PreparedReflection, { type: 'succeeded', message: await mind.createMessage(params) });
  expect(batch.call?.costUsd).toBeCloseTo(expected / 2, 12);
});

it.each(MODEL_IDS)('warms the dialogue model and keeps its schema; routes the precheck independently (%s)', async model => {
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const router = new ModelRouter(parseConfig({ MIND_MODEL_DIALOGUE: model, MIND_MODEL_PRECHECK: MODEL_IDS[1] }));
  bindModelRouter(database.db, router);
  const prefix = await loadResidentPrefix(database.db, world.id, 'pell');
  const warm = prewarmParams(prefix!, 1, '', router);
  const turn = modelParams('dialogue', dialogueParams(before.request), router);
  expect(warm.model).toBe(turn.model);
  expect(warm.thinking).toEqual(turn.thinking);
  expect(warm.output_config?.effort).toBe(turn.output_config?.effort);
  expect(warm.max_tokens).toBe(1);
  const mind = new FakeMind();
  await precheck(database.db, mind, world.id, 'pell', 'How is the garden?');
  expect(mind.creates[0]).toMatchObject({ model: MODEL_IDS[1], thinking: { type: 'between_tools' }, output_config: { effort: 'low' } });
});

const standalone = JSON.parse(readFileSync(resolve(fixtureDir, 'fixtures/model-standalone-before.json'), 'utf8')) as {
  draw: HouseholdDraw; native: NativePromptContext; arrival: PromptContext; prefix: ResidentPrefix; hashes: Record<string, string>;
};
it('preserves complete standalone request bytes against the pre-change source', () => {
  const { draw, native, arrival, prefix } = standalone;
  const requests = { arrival: arrivalRequest(draw, arrival), census: censusRequest(draw, native),
    prewarm: prewarmParams(prefix, 1, ''), precheck: precheckRequest('fixture'), summary: summaryRequest(z.object({ summary: z.string() }), 'fixture') };
  for (const [role, params] of Object.entries(requests)) {
    expect(createHash('sha256').update(JSON.stringify(params)).digest('hex'), role).toBe(standalone.hashes[role]);
  }
});
it.each(MODEL_IDS)('routes the complete standalone request builders for %s', model => {
  const router = new ModelRouter(parseConfig({ MIND_MODEL: model }));
  const { draw, native, arrival, prefix } = standalone;
  for (const params of [arrivalRequest(draw, arrival, router), censusRequest(draw, native, router),
    prewarmParams(prefix, 1, '', router), precheckRequest('fixture', router), summaryRequest(z.object({ summary: z.string() }), 'fixture', router), pressRequest([], router)]) {
    expect(params.model).toBe(model);
    expect(params.messages.at(-1)?.role).toBe('user');
    if (model === MODEL_IDS[2] || model === MODEL_IDS[3]) expect(params).not.toHaveProperty('thinking');
  }
});

it('refreshes overrides every minute and stops the timer on shutdown', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const app = Fastify();
  registerModelRoutes(app, parseConfig({ ADMIN_TOKEN: 'secret' }), database.db, new FakeMind());
  try {
    await app.ready();
    await database.db.insert(metadata).values({ key: 'model-routing', value: JSON.stringify({ summary: MODEL_IDS[3] }) })
      .onConflictDoUpdate({ target: metadata.key, set: { value: JSON.stringify({ summary: MODEL_IDS[3] }) } });
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(async () => {
      const response = await app.inject({ url: '/admin/models?token=secret' });
      expect(response.json().roles.summary).toEqual({ model: MODEL_IDS[3], source: 'admin' });
    });
  } finally {
    await app.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await database.db.delete(metadata).where(eq(metadata.key, 'model-routing'));
  }
});

it('runtime switching warms and streams the same model, even inside the prewarm throttle window', async () => {
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const mind = new FakeMind();
  const output = { lines: [{ text: 'Tea is ready.', expr: 'warm' }], wrap_up: false,
    choices: [{ id: 'a', text: 'Thank you.', intent: 'kind' }],
    effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: '' } };
  const app = buildApp(parseConfig({ LOG_LEVEL: 'silent', ADMIN_TOKEN: 'secret', WORLD_DAILY_BUDGET_USD: '100', GLOBAL_DAILY_BUDGET_USD: '1000' }), database.db, { mind });
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, 'monde-local-development-only')}` };
  try {
    for (const model of MODEL_IDS) {
      mind.enqueue({ output, chunk: 10000 });
      expect((await app.inject({ method: 'PUT', url: '/admin/models?token=secret', payload: { role: 'dialogue', model } })).statusCode).toBe(200);
      const warm = await app.inject({ method: 'POST', url: `/v1/worlds/${world.id}/prewarm`, headers, payload: { resident_id: 'pell', day: 1 } });
      expect(warm.json()).toEqual({ warmed: true });
      const response = await app.inject({ method: 'POST', url: `/v1/worlds/${world.id}/talk`, headers, payload: {
        resident_id: 'pell', conversation_id: randomUUID(), input: { kind: 'open' },
        context: { day: 1, minute: 600, place: 'old_quarter.fountain_square', weather: 'clear' },
      } });
      expect(response.statusCode).toBe(200);
      expect(mind.streams.at(-1)?.model).toBe(model);
      expect(mind.creates.at(-1)?.model).toBe(model);
      expect(mind.streams.at(-1)?.output_config).toEqual(mind.creates.at(-1)?.output_config);
    }
  } finally { await app.close(); await database.db.delete(metadata).where(eq(metadata.key, 'model-routing')); }
});

it('keeps a dialogue retry on the original model when routing changes mid-turn', async () => {
  const router = new ModelRouter(parseConfig({ MIND_MODEL_DIALOGUE: MODEL_IDS[1] }), database.db);
  const mind = new FakeMind();
  const sent: string[] = [];
  mind.streamMessage = async params => {
    sent.push(params.model);
    if (sent.length === 1) {
      await router.set('dialogue', MODEL_IDS[3]);
      return message('not JSON', 'end_turn');
    }
    return message(JSON.stringify({ lines: [{ text: 'Tea is ready.', expr: 'warm' }], wrap_up: false,
      choices: [{ id: 'a', text: 'Thank you.', intent: 'kind' }],
      effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: '' } }), 'end_turn');
  };
  try {
    const result = await generateTurn({ mind, router, request: before.request,
      validation: { card: { portrait_expressions: ['warm'] }, emotion: 'content', revealable: new Set(), riddle: null, recentLines: [] },
    });
    expect(result.output).not.toBeNull();
    expect(sent).toEqual([MODEL_IDS[1], MODEL_IDS[1]]);
    expect(router.resolve('dialogue').model).toBe(MODEL_IDS[3]);
    expect(result.calls.every(c => c.model === MODEL_IDS[1])).toBe(true);
  } finally { await database.db.delete(metadata).where(eq(metadata.key, 'model-routing')); }
});

it('the census cap admits Haiku and rejects a more expensive model before sending', async () => {
  await ensureCensusWorld(database.db);
  const haiku = censusRequest(standalone.draw, standalone.native);
  const fable = censusRequest(standalone.draw, standalone.native, new ModelRouter(parseConfig({ MIND_MODEL_ARRIVAL: MODEL_IDS[3] })));
  const mind = new FakeMind();
  const budgeted = censusBudgetMind(database.db, mind, reservationUsd(haiku) * 2);
  await expect(budgeted.createMessage(fable)).rejects.toThrow('budget');
  expect(mind.creates).toHaveLength(0);
  await budgeted.createMessage(haiku);
  expect(mind.creates).toHaveLength(1);
});
