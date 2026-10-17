// G-02 on the server: the arrival buffer written ahead by the model (A.3.6–A.3.8), the ferry day's commit from it (or
// from templates), the dawn package's households, Quiet Mode adoption, departures and Leaving Notice memories.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import {
  ARRIVAL_SYSTEM_PROMPT, HOME_TOKEN, PersonaCard, WHIMS, portraitById, tagsOfEntry, templateHousehold, type ArrivalHouseholdOutput, type HouseholdDraw,
  type MemberDraw,
} from "@monde/shared";
import { createTestDatabase } from "../../db/testDatabase.js";
import { aiLog, arrivals, events, memories, relationships, residents } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { FULL, fullRosterContent } from "../../__tests__/fullRoster.js";
import {
  ARRIVAL_ATTEMPTS, ARRIVAL_BUFFER_SIZE, adoptHouseholds, arrivalsFor, commitArrivals, departResidents, generatedIds,
  noticeMemories, refillBuffer, writeHousehold, type ArrivalDeps, type ArrivalRequest,
} from "../arrivals.js";
import { buildDawnPackage } from "../dawn.js";
import { DisabledMindClient, type MindClient } from "../mindClient.js";
import { SILENT_LOG } from "../nightJob.js";
import { message } from "./fakeMind.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const request = (over: Partial<ArrivalRequest> = {}): ArrivalRequest => ({
  day: 8, households: 1, youth_share: 0.5,
  free_homes: [{ home: "old_quarter.vacant_house_47", beds: 3, name: "No. 47 Lamplighter Lane" }, { home: "wharf.vacant_house_50", beds: 2, name: "No. 50 Net Lane" }],
  pillars: { prosperity: 21, safety: 33, spirit: 33, charm: 44 }, census: 210, flags: ["project_bakery_ovens_done"], pupils: 9, unrestored_homes: 59,
  ...over,
});

/** The household the user message describes, rebuilt (the fake model reads its prompt like Haiku would). */
function drawFromPrompt(text: string): HouseholdDraw {
  const archetype = /ARCHETYPE ([a-z_]+) ·/.exec(text)![1]!;
  const members: MemberDraw[] = [...text.matchAll(/- slot (m\d) · role ([a-z_]+) · age range (\d+)-(\d+) · pronoun default (\S+)\n {2}portrait (lib_[a-z0-9_]+):/g)].map(m => ({
    slot: m[1]!, role: m[2] as MemberDraw["role"], age_min: Number(m[3]), age_max: Number(m[4]), age: Number(m[3]), band: "adult",
    presentation: m[6]!.slice(4, 5) as MemberDraw["presentation"], pronoun_default: m[5] as MemberDraw["pronoun_default"], portrait: m[6]!,
    tags: tagsOfEntry(portraitById(m[6]!)!),
  }));
  return { id: "prompt", archetype: archetype as HouseholdDraw["archetype"], day: 8, slot: 0, youth: false, members, beds: 2, prob: 1 };
}

/** A well-written answer in the model's own words; `broken` answers fail V03 (a cast member's name). */
function answer(text: string, broken = false): ArrivalHouseholdOutput {
  const out = templateHousehold(drawFromPrompt(text), { residents: new Map() }, /WHIM: (.+)/.exec(text)![1]!);
  for (const m of out.members) {
    m.backstory = `${m.name.split(" ")[0]} kept a ferry café in Marrow Quay for nine years and swore the tide there was the slowest on the coast. Came for the light.`;
    m.voice.samples = ["Can't say I mind the wind.", "That's the third gull today. They've a system.", "Right. I'll put the kettle on."];
  }
  if (broken) out.members[0]!.name = "Odile Fournier";
  return out;
}

class ArrivalMind implements MindClient {
  readonly enabled = true;
  readonly bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
  constructor(private readonly respond: (text: string, n: number) => { text: string; stop?: Anthropic.StopReason }) {}
  async streamMessage(): Promise<Anthropic.Message> { throw new Error("arrivals never stream"); }
  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    this.bodies.push(structuredClone(params));
    const text = String(params.messages.at(-1)!.content);
    const r = this.respond(text, this.bodies.length);
    return message(r.text, r.stop ?? "end_turn", { input_tokens: 2400, output_tokens: 1600 });
  }
}

const deps = (mind: MindClient): ArrivalDeps => ({ db: database.db, mind, gate: work => work(), callTimeoutMs: 5000, log: SILENT_LOG, seed: 99 });

describe("the arrival buffer (§9.2, A.3.6–A.3.8)", () => {
  it("writes households ahead with Haiku: cached A.3.6 system prompt, low effort, no sampling params, validated", async () => {
    const world = await createWorld(database.db, "arrivals-buffer", "invite");
    const mind = new ArrivalMind(text => ({ text: JSON.stringify(answer(text)) }));
    expect(await refillBuffer(deps(mind), world.id, request())).toBe(ARRIVAL_BUFFER_SIZE);
    const rows = await database.db.select().from(arrivals).where(eq(arrivals.worldId, world.id));
    expect(rows).toHaveLength(ARRIVAL_BUFFER_SIZE);
    for (const r of rows) {
      expect(r).toMatchObject({ status: "buffered", source: "model", arrivalDay: null, home: null });
      for (const c of r.cards) {
        expect(PersonaCard.safeParse(c).success).toBe(true);
        expect(c.home).toBe(HOME_TOKEN);
        expect(c.portrait).toMatch(/^lib_/);
      }
    }
    for (const body of mind.bodies) {
      expect(body.model).toBe("claude-haiku-5-5");
      for (const key of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(key);
      expect(body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
      expect((body.system as Anthropic.TextBlockParam[])[0]).toMatchObject({ text: ARRIVAL_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } });
      expect(body.messages.every(m => m.role === "user")).toBe(true); // no assistant prefill
      // §9.17's whim seed, from the 500-entry list.
      expect(WHIMS).toContain(/WHIM: (.+)/.exec(String(body.messages.at(-1)!.content))![1]);
    }
    const logged = await database.db.select().from(aiLog).where(and(eq(aiLog.worldId, world.id), eq(aiLog.kind, "arrival")));
    expect(logged).toHaveLength(ARRIVAL_BUFFER_SIZE);
    // A full buffer writes nothing more.
    expect(await refillBuffer(deps(mind), world.id, request())).toBe(0);
  }, 30_000);

  it("feeds validator errors back on a retry, and falls back to the template after three failures or a refusal", async () => {
    const world = await createWorld(database.db, "arrivals-retry", "invite");
    const draw = (await import("@monde/shared")).drawHousehold({
      seed: 1, day: 8, slot: 0, facts: { day: 8, pillars: request().pillars, flags: new Set(), freeHomes: request().free_homes, unrestoredHomes: 59, pupils: 9, storefrontsFree: 0 },
      youthShare: 0.5, recent: [], alive: new Map(), portraitUses: new Map(), archetype: "retired_couple",
    })!;
    const retry = new ArrivalMind((text, n) => ({ text: JSON.stringify(answer(text, n === 1)) }));
    const written = await writeHousehold(deps(retry), world.id, draw, request());
    expect(written).toMatchObject({ source: "model", attempts: 2 });
    expect(String(retry.bodies[1]!.messages[0]!.content)).toContain("YOUR LAST ANSWER FAILED VALIDATION");
    expect(String(retry.bodies[1]!.messages[0]!.content)).toContain("V03");

    const hopeless = new ArrivalMind(text => ({ text: JSON.stringify(answer(text, true)) }));
    expect(await writeHousehold(deps(hopeless), world.id, draw, request())).toMatchObject({ source: "template", attempts: ARRIVAL_ATTEMPTS });
    const refusal = new ArrivalMind(() => ({ text: "", stop: "refusal" }));
    expect(await writeHousehold(deps(refusal), world.id, draw, request())).toMatchObject({ source: "template", attempts: 1, errors: ["refusal"] });
    expect(refusal.bodies).toHaveLength(1);
    expect(await writeHousehold(deps(new DisabledMindClient()), world.id, draw, request())).toMatchObject({ source: "template", attempts: 0 });
  }, 30_000);
});

describe("the ferry day (A.3.1 step 7)", () => {
  it("commits from the buffer: residents Ambient in their new home, kin ties, an arrival event, the dawn package's households", async () => {
    const world = await createWorld(database.db, "arrivals-commit", "invite");
    const mind = new ArrivalMind(text => ({ text: JSON.stringify(answer(text)) }));
    await refillBuffer(deps(mind), world.id, request());
    const committed = await commitArrivals(deps(new DisabledMindClient()), world.id, request({ households: 2 }));
    expect(committed).toHaveLength(2);
    expect(committed.every(h => h.generated_by === "model")).toBe(true);
    expect(new Set(committed.map(h => h.home)).size).toBe(2);
    const ids = committed.flatMap(h => h.residents.map(r => r.card.id));
    const rows = await database.db.select().from(residents).where(eq(residents.worldId, world.id));
    for (const id of ids) {
      const row = rows.find(r => r.id === id)!;
      expect(row.tier).toBe("ambient");
      expect(row.card.kind).toBe("arrival");
      expect(JSON.stringify(row.card)).not.toContain(HOME_TOKEN);
    }
    const ev = await database.db.select().from(events).where(and(eq(events.worldId, world.id), eq(events.type, "arrival")));
    expect(ev).toHaveLength(2);
    expect(ev[0]!.summary).toMatch(/, has taken No\. \d+ /);
    const ties = await database.db.select().from(relationships).where(eq(relationships.worldId, world.id));
    for (const h of committed.filter(x => x.residents.length > 1)) expect(ties.some(t => t.fromId === h.residents[0]!.card.id && t.toId === h.residents[1]!.card.id)).toBe(true);
    // Idempotent per day, and the dawn package hands them over.
    expect((await commitArrivals(deps(new DisabledMindClient()), world.id, request({ households: 2 }))).map(h => h.id)).toEqual(committed.map(h => h.id));
    const pkg = await buildDawnPackage(database.db, world.id, 8);
    expect(pkg.arrivals.map(h => h.id).sort()).toEqual(committed.map(h => h.id).sort());
    expect(pkg.generated).toEqual(expect.arrayContaining(ids));
    expect(pkg.plans.some(p => ids.includes(p.resident_id))).toBe(true);
    expect((await arrivalsFor(database.db, world.id, 9))).toEqual([]);
  }, 30_000);

  it("never waits on the model: an empty buffer lands template households at once", async () => {
    const world = await createWorld(database.db, "arrivals-template", "invite");
    let calls = 0;
    const mind = new ArrivalMind(() => { calls++; return { text: "{}" }; });
    const committed = await commitArrivals(deps(mind), world.id, request());
    expect(calls).toBe(0);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ generated_by: "template", day: 8 });
    expect(request().free_homes.map(h => h.home)).toContain(committed[0]!.home);
  }, 30_000);
});

describe("Quiet Mode households, departures and notices (§6.4)", () => {
  it("adopts the client's offline households once, lets leavers go, and writes the notice into memories", async () => {
    const world = await createWorld(database.db, "arrivals-adopt", "invite");
    const offline = await commitArrivals(deps(new DisabledMindClient()), world.id, request({ day: 4 }));
    // Pretend the server never had it: another world adopts the same household.
    const other = await createWorld(database.db, "arrivals-adopt-2", "invite");
    expect(await adoptHouseholds(database.db, other.id, offline)).toBe(1);
    expect(await adoptHouseholds(database.db, other.id, offline)).toBe(0);
    const ids = offline[0]!.residents.map(r => r.card.id);
    expect(await generatedIds(database.db, other.id)).toEqual([...ids].sort());

    const friend = "pell";
    expect(await noticeMemories(database.db, other.id, 9, [{ resident: ids[0]!, day: 9, deadline: 11, friends: [friend] }])).toBe(2);
    const mem = await database.db.select().from(memories).where(eq(memories.worldId, other.id));
    expect(mem.find(m => m.residentId === ids[0])).toMatchObject({ importance: 7 });
    expect(mem.find(m => m.residentId === friend)!.text).toMatch(/told me they're leaving Monde on Fri(day)?'s boat/);

    expect(await departResidents(database.db, other.id, [ids[0]!, "pell"], 12)).toBe(1); // the cast never leaves
    const left = await database.db.select().from(residents).where(and(eq(residents.worldId, other.id), eq(residents.id, ids[0]!)));
    expect(left).toEqual([]);
    expect((await database.db.select().from(residents).where(and(eq(residents.worldId, other.id), eq(residents.id, "pell"))))).toHaveLength(1);
    const ev = await database.db.select().from(events).where(and(eq(events.worldId, other.id), eq(events.type, "departure")));
    expect(ev).toHaveLength(1);
  }, 30_000);
});

describe("the night pass carries it (POST /night, GET /dawn)", () => {
  it("commits the roll before the night's jobs, so the first dawn read has tomorrow's households", async () => {
    const { NightRunner } = await import("../night.js");
    const world = await createWorld(database.db, "arrivals-night", "invite");
    const runner = new NightRunner({ db: database.db, mind: new DisabledMindClient(), budgetMs: 4000 });
    const result = await runner.start(world.id, { day: 7, arrivals: request({ day: 8 }) });
    expect(result.status).toBe(200);
    const pkg = await buildDawnPackage(database.db, world.id, 8);
    expect(pkg.arrivals).toHaveLength(1);
    expect(pkg.arrivals[0]!.residents.every(r => r.card.kind === "arrival")).toBe(true);
    await runner.close();
  }, 30_000);
});

describe("arrivals into the full Day-1 town (MVP M-03)", () => {
  it("count every resident's library portrait as worn, and take no living household's surname", async () => {
    const roster = await fullRosterContent();
    try {
      const world = await createWorld(database.db, "arrivals-full", "invite", roster.dir, FULL);
      const living = await database.db.select({ card: residents.card }).from(residents).where(eq(residents.worldId, world.id));
      const worn = new Set(living.map(r => r.card.portrait).filter(p => p.startsWith("lib_")));
      expect(worn.size).toBeGreaterThanOrEqual(80);
      const surnames = new Set(living.map(r => r.card.name.replace(/"[^"]*"\s*/g, "").trim().split(/\s+/).at(-1)!));
      const committed = await commitArrivals(deps(new DisabledMindClient()), world.id, request({ households: 2 }));
      expect(committed.length).toBeGreaterThan(0);
      for (const h of committed) for (const r of h.residents) {
        expect(worn.has(r.card.portrait), `${r.card.id} wears ${r.card.portrait}`).toBe(false);
        expect(surnames.has(r.card.name.split(" ").at(-1)!), r.card.name).toBe(false);
      }
    } finally { roster.cleanup(); }
  }, 30_000);
});
