import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq } from "drizzle-orm";
import type { DialogueTurnOutput, ResidentState } from "@monde/shared";
import { buildApp, type AppOptions } from "../../app.js";
import { parseConfig } from "../../config.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { aiLog, dialogueTurns, favors, memories, residents } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import type { MindClient } from "../mindClient.js";
import { WRAP_UP_NOTE } from "../dialogue.js";
import { FALLBACK_LINES } from "../fallback.js";
import { RIDDLES } from "../riddles.js";
import { correctiveNote } from "../validate.js";
import { FakeMind, allBodies } from "./fakeMind.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const SECRET = "monde-local-development-only";
const TIMINGS = { thinkingMs: 40, firstTextMs: 250, attemptMs: 3000 };

async function setup(mind?: MindClient, options: AppOptions = {}) {
  const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind, dialogueTimings: TIMINGS, ...options });
  apps.push(app);
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, SECRET)}` };
  return { app, worldId: world.id, headers };
}
type Env = Awaited<ReturnType<typeof setup>>;

interface Payload {
  resident_id?: string;
  conversation_id?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
}
const payload = (overrides: Payload = {}) => ({
  resident_id: "pell",
  conversation_id: randomUUID(),
  input: { kind: "open" },
  ...overrides,
  context: {
    day: 4, minute: 17 * 60 + 30, place: "old_quarter.fountain_square", weather: "fog",
    current_activity: "walk at old_quarter.fountain_square", ...overrides.context,
  },
});

const talk = (env: Env, body: ReturnType<typeof payload>, headers: Record<string, string> = {}) =>
  env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/talk`, headers: { ...env.headers, ...headers }, payload: body });

interface SseEvent { event: string; data: any } // eslint-disable-line @typescript-eslint/no-explicit-any
function sse(raw: string): SseEvent[] {
  return raw.split("\n\n").filter((block) => block.includes("event:")).map((block) => {
    const event = /^event: (.+)$/m.exec(block)![1]!;
    const data = /^data: (.+)$/m.exec(block)![1]!;
    return { event, data: JSON.parse(data) };
  });
}
const finalTurn = (events: SseEvent[]) => {
  const last = events.at(-1)!;
  expect(last.event).toBe("turn");
  return last.data;
};

type Effects = Partial<DialogueTurnOutput["effects"]>;
function good(lines: string[] = ["(Counts a lamp.) Eighty-one lit tonight. Sit, Fellow.", "Tea's stewed."], effects: Effects = {}, extra: Partial<DialogueTurnOutput> = {}): DialogueTurnOutput {
  return {
    lines: lines.map((text) => ({ text, expr: "warm" })),
    choices: [{ id: "x", text: "Eighty-one of how many?", intent: "curious" }, { id: "y", text: "I'll sit.", intent: "kind" }],
    effects: {
      regard_delta: 2, mood: { valence: 3, stress: -1 }, memory: { text: "The Fellow sat with me by the lamps.", importance: 4 },
      favor: null, reveal_secret: null, topic: "the lamps", ...effects,
    },
    wrap_up: false,
    ...extra,
  };
}

async function residentState(worldId: string, id = "pell"): Promise<ResidentState> {
  const [row] = await database.db.select().from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
  return row!.state;
}
async function setResidentState(worldId: string, patch: (s: ResidentState) => ResidentState, id = "pell") {
  const state = await residentState(worldId, id);
  await database.db.update(residents).set({ state: patch(state) }).where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
}
const logs = (worldId: string) => database.db.select().from(aiLog).where(eq(aiLog.worldId, worldId)).orderBy(asc(aiLog.id));
const turnsOf = (worldId: string) => database.db.select().from(dialogueTurns).where(eq(dialogueTurns.worldId, worldId)).orderBy(asc(dialogueTurns.createdAt));

function userBlocks(body: Anthropic.MessageCreateParamsNonStreaming): string[] {
  const last = body.messages.at(-1)!;
  return typeof last.content === "string" ? [last.content] : last.content.map((block) => (block.type === "text" ? block.text : ""));
}

describe("POST /v1/worlds/:w/talk", () => {
  it("streams line_delta events, then a validated turn, and applies its effects", async () => {
    const mind = new FakeMind([{ output: good(), chunk: 5 }]);
    const env = await setup(mind);
    const body = payload();
    const res = await talk(env, body, { origin: "http://localhost:5173" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["x-request-id"]).toBeTruthy();

    const events = sse(res.payload);
    const deltas = events.filter((e) => e.event === "line_delta");
    expect(deltas.length).toBeGreaterThan(3);
    expect(events.findIndex((e) => e.event === "turn")).toBe(events.length - 1);
    expect(deltas[0]!.data).toMatchObject({ index: 0, attempt: 1 });
    expect(deltas.filter((d) => d.data.index === 0).at(-1)!.data.text_so_far).toBe(good().lines[0]!.text);
    expect(deltas.filter((d) => d.data.index === 1).at(-1)!.data.text_so_far).toBe("Tea's stewed.");
    expect(events.some((e) => e.event === "error" || e.event === "thinking")).toBe(false);

    const turn = finalTurn(events);
    expect(turn).toEqual({
      conversation_id: body.conversation_id, resident_id: "pell", turn_index: 0, fallback: false, wrap_up: false,
      lines: good().lines,
      choices: [{ id: "a", text: "Eighty-one of how many?", intent: "curious" }, { id: "b", text: "I'll sit.", intent: "kind" }],
    });

    const state = await residentState(env.worldId);
    expect(state).toMatchObject({ regard: 2, recent_topics: ["the lamps"], mood: { valence: 3, stress: 0 } });
    const [row] = await turnsOf(env.worldId);
    expect(row).toMatchObject({ id: `${body.conversation_id}/0`, conversationId: body.conversation_id, turnIndex: 0, fallback: false, playerInput: null, day: 4 });
    expect(row!.output.effects.topic).toBe("the lamps");
    const [memory] = await database.db.select().from(memories).where(eq(memories.worldId, env.worldId));
    expect(memory).toMatchObject({ residentId: "pell", kind: "said", who: ["player"], wherePlace: "old_quarter.fountain_square", importance: 4, day: 4, valence: 2 });

    const request = mind.streams[0]!;
    expect(request).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 400, thinking: { type: "disabled" } });
    expect(request.output_config?.format?.type).toBe("json_schema");
    expect(request.system).toHaveLength(3);
    expect(userBlocks(request)[0]).toContain("Name: Fellow (they/them)");
    expect(userBlocks(request)[0]).toContain("Day 4 (Fri, spring), 17:30, old_quarter.fountain_square");
  });

  it("writes an ai_log row per call with tokens, computed cost, latency and first-token time", async () => {
    const env = await setup(new FakeMind([{ output: good() }]));
    await talk(env, payload());
    const [log] = await logs(env.worldId);
    expect(log).toMatchObject({
      kind: "dialogue", residentId: "pell", model: "claude-haiku-5-5", inputTokens: 1200, cachedTokens: 3800,
      cacheWriteTokens: 0, outputTokens: 180, stopReason: "end_turn", validation: "ok", fallback: false,
      promptVersion: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
    // §9.15: 1,200 fresh + 3,800 cached in, 180 out ≈ $0.00025.
    expect(Number(log!.costUsd)).toBeCloseTo((1200 * 0.10 + 180 * 0.50 + 3800 * 0.01) / 1e6, 10);
    expect(log!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(log!.firstTokenMs).not.toBeNull();
  });

  it("regenerates once after malformed JSON, with a corrective note and the same cached blocks", async () => {
    const mind = new FakeMind([{ output: '{"lines": [{"text": "Hm' }, { output: good() }]);
    const env = await setup(mind);
    const events = sse((await talk(env, payload())).payload);
    expect(finalTurn(events)).toMatchObject({ fallback: false, lines: good().lines });
    expect(events.some((e) => e.event === "error")).toBe(false);
    expect(mind.streams).toHaveLength(2);
    expect(JSON.stringify(mind.streams[1]!.system)).toBe(JSON.stringify(mind.streams[0]!.system));
    expect(userBlocks(mind.streams[1]!)).toEqual([userBlocks(mind.streams[0]!)[0], correctiveNote("schema")]);
    expect(events.some((e) => e.event === "line_delta" && e.data.attempt === 2)).toBe(true);
    expect((await logs(env.worldId)).map((l) => [l.validation, l.fallback])).toEqual([["schema", false], ["ok", false]]);
  });

  it("falls back after a second failure: error event, authored turn, no effects", async () => {
    const mind = new FakeMind([{ output: "nope" }, { output: '{"lines": []' }]);
    const env = await setup(mind);
    const events = sse((await talk(env, payload())).payload);
    expect(events.at(-2)).toEqual({ event: "error", data: { code: "invalid_output", message: expect.any(String) } });
    const turn = finalTurn(events);
    expect(turn).toMatchObject({
      fallback: true, turn_index: 0, wrap_up: false,
      lines: [{ text: FALLBACK_LINES.Stranger.even, expr: "neutral" }],
      choices: [{ id: "a", text: "Fair enough.", intent: "kind" }, { id: "b", text: "Leave", intent: "leave" }],
    });
    expect(mind.streams).toHaveLength(2);
    expect(await residentState(env.worldId)).toMatchObject({ regard: 0, recent_topics: [] });
    expect((await turnsOf(env.worldId)).map((t) => t.fallback)).toEqual([true]);
    expect((await logs(env.worldId)).map((l) => [l.validation, l.fallback])).toEqual([["schema", true], ["schema", true]]);
  });

  it("falls back on a refusal without regenerating", async () => {
    const mind = new FakeMind([{ output: "", stopReason: "refusal" }, { output: good() }]);
    const env = await setup(mind);
    const events = sse((await talk(env, payload())).payload);
    expect(events.find((e) => e.event === "error")!.data.code).toBe("refusal");
    expect(finalTurn(events).fallback).toBe(true);
    expect(mind.streams).toHaveLength(1);
    expect((await logs(env.worldId)).map((l) => [l.stopReason, l.validation])).toEqual([["refusal", "refusal"]]);
  });

  it("falls back on max_tokens without regenerating", async () => {
    const mind = new FakeMind([{ output: '{"lines": [{"text": "On and on', stopReason: "max_tokens" }]);
    const env = await setup(mind);
    const events = sse((await talk(env, payload())).payload);
    expect(events.find((e) => e.event === "error")!.data.code).toBe("max_tokens");
    expect(finalTurn(events).fallback).toBe(true);
  });

  it("plays the thinking beat at 2.5 s and abandons the call at 6 s (scaled down here)", async () => {
    const mind = new FakeMind([{ hang: true }]);
    const env = await setup(mind);
    const events = sse((await talk(env, payload())).payload);
    expect(events.map((e) => e.event)).toEqual(["thinking", "error", "turn"]);
    expect(events[0]!.data).toEqual({ text: "Hm." });
    expect(events[1]!.data.code).toBe("timeout");
    expect(finalTurn(events).fallback).toBe(true);
    expect(mind.streams).toHaveLength(1);
    const [log] = await logs(env.worldId);
    expect(log).toMatchObject({ validation: "timeout", stopReason: "none", fallback: true, firstTokenMs: null });
    expect(log!.latencyMs).toBeGreaterThanOrEqual(TIMINGS.firstTextMs - 5);
  });

  it("sends thinking only while nothing is visible, then streams normally", async () => {
    const env = await setup(new FakeMind([{ output: good(), firstDelayMs: 120 }]));
    const events = sse((await talk(env, payload())).payload);
    expect(events[0]!.event).toBe("thinking");
    expect(events[1]!.event).toBe("line_delta");
    expect(finalTurn(events).fallback).toBe(false);
  });

  it("clamps a greedy regard_delta and maps an expression the card doesn't have", async () => {
    const greedy = good(["(Beams.) Fellow, you're a wonder."], { regard_delta: 50, mood: { valence: 40, stress: 0 } });
    greedy.lines[0]!.expr = "smirk";
    const env = await setup(new FakeMind([{ output: greedy }]));
    await setResidentState(env.worldId, (s) => ({ ...s, mood: { ...s.mood, emotion: "irritated" } }));
    const turn = finalTurn(sse((await talk(env, payload())).payload));
    expect(turn.lines[0].expr).toBe("angry");
    expect(await residentState(env.worldId)).toMatchObject({ regard: 5, mood: { valence: 10 } });
    const [row] = await turnsOf(env.worldId);
    expect(row!.output.effects.regard_delta).toBe(5);
  });

  it("regenerates when a banned word appears, and never streams it", async () => {
    const banned = good(["Mind your smartphone on the cobbles, Fellow."]);
    const mind = new FakeMind([{ output: banned, chunk: 3 }, { output: good() }]);
    const env = await setup(mind);
    const events = sse((await talk(env, payload())).payload);
    expect(finalTurn(events)).toMatchObject({ fallback: false, lines: good().lines });
    expect(events.some((e) => e.event === "line_delta" && /smartphone/i.test(e.data.text_so_far))).toBe(false);
    expect(userBlocks(mind.streams[1]!).at(-1)).toBe(correctiveNote("lexical:modern_tech"));
    expect((await logs(env.worldId)).map((l) => l.validation)).toEqual(["lexical:modern_tech", "ok"]);
  });

  it("nulls a reveal_secret that isn't revealable and keeps one that is", async () => {
    const telling = good(["(Looks at the desk drawer.) Now. The lamps."], { reveal_secret: "pell_s1" });
    const env = await setup(new FakeMind([{ output: telling }, { output: { ...telling, lines: [{ text: "There's a letter in my desk.", expr: "sad" }] } }]));
    await talk(env, payload());
    await setResidentState(env.worldId, (s) => ({ ...s, regard: 60 }));
    await talk(env, payload());
    const turns = await turnsOf(env.worldId);
    expect(turns.map((t) => t.output.effects.reveal_secret)).toEqual([null, "pell_s1"]);
  });

  it("runs the riddle post-filter only when context.riddle is set, with the server's answers", async () => {
    const leaky = good(["(Taps the plaque.) Sounds like the old bell by the chapel gate."]);
    const mind = new FakeMind([{ output: leaky, chunk: 4 }, { output: leaky }, { output: leaky }]);
    const env = await setup(mind);

    const riddleTurn = sse((await talk(env, payload({ context: { riddle: { id: "OQ-1", hints_allowed: 2 } } }))).payload);
    expect(riddleTurn.find((e) => e.event === "error")!.data.code).toBe("invalid_output");
    expect(finalTurn(riddleTurn)).toMatchObject({ fallback: true, lines: [{ text: RIDDLES["OQ-1"]!.hints[1] }] });
    expect(riddleTurn.some((e) => e.event === "line_delta" && /bell/i.test(e.data.text_so_far))).toBe(false);
    const prompt = userBlocks(mind.streams[0]!)[0]!;
    expect(prompt).toContain('<hints allowed="2">');
    expect(prompt).not.toMatch(/old bell|chapel bell/i);
    expect(userBlocks(mind.streams[1]!).at(-1)).toBe(correctiveNote("riddle"));

    const ordinary = sse((await talk(env, payload())).payload);
    expect(finalTurn(ordinary)).toMatchObject({ fallback: false, lines: leaky.lines });
  });

  it("ignores answer lists sent by the client", async () => {
    const env = await setup(new FakeMind([{ output: good() }]));
    const body = payload({ context: { riddle: { id: "OQ-1", hints_allowed: 1, accepted: ["lamps", "tea"] } } });
    expect(finalTurn(sse((await talk(env, body)).payload)).fallback).toBe(false);
  });

  it("regenerates a line that echoes one of the resident's recent lines", async () => {
    const line = "Eighty-one lamps lit tonight, and the rest want new mantles before Friday.";
    const mind = new FakeMind([{ output: good([line]) }, { output: good([line]) }, { output: good(["Tea, then. Sit."]) }]);
    const env = await setup(mind);
    await talk(env, payload());
    const events = sse((await talk(env, payload())).payload);
    expect(finalTurn(events)).toMatchObject({ fallback: false, lines: [{ text: "Tea, then. Sit." }] });
    expect(userBlocks(mind.streams[2]!).at(-1)).toBe(correctiveNote("echo"));
    expect((await logs(env.worldId)).map((l) => l.validation)).toEqual(["ok", "echo", "ok"]);
  });

  it("forces wrap_up on the 7th exchange and carries the conversation so far", async () => {
    const replies = ["Lamps first.", "Then tea.", "Then the Fund.", "Then Bertrand.", "Then the ferry.", "Then supper.", "Off you go."];
    const mind = new FakeMind(replies.map((line) => ({ output: good([line]) })));
    const env = await setup(mind);
    const conversation_id = randomUUID();
    const turns = [];
    for (let i = 0; i < 7; i++) {
      const input = i === 0 ? { kind: "open" } : { kind: "choice", choice_id: "a", text: `Question ${i}?`, intent: "curious" };
      turns.push(finalTurn(sse((await talk(env, payload({ conversation_id, input }))).payload)));
    }
    expect(turns.map((t) => t.turn_index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(turns.map((t) => t.wrap_up)).toEqual([false, false, false, false, false, false, true]);
    expect(turns[6].choices).toEqual([{ id: "a", text: "Leave", intent: "leave" }]);
    expect(userBlocks(mind.streams[5]!)).not.toContain(WRAP_UP_NOTE);
    expect(userBlocks(mind.streams[6]!).at(-1)).toBe(WRAP_UP_NOTE);
    const lastPrompt = userBlocks(mind.streams[6]!)[0]!;
    expect(lastPrompt).toContain("Fellow: Question 5?");
    expect(lastPrompt).toContain("You: Then supper.");
    expect((await turnsOf(env.worldId)).map((t) => t.playerInput)).toEqual([null, ...[1, 2, 3, 4, 5, 6].map((i) => `Question ${i}?`)]);
  });

  it("stores a proposed favor once per resident", async () => {
    const asking = (text: string) => good([text], { favor: { template: "help_chore", target: "old_quarter.lamplighter_lane", text: "Walk the lamps with me at dusk?" } });
    const env = await setup(new FakeMind([{ output: asking("Hold the ladder?") }, { output: asking("And the other one?") }]));
    await talk(env, payload());
    await talk(env, payload());
    const rows = await database.db.select().from(favors).where(eq(favors.worldId, env.worldId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ residentId: "pell", template: "help_chore", status: "proposed", createdDay: 4 });
  });

  it("answers with an authored fallback when no API key is configured", async () => {
    const env = await setup(undefined);
    const events = sse((await talk(env, payload())).payload);
    expect(events.map((e) => e.event)).toEqual(["error", "turn"]);
    expect(events[0]!.data.code).toBe("unavailable");
    expect(finalTurn(events)).toMatchObject({ fallback: true, lines: [{ text: FALLBACK_LINES.Stranger.even }] });
    expect((await logs(env.worldId)).map((l) => [l.validation, Number(l.costUsd)])).toEqual([["unavailable", 0]]);
  });

  it("rejects bad requests before streaming", async () => {
    const env = await setup(new FakeMind([{ output: good() }]));
    expect((await talk(env, { ...payload(), conversation_id: "not-a-uuid" })).statusCode).toBe(400);
    expect((await talk(env, payload({ input: { kind: "say", text: "x".repeat(141) } }))).statusCode).toBe(400);
    expect((await talk(env, payload({ context: { place: "Fountain Square" } }))).statusCode).toBe(400);
    expect((await talk(env, payload({ resident_id: "nobody" }))).statusCode).toBe(404);
    const conversation_id = randomUUID();
    expect((await talk(env, payload({ conversation_id }))).statusCode).toBe(200);
    expect((await talk(env, payload({ conversation_id, resident_id: "odile" }))).statusCode).toBe(409);
  });
});

describe("POST /v1/worlds/:w/prewarm", () => {
  const prewarm = (env: Env, body: Record<string, unknown>) =>
    env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/prewarm`, headers: env.headers, payload: body });

  it("sends max_tokens: 0 with the dialogue's exact system blocks, once per resident per window", async () => {
    const mind = new FakeMind([{ output: good() }]);
    const env = await setup(mind);
    expect((await prewarm(env, { resident_id: "pell", day: 4 })).json()).toEqual({ warmed: true });
    expect((await prewarm(env, { resident_id: "pell", day: 4 })).json()).toEqual({ warmed: false, reason: "recent" });
    expect((await prewarm(env, { resident_id: "odile" })).json()).toEqual({ warmed: true });
    expect(mind.creates).toHaveLength(2);
    const warm = mind.creates[0]!;
    expect(warm).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 0, thinking: { type: "disabled" } });
    expect(warm).not.toHaveProperty("stream");
    expect(warm).not.toHaveProperty("output_config");
    expect(warm.messages).toEqual([{ role: "user", content: "warmup" }]);

    await talk(env, payload());
    expect(JSON.stringify(mind.streams[0]!.system)).toBe(JSON.stringify(warm.system));
    const [log] = await logs(env.worldId);
    expect(log).toMatchObject({ kind: "prewarm", residentId: "pell", cacheWriteTokens: 3800, outputTokens: 0, stopReason: "max_tokens" });
    expect(Number(log!.costUsd)).toBeCloseTo((4 * 0.10 + 3800 * 0.125) / 1e6, 10);
  });

  it("allows another prewarm after the window", async () => {
    const env = await setup(new FakeMind(), { prewarmIntervalMs: 30 });
    expect((await prewarm(env, { resident_id: "pell" })).json()).toEqual({ warmed: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await prewarm(env, { resident_id: "pell" })).json()).toEqual({ warmed: true });
  });

  it("never fails the client: API errors, no key, unknown residents", async () => {
    const mind = new FakeMind();
    mind.createBehavior.error = new Error("400 max_tokens: must be at least 1");
    const env = await setup(mind);
    const failed = await prewarm(env, { resident_id: "pell" });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({ warmed: false, reason: "error" });
    expect((await prewarm(env, { resident_id: "nobody" })).statusCode).toBe(404);
    expect((await prewarm(env, {})).statusCode).toBe(400);

    const keyless = await setup(undefined);
    expect((await prewarm(keyless, { resident_id: "pell" })).json()).toEqual({ warmed: false, reason: "disabled" });
  });
});

describe("PATCH /v1/worlds/:w/player", () => {
  const patch = (env: Env, body: unknown) =>
    env.app.inject({ method: "PATCH", url: `/v1/worlds/${env.worldId}/player`, headers: env.headers, payload: body as Record<string, unknown> });
  const full = { name: "Ada", pronouns: "She/Her", background: "tinkerer", why: "to_help", loves: "Old books" };

  it("validates the profile, merges partial updates, and feeds the prompt", async () => {
    const mind = new FakeMind([{ output: good() }]);
    const env = await setup(mind);
    expect((await patch(env, { name: "Ada" })).json().error).toBe("incomplete player profile");
    expect((await patch(env, {})).statusCode).toBe(400);
    expect((await patch(env, { ...full, name: "A".repeat(17) })).statusCode).toBe(400);
    expect((await patch(env, { ...full, name: "   " })).statusCode).toBe(400);
    expect((await patch(env, { ...full, name: "Shithead" })).statusCode).toBe(400);
    expect((await patch(env, { ...full, background: "wizard" })).statusCode).toBe(400);
    expect((await patch(env, { ...full, why: "money" })).statusCode).toBe(400);
    expect((await patch(env, { ...full, pronouns: "it" })).statusCode).toBe(400);
    expect((await patch(env, { ...full, nickname: "Ace" })).statusCode).toBe(400);

    const created = await patch(env, full);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ player: { name: "Ada", pronouns: "she/her", background: "tinkerer", why: "to_help", loves: "old books" } });
    const renamed = await patch(env, { name: " Ada Lune ", pronouns: "xe/xem/xyr" });
    expect(renamed.json().player).toMatchObject({ name: "Ada Lune", pronouns: "xe/xem/xyr", background: "tinkerer" });

    await talk(env, payload());
    expect(userBlocks(mind.streams[0]!)[0]).toContain("Name: Ada Lune (xe/xem/xyr)");
    expect(userBlocks(mind.streams[0]!)[0]).toContain("Tinkerer: fixes things. Came to help. Loves old books.");
  });
});

describe("auth and API hygiene", () => {
  it("requires the world's own token on talk, prewarm and player", async () => {
    const env = await setup(new FakeMind());
    const other = await setup(new FakeMind());
    const requests = [
      { method: "POST" as const, url: `/v1/worlds/${env.worldId}/talk`, payload: payload() },
      { method: "POST" as const, url: `/v1/worlds/${env.worldId}/prewarm`, payload: { resident_id: "pell" } },
      { method: "PATCH" as const, url: `/v1/worlds/${env.worldId}/player`, payload: { name: "Ada" } },
    ];
    for (const request of requests) {
      for (const headers of [{}, { authorization: "Bearer nope" }, other.headers]) {
        expect((await env.app.inject({ ...request, headers })).statusCode).toBe(401);
      }
    }
  });

  it("allows PATCH from the game's origins at preflight", async () => {
    const env = await setup(new FakeMind());
    const res = await env.app.inject({
      method: "OPTIONS", url: `/v1/worlds/${env.worldId}/player`,
      headers: { origin: "https://game.itch.zone", "access-control-request-method": "PATCH" },
    });
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("never sends sampling parameters, a stream flag on prewarm, or an assistant-last message", async () => {
    const mind = new FakeMind([{ output: "bad" }, { output: good() }]);
    const env = await setup(mind);
    await talk(env, payload());
    await env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/prewarm`, headers: env.headers, payload: { resident_id: "odile" } });
    // Every body any FakeMind received in this file, including the regenerations and wrap-ups above.
    expect(allBodies.length).toBeGreaterThan(20);
    for (const body of allBodies) {
      for (const key of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(key);
      expect(body.messages.at(-1)!.role).toBe("user");
      expect(body.messages.every((m) => m.role === "user")).toBe(true);
    }
  });
});
