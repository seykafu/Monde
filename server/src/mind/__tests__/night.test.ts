import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import type { GossipOutput, PersonaCard, PlanOutput, ReflectionOutput } from "@monde/shared";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { loadContent } from "../../content/loadContent.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { aiLog, dialogueTurns, letters, memories, plans, residents, worlds } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import { DisabledMindClient, type MindClient } from "../mindClient.js";
import { NIGHT_BUDGET_MS, NightRunner, acquaintedTurn, nightJobs, type NightRunnerOptions } from "../night.js";
import { templatePlan } from "../templatePlan.js";
import { FakeNightMind, type NightCall, type NightReply } from "./fakeNightMind.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let cards: PersonaCard[];
beforeAll(async () => { [database, cards] = await Promise.all([createTestDatabase(), loadContent()]); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const SECRET = "monde-local-development-only";
/** Every request body any fake received in this file, for the API hygiene check at the end. */
const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
const card = (id: string) => cards.find((c) => c.id === id)!;
const coreIds = () => cards.filter((c) => c.kind === "canon").map((c) => c.id).sort();

function reflection(resident: string): ReflectionOutput {
  return {
    mood_delta: { valence: 3, energy: -1, stress: 0 }, emotion: "content",
    beliefs: [`${resident} thinks the Fellow means well.`], relationship_deltas: [], stance_deltas: [], regard_delta: 1,
    dream_progress: null,
    favor: resident === "odile" ? { template: "fetch", target: "bun", text: "A bun, if you see one." } : null,
    letter: resident === "pell" ? { to: "player", text: "Fellow. The drain on the Lane. Thank you. E. Pell" } : null,
    diary: "A long day. The lamps held.",
  };
}
/** Tomorrow's routine with one changed block (the second one becomes a walk by the duck pond). */
function plan(resident: string, day: number): PlanOutput {
  const template = templatePlan(card(resident), day);
  return {
    ...template,
    blocks: template.blocks.map((b, i) => (i === 1 ? { ...b, action: "walk", place: "commons.duck_pond", note: "Air." } : b)),
    barks: ["Morning.", "Mind the step.", "Fog again."], seek_player: null, intentions: ["Keep the lamps lit."],
  };
}
/** An encounter that went pleasantly both ways (§9.11.3, summary mode). */
const met: GossipOutput = {
  lines: null, a_delta: { affinity: 1, trust: 0 }, b_delta: { affinity: 1, trust: 1 }, news_passed: [], feeling_change: null,
};
const happy = (call: NightCall): NightReply =>
  call.kind === "reflect" ? { output: reflection(call.resident) } : call.kind === "gossip" ? { output: met } : { output: plan(call.resident, 2) };
const residentCalls = (mind: FakeNightMind) => mind.calls.filter((c) => c.kind !== "gossip");

function fake(respond: (call: NightCall) => NightReply = happy, delayMs = 0): FakeNightMind {
  return new FakeNightMind((call) => { bodies.push(call.body); return respond(call); }, delayMs);
}

async function setup(mind: MindClient, runnerOptions: Partial<NightRunnerOptions> = {}) {
  const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
  const runner = new NightRunner({ db: database.db, mind, budgetMs: 2000, ...runnerOptions });
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind, nightRunner: runner });
  apps.push(app);
  const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, SECRET)}` };
  return { app, runner, worldId: world.id, headers };
}
type Env = Awaited<ReturnType<typeof setup>>;

const night = (env: Env, body: Record<string, unknown>) =>
  env.app.inject({ method: "POST", url: `/v1/worlds/${env.worldId}/night`, headers: env.headers, payload: body });
const dawn = (env: Env, day: number | string) =>
  env.app.inject({ method: "GET", url: `/v1/worlds/${env.worldId}/dawn/${day}`, headers: env.headers });
const storedPlans = (worldId: string, day: number) =>
  database.db.select().from(plans).where(and(eq(plans.worldId, worldId), eq(plans.day, day)));

async function talkedToday(worldId: string, residentId: string, day: number) {
  await database.db.insert(dialogueTurns).values({
    worldId, id: `${randomUUID()}/0`, residentId, conversationId: randomUUID(), day, minute: 600, playerInput: null,
    output: { lines: [{ text: "Hm.", expr: "neutral" }], choices: [], effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "" }, wrap_up: false },
    fallback: false, turnIndex: 0,
  });
}
async function remember(worldId: string, residentId: string, day: number, importance: number) {
  await database.db.insert(memories).values({
    worldId, id: `m_${residentId}_${day}_${importance}`, residentId, day, minute: 700, kind: "saw",
    text: "A Scuffle by the fountain.", who: ["player"], wherePlace: "old_quarter.fountain_square", importance, valence: -2,
  });
}

describe("POST /v1/worlds/:w/night", () => {
  it("reflects and plans for Core, advances the day, and leaves Ambient residents on their routine", async () => {
    const mind = fake();
    const env = await setup(mind);
    const res = await night(env, {
      day: 1,
      town: { pillars: { prosperity: 19, safety: 31, spirit: 22, charm: 26 }, census: 211, weather_tomorrow: "rain" },
      events: [
        { id: "ev1", day: 1, minute: 600, type: "scuffle", where: "old_quarter.fountain_square", who: ["player"], importance: 7, tags: ["tollmen"], summary: "The Fellow faced down two Tollmen at the fountain." },
        { id: "ev2", day: 2, minute: 540, type: "ferry", where: "wharf.ferry_slip", who: [], importance: 4, tags: [], summary: "The ferry comes in from Carrow." },
      ],
    });
    expect(res.statusCode).toBe(200);
    const core = coreIds();
    // Under a loaded test run the 2 s budget can end before every Core job does; the rest finishes in the
    // background (asserted in its own test), so wait for it rather than racing the clock.
    const body = res.json();
    expect(body).toMatchObject({ day: 1, next_day: 2, tiers: { core: core.length, acquainted: 0, ambient: cards.length - core.length } });
    expect(body.done + body.pending).toBe(core.length);
    expect(body.already).toBeUndefined();
    await env.runner.idle(env.worldId);

    const [world] = await database.db.select().from(worlds).where(eq(worlds.id, env.worldId));
    expect(world).toMatchObject({ day: 2, minute: 360 });

    const stored = await storedPlans(env.worldId, 2);
    expect(stored.map((p) => p.residentId).sort()).toEqual(core);
    expect(stored.every((p) => p.source === "model" && /^[0-9a-f]{12}$/.test(p.promptVersion ?? ""))).toBe(true);
    const pell = stored.find((p) => p.residentId === "pell")!;
    expect(pell.plan.blocks[1]).toMatchObject({ action: "walk", place: "commons.duck_pond" });
    expect(pell.plan.barks).toHaveLength(3);

    expect(mind.callsFor("reflect").map((c) => c.resident).sort()).toEqual(core);
    expect(mind.callsFor("plan").map((c) => c.resident).sort()).toEqual(core);
    // Town facts reach the reflection; the forecast and tomorrow's events reach the plan.
    const reflectText = mind.callsFor("reflect", "pell")[0]!.body.messages[0]!.content as string;
    expect(reflectText).toContain("Prosperity 19, safety 31, spirit 22, charm 26");
    expect(reflectText).toContain("Census 211");
    expect(reflectText).toContain("10:00 at old_quarter.fountain_square: The Fellow faced down two Tollmen");
    expect(reflectText).not.toContain("ferry comes in");
    const planText = mind.callsFor("plan", "pell")[0]!.body.messages[0]!.content as string;
    expect(planText).toContain("Day 2 (Wed, spring)");
    expect(planText).toContain("Forecast: rain.");
    expect(planText).toContain("09:00 at wharf.ferry_slip: The ferry comes in from Carrow.");
    expect(planText).toContain("market_row.general_store (open 07:00-19:00)");
    // Each resident's plan is built on tonight's beliefs.
    const planSystem = mind.callsFor("plan", "pell")[0]!.body.system as Anthropic.TextBlockParam[];
    expect(planSystem[2]!.text).toContain("pell thinks the Fellow means well.");

    const log = await database.db.select().from(aiLog).where(eq(aiLog.worldId, env.worldId));
    expect(log.filter((l) => l.kind === "reflect")).toHaveLength(core.length);
    expect(log.filter((l) => l.kind === "plan")).toHaveLength(core.length);
    expect(log.filter(l => l.kind !== "press").every((l) => !l.fallback && Number(l.costUsd) > 0)).toBe(true);
  });

  it("runs Acquainted residents after Core, and Ambient ones only after an importance-6 memory", async () => {
    const mind = fake();
    const env = await setup(mind, { concurrency: 2 });
    await talkedToday(env.worldId, "ada", 1);
    await remember(env.worldId, "ada", 1, 5);
    await remember(env.worldId, "bru", 1, 6);
    await remember(env.worldId, "nettie", 1, 5);
    const res = await night(env, { day: 1 });
    expect(res.json()).toMatchObject({ tiers: { acquainted: 1 } });
    await env.runner.idle(env.worldId);

    expect(mind.callsFor("reflect", "ada")).toHaveLength(1);
    expect(mind.callsFor("plan", "ada")).toHaveLength(1);
    expect(mind.callsFor("reflect", "bru")).toHaveLength(1);
    expect(mind.callsFor("plan", "bru")).toHaveLength(0);
    expect(mind.calls.some((c) => c.resident === "nettie")).toBe(false);
    // Core first (§9.8). Encounters queue before any reflection, at the priority of their better-detailed side, so
    // every encounter with a Core side is under way before Ada's (Acquainted) first call, and every encounter with a
    // Core or Acquainted side before Bru's (Ambient). A reflection waits for that resident's own encounters, so a
    // free slot may go to lower-tier work meanwhile (work-conserving), never ahead of a queued higher-tier call.
    const core = new Set(coreIds());
    const sides = (c: NightCall) => c.resident.split("+");
    const lastEncounterWith = (ids: ReadonlySet<string>) =>
      Math.max(...mind.calls.map((c, i) => (c.kind === "gossip" && sides(c).some((id) => ids.has(id)) ? i : -1)));
    const first = (id: string) => mind.calls.findIndex((c) => c.resident === id);
    expect(mind.callsFor("gossip").some((c) => sides(c).includes("ada"))).toBe(true);
    expect(first("ada")).toBeGreaterThan(lastEncounterWith(core));
    expect(first("bru")).toBeGreaterThan(lastEncounterWith(new Set([...core, "ada"])));
    for (const [i, call] of mind.calls.entries()) {
      if (call.kind !== "reflect") continue;
      const own = mind.calls.map((c, j) => (c.kind === "gossip" && sides(c).includes(call.resident) ? j : -1)).filter((j) => j >= 0);
      for (const j of own) expect(j, `${call.resident} reflected before an encounter`).toBeLessThan(i);
    }
    expect((await storedPlans(env.worldId, 2)).map((p) => p.residentId)).toContain("ada");
    expect((await storedPlans(env.worldId, 2)).map((p) => p.residentId)).not.toContain("bru");
  });

  it("answers within the 4 s budget with a slow model, never runs more than 8 calls at once, and finishes in the background", async () => {
    const mind = fake(happy, 1000);
    const env = await setup(mind, { budgetMs: NIGHT_BUDGET_MS });
    const started = performance.now();
    const res = await night(env, { day: 1 });
    const elapsed = performance.now() - started;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(NIGHT_BUDGET_MS - 100);
    expect(elapsed).toBeLessThan(NIGHT_BUDGET_MS + 1000);
    const body = res.json();
    expect(body.elapsed_ms).toBeGreaterThanOrEqual(NIGHT_BUDGET_MS - 50);
    expect(body.elapsed_ms).toBeLessThanOrEqual(NIGHT_BUDGET_MS + 250);
    const core = coreIds();
    expect(body.complete).toBe(false);
    expect(body.pending).toBeGreaterThan(0);
    expect(body.done + body.pending).toBe(core.length);

    // The dawn package doesn't wait: unfinished residents get their routine for now.
    const early = (await dawn(env, 2)).json();
    expect(early.pending).toBeGreaterThan(0);
    expect(early.complete).toBe(false);
    expect(early.plans.some((p: { source: string }) => p.source === "template")).toBe(true);

    await env.runner.idle(env.worldId);
    expect(mind.maxInFlight).toBe(8);
    const stored = await storedPlans(env.worldId, 2);
    expect(stored.map((p) => p.residentId).sort()).toEqual(core);
    expect(stored.every((p) => p.source === "model")).toBe(true);
    const late = (await dawn(env, 2)).json();
    expect(late).toMatchObject({ pending: 0, complete: true });
    expect(late.plans.filter((p: { source: string }) => p.source === "model")).toHaveLength(core.length);
    // A repeat of the same night reports instead of running again.
    const encounters = mind.callsFor("gossip").length;
    const again = await night(env, { day: 1 });
    expect(again.json()).toMatchObject({ already: true, done: core.length, pending: 0, complete: true });
    expect(residentCalls(mind)).toHaveLength(core.length * 2);
    expect(mind.callsFor("gossip")).toHaveLength(encounters);
  }, 30_000);

  it("falls back per resident: template plans and mood drift, logged", async () => {
    const mind = fake((call) => {
      if (call.resident === "pell") return call.kind === "reflect" ? { output: "nonsense" } : { output: "", stopReason: "refusal" };
      if (call.resident === "odile" && call.kind === "plan") {
        const bad = plan("odile", 2);
        return { output: { ...bad, blocks: [bad.blocks[0], { ...bad.blocks[1]!, start: "08:00" }, ...bad.blocks.slice(2)] } };
      }
      return happy(call);
    });
    const env = await setup(mind);
    expect((await night(env, { day: 1 })).json()).toMatchObject({ complete: true });
    const stored = await storedPlans(env.worldId, 2);
    const pell = stored.find((p) => p.residentId === "pell")!;
    const odile = stored.find((p) => p.residentId === "odile")!;
    expect(pell).toMatchObject({ source: "template", plan: templatePlan(card("pell"), 2) });
    expect(odile).toMatchObject({ source: "template", plan: templatePlan(card("odile"), 2) });
    const log = await database.db.select().from(aiLog).where(eq(aiLog.worldId, env.worldId));
    expect(log.find((l) => l.residentId === "pell" && l.kind === "reflect")).toMatchObject({ fallback: true, validation: "schema" });
    expect(log.find((l) => l.residentId === "pell" && l.kind === "plan")).toMatchObject({ fallback: true, validation: "refusal" });
    expect(log.find((l) => l.residentId === "odile" && l.kind === "plan")).toMatchObject({ fallback: true, validation: "overlap" });
    const [pellRow] = await database.db.select().from(residents).where(and(eq(residents.worldId, env.worldId), eq(residents.id, "pell")));
    expect(pellRow!.state.beliefs).toEqual(card("pell").beliefs);
  });

  it("runs on templates and the mood-drift rule with no API key", async () => {
    const env = await setup(new DisabledMindClient());
    const res = await night(env, { day: 1 });
    expect(res.json()).toMatchObject({ complete: true, pending: 0, done: coreIds().length });
    const stored = await storedPlans(env.worldId, 2);
    expect(stored).toHaveLength(coreIds().length);
    expect(stored.every((p) => p.source === "template" && p.promptVersion === null)).toBe(true);
    expect(await database.db.select().from(aiLog).where(eq(aiLog.worldId, env.worldId))).toEqual([]);
  });

  it("refuses a night the world has already passed, and validates the body", async () => {
    const env = await setup(fake());
    expect((await night(env, { day: 1 })).statusCode).toBe(200);
    expect((await night(env, { day: 2 })).json()).toMatchObject({ day: 2, next_day: 3, complete: true });
    const stale = await night(env, { day: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ day: 1, world_day: 3 });
    for (const body of [{}, { day: 0 }, { day: 1.5 }, { day: 3, town: { census: -1 } }, { day: 3, events: [{ id: "x" }] }]) {
      expect((await night(env, body)).statusCode).toBe(400);
    }
    // A client that played offline catches up: a later night is accepted.
    expect((await night(env, { day: 6 })).statusCode).toBe(200);
    const [world] = await database.db.select().from(worlds).where(eq(worlds.id, env.worldId));
    expect(world!.day).toBe(7);
  });
});

describe("GET /v1/worlds/:w/dawn/:day", () => {
  it("returns every resident's plan, last night's letters (once) and the new favors", async () => {
    const env = await setup(fake());
    await night(env, { day: 1 });
    const res = await dawn(env, 2);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ day: 2, weekday: "Wed", pending: 0, complete: true });
    expect(body.plans).toHaveLength(cards.length);
    expect(body.plans.map((p: { resident_id: string }) => p.resident_id)).toEqual(cards.map((c) => c.id).sort());
    const byId = new Map(body.plans.map((p: { resident_id: string }) => [p.resident_id, p]));
    expect(byId.get("pell")).toMatchObject({ tier: "core", source: "model" });
    expect(byId.get("ada")).toEqual({ resident_id: "ada", tier: "ambient", source: "template", plan: templatePlan(card("ada"), 2) });
    expect(body.letters).toEqual([{ id: "letter_pell_1", from: "pell", to: "player", day: 2, text: "Fellow. The drain on the Lane. Thank you. E. Pell" }]);
    expect(body.favors).toMatchObject([{
      id: "favor_reflect_odile_1", resident_id: "odile", template: "fetch", target: "bun",
      text: "A bun, if you see one.", created_day: 1, expires_day: 6,
    }]);

    const [letter] = await database.db.select().from(letters).where(eq(letters.worldId, env.worldId));
    expect(letter!.delivered).toBe(true);
    const again = (await dawn(env, 2)).json();
    expect(again.letters).toEqual([]);
    expect(again.favors).toHaveLength(1);
    expect((await dawn(env, 3)).json().favors).toHaveLength(1);
  });

  it("serves template plans for a day with no night behind it, and weekend routines on a Saturday", async () => {
    const env = await setup(fake());
    const body = (await dawn(env, 5)).json();
    expect(body).toMatchObject({ day: 5, weekday: "Sat", letters: [], favors: [], pending: 0 });
    expect(body.plans.every((p: { source: string }) => p.source === "template")).toBe(true);
    const odile = body.plans.find((p: { resident_id: string }) => p.resident_id === "odile");
    expect(odile.plan).toEqual(templatePlan(card("odile"), 5));
    expect(odile.plan.blocks[1]).toMatchObject({ action: "attend", place: "old_quarter.st_brigids" });
    expect((await dawn(env, "zero")).statusCode).toBe(400);
    expect((await dawn(env, 0)).statusCode).toBe(400);
  });
});

describe("night pass rules and hygiene", () => {
  it("picks who reflects tonight", () => {
    const tiers = new Map([["pell", "core"], ["ada", "acquainted"], ["moss", "acquainted"], ["bru", "ambient"], ["nettie", "ambient"]] as const);
    const top = new Map([["ada", 5], ["bru", 6], ["nettie", 5]]);
    expect(acquaintedTurn(3)).toBe(false);
    expect(nightJobs(tiers, top, 3)).toEqual([
      { residentId: "pell", tier: "core", reflect: true, plan: true },
      { residentId: "ada", tier: "acquainted", reflect: true, plan: true },
      { residentId: "moss", tier: "acquainted", reflect: false, plan: true },
      { residentId: "bru", tier: "ambient", reflect: true, plan: false },
    ]);
    expect(nightJobs(tiers, top, 4).find((j) => j.residentId === "moss")).toMatchObject({ reflect: true });
  });

  it("requires the world's own token on night and dawn", async () => {
    const env = await setup(fake());
    const other = await setup(fake());
    const requests = [
      { method: "POST" as const, url: `/v1/worlds/${env.worldId}/night`, payload: { day: 1 } },
      { method: "GET" as const, url: `/v1/worlds/${env.worldId}/dawn/2` },
    ];
    for (const request of requests) {
      for (const headers of [{}, { authorization: "Bearer nope" }, other.headers]) {
        expect((await env.app.inject({ ...request, headers })).statusCode).toBe(401);
      }
    }
    const [world] = await database.db.select().from(worlds).where(eq(worlds.id, env.worldId));
    expect(world!.day).toBe(1);
  });

  it("never sends sampling parameters, thinking settings or an assistant prefill on a plan or reflection", () => {
    const night = bodies.filter((body) => !JSON.stringify(body.messages).includes("<gossip mode="));
    expect(night.length).toBeGreaterThan(50);
    for (const body of night) {
      for (const key of ["temperature", "top_p", "top_k", "thinking", "stream"]) expect(body).not.toHaveProperty(key);
      expect(body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 900, output_config: { effort: "low" } });
      expect(body.output_config?.format?.type).toBe("json_schema");
      expect(body.messages.every((m) => m.role === "user")).toBe(true);
    }
  });

  it("runs encounters as summary-mode Gossip calls with thinking disabled and nothing else", () => {
    const gossip = bodies.filter((body) => JSON.stringify(body.messages).includes("<gossip mode="));
    expect(gossip.length).toBeGreaterThan(10);
    for (const body of gossip) {
      for (const key of ["temperature", "top_p", "top_k", "stream"]) expect(body).not.toHaveProperty(key);
      expect(body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 400, thinking: { type: "disabled" } });
      expect(body.output_config?.effort).toBeUndefined();
      expect(body.output_config?.format?.type).toBe("json_schema");
      expect(body.messages.every((m) => m.role === "user")).toBe(true);
      expect(JSON.stringify(body.messages)).toContain('<gossip mode=\\"summary\\">');
    }
  });
});


it('compacts the day’s leftover sessions before reflections read memories', async () => {
  const mind = fake();
  const env = await setup(mind);
  const { selectSession } = await import('../sessions.js');
  const { persistTurn } = await import('../effects.js');
  const { message } = await import('./fakeMind.js');
  const { conversationSummaries } = await import('../../db/schema.js');
  const id = randomUUID();
  await selectSession(database.db, { worldId: env.worldId, residentId: 'pell', requestedId: id, open: true,
    scene: { day: 1, minute: 600, place: 'old_quarter.library', weather: 'fog' } });
  await persistTurn(database.db, { worldId: env.worldId, residentId: 'pell', conversationId: id,
    day: 1, minute: 600, place: 'old_quarter.library', playerInput: null, turnIndex: 0,
    output: { lines: [{ text: 'The Fellow came to visit.', expr: 'warm' }], choices: [], wrap_up: false,
      effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: 'books' } },
    fallback: false, calls: [], recordTurn: true, promptVersion: 'test' });
  const original = mind.createMessage.bind(mind);
  mind.createMessage = async (params, options) => {
    const user = JSON.stringify(params.messages);
    if (user.includes('Summarize this conversation')) return message(JSON.stringify({ summary: 'I discussed the brass bookmark with the Fellow.',
      facts: { promises: [], asks: [], learned_about_player: [] }, topics: ['books'], felt_after: 'warm' }), 'end_turn');
    if (user.includes('<reflect_request>')) {
      const summaries = await database.db.select().from(conversationSummaries).where(eq(conversationSummaries.worldId, env.worldId));
      expect(summaries).toHaveLength(1);
    }
    return original(params, options);
  };
  await night(env, { day: 1 });
  await env.runner.idle(env.worldId);
  expect(mind.callsFor('reflect', 'pell').map(c => JSON.stringify(c.body.messages)).join()).toContain('brass bookmark');
});
