import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import * as s from "../../db/schema.js";
import { FakeNightMind } from "../../mind/__tests__/fakeNightMind.js";
import { DisabledMindClient, type MindClient } from "../../mind/mindClient.js";
import { NightRunner } from "../../mind/night.js";
import { templatePlan } from "../../mind/templatePlan.js";
import { createWorld } from "../createWorld.js";
import { worldToken } from "../routes.js";
import { SNAPSHOT_LIMIT, SNAPSHOT_MAX_BYTES } from "../snapshots.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const apps: ReturnType<typeof buildApp>[] = [];
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });
afterAll(async () => { await database?.client.close(); });
async function setup(mind: MindClient = new DisabledMindClient()) {
  const world = await createWorld(database.db, randomUUID(), "invite");
  const runner = new NightRunner({ db: database.db, mind });
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind, nightRunner: runner });
  apps.push(app);
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, "monde-local-development-only")}` };
  const url = `/v1/worlds/${world.id}/snapshots`;
  const save = (minute = 600, label = "Slot 1", day = 1) => app.inject({ method: "POST", url, headers, payload: { day, minute, label } });
  const restore = (id: string) => app.inject({ method: "POST", url: `${url}/${id}/restore`, headers });
  return { world, app, runner, headers, url, save, restore };
}

it("branches the complete saved mind, isolates later changes and can run the next night", async () => {
  const mind = new FakeNightMind((call) => call.kind === "reflect" ? { output: {
    mood_delta: { valence: 1, energy: 0, stress: 0 }, emotion: "content", beliefs: ["The Fellow helped."],
    relationship_deltas: [], stance_deltas: [], regard_delta: 1, dream_progress: null,
    favor: null, letter: null, diary: "A memory made after the save.",
  } } : { error: new Error("Use the deterministic plan fallback") });
  const e = await setup(mind);
  const db = database.db;
  const worldId = e.world.id;
  const [resident] = await db.select().from(s.residents).where(eq(s.residents.worldId, worldId));
  const r = resident!;
  await db.update(s.residents).set({ talkDay: 1, talkGain: 2, lastTalkDay: 1 }).where(and(eq(s.residents.worldId, worldId), eq(s.residents.id, r.id)));
  await db.update(s.relationships).set({ netDay: 1, net: 2, encounters: 5 }).where(eq(s.relationships.worldId, worldId));
  const memory = { worldId, id: "before", residentId: r.id, day: 1, minute: 500, kind: "saw", text: "Before save", who: ["player"], wherePlace: "commons.duck_pond", importance: 3, valence: 1 };
  await db.insert(s.memories).values(memory);
  await db.insert(s.events).values({ worldId, id: "event", day: 1, minute: 500, type: "talk", wherePlace: "commons.duck_pond", who: [r.id], importance: 2, tags: [], summary: "Hello" });
  await db.insert(s.plans).values([1, 2, 3].map((day) => ({ worldId, residentId: r.id, day, plan: templatePlan(r.card, day), source: "template" as const })));
  await db.insert(s.favors).values(["proposed", "completed"].map((status) => ({ worldId, id: status, residentId: r.id, template: "fetch", target: "flour", text: "Flour please", status, createdDay: 1, expiresDay: 5, reward: {} })));
  await db.insert(s.letters).values([false, true].map((delivered) => ({ worldId, id: String(delivered), fromId: r.id, toId: "player", day: 1, text: "Hello", delivered })));
  await db.insert(s.tieMilestones).values({ worldId, day: 1, aId: "a", bId: "b", kind: "friendship", fromLabel: "stranger", toLabel: "friend" });
  const turn = (conversationId: string) => ({ worldId, id: `${conversationId}/0`, residentId: r.id, conversationId, day: 1, minute: 500, fallback: true, output: { lines: [{ text: "Hello", expr: "neutral" as const }], choices: [], effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "" }, wrap_up: false } });
  const session = (id: string, compacted: boolean) => ({ worldId, id, residentId: r.id, openedDay: 1, openedMinute: 490, lastDay: 1, lastMinute: 500, place: "commons.duck_pond", compacted, history: compacted ? "" : "[]", system: [] });
  // An open session keeps its verbatim turns; a compacted one survives as its summary and the digest (§9.10.3).
  await db.insert(s.conversationSessions).values([session("talk", false), session("old", true)]);
  await db.insert(s.dialogueTurns).values([turn("talk"), turn("old")]);
  await db.insert(s.conversationSummaries).values({ worldId, conversationId: "old", residentId: r.id, day: 1, minute: 400, summary: "We talked about flour.", facts: { promises: [], asks: [], learned_about_player: [] }, topics: ["flour"], feltAfter: "content" });
  await db.insert(s.conversationDigests).values({ worldId, residentId: r.id, digest: "Met the Fellow once." });
  const saved = await e.save();
  expect(saved.statusCode).toBe(200);
  const id = saved.json().snapshot_id as string;
  const [stored] = await db.select().from(s.snapshots).where(eq(s.snapshots.id, id));
  const p = stored!.payload!;
  expect(p.version).toBe(1);
  expect(p.favors.map((f) => f.status)).toEqual(["proposed"]);
  expect(p.letters).toHaveLength(1);
  expect(p.plans.map((plan) => plan.day).sort()).toEqual([1, 2]);
  await db.insert(s.memories).values({ ...memory, id: "after", text: "After save" });
  await db.update(s.residents).set({ state: { ...r.state, regard: 50 } }).where(and(eq(s.residents.worldId, worldId), eq(s.residents.id, r.id)));
  await e.runner.start(worldId, { day: 1 });
  await e.runner.idle(worldId);
  expect(mind.calls.some((call) => call.kind === "reflect")).toBe(true);
  const [oldWorld] = await db.select().from(s.worlds).where(eq(s.worlds.id, worldId));
  const oldResidents = await db.select().from(s.residents).where(eq(s.residents.worldId, worldId));
  const oldMemories = await db.select().from(s.memories).where(eq(s.memories.worldId, worldId));
  const restored = await e.restore(id);
  expect(restored.statusCode).toBe(200);
  const branch = restored.json() as { world_id: string; token: string; branch_id: string };
  expect(branch.world_id).not.toBe(worldId);
  expect(branch.branch_id).not.toBe(e.world.branchId);
  const [world] = await db.select().from(s.worlds).where(eq(s.worlds.id, branch.world_id));
  expect(world).toMatchObject({ parentWorldId: worldId, day: 1, minute: 600, seed: e.world.seed, player: e.world.player });
  const [restoredResident] = await db.select().from(s.residents).where(and(eq(s.residents.worldId, branch.world_id), eq(s.residents.id, r.id)));
  expect(restoredResident).toMatchObject({ talkDay: 1, talkGain: 2, state: { regard: r.state.regard, world_id: branch.world_id } });
  for (const table of [s.relationships, s.memories, s.events, s.plans, s.favors, s.letters, s.tieMilestones]) {
    const rows = await db.select().from(table).where(eq(table.worldId, branch.world_id));
    const key = table === s.tieMilestones ? "tieMilestones" : table === s.relationships ? "relationships" : table === s.memories ? "memories" : table === s.events ? "events" : table === s.plans ? "plans" : table === s.favors ? "favors" : "letters";
    // SQL without ORDER BY has no stable row order; compare the complete keyed row set.
    expect(rows).toHaveLength(p[key].length);
    expect(rows).toEqual(expect.arrayContaining(p[key].map((row) => ({ ...row, worldId: branch.world_id }))));
  }
  expect((await db.select().from(s.dialogueTurns).where(eq(s.dialogueTurns.worldId, branch.world_id))).map((t) => t.conversationId)).toEqual(["talk"]);
  expect((await db.select().from(s.conversationSessions).where(eq(s.conversationSessions.worldId, branch.world_id))).map((x) => x.id)).toEqual(["talk"]);
  expect(await db.select().from(s.conversationSummaries).where(eq(s.conversationSummaries.worldId, branch.world_id))).toHaveLength(1);
  expect(await db.select().from(s.conversationDigests).where(eq(s.conversationDigests.worldId, branch.world_id))).toHaveLength(1);
  expect(await db.select().from(s.aiLog).where(eq(s.aiLog.worldId, branch.world_id))).toHaveLength(0);
  expect(await db.select().from(s.residents).where(eq(s.residents.worldId, worldId))).toEqual(oldResidents);
  expect(await db.select().from(s.memories).where(eq(s.memories.worldId, worldId))).toEqual(oldMemories);
  expect(await db.select().from(s.worlds).where(eq(s.worlds.id, worldId))).toEqual([oldWorld]);
  const again = await e.restore(id);
  expect(again.statusCode).toBe(200);
  expect(again.json().world_id).not.toBe(branch.world_id);
  const night = await e.app.inject({ method: "POST", url: `/v1/worlds/${branch.world_id}/night`, headers: { authorization: `Bearer ${branch.token}` }, payload: { day: 1 } });
  expect(night.statusCode).toBe(200);
  expect(night.json().already).toBeUndefined();
  await e.runner.idle();
});

it("requires the owning world's token, validates bodies and scopes snapshot ids", async () => {
  const e = await setup();
  const other = await setup();
  const id = (await e.save()).json().snapshot_id as string;
  for (const url of [e.url, `${e.url}/${id}/restore`]) {
    for (const headers of [{}, other.headers]) expect((await e.app.inject({ method: "POST", url, headers, payload: {} })).statusCode).toBe(401);
  }
  expect((await other.restore(id)).statusCode).toBe(404);
  expect((await e.restore(randomUUID())).statusCode).toBe(404);
  expect((await e.restore("bad")).statusCode).toBe(400);
  expect((await e.save(-1)).statusCode).toBe(400);
  expect((await e.save()).statusCode).toBe(429);
});

it("prunes oldest ordinary saves, protects checkpoints and refuses an all-checkpoint overflow", async () => {
  const e = await setup();
  const checkpoint = (await e.save(360, "Dawn", 70)).json().snapshot_id;
  const oldest = (await e.save(361, "Manual", 70)).json().snapshot_id;
  for (let i = 0; i < SNAPSHOT_LIMIT; i++) expect((await e.save(362 + i, "Manual", 70)).statusCode).toBe(200);
  const rows = await database.db.select().from(s.snapshots).where(eq(s.snapshots.worldId, e.world.id));
  expect(rows).toHaveLength(SNAPSHOT_LIMIT);
  expect(rows.some((r) => r.id === checkpoint)).toBe(true);
  expect(rows.some((r) => r.id === oldest)).toBe(false);
  await database.db.update(s.snapshots).set({ checkpoint: true }).where(eq(s.snapshots.worldId, e.world.id));
  expect((await e.save(800, "Manual", 70)).statusCode).toBe(409);
});

it("rejects oversized payloads without pruning or persisting a snapshot", async () => {
  const e = await setup();
  await e.save();
  await database.db.insert(s.memories).values({ worldId: e.world.id, id: "huge", residentId: "odile", day: 1, minute: 601, kind: "saw", text: "é".repeat(SNAPSHOT_MAX_BYTES / 2), who: [], wherePlace: "commons", importance: 1, valence: 0 });
  const result = await e.save(601);
  expect(result.statusCode).toBe(413);
  expect(result.json().error).toContain("2 MiB");
  expect(await database.db.select().from(s.snapshots).where(eq(s.snapshots.worldId, e.world.id))).toHaveLength(1);
});

it("uses the offline client's clock and rejects a save before an already completed night", async () => {
  const e = await setup();
  const saved = await e.save(800, "Offline progress", 4);
  expect(saved.statusCode).toBe(200);
  const restored = await e.restore(saved.json().snapshot_id);
  const id = restored.json().world_id as string;
  const result = await e.runner.start(id, { day: 4 });
  expect(result.status).toBe(200);
  expect(result.body).not.toHaveProperty("already");
  await e.runner.idle();
  await database.db.update(s.worlds).set({ day: 2 }).where(eq(s.worlds.id, e.world.id));
  expect((await e.save(700)).statusCode).toBe(409);
});

it("serializes simultaneous saves for the same world minute", async () => {
  const e = await setup();
  const results = await Promise.all([e.save(), e.save()]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 429]);
  expect(await database.db.select().from(s.snapshots).where(eq(s.snapshots.worldId, e.world.id))).toHaveLength(1);
});
