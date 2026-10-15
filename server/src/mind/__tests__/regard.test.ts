/** The talk rules on the dialogue route (GDD §9.11.2; MVP G-13): first chat, the +6 daily cap, and the `turn` event's `regard`. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DialogueTurnOutput } from "@monde/shared";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { residents } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import { DisabledMindClient, type MindClient } from "../mindClient.js";
import { FakeMind } from "./fakeMind.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database?.client.close(); });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const SECRET = "monde-local-development-only";
const LINES = [
  "(Sets down a tray.) Rye today, and the starter sulking.",
  "The gulls had the bin lid off again by six.",
  "Hollis paid exact change. He always does.",
  "My wrists are telling me about the weather.",
  "Mind the step, the board's gone soft.",
];

function output(regard: number, i: number): DialogueTurnOutput {
  return {
    lines: [{ text: LINES[i % LINES.length]!, expr: "warm" }],
    choices: [{ id: "a", text: "How's the starter?", intent: "curious" }, { id: "b", text: "I'll mind it.", intent: "kind" }],
    effects: { regard_delta: regard, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: `t${i}` },
    wrap_up: false,
  };
}

async function setup(mind: MindClient) {
  const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind, dialogueTimings: { thinkingMs: 40, firstTextMs: 250, attemptMs: 3000 } });
  apps.push(app);
  return { app, worldId: world.id, headers: { authorization: `Bearer ${worldToken(world.id, world.deviceId, SECRET)}` } };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function turn(env: Env, day: number, conversation: string, first: boolean) {
  const res = await env.app.inject({
    method: "POST", url: `/v1/worlds/${env.worldId}/talk`, headers: env.headers,
    payload: {
      resident_id: "odile", conversation_id: conversation,
      input: first ? { kind: "open" } : { kind: "say", text: "Good bread." },
      context: { day, minute: 600, place: "market_row.bakery", weather: "fog" },
    },
  });
  const block = res.payload.split("\n\n").find((b) => b.startsWith("event: turn"))!;
  return JSON.parse(block.split("data: ")[1]!) as { fallback: boolean; regard: Record<string, unknown> };
}
const ledger = async (worldId: string) =>
  (await database.db.select().from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, "odile"))))[0]!;

describe("Regard from talk", () => {
  it("adds the first chat, caps the day's gains at +6, never caps a loss, and starts over the next day", async () => {
    const proposals = [5, 3, -2, 4, 5];
    const mind = new FakeMind(proposals.map((r, i) => ({ output: output(r, i), chunk: 50 })));
    const env = await setup(mind);
    const day3 = randomUUID();
    const events = [];
    for (let i = 0; i < 4; i++) events.push((await turn(env, 3, day3, i === 0)).regard);
    expect(events).toEqual([
      { before: 0, after: 6, delta: 6, hearts_before: 0, hearts_after: 0.5, first_chat: true, capped: false },
      { before: 6, after: 6, delta: 0, hearts_before: 0.5, hearts_after: 0.5, first_chat: false, capped: true },
      { before: 6, after: 4, delta: -2, hearts_before: 0.5, hearts_after: 0, first_chat: false, capped: false },
      { before: 4, after: 4, delta: 0, hearts_before: 0, hearts_after: 0, first_chat: false, capped: true },
    ]);
    expect(await ledger(env.worldId)).toMatchObject({ talkDay: 3, talkGain: 6, lastTalkDay: 3 });

    const next = (await turn(env, 4, randomUUID(), true)).regard;
    expect(next).toMatchObject({ before: 4, after: 10, delta: 6, first_chat: true, capped: false, hearts_after: 1 });
    expect(await ledger(env.worldId)).toMatchObject({ talkDay: 4, talkGain: 6, lastTalkDay: 4, state: expect.objectContaining({ regard: 10 }) });
  });

  it("still counts the day's first chat when the turn is an authored fallback (no key)", async () => {
    const env = await setup(new DisabledMindClient());
    const conversation = randomUUID();
    const first = await turn(env, 2, conversation, true);
    expect(first).toMatchObject({ fallback: true, regard: { before: 0, after: 1, delta: 1, first_chat: true } });
    expect((await turn(env, 2, conversation, false)).regard).toMatchObject({ delta: 0, first_chat: false });
  });
});
