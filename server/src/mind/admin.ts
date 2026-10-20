import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, isNull, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Press, REPORT_KINDS, isGeneratedLetterId, parseReportBody, type ReportBody } from '@monde/shared';
import type { Config } from '../config.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import { reflectionBatches, aiLog, meta, budgetCalls, dialogueTurns, letters, reportedTurns, worlds } from '../db/schema.js';
import { budgetLimits, utcStart } from './budget.js';

// GDD-GAP: §9.13 has no report rate or reason length. Ten reports/world/UTC day (every kind together), 500-character
// reasons; duplicates are idempotent.
export const REPORT_DAILY_LIMIT = 10;
/** How far back a restored world's ancestry is searched for a paper or letter it was printed in (snapshots.ts). */
const LINEAGE_LIMIT = 32;
const hash = (s: string) => createHash('sha256').update(s).digest();
/** The admin token check every /admin route uses (a constant-time compare of digests). */
export const adminTokenMatches = (config: Pick<Config, 'ADMIN_TOKEN'>, token: unknown): boolean =>
  !!config.ADMIN_TOKEN && typeof token === 'string' && timingSafeEqual(hash(token), hash(config.ADMIN_TOKEN));
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function registerAdminRoutes(app: FastifyInstance, config: Config, db?: WorldDatabase): void {
  for (const path of ['/admin', '/admin/costs.json']) app.get<{ Querystring: { token?: string } }>(path, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (!config.ADMIN_TOKEN) return reply.code(404).send({ error: 'not found' });
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? request.query.token ?? '';
    if (!adminTokenMatches(config, token)) return reply.code(401).send({ error: 'unauthorized' });
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
    const reports = (await db.select().from(reportedTurns).orderBy(desc(reportedTurns.createdAt))).map(reportView);
    const reportsByKind = Object.fromEntries(REPORT_KINDS.map(k => [k, reports.filter(r => r.kind === k).length]));
    const pendingBatchesByWorld = await db.select({ worldId: reflectionBatches.worldId, count: count() }).from(reflectionBatches)
      .where(isNull(reflectionBatches.settledAt)).groupBy(reflectionBatches.worldId);
    const pendingBatchRequests = pendingBatchesByWorld.reduce((n, r) => n + r.count, 0);
    const data = { pendingBatchRequests, pendingBatchesByWorld, perWorldDay, global: { utcDay: utcStart().toISOString().slice(0, 10), spendUsd: globalUsd, capUsd: cap.global }, worldTargetUsd: cap.world, cappedWorlds, reportsByKind, reports };
    if (path.endsWith('.json')) return data;
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    return reply.type('text/html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Monde costs and review</title><h1>Monde costs and review</h1><p>Costs include outstanding reservations. Core dialogue remains available at the world cap. Historical calls before migration 0009 have no world-day attribution.</p><h2>Report queue</h2>${reportTable(reports)}<h2>Costs and report queue</h2><pre>${escape(JSON.stringify(data, null, 2))}</pre></html>`);
  });
  app.post<{ Params: { w: string } }>('/v1/worlds/:w/reports', async (request, reply) => {
    const b = parseReportBody(request.body);
    if (!b) return reply.code(400).send({ error: 'invalid report' });
    if (!db) return reply.code(503).send({ error: 'database unavailable' });
    const worldId = request.params.w;
    const status = await db.transaction(async tx => {
      await tx.select().from(worlds).where(eq(worlds.id, worldId)).for('update');
      const item = await storedItem(tx, worldId, b);
      if (!item) return 404;
      const existing = await tx.select().from(reportedTurns).where(and(eq(reportedTurns.worldId, worldId), gte(reportedTurns.createdAt, utcStart())));
      if (existing.some(r => itemKey(r) === itemKey(item))) return 200;
      if (existing.length >= REPORT_DAILY_LIMIT) return 429;
      await tx.insert(reportedTurns).values({ ...item, id: randomUUID(), worldId, reason: b.reason });
      return 200;
    });
    return reply.code(status).send({ recorded: status === 200 });
  });
}

type ReportRow = typeof reportedTurns.$inferSelect;
type ReportItem = Omit<typeof reportedTurns.$inferInsert, 'id' | 'worldId' | 'reason' | 'createdAt'> & { kind: ReportRow['kind'] };
type Reader = Pick<WorldDatabase, 'select'>;

/** One identity per reported item, so a repeat within the day is idempotent. */
function itemKey(r: Partial<Pick<ReportRow, 'conversationId' | 'turnIndex' | 'day' | 'storyIndex' | 'letterId' | 'ref'>> & Pick<ReportRow, 'kind'>): string {
  switch (r.kind) {
    case 'press': return `press:${r.day}:${r.storyIndex ?? 'front'}`;
    case 'letter': return `letter:${r.letterId}`;
    case 'other': return `other:${r.ref}`;
    default: return `dialogue:${r.conversationId}/${r.turnIndex}`;
  }
}

/** The world and the worlds it was restored from, nearest first: a restored branch doesn't copy its printed papers or delivered letters. */
async function lineage(tx: Reader, worldId: string): Promise<string[]> {
  const ids = [worldId];
  while (ids.length < LINEAGE_LIMIT) {
    const [row] = await tx.select({ parent: worlds.parentWorldId }).from(worlds).where(eq(worlds.id, ids.at(-1)!));
    if (!row?.parent || ids.includes(row.parent)) break;
    ids.push(row.parent);
  }
  return ids;
}

/** The nearest world's row of the letters table with this id (the archive also keeps the Lantern's editions). */
async function nearestLetterRow(tx: Reader, worldId: string, id: string, edition: boolean) {
  const ids = await lineage(tx, worldId);
  const rows = await tx.select().from(letters).where(and(inArray(letters.worldId, ids), eq(letters.id, id),
    edition ? eq(letters.toId, '@press') : ne(letters.toId, '@press'), eq(letters.delivered, true)));
  return rows.sort((a, b) => ids.indexOf(a.worldId) - ids.indexOf(b.worldId))[0] ?? null;
}

/**
 * The authoritative copy of a reported item, or null (unknown, or not model-written: a template edition, an authored
 * letter). Dialogue comes from the world's stored turns; papers and letters from its archive or its ancestors'.
 */
async function storedItem(tx: Reader, worldId: string, b: ReportBody): Promise<ReportItem | null> {
  switch (b.kind) {
    case 'dialogue': {
      const [turn] = await tx.select().from(dialogueTurns).where(and(eq(dialogueTurns.worldId, worldId), eq(dialogueTurns.conversationId, b.conversation_id), eq(dialogueTurns.turnIndex, b.turn_index)));
      return turn ? { kind: 'dialogue', conversationId: b.conversation_id, turnIndex: b.turn_index, residentId: turn.residentId, lines: turn.output.lines, playerInput: turn.playerInput } : null;
    }
    case 'press': {
      const row = await nearestLetterRow(tx, worldId, `press_${b.day}`, true);
      let paper: Press | null = null;
      try { paper = row ? Press.parse(JSON.parse(row.text)) : null; } catch { paper = null; }
      // Only Sable's model copy is reportable: a template edition is authored lines and the engine's own records.
      if (!paper || paper.source !== 'model') return null;
      const base = { kind: 'press' as const, residentId: 'sable', day: b.day };
      if (b.story === 'front') return { ...base, storyIndex: null, text: `${paper.headline}\n${paper.dek}` };
      const story = paper.stories[b.story];
      if (!story || (b.event_id !== undefined && b.event_id !== story.event_id)) return null;
      return { ...base, storyIndex: b.story, eventId: story.event_id, text: `${story.title}\n${story.text}` };
    }
    case 'letter': {
      if (!isGeneratedLetterId(b.letter_id)) return null;
      const row = await nearestLetterRow(tx, worldId, b.letter_id, false);
      return row ? { kind: 'letter', letterId: row.id, residentId: row.fromId, day: row.day, text: row.text } : null;
    }
    case 'other':
      return { kind: 'other', ref: b.ref, residentId: b.resident_id ?? null, text: b.text };
  }
}

/** One escaped row per report: kind, when, world, the item, its text and the reason. */
function reportTable(reports: ReturnType<typeof reportView>[]): string {
  if (!reports.length) return '<p>No reports.</p>';
  const item = (r: ReturnType<typeof reportView>) => 'story' in r ? `Day ${r.day} · ${r.story === 'front' ? 'headline and dek' : `story ${r.story}`}${r.event_id ? ` (${r.event_id})` : ''}`
    : 'letter_id' in r ? `${r.letter_id} (Day ${r.day})` : 'ref' in r ? `${r.ref} (client text, unverified)` : `${r.conversation_id} turn ${r.turn_index}`;
  const said = (r: ReturnType<typeof reportView>) => 'lines' in r ? (r.lines ?? []).map(l => l.text).join(' / ') : r.text ?? '';
  const cell = (s: unknown) => `<td>${escape(String(s ?? ''))}</td>`;
  return `<table><tr><th>Kind</th><th>When</th><th>World</th><th>Item</th><th>Text</th><th>Reason</th></tr>${reports.map(r =>
    `<tr>${[r.kind, r.created_at.toISOString(), r.world_id, item(r), said(r), r.reason].map(cell).join('')}</tr>`).join('')}</table>`;
}

/** The review queue as the admin reads it: the kind first, then only that kind's keys. */
function reportView(r: ReportRow) {
  const keys = r.kind === 'press' ? { day: r.day, story: r.storyIndex ?? 'front', event_id: r.eventId, text: r.text }
    : r.kind === 'letter' ? { letter_id: r.letterId, day: r.day, text: r.text }
    : r.kind === 'other' ? { ref: r.ref, text: r.text, unverified: true }
    : { conversation_id: r.conversationId, turn_index: r.turnIndex, lines: r.lines, player_input: r.playerInput };
  return { kind: r.kind, created_at: r.createdAt, world_id: r.worldId, resident_id: r.residentId, ...keys, reason: r.reason };
}
