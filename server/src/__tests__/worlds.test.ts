import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, count, eq } from "drizzle-orm";
import { stringify } from "yaml";
import { ResidentState, romanceEligibility } from "@monde/shared";
import { createTestDatabase } from "../db/testDatabase.js";
import { backfillRoster, createWorld, ensureRoster, romanceFlagsOf } from "../worlds/createWorld.js";
import { FULL, fullRosterContent } from "./fullRoster.js";
import { loadResidentPrefix } from "../mind/context.js";
import { loadContent } from "../content/loadContent.js";
import { events, residents, relationships, worlds, devices } from "../db/schema.js";
import { buildApp } from "../app.js";
import { parseConfig } from "../config.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 20000);
afterAll(async () => { await database?.client.close(); });

it("clones Day-1 in under two seconds and isolates repeated device saves", async () => {
  const start = performance.now();
  const first = await createWorld(database.db, "device", "invite");
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(2000);
  console.info(`Day-1 creation: ${elapsed.toFixed(0)} ms`);
  const second = await createWorld(database.db, "device", "invite");
  expect(first.id).not.toBe(second.id);
  expect(first.branchId).not.toBe(second.branchId);
  const cards = await loadContent();
  expect(cards.length).toBeGreaterThanOrEqual(20);
  for (const world of [first, second]) {
    expect(world).toMatchObject({ day: 1, minute: 360, aiSpendUsd: "0" });
    const rows = await database.db.select().from(residents).where(eq(residents.worldId, world.id));
    expect(rows).toHaveLength(cards.length);
    for (const row of rows) {
      expect(ResidentState.safeParse(row.state).success).toBe(true);
      expect(row.state).toMatchObject({ world_id: world.id, regard: 0, stay: 50,
        beliefs: row.card.beliefs, location: row.card.routine.weekday[0]!.where,
        tier: row.card.kind === "canon" ? "core" : "ambient" });
    }
    const edges = await database.db.select().from(relationships).where(eq(relationships.worldId, world.id));
    expect(edges).toHaveLength(cards.reduce((n, card) => n + card.relationships.length, 0));
    for (const card of cards) for (const edge of card.relationships) {
      expect(edges).toContainEqual(expect.objectContaining({ fromId: card.id, toId: edge.id,
        affinity: edge.affinity, trust: edge.trust, tag: edge.tag, note: edge.note }));
    }
  }
});

it("checks invites, bearer tokens, nested routes, and cross-world access", async () => {
  const app = buildApp(parseConfig({ MONDE_ENV: "staging", MONDE_TOKEN_SECRET: "secret", MONDE_INVITE_CODES: " alpha, beta ", LOG_LEVEL: "silent" }), database.db);
  app.get("/v1/worlds/:w/probe", async () => ({ ok: true }));
  try {
    expect((await app.inject({ method: "POST", url: "/v1/worlds", payload: { device_id: "a", invite_code: "bad" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/worlds", payload: {} })).statusCode).toBe(400);
    const create = () => app.inject({ method: "POST", url: "/v1/worlds", payload: { device_id: "a", invite_code: "beta" } });
    const response = await create();
    expect(response.statusCode).toBe(200);
    const { world_id, token } = response.json();
    const other = (await create()).json();
    for (const suffix of ["", "/probe"]) {
      for (const authorization of [undefined, "Bearer bad", `Bearer ${"0".repeat(64)}`, `Bearer ${other.token}`]) {
        expect((await app.inject({ url: `/v1/worlds/${world_id}${suffix}`, headers: authorization ? { authorization } : {} })).statusCode).toBe(401);
      }
    }
    const read = await app.inject({ url: `/v1/worlds/${world_id}`, headers: { authorization: `Bearer ${token}` } });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ world_id, day: 1, minute: 360 });
    expect(read.json().residents).toBeGreaterThanOrEqual(20);
  } finally { await app.close(); }
});

it("accepts arbitrary dev invites and requires a non-dev secret", async () => {
  expect(() => parseConfig({ MONDE_ENV: "production" })).toThrow("MONDE_TOKEN_SECRET");
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db);
  try {
    expect((await app.inject({ method: "POST", url: "/v1/worlds", payload: { device_id: "dev", invite_code: "anything" } })).statusCode).toBe(200);
  } finally { await app.close(); }
});

it("rejects invalid cards clearly and rolls back a failed template insertion", async () => {
  const root = await mkdtemp(join(tmpdir(), "monde-content-"));
  try {
    await mkdir(join(root, "residents"));
    const path = join(root, "residents", "broken.yaml");
    await writeFile(path, "id: bad\nname: 123\n");
    await expect(loadContent(root)).rejects.toThrow(/Invalid resident card .*broken.yaml/);
    const card = (await loadContent())[0]!;
    card.relationships.push(card.relationships[0]!);
    await writeFile(path, stringify(card));
    const before = await database.db.select({ count: count() }).from(worlds);
    await expect(createWorld(database.db, "rollback-device", "code", root)).rejects.toThrow();
    expect(await database.db.select({ count: count() }).from(worlds)).toEqual(before);
    expect(await database.db.select().from(devices).where(eq(devices.id, "rollback-device"))).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ── The full Day-1 roster (MVP M-03 step 3) ──────────────────────────────────────────────────────────────────────

describe("the full Day-1 roster (212: the hand-written cast and the census's 188)", () => {
  let roster: Awaited<ReturnType<typeof fullRosterContent>>;
  beforeAll(async () => { roster = await fullRosterContent(); }, 30_000);
  afterAll(() => roster?.cleanup());

  it("loads the census's cards after the hand-written ones, by id; MONDE_ROSTER=authored leaves them out", async () => {
    const full = await loadContent(roster.dir, FULL);
    const hand = await loadContent(roster.dir, { roster: "authored" });
    expect(full).toHaveLength(212);
    expect(hand).toHaveLength(24);
    expect(full.slice(0, 24).map((c) => c.id)).toEqual(hand.map((c) => c.id));
    const day1 = full.slice(24).map((c) => c.id);
    expect(day1).toEqual([...day1].sort());
    expect(full.slice(24).every((c) => c.generated_by === "template" && c.household)).toBe(true);
    // The unit tests' default (vitest.config.ts) is the authored roster.
    expect(await loadContent(roster.dir)).toHaveLength(24);
  });

  it("clones Day 1 with all 212 in under two seconds, in chunks of 100", async () => {
    const start = performance.now();
    const world = await createWorld(database.db, "device-full", "invite", roster.dir, FULL);
    const elapsed = performance.now() - start;
    console.info(`Day-1 creation, full roster (212 residents): ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(2000);
    const cards = await loadContent(roster.dir, FULL);
    const rows = await database.db.select().from(residents).where(eq(residents.worldId, world.id));
    expect(rows).toHaveLength(212);
    const edges = await database.db.select().from(relationships).where(eq(relationships.worldId, world.id));
    expect(edges).toHaveLength(cards.reduce((n, card) => n + card.relationships.length, 0));
    expect(rows.filter((r) => r.tier === "core")).toHaveLength(cards.filter((c) => c.kind === "canon").length);
    // Voice ownership reads which cards are the census's (context.ts): they own no catchphrase.
    const census = cards.find((c) => c.generated_by)!;
    const prefix = (await loadResidentPrefix(database.db, world.id, census.id))!;
    expect(prefix.voices).toHaveLength(212);
    expect(prefix.voices.filter((v) => v.generated)).toHaveLength(188);
    expect(prefix.voices.find((v) => v.id === "odile")!.generated).toBeUndefined();
  });

  it("seeds a Day-1 couple's married:/together: flags, so neither courts anyone else", async () => {
    const world = await createWorld(database.db, "device-couples", "invite", roster.dir, FULL);
    const rows = await database.db.select().from(residents).where(eq(residents.worldId, world.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const spouses = rows.flatMap((r) => r.card.relationships.filter((t) => t.tag === "spouse").map((t) => [r.id, t.id] as const));
    const partners = rows.flatMap((r) => r.card.relationships.filter((t) => t.tag === "partner").map((t) => [r.id, t.id] as const));
    expect(spouses.length).toBeGreaterThan(10);
    expect(partners.length).toBeGreaterThan(4);
    for (const [a, b] of spouses) expect(byId.get(a)!.state.flags, a).toContain(`married:${b}`);
    for (const [a, b] of partners) expect(byId.get(a)!.state.flags, a).toContain(`together:${b}`);
    const [a, b] = spouses[0]!;
    const stranger = rows.find((r) => r.card.age >= 18 && r.id !== a && r.id !== b && !r.state.flags.length && r.card.kind !== "animal")!;
    const candidate = (id: string) => ({ card: byId.get(id)!.card, flags: byId.get(id)!.state.flags });
    expect(romanceEligibility(candidate(a), candidate(stranger.id))).toEqual({ ok: false, reason: "taken" });
    // The hand-written cast starts single, as before.
    expect(rows.filter((r) => !r.card.generated_by).every((r) => r.state.flags.length === 0)).toBe(true);
    expect(romanceFlagsOf({ relationships: [{ id: "x", affinity: 70, trust: 70, tag: "spouse", note: "" }, { id: "y", affinity: 70, trust: 70, tag: "Partner", note: "" }] }))
      .toEqual(["married:x", "together:y"]);
  });

  it("backfills a world made before the census, once, and never overwrites what the world has", async () => {
    const world = await createWorld(database.db, "device-old", "invite", roster.dir, { roster: "authored" });
    const where = (id: string) => and(eq(residents.worldId, world.id), eq(residents.id, id));
    const [pell] = await database.db.select().from(residents).where(where("pell"));
    await database.db.update(residents).set({ state: { ...pell!.state, regard: 37 } }).where(where("pell"));
    await database.db.update(relationships).set({ affinity: -12 }).where(and(eq(relationships.worldId, world.id), eq(relationships.fromId, "pell")));
    const before = await database.db.select().from(relationships).where(eq(relationships.worldId, world.id));

    const first = await backfillRoster(database.db, world.id, roster.dir, FULL);
    expect(first.residents).toBe(188);
    expect(first.ties).toBeGreaterThan(300);
    const rows = await database.db.select().from(residents).where(eq(residents.worldId, world.id));
    expect(rows).toHaveLength(212);
    expect(rows.find((r) => r.id === "pell")!.state.regard).toBe(37);
    const after = await database.db.select().from(relationships).where(eq(relationships.worldId, world.id));
    for (const e of before) expect(after).toContainEqual(e);
    const cards = await loadContent(roster.dir, FULL);
    expect(after).toHaveLength(cards.reduce((n, card) => n + card.relationships.length, 0));
    // A Day-1 couple arrives with its flags.
    const couple = rows.find((r) => r.card.relationships.some((t) => t.tag === "spouse"))!;
    expect(couple.state.flags.some((f) => f.startsWith("married:"))).toBe(true);

    expect(await backfillRoster(database.db, world.id, roster.dir, FULL)).toEqual({ residents: 0, ties: 0 });
    // The lazy path: one backfill per world per process, then a lookup. Someone who left on the ferry stays gone.
    const fresh = await createWorld(database.db, "device-old-2", "invite", roster.dir, { roster: "authored" });
    const leaver = cards.find((c) => c.generated_by)!.id;
    await database.db.insert(events).values({ worldId: fresh.id, id: `departure_${leaver}_9`, day: 9, minute: 600, type: "departure",
      wherePlace: "wharf.ferry_slip", who: [leaver], importance: 5, tags: ["departure"], summary: "Left on the Gannet." });
    const once = ensureRoster(database.db, fresh.id, roster.dir, FULL);
    expect(ensureRoster(database.db, fresh.id, roster.dir, FULL)).toBe(once);
    expect(await once).toMatchObject({ residents: 187 });
    expect(await database.db.select().from(residents).where(and(eq(residents.worldId, fresh.id), eq(residents.id, leaver)))).toEqual([]);
  }, 30_000);
});
