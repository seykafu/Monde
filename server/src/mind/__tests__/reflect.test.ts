import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { ResidentState, type ReflectionOutput } from "@monde/shared";
import { createTestDatabase } from "../../db/testDatabase.js";
import { aiLog, favors, letters, memories, relationships, residents } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { DisabledMindClient, type MindClient } from "../mindClient.js";
import { SILENT_LOG, type NightJobDeps, type NightWorld } from "../nightJob.js";
import { loadPlaceRegistry, type PlaceRegistry } from "../places.js";
import {
  MAX_OPEN_FAVORS, applyFeeling, applyReflectionToState, diaryMemoryId, driftMood, reflectResident, validateReflection,
  type ReflectionValidationContext,
} from "../reflect.js";
import { FakeNightMind, type NightReply } from "./fakeNightMind.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let registry: PlaceRegistry;
beforeAll(async () => { [database, registry] = await Promise.all([createTestDatabase(), loadPlaceRegistry()]); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const DAY = 3;

function reflection(overrides: Partial<ReflectionOutput> = {}): ReflectionOutput {
  return {
    mood_delta: { valence: 4, energy: -2, stress: 1 },
    emotion: "wistful",
    beliefs: ["The Fellow keeps turning up.", "The lamps are the one promise I have kept."],
    relationship_deltas: [],
    stance_deltas: [],
    regard_delta: 1,
    dream_progress: null,
    favor: null,
    letter: null,
    diary: "Counted the lamps twice. Eighty-one.",
    ...overrides,
  };
}

async function setup(mind: MindClient, callTimeoutMs = 2000) {
  const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
  const ids = await database.db.select({ id: residents.id }).from(residents).where(eq(residents.worldId, world.id));
  const night: NightWorld = {
    worldId: world.id, day: DAY, residentIds: new Set(ids.map((r) => r.id)), places: registry,
    town: { pillars: { prosperity: 18, safety: 30, spirit: 22, charm: 25 }, census: 210, events: ["10:00 at old_quarter.fountain_square: A Scuffle."] },
    forecast: "fog", eventsTomorrow: [], flags: [],
  };
  const deps: NightJobDeps = { db: database.db, mind, gate: (task) => task(), callTimeoutMs, log: SILENT_LOG };
  return { worldId: world.id, night, deps };
}

async function stateOf(worldId: string, id = "pell"): Promise<ResidentState> {
  const [row] = await database.db.select().from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
  return row!.state;
}
async function setState(worldId: string, patch: (s: ResidentState) => ResidentState, id = "pell") {
  await database.db.update(residents).set({ state: patch(await stateOf(worldId, id)) })
    .where(and(eq(residents.worldId, worldId), eq(residents.id, id)));
}
async function addMemory(worldId: string, id: string, importance: number, minute = 600, residentId = "pell", day = DAY) {
  await database.db.insert(memories).values({
    worldId, id, residentId, day, minute, kind: "saw", text: `Memory ${id} about the lamps.`, who: ["player"],
    wherePlace: "old_quarter.lamplighter_lane", importance, valence: 1,
  });
}
const edge = async (worldId: string, to: string) => (await database.db.select().from(relationships).where(and(
  eq(relationships.worldId, worldId), eq(relationships.fromId, "pell"), eq(relationships.toId, to),
)))[0];
const logs = (worldId: string) => database.db.select().from(aiLog).where(eq(aiLog.worldId, worldId)).orderBy(asc(aiLog.id));
const reply = (output: unknown): NightReply => ({ output });

describe("reflectResident", () => {
  it("applies a clamped reflection and writes the diary, the favor and the letter", async () => {
    const mind = new FakeNightMind(() => reply(reflection({
      mood_delta: { valence: 40, energy: -3, stress: 22 },
      emotion: "anxious",
      beliefs: [
        "The Fellow mended the drain without being asked.", "The lamps are the one promise I have kept.",
        "the lamps are the one promise I have kept.", "I could check the internet for the census.",
        ...Array.from({ length: 12 }, (_, i) => `Belief number ${i + 1}.`),
      ],
      relationship_deltas: [
        { id: "margo", affinity: 25, trust: -3, feeling: { kind: "admiration", delta: 30 } },
        { id: "frye", affinity: 2, trust: 1, feeling: null },
        { id: "june", affinity: 4, trust: 2, feeling: null },
        { id: "ghost", affinity: 5, trust: 5, feeling: null },
        { id: "pell", affinity: 5, trust: 5, feeling: null },
      ],
      stance_deltas: [{ issue: "port_vane", delta: -40 }, { issue: "Bad Issue!", delta: 5 }],
      regard_delta: 12,
      dream_progress: { stage_done: true, note: "Nearly said it to the Fellow." },
      favor: { template: "introduce", target: "nell", text: "Bring Nell to my office. She won't come if I ask." },
      letter: { to: "player", text: "Fellow, the drain on the Lane. Thank you. E. Pell" },
      diary: "The Fellow fixed the drain. I counted the lamps twice anyway.",
    })));
    const env = await setup(mind);
    await addMemory(env.worldId, "m1", 6, 540);
    await addMemory(env.worldId, "m2", 3, 900);
    await addMemory(env.worldId, "yesterday", 9, 900, "pell", DAY - 1);

    const result = await reflectResident(env.deps, env.night, "pell");
    expect(result).toMatchObject({ source: "model", reason: "ok" });

    const state = await stateOf(env.worldId);
    expect(state.mood).toEqual({ valence: 15, energy: 47, stress: 15, emotion: "anxious", intensity: 15 });
    expect(state.regard).toBe(8);
    expect(state.stances).toEqual({ port_vane: -15 });
    expect(state.beliefs).toHaveLength(10);
    expect(state.beliefs.slice(0, 2)).toEqual(["The Fellow mended the drain without being asked.", "The lamps are the one promise I have kept."]);
    expect(state.beliefs.join(" ")).not.toContain("internet");
    expect(state.dream).toEqual({ stage: 0, notes: "Nearly said it to the Fellow." });

    expect(await edge(env.worldId, "margo")).toMatchObject({ affinity: 60, trust: 52, feelingKind: "admiration", feelingIntensity: 15 });
    expect(await edge(env.worldId, "frye")).toMatchObject({ affinity: 52, trust: 71 });
    expect(await edge(env.worldId, "june")).toMatchObject({ affinity: 4, trust: 2, tag: "acquaintance" });
    expect(await edge(env.worldId, "ghost")).toBeUndefined();

    const [favor] = await database.db.select().from(favors).where(eq(favors.worldId, env.worldId));
    expect(favor).toMatchObject({ residentId: "pell", template: "introduce", target: "nell", status: "proposed", createdDay: DAY, expiresDay: DAY + 5 });
    const [letter] = await database.db.select().from(letters).where(eq(letters.worldId, env.worldId));
    expect(letter).toMatchObject({ fromId: "pell", toId: "player", day: DAY + 1, delivered: false });
    const [diary] = await database.db.select().from(memories).where(and(eq(memories.worldId, env.worldId), eq(memories.id, diaryMemoryId("pell", DAY))));
    expect(diary).toMatchObject({ kind: "felt", day: DAY, minute: 1560, residentId: "pell", wherePlace: "old_quarter.pell_house", importance: 5, valence: 5 });
    expect(diary!.text).toBe("The Fellow fixed the drain. I counted the lamps twice anyway.");

    const [log] = await logs(env.worldId);
    expect(log).toMatchObject({ kind: "reflect", residentId: "pell", fallback: false, validation: "ok", stopReason: "end_turn", model: "claude-haiku-5-5" });
    expect(Number(log!.costUsd)).toBeGreaterThan(0);

    // The request: effort low, structured output, no sampling, today's memories only, town facts.
    const body = mind.calls[0]!.body;
    expect(body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 900, output_config: { effort: "low" } });
    expect(body.output_config?.format?.type).toBe("json_schema");
    for (const key of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(key);
    const user = body.messages[0]!.content as string;
    expect(user).toContain("Memory m1 about the lamps.");
    expect(user).not.toContain("Memory yesterday");
    expect(user).toContain("Census 210");
    expect(user).toContain("A Scuffle.");
    expect(user).not.toContain("last_chance");
  });

  it("sends at most 12 of today's memories, in the order they happened", async () => {
    const mind = new FakeNightMind(() => reply(reflection()));
    const env = await setup(mind);
    for (let i = 0; i < 15; i++) await addMemory(env.worldId, `m${String(i).padStart(2, "0")}`, i < 3 ? 1 : 5, 400 + i * 30);
    await reflectResident(env.deps, env.night, "pell");
    const user = mind.calls[0]!.body.messages[0]!.content as string;
    const lines = user.split("\n").filter((line) => line.startsWith(`- Day ${DAY},`));
    expect(lines).toHaveLength(12);
    expect(user).not.toContain("Memory m00 ");
    const times = lines.map((line) => /Day \d+, (\d\d:\d\d)/.exec(line)![1]!);
    expect([...times].sort()).toEqual(times);
  });

  it.each([
    ["malformed JSON", { output: "{\"mood_delta\": " }, "schema"],
    ["a schema miss", { output: { ...reflection(), emotion: "furious" } }, "schema"],
    ["a refusal", { output: "", stopReason: "refusal" }, "refusal"],
    ["max_tokens", { output: "{", stopReason: "max_tokens" }, "max_tokens"],
    ["an API error", { error: new Error("529 overloaded") }, "api_error"],
  ] as const)("falls back to the mood-drift rule on %s", async (_name, script, validation) => {
    const mind = new FakeNightMind(() => script as NightReply);
    const env = await setup(mind);
    await setState(env.worldId, (s) => ({ ...s, mood: { valence: 50, energy: 90, stress: 40, emotion: "excited", intensity: 50 } }));
    const before = await stateOf(env.worldId);

    const result = await reflectResident(env.deps, env.night, "pell");
    expect(result).toMatchObject({ source: "fallback", reason: validation });
    const after = await stateOf(env.worldId);
    expect(after.mood).toEqual({ valence: 45, energy: 86, stress: 36, emotion: "excited", intensity: 45 });
    expect(after.beliefs).toEqual(before.beliefs);
    expect(after.regard).toBe(before.regard);
    expect(await database.db.select().from(memories).where(eq(memories.worldId, env.worldId))).toEqual([]);
    const [log] = await logs(env.worldId);
    expect(log).toMatchObject({ kind: "reflect", fallback: true, validation });
  });

  it("falls back when the call runs past its deadline", async () => {
    const env = await setup(new FakeNightMind(() => ({ hang: true })), 50);
    expect(await reflectResident(env.deps, env.night, "pell")).toMatchObject({ source: "fallback", reason: "timeout" });
    expect((await logs(env.worldId))[0]).toMatchObject({ fallback: true, validation: "timeout" });
  });

  it("with no API key drifts the mood without a call or an ai_log row", async () => {
    const env = await setup(new DisabledMindClient());
    await setState(env.worldId, (s) => ({ ...s, mood: { ...s.mood, valence: -20 } }));
    expect(await reflectResident(env.deps, env.night, "pell")).toMatchObject({ source: "fallback", reason: "unavailable" });
    expect((await stateOf(env.worldId)).mood.valence).toBe(-18);
    expect(await logs(env.worldId)).toEqual([]);
  });

  it("drops a favor when the resident already has one open, or the town has six", async () => {
    const favor = { template: "fetch" as const, target: "rye_flour", text: "Rye flour that isn't from Carrow." };
    const env = await setup(new FakeNightMind(() => reply(reflection({ favor }))));
    const live = (id: string, residentId: string) => ({
      worldId: env.worldId, id, residentId, template: "fetch", target: "x", text: "x", status: "open",
      createdDay: 1, expiresDay: DAY + 2, reward: {},
    });
    await database.db.insert(favors).values(Array.from({ length: MAX_OPEN_FAVORS }, (_, i) => live(`f${i}`, `r${i}`)));
    expect(await reflectResident(env.deps, env.night, "pell")).toMatchObject({ source: "model" });
    expect(await database.db.select().from(favors).where(and(eq(favors.worldId, env.worldId), eq(favors.residentId, "pell")))).toEqual([]);

    const mine = await setup(new FakeNightMind(() => reply(reflection({ favor }))));
    await database.db.insert(favors).values({ ...live("mine", "pell"), worldId: mine.worldId, status: "proposed" });
    const result = await reflectResident(mine.deps, mine.night, "pell");
    expect(result?.adjustments.join()).toContain("already have one open");
    expect(await database.db.select().from(favors).where(eq(favors.worldId, mine.worldId))).toHaveLength(1);
  });
});

describe("validateReflection", () => {
  const ctx: ReflectionValidationContext = {
    residentId: "pell", residentIds: new Set(["pell", "nell", "june", "margo"]), relationshipIds: new Set(["frye"]),
    places: new Set(["old_quarter.library", "commons.community_garden"]), stances: {},
  };
  const check = (overrides: Partial<ReflectionOutput>) => validateReflection(JSON.stringify(reflection(overrides)), ctx);

  it("keeps a favor only with an allowed template and a target that exists", () => {
    const ok = (favor: ReflectionOutput["favor"]) => {
      const result = check({ favor });
      return result.ok ? result.output.favor : "invalid";
    };
    expect(ok({ template: "deliver", target: "june", text: "Give June this." })).toMatchObject({ target: "june" });
    expect(ok({ template: "deliver", target: "nobody", text: "Give it to nobody." })).toBeNull();
    expect(ok({ template: "introduce", target: "pell", text: "Meet me." })).toBeNull();
    expect(ok({ template: "help_chore", target: "old_quarter.library", text: "Hold the ladder?" })).toMatchObject({ template: "help_chore" });
    expect(ok({ template: "fetch", target: "rye_flour", text: "Rye flour." })).toMatchObject({ target: "rye_flour" });
    expect(ok({ template: "fetch", target: "Rye Flour!", text: "Rye flour." })).toBeNull();
    expect(ok({ template: "last_chance", target: "june", text: "Don't go." })).toBeNull();
    expect(ok({ template: "repair", target: "old_quarter.library", text: "The step." })).toBeNull();
    expect(ok({ template: "deliver", target: "june", text: "Download this for June." })).toBeNull();
  });

  it("keeps a letter only to the Fellow, the Lantern or another resident", () => {
    const to = (address: string) => {
      const result = check({ letter: { to: address, text: "A short note." } });
      return result.ok ? result.output.letter?.to ?? null : "invalid";
    };
    expect(to("player")).toBe("player");
    expect(to("Lantern")).toBe("lantern");
    expect(to("june")).toBe("june");
    expect(to("pell")).toBeNull();
    expect(to("frye")).toBeNull();
    expect(to("the mayor")).toBeNull();
  });

  it("drops a diary line that trips the filters, keeps yesterday's beliefs when none survive", () => {
    const result = check({ diary: "Played a video game all day.", beliefs: ["The internet knows.", ""] });
    expect(result.ok && result.output.diary).toBe("");
    expect(result.ok && result.output.beliefs).toEqual([]);
    const state = ResidentState.parse({
      id: "pell", world_id: "w", tier: "core", mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 0 },
      needs: { rest: 70, food: 70, social: 70, purpose: 70, comfort: 70 }, regard: 0, stances: {}, beliefs: ["Old belief."],
      recent_topics: [], dream: { stage: 1, notes: "" }, stay: 50, leaving_notice_since: null, location: null, flags: [],
    });
    expect(result.ok && applyReflectionToState(state, result.output).beliefs).toEqual(["Old belief."]);
    expect(driftMood({ ...state, mood: { ...state.mood, energy: 10 } }).mood.energy).toBe(14);
  });
});

describe("applyFeeling", () => {
  it("grows, fades and replaces a feeling", () => {
    expect(applyFeeling({ kind: null, intensity: 0 }, { kind: "crush", delta: 10 })).toEqual({ kind: "crush", intensity: 10 });
    expect(applyFeeling({ kind: null, intensity: 0 }, { kind: "crush", delta: -10 })).toEqual({ kind: null, intensity: 0 });
    expect(applyFeeling({ kind: "crush", intensity: 10 }, { kind: "crush", delta: -15 })).toEqual({ kind: null, intensity: 0 });
    expect(applyFeeling({ kind: "crush", intensity: 95 }, { kind: "crush", delta: 15 })).toEqual({ kind: "crush", intensity: 100 });
    expect(applyFeeling({ kind: "crush", intensity: 10 }, { kind: "resentment", delta: 4 })).toEqual({ kind: "crush", intensity: 6 });
    expect(applyFeeling({ kind: "crush", intensity: 10 }, { kind: "resentment", delta: 15 })).toEqual({ kind: "resentment", intensity: 5 });
    expect(applyFeeling({ kind: "crush", intensity: 10 }, { kind: "resentment", delta: -5 })).toEqual({ kind: "crush", intensity: 10 });
    expect(applyFeeling({ kind: "love", intensity: 40 }, null)).toEqual({ kind: "love", intensity: 40 });
  });
});
