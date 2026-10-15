import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { residents, worlds } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import { PlayerProfile, playerView, storedProfile } from "../player.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function setup() {
  const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, {});
  apps.push(app);
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, "monde-local-development-only")}` };
  const patch = (body: Record<string, unknown>) => app.inject({ method: "PATCH", url: `/v1/worlds/${world.id}/player`, headers, payload: body });
  return { worldId: world.id, patch };
}
async function regardOf(worldId: string, id: string): Promise<number> {
  const [row] = await database.db.select({ state: residents.state }).from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
  return row!.state.regard;
}
async function setRegard(worldId: string, id: string, regard: number): Promise<void> {
  const [row] = await database.db.select({ state: residents.state }).from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
  await database.db.update(residents).set({ state: { ...row!.state, regard } }).where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
}

const HOMECOMER_SIX = ["pell", "bertrand", "odile", "hollis", "rosalind", "delphine"];
const form = { name: "Wren", pronouns: "they/them", background: "homecomer", why: "fresh_start", loves: "the sea" };

describe("PATCH /v1/worlds/:w/player: Background starts (§11.1)", () => {
  it("starts a Homecomer at Regard 20 with Pell, Bertrand, Odile, Hollis, Roz and Delphine, once", async () => {
    const env = await setup();
    await setRegard(env.worldId, "odile", 35);
    expect((await env.patch(form)).statusCode).toBe(200);
    for (const id of HOMECOMER_SIX) expect(await regardOf(env.worldId, id)).toBe(id === "odile" ? 35 : 20);
    expect(await regardOf(env.worldId, "margo")).toBe(0);

    // Re-sending the application (a resend on reconnect, a rename) never re-applies the start.
    await setRegard(env.worldId, "pell", 12);
    expect((await env.patch({ ...form, name: "Wren Abbot" })).statusCode).toBe(200);
    expect((await env.patch(form)).statusCode).toBe(200);
    expect(await regardOf(env.worldId, "pell")).toBe(12);
  });

  it("gives other Backgrounds no starting Regard", async () => {
    for (const background of ["tinkerer", "scrapper", "organizer"]) {
      const env = await setup();
      expect((await env.patch({ ...form, background })).statusCode).toBe(200);
      for (const id of HOMECOMER_SIX) expect(await regardOf(env.worldId, id)).toBe(0);
    }
  });

  it("accepts the 12 loves and §13.3's why ids, reads the old 'running_from_something', and rejects other loves", async () => {
    const env = await setup();
    const res = await env.patch({ ...form, why: "running_from_something", loves: " Old Clocks " });
    expect(res.json().player).toMatchObject({ why: "running", loves: "old clocks" });
    expect((await env.patch({ ...form, loves: "sunsets" })).statusCode).toBe(400);
    expect((await env.patch({ ...form, name: "1234" })).statusCode).toBe(400);
    const [row] = await database.db.select({ player: worlds.player }).from(worlds).where(eq(worlds.id, env.worldId));
    expect(storedProfile(row!.player)).toMatchObject({ why: "running" });
    expect(playerView(PlayerProfile.parse({ ...form, why: "running" })).background).toContain("Running from something");
  });
});
