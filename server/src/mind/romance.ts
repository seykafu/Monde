/**
 * The romance ladder in the night pass (GDD §9.11.3 "Feelings and the ladder", §12.3 latent romances; MVP G-12). It
 * runs once a night, after tonight's encounters and reflections (night.ts), in one transaction:
 *
 *   1. feelings from time together: each side of today's encounters (live or summary: their `met_<day>_…` memories,
 *      whose valence is the affinity the encounter applied) grows or cools its crush by rule when its tie is seeded
 *      (`spark`) or already romantic, and only between residents who may court (shared romance.ts romanceGrowth;
 *      the model's own feeling deltas were applied by the encounter and the reflection);
 *   2. Courting: every pair who may court (romanceEligibility: adults, not family, not opted out, neither courting,
 *      together or married with someone else), not already on the ladder together, with both at Crush, both ≥ 70
 *      affinity and 5+ encounters (courtingCheck), a resident with one person (pickCourtships), starts courting:
 *        - the stage flag `courting:<partner>` on both (ResidentState.flags: the dawn's ties show it, the People page
 *          and the Dawn Report's line read it, and eligibility sees them as spoken for);
 *        - the tie's tag becomes "courting" both ways, so every prompt that lists the tie says so (GDD-GAP: tags are
 *          authored per card and nothing says what courting does to one; the card's own note stays);
 *        - a memory each ("… and I are courting now."), which tomorrow's dialogue and gossip can draw on;
 *        - a `courting` town event (the durable record of the day it began; the Lantern prints it as a notice,
 *          press.ts) and the café date two days on (a `date` town event: the next night's plans see it among
 *          tomorrow's events, the Lantern lists it, and it is planned time together, ties.ts);
 *        - for the three seeded romances, their story flag (§13.6 `kasimir_priya_dating`…). The client keeps the same
 *          flag in its own story flags at the dawn (its snapshots replace these, M-06), so the two agree.
 * Ids are deterministic, so nothing is written twice.
 */
import { and, eq, like } from "drizzle-orm";
import {
  CAFE_DATE, ROMANCE_IMPORTANCE, ResidentState, courtingCheck, courtingEventId, courtingMemoryId, courtingMemoryText,
  courtingNotice, dateEventId, dateSummary, datingFlag, pairKey, pairMean, pickCourtships, romanceEligible, romanceFlag,
  romanceGrowth, romanceStageOf, type Courtship, type LadderEdge, type PersonaCard,
} from "@monde/shared";
import { events, memories, relationships, residents, worlds } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { applyFeeling, type FeelingKind } from "./reflect.js";

/** GDD-GAP: the minute a night's ladder events carry (the end of the game day, as the press's tie events). */
export const LADDER_MINUTE = 1560;
/** GDD-GAP: how a courtship feels to remember (−5..5, §9.6). */
export const COURTING_VALENCE = 4;

export interface RomanceNight {
  /** Directed ties whose feeling grew or cooled by rule tonight. */
  grown: number;
  /** Pairs who started courting tonight (a < b). */
  courting: Courtship[];
  /** Story flags set tonight. */
  flags: string[];
}

type RelationshipRow = typeof relationships.$inferSelect;
const edgeKey = (from: string, to: string): string => `${from}>${to}`;
const ladderEdge = (row: RelationshipRow): LadderEdge => ({
  affinity: row.affinity, feelingKind: row.feelingKind, feelingIntensity: row.feelingIntensity, encounters: row.encounters, tag: row.tag,
});

/** The ladder for the night of `day`. Throws only on database errors (the caller logs and goes on). */
export async function runRomance(db: WorldDatabase, worldId: string, day: number): Promise<RomanceNight> {
  return db.transaction(async (tx) => {
    // The world row first, then residents by id, then ties by (from, to): the order event ingestion and the encounters
    // take theirs in, so nothing can deadlock.
    const [world] = await tx.select({ flags: worlds.storyFlags }).from(worlds).where(eq(worlds.id, worldId)).for("update");
    const people = await tx.select({ id: residents.id, card: residents.card, state: residents.state }).from(residents)
      .where(eq(residents.worldId, worldId)).orderBy(residents.id).for("update");
    const rows = await tx.select().from(relationships).where(eq(relationships.worldId, worldId))
      .orderBy(relationships.fromId, relationships.toId).for("update");
    const met = await tx.select({ residentId: memories.residentId, who: memories.who, valence: memories.valence, wherePlace: memories.wherePlace })
      .from(memories).where(and(eq(memories.worldId, worldId), eq(memories.day, day), eq(memories.kind, "did"), like(memories.id, `met\\_${day}\\_%`)));

    const cards = new Map<string, PersonaCard>(people.map((p) => [p.id, p.card]));
    const flags = new Map<string, string[]>(people.map((p) => [p.id, [...p.state.flags]]));
    const edges = new Map<string, RelationshipRow>();
    for (const r of rows) if (r.fromId !== r.toId && cards.has(r.fromId) && cards.has(r.toId)) edges.set(edgeKey(r.fromId, r.toId), r);
    const candidate = (id: string) => ({ card: cards.get(id)!, flags: flags.get(id)! });
    const mayCourt = (a: string, b: string) => romanceEligible(candidate(a), candidate(b));
    const changed = new Map<string, RelationshipRow>();
    const touch = (row: RelationshipRow) => { changed.set(edgeKey(row.fromId, row.toId), row); edges.set(edgeKey(row.fromId, row.toId), row); };

    // 1. Feelings from time together.
    let grown = 0;
    const metAt = new Map<string, string>();
    for (const m of met) {
      const self = m.residentId;
      const other = m.who[0];
      if (!other || !cards.has(self) || !cards.has(other)) continue;
      metAt.set(pairKey(self, other), m.wherePlace);
      const row = edges.get(edgeKey(self, other));
      if (!row) continue;
      const growth = romanceGrowth(ladderEdge(row), m.valence, mayCourt(self, other));
      if (!growth) continue;
      const feeling = applyFeeling({ kind: row.feelingKind as FeelingKind | null, intensity: row.feelingIntensity }, growth);
      if (feeling.kind === row.feelingKind && feeling.intensity === row.feelingIntensity) continue;
      touch({ ...row, feelingKind: feeling.kind, feelingIntensity: feeling.intensity });
      grown++;
    }

    // 2. Who is ready to court.
    const ready: Courtship[] = [];
    for (const [key, ab] of edges) {
      const [a, b] = key.split(">") as [string, string];
      if (a > b) continue;
      const ba = edges.get(edgeKey(b, a));
      if (!ba || romanceStageOf(a, flags.get(a)!, b, flags.get(b)!) !== null || !mayCourt(a, b)) continue;
      if (!courtingCheck(ladderEdge(ab), ladderEdge(ba)).ok) continue;
      ready.push({ a, b, mean: pairMean(ab.affinity, ba.affinity) ?? 0 });
    }
    const courting = pickCourtships(ready);

    const storyFlags: string[] = [];
    for (const { a, b } of courting) {
      for (const [self, other] of [[a, b], [b, a]] as const) {
        flags.set(self, [...new Set([...flags.get(self)!, romanceFlag("courting", other)])].sort());
        touch({ ...edges.get(edgeKey(self, other))!, tag: "courting" });
      }
      const flag = datingFlag(a, b);
      if (flag) storyFlags.push(flag);
    }

    // Writes: feelings and tags, the stage flags, then the records.
    for (const row of changed.values()) {
      await tx.update(relationships).set({ feelingKind: row.feelingKind, feelingIntensity: row.feelingIntensity, tag: row.tag })
        .where(and(eq(relationships.worldId, worldId), eq(relationships.fromId, row.fromId), eq(relationships.toId, row.toId)));
    }
    if (!courting.length) return { grown, courting, flags: [] };
    const state = new Map(people.map((p) => [p.id, p.state]));
    for (const id of [...new Set(courting.flatMap((c) => [c.a, c.b]))].sort()) {
      await tx.update(residents).set({ state: ResidentState.parse({ ...state.get(id)!, flags: flags.get(id)! }), updatedAt: new Date() })
        .where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
    }
    const name = (id: string) => cards.get(id)!.name;
    for (const { a, b } of courting) {
      const where = metAt.get(pairKey(a, b)) ?? cards.get(a)!.home;
      const eventId = courtingEventId(a, b);
      await tx.insert(events).values([
        {
          worldId, id: eventId, day, minute: LADDER_MINUTE, type: "courting", wherePlace: where, who: [a, b],
          importance: ROMANCE_IMPORTANCE.courting, tags: ["romance", "courting"], summary: courtingNotice(name(a), name(b)),
        },
        {
          worldId, id: dateEventId(a, b, day + CAFE_DATE.daysAfter), day: day + CAFE_DATE.daysAfter, minute: CAFE_DATE.minute, type: "date",
          wherePlace: CAFE_DATE.place, who: [a, b], importance: ROMANCE_IMPORTANCE.date, tags: ["romance", "date"], summary: dateSummary(name(a), name(b)),
        },
      ]).onConflictDoNothing();
      await tx.insert(memories).values([[a, b], [b, a]].map(([self, other]) => ({
        worldId, id: courtingMemoryId(a, b, self!), residentId: self!, day, minute: LADDER_MINUTE, kind: "did",
        text: courtingMemoryText(name(other!)), who: [other!], wherePlace: where, importance: ROMANCE_IMPORTANCE.courting,
        valence: COURTING_VALENCE, sourceEvent: eventId,
      }))).onConflictDoNothing();
    }
    if (storyFlags.length) {
      await tx.update(worlds).set({ storyFlags: [...new Set([...(world?.flags ?? []), ...storyFlags])].sort() }).where(eq(worlds.id, worldId));
    }
    return { grown, courting, flags: [...new Set(storyFlags)].sort() };
  });
}
