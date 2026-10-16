import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestDatabase } from '../../db/testDatabase.js';
import { conversationDigests, conversationSummaries, memories, worlds } from '../../db/schema.js';
import { createWorld } from '../../worlds/createWorld.js';
import { selectSession } from '../sessions.js';
import { compactSession, rollDigest, templateSummary } from '../compaction.js';
import { persistTurn } from '../effects.js';
import { SILENT_LOG, type NightJobDeps } from '../nightJob.js';
import { DisabledMindClient } from '../mindClient.js';
import { FakeMind, message } from './fakeMind.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30000);
afterAll(async () => { await database.client.close(); });
const deps = (mind: NightJobDeps['mind']): NightJobDeps => ({ db: database.db, mind, gate: task => task(), callTimeoutMs: 100, log: SILENT_LOG });
const blankFacts = { promises: [], asks: [], learned_about_player: [] };
async function session() {
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const id = randomUUID();
  await selectSession(database.db, { worldId: world.id, residentId: 'pell', requestedId: id, open: true,
    scene: { day: 1, minute: 600, place: 'old_quarter.library', weather: 'fog' } });
  await persistTurn(database.db, { worldId: world.id, residentId: 'pell', conversationId: id, day: 1, minute: 600,
    place: 'old_quarter.library', playerInput: 'I will return the book.', turnIndex: 0, fallback: false, calls: [], promptVersion: 'test', recordTurn: true,
    output: { lines: [{ text: 'Thank you for the book.', expr: 'warm' }], choices: [], wrap_up: false,
      effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: { text: 'The Fellow promised to return my book.', importance: 5 }, favor: null, reveal_secret: null, topic: 'the book' } } });
  return { worldId: world.id, id };
}

it.each(['offline', 'error', 'budget'] as const)('uses a bounded, idempotent template for %s', async mode => {
  const { worldId, id } = await session();
  const fake = new FakeMind();
  fake.createBehavior.error = new Error('unavailable');
  if (mode === 'budget') await database.db.update(worlds).set({ aiSpendUsd: '0.06', aiSpendDay: 1 }).where(eq(worlds.id, worldId));
  const d = deps(mode === 'offline' ? new DisabledMindClient() : fake);
  await Promise.all([compactSession(d, worldId, id), compactSession(d, worldId, id)]);
  const summaries = await database.db.select().from(conversationSummaries).where(eq(conversationSummaries.worldId, worldId));
  expect(summaries).toHaveLength(1);
  expect(summaries[0]!.summary).toContain('I spoke with the Fellow about the book.');
  expect(summaries[0]!.facts.learned_about_player).toContain('The Fellow promised to return my book.');
  expect(fake.creates).toHaveLength(mode === 'error' ? 1 : 0);
  const ms = await database.db.select().from(memories).where(and(eq(memories.worldId, worldId), eq(memories.archived, false)));
  expect(ms).toHaveLength(1);
  expect(ms[0]).toMatchObject({ importance: 5, wherePlace: 'old_quarter.library' });
});

it('rolls the oldest four only when more than six wait and keeps the newest facts in 150 words', async () => {
  const { worldId } = await session();
  const d = deps(new DisabledMindClient());
  for (let i = 0; i < 7; i++) {
    await database.db.insert(conversationSummaries).values({ worldId, residentId: 'pell', conversationId: `summary-${i}`, day: 1, minute: 600 + i,
      summary: `Conversation ${i} ${'words '.repeat(59)}`, facts: { ...blankFacts, promises: [`newest-fact-${i}`] }, topics: [], feltAfter: 'content' });
    if (i === 5) {
      await rollDigest(d, worldId, 'pell', 1);
      expect(await database.db.select().from(conversationDigests).where(eq(conversationDigests.worldId, worldId))).toHaveLength(0);
    }
  }
  await rollDigest(d, worldId, 'pell', 1);
  const [digest] = await database.db.select().from(conversationDigests).where(eq(conversationDigests.worldId, worldId));
  expect(digest!.digest.split(/\s+/).length).toBeLessThanOrEqual(150);
  expect(digest!.digest).toContain('newest-fact-3');
  expect(digest!.digest).not.toContain('newest-fact-4');
  const rows = await database.db.select().from(conversationSummaries).where(eq(conversationSummaries.worldId, worldId));
  expect(rows.filter(r => r.digested).map(r => r.conversationId).sort()).toEqual(['summary-0', 'summary-1', 'summary-2', 'summary-3']);
});

it('uses low-effort structured model output, enforces word bounds and checks stop_reason', async () => {
  const { worldId, id } = await session();
  const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const mind = new FakeMind();
  mind.createMessage = async body => {
    bodies.push(body);
    return message(JSON.stringify({ summary: `I remember ${'books '.repeat(80)}`, facts: blankFacts, topics: ['books'], felt_after: 'warm' }), 'end_turn');
  };
  await compactSession(deps(mind), worldId, id);
  const [summary] = await database.db.select().from(conversationSummaries).where(eq(conversationSummaries.worldId, worldId));
  expect(summary!.summary.split(/\s+/)).toHaveLength(60);
  expect(bodies[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low', format: { type: 'json_schema' } } });
  expect(bodies[0]!.messages.at(-1)!.role).toBe('user');
  expect(JSON.stringify(bodies[0])).not.toMatch(/minLength|maxLength|minItems|maxItems|temperature|top_p|top_k/);
  const other = await session();
  mind.createMessage = async () => message('must not be read', 'refusal');
  await compactSession(deps(mind), other.worldId, other.id);
  const [fallback] = await database.db.select().from(conversationSummaries).where(eq(conversationSummaries.worldId, other.worldId));
  expect(fallback!.summary).toContain('I spoke with the Fellow');
});

it('quotes what the Fellow said in a template summary, so a later conversation can recall it', () => {
  const effects = { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: 'clocktower and the oven door' };
  const turn = (playerInput: string | null) => ({ playerInput, output: { lines: [{ text: 'Hm.', expr: 'neutral' }], choices: [], effects, wrap_up: false } });
  const { summary } = templateSummary([turn(null), turn("I tinker with old clocks. I'm hoping to get the clocktower going again."), turn('Right.')]);
  expect(summary).toBe(`I spoke with the Fellow about clocktower and the oven door. The Fellow said: "I tinker with old clocks. I'm hoping to get the clocktower going again."`);
  expect(templateSummary([turn('Ok.')]).summary).toBe('I spoke with the Fellow about clocktower and the oven door.');
});
