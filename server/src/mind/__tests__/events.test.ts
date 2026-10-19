import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ClientEvent, EventIngestionResult, type PlanOutput } from "@monde/shared";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { events, memories, plans, residents, worlds } from "../../db/schema.js";
import { createWorld, ensureRoster } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import { loadDialogueContext, loadResidentPrefix, prefixSystemBlocks } from "../context.js";
import { DisabledMindClient } from "../mindClient.js";
import { eventTransaction, ingestInTransaction } from "../eventIngestion.js";
import { NightRunner } from "../night.js";
import { loadPlacePositions, withinSight, witnesses } from "../witnessing.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const apps: ReturnType<typeof buildApp>[] = [];
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
afterAll(async () => { await database?.client.close(); });

async function setup() {
  const world = await createWorld(database.db, randomUUID(), "invite");
  // Bring the world up to the content roster first, as its first route would: tests below edit stored cards.
  await ensureRoster(database.db, world.id);
  const mind = new DisabledMindClient();
  const runner = new NightRunner({ db: database.db, mind });
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind, nightRunner: runner });
  apps.push(app);
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, "monde-local-development-only")}` };
  return { app, worldId: world.id, runner, headers };
}
type Env = Awaited<ReturnType<typeof setup>>;
const post = (env: Env, batch: unknown[]) => env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/events`, headers: env.headers, payload: { events: batch } });
const base = { day: 1, minute: 600 };
const town = (id: string = randomUUID()) => ({ ...base, id, kind: "town_event", type: "scuffle", place: "market_row.bakery", participants: ["player", "rook"], summary: "The Fellow stopped a Scuffle outside the bakery.", importance: 7 });
const cue = (id: string = randomUUID()) => ({ ...base, id, resident: "odile", scene_id: "s03", cue_key: "memory.1", kind: "scripted_memory", place: "market_row.bakery", text: "I watched the Fellow help.", importance: 7 });
const regard = (id: string = randomUUID()) => ({ ...base, id, resident: "odile", scene_id: "s03", cue_key: "regard.1", kind: "scripted_regard", delta: 20 });
const flags = (id: string = randomUUID(), revision = 1, values = ["rook_turned"]) => ({ ...base, id, kind: "flags", revision, flags: values });
const storedMemories = (env: Env) => database.db.select().from(memories).where(eq(memories.worldId, env.worldId));
const block = (place: string, start = "10:00", end = "11:00", action: "work" | "sleep" = "work"): PlanOutput["blocks"][number] =>
  ({ start, end, action, place, with: [], note: "" });
async function setPlan(env: Env, residentId: string, blocks: PlanOutput["blocks"]) {
  const plan: PlanOutput = { blocks, barks: [], intentions: [], seek_player: null, whim: null };
  await database.db.insert(plans).values({ worldId: env.worldId, residentId, day: 1, source: "template", plan }).onConflictDoUpdate({
    target: [plans.worldId, plans.residentId, plans.day], set: { plan },
  });
}
async function dialogue(env: Env, residentId = "odile") {
  return loadDialogueContext(database.db, { worldId: env.worldId, residentId, conversationId: randomUUID(),
    scene: { day: 2, minute: 600, place: "market_row.bakery", weather: "sun" }, playerSaid: "What happened yesterday?", playerText: "What happened yesterday?" });
}

describe("M-06 client ingestion", () => {
  it("writes gifts and rejects work at the wrong place, and applies scripted Regard outside the talk cap", async () => {
    const env = await setup();
    const [odile] = await database.db.select().from(residents).where(and(eq(residents.worldId, env.worldId), eq(residents.id, "odile")));
    await database.db.update(residents).set({ state: { ...odile!.state, regard: 0 }, talkDay: 1, talkGain: 6 }).where(and(eq(residents.worldId, env.worldId), eq(residents.id, "odile")));
    const response = await post(env, [town("t"), cue("m"), regard("r"), flags("f"),
      { ...base, id: "g", kind: "gift", resident: "odile", item: "bread" },
      { ...base, id: "c", kind: "community_work", task: "sweep", place: "market_row.bakery", participants: ["player"] }]);
    expect(response.statusCode).toBe(200);
    const result = EventIngestionResult.parse(response.json());
    expect(result.accepted).toEqual(["t", "m", "r", "f", "g"]);
    expect(result.rejected.map(r => r.id)).toEqual(["c"]);
    expect(result.regard.odile).toBe(28);
    expect((await storedMemories(env)).some(m => m.kind === "scripted" && m.text === cue().text)).toBe(true);
    expect((await storedMemories(env)).some(m => m.residentId === "rook" && m.kind === "did" && m.importance === 7)).toBe(true);
    // No stored plan: weekday routine puts Odile in her bakery at 10:00.
    expect((await storedMemories(env)).some(m => m.residentId === "odile" && m.kind === "saw" && m.sourceEvent === "t")).toBe(true);
    expect(await database.db.select().from(events).where(eq(events.worldId, env.worldId))).toHaveLength(1);
    const project = (await post(env, [{ ...town("opening"), type: "project_open", importance: 6 }])).json();
    expect(project.accepted).toEqual(["opening"]);
    expect((await storedMemories(env)).some(m => m.residentId === "odile" && m.importance === 6 && m.sourceEvent === "opening")).toBe(true);
    const next = (await post(env, [{ ...regard("clamp"), cue_key: "regard.2", delta: 10000 }])).json();
    expect(next.regard.odile).toBe(100);
    const dawn = await env.app.inject({ url: `/v1/worlds/${env.worldId}/dawn/1`, headers: env.headers });
    expect(dawn.json().regard.odile).toBe(100);
  });

  it("deduplicates ids, cue aliases, same-batch repeats, concurrent retries, and survives runner recreation", async () => {
    const env = await setup();
    const batch = [town("t"), cue("m"), regard("r"), flags("f")];
    const first = await post(env, [...batch, cue("m-alias"), regard("r-alias"), town("t")]);
    expect(first.json().duplicates).toEqual(["m-alias", "r-alias", "t"]);
    const count = (await storedMemories(env)).length;
    const results = await Promise.all([post(env, batch), post(env, batch)]);
    for (const result of results) expect(result.json().duplicates).toEqual(["t", "m", "r", "f"]);
    expect((await storedMemories(env)).length).toBe(count);
    // A fresh app/runner still consults durable receipts.
    const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind: new DisabledMindClient() });
    apps.push(app);
    expect((await post({ ...env, app }, batch)).json().duplicates).toEqual(["t", "m", "r", "f"]);
    const other = await setup();
    expect((await post(other, [cue("m")])).json().accepted).toEqual(["m"]);
  });

  it("uses exact event-day plans, radius and half-open times; participants need not be present; yesterday's Scuffle reaches dialogue", async () => {
    const env = await setup();
    await setPlan(env, "odile", [block("market_row.bakery")]);
    await setPlan(env, "pell", [block("market_row.market_street")]); // sqrt(85) > 6 from the bakery door
    await setPlan(env, "teo", [block("market_row.market_hall")]); // 7 > 6, across the Market Cross
    await setPlan(env, "ines", [block("market_row.storefront_3")]); // 19 > 6, east of the Hall; 3 from storefront_2
    await setPlan(env, "rook", [block("offmap.mainland", "00:00", "26:00", "sleep")]);
    await setPlan(env, "augusta", [block("market_row.bakery", "09:00", "10:00")]);
    await setPlan(env, "ada", [block("market_row.bakery", "10:01", "11:00")]);
    await setPlan(env, "moss", [block("market_row.bakery", "10:00", "11:00", "sleep")]);
    await post(env, [town("scuffle")]);
    const rows = (await storedMemories(env)).filter(m => m.sourceEvent === "scuffle");
    expect(rows.find(m => m.residentId === "odile")).toMatchObject({ kind: "saw", importance: 7 });
    expect(rows.find(m => m.residentId === "rook")).toMatchObject({ kind: "did" });
    for (const id of ["pell", "teo", "ines", "augusta", "ada", "moss"]) expect(rows.some(m => m.residentId === id)).toBe(false);
    const context = await dialogue(env);
    expect(context.ok).toBe(true);
    if (context.ok) expect(context.context.input.memories).toEqual(expect.arrayContaining([expect.objectContaining({ source_event: "scuffle", kind: "saw", day: 1 })]));
    await post(env, [{ ...town("sweep"), type: "sweeping", importance: 2, place: "market_row.storefront_2" }]);
    expect((await storedMemories(env)).find(m => m.residentId === "ines" && m.sourceEvent === "sweep")).toMatchObject({ kind: "saw", importance: 2 });
    const positions = await loadPlacePositions();
    expect(withinSight("market_row.storefront_1", "market_row.storefront_2", positions)).toBe(true);
    expect(withinSight("market_row.bakery", "old_quarter.town_hall", positions)).toBe(false);
    const boundary = new Map<string, [number, number]>([["zone.a", [0, 0]], ["zone.b", [6, 0]], ["zone.c", [6.01, 0]]]);
    expect(withinSight("zone.a", "zone.b", boundary)).toBe(true);
    expect(withinSight("zone.a", "zone.c", boundary)).toBe(false);
    expect(witnesses([block("zone.a")], "zone.b", 600, boundary)).toBe(true);
    expect(witnesses([block("zone.a")], "zone.b", 660, boundary)).toBe(false);
  });

  it("syncs full flags with monotonic revisions into canon locks, reveals, and stable prewarm/dialogue prefixes", async () => {
    const env = await setup();
    const before = await loadResidentPrefix(database.db, env.worldId, "rook");
    expect(JSON.stringify(prefixSystemBlocks(before!, 2))).toContain("Rook fights fair");
    await post(env, [flags("f", 2, ["rook_turned", "tollmen_broken", "rook_turned"])]);
    const after = await loadResidentPrefix(database.db, env.worldId, "rook");
    expect(after!.flags).toEqual(["rook_turned", "tollmen_broken"]);
    const prefix = JSON.stringify(prefixSystemBlocks(after!, 2));
    expect(prefix).not.toContain("Rook fights fair");
    expect(prefix).toContain("testifies against Vane");
    expect(prefix).toBe(JSON.stringify(prefixSystemBlocks((await loadResidentPrefix(database.db, env.worldId, "rook"))!, 2)));
    const ctx = await dialogue(env, "rook");
    if (!ctx.ok) throw new Error("missing dialogue");
    expect(ctx.context.validation.revealable.has("rook_s3")).toBe(true);
    expect(ctx.context.input.flags).toEqual(after!.flags);
    expect((await post(env, [flags("stale", 1, [])])).json().rejected[0].reason).toBe("stale flags revision");
    await post(env, [flags("clear", 3, [])]);
    expect((await loadResidentPrefix(database.db, env.worldId, "rook"))!.flags).toEqual([]);
  });

  it("ingests offline events in the night claim, reports individual failures, and deduplicates a repeated night", async () => {
    const env = await setup();
    await setPlan(env, "odile", [block("market_row.bakery")]);
    const batch = [town("t"), cue("m"), regard("r"), flags("f"), { ...cue("bad"), cue_key: "missing.1", resident: "missing" }];
    const response = await env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/night`, headers: env.headers, payload: { day: 1, client_events: batch } });
    expect(response.statusCode).toBe(200);
    expect(response.json().ingestion.accepted).toEqual(["t", "m", "r", "f"]);
    expect(response.json().ingestion.rejected).toHaveLength(1);
    await env.runner.idle();
    expect((await storedMemories(env)).some(m => m.sourceEvent === "t" && m.residentId === "odile")).toBe(true);
    const retry = await env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/night`, headers: env.headers, payload: { day: 1, client_events: batch } });
    expect(retry.json().ingestion.duplicates).toEqual(["t", "m", "r", "f"]);
    expect((await database.db.select().from(worlds).where(eq(worlds.id, env.worldId)))[0]!.storyFlags).toEqual(["rook_turned"]);
  });

  it("validates per item, caps batches, requires the world token, and preserves ids of rejected events for correction", async () => {
    const env = await setup();
    expect((await env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/events`, payload: { events: [] } })).statusCode).toBe(401);
    const other = await setup();
    expect((await post({ ...env, headers: other.headers }, [town()])).statusCode).toBe(401);
    expect((await post(env, Array.from({ length: 501 }, () => town()))).statusCode).toBe(400);
    const invalid = [{ ...town("importance"), importance: 9 }, { ...town("place"), place: "market_row.missing" },
      { ...cue("resident"), resident: "missing" }, { ...town("participant"), participants: ["missing"] },
      { ...town("long"), summary: "x".repeat(201) }, { ...town("type"), type: "unknown" }];
    expect((await post(env, invalid)).json().rejected).toHaveLength(invalid.length);
    expect(await storedMemories(env)).toHaveLength(0);
    expect((await post(env, [town("importance")])).json().accepted).toEqual(["importance"]);
    expect(ClientEvent.safeParse({ ...cue(), importance: 11 }).success).toBe(false);
  });

  it("retries a rolled-back database conflict without doubling memories or Regard", async () => {
    const env = await setup();
    const [before] = await database.db.select().from(residents).where(and(eq(residents.worldId, env.worldId), eq(residents.id, "odile")));
    let attempts = 0;
    const result = await eventTransaction(database.db, async tx => {
      const ingested = await ingestInTransaction(tx, env.worldId, [cue("m"), regard("r")]);
      if (++attempts === 1) throw new Error("driver conflict", { cause: Object.assign(new Error("serialization failure"), { code: "40001" }) });
      return ingested;
    });
    expect(attempts).toBe(2);
    expect(result.accepted).toEqual(["m", "r"]);
    expect(result.regard.odile).toBe(before!.state.regard + 20);
    expect((await storedMemories(env)).filter(m => m.kind === "scripted")).toHaveLength(1);
    expect((await post(env, [cue("m"), regard("r")])).json().duplicates).toEqual(["m", "r"]);
  });

  it("snapshots flags and idempotency receipts into a new branch", async () => {
    const env = await setup();
    await post(env, [cue("m"), regard("r"), flags("f")]);
    const save = await env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/snapshots`, headers: env.headers, payload: { day: 1, minute: 700, label: "After the scene" } });
    expect(save.statusCode).toBe(200);
    const restored = await env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/snapshots/${save.json().snapshot_id}/restore`, headers: env.headers });
    expect(restored.statusCode).toBe(200);
    const branch = { ...env, worldId: restored.json().world_id, headers: { authorization: `Bearer ${restored.json().token}` } };
    expect((await post(branch, [cue("m"), regard("r"), flags("f")])).json().duplicates).toEqual(["m", "r", "f"]);
    expect((await loadResidentPrefix(database.db, branch.worldId, "rook"))!.flags).toEqual(["rook_turned"]);
  });
});


describe('G-09 economy ingestion', () => {
  it('gifts ignore the talk cap, derive reactions from the card, double birthdays, dedupe across ids and persist memory', async () => {
    const env = await setup();
    const where = and(eq(residents.worldId, env.worldId), eq(residents.id, 'odile'));
    const [row] = await database.db.select().from(residents).where(where);
    await database.db.update(residents).set({ card: { ...row!.card, birthday: 1 }, state: { ...row!.state, regard: 0 }, talkDay: 1, talkGain: 6 }).where(where);
    const gift = { ...base, kind: 'gift', id: 'gift1', resident: 'odile', item: 'bread' };
    expect((await post(env, [gift])).json().regard.odile).toBe(16);
    expect((await post(env, [gift, { ...gift, id: 'gift2' }])).json().regard.odile).toBe(16);
    expect((await post(env, [{ ...gift, id: 'gift3', day: 2 }])).json().regard.odile).toBe(24);
    expect((await storedMemories(env)).filter(m => m.sourceEvent === 'gift1')).toHaveLength(1);
    const [after] = await database.db.select().from(residents).where(where);
    expect(after!.talkGain).toBe(6);
  });
  it('all six jobs become witnessed town events once; unknown jobs are rejected', async () => {
    const { COMMUNITY_TASKS } = await import('@monde/shared');
    const env = await setup();
    const batch = COMMUNITY_TASKS.map(t => ({ kind: 'community_work', id: t.id, day: t.opens, minute: 600, task: t.id, place: t.place, participants: ['player', 'odile'] }));
    const result = (await post(env, batch)).json();
    expect(result.accepted).toHaveLength(6); expect(result.rejected).toEqual([]);
    expect((await post(env, batch)).json().duplicates).toHaveLength(6);
    expect(await database.db.select().from(events).where(eq(events.worldId, env.worldId))).toHaveLength(6);
    expect((await storedMemories(env)).filter(m => m.residentId === 'odile' && m.kind === 'did')).toHaveLength(6);
    expect((await post(env, [{ ...batch[0], id: 'unknown', task: 'imaginary' }])).json().rejected).toHaveLength(1);
  });
});


it('shared meals earn +2 outside talk gains, dedupe, and reject inedible items', async () => {
  const env = await setup();
  const where = and(eq(residents.worldId, env.worldId), eq(residents.id, 'odile'));
  const [row] = await database.db.select().from(residents).where(where);
  await database.db.update(residents).set({ state: { ...row!.state, regard: 0 }, talkDay: 1, talkGain: 6 }).where(where);
  const meal = { ...base, kind: 'meal', id: 'meal1', resident: 'odile', item: 'bun' };
  expect((await post(env, [meal, meal])).json().regard.odile).toBe(2);
  const rejected = (await post(env, [{ ...meal, id: 'meal2', item: 'tools' }])).json();
  expect(rejected.rejected).toHaveLength(1); expect(rejected.regard.odile).toBe(2);
  expect((await post(env, [{ ...base, kind: 'gift', id: 'still-can-gift', resident: 'odile', item: 'bread' }])).json().regard.odile).toBe(10);
});
