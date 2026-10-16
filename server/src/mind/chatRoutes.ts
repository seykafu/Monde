import { templatePlan, hhmmToMinutes } from './templatePlan.js';
import { loadPlaceRegistry } from './places.js';
/** Fully validated JSON: tiny exchanges must be checked before any bubble reaches the player. */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, or, gte } from 'drizzle-orm';
import { ChatBody, ambientExchange, pairMean, romanceEligible, type ChatReply } from '@monde/shared';
import { aiLog, memories, worlds, plans } from '../db/schema.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import type { MindClient } from './mindClient.js';
import { loadResidentPrefix, weekdayOf } from './context.js';
import { encounterMemoryId, persistEncounter, ruleOutcome, type Encounter } from './encounters.js';
import { buildLiveGossipRequest, validateLiveGossip } from './liveGossip.js';
import { apiParams, promptVersion } from './promptBuilder.js';
import { callModel } from './callModel.js';
import { nightLogRow } from './nightJob.js';

// GDD-GAP: one world chat at once, 30 real seconds between starts; leases outlive two 6 s attempts.
export const CHAT_GAP_MS = 30000;
// §9.15 budgets 20 live exchanges/day. GDD-GAP: failed attempts count too; one corrective retry/exchange.
export const CHAT_DAILY_BUDGET = 20;
export const CHAT_TIMEOUT_MS = 6000;

/** Durable admission under the world lock, across restarts/replicas. Reservation rows contain no model spend. */
export async function reserveChat(db: WorldDatabase, worldId: string, day: number, now = Date.now()): Promise<string | null> {
  return db.transaction(async tx => {
    await tx.select({ id: worlds.id }).from(worlds).where(eq(worlds.id, worldId)).for('update');
    const rows = await tx.select().from(aiLog).where(and(eq(aiLog.worldId, worldId), eq(aiLog.kind, 'chat_reservation'), or(eq(aiLog.promptVersion, String(day)), gte(aiLog.createdAt, new Date(now - CHAT_GAP_MS))))).orderBy(desc(aiLog.createdAt)).limit(CHAT_DAILY_BUDGET + 1);
    if (rows[0] && now - rows[0].createdAt.getTime() < CHAT_GAP_MS) return 'cooldown';
    if (rows.filter(r => r.promptVersion === String(day)).length >= CHAT_DAILY_BUDGET) return 'budget';
    await tx.insert(aiLog).values({ worldId, kind: 'chat_reservation', promptVersion: String(day), model: 'none',
      inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: '0', latencyMs: 0,
      stopReason: 'reserved', validation: 'reserved', fallback: false, createdAt: new Date(now) });
    return null;
  });
}

export function registerChatRoutes(app: FastifyInstance, db: WorldDatabase | undefined, mind: MindClient): void {
  const busy = new Set<string>();
  app.post<{ Params: { w: string } }>('/v1/worlds/:w/chat', async (request, reply) => {
    const parsed = ChatBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid chat request', issues: parsed.error.issues });
    if (!db) return reply.code(503).send({ error: 'Database unavailable' });
    const body = parsed.data, worldId = request.params.w;
    if (!(await loadPlaceRegistry()).ids.has(body.place)) return reply.code(400).send({ error: 'unknown place' });
    const [world] = await db.select({ day: worlds.day }).from(worlds).where(eq(worlds.id, worldId));
    if (world?.day !== body.day) return reply.code(409).send({ error: 'chat day must match the world day' });
    const [a, b] = await Promise.all([loadResidentPrefix(db, worldId, body.a), loadResidentPrefix(db, worldId, body.b)]);
    if (!a || !b) return reply.code(404).send({ error: 'unknown resident' });
    const av = a.relationships.find(r => r.id === body.b) ?? null, bv = b.relationships.find(r => r.id === body.a) ?? null;
    const mean = pairMean(av?.affinity, bv?.affinity);
    const effects = ruleOutcome(a.state.mood.valence, b.state.mood.valence, mean);
    const fallback: ChatReply = { lines: ambientExchange(body.a, body.b, mean, a.state.mood.valence < 0 || b.state.mood.valence < 0),
      fallback: true, reason: 'offline', effects, applied: { ab: 0, ba: 0 } };
    // Animals communicate with authored actions, never borrowed human speech.
    for (const line of fallback.lines) if ((line.speaker === body.a ? a : b).card.voice.mode === 'narrated_action') line.text = '(pauses nearby)';
    const cosmetic = (reason: string): ChatReply => ({ ...fallback, reason, effects: { a: { affinity: 0, trust: 0 }, b: { affinity: 0, trust: 0 }, feeling: null, news: [] } });
    const ownsSlot = !busy.has(worldId);
    if (ownsSlot) busy.add(worldId);
    try {
      const [met] = await db.select({ id: memories.id }).from(memories).where(and(eq(memories.worldId, worldId),
        eq(memories.id, encounterMemoryId(body.day, body.a, body.b, body.a))));
      if (met) return cosmetic('already_met');
      const denied = ownsSlot ? await reserveChat(db, worldId, body.day) : 'busy';
      // Denied model calls still count as an authored encounter, so night cannot repeat it.
      const news = await db.select().from(memories).where(and(eq(memories.worldId, worldId), eq(memories.archived, false), inArray(memories.residentId, [body.a, body.b]))).orderBy(desc(memories.day), desc(memories.minute)).limit(400);
      const newsFor = (self: string, other: string) => news.filter(m => m.residentId === self && m.kind !== 'felt'
        && (m.who.includes(other) || m.importance >= 5)).slice(0, 3).map(m => ({ id: m.id, text: m.text }));
      const an = newsFor(body.a, body.b), bn = newsFor(body.b, body.a);
      const romanceAllowed = romanceEligible({ card: a.card, flags: a.state.flags }, { card: b.card, flags: b.state.flags });
      const ctx = { worldId, day: body.day, flags: a.flags, names: a.names, romanceAllowed };
      const encounter: Encounter = { a: body.a, b: body.b, place: body.place, minute: body.minute, overlap: 0,
        planned: false, mean, chance: 1, roll: 0, mode: 'model', priority: 0 };
      const storedPlans = await db.select().from(plans).where(and(eq(plans.worldId, worldId), eq(plans.day, body.day), inArray(plans.residentId, [body.a, body.b])));
      encounter.planned = [a, b].some(side => (storedPlans.find(p => p.residentId === side.card.id)?.plan ?? templatePlan(side.card, body.day)).blocks
        .some(block => block.place === body.place && block.with.includes(side.card.id === body.a ? body.b : body.a)
          && hhmmToMinutes(block.start) <= body.minute && body.minute < hhmmToMinutes(block.end)));
      const ambient = a.state.tier === 'ambient' && b.state.tier === 'ambient';
      let answer = { ...fallback, reason: denied ?? (mind.enabled && ambient ? 'ambient' : 'offline') };
      if (!denied && mind.enabled && !ambient) {
        const input = buildLiveGossipRequest({ a: { card: a.card, view: av, news: an }, b: { card: b.card, view: bv, news: bn },
          flags: a.flags, names: a.names, day: body.day, weekday: weekdayOf(body.day), minute: body.minute, place: body.place, mode: 'live' }, body, a, b);
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await callModel(mind, apiParams('gossip', input), { timeoutMs: CHAT_TIMEOUT_MS });
          const valid = result.ok ? validateLiveGossip(result.text, a, b, new Set([...an, ...bn].map(n => n.id)), romanceAllowed) : null;
          if (result.call) {
            const call = result.call;
            await db.transaction(async tx => {
              const [world] = await tx.select().from(worlds).where(eq(worlds.id, worldId)).for('update');
              await tx.insert(aiLog).values(nightLogRow(worldId, `${body.a}+${body.b}`, 'gossip', promptVersion(),
                { ...call, validation: valid ? 'ok' : result.ok ? 'live_validation' : result.failure }, !valid));
              if (world) await tx.update(worlds).set({ aiSpendDay: body.day,
                aiSpendUsd: String((world.aiSpendDay === body.day ? Number(world.aiSpendUsd) : 0) + call.costUsd),
              }).where(eq(worlds.id, worldId));
            });
          }
          if (valid) { answer = { ...fallback, ...valid, fallback: false, reason: 'ok' }; break; }
          answer.reason = result.ok ? 'validation' : result.failure;
          app.log.warn({ worldId, reason: answer.reason }, 'live gossip fell back');
          if (!result.ok) break;
          input.messages[0]!.content += '\nCorrect the exchange: 2–6 alternating a/b lines, short in-world speech, valid expressions, no forbidden words. Return the full JSON.';
        }
      }
      answer.applied = await persistEncounter(db, ctx, encounter, answer.effects, null, null, !answer.fallback);
      return answer;
    } finally { if (ownsSlot) busy.delete(worldId); }
  });
}
