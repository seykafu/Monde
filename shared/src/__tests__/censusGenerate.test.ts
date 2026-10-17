// MVP M-03 step 2, the run: the write order, retries with the errors fed back, the template after six failures, the
// budget stop, idempotency (a second run writes nothing; --regen is the only override), the input-hash warning and the
// dry run's estimate. The writer is a fake mind; nothing touches content/.
import { describe, expect, it } from "vitest";
import {
  CENSUS_ATTEMPTS_PER_ROUND, CENSUS_ROUNDS, DEFAULT_CENSUS_PRICES, PersonaCard, WHIMS, censusInputHash, censusOrder, runCensus, stringifyGeneratedCard,
  type CensusInput, type CensusStore, type CensusWriter, type CensusWriterResult, type NativePromptContext, type HouseholdDraw,
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
