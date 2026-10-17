/**
 * The friendship side of the night pass and the dawn (GDD §9.11.2-9.11.3; MVP G-13):
 *   prepareFriendship  before tonight's reflections: load Day N's plans and the town's ties, apply neglect to the
 *                      player's Regard (§9.11.2) and weekly drift to pairs that won't meet tonight, and choose
 *                      tonight's encounters (encounters.ts), the engine's outings of the day (a café date, a birthday
 *                      party; G-12) among them as planned time together;
 *   recordMilestones   after every job: compare each pair's label with the night's start and record the changes
 *                      that matter (became Friends / Close friends / Rivals / Enemies, made up);
 *   buildDawnTies      the dawn package's `ties`: every pair's label, romance stage and crushes (G-12), and last
 *                      night's milestones.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  ResidentState, encounterRoll, applyAffinity, driftDelta, hasCrush, neglectDelta, orderedPair, pairKey, pairLabel, romanceEligible,
  romanceStageOf, tieMilestone, type DawnTies, type PairLabel, type PersonaCard, type TieMilestoneView, type TieView,
} from "@monde/shared";
import { events, memories, plans, relationships, residents, tieMilestones, worlds } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import {
  NEWS_IMPORTANCE, NEWS_PER_SIDE, encounterMemoryId, chooseEncounters, findMeetings, meanOf, mergeMeetings, relationshipView,
  scheduledMeetings, type Encounter, type EncounterContext, type EncounterSide,
} from "./encounters.js";
import { templatePlan } from "./templatePlan.js";
import type { Tier } from "./tiers.js";

type RelationshipRow = typeof relationships.$inferSelect;
const edgeKey = (from: string, to: string): string => `${from}>${to}`;

/** Every pair of residents with at least one relationship row, by pair key, with its label. */
export function labelsOf(rows: Iterable<Pick<RelationshipRow, "fromId" | "toId" | "affinity">>, residentIds: ReadonlySet<string>): Map<string, PairLabel> {
  const affinity = new Map<string, number>();
  const pairs = new Map<string, [string, string]>();
  for (const r of rows) {
    if (r.fromId === r.toId || !residentIds.has(r.fromId) || !residentIds.has(r.toId)) continue;
    affinity.set(edgeKey(r.fromId, r.toId), r.affinity);
    pairs.set(pairKey(r.fromId, r.toId), orderedPair(r.fromId, r.toId));
  }
  const labels = new Map<string, PairLabel>();
  for (const [key, [a, b]] of pairs) labels.set(key, pairLabel(affinity.get(edgeKey(a, b)), affinity.get(edgeKey(b, a))));
  return labels;
}

// ---------------------------------------------------------------------------------------------------------------
// Before the reflections
// ---------------------------------------------------------------------------------------------------------------

export interface FriendshipNight {
  /** Every pair's label as the night began. */
  before: Map<string, PairLabel>;
  /** Tonight's encounters, in the order they should be queued. */
  encounters: Encounter[];
  /** The two sides of an encounter, as loaded. */
  sides(encounter: Encounter): [EncounterSide, EncounterSide];
  context(encounter: Encounter): EncounterContext;
  /** Residents whose Regard neglect lowered tonight. */
  neglected: string[];
  /** Directed edges drift moved tonight. */
  drifted: number;
}

export interface PrepareOptions {
  worldId: string;
  day: number;
  tiers: ReadonlyMap<string, Tier>;
  modelEnabled: boolean;
  flags: readonly string[];
}

export async function prepareFriendship(db: WorldDatabase, options: PrepareOptions): Promise<FriendshipNight> {
  const { worldId, day } = options;
  const [[world], rows, edges, planRows, newsRows, metRows, outings] = await Promise.all([
    db.select({ seed: worlds.seed }).from(worlds).where(eq(worlds.id, worldId)),
    db.select({ id: residents.id, card: residents.card, state: residents.state }).from(residents).where(eq(residents.worldId, worldId)),
    db.select().from(relationships).where(eq(relationships.worldId, worldId)),
    db.select({ residentId: plans.residentId, plan: plans.plan }).from(plans).where(and(eq(plans.worldId, worldId), eq(plans.day, day))),
    db.select().from(memories).where(and(
      // §9.11: what a resident knows passes on to whom they meet the next day, so today's news and last night's.
      eq(memories.worldId, worldId), gte(memories.day, day - 1), lte(memories.day, day), eq(memories.archived, false),
      gte(memories.importance, NEWS_IMPORTANCE),
    )),
    db.select({ id: memories.id }).from(memories).where(and(eq(memories.worldId, worldId), eq(memories.day, day), eq(memories.kind, "did"))),
    // G-12: the engine's outings today (a courting pair's café date, a birthday party).
    db.select({ type: events.type, minute: events.minute, wherePlace: events.wherePlace, who: events.who }).from(events)
      .where(and(eq(events.worldId, worldId), eq(events.day, day), inArray(events.type, ["date", "birthday_party"]))),
  ]);
  const met = new Set(metRows.map(m => m.id));
  const cards = new Map<string, PersonaCard>(rows.map((r) => [r.id, r.card]));
  const states = new Map<string, ResidentState>(rows.map((r) => [r.id, r.state]));
  const residentIds = new Set(cards.keys());
  const byEdge = new Map(edges.map((e) => [edgeKey(e.fromId, e.toId), e]));
  const before = labelsOf(edges, residentIds);

  // Day N as the residents lived it: last night's plan, or the routine the client ran.
  const planFor = new Map(planRows.map((p) => [p.residentId, p.plan]));
  const dayPlans = rows.map((r) => ({ residentId: r.id, blocks: (planFor.get(r.id) ?? templatePlan(r.card, day)).blocks }));
  const meetings = mergeMeetings(findMeetings(dayPlans), scheduledMeetings(outings, residentIds));
  const encounters = chooseEncounters(meetings.filter(m => !met.has(encounterMemoryId(day, m.a, m.b, m.a))), {
    seed: world?.seed ?? 0, day, mean: (a, b) => meanOf(byEdge, a, b),
    tier: (id) => options.tiers.get(id) ?? "ambient", modelEnabled: options.modelEnabled,
  });

  const neglected = await applyNeglect(db, worldId, day);
  const meeting = new Set(encounters.map((e) => pairKey(e.a, e.b)));
  const drifted = await applyDrift(db, worldId, day, edges.filter((e) =>
    residentIds.has(e.fromId) && residentIds.has(e.toId) && !meeting.has(pairKey(e.fromId, e.toId)) && !met.has(encounterMemoryId(day, e.fromId, e.toId, e.fromId))));

  // Snapshot before tonight: heard news becomes eligible on a later night. Provenance also prevents echoes.
  const newsOf = new Map<string, { id: string; text: string; source: string | null; importance: number }[]>();
  for (const m of newsRows) {
    if (m.kind === "felt") continue;
    const list = newsOf.get(m.residentId) ?? [];
    list.push({ id: m.id, text: m.text, source: m.sourceEvent, importance: m.importance });
    newsOf.set(m.residentId, list);
  }
  const news = (self: string, other: string) => {
    const known = new Set((newsOf.get(other) ?? []).map((n) => n.source ?? n.id));
    return (newsOf.get(self) ?? [])
      .filter((n) => n.importance >= NEWS_IMPORTANCE && !known.has(n.source ?? n.id))
      // §9.11: chance per hop. GDD-GAP: affinity_factor is unspecified; neutral strangers use 1,
      // and mean affinity scales it linearly from 0 to 2. Seed by provenance, never random memory UUIDs.
      .filter((n) => encounterRoll(`${world?.seed ?? 0}:gossip:${n.source ?? n.id}`, day, self, other)
        < 0.6 * n.importance / 10 * (1 + (meanOf(byEdge, self, other) ?? 0) / 100))
      .sort((x, y) => y.importance - x.importance || (x.id < y.id ? -1 : 1))
      .slice(0, NEWS_PER_SIDE)
      .map(({ id, text }) => ({ id, text }));
  };
  const names: Record<string, string> = {};
  for (const id of [...residentIds].sort()) names[id] = cards.get(id)!.name;

  const side = (self: string, other: string): EncounterSide => ({
    card: cards.get(self)!, state: states.get(self)!, view: relationshipView(byEdge.get(edgeKey(self, other))), news: news(self, other),
  });
  return {
    before,
    encounters,
    sides: (e) => [side(e.a, e.b), side(e.b, e.a)],
    context: (e) => ({
      worldId, day, flags: options.flags, names,
      romanceAllowed: romanceEligible(
        { card: cards.get(e.a)!, flags: states.get(e.a)!.flags }, { card: cards.get(e.b)!, flags: states.get(e.b)!.flags },
      ),
    }),
    neglected,
    drifted,
  };
}

/** §9.11.2 neglect for the night of `day`, in one transaction. Returns who lost a point. */
export async function applyNeglect(db: WorldDatabase, worldId: string, day: number): Promise<string[]> {
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: residents.id, state: residents.state, lastTalkDay: residents.lastTalkDay })
      .from(residents).where(eq(residents.worldId, worldId)).for("update");
    const lowered: string[] = [];
    for (const r of rows) {
      const delta = neglectDelta(r.state.regard, r.lastTalkDay, day);
      if (delta === 0) continue;
      await tx.update(residents).set({ state: ResidentState.parse({ ...r.state, regard: r.state.regard + delta }), updatedAt: new Date() })
        .where(and(eq(residents.worldId, worldId), eq(residents.id, r.id)));
      lowered.push(r.id);
    }
    return lowered.sort();
  });
}

/**
 * §9.11.3 drift for the night of `day` on the given edges (pairs of residents not meeting tonight): 1 toward 40 for
 * every week apart, only above 40, inside the pair's daily cap. GDD-GAP: only pairs of residents drift; a card's
 * tie to someone absent (Odile's daughter in the city) isn't a friendship that fades from not meeting.
 */
export async function applyDrift(db: WorldDatabase, worldId: string, day: number, edges: readonly RelationshipRow[]): Promise<number> {
  const due = edges.filter((e) => driftDelta(e.affinity, e.lastSeenDay, day) !== 0);
  if (!due.length) return 0;
  await db.transaction(async (tx) => {
    for (const e of due) {
      const where = and(eq(relationships.worldId, worldId), eq(relationships.fromId, e.fromId), eq(relationships.toId, e.toId));
      const [row] = await tx.select().from(relationships).where(where).for("update");
      if (!row) continue;
      const next = applyAffinity({ affinity: row.affinity, netDay: row.netDay, net: row.net }, day, driftDelta(row.affinity, row.lastSeenDay, day), "drift");
      await tx.update(relationships).set({ affinity: next.edge.affinity, netDay: next.edge.netDay, net: next.edge.net }).where(where);
    }
  });
  return due.length;
}

// ---------------------------------------------------------------------------------------------------------------
// After the jobs
// ---------------------------------------------------------------------------------------------------------------

/** Compare tonight's labels with the night's start and store the milestones. Returns them. */
export async function recordMilestones(db: WorldDatabase, worldId: string, day: number, before: ReadonlyMap<string, PairLabel>): Promise<TieMilestoneView[]> {
  const [ids, edges] = await Promise.all([
    db.select({ id: residents.id }).from(residents).where(eq(residents.worldId, worldId)),
    db.select({ fromId: relationships.fromId, toId: relationships.toId, affinity: relationships.affinity })
      .from(relationships).where(eq(relationships.worldId, worldId)),
  ]);
  const after = labelsOf(edges, new Set(ids.map((r) => r.id)));
  const milestones: TieMilestoneView[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const from = before.get(key) ?? "strangers";
    const to = after.get(key) ?? "strangers";
    const kind = tieMilestone(from, to);
    if (!kind) continue;
    const [a, b] = key.split("+") as [string, string];
    milestones.push({ day, a, b, kind, from, to });
  }
  if (milestones.length) {
    await db.insert(tieMilestones).values(milestones.map((m) => ({
      worldId, day, aId: m.a, bId: m.b, kind: m.kind, fromLabel: m.from, toLabel: m.to,
    }))).onConflictDoNothing();
  }
  return milestones;
}

// ---------------------------------------------------------------------------------------------------------------
// The dawn
// ---------------------------------------------------------------------------------------------------------------

/**
 * The dawn package's `ties` for `day`: every pair that has met (label, romance stage, who is at Crush toward the
 * other, G-12), and the milestones of the night before.
 */
export async function buildDawnTies(db: WorldDatabase, worldId: string, day: number): Promise<DawnTies> {
  const [rows, edges, recorded] = await Promise.all([
    db.select({ id: residents.id, state: residents.state }).from(residents).where(eq(residents.worldId, worldId)),
    db.select({
      fromId: relationships.fromId, toId: relationships.toId, affinity: relationships.affinity,
      feelingKind: relationships.feelingKind, feelingIntensity: relationships.feelingIntensity,
    }).from(relationships).where(eq(relationships.worldId, worldId)),
    db.select().from(tieMilestones).where(and(eq(tieMilestones.worldId, worldId), eq(tieMilestones.day, day - 1))),
  ]);
  const flags = new Map(rows.map((r) => [r.id, r.state.flags]));
  const byEdge = new Map(edges.map((e) => [edgeKey(e.fromId, e.toId), e]));
  const crushOn = (from: string, to: string) => { const e = byEdge.get(edgeKey(from, to)); return !!e && hasCrush(e); };
  const pairs: TieView[] = [];
  for (const [key, label] of [...labelsOf(edges, new Set(flags.keys()))].sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (label === "strangers") continue;
    const [a, b] = key.split("+") as [string, string];
    const crush = [...(crushOn(a, b) ? [a] : []), ...(crushOn(b, a) ? [b] : [])];
    pairs.push({ a, b, label, romance: romanceStageOf(a, flags.get(a) ?? [], b, flags.get(b) ?? []), ...(crush.length ? { crush } : {}) });
  }
  const milestones = recorded
    .map((m) => ({ day: m.day, a: m.aId, b: m.bId, kind: m.kind, from: m.fromLabel, to: m.toLabel }) as TieMilestoneView)
    .sort((x, y) => (pairKey(x.a, x.b) < pairKey(y.a, y.b) ? -1 : 1));
  return { pairs, milestones };
}
