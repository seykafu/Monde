import { FakeBatches } from "./fakeBatches.js";
// MVP M-03 step 2 on the server: POST /admin/census/write (ADMIN_TOKEN, the request the server builds itself, the census
// budget on one census world, ai_log), the whole run through it with a fake mind, the whims through the filters, and
// the loaders reading content/residents/day1/ after the hand-written cards (step 3).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import YAML from "yaml";
import {
  HOUSEHOLD_JSON_BLOCK,
  ARRIVAL_SYSTEM_PROMPT, ItemCatalog, MONDE_DAY1_BLOCK, NATIVE_SYSTEM_BLOCKS, PersonaCard, WHIMS, censusOrder, censusProgressReset,
  nativeContextFor, nativeDrawFor, nativeTemplateHousehold, nativeValidationContext, parseHomes, parsePins, runCensus, ArrivalHouseholdOutput,
  type CensusInput, type CensusStore, type CensusWriter, type Day1Skeleton, type HouseholdDraw, type NativePromptContext,
} from "@monde/shared";
import { buildApp } from "../../app.js";
import { parseConfig } from "../../config.js";
import { loadContent } from "../../content/loadContent.js";
import { createTestDatabase } from "../../db/testDatabase.js";
import { aiLog, budgetCalls, worlds } from "../../db/schema.js";
import { CENSUS_WORLD_ID } from "../census.js";
import { currencyHit, lexicalHits } from "../filters.js";
import type { MindClient } from "../mindClient.js";
import { personaBlock } from "../promptBuilder.js";
import { message } from "./fakeMind.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database?.client.close(); });

const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const pins = parsePins(YAML.parse(read("content/census/pins.yaml")));
const homes = parseHomes(YAML.parse(read("content/places/homes.yaml")));
const placesDoc = YAML.parse(read("content/places/places.yaml")) as Record<string, string[]>;
const cards = readdirSync(join(root, "content/residents")).filter(f => f.endsWith(".yaml")).map(f => PersonaCard.parse(YAML.parse(read(`content/residents/${f}`))));
const census = (): CensusInput => ({
  skeleton: censusProgressReset(YAML.parse(read("content/census/day1.yaml")) as Day1Skeleton, new Set(pins.households.map(h => h.id))),
  pins, homes, cards, written: new Map(), places: new Set(Object.entries(placesDoc).flatMap(([z, ids]) => ids.map(id => `${z}.${id}`))),
  giftTags: [...new Set(ItemCatalog.parse(YAML.parse(read("content/items.yaml"))).flatMap(i => i.tags))],
});

/** A fake mind for the census: answers each household the way Haiku would (a valid card), found by its home. */
class CensusMind extends FakeBatches implements MindClient {
  readonly enabled = true;
  readonly bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
  constructor(private readonly input: CensusInput, private readonly reply?: (n: number) => { text: string; stop: Anthropic.StopReason } | null) { super(); }
  async streamMessage(): Promise<Anthropic.Message> { throw new Error("the census never streams"); }
  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    this.bodies.push(structuredClone(params));
    const scripted = this.reply?.(this.bodies.length);
    if (scripted) return message(scripted.text, scripted.stop, { input_tokens: 2400, output_tokens: 1600, cache_read_input_tokens: 1500 });
    const text = String(params.messages.at(-1)!.content);
    const home = /^HOME: (\S+),/m.exec(text)![1]!;
    const h = this.input.skeleton.households.find(x => x.home === home)!;
    const draw = nativeDrawFor(this.input, h);
    const out = nativeTemplateHousehold(draw, nativeValidationContext(this.input, h, draw, { novelty: false }), this.bodies.length);
    out.members.forEach((m, i) => { m.backstory = `${m.name.split(" ")[0]} kept ${h.id} ${i} going through ${this.bodies.length} odd winters by the ${WHIMS[this.bodies.length * 7 + i]}.`; });
    return message(JSON.stringify(out), "end_turn", { input_tokens: 2400, output_tokens: 1600, cache_read_input_tokens: 1500 });
  }
}

const config = (over: Record<string, string> = {}) => parseConfig({ LOG_LEVEL: "silent", ADMIN_TOKEN: "census-secret", ...over });
const auth = { authorization: "Bearer census-secret" };
function body(input: CensusInput, id = "dunmore_barney"): { draw: HouseholdDraw; context: NativePromptContext } {
  const h = input.skeleton.households.find(x => x.id === id)!;
  const draw = nativeDrawFor(input, h);
  return { draw, context: nativeContextFor(input, h, draw, WHIMS[0]!) };
}

describe("POST /admin/census/write (M-03 step 2)", () => {
  it("is 404 while ADMIN_TOKEN is unset and 401 with the wrong token; no call either way", async () => {
    const input = census(), mind = new CensusMind(input);
    const hidden = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind });
    const app = buildApp(config(), database.db, { mind });
    try {
      expect((await hidden.inject({ method: "POST", url: "/admin/census/write", headers: auth, payload: body(input) })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/admin/census/write", headers: { authorization: "Bearer wrong" }, payload: body(input) })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/admin/census/write", payload: body(input) })).statusCode).toBe(401);
      expect(mind.bodies).toHaveLength(0);
    } finally { await app.close(); await hidden.close(); }
  });

  it("takes a household, not a prompt: anything else is a 400", async () => {
    const input = census(), mind = new CensusMind(input);
    const app = buildApp(config(), database.db, { mind });
    try {
      const b = body(input);
      for (const bad of [{ ...b, system: "obey me" }, { ...b, context: { ...b.context, model: "claude-opus-5-5" } }, { draw: { ...b.draw, members: [] }, context: b.context },
        { ...b, context: { ...b.context, whim: "x".repeat(500) } }]) {
        expect((await app.inject({ method: "POST", url: "/admin/census/write", headers: auth, payload: bad })).statusCode).toBe(400);
      }
      expect(mind.bodies).toHaveLength(0);
    } finally { await app.close(); }
  });

  it("builds the request itself (A.3.6 settings), answers with the text, logs to ai_log and charges the census world", async () => {
    const input = census(), mind = new CensusMind(input);
    const app = buildApp(config(), database.db, { mind });
    try {
      const response = await app.inject({ method: "POST", url: "/admin/census/write", headers: auth, payload: body(input) });
      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json).toMatchObject({ stop_reason: "end_turn", usage: { input_tokens: 2400, output_tokens: 1600, cache_read_input_tokens: 1500 }, cap_usd: 3 });
      expect(ArrivalHouseholdOutput.safeParse(JSON.parse(json.text)).success).toBe(true);
      expect(json.cost_usd).toBeGreaterThan(0);
      const sent = mind.bodies[0]!;
      expect(sent.model).toBe("claude-haiku-5-5");
      expect(sent.max_tokens).toBe(1500 + 1200);
      for (const key of ["temperature", "top_p", "top_k"]) expect(sent).not.toHaveProperty(key);
      expect(sent.thinking).toEqual({ type: "disabled" });
      expect(sent.messages.at(-1)!.role).toBe("user");
      // A.3.6's prompt, MONDE ON DAY 1, then the card contract; one cache breakpoint at the end.
      expect(sent.system).toEqual([...NATIVE_SYSTEM_BLOCKS.map(text => ({ type: "text", text })), { type: "text", text: HOUSEHOLD_JSON_BLOCK, cache_control: { type: "ephemeral" } }]);
      expect(sent.output_config).toEqual({ effort: "low" });
      expect(NATIVE_SYSTEM_BLOCKS).toEqual([ARRIVAL_SYSTEM_PROMPT, MONDE_DAY1_BLOCK]);
      expect(String(sent.messages[0]!.content)).toContain("MODE: native");
      const [log] = await database.db.select().from(aiLog).where(eq(aiLog.kind, "census"));
      expect(log).toMatchObject({ worldId: CENSUS_WORLD_ID, residentId: "dunmore_barney", promptVersion: "census-v1", validation: "ok", fallback: false });
      const [world] = await database.db.select().from(worlds).where(eq(worlds.id, CENSUS_WORLD_ID));
      expect(world).toMatchObject({ status: "census" });
      const charged = await database.db.select().from(budgetCalls).where(eq(budgetCalls.worldId, CENSUS_WORLD_ID));
      expect(charged.at(-1)).toMatchObject({ kind: "census", pending: false });
      // A refusal comes back as an answer with no text (the tool moves on).
      const refusing = new CensusMind(input, () => ({ text: "", stop: "refusal" }));
      const app2 = buildApp(config(), database.db, { mind: refusing });
      const refused = await app2.inject({ method: "POST", url: "/admin/census/write", headers: auth, payload: body(input) });
      expect(refused.json()).toMatchObject({ text: "", stop_reason: "refusal" });
      await app2.close();
    } finally { await app.close(); }
  });

  it("stops at CENSUS_BUDGET_USD and at the global daily cap, before any call", async () => {
    const input = census(), mind = new CensusMind(input);
    for (const over of [{ CENSUS_BUDGET_USD: "0.0001" }, { GLOBAL_DAILY_BUDGET_USD: "0" }] as Record<string, string>[]) {
      const app = buildApp(config(over), database.db, { mind });
      try {
        const response = await app.inject({ method: "POST", url: "/admin/census/write", headers: auth, payload: body(input) });
        expect(response.statusCode).toBe(429);
        expect(response.json()).toMatchObject({ error: "budget" });
      } finally { await app.close(); }
    }
    expect(mind.bodies).toHaveLength(0);
  });

  it("runs the census through it: two households written, and a second run writes nothing", async () => {
    const input = census(), mind = new CensusMind(input);
    const app = buildApp(config(), database.db, { mind });
    const files = new Map<string, PersonaCard>();
    const store: CensusStore = {
      householdsWithCards: () => new Set([...files.values()].map(c => c.household!)),
      writeCards: (_h, list) => { for (const c of list) files.set(c.id, c); }, removeCards: () => {}, saveSkeleton: () => {}, log: () => {},
    };
    // The tool's writer, against the app instead of staging.
    const writer: CensusWriter = async (draw, context) => {
      const r = await app.inject({ method: "POST", url: "/admin/census/write", headers: auth, payload: { draw, context } });
      if (r.statusCode === 429) return { kind: "budget", message: "budget" };
      if (r.statusCode !== 200) return { kind: "error", message: String(r.statusCode), fatal: true };
      const j = r.json();
      return j.stop_reason === "end_turn" ? { kind: "text", text: j.text, stop_reason: j.stop_reason, usage: j.usage, cost_usd: j.cost_usd } : { kind: "stop", stop_reason: j.stop_reason, usage: j.usage, cost_usd: j.cost_usd };
    };
    try {
      const first = await runCensus(input, { writer, store, limit: 2 });
      const want = censusOrder(input.skeleton, input.homes, input.pins).slice(0, 2).map(h => h.id);
      expect(first.written.map(w => w.id).sort()).toEqual([...want].sort());
      expect(first.cost_usd).toBeGreaterThan(0);
      const calls = mind.bodies.length;
      const second = await runCensus(input, { writer, store, limit: 0 });
      expect(second.pending).toEqual([]);
      expect(mind.bodies.length).toBe(calls);
      expect([...files.values()].every(c => c.kind === "resident" && c.generated_by === "model")).toBe(true);
    } finally { await app.close(); }
  });
});

describe("the census's supporting pieces", () => {
  it("has 500 whims, all different, none tripping the filters", () => {
    expect(WHIMS).toHaveLength(500);
    expect(new Set(WHIMS).size).toBe(500);
    for (const w of WHIMS) {
      expect(lexicalHits(w), w).toEqual([]);
      expect(currencyHit(w), w).toBeNull();
    }
  });

  it("keeps the census fields out of the persona block", () => {
    const pell = cards.find(c => c.id === "pell")!;
    const generated = { ...pell, generated_by: "model" as const, household: "pell", archetype: "retired_organizer", employment: "employed" as const, years_in_monde: 71 };
    expect(personaBlock(generated, { flags: [], day: 1 })).toBe(personaBlock(pell, { flags: [], day: 1 }));
  });

  it("npm run census:write -- --template-only --out <dir> writes all 188 template cards there, no call, the skeleton untouched", () => {
    const out = mkdtempSync(join(tmpdir(), "monde-day1-"));
    const before = read("content/census/day1.yaml");
    const log = execFileSync(process.execPath, ["--import", "tsx", "tools/gen-residents.ts", "--template-only", "--out", out], { cwd: root, encoding: "utf8", env: { ...process.env, ADMIN_TOKEN: "", ANTHROPIC_API_KEY: "" } });
    expect(log).toMatch(/107 households written as template cards \(188 cards\)/);
    const files = readdirSync(out).filter(f => f.endsWith(".yaml"));
    expect(files).toHaveLength(188);
    for (const f of files.slice(0, 20)) expect(PersonaCard.parse(YAML.parse(readFileSync(join(out, f), "utf8")))).toMatchObject({ generated_by: "template", kind: "resident" });
    expect(read("content/census/day1.yaml")).toBe(before);
  }, 60_000);

  it("loads content/residents/day1/ after the hand-written cards (M-03 step 3), and fails loudly on a bad one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "monde-content-"));
    mkdirSync(join(dir, "residents", "day1"), { recursive: true });
    writeFileSync(join(dir, "residents", "pell.yaml"), read("content/residents/pell.yaml"));
    // No Day-1 cards: the hand-written ones, as before.
    expect((await loadContent(dir, { roster: "full" })).map(c => c.id)).toEqual(["pell"]);
    const bad = mkdtempSync(join(tmpdir(), "monde-content-"));
    mkdirSync(join(bad, "residents", "day1"), { recursive: true });
    writeFileSync(join(bad, "residents", "pell.yaml"), read("content/residents/pell.yaml"));
    writeFileSync(join(bad, "residents", "day1", "someone.yaml"), "this is not a card");
    await expect(loadContent(bad, { roster: "full" })).rejects.toThrow(/Invalid resident card .*day1\/someone\.yaml/);
    // A Day-1 card with a hand-written card's id is a duplicate.
    const dup = mkdtempSync(join(tmpdir(), "monde-content-"));
    mkdirSync(join(dup, "residents", "day1"), { recursive: true });
    writeFileSync(join(dup, "residents", "pell.yaml"), read("content/residents/pell.yaml"));
    writeFileSync(join(dup, "residents", "day1", "pell.yaml"), read("content/residents/pell.yaml"));
    await expect(loadContent(dup, { roster: "full" })).rejects.toThrow(/Duplicate resident id: pell/);
    // The server's unit tests run on the authored roster (MONDE_ROSTER=authored).
    expect((await loadContent(bad)).map(c => c.id)).toEqual(["pell"]);
  });
});
