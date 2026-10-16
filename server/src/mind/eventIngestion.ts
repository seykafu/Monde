import { feasibleFavor } from "./favorFeasibility.js";
import { Favor, canCompleteFavor } from "@monde/shared";
import { loadItems } from '../content/loadContent.js';
import { randomUUID } from "node:crypto";
import { and, eq, inArray, gte, sql } from "drizzle-orm";
import { ClientEvent, COMMUNITY_TASKS, matchGift, giftRegard, isBirthday, applyScriptedRegard, type EventIngestionResult, type RegardSnapshot } from "@monde/shared";
import { events, memories, plans, processedClientEvents, residents, worlds, favors, relationships } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { loadPlaceRegistry } from "./places.js";
import { templatePlan } from "./templatePlan.js";
import { loadPlacePositions, witnesses } from "./witnessing.js";

type Transaction = Parameters<Parameters<WorldDatabase["transaction"]>[0]>[0];
export async function currentRegard(db: WorldDatabase | Transaction, worldId: string): Promise<RegardSnapshot> {
  const rows = await db.select({ id: residents.id, state: residents.state }).from(residents).where(eq(residents.worldId, worldId));
  return Object.fromEntries(rows.map(r => [r.id, r.state.regard]));
}
export interface IngestionOptions { contentDir?: string; nightDay?: number; }
/** Lock the world before receipts/effects, and resident rows before changing state. The entire batch commits
 * atomically; rejected items have no effects or receipts. Replays with a changed payload still cannot apply twice. */
export async function ingestClientEvents(db: WorldDatabase, worldId: string, batch: readonly unknown[], options: IngestionOptions = {}): Promise<EventIngestionResult> {
  return eventTransaction(db, tx => ingestInTransaction(tx, worldId, batch, options));
}
/** Existing reflection/favor writers can lock a resident before the world. PostgreSQL may abort a
 * transaction in that race; retry the entire rolled-back batch, never individual effects.
 * GDD-GAP: allow two retries for transient database conflicts, then surface the failure. */
export async function eventTransaction<T>(db: WorldDatabase, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(work); }
    catch (error) {
      let cause: unknown = error;
      let retry = false;
      for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
        if ("code" in cause && (cause.code === "40P01" || cause.code === "40001")) { retry = true; break; }
        cause = "cause" in cause ? cause.cause : null;
      }
      if (!retry || attempt >= 2) throw error;
    }
  }
}
export async function ingestInTransaction(tx: Transaction, worldId: string, batch: readonly unknown[], options: IngestionOptions = {}): Promise<EventIngestionResult> {
  const [world] = await tx.select().from(worlds).where(eq(worlds.id, worldId)).for("update");
  if (!world) throw new Error("Unknown world");
  const [registry, positions] = await Promise.all([loadPlaceRegistry(options.contentDir), loadPlacePositions(options.contentDir)]);
  const result: EventIngestionResult = { accepted: [], duplicates: [], rejected: [], regard: {} };
  const rows = await tx.select().from(residents).where(eq(residents.worldId, worldId)).for("update");
  const byId = new Map(rows.map(r => [r.id, r]));
  const planDays = new Map<number, Map<string, typeof plans.$inferSelect.plan>>();
  for (const raw of batch) {
    const parsed = ClientEvent.safeParse(raw);
    const id = typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string" ? raw.id : "";
    if (!parsed.success) {
      result.rejected.push({ id, reason: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    const original = parsed.data;
    const task = original.kind === 'community_work' ? COMMUNITY_TASKS.find(t => t.id === original.task) : undefined;
    // Work uses the existing town-event witnessing pipeline, preserving its original receipt id.
    const e = original.kind === 'community_work' && task ? {
      ...original, kind: 'town_event' as const, type: 'community_work' as const,
      // GDD-GAP: other work uses sweeping’s importance (2) until §9.6 supplies a fuller table.
      summary: `The Fellow completed ${task.name}.`, importance: 2,
    } : original;
    const keys = [JSON.stringify(["id", e.id])];
    if (e.kind === "scripted_memory" || e.kind === "scripted_regard") keys.push(JSON.stringify(["cue", e.kind, e.scene_id, e.cue_key]));
    if (e.kind === "favor_choice") keys.push(JSON.stringify(["favor_choice", e.favor]));
    if (e.kind === "favor_done") keys.push(JSON.stringify(["favor", e.favor]));
    if (e.kind === 'gift') keys.push(JSON.stringify(['gift', e.resident, e.day]));
    const receipts = await tx.select().from(processedClientEvents).where(and(eq(processedClientEvents.worldId, worldId), inArray(processedClientEvents.key, keys)));
    if (receipts.length) {
      // Remember a new id that aliases an already applied cue, too.
      await tx.insert(processedClientEvents).values({ worldId, key: keys[0]! }).onConflictDoNothing();
      result.duplicates.push(e.id); continue;
    }
    let reason: string | undefined;
    if (options.nightDay !== undefined && (e.day > options.nightDay || world.day > options.nightDay)) reason = "event is outside this unprocessed night";
    if (original.kind === 'community_work' && (!task || original.place !== task.place || original.day < task.opens || original.minute + task.minutes > 1560)) reason = 'invalid community task, place or time';
    const item = e.kind === 'gift' || e.kind === 'meal' ? (await loadItems(options.contentDir)).find(i => i.id === e.item) : undefined;
    if ((e.kind === 'gift' || e.kind === 'meal') && !item) reason = 'unknown item';
    if (e.kind === 'meal' && (!item?.tags.includes('meal') || !item.stamina)) reason = 'not a meal';
    if ("place" in e && !registry.ids.has(e.place)) reason = "unknown place";
    if ("resident" in e && !byId.has(e.resident)) reason = "unknown resident";
    if ("participants" in e && e.participants.some(id => id !== "player" && !byId.has(id))) reason = "unknown participant";
    if (e.kind === "flags" && e.revision <= world.flagsRevision) reason = "stale flags revision";
    if (reason) { result.rejected.push({ id: e.id, reason }); continue; }

    if (e.kind === 'favor_choice') {
      if (e.notice && e.notice.resident === e.resident && e.favor === `last_chance_${e.resident}_${e.notice.deadline}` && e.notice.deadline >= e.day && e.notice.deadline <= e.day + 2) {
        const existing = await tx.select().from(favors).where(eq(favors.worldId,worldId));
        const open = existing.filter(f => ['proposed','accepted'].includes(f.status) && f.expiresDay >= e.day);
        if (!existing.some(f => f.id === e.favor) && open.length < 6 && !open.some(f => f.residentId === e.resident)) {
          const contract = await feasibleFavor(tx,worldId,e.resident,e.day,e.favor,{ template:'last_chance',target:e.resident,text:'Before the ferry goes, could you help me put one thing right?' },e.notice);
          if (contract) await tx.insert(favors).values({ worldId,id:e.favor,residentId:e.resident,template:contract.template,target:contract.target,text:contract.text,status:'proposed',createdDay:e.day,expiresDay:e.notice.deadline,reward:contract });
        }
      }
      const changed = await tx.update(favors).set({ status: e.accept ? 'accepted' : 'declined' }).where(and(eq(favors.worldId,worldId),eq(favors.id,e.favor),eq(favors.residentId,e.resident),eq(favors.status,'proposed'),gte(favors.expiresDay,e.day))).returning();
      if (!changed.length || changed[0]!.expiresDay < e.day) { result.rejected.push({ id:e.id,reason:'favor is no longer offered' }); continue; }
      result.accepted.push(e.id);
    } else if (e.kind === "favor_done") {
      const [stored] = await tx.select().from(favors).where(and(eq(favors.worldId, worldId), eq(favors.id, e.favor)));
      const parsedFavor = Favor.safeParse(stored?.reward);
      if (!stored || !['proposed','accepted'].includes(stored.status) || !parsedFavor.success || stored.residentId !== e.resident ||
          !canCompleteFavor({ ...parsedFavor.data, status: 'accepted', found: e.proof.found }, e.day, e.proof)) {
        result.rejected.push({ id: e.id, reason: 'invalid or expired favor completion' }); continue;
      }
      const f = parsedFavor.data, row = byId.get(e.resident)!;
      row.state = { ...row.state, regard: applyScriptedRegard(row.state.regard, f.reward.regard) };
      await tx.update(residents).set({ state: row.state }).where(and(eq(residents.worldId, worldId), eq(residents.id, e.resident)));
      await tx.update(favors).set({ status: 'completed' }).where(and(eq(favors.worldId, worldId), eq(favors.id, e.favor)));
      await tx.insert(events).values({ worldId,id:e.id,day:e.day,minute:e.minute,type:'favor_done',wherePlace:f.task.place,who:['player',e.resident],importance:2,tags:['favor_done'],summary:`The Fellow completed an errand for ${row.card.name}.` }).onConflictDoNothing();
      if (f.task.kind === 'introduce') for (const [fromId, toId] of [[f.resident_id, f.task.recipient], [f.task.recipient, f.resident_id]]) {
        await tx.insert(relationships).values({ worldId, fromId: fromId!, toId: toId!, affinity: 10, trust: 0, tag: 'acquaintance', note: 'Introduced by the Fellow.', lastSeenDay: e.day }).onConflictDoUpdate({ target: [relationships.worldId,relationships.fromId,relationships.toId],set: { affinity: sql`least(100, ${relationships.affinity} + 10)`,lastSeenDay:e.day } });
      }
      result.accepted.push(e.id);
    } else if (e.kind === "town_event") {
      // A legacy event row must not produce a second set of memories.
      const inserted = await tx.insert(events).values({ worldId, id: e.id, day: e.day, minute: e.minute,
        type: e.type, wherePlace: e.place, who: e.participants, importance: e.importance, tags: [e.type], summary: e.summary,
      }).onConflictDoNothing().returning();
      if (!inserted.length) { result.duplicates.push(e.id); }
      else {
        let byResident = planDays.get(e.day);
        if (!byResident) {
          const stored = await tx.select().from(plans).where(and(eq(plans.worldId, worldId), eq(plans.day, e.day)));
          byResident = new Map(stored.map(p => [p.residentId, p.plan]));
          planDays.set(e.day, byResident);
        }
        for (const row of rows) {
          const participant = e.participants.includes(row.id);
          if (!participant && !witnesses((byResident.get(row.id) ?? templatePlan(row.card, e.day)).blocks, e.place, e.minute, positions)) continue;
          await tx.insert(memories).values({ worldId, id: randomUUID(), residentId: row.id, day: e.day, minute: e.minute,
            kind: participant ? "did" : "saw", text: `${participant ? "I took part: " : "I saw: "}${e.summary}`.slice(0, 200),
            who: e.participants, wherePlace: e.place, importance: e.importance,
            // GDD-GAP: event/cue valence isn't authored. Neutral until a reflection interprets it.
            valence: 0, sourceEvent: e.id });
        }
        result.accepted.push(e.id);
      }
    } else if ((e.kind === 'gift' || e.kind === 'meal') && item) {
      const row = byId.get(e.resident)!;
      const reaction = matchGift(item, row.card);
      const delta = e.kind === 'meal' ? 2 : giftRegard(reaction, { birthday: isBirthday(e.day, row.card.birthday) });
      row.state = { ...row.state, regard: applyScriptedRegard(row.state.regard, delta) };
      await tx.update(residents).set({ state: row.state, updatedAt: new Date() }).where(and(eq(residents.worldId, worldId), eq(residents.id, e.resident)));
      await tx.insert(memories).values({ worldId, id: randomUUID(), residentId: e.resident, day: e.day, minute: e.minute,
        kind: 'did', text: e.kind === 'meal' ? `I shared ${item.name} with the Fellow.` : `The Fellow gave me ${item.name}. My reaction: ${reaction}.`, who: ['player', e.resident], wherePlace: row.card.home,
        importance: 2, valence: Math.sign(delta), sourceEvent: e.id });
      result.accepted.push(e.id);
    } else if (e.kind === "scripted_memory") {
      await tx.insert(memories).values({ worldId, id: randomUUID(), residentId: e.resident, day: e.day, minute: e.minute,
        kind: "scripted", text: e.text, who: ["player", e.resident], wherePlace: e.place, importance: e.importance, valence: 0 });
      result.accepted.push(e.id);
    } else if (e.kind === "scripted_regard") {
      const row = byId.get(e.resident)!;
      row.state = { ...row.state, regard: applyScriptedRegard(row.state.regard, e.delta) };
      await tx.update(residents).set({ state: row.state, updatedAt: new Date() })
        .where(and(eq(residents.worldId, worldId), eq(residents.id, e.resident)));
      result.accepted.push(e.id);
    } else if (e.kind === "flags") {
      world.storyFlags = [...new Set(e.flags)].sort();
      world.flagsRevision = e.revision;
      await tx.update(worlds).set({ storyFlags: world.storyFlags, flagsRevision: e.revision }).where(eq(worlds.id, worldId));
      result.accepted.push(e.id);
    }
    await tx.insert(processedClientEvents).values(keys.map(key => ({ worldId, key })));
  }
  result.regard = await currentRegard(tx, worldId);
  return result;
}
