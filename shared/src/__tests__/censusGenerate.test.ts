// MVP M-03 step 2, the run: the write order, retries with the errors fed back, the template after six failures, the
// budget stop, idempotency (a second run writes nothing; --regen is the only override), the input-hash warning and the
// dry run's estimate. The writer is a fake mind; nothing touches content/.
import { describe, expect, it } from "vitest";
import {
  BIG5_KEYS, CENSUS_ATTEMPTS_PER_ROUND, CENSUS_ROUNDS, DEFAULT_CENSUS_PRICES, PersonaCard, WHIMS, censusInputHash, censusOrder, countWords, nativeValidationContext,
  runCensus, stringifyGeneratedCard, validateHousehold, type ArrivalHouseholdOutput, type CensusInput, type CensusStore, type CensusWriter, type CensusWriterResult,
  type NativePromptContext, type HouseholdDraw,
} from "../index";
import YAML from "yaml";
import { censusInput, household, modelAnswer } from "./censusFixtures";

const usage = { input_tokens: 2400, output_tokens: 1600, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 };

/** The files, in memory. */
function memoryStore() {
  const files = new Map<string, string>();
  const log: string[] = [];
  const counts = { writes: 0, saves: 0, removed: [] as string[] };
  let written: CensusInput["written"] | null = null;
  const store: CensusStore = {
    householdsWithCards: () => new Set([...(written?.values() ?? [])].map(c => c.household!).filter(Boolean)),
    writeCards: (_h, cards) => { counts.writes++; for (const c of cards) files.set(c.id, stringifyGeneratedCard(c)); },
    removeCards: id => { counts.removed.push(id); for (const [k, v] of files) if (v.includes(`household: ${id}\n`)) files.delete(k); },
    saveSkeleton: () => { counts.saves++; },
    log: line => log.push(line),
  };
  return { store, files, log, counts, bind: (w: CensusInput["written"]) => { written = w; } };
}

/** A fake mind that writes like Haiku: a valid answer for the household it's asked about. */
function fakeMind(input: CensusInput, script: (draw: HouseholdDraw, ctx: NativePromptContext, n: number) => CensusWriterResult | null = () => null) {
  const calls: { id: string; ctx: NativePromptContext }[] = [];
  const writer: CensusWriter = async (draw, ctx) => {
    calls.push({ id: draw.id, ctx });
    const scripted = script(draw, ctx, calls.filter(c => c.id === draw.id).length);
    if (scripted) return scripted;
    const text = JSON.stringify(modelAnswer(input, household(input, draw.id), draw, `${calls.length}`));
    return { kind: "text", text, stop_reason: "end_turn", usage, cost_usd: 0.0011 };
  };
  return { writer, calls };
}

const setup = () => {
  const input = censusInput();
  const mem = memoryStore();
  mem.bind(input.written);
  return { input, ...mem };
};

const HENRIK_BACKSTORY = "Henrik grew up two doors down from his mother's old house on Terrace Row and has lived on it ever since, apart from four years driving a bread van out of Hessle Cross. He came back when Maud was born and took the ground floor at number fifteen because the stairs at his mother's were too steep for a pram. He mends bicycles in the yard for whoever asks and takes payment in eggs. Jo does most of the cooking now and pretends not to. He is sure the school will close by Christmas, and he has already worked out which bus Maud would take into Carrow. He has not told her. He wants his mother to stop sending round soup, and he has never said so. The van's old route map is still pinned up inside the coal cupboard door.";

/**
 * Maud Szabo's household (three members, required kin ties) the way the 2026-10-17 staging trial's replies failed:
 * a 30-word summary, a 141-word backstory, ties tagged "mother", "daughter", "cousin" and "neighbour", a tie to
 * oneself, a routine at "market_street", Nettie's tie at her card's 90, likes off the list, and Jo's Big Five three
 * points from his father's on every trait.
 */
function asTheTrialWrote(input: CensusInput, draw: HouseholdDraw): ArrivalHouseholdOutput {
  const out = modelAnswer(input, household(input, draw.id), draw, "trial");
  const [henrik, maud, jo] = out.members as [ArrivalHouseholdOutput["members"][number], ArrivalHouseholdOutput["members"][number], ArrivalHouseholdOutput["members"][number]];
  out.household.summary = "Henrik Szabo raises Maud and Jo on Terrace Row, a short street away from his mother Ilona. Cousin Nettie is round most evenings, and nobody remembers ever inviting her in.";
  henrik.backstory = HENRIK_BACKSTORY;
  henrik.relationships = [
    ...henrik.relationships.map(r => (r.id === "ilona" ? { ...r, tag: "mother" as never } : r.id === "m2" ? { ...r, tag: "daughter" as never } : r)),
    { id: "m1", affinity: 60, trust: 60, tag: "kin", note: "Same roof." },
  ];
  const street = henrik.routine.weekend.findIndex(e => e.where === "market_row.market_street");
  henrik.routine.weekend[street]!.where = "market_street";
  henrik.likes = ["pigeons", "crosswords", "the wireless at night"];
  maud.relationships = maud.relationships.map(r =>
    r.id === "nettie" ? { ...r, affinity: 90, trust: 85, tag: "cousin" as never } : r.id === "bru" ? { ...r, affinity: 65, trust: 50, tag: "neighbour" as never } : r);
  // Away from 50 by three: the same strong traits, and no two apart.
  jo.personality.big5 = Object.fromEntries(BIG5_KEYS.map(k => { const v = henrik.personality.big5[k]; return [k, v >= 50 ? Math.min(100, v + 3) : Math.max(0, v - 3)]; })) as typeof jo.personality.big5;
  return out;
}

describe("the census run (M-03 step 2)", () => {
  it("writes the named people's households first, then zone by zone and street by street", () => {
    const input = censusInput();
    const order = censusOrder(input.skeleton, input.homes, input.pins).map(h => h.id);
    expect(order).toHaveLength(107);
    expect(order.slice(0, 14)).toEqual(input.pins.households.filter(p => input.skeleton.households.find(h => h.id === p.id)?.generation).map(p => p.id));
    const zones = order.slice(14).map(id => household(input, id).zone);
    expect([...new Set(zones)]).toEqual(["old_quarter", "market_row", "wharf", "commons", "millbrook", "station_hill"]);
  });

  it("writes each household's cards and records it in the skeleton; a second run writes nothing", async () => {
    const { input, store, files, counts } = setup();
    const mind = fakeMind(input);
    const first = await runCensus(input, { writer: mind.writer, store, now: () => new Date("2026-10-17T12:00:00Z") });
    expect(first.failed).toEqual([]);
    expect(first.written).toHaveLength(107);
    expect(first.written.every(w => w.source === "model")).toBe(true);
    expect(files.size).toBe(188);
    expect(counts.writes).toBe(107);
    expect(new Set([...input.written.keys()]).size).toBe(188);
    for (const id of first.pending) {
      const h = household(input, id);
      expect(h.status).toBe("drafted");
      expect(h.generation).toMatchObject({ prompt: "census-v1", source: "model", input_hash: censusInputHash(input, h), written_at: "2026-10-17T12:00:00.000Z" });
      for (const m of h.members.filter(x => x.kind === "named" || x.kind === "anonymous")) {
        expect(m.id).toBeTruthy();
        const card = PersonaCard.parse(YAML.parse(files.get(m.id!)!));
        expect(card).toMatchObject({ household: id, home: h.home, generated_by: "model", kind: "resident" });
        expect(files.get(m.id!)!.split("\n")[0]).toBe(`# Generated (census-v1) for ${id}; curated not yet. Edit here.`);
      }
    }
    // Every call had a whim from the list.
    expect(mind.calls.every(c => WHIMS.includes(c.ctx.whim))).toBe(true);
    const again = fakeMind(input);
    const writes = counts.writes, saves = counts.saves;
    const second = await runCensus(input, { writer: again.writer, store });
    expect(again.calls).toHaveLength(0);
    expect([counts.writes, counts.saves]).toEqual([writes, saves]);
    expect(second.pending).toEqual([]);
    expect(second.skipped).toHaveLength(107);
    expect(second.stale).toEqual([]);
  }, 60_000);

  it("skips a household whose card files exist even if the skeleton still says skeleton; --regen rewrites one", async () => {
    const { input, store, counts } = setup();
    await runCensus(input, { writer: fakeMind(input).writer, store, limit: 2 });
    const [a] = censusOrder(input.skeleton, input.homes, input.pins).map(h => h.id);
    household(input, a!).status = "pinned";
    const mind = fakeMind(input);
    const r = await runCensus(input, { writer: mind.writer, store, limit: 1 });
    expect(r.skipped).toContain(a);
    expect(mind.calls.map(c => c.id)).not.toContain(a);
    const regen = fakeMind(input);
    const rr = await runCensus(input, { writer: regen.writer, store, regen: a, limit: 1 });
    expect(counts.removed).toEqual([a]);
    expect(rr.written.map(w => w.id)).toEqual([a]);
  });

  it("warns when a written household's skeleton changed since, and leaves it be", async () => {
    const { input, store, log } = setup();
    await runCensus(input, { writer: fakeMind(input).writer, store, limit: 1 });
    const [a] = censusOrder(input.skeleton, input.homes, input.pins);
    a!.members[0]!.birthday = 1 + ((a!.members[0]!.birthday ?? 0) % 100);
    const r = await runCensus(input, { writer: fakeMind(input).writer, store, limit: 0 });
    expect(r.stale).toEqual([a!.id]);
    expect(log.some(l => l.startsWith(`warning: ${a!.id}'s skeleton inputs changed`))).toBe(true);
  });

  it("feeds the validator's errors back with a fresh whim, and moves on from a refusal", async () => {
    const { input, store } = setup();
    const [a] = censusOrder(input.skeleton, input.homes, input.pins).map(h => h.id);
    const mind = fakeMind(input, (draw, _ctx, n) => {
      if (n === 1) { const out = modelAnswer(input, household(input, draw.id), draw); out.members[0]!.workplace = "market_row.bakery"; return { kind: "text", text: JSON.stringify(out), stop_reason: "end_turn", usage, cost_usd: 0.001 }; }
      if (n === 2) return { kind: "stop", stop_reason: "refusal", usage, cost_usd: 0.0004 };
      if (n === 3) return { kind: "text", text: "not json", stop_reason: "end_turn", usage, cost_usd: 0.001 };
      return null;
    });
    const r = await runCensus(input, { writer: mind.writer, store, limit: 1 });
    expect(r.written).toEqual([{ id: a, source: "model", attempts: 4, cost_usd: expect.closeTo(0.0035, 6) }]);
    expect(mind.calls[1]!.ctx.validatorErrors?.[0]).toMatch(/^V13 members\[0\]\.workplace "market_row\.bakery"/);
    // A refusal isn't the wording's fault: no errors carried; bad JSON is V01; the second round starts clean.
    expect(mind.calls[2]!.ctx.validatorErrors).toBeUndefined();
    expect(mind.calls[3]!.ctx.validatorErrors).toBeUndefined();
    expect(new Set(mind.calls.map(c => c.ctx.whim)).size).toBeGreaterThan(1);
    expect(household(input, a!).generation?.attempts).toBe(4);
  });

  it("accepts on the first attempt a reply that failed only on what the engine repairs (the staging trial's faults)", async () => {
    const { input, store, log, files } = setup();
    const seen: { before?: ReturnType<typeof validateHousehold>; retagged?: ReturnType<typeof validateHousehold> } = {};
    const mind = fakeMind(input, draw => {
      if (draw.id !== "szabo_maud") return null;
      const reply = asTheTrialWrote(input, draw);
      const vctx = nativeValidationContext(input, household(input, draw.id), draw);
      seen.before = validateHousehold(reply, draw, vctx);
      // With the tags fixed by hand the contract parses, and the validator lists the rest.
      const tags = structuredClone(reply);
      for (const m of tags.members) for (const r of m.relationships) if (!["fond", "wary", "curious", "rival", "kin", "friend"].includes(r.tag)) r.tag = r.id === "bru" ? "friend" : "kin";
      seen.retagged = validateHousehold(tags, draw, vctx);
      return { kind: "text", text: JSON.stringify(reply), stop_reason: "end_turn", usage, cost_usd: 0.0011 };
    });
    const order = censusOrder(input.skeleton, input.homes, input.pins).map(h => h.id);
    const r = await runCensus(input, { writer: mind.writer, store, limit: order.indexOf("szabo_maud") + 1, concurrency: 1 });
    // Without the repair this reply failed every attempt (the trial's six), and the household got the template.
    expect(seen.before).toMatchObject({ ok: false, errors: [expect.stringMatching(/^V01 not the contract: members\.0\.relationships\.\d+\.tag/)] });
    const left = seen.retagged && !seen.retagged.ok ? seen.retagged.errors : [];
    expect([...new Set(left.map(e => e.split(" ")[0]))].sort()).toEqual(["V07", "V08", "V11", "V13", "V14"]);
    expect(r.written.find(w => w.id === "szabo_maud")).toMatchObject({ source: "model", attempts: 1 });
    expect(mind.calls.filter(c => c.id === "szabo_maud")).toHaveLength(1);
    const line = log.find(l => l.startsWith("szabo_maud attempt 1: "))!;
    expect(line).toMatch(/^szabo_maud attempt 1: \d+ repairs \(V07 household\.summary trimmed from 30 to \d+ words \| V07 members\[0\]\.backstory trimmed from 141 to \d+ words \| /);
    for (const rule of ["V13 members[0].routine.weekend", "V14 members[0].relationships: dropped the tie to themself", 'V01 members[0].relationships "ilona".tag "mother" → "kin"', 'V01 members[1].relationships "bru".tag "neighbour" → "friend"', "V11 members[0].likes: added", "V08 members[2].personality.big5 nudged"])
      expect(line).toContain(rule);
    // Nettie's tie keeps her card's numbers; the backstory is within its cap.
    const cards = [...files.values()].map(f => PersonaCard.parse(YAML.parse(f))).filter(c => c.household === "szabo_maud");
    expect(cards.find(c => c.id === "maud")!.relationships.find(t => t.id === "nettie")).toMatchObject({ affinity: 90, trust: 85, tag: "kin" });
    expect(countWords(cards.find(c => c.backstory.startsWith("Henrik grew up"))!.backstory)).toBeLessThanOrEqual(120);
    expect(countWords(HENRIK_BACKSTORY)).toBe(141);
  });

  it("feeds back only what the repair couldn't fix", async () => {
    const { input, store } = setup();
    const [a] = censusOrder(input.skeleton, input.homes, input.pins).map(h => h.id);
    const mind = fakeMind(input, (draw, _ctx, n) => {
      if (n !== 1) return null;
      const out = modelAnswer(input, household(input, draw.id), draw);
      // A bare place id, a 141-word backstory and a stray tag (repaired), and another household's surname (V03: not).
      out.members[0]!.backstory = HENRIK_BACKSTORY;
      out.members[0]!.relationships[0]!.tag = "neighbour" as never;
      const street = out.members[0]!.routine.weekend.find(e => e.where === "market_row.market_street");
      expect(street).toBeDefined();
      street!.where = "market_street";
      out.members[0]!.name = `${out.members[0]!.name.split(" ")[0]} Fournier`;
      return { kind: "text", text: JSON.stringify(out), stop_reason: "end_turn", usage, cost_usd: 0.001 };
    });
    const r = await runCensus(input, { writer: mind.writer, store, limit: 1 });
    expect(r.written).toEqual([expect.objectContaining({ id: a, source: "model", attempts: 2 })]);
    expect(mind.calls[1]!.ctx.validatorErrors).toEqual([expect.stringMatching(/^V03 members\[0\]\.name: the surname "Fournier" belongs to another household$/)]);
  });

  it("falls back to the template card after six failed attempts (A.3.8)", async () => {
    const { input, store, files } = setup();
    const mind = fakeMind(input, () => ({ kind: "text", text: "{}", stop_reason: "end_turn", usage, cost_usd: 0.001 }));
    const r = await runCensus(input, { writer: mind.writer, store, limit: 1 });
    expect(mind.calls).toHaveLength(CENSUS_ROUNDS * CENSUS_ATTEMPTS_PER_ROUND);
    expect(r.written).toEqual([expect.objectContaining({ source: "template", attempts: 6 })]);
    expect([...files.values()].every(f => f.includes("generated_by: template"))).toBe(true);
    expect(household(input, r.written[0]!.id).generation?.source).toBe("template");
  });

  it("stops at the budget, and at a fatal error, leaving the rest for the next run", async () => {
    const { input, store } = setup();
    let n = 0;
    const mind = fakeMind(input, () => (++n > 3 ? { kind: "budget", message: "spent $3.00 of $3" } : null));
    const r = await runCensus(input, { writer: mind.writer, store, limit: 10, concurrency: 1 });
    expect(r.stopped).toBe("budget");
    expect(r.written).toHaveLength(3);
    expect(mind.calls).toHaveLength(4);
    expect(r.failed.length).toBe(7);
    const next = setup();
    const fatal = fakeMind(next.input, () => ({ kind: "error", fatal: true, message: "401" }));
    const f = await runCensus(next.input, { writer: fatal.writer, store: next.store, limit: 10, concurrency: 1 });
    expect(f.stopped).toBe("errors");
    expect(fatal.calls).toHaveLength(1);
  });

  it("--template-only writes every household's template card with no writer and no call (M-03 step 3)", async () => {
    const { input, store, files } = setup();
    const r = await runCensus(input, { store, templateOnly: true, concurrency: 1 });
    expect(r.failed).toEqual([]);
    expect(r.calls).toBe(0);
    expect(r.written).toHaveLength(107);
    expect(r.written.every(w => w.source === "template" && w.attempts === 0)).toBe(true);
    expect(files.size).toBe(188);
    expect([...files.values()].every(f => f.includes("generated_by: template"))).toBe(true);
    // The same cards every time: ids, names and all.
    const again = setup();
    await runCensus(again.input, { store: again.store, templateOnly: true, concurrency: 1 });
    expect([...again.files.entries()].sort()).toEqual([...files.entries()].sort());
    await expect(runCensus(censusInput(), { store })).rejects.toThrow(/a writer is needed unless dryRun or templateOnly/);
  }, 60_000);

  it("--dry-run builds every prompt and estimates the cost, calling and writing nothing", async () => {
    const { input, store, counts } = setup();
    const r = await runCensus(input, { store, dryRun: true, prices: DEFAULT_CENSUS_PRICES });
    expect(r.prompts).toHaveLength(107);
    expect(r.prompts.every(p => p.text.startsWith("DAY 1 · Spring · Tuesday") && p.text.includes("MODE: native"))).toBe(true);
    expect(counts.writes + counts.saves).toBe(0);
    const e = r.estimate!;
    expect(e).toMatchObject({ households: 107, members: 188 });
    expect(e.calls).toBe(Math.round(107 * 1.3));
    expect(e.cost_usd).toBeGreaterThan(0.05);
    expect(e.cost_usd).toBeLessThan(0.5);
    expect(e.worst_cost_usd).toBeGreaterThan(e.cost_usd);
    expect(e.worst_cost_usd).toBeLessThan(3);
  });
});
