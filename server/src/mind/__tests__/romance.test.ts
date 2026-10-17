/**
 * The romance ladder and birthdays in the night pass (MVP G-12; server/src/mind/romance.ts, birthdays.ts, the
 * outings in encounters.ts/ties.ts): each rule on its own, against a world of the 24 hand-written cards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { CAFE_DATE, ResidentState, areFamily, romanceEligibility, type PersonaCard } from "@monde/shared";
import { loadContent } from "../../content/loadContent.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { events, memories, relationships, residents, worlds } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { encounterMemoryId, mergeMeetings, scheduledMeetings, type Meeting } from "../encounters.js";
import { scheduleBirthdayParties } from "../birthdays.js";
import { runRomance } from "../romance.js";
import { buildDawnTies } from "../ties.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let cards: PersonaCard[];
beforeAll(async () => { [database, cards] = await Promise.all([createTestDatabase(), loadContent()]); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const newWorld = async () => (await createWorld(database.db, `device-${randomUUID()}`, "invite")).id;

interface EdgeSet { affinity?: number; crush?: number; kind?: string | null; encounters?: number; tag?: string }
/** Set (or create) the directed tie from → to. */
async function setEdge(worldId: string, from: string, to: string, e: EdgeSet): Promise<void> {
  const where = and(eq(relationships.worldId, worldId), eq(relationships.fromId, from), eq(relationships.toId, to));
  const [row] = await database.db.select().from(relationships).where(where);
  const values = {
    affinity: e.affinity ?? row?.affinity ?? 0, feelingKind: e.kind !== undefined ? e.kind : e.crush !== undefined ? "crush" : row?.feelingKind ?? null,
    feelingIntensity: e.crush ?? row?.feelingIntensity ?? 0, encounters: e.encounters ?? row?.encounters ?? 0, tag: e.tag ?? row?.tag ?? "acquaintance",
  };
  if (row) await database.db.update(relationships).set(values).where(where);
  else await database.db.insert(relationships).values({ worldId, fromId: from, toId: to, trust: 0, note: "", ...values });
}
/** Both ways at once. */
const setPair = (worldId: string, a: string, b: string, e: EdgeSet, f: EdgeSet = e) => Promise.all([setEdge(worldId, a, b, e), setEdge(worldId, b, a, f)]);
const READY: EdgeSet = { affinity: 75, crush: 45, encounters: 6 };

const stateOf = async (worldId: string, id: string) =>
  (await database.db.select({ state: residents.state }).from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, id))))[0]!.state;
const edgeOf = async (worldId: string, from: string, to: string) =>
  (await database.db.select().from(relationships).where(and(eq(relationships.worldId, worldId), eq(relationships.fromId, from), eq(relationships.toId, to))))[0];
async function setFlags(worldId: string, id: string, flags: string[]): Promise<void> {
  const state = await stateOf(worldId, id);
  await database.db.update(residents).set({ state: ResidentState.parse({ ...state, flags }) }).where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
}
/** A met_ receipt as an encounter writes it: `self`'s memory of meeting `other`, its valence the affinity it applied. */
async function met(worldId: string, day: number, self: string, other: string, valence: number): Promise<void> {
  const [a, b] = self < other ? [self, other] : [other, self];
  await database.db.insert(memories).values({
    worldId, id: encounterMemoryId(day, a, b, self), residentId: self, day, minute: 900, kind: "did",
    text: `Ran into ${other}.`, who: [other], wherePlace: "millbrook.weir", importance: 3, valence,
  });
}

describe("Courting (§9.11.3)", () => {
  it("starts a seeded pair courting once both are at Crush, at 70+, after 5 encounters, and says so everywhere", async () => {
    const w = await newWorld();
    await setPair(w, "kasimir", "priya", { ...READY, encounters: 5 }, { affinity: 70, crush: 40, encounters: 5 });
    const night = await runRomance(database.db, w, 9);
    expect(night.courting).toEqual([{ a: "kasimir", b: "priya", mean: 72.5 }]);
    expect(night.flags).toEqual(["kasimir_priya_dating"]);

    // The stage flags, both ways; the tie says so in every prompt.
    expect((await stateOf(w, "kasimir")).flags).toContain("courting:priya");
    expect((await stateOf(w, "priya")).flags).toContain("courting:kasimir");
    expect((await edgeOf(w, "kasimir", "priya"))!.tag).toBe("courting");
    expect((await edgeOf(w, "priya", "kasimir"))!.tag).toBe("courting");
    // The day it began, the café date two days on, and what each remembers.
    const rows = await database.db.select().from(events).where(eq(events.worldId, w));
    expect(rows.map((e) => [e.id, e.type, e.day, e.minute, e.wherePlace, e.who]).sort()).toEqual([
      ["courting_kasimir+priya", "courting", 9, 1560, "millbrook.kasimir_workshop", ["kasimir", "priya"]],
      ["date_kasimir+priya_11", "date", 11, CAFE_DATE.minute, "market_row.cafe_liss", ["kasimir", "priya"]],
    ]);
    expect(rows.find((e) => e.type === "courting")!.summary).toBe("Kasimir Wolanski and Priya Ramaswamy are courting.");
    const kept = await database.db.select().from(memories).where(and(eq(memories.worldId, w), eq(memories.sourceEvent, "courting_kasimir+priya")));
    expect(kept.map((m) => [m.residentId, m.text]).sort()).toEqual([
      ["kasimir", "Priya Ramaswamy and I are courting now. We'll take tea at Café Liss."],
      ["priya", "Kasimir Wolanski and I are courting now. We'll take tea at Café Liss."],
    ]);
    // §13.6: the seeded romance's story flag.
    expect((await database.db.select({ flags: worlds.storyFlags }).from(worlds).where(eq(worlds.id, w)))[0]!.flags).toContain("kasimir_priya_dating");
    // The dawn's ties: the stage, and both at Crush.
    const tie = (await buildDawnTies(database.db, w, 10)).pairs.find((p) => p.a === "kasimir" && p.b === "priya");
    expect(tie).toMatchObject({ romance: "courting", crush: ["kasimir", "priya"] });

    // Nothing twice.
    const again = await runRomance(database.db, w, 10);
    expect(again.courting).toEqual([]);
    expect((await stateOf(w, "kasimir")).flags.filter((f) => f.startsWith("courting:"))).toEqual(["courting:priya"]);
    expect((await database.db.select().from(events).where(eq(events.worldId, w))).length).toBe(2);
  });

  it("holds a pair one threshold short", async () => {
    const short: [string, EdgeSet, EdgeSet][] = [
      ["affinity 69 one way", READY, { ...READY, affinity: 69 }],
      ["4 encounters", { ...READY, encounters: 4 }, { ...READY, encounters: 4 }],
      ["a crush of 39 one way", READY, { ...READY, crush: 39 }],
      ["one-sided", READY, { affinity: 90, kind: null, crush: 0, encounters: 6 }],
      ["admiration is not romance", { ...READY, kind: "admiration" }, { ...READY, kind: "admiration" }],
    ];
    for (const [why, ab, ba] of short) {
      const w = await newWorld();
      await setPair(w, "augusta", "rosalind", ab, ba);
      expect((await runRomance(database.db, w, 5)).courting, why).toEqual([]);
      expect((await stateOf(w, "augusta")).flags, why).not.toContain("courting:rosalind");
    }
  });

  it("never courts a child, an animal, family, someone spoken for, an opt-out, or the Fellow", async () => {
    const w = await newWorld();
    const card = (id: string) => cards.find((c) => c.id === id)!;
    // Rook and Delphine are `estranged`; `kin` says they are mother and son.
    expect(areFamily(card("rook"), card("delphine"))).toBe(true);
    await setPair(w, "june", "tib", READY);                 // a child
    await setPair(w, "bastien", "odile", READY);            // an animal
    await setPair(w, "delphine", "rook", READY);            // family
    await setPair(w, "hollis", "pell", READY);              // spoken for (below)
    await setFlags(w, "pell", ["married:moss"]);
    await setPair(w, "margo", "sable", READY);              // an opt-out (below)
    const [margo] = await database.db.select({ card: residents.card }).from(residents).where(and(eq(residents.worldId, w), eq(residents.id, "margo")));
    await database.db.update(residents).set({ card: { ...margo!.card, romance: false } }).where(and(eq(residents.worldId, w), eq(residents.id, "margo")));
    await setPair(w, "odile", "player", READY);             // the Fellow is never a resident (D13)

    expect((await runRomance(database.db, w, 7)).courting).toEqual([]);
    for (const r of await database.db.select({ id: residents.id, state: residents.state }).from(residents).where(eq(residents.worldId, w))) {
      expect(r.state.flags.filter((f) => f.startsWith("courting:")), r.id).toEqual([]);
    }
  });

  it("gives a resident one partner: the warmer pair courts, and the other suitor is then turned away", async () => {
    const w = await newWorld();
    await setPair(w, "kasimir", "priya", READY);
    await setPair(w, "bru", "priya", { ...READY, affinity: 90 });
    const first = await runRomance(database.db, w, 12);
    expect(first.courting.map((c) => `${c.a}+${c.b}`)).toEqual(["bru+priya"]);
    expect((await runRomance(database.db, w, 13)).courting).toEqual([]);
    expect((await stateOf(w, "kasimir")).flags.some((f) => f.startsWith("courting:"))).toBe(false);
    // Bru and Priya aren't a seeded romance: no story flag.
    expect(first.flags).toEqual([]);
    expect(romanceEligibility({ card: cards.find((c) => c.id === "kasimir")!, flags: [] }, { card: cards.find((c) => c.id === "priya")!, flags: (await stateOf(w, "priya")).flags }))
      .toEqual({ ok: false, reason: "taken" });
  });
});

describe("feelings from time together", () => {
  it("grows a seeded tie's crush after a warm encounter, and cools it after a cold one", async () => {
    const w = await newWorld();
    await setPair(w, "teo", "ines", { affinity: 45, kind: null, crush: 0 });
    await setPair(w, "augusta", "rosalind", { affinity: 55, crush: 20 });
    await met(w, 6, "teo", "ines", 2);
    await met(w, 6, "ines", "teo", 1);
    await met(w, 6, "augusta", "rosalind", -1);
    await met(w, 6, "rosalind", "augusta", 0);
    const night = await runRomance(database.db, w, 6);
    expect(night.grown).toBe(3);
    expect(await edgeOf(w, "teo", "ines")).toMatchObject({ feelingKind: "crush", feelingIntensity: 5, tag: "spark" });
    expect(await edgeOf(w, "ines", "teo")).toMatchObject({ feelingKind: "crush", feelingIntensity: 5 });
    expect(await edgeOf(w, "augusta", "rosalind")).toMatchObject({ feelingKind: "crush", feelingIntensity: 15 });
    // Nothing passed between them on Roz's side: her crush stays.
    expect(await edgeOf(w, "rosalind", "augusta")).toMatchObject({ feelingKind: "crush", feelingIntensity: 20 });
  });

  it("never starts one between friends nobody seeded, nor grows one between residents who may not court", async () => {
    const w = await newWorld();
    await setPair(w, "june", "odile", { affinity: 80, kind: null, crush: 0 });
    await setPair(w, "june", "tib", { affinity: 80, crush: 10, tag: "spark" });
    for (const [self, other] of [["june", "odile"], ["odile", "june"], ["june", "tib"], ["tib", "june"]] as const) await met(w, 3, self, other, 3);
    expect((await runRomance(database.db, w, 3)).grown).toBe(0);
    expect(await edgeOf(w, "june", "odile")).toMatchObject({ feelingKind: null, feelingIntensity: 0 });
    expect(await edgeOf(w, "june", "tib")).toMatchObject({ feelingIntensity: 10 });
  });
});

describe("the engine's outings", () => {
  const meeting = (a: string, b: string, extra: Partial<Meeting> = {}): Meeting =>
    ({ a, b, place: "millbrook.weir", minute: 1020, overlap: 120, planned: false, ...extra });

  it("puts a courting pair at the café and a birthday's guests at the party, as planned time together", () => {
    const present = new Set(["kasimir", "priya", "odile", "june", "hollis"]);
    expect(scheduledMeetings([
      { type: "date", minute: 900, wherePlace: "market_row.cafe_liss", who: ["kasimir", "priya"] },
      { type: "birthday_party", minute: 1080, wherePlace: "market_row.bakery_flat", who: ["odile", "june", "hollis", "gone"] },
      { type: "courting", minute: 1560, wherePlace: "x", who: ["june", "hollis"] },
    ], present)).toEqual([
      { a: "kasimir", b: "priya", place: "market_row.cafe_liss", minute: 900, overlap: 60, planned: true },
      { a: "june", b: "odile", place: "market_row.bakery_flat", minute: 1080, overlap: 120, planned: true },
      { a: "hollis", b: "odile", place: "market_row.bakery_flat", minute: 1080, overlap: 120, planned: true },
    ]);
    expect(scheduledMeetings([{ type: "date", minute: 900, wherePlace: "market_row.cafe_liss", who: ["kasimir", "gone"] }], present)).toEqual([]);
  });

  it("keeps one meeting a pair, the planned one first", () => {
    const merged = mergeMeetings([meeting("kasimir", "priya"), meeting("june", "odile")], [meeting("kasimir", "priya", { place: "market_row.cafe_liss", overlap: 60, planned: true })]);
    expect(merged).toEqual([meeting("june", "odile"), meeting("kasimir", "priya", { place: "market_row.cafe_liss", overlap: 60, planned: true })]);
    expect(mergeMeetings([meeting("a", "b", { planned: true, overlap: 200 })], [meeting("a", "b", { planned: true, overlap: 60 })])[0]!.overlap).toBe(200);
    // A couple's café date and a birthday party they both attend: they met at the café.
    const both = scheduledMeetings([
      { type: "birthday_party", minute: 1080, wherePlace: "millbrook.priya_house", who: ["priya", "kasimir", "june"] },
      { type: "date", minute: 900, wherePlace: "market_row.cafe_liss", who: ["kasimir", "priya"] },
    ], new Set(["kasimir", "priya", "june"]));
    expect(mergeMeetings([], both).map((m) => `${m.a}+${m.b}@${m.place}`)).toEqual(["june+priya@millbrook.priya_house", "kasimir+priya@market_row.cafe_liss"]);
  });
});

describe("birthdays (§9.11.3 life events)", () => {
  it("throws a party the night before for a resident with 3+ friends, at home at 18:00", async () => {
    const w = await newWorld();
    // Odile's birthday is Day 13. Three friends (a pair's mean ≥ 40), and one who isn't.
    for (const id of ["june", "hollis", "delphine"]) await setPair(w, "odile", id, { affinity: 50 });
    await setPair(w, "odile", "rook", { affinity: 30 }, { affinity: 45 });
    await setPair(w, "odile", "pell", { affinity: 10 });
    for (const id of ["sable", "nell", "bru", "margo", "kasimir", "bertrand", "tib", "bastien", "moss", "felix", "nettie", "ada", "teo", "augusta", "rosalind", "priya", "ines", "vane"]) {
      if (await edgeOf(w, "odile", id)) await setEdge(w, "odile", id, { affinity: 0 });
      if (await edgeOf(w, id, "odile")) await setEdge(w, id, "odile", { affinity: 0 });
    }
    expect(await scheduleBirthdayParties(database.db, w, 13)).toEqual([]);   // nobody's birthday on Day 14
    expect(await scheduleBirthdayParties(database.db, w, 12)).toEqual(["odile"]);
    const [party] = await database.db.select().from(events).where(and(eq(events.worldId, w), eq(events.type, "birthday_party")));
    expect(party).toMatchObject({
      id: "birthday_party_odile_13", day: 13, minute: 1080, wherePlace: cards.find((c) => c.id === "odile")!.home,
      who: ["odile", "delphine", "hollis", "june"], summary: "A birthday party for Odile Fournier.",
    });
    // Again: nothing new.
    await scheduleBirthdayParties(database.db, w, 12);
    expect((await database.db.select().from(events).where(and(eq(events.worldId, w), eq(events.type, "birthday_party")))).length).toBe(1);
  });

  it("throws none for a resident with fewer than three friends", async () => {
    const w = await newWorld();
    for (const r of await database.db.select().from(relationships).where(eq(relationships.worldId, w))) {
      if (r.fromId === "pell" || r.toId === "pell") await setEdge(w, r.fromId, r.toId, { affinity: 0 });
    }
    await setPair(w, "pell", "odile", { affinity: 60 });
    await setPair(w, "pell", "hollis", { affinity: 60 });
    expect(await scheduleBirthdayParties(database.db, w, 7)).toEqual([]);   // Pell's is Day 8
  });
});
