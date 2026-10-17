import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  encounterChance, encounterRoll, pairKey, romanceFlag, type GossipOutput, type PersonaCard, type PlanOutput, type ReflectionOutput,
} from "@monde/shared";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { loadContent } from "../../content/loadContent.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { aiLog, memories, relationships, residents, tieMilestones, worlds } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import { DisabledMindClient, type MindClient } from "../mindClient.js";
import {
  ENCOUNTERS_PER_RESIDENT, chooseEncounters, encounterMemoryId, encounterMemoryText, findMeetings, persistEncounter, persistRuleEncounters,
  ruleOutcome, validateEncounter, type DayPlan, type Meeting,
} from "../encounters.js";
import { NightRunner } from "../night.js";
import { templatePlan } from "../templatePlan.js";
import { labelsOf } from "../ties.js";
import type { Tier } from "../tiers.js";
import { FakeNightMind, type NightCall, type NightReply } from "./fakeNightMind.js";

// ---------------------------------------------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------------------------------------------

type Block = PlanOutput["blocks"][number];
const block = (start: string, end: string, place: string, action: Block["action"] = "socialize", withIds: string[] = []): Block =>
  ({ start, end, action, place, with: withIds, note: "" });
const day = (residentId: string, ...blocks: Block[]): DayPlan => ({ residentId, blocks });

describe("findMeetings", () => {
  it("pairs residents who share a place for half an hour, or who planned to meet", () => {
    const meetings = findMeetings([
      day("odile", block("06:00", "09:00", "market_row.bakery", "work"), block("18:00", "21:00", "market_row.gull_and_anchor")),
      day("june", block("08:30", "09:00", "market_row.bakery", "shop"), block("19:00", "23:00", "market_row.gull_and_anchor")),
      day("hollis", block("08:45", "09:00", "market_row.bakery", "shop", ["odile"])),
      day("roz", block("20:40", "21:00", "market_row.gull_and_anchor", "work")),
    ]);
    expect(meetings).toEqual([
      { a: "hollis", b: "odile", place: "market_row.bakery", minute: 525, overlap: 15, planned: true },
      { a: "june", b: "odile", place: "market_row.gull_and_anchor", minute: 1140, overlap: 120, planned: false },
    ]);
  });

  it("ignores sleep, naps and off-map blocks, and handles times past midnight", () => {
    const meetings = findMeetings([
      day("june", block("21:00", "26:00", "market_row.pub_rooms", "sleep"), block("06:00", "08:00", "offmap.city", "work")),
      day("ines", block("21:00", "26:00", "market_row.pub_rooms", "sleep"), block("06:00", "08:00", "offmap.city", "work")),
      day("augusta", block("23:00", "25:30", "market_row.gull_and_anchor", "visit")),
      day("roz", block("22:00", "25:00", "market_row.gull_and_anchor", "work")),
    ]);
    expect(meetings).toEqual([{ a: "augusta", b: "roz", place: "market_row.gull_and_anchor", minute: 1380, overlap: 120, planned: false }]);
  });

  it("finds the routines' meetings for the real cast", async () => {
    const cards = await loadContent();
    const meetings = findMeetings(cards.map((c) => ({ residentId: c.id, blocks: templatePlan(c, 1).blocks })));
    const keys = meetings.map((m) => `${m.a}+${m.b}`);
    expect(keys).toContain("june+odile"); // the Gull & Anchor after work
    expect(keys).toContain("odile+rook");
    expect(meetings.every((m) => m.a < m.b && m.overlap >= 30)).toBe(true);
  });
});

describe("chooseEncounters", () => {
  const meeting = (a: string, b: string, planned = false): Meeting => ({ a, b, place: "commons.duck_pond", minute: 600, overlap: 60, planned });
  const tiers: Record<string, Tier> = { pell: "core", odile: "core", june: "core", hollis: "core", ada: "acquainted", bru: "ambient", nettie: "ambient", moss: "ambient" };
  const options = { seed: 99, day: 4, mean: () => 0, tier: (id: string) => tiers[id] ?? "ambient", modelEnabled: true };

  it("keeps the meetings whose seeded roll comes under the chance, the same every time", () => {
    const all = ["pell", "odile", "june", "hollis", "ada", "bru", "nettie", "moss"];
    const meetings = all.flatMap((a, i) => all.slice(i + 1).map((b) => meeting(a < b ? a : b, a < b ? b : a)));
    const chosen = chooseEncounters(meetings, { ...options, perResident: 99 });
    for (const m of meetings) {
      const happens = encounterRoll(99, 4, m.a, m.b) < encounterChance(0, false);
      expect(chosen.some((e) => e.a === m.a && e.b === m.b), `${m.a}+${m.b}`).toBe(happens);
    }
    expect(chooseEncounters(meetings, { ...options, perResident: 99 })).toEqual(chosen);
    expect(chosen.length).toBeGreaterThan(0);
  });

  it("puts Core pairs first, caps each resident at 3, and leaves Ambient pairs to the rule", () => {
    // Everyone meets everyone with a planned visit: nearly all of them happen.
    const all = ["pell", "odile", "june", "hollis", "ada", "bru", "nettie", "moss"];
    const meetings = all.flatMap((a, i) => all.slice(i + 1).map((b) => meeting(a < b ? a : b, a < b ? b : a, true)));
    const chosen = chooseEncounters(meetings, { ...options, mean: () => 100 });
    const per = new Map<string, number>();
    for (const e of chosen) for (const id of [e.a, e.b]) per.set(id, (per.get(id) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(ENCOUNTERS_PER_RESIDENT);
    const rank = (e: (typeof chosen)[number]) => ["core", "acquainted", "ambient"].indexOf(tiers[e.a]!) + ["core", "acquainted", "ambient"].indexOf(tiers[e.b]!);
    expect(chosen.map(rank)).toEqual([...chosen.map(rank)].sort((x, y) => x - y));
    for (const e of chosen) {
      const ambientPair = tiers[e.a] === "ambient" && tiers[e.b] === "ambient";
      expect(e.mode).toBe(ambientPair ? "rule" : "model");
      expect(e.priority).toBe(Math.min(...[e.a, e.b].map((id) => ["core", "acquainted", "ambient"].indexOf(tiers[id]!))));
    }
    expect(chooseEncounters(meetings, { ...options, mean: () => 100, modelEnabled: false }).every((e) => e.mode === "rule")).toBe(true);
    expect(chooseEncounters(meetings, { ...options, mean: () => 100, modelCap: 2 }).filter((e) => e.mode === "model")).toHaveLength(2);
  });
});

describe("validateEncounter", () => {
  const out = (patch: Partial<GossipOutput> = {}): string => JSON.stringify({
    lines: null, a_delta: { affinity: 2, trust: 1 }, b_delta: { affinity: -1, trust: 0 }, news_passed: [], feeling_change: null, ...patch,
  });

  it("clamps each side to ±3, drops lines and unknown news", () => {
    const v = validateEncounter(out({
      lines: [{ speaker: "a", text: "Morning." }], a_delta: { affinity: 9, trust: -7 }, news_passed: ["ev1", "made_up"],
    }), { offered: new Set(["ev1"]), romanceAllowed: true });
    expect(v).toMatchObject({ ok: true, outcome: { a: { affinity: 3, trust: -3 }, b: { affinity: -1, trust: 0 }, news: ["ev1"] } });
    expect(v.ok && v.adjustments).toEqual(["lines dropped (summary mode)", "unknown news ids dropped"]);
  });

  it("drops a crush between residents who may not court, keeps admiration", () => {
    const crush = out({ feeling_change: { who: "a", kind: "crush", delta: 30 } });
    expect(validateEncounter(crush, { offered: new Set(), romanceAllowed: false })).toMatchObject({ ok: true, outcome: { feeling: null } });
    expect(validateEncounter(crush, { offered: new Set(), romanceAllowed: true })).toMatchObject({ ok: true, outcome: { feeling: { who: "a", kind: "crush", delta: 10 } } });
    const admiration = out({ feeling_change: { who: "b", kind: "admiration", delta: 4 } });
    expect(validateEncounter(admiration, { offered: new Set(), romanceAllowed: false })).toMatchObject({ ok: true, outcome: { feeling: { kind: "admiration" } } });
  });

  it("rejects malformed replies", () => {
    expect(validateEncounter("nope", { offered: new Set(), romanceAllowed: true })).toMatchObject({ ok: false, category: "schema" });
    expect(validateEncounter('{"lines": null}', { offered: new Set(), romanceAllowed: true })).toMatchObject({ ok: false, category: "schema" });
  });

  it("writes a short first-person memory of the meeting", () => {
    expect(encounterMemoryText("Odile Fournier", false, 3)).toBe("Ran into Odile Fournier. It was the best part of the day.");
    expect(encounterMemoryText("Odile Fournier", true, -2)).toBe("Spent time with Odile Fournier. We got on each other's nerves.");
    expect(encounterMemoryText("Odile Fournier", false, 0)).toBe("Ran into Odile Fournier. Nothing much passed between us.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The night pass
// ---------------------------------------------------------------------------------------------------------------

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let cards: PersonaCard[];
beforeAll(async () => { [database, cards] = await Promise.all([createTestDatabase(), loadContent()]); }, 30_000);
afterAll(async () => { await database?.client.close(); });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const SECRET = "monde-local-development-only";
const card = (id: string) => cards.find((c) => c.id === id)!;

function reflection(patch: Partial<ReflectionOutput> = {}): ReflectionOutput {
  return {
    mood_delta: { valence: 0, energy: 0, stress: 0 }, emotion: "content", beliefs: ["The lamps held."], relationship_deltas: [],
    stance_deltas: [], regard_delta: 0, dream_progress: null, favor: null, letter: null, diary: "A day.", ...patch,
  };
}
const quiet: GossipOutput = { lines: null, a_delta: { affinity: 0, trust: 0 }, b_delta: { affinity: 0, trust: 0 }, news_passed: [], feeling_change: null };

type Respond = (call: NightCall) => NightReply;
const respond = (gossip: Respond = () => ({ output: quiet }), reflect: Respond = () => ({ output: reflection() })): Respond => (call) =>
  call.kind === "gossip" ? gossip(call) : call.kind === "reflect" ? reflect(call) : { output: templatePlan(card(call.resident), 2) };

async function setup(mind: MindClient) {
  const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
  const runner = new NightRunner({ db: database.db, mind, budgetMs: 10_000 });
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind, nightRunner: runner });
  apps.push(app);
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, SECRET)}` };
  return { app, runner, worldId: world.id, headers };
}
type Env = Awaited<ReturnType<typeof setup>>;
const night = (env: Env, day: number) =>
  env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/night`, headers: env.headers, payload: { day } });
const dawn = (env: Env, day: number) =>
  env.app.inject({ method: "GET", url: `/v1/worlds/${env.worldId}/dawn/${day}`, headers: env.headers });

/** A world seed under which the pair's Day-`d` roll comes under `chance`. */
async function seedSoThat(env: Env, d: number, a: string, b: string, meets: boolean, chance: number) {
  let seed = 1;
  while ((encounterRoll(seed, d, a, b) < chance) !== meets) seed++;
  await database.db.update(worlds).set({ seed }).where(eq(worlds.id, env.worldId));
  return seed;
}
const edge = async (worldId: string, from: string, to: string) => (await database.db.select().from(relationships).where(and(
  eq(relationships.worldId, worldId), eq(relationships.fromId, from), eq(relationships.toId, to),
)))[0];
async function setEdge(worldId: string, from: string, to: string, patch: Partial<typeof relationships.$inferInsert>) {
  const existing = await edge(worldId, from, to);
  if (existing) await database.db.update(relationships).set(patch).where(and(eq(relationships.worldId, worldId), eq(relationships.fromId, from), eq(relationships.toId, to)));
  else await database.db.insert(relationships).values({ worldId, fromId: from, toId: to, affinity: 0, trust: 0, tag: "acquaintance", note: "", ...patch });
}
async function patchResident(worldId: string, id: string, patch: (r: typeof residents.$inferSelect) => Partial<typeof residents.$inferInsert>) {
  const where = and(eq(residents.worldId, worldId), eq(residents.id, id));
  const [row] = await database.db.select().from(residents).where(where);
  await database.db.update(residents).set(patch(row!)).where(where);
}
const regardOf = async (worldId: string, id: string) =>
  (await database.db.select().from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, id))))[0]!.state.regard;

describe("encounters in the night pass", () => {
  it("judges a Core meeting with one summary call, applies it to both sides and tells tonight's reflection", async () => {
    const mind = new FakeNightMind(respond((call) => (call.resident === "june+odile"
      ? { output: { ...quiet, a_delta: { affinity: 3, trust: 2 }, b_delta: { affinity: 2, trust: 0 } } }
      : { output: quiet })));
    const env = await setup(mind);
    // Odile and June share the Gull & Anchor every evening. A seed with a very low roll puts their meeting ahead
    // of Odile's others (each resident has at most 3 a night).
    await seedSoThat(env, 1, "june", "odile", true, 0.02);
    expect((await night(env, 1)).json()).toMatchObject({ complete: true });

    const [call] = mind.callsFor("gossip", "june+odile");
    const prompt = call!.body.messages[0]!.content as string;
    expect(prompt).toContain('<gossip mode="summary">');
    expect(prompt).toContain("at market_row.gull_and_anchor");
    expect(prompt).toContain("How a sees b: odile (Odile Fournier) (fond): affinity");

    const toOdile = await edge(env.worldId, "june", "odile");
    const toJune = await edge(env.worldId, "odile", "june");
    expect(toOdile).toMatchObject({ lastSeenDay: 1, encounters: 1, netDay: 1, net: 3 });
    expect(toJune).toMatchObject({ affinity: 45 + 2, trust: 40, lastSeenDay: 1, encounters: 1, net: 2 });
    const mems = await database.db.select().from(memories).where(and(eq(memories.worldId, env.worldId), eq(memories.id, encounterMemoryId(1, "june", "odile", "odile"))));
    expect(mems[0]).toMatchObject({ residentId: "odile", kind: "did", who: ["june"], wherePlace: "market_row.gull_and_anchor", importance: 4, valence: 2, day: 1 });
    expect(mems[0]!.text).toBe('Ran into Juniper "June" Castellanos. We got on well.');
    // Odile's reflection ran after the encounter and saw it.
    const reflect = mind.callsFor("reflect", "odile")[0]!.body.messages[0]!.content as string;
    expect(reflect).toContain("(did): Ran into Juniper \"June\" Castellanos. We got on well.");
    const [log] = await database.db.select().from(aiLog).where(and(eq(aiLog.worldId, env.worldId), eq(aiLog.residentId, "june+odile")));
    expect(log).toMatchObject({ kind: "gossip", fallback: false, validation: "ok" });
  });

  it("falls back to the Ambient rule when the call fails, and runs everything by rule without a key", async () => {
    const failing = new FakeNightMind(respond(() => ({ output: "", stopReason: "refusal" })));
    const env = await setup(failing);
    await night(env, 1);
    // Under a loaded test run the budget can end first; the rest finishes in the background.
    await env.runner.idle(env.worldId);
    const logs = await database.db.select().from(aiLog).where(and(eq(aiLog.worldId, env.worldId), eq(aiLog.kind, "gossip")));
    expect(logs.length).toBe(failing.callsFor("gossip").length);
    expect(logs.every((l) => l.fallback && l.validation === "refusal")).toBe(true);
    // Everyone starts "even" (valence 0), so every rule encounter is +1 each way.
    const met = await database.db.select().from(relationships).where(and(eq(relationships.worldId, env.worldId), eq(relationships.lastSeenDay, 1)));
    expect(met.length).toBeGreaterThan(0);
    expect(met.every((r) => r.net === 1 || r.net === 2)).toBe(true); // +1, and +1 more for a planned visit

    const offline = await setup(new DisabledMindClient());
    await night(offline, 1);
    await offline.runner.idle(offline.worldId);
    expect(await database.db.select().from(aiLog).where(eq(aiLog.worldId, offline.worldId))).toEqual([]);
    const strangers = await edge(offline.worldId, "hollis", "june");
    // Two residents who'd never met are acquaintances after a meeting (if their roll came up).
    if (strangers) expect(strangers).toMatchObject({ affinity: 1, tag: "acquaintance", lastSeenDay: 1, encounters: 1 });
  });

  it("never lets a crush through for a child, from an encounter or a reflection", async () => {
    const mind = new FakeNightMind(respond(
      (call) => ({ output: { ...quiet, feeling_change: call.resident.includes("tib") ? { who: "a", kind: "crush", delta: 20 } : null } }),
      (call) => ({ output: reflection(call.resident === "june" ? { relationship_deltas: [{ id: "tib", affinity: 1, trust: 0, feeling: { kind: "crush", delta: 30 } }] } : {}) }),
    ));
    const env = await setup(mind);
    await night(env, 1);
    await env.runner.idle(env.worldId);
    expect(mind.callsFor("gossip").some((c) => c.resident.includes("tib"))).toBe(true);
    const rows = await database.db.select().from(relationships).where(eq(relationships.worldId, env.worldId));
    const touchingTib = rows.filter((r) => r.fromId === "tib" || r.toId === "tib");
    expect(touchingTib.some((r) => r.feelingKind === "crush" || r.feelingKind === "love")).toBe(false);
    expect(await edge(env.worldId, "june", "tib")).toMatchObject({ affinity: 1, feelingKind: null });
  });
});

describe("neglect, drift, milestones and the dawn's ties", () => {
  it("costs a Friend 1 Regard after 3 days without a word, never below 40", async () => {
    const env = await setup(new DisabledMindClient());
    await patchResident(env.worldId, "odile", (r) => ({ state: { ...r.state, regard: 50 }, lastTalkDay: 2 }));
    await patchResident(env.worldId, "pell", (r) => ({ state: { ...r.state, regard: 40 }, lastTalkDay: 2 }));
    await patchResident(env.worldId, "hollis", (r) => ({ state: { ...r.state, regard: 39 } }));
    await night(env, 4);
    expect(await regardOf(env.worldId, "odile")).toBe(50);
    await night(env, 5);
    expect([await regardOf(env.worldId, "odile"), await regardOf(env.worldId, "pell"), await regardOf(env.worldId, "hollis")]).toEqual([49, 40, 39]);
    await night(env, 6);
    expect(await regardOf(env.worldId, "odile")).toBe(49);
  });

  it("drifts a pair above 40 one point toward 40 for each week apart", async () => {
    const env = await setup(new DisabledMindClient());
    // Vane and Tib never cross paths in their routines.
    await setEdge(env.worldId, "vane", "tib", { affinity: 60 });
    await setEdge(env.worldId, "tib", "vane", { affinity: 41 });
    await night(env, 6);
    expect((await edge(env.worldId, "vane", "tib"))!.affinity).toBe(60);
    await night(env, 7);
    expect((await edge(env.worldId, "vane", "tib"))!.affinity).toBe(59);
    expect((await edge(env.worldId, "tib", "vane"))!.affinity).toBe(40);
  });

  it("records label changes as milestones and serves every pair's tie at dawn", async () => {
    const mind = new FakeNightMind(respond(undefined, (call) => ({
      output: reflection(call.resident === "odile"
        ? { relationship_deltas: [{ id: "june", affinity: 2, trust: 0, feeling: null }] }
        : call.resident === "rook" ? { relationship_deltas: [{ id: "odile", affinity: -2, trust: 0, feeling: null }] } : {}),
    })));
    const env = await setup(mind);
    await setEdge(env.worldId, "odile", "june", { affinity: 39 });
    await setEdge(env.worldId, "june", "odile", { affinity: 40 });
    await setEdge(env.worldId, "odile", "rook", { affinity: -40 });
    await setEdge(env.worldId, "rook", "odile", { affinity: 1 });
    await patchResident(env.worldId, "augusta", (r) => ({ state: { ...r.state, flags: [romanceFlag("courting", "rosalind")] } }));
    expect((await night(env, 1)).json()).toMatchObject({ complete: true });

    const stored = await database.db.select().from(tieMilestones).where(eq(tieMilestones.worldId, env.worldId));
    const kinds = Object.fromEntries(stored.map((m) => [`${m.aId}+${m.bId}`, m.kind]));
    expect(kinds).toMatchObject({ "june+odile": "became_friends", "odile+rook": "became_rivals" });

    const body = (await dawn(env, 2)).json();
    expect(body.ties.milestones).toEqual(expect.arrayContaining([
      { day: 1, a: "june", b: "odile", kind: "became_friends", from: "acquaintances", to: "friends" },
      { day: 1, a: "odile", b: "rook", kind: "became_rivals", from: "acquaintances", to: "rivals" },
    ]));
    const tie = (a: string, b: string) => body.ties.pairs.find((p: { a: string; b: string }) => p.a === a && p.b === b);
    expect(tie("june", "odile")).toEqual({ a: "june", b: "odile", label: "friends", romance: null });
    expect(tie("odile", "rook")).toMatchObject({ label: "rivals" });
    expect(tie("augusta", "rosalind")).toMatchObject({ label: "friends", romance: "courting" });
    expect(body.ties.pairs.every((p: { a: string; b: string; label: string }) => p.a < p.b && p.label !== "strangers")).toBe(true);
    // Non-residents on the cards (Odile's daughter) aren't ties.
    expect(body.ties.pairs.some((p: { a: string; b: string }) => p.a === "claudine" || p.b === "claudine")).toBe(false);
    // The pairs match a recount from the rows.
    const rows = await database.db.select().from(relationships).where(eq(relationships.worldId, env.worldId));
    expect(body.ties.pairs).toHaveLength(labelsOf(rows, new Set(cards.map((c) => c.id))).size);
    // The next dawn has no milestones of its own.
    expect((await dawn(env, 3)).json().ties.milestones).toEqual([]);
  });
});

describe("the night's rule-mode encounters, written together (MVP M-03)", () => {
  it("writes exactly what persistEncounter writes one at a time: edges, memories, heard news, milestones; a met pair is skipped", async () => {
    const cards = await loadContent();
    const names = Object.fromEntries(cards.map((c) => [c.id, c.name]));
    const meetings = findMeetings(cards.map((c) => ({ residentId: c.id, blocks: templatePlan(c, 1).blocks })));
    const chosen = chooseEncounters(meetings, { seed: 5, day: 1, mean: () => 30, tier: () => "ambient", modelEnabled: false, perResident: 99 });
    expect(chosen.length).toBeGreaterThan(5);
    const [one, two] = await Promise.all([createWorld(database.db, `device-${randomUUID()}`, "invite"), createWorld(database.db, `device-${randomUUID()}`, "invite")]);
    // News one side carries (it passes on), a pair already met today (a live chat's receipt), and a pair near a label.
    const teller = chosen[0]!.a, met = chosen[1]!;
    for (const w of [one, two]) {
      await database.db.insert(memories).values({ worldId: w.id, id: "news_1", residentId: teller, day: 1, minute: 500, kind: "saw", text: "The lamps went out on Heron Lane.", who: [], wherePlace: "old_quarter.heron_lane", importance: 5, valence: -1 });
      await database.db.insert(memories).values({ worldId: w.id, id: encounterMemoryId(1, met.a, met.b, met.a), residentId: met.a, day: 1, minute: 600, kind: "did", text: "Talked.", who: [met.b], wherePlace: met.place, importance: 3, valence: 1 });
      await setEdge(w.id, chosen[2]!.a, chosen[2]!.b, { affinity: 39 });
      await setEdge(w.id, chosen[2]!.b, chosen[2]!.a, { affinity: 39 });
    }
    const items = chosen.map((e, i) => ({ encounter: e, outcome: { ...ruleOutcome(i % 3 - 1, 2, e.mean), news: e.a === teller || e.b === teller ? ["news_1"] : [] } }));
    for (const it of items) await persistEncounter(database.db, { worldId: one.id, day: 1, flags: [], names, romanceAllowed: false }, it.encounter, it.outcome, null, null);
    const applied = await persistRuleEncounters(database.db, { worldId: two.id, day: 1, names }, items);
    expect(applied.has(pairKey(met.a, met.b))).toBe(false);
    expect(applied.size).toBe(items.length - 1);
    const strip = <T extends { worldId: string }>(rows: T[], key: (r: T) => string) => rows.map(({ worldId: _w, ...r }) => r).sort((x, y) => (key(x as unknown as T) < key(y as unknown as T) ? -1 : 1));
    const state = async (worldId: string) => ({
      edges: strip(await database.db.select().from(relationships).where(eq(relationships.worldId, worldId)), (r) => `${r.fromId}>${r.toId}`),
      memories: strip(await database.db.select().from(memories).where(eq(memories.worldId, worldId)), (r) => r.id),
      milestones: strip(await database.db.select().from(tieMilestones).where(eq(tieMilestones.worldId, worldId)), (r) => `${r.aId}+${r.bId}`),
    });
    const [a, b] = await Promise.all([state(one.id), state(two.id)]);
    expect(b.edges).toEqual(a.edges);
    expect(b.memories).toEqual(a.memories);
    expect(b.milestones).toEqual(a.milestones);
    expect(b.memories.some((m) => m.kind === "heard")).toBe(true);
    // Again: everything is already met, nothing changes.
    expect((await persistRuleEncounters(database.db, { worldId: two.id, day: 1, names }, items)).size).toBe(0);
    expect(await state(two.id)).toEqual(b);
  }, 30_000);
});
