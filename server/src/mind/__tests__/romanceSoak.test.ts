/**
 * G-12 acceptance soak (docs/MVP_PLAN.md: "A seeded couple reaches Courting in a 25-day soak"): 25 nights on the real
 * cast and routines with a deterministic fake mind, through POST /night and GET /dawn as the client uses them.
 *
 *   - Plans are the routines (who meets whom is the cards' own timetable); encounters are rolled from a fixed seed.
 *   - The fake plays the model as the cards would lead it: the three latent romances of §12.3 (`spark` on both cards)
 *     go well when they meet (+3 each way) and stir a crush (an encounter's feeling_change, a reflection's feeling
 *     delta); everyone else is judged as the G-13 soak judges them. It also pushes romance where it may never go: a
 *     crush or love for every pair who may not court (a child, the cat, mother and son, anyone spoken for), which the
 *     engine must drop every time.
 * It checks that Kasimir and Priya (latent romance 1) reach Courting by Day 25, with the ladder's thresholds met on
 * the night they do; that the dawn shows it, the Lantern prints it and the café date is kept; that no pair the
 * romance rules forbid ever holds a romantic feeling or courts; that nobody courts two people; and that the Lantern
 * names each birthday on its morning.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  ROMANCE_LADDER, ROMANTIC_FEELINGS, courtingNotice, pairKey, romanceEligible, romancePartners, type GossipOutput,
  type PersonaCard, type ReflectionOutput, type TieView,
} from "@monde/shared";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { loadContent } from "../../content/loadContent.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { events, memories, relationships, residents, worlds } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import { encounterMemoryId } from "../encounters.js";
import { NightRunner } from "../night.js";
import { templatePlan } from "../templatePlan.js";
import { FakeNightMind, type NightCall, type NightReply } from "./fakeNightMind.js";

const DAYS = 25;
const SEED = 2026;
const SECRET = "monde-local-development-only";
/** Latent romance 1 (§12.3): the couple the acceptance names. */
const COUPLE = ["kasimir", "priya"] as const;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let cards: PersonaCard[];
beforeAll(async () => { [database, cards] = await Promise.all([createTestDatabase(), loadContent()]); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const OUTCOMES: Readonly<Record<string, number>> = {
  "It was the best part of the day": 3, "We got on well": 2, "Pleasant enough": 1, "Nothing much passed between us": 0,
  "It was a little stiff": -1, "We got on each other's nerves": -2, "It went badly": -3,
};

describe("the G-12 soak: 25 nights, real routines, fake mind", () => {
  it("brings Kasimir and Priya to Courting by Day 25, and never a pair the romance rules forbid", async () => {
    const card = (id: string) => cards.find((c) => c.id === id)!;
    const byName = new Map(cards.map((c) => [c.name, c.id]));
    const sparks = new Set(cards.flatMap((c) => c.relationships.filter((r) => r.tag === "spark").map((r) => pairKey(c.id, r.id))));
    expect([...sparks].sort()).toEqual(["augusta+rosalind", "ines+teo", "kasimir+priya"]);
    const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
    await database.db.update(worlds).set({ seed: SEED }).where(eq(worlds.id, world.id));

    // Who may court whom, as the engine will decide it tonight (the flags only change at the end of a night).
    let flags = new Map<string, string[]>();
    const loadFlags = async () => {
      flags = new Map((await database.db.select({ id: residents.id, state: residents.state }).from(residents)
        .where(eq(residents.worldId, world.id))).map((r) => [r.id, r.state.flags]));
    };
    const mayCourt = (a: string, b: string) =>
      romanceEligible({ card: card(a), flags: flags.get(a) ?? [] }, { card: card(b), flags: flags.get(b) ?? [] });
    let pushed = 0;

    const judgeEncounter = (a: string, b: string, prompt: string): GossipOutput => {
      const none = { lines: null, news_passed: [] };
      if (sparks.has(pairKey(a, b)) && mayCourt(a, b)) {
        return { ...none, a_delta: { affinity: 3, trust: 1 }, b_delta: { affinity: 3, trust: 1 }, feeling_change: { who: "a", kind: "crush", delta: 6 } };
      }
      const view = (who: "a sees b" | "b sees a") => { const m = new RegExp(`How ${who}: .*?affinity (-?\\d+)`).exec(prompt); return m ? Number(m[1]) : null; };
      const ab = view("a sees b"), ba = view("b sees a");
      const step = ab === null && ba === null ? 1 : ((ab ?? 0) + (ba ?? 0)) / 2 >= 0 ? 2 : -3;
      // Where romance may never go, push it anyway: the engine must drop it.
      const forbidden = !mayCourt(a, b);
      if (forbidden) pushed++;
      return { ...none, a_delta: { affinity: step, trust: 0 }, b_delta: { affinity: step, trust: 0 }, feeling_change: forbidden ? { who: "b", kind: "love", delta: 10 } : null };
    };
    const reflect = (self: string, prompt: string): ReflectionOutput => {
      const deltas = new Map<string, { affinity: number; feeling: ReflectionOutput["relationship_deltas"][number]["feeling"] }>();
      for (const m of prompt.matchAll(/\(did\): (?:Ran into|Spent time with) (.+?)\. ([^.]+)\./g)) {
        const other = byName.get(m[1]!);
        const outcome = OUTCOMES[m[2]!];
        if (!other || outcome === undefined) continue;
        const seeded = sparks.has(pairKey(self, other)) && mayCourt(self, other);
        const forbidden = !mayCourt(self, other);
        if (forbidden) pushed++;
        const feeling = seeded && outcome > 0 ? { kind: "crush" as const, delta: 8 } : forbidden ? { kind: "crush" as const, delta: 15 } : null;
        const before = deltas.get(other);
        deltas.set(other, { affinity: (before?.affinity ?? 0) + outcome, feeling: before?.feeling ?? feeling });
      }
      return {
        mood_delta: { valence: 0, energy: 0, stress: 0 }, emotion: "content", beliefs: ["The town is waking up."],
        relationship_deltas: [...deltas].map(([id, d]) => ({ id, affinity: d.affinity, trust: 0, feeling: d.feeling })),
        stance_deltas: [], regard_delta: 0, dream_progress: null, favor: null, letter: null, diary: "Another day in Monde.",
      };
    };
    let tonight = 0;
    const respond = (call: NightCall): NightReply => {
      const prompt = call.body.messages[0]!.content as string;
      if (call.kind === "gossip") {
        const [a, b] = call.resident.split("+") as [string, string];
        return { output: judgeEncounter(a, b, prompt) };
      }
      if (call.kind === "reflect") return { output: reflect(call.resident, prompt) };
      return { output: templatePlan(card(call.resident), tonight + 1) };
    };
    const nights = new FakeNightMind(respond);
    const runner = new NightRunner({ db: database.db, mind: nights, budgetMs: 30_000 });
    const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind: nights, nightRunner: runner });
    const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, SECRET)}` };

    const courtingDay = new Map<string, number>();
    const dawnNotices = new Map<number, string[]>();
    for (let day = 1; day <= DAYS; day++) {
      await loadFlags();
      tonight = day;
      const res = await app.inject({ method: "POST", url: `/v1/worlds/${world.id}/night`, headers, payload: { day } });
      expect(res.json()).toMatchObject({ day, complete: true, pending: 0 });
      const dawn = (await app.inject({ method: "GET", url: `/v1/worlds/${world.id}/dawn/${day + 1}`, headers })).json();
      dawnNotices.set(day + 1, dawn.press?.notices ?? []);
      const rows = await database.db.select().from(relationships).where(eq(relationships.worldId, world.id));
      const edge = (from: string, to: string) => rows.find((r) => r.fromId === from && r.toId === to)!;
      const people = await database.db.select({ id: residents.id, state: residents.state }).from(residents).where(eq(residents.worldId, world.id));
      const partners = new Map(people.map((p) => [p.id, romancePartners(p.state.flags).filter((x) => x.stage === "courting").map((x) => x.id)]));

      // No romantic feeling anywhere but between residents who may court (the seeded romances, in this soak); never the Fellow.
      for (const r of rows) {
        if (!r.feelingKind || !ROMANTIC_FEELINGS.has(r.feelingKind) || r.feelingIntensity <= 0) continue;
        expect(sparks.has(pairKey(r.fromId, r.toId)), `${r.fromId}→${r.toId} ${r.feelingKind} ${r.feelingIntensity} on day ${day}`).toBe(true);
        expect([r.fromId, r.toId]).not.toContain("player");
      }
      // Nobody courts two people; courting is mutual and always between residents who may court.
      for (const [id, list] of partners) {
        expect(list.length, `${id} courting ${list.join(", ")}`).toBeLessThanOrEqual(1);
        for (const other of list) {
          expect(partners.get(other), `${other} courting ${id} back`).toEqual([id]);
          expect(romanceEligible({ card: card(id), flags: [] }, { card: card(other), flags: [] }), `${id}+${other}`).toBe(true);
        }
      }
      // Every pair the dawn shows courting: the night it began, the ladder's thresholds held, and the Lantern says so.
      for (const t of dawn.ties.pairs as TieView[]) {
        if (t.romance !== "courting" || courtingDay.has(pairKey(t.a, t.b))) continue;
        courtingDay.set(pairKey(t.a, t.b), day);
        const [ab, ba] = [edge(t.a, t.b), edge(t.b, t.a)];
        for (const e of [ab, ba]) {
          expect(e.affinity, `${e.fromId}→${e.toId}`).toBeGreaterThanOrEqual(ROMANCE_LADDER.courting.affinity);
          expect(e.feelingIntensity, `${e.fromId}→${e.toId}`).toBeGreaterThanOrEqual(ROMANCE_LADDER.crush.feeling);
          expect(e.encounters, `${e.fromId}→${e.toId}`).toBeGreaterThanOrEqual(ROMANCE_LADDER.courting.encounters);
        }
        expect(t.crush).toEqual([t.a, t.b]);
        expect(dawn.press.notices).toContain(courtingNotice(card(t.a).name, card(t.b).name));
      }
      for (const r of rows) if (r.netDay === day) expect(Math.abs(r.net), `${r.fromId}→${r.toId} on day ${day}`).toBeLessThanOrEqual(6);
    }
    await app.close();

    // The acceptance: the seeded couple courts by Day 25.
    const key = pairKey(...COUPLE);
    expect(courtingDay.get(key), `courting: ${[...courtingDay].map(([k, d]) => `${k} D${d}`).join(", ") || "nobody"}`).toBeDefined();
    const day = courtingDay.get(key)!;
    expect(day).toBeLessThanOrEqual(DAYS);
    expect((await database.db.select({ flags: worlds.storyFlags }).from(worlds).where(eq(worlds.id, world.id)))[0]!.flags).toContain("kasimir_priya_dating");
    // The café date two days on, and they kept it: planned time together at the café.
    const [date] = await database.db.select().from(events).where(and(eq(events.worldId, world.id), eq(events.type, "date"), eq(events.id, `date_${key}_${day + 2}`)));
    expect(date).toMatchObject({ day: day + 2, wherePlace: "market_row.cafe_liss", who: [...COUPLE] });
    if (day + 2 <= DAYS) {
      const [kept] = await database.db.select().from(memories).where(and(eq(memories.worldId, world.id), eq(memories.id, encounterMemoryId(day + 2, ...COUPLE, "kasimir"))));
      expect(kept).toMatchObject({ wherePlace: "market_row.cafe_liss" });
      expect(kept!.text).toMatch(/^Spent time with Priya Ramaswamy\./);
      expect(dawnNotices.get(day + 2)!.some((n) => n.includes("meet for tea at Café Liss"))).toBe(true);
    }
    // Every courtship in the soak is a seeded romance, and the engine dropped every romance it was pushed.
    for (const k of courtingDay.keys()) expect(sparks.has(k), k).toBe(true);
    expect(pushed).toBeGreaterThan(0);

    // Birthdays: the Lantern names each on its morning (Pell 8, Kasimir 12, Odile 13, Margo 16, June 21, Priya 22).
    for (const c of cards.filter((x) => x.birthday !== undefined && x.birthday >= 2 && x.birthday <= DAYS + 1)) {
      expect(dawnNotices.get(c.birthday!)!.some((n) => n.startsWith("Many happy returns today to") && n.includes(c.name)), `${c.id} on day ${c.birthday}`).toBe(true);
    }
    const parties = await database.db.select({ id: events.id, who: events.who }).from(events).where(and(eq(events.worldId, world.id), eq(events.type, "birthday_party")));

    if (process.env.MONDE_SOAK_REPORT) {
      console.info(JSON.stringify({
        courting: Object.fromEntries(courtingDay), pushedAndDropped: pushed, parties: parties.map((p) => `${p.id} (${p.who.length - 1} guests)`),
        encounters: nights.callsFor("gossip").length,
      }, null, 1));
    }
  }, 240_000);
});
