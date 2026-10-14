import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count, eq } from "drizzle-orm";
import { stringify } from "yaml";
import { ResidentState } from "@monde/shared";
import { createTestDatabase } from "../db/testDatabase.js";
import { createWorld } from "../worlds/createWorld.js";
import { loadContent } from "../content/loadContent.js";
import { residents, relationships, worlds, devices } from "../db/schema.js";
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
  expect(cards).toHaveLength(20);
  for (const world of [first, second]) {
    expect(world).toMatchObject({ day: 1, minute: 360, aiSpendUsd: "0" });
    const rows = await database.db.select().from(residents).where(eq(residents.worldId, world.id));
    expect(rows).toHaveLength(20);
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
    expect(read.json()).toEqual({ world_id, day: 1, minute: 360, residents: 20 });
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
