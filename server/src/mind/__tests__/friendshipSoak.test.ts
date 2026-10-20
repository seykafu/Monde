/**
 * G-13 acceptance soak (docs/MVP_PLAN.md): 25 nights on the real cast and routines with a deterministic fake mind.
 *
 *   - Plans are the routines (the fake plans each resident's template day), so who meets whom is the cards' own
 *     timetable; encounters are rolled from a fixed world seed.
 *   - The fake judges an encounter by the pair's lean: a warm or neutral pair warms (+2 each way, +1 for
 *     strangers), a cold pair cools (−3). The fake reflection takes the day's encounter memories to heart the same
 *     way (gossip heard, inside the pair's ±6 a day).
 *   - The player talks well to Odile every day (three turns proposing +3, +4, +2) and to Pell for the first week
 *     only, through POST /talk.
 * It checks that friendships and at least one rivalry form among Core residents, that Odile reaches Friend
 * (4 hearts) by Day 10, that no resident gains more than +6 Regard a day from talk, that neglect brings Pell back
 * to 40 and no lower, and that no pair ever moves more than ±6 in a day.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import {
  heartRow, seededUnit, type DialogueTurnOutput, type GossipOutput, type PersonaCard, type ReflectionOutput, type TieMilestoneView,
} from "@monde/shared";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { loadContent } from "../../content/loadContent.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { relationships, residents, worlds } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { worldToken } from "../../worlds/routes.js";
import type { MindClient, StreamOptions } from "../mindClient.js";
import { NightRunner } from "../night.js";
import { templatePlan } from "../templatePlan.js";
import { labelsOf } from "../ties.js";
import { FakeMind } from "./fakeMind.js";
import { FakeNightMind, type NightCall, type NightReply } from "./fakeNightMind.js";

const DAYS = 25;
const SEED = 2026;
const SECRET = "monde-local-development-only";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let cards: PersonaCard[];
beforeAll(async () => { [database, cards] = await Promise.all([createTestDatabase(), loadContent()]); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const card = (id: string) => cards.find((c) => c.id === id)!;

// ---------------------------------------------------------------------------------------------------------------
// The fake mind
// ---------------------------------------------------------------------------------------------------------------

const OUTCOMES: Readonly<Record<string, number>> = {
  "It was the best part of the day": 2, "We got on well": 2, "Pleasant enough": 1, "Nothing much passed between us": 0,
  "It was a little stiff": -1, "We got on each other's nerves": -2, "It went badly": -3,
};

function judgeEncounter(prompt: string): GossipOutput {
  const view = (who: "a sees b" | "b sees a") => {
    const m = new RegExp(`How ${who}: .*?affinity (-?\\d+)`).exec(prompt);
    return m ? Number(m[1]) : null;
  };
  const ab = view("a sees b");
  const ba = view("b sees a");
  const step = ab === null && ba === null ? 1 : ((ab ?? 0) + (ba ?? 0)) / 2 >= 0 ? 2 : -3;
  return { lines: null, a_delta: { affinity: step, trust: 0 }, b_delta: { affinity: step, trust: 0 }, news_passed: [], feeling_change: null };
}

function reflect(prompt: string, byName: ReadonlyMap<string, string>): ReflectionOutput {
  const deltas = new Map<string, number>();
  for (const m of prompt.matchAll(/\(did\): (?:Ran into|Spent time with) (.+?)\. ([^.]+)\./g)) {
    const id = byName.get(m[1]!);
    const delta = OUTCOMES[m[2]!];
    if (id && delta) deltas.set(id, (deltas.get(id) ?? 0) + delta);
  }
  return {
    mood_delta: { valence: 0, energy: 0, stress: 0 }, emotion: "content", beliefs: ["The town is waking up."],
    relationship_deltas: [...deltas].map(([id, affinity]) => ({ id, affinity, trust: 0, feeling: null })),
    stance_deltas: [], regard_delta: 0, dream_progress: null, favor: null, letter: null, diary: "Another day in Monde.",
  };
}

const WORDS = [
  "bread", "gull", "lamp", "kettle", "harbour", "fog", "ledger", "pinion", "starter", "oven", "tide", "rope", "chime",
  "basket", "lantern", "pond", "rye", "currant", "sparrow", "barrow", "awning", "slate", "chalk", "brass", "anchor",
  "pickle", "thimble", "ferry", "netting", "biscuit", "candle", "moss", "pebble", "teapot", "ladder", "shutter",
  "orchard", "bucket", "parcel", "wicker", "lobster", "button", "saddle", "heron", "quarry", "lilac", "bellows", "cobble",
  "marigold", "pewter", "skiff", "trellis", "crumpet", "lattice", "ember", "flagon", "satchel", "drizzle", "hatchet", "gable",
];
/** A line no earlier line echoes (§9.10 echo check): nine words drawn by a seeded hash. */
function line(day: number, turn: number, who: string): string {
  const words = Array.from({ length: 9 }, (_, i) => WORDS[Math.floor(seededUnit("line", who, day, turn, i) * WORDS.length)]!);
  return `${words.join(" ")}.`;
}
function turnOutput(day: number, turn: number, who: string, regard: number): DialogueTurnOutput {
  return {
    lines: [{ text: line(day, turn, who), expr: "warm" }],
    choices: [{ id: "a", text: `Tell me about the ${WORDS[(day + turn) % WORDS.length]}.`, intent: "curious" }, { id: "b", text: "I'll help.", intent: "kind" }],
    effects: { regard_delta: regard, mood: { valence: 1, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: `day ${day} talk ${turn}` },
    wrap_up: false,
  };
}

class SoakMind implements MindClient {
  readonly enabled = true;
  constructor(readonly talk: FakeMind, readonly nights: FakeNightMind) {}
  streamMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: StreamOptions) { return this.talk.streamMessage(params, options); }
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }) { return this.nights.createMessage(params, options); }
}

// ---------------------------------------------------------------------------------------------------------------

describe("the G-13 soak: 25 nights, real routines, fake mind", () => {
  it("forms friendships and a rivalry among Core residents; a daily talker reaches Friend by Day 10 at +6 a day at most", async () => {
    let tonight = 0;
    const byName = new Map(cards.map((c) => [c.name, c.id]));
    const respond = (call: NightCall): NightReply => {
      const prompt = call.body.messages[0]!.content as string;
      if (call.kind === "gossip") return { output: judgeEncounter(prompt) };
      if (call.kind === "reflect") return { output: reflect(prompt, byName) };
      return { output: templatePlan(card(call.resident), tonight + 1) };
    };
    const talk = new FakeMind();
    const nights = new FakeNightMind(respond);
    const mind = new SoakMind(talk, nights);
    const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
    await database.db.update(worlds).set({ seed: SEED }).where(eq(worlds.id, world.id));
    const runner = new NightRunner({ db: database.db, mind, budgetMs: 30_000 });
    const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind, nightRunner: runner });
    const headers = { authorization: `Bearer ${worldToken(world.id, world.deviceId, SECRET)}` };
    const core = new Set(cards.filter((c) => c.kind === "canon").map((c) => c.id));
    const isCorePair = (a: string, b: string) => core.has(a) && core.has(b);

    const regardOf = async (id: string) => (await database.db.select().from(residents)
      .where(and(eq(residents.worldId, world.id), eq(residents.id, id))))[0]!;

    /** Three turns with one resident on `day`; returns the applied Regard deltas from the `turn` events. */
    async function chat(day: number, who: string, proposals: number[]): Promise<number[]> {
      const conversation = randomUUID();
      const applied: number[] = [];
      for (const [turn, regard] of proposals.entries()) {
        talk.enqueue({ output: turnOutput(day, turn, who, regard), chunk: 40 });
        const res = await app.inject({
          method: "POST", url: `/v1/worlds/${world.id}/talk`, headers,
          payload: {
            resident_id: who, conversation_id: conversation,
            input: turn === 0 ? { kind: "open" } : { kind: "choice", choice_id: "b", text: "I'll help.", intent: "kind" },
            context: { day, minute: 600 + turn * 5, place: "market_row.bakery", weather: "bright" },
          },
        });
        const turnEvent = res.payload.split("\n\n").filter((b) => b.startsWith("event: turn")).map((b) => JSON.parse(b.split("data: ")[1]!))[0];
        expect(turnEvent.fallback, `${who} day ${day} turn ${turn} fell back: ${res.payload.split("\n\n").filter((b) => b.startsWith("event: error")).join(" ")}`).toBe(false);
        applied.push(turnEvent.regard.delta);
      }
      return applied;
    }

    const residentIds = new Set(cards.map((c) => c.id));
    const startLabels = labelsOf(await database.db.select().from(relationships).where(eq(relationships.worldId, world.id)), residentIds);
    const milestones: TieMilestoneView[] = [];
    const talkGains = new Map<string, number[]>([["odile", []], ["pell", []]]);
    const hearts: number[] = [];
    let friendDay: number | null = null;
    for (let day = 1; day <= DAYS; day++) {
      for (const [who, proposals] of [["odile", [3, 4, 2]], ...(day <= 7 ? [["pell", [2, 5, 1]] as const] : [])] as const) {
        const applied = await chat(day, who, [...proposals]);
        const gained = applied.filter((d) => d > 0).reduce((s, d) => s + d, 0);
        talkGains.get(who)!.push(gained);
        const row = await regardOf(who);
        expect(row.talkGain, `${who} day ${day}`).toBeLessThanOrEqual(6);
        expect(row.talkDay).toBe(day);
      }
      const odile = (await regardOf("odile")).state.regard;
      hearts.push(heartRow(odile).hearts);
      if (friendDay === null && heartRow(odile).full >= 4) friendDay = day;

      tonight = day;
      const res = await app.inject({ method: "POST", url: `/v1/worlds/${world.id}/night`, headers, payload: { day } });
      expect(res.json()).toMatchObject({ day, complete: true, pending: 0 });
      const dawn = (await app.inject({ method: "GET", url: `/v1/worlds/${world.id}/dawn/${day + 1}`, headers })).json();
      milestones.push(...dawn.ties.milestones);
      // No pair ever moves more than ±6 in a day, either way round.
      const rows = await database.db.select().from(relationships).where(eq(relationships.worldId, world.id));
      for (const r of rows) if (r.netDay === day) expect(Math.abs(r.net), `${r.fromId}→${r.toId} on day ${day}`).toBeLessThanOrEqual(6);
    }
    await app.close();

    // The player: Friend by Day 10, never more than +6 a day from talk, and neglect stops at 40.
    expect(friendDay).not.toBeNull();
    expect(friendDay!).toBeLessThanOrEqual(10);
    for (const [who, gains] of talkGains) for (const g of gains) expect(g, who).toBeLessThanOrEqual(6);
    // Talking well earns the full six a day until Regard tops out at 100.
    expect(talkGains.get("odile")!.slice(0, 10)).toEqual(Array(10).fill(6));
    expect((await regardOf("odile")).state.regard).toBe(100);
    expect((await regardOf("pell")).state.regard).toBe(40);

    // The town: friendships and at least one rivalry formed among Core residents.
    const coreMilestones = milestones.filter((m) => isCorePair(m.a, m.b));
    const warmed = coreMilestones.filter((m) => m.kind === "became_friends" || m.kind === "became_close_friends");
    const soured = coreMilestones.filter((m) => m.kind === "became_rivals" || m.kind === "became_enemies");
    expect(warmed.length).toBeGreaterThanOrEqual(2);
    expect(soured.length).toBeGreaterThanOrEqual(1);
    const endLabels = labelsOf(await database.db.select().from(relationships).where(eq(relationships.worldId, world.id)), residentIds);
    const count = (labels: Map<string, string>, wanted: string[]) =>
      [...labels].filter(([key, label]) => isCorePair(...(key.split("+") as [string, string])) && wanted.includes(label)).length;
    expect(count(endLabels, ["friends", "close_friends"])).toBeGreaterThan(count(startLabels, ["friends", "close_friends"]));
    expect(count(endLabels, ["rivals", "enemies"])).toBeGreaterThan(count(startLabels, ["rivals", "enemies"]));
    expect(nights.callsFor("gossip").length).toBeGreaterThan(DAYS * 5);
    if (process.env.MONDE_SOAK_REPORT) {
      console.info(JSON.stringify({
        friendDay, hearts, talkGains: Object.fromEntries(talkGains), encounters: nights.callsFor("gossip").length,
        milestones: coreMilestones.map((m) => `D${m.day} ${m.a}+${m.b} ${m.kind}`),
        coreFriends: [count(startLabels, ["friends", "close_friends"]), count(endLabels, ["friends", "close_friends"])],
        coreFeuds: [count(startLabels, ["rivals", "enemies"]), count(endLabels, ["rivals", "enemies"])],
      }, null, 1));
    }
  }, 240_000);
});
