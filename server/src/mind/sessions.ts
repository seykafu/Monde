/** D18 session selection. All writes are serialized against the resident row. */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lte, isNull, or } from "drizzle-orm";
import { MAX_EXCHANGES, MAX_SESSION_EXCHANGES, RECENT_SUMMARIES, RESUME_EXCHANGES, RESUME_WINDOW, SUMMARY_WORDS } from "@monde/shared";
import { conversationDigests, conversationSessions, conversationSummaries, dialogueTurns, residents } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { loadResidentPrefix, prefixSystemBlocks, type TalkScene } from "./context.js";

export type Session = typeof conversationSessions.$inferSelect;
export const sessionWhere = (worldId: string, id: string) => and(eq(conversationSessions.worldId, worldId), eq(conversationSessions.id, id));

export async function historyFor(db: WorldDatabase, worldId: string, residentId: string): Promise<string> {
  const [digest] = await db.select().from(conversationDigests).where(and(eq(conversationDigests.worldId, worldId), eq(conversationDigests.residentId, residentId)));
  const summaries = await db.select().from(conversationSummaries).where(and(eq(conversationSummaries.worldId, worldId), eq(conversationSummaries.residentId, residentId), eq(conversationSummaries.digested, false)))
    .orderBy(desc(conversationSummaries.day), desc(conversationSummaries.minute), desc(conversationSummaries.conversationId)).limit(RECENT_SUMMARIES);
  // Pending summaries get an immediate bounded template; the real compaction stays off the token path.
  const pending = await db.select().from(conversationSessions).where(and(eq(conversationSessions.worldId, worldId), eq(conversationSessions.residentId, residentId), eq(conversationSessions.compacted, false)))
    .orderBy(desc(conversationSessions.createdAt)).limit(RECENT_SUMMARIES);
  const entries = summaries.map(s => ({ day: s.day, minute: s.minute, text: s.summary }));
  for (const session of pending) {
    if (summaries.some(s => s.conversationId === session.id)) continue;
    const turns = await db.select().from(dialogueTurns).where(and(eq(dialogueTurns.worldId, worldId), eq(dialogueTurns.conversationId, session.id))).orderBy(asc(dialogueTurns.turnIndex));
    if (!turns.length) continue;
    const topics = [...new Set(turns.map(t => t.output.effects.topic).filter(Boolean))];
    const facts = turns.flatMap(t => t.output.effects.memory ? [t.output.effects.memory.text] : []);
    entries.push({ day: session.lastDay, minute: session.lastMinute, text: `I spoke with the Fellow about ${topics.join(', ')}. ${facts.join(' ')}`.trim().split(/\s+/).slice(0, SUMMARY_WORDS).join(' ') });
  }
  return [digest?.digest ?? '', ...entries.sort((a, b) => a.day - b.day || a.minute - b.minute).slice(-RECENT_SUMMARIES).map(s => s.text)].filter(Boolean).join('\n');
}

export async function selectSession(db: WorldDatabase, args: {
  worldId: string; residentId: string; requestedId: string; open: boolean; scene: TalkScene;
}): Promise<{ session: Session; resumed: boolean; afterMinutes: number; staleId?: string } | { error: 'unknown_resident' | 'conversation_mismatch' }> {
  const { worldId, residentId, scene } = args;
  const prefix = await loadResidentPrefix(db, worldId, residentId);
  if (!prefix) return { error: 'unknown_resident' };
  const history = args.open ? await historyFor(db, worldId, residentId) : '';
  return db.transaction(async tx => {
    await tx.select().from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, residentId))).for('update');
    const [requested] = await tx.select().from(conversationSessions).where(sessionWhere(worldId, args.requestedId));
    if (requested && requested.residentId !== residentId) return { error: 'conversation_mismatch' as const };
    const [latest] = await tx.select().from(conversationSessions).where(and(eq(conversationSessions.worldId, worldId), eq(conversationSessions.residentId, residentId)))
      .orderBy(desc(conversationSessions.createdAt), desc(conversationSessions.id)).limit(1);
    if (!args.open) {
      if (!latest || latest.id !== args.requestedId || latest.compacted || latest.lastDay !== scene.day || scene.minute < latest.lastMinute || latest.closedDay !== null || latest.exchanges >= latest.exchangeLimit)
        return { error: 'conversation_mismatch' as const };
      return { session: latest, resumed: false, afterMinutes: 0 };
    }
    const lastDay = latest?.closedDay ?? latest?.lastDay;
    const afterMinutes = scene.minute - (latest?.closedMinute ?? latest?.lastMinute ?? scene.minute);
    if (latest && !latest.compacted && lastDay === scene.day && afterMinutes >= 0 && afterMinutes <= RESUME_WINDOW && latest.exchanges <= MAX_SESSION_EXCHANGES - RESUME_EXCHANGES) {
      const [session] = await tx.update(conversationSessions).set({ closedDay: null, closedMinute: null,
        resumeUntil: latest.exchanges + RESUME_EXCHANGES, exchangeLimit: Math.max(latest.exchangeLimit, latest.exchanges + RESUME_EXCHANGES) }).where(sessionWhere(worldId, latest.id)).returning();
      return { session: session!, resumed: true, afterMinutes };
    }
    const [session] = await tx.insert(conversationSessions).values({ worldId, residentId,
      // A new client UUID is accepted only for a genuinely new session; an old UUID is never reused.
      id: requested ? randomUUID() : args.requestedId, openedDay: scene.day, openedMinute: scene.minute,
      lastDay: scene.day, lastMinute: scene.minute, place: scene.place, exchangeLimit: MAX_EXCHANGES, history,
      system: prefixSystemBlocks(prefix, scene.day),
    }).returning();
    return { session: session!, resumed: false, afterMinutes: 0, ...(latest && !latest.compacted ? { staleId: latest.id } : {}) };
  });
}

export async function closeSession(db: WorldDatabase, worldId: string, residentId: string, id: string, day: number, minute: number): Promise<boolean> {
  const rows = await db.update(conversationSessions).set({ closedDay: day, closedMinute: minute }).where(and(
    sessionWhere(worldId, id), eq(conversationSessions.residentId, residentId), eq(conversationSessions.lastDay, day),
    // An old close cannot move last activity backwards. Duplicate close reports are harmless.
    eq(conversationSessions.compacted, false), lte(conversationSessions.lastMinute, minute),
    or(isNull(conversationSessions.closedMinute), lte(conversationSessions.closedMinute, minute)),
  )).returning();
  return rows.length > 0;
}

export async function sessionsForNight(db: WorldDatabase, worldId: string, day: number) {
  return db.select().from(conversationSessions).where(and(eq(conversationSessions.worldId, worldId), lte(conversationSessions.lastDay, day), eq(conversationSessions.compacted, false)))
    .orderBy(asc(conversationSessions.openedMinute));
}
