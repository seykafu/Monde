import { randomInt, randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { ResidentState, romanceFlag, type PersonaCard } from "@monde/shared";
import type { createDatabase } from "../db/client.js";
import type { createTestDatabase } from "../db/testDatabase.js";
import { devices, events, worlds, residents, relationships } from "../db/schema.js";
import { loadContent, type RosterOptions } from "../content/loadContent.js";

export type WorldDatabase = NonNullable<ReturnType<typeof createDatabase>>["db"] | Awaited<ReturnType<typeof createTestDatabase>>["db"];

/**
 * A card's household ties as romance flags (shared/friendship.ts ROMANCE_STAGES): a `spouse` tie is `married:<id>`, a
 * `partner` tie `together:<id>` (MVP M-03: the census's couples, A.1.2), so a Day-1 couple never courts anyone else.
 */
export function romanceFlagsOf(card: Pick<PersonaCard, "relationships">): string[] {
  const flags = card.relationships.flatMap((r) => {
    const tag = r.tag.toLowerCase();
    return tag === "spouse" ? [romanceFlag("married", r.id)] : tag === "partner" ? [romanceFlag("together", r.id)] : [];
  });
  return [...new Set(flags)].sort();
}

export function initialState(card: PersonaCard, worldId: string): ResidentState {
  return ResidentState.parse({
    id: card.id, world_id: worldId, tier: card.kind === "canon" ? "core" : "ambient",
    // GDD-GAP: exact Day-1 mood numbers are unspecified; neutral defaults until simulation runs.
    mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 0 },
    needs: { rest: 70, food: 70, social: 70, purpose: 70, comfort: 70 },
    regard: 0, stances: {}, beliefs: card.beliefs, recent_topics: [],
    dream: { stage: 0, notes: "" }, stay: 50, leaving_notice_since: null,
    location: card.routine.weekday[0]!.where, flags: romanceFlagsOf(card),
  });
}

/**
 * Rows per INSERT. 212 residents carry about 600 ties; one statement for each would be one very large parameter list
 * (Postgres caps a statement at 65,535 parameters, and a long one is slow to plan). GDD-GAP: no number is authored;
 * 100 keeps every statement small.
 */
export const INSERT_CHUNK = 100;

async function insertChunked<T>(rows: readonly T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) await insert(rows.slice(i, i + INSERT_CHUNK));
}

const residentRow = (card: PersonaCard, worldId: string) => {
  const state = initialState(card, worldId);
  return { worldId, id: card.id, card, state, tier: state.tier };
};
const tieRows = (cards: readonly PersonaCard[], worldId: string, keep: (from: string, to: string) => boolean = () => true) =>
  cards.flatMap((card) => card.relationships.filter((r) => keep(card.id, r.id)).map(({ id, ...relationship }) => ({
    worldId, fromId: card.id, toId: id, ...relationship,
  })));

export async function createWorld(db: WorldDatabase, deviceId: string, inviteCode: string, contentDirectory?: string, roster: RosterOptions = {}) {
  const cards = await loadContent(contentDirectory, roster);
  const worldId = randomUUID();
  return db.transaction(async (tx) => {
    await tx.insert(devices).values({ id: deviceId, inviteCode })
      .onConflictDoUpdate({ target: devices.id, set: { lastSeenAt: new Date() } });
    const [world] = await tx.insert(worlds).values({
      id: worldId, deviceId, seed: randomInt(0, 2147483647), branchId: randomUUID(),
      status: "active", aiSpendDay: 1,
    }).returning();
    await insertChunked(cards.map((card) => residentRow(card, worldId)), (chunk) => tx.insert(residents).values(chunk));
    await insertChunked(tieRows(cards, worldId), (chunk) => tx.insert(relationships).values(chunk));
    return world!;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The roster backfill (MVP M-03 step 3)
// ---------------------------------------------------------------------------------------------------------------

export interface BackfillResult { residents: number; ties: number }

/**
 * Add the content residents a world doesn't have yet (worlds created before the Day-1 census was written), with their
 * ties: each missing card's own, and any card's tie to a missing resident. Never overwrites: a resident or a tie the
 * world already has keeps its row (ON CONFLICT DO NOTHING), residents the world has that the content doesn't (arrivals)
 * are left alone, and nobody who left on the ferry (a departure event) comes back. Idempotent: run again, it adds
 * nothing.
 */
export async function backfillRoster(db: WorldDatabase, worldId: string, contentDirectory?: string, roster: RosterOptions = {}): Promise<BackfillResult> {
  const cards = await loadContent(contentDirectory, roster);
  const [rows, departures] = await Promise.all([
    db.select({ id: residents.id }).from(residents).where(eq(residents.worldId, worldId)),
    db.select({ who: events.who }).from(events).where(and(eq(events.worldId, worldId), eq(events.type, "departure"))),
  ]);
  const have = new Set(rows.map((r) => r.id));
  // Someone who left on the ferry is gone, not missing.
  const left = new Set(departures.flatMap((e) => e.who));
  const missing = cards.filter((c) => !have.has(c.id) && !left.has(c.id));
  if (!missing.length) return { residents: 0, ties: 0 };
  const added = new Set(missing.map((c) => c.id));
  const ties = tieRows(cards, worldId, (from, to) => added.has(from) || added.has(to));
  let insertedResidents = 0, insertedTies = 0;
  await db.transaction(async (tx) => {
    // The world must still exist (a deleted world gets no orphans).
    const [world] = await tx.select({ id: worlds.id }).from(worlds).where(eq(worlds.id, worldId));
    if (!world) return;
    await insertChunked(missing.map((card) => residentRow(card, worldId)), (chunk) => tx.insert(residents).values(chunk).onConflictDoNothing());
    const [after] = await tx.select({ n: count() }).from(residents).where(eq(residents.worldId, worldId));
    insertedResidents = (after?.n ?? have.size) - have.size;
    await insertChunked(ties, async (chunk) => {
      insertedTies += (await tx.insert(relationships).values(chunk).onConflictDoNothing().returning()).length;
    });
  });
  return { residents: insertedResidents, ties: insertedTies };
}

/** Worlds this process has already brought up to the content roster, by content root. */
const backfilled = new Map<string, Promise<BackfillResult>>();

/**
 * The lazy backfill: the first time this process loads a world (any world route) or runs its night, add whatever
 * residents the content has and the world lacks. Later calls are a Map lookup. A failure is forgotten, so the next
 * load tries again.
 */
export function ensureRoster(db: WorldDatabase, worldId: string, contentDirectory?: string, roster: RosterOptions = {}): Promise<BackfillResult> {
  const key = `${contentDirectory ?? ""}|${roster.roster ?? ""}|${worldId}`;
  let pending = backfilled.get(key);
  if (!pending) {
    pending = backfillRoster(db, worldId, contentDirectory, roster);
    backfilled.set(key, pending);
    pending.catch(() => backfilled.delete(key));
  }
  return pending;
}

/** Test hook: forget which worlds were backfilled (a test that swaps the content roster). */
export function forgetBackfills(): void {
  backfilled.clear();
}
