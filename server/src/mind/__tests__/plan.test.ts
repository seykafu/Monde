import { beforeAll, describe, expect, it } from "vitest";
import type { PersonaCard, PlanOutput } from "@monde/shared";
import { loadContent } from "../../content/loadContent.js";
import { loadPlaceRegistry, openPlacesFor, placeHours, type PlaceRegistry } from "../places.js";
import { templateRoster } from "../../../../tools/census-inputs.js";
import { MAX_CHANGES, modelMinutes, planVerbs, validatePlan, type PlanValidationContext } from "../plan.js";
import { routineBlocks, templatePlan, withoutMinutes } from "../templatePlan.js";

let cards: PersonaCard[];
let registry: PlaceRegistry;
const card = (id: string): PersonaCard => cards.find((c) => c.id === id)!;
beforeAll(async () => { [cards, registry] = await Promise.all([loadContent(), loadPlaceRegistry()]); });

/** Day 2 is a Wednesday: Odile's weekday routine. */
const DAY = 2;
const ctx = (id = "odile", day = DAY): PlanValidationContext => ({
  card: card(id), day, places: registry.ids, residentIds: new Set(cards.map((c) => c.id)),
});
type Block = PlanOutput["blocks"][number];
const brief = (blocks: readonly Block[]) => blocks.map((b) => `${b.start}-${b.end} ${b.action}@${b.place}`);

/** Odile's bare routine as plan blocks: what a model's plan is measured against (the template adds outdoor stops). */
const routine = (id = "odile", day = DAY): Block[] => withoutMinutes(routineBlocks(card(id), day));

/** Odile's routine with some blocks replaced (by start time) and extras. */
function modelPlan(replace: Record<string, Partial<Omit<Block, "action"> & { action: string }>> = {}, extra: Partial<Record<keyof PlanOutput, unknown>> = {}) {
  const blocks = routine().map((b) => ({ ...b, ...replace[b.start] }));
  return JSON.stringify({ blocks, whim: null, barks: [], seek_player: null, intentions: [], ...extra });
}

function valid(raw: string, context = ctx()) {
  const result = validatePlan(raw, context);
  if (!result.ok) throw new Error(`expected a valid plan, got ${result.category}: ${result.detail}`);
  return result;
}

describe("validatePlan", () => {
  it("accepts a plan that keeps the routine with one change, a whim, barks and a reason to find the Fellow", () => {
    const result = valid(modelPlan(
      { "14:00": { action: "walk", place: "commons.duck_pond", note: "Wrists ache. Air instead of a nap.", with: ["june"] } },
      {
        whim: { at: "16:30", action: "sit", place: "old_quarter.fountain_square", reason: "The fountain's running again." },
        barks: ["Eat something.", "Oven's hot since four.", "Hm. Rain by evening."],
        seek_player: { topic: "the oven bricks", urgency: 2 },
        intentions: ["Ask June about Thursday's delivery."],
      },
    ));
    expect(result.changed).toBe(1);
    expect(result.adjustments).toEqual([]);
    expect(brief(result.plan.blocks)).toEqual([
      "04:00-09:00 work@market_row.bakery",
      "09:00-13:00 clean@market_row.bakery",
      "13:00-14:00 eat@market_row.bakery_flat",
      "14:00-16:00 walk@commons.duck_pond",
      "16:00-18:00 shop@market_row.general_store",
      "18:00-21:00 socialize@market_row.gull_and_anchor",
      "21:00-26:00 sleep@market_row.bakery_flat",
    ]);
    expect(result.plan.blocks[3]).toMatchObject({ with: ["june"], note: "Wrists ache. Air instead of a nap." });
    expect(result.plan.whim).toEqual({ at: "16:30", action: "sit", place: "old_quarter.fountain_square", reason: "The fountain's running again." });
    expect(result.plan.barks).toHaveLength(3);
    expect(result.plan.seek_player).toEqual({ topic: "the oven bricks", urgency: 2 });
  });

  it("keeps the routine block where the model used a verb that doesn't exist", () => {
    const result = valid(modelPlan({ "09:00": { action: "dance", place: "market_row.market_street" } }));
    expect(result.changed).toBe(0);
    expect(result.plan.blocks[1]).toMatchObject({ start: "09:00", end: "13:00", action: "clean", place: "market_row.bakery" });
    expect(result.adjustments.join()).toContain("verb dance");
  });

  it("keeps the routine block where the model used an unregistered place", () => {
    const result = valid(modelPlan({ "16:00": { action: "shop", place: "market_row.moon_shop" } }));
    expect(result.plan.blocks[4]).toMatchObject({ action: "shop", place: "market_row.general_store" });
    expect(result.adjustments.join()).toContain("place market_row.moon_shop");
  });

  it("keeps the first two changes and reverts the rest", () => {
    const result = valid(modelPlan({
      "09:00": { action: "read", place: "old_quarter.library" },
      "14:00": { action: "walk", place: "commons.duck_pond" },
      "18:00": { action: "visit", place: "old_quarter.pell_house" },
    }));
    expect(MAX_CHANGES).toBe(2);
    expect(result.changed).toBe(2);
    expect(brief(result.plan.blocks)).toEqual([
      "04:00-09:00 work@market_row.bakery",
      "09:00-13:00 read@old_quarter.library",
      "13:00-14:00 eat@market_row.bakery_flat",
      "14:00-16:00 walk@commons.duck_pond",
      "16:00-18:00 shop@market_row.general_store",
      "18:00-21:00 socialize@market_row.gull_and_anchor",
      "21:00-26:00 sleep@market_row.bakery_flat",
    ]);
    expect(result.adjustments.join()).toContain("3 changed blocks");
  });

  it("rejects overlapping blocks, bad times and malformed JSON", () => {
    const overlapping = JSON.parse(modelPlan());
    overlapping.blocks[1].start = "08:30";
    expect(validatePlan(JSON.stringify(overlapping), ctx())).toMatchObject({ ok: false, category: "overlap" });
    const backwards = JSON.parse(modelPlan());
    backwards.blocks[2].end = "12:00";
    expect(validatePlan(JSON.stringify(backwards), ctx())).toMatchObject({ ok: false, category: "times" });
    expect(validatePlan(modelPlan({ "13:00": { end: "27:00" } }), ctx())).toMatchObject({ ok: false, category: "times" });
    expect(validatePlan("{\"blocks\": [", ctx())).toMatchObject({ ok: false, category: "schema" });
    expect(validatePlan(JSON.stringify({ blocks: [] }), ctx())).toMatchObject({ ok: false, category: "schema" });
  });

  it("takes only the changed blocks and fills the rest of the day from the routine; no blocks keeps the routine", () => {
    const kept = valid(modelPlan({}, { blocks: [] }));
    expect(kept.changed).toBe(0);
    expect(brief(kept.plan.blocks)).toEqual(brief(routine()));
    const one = routine().find((b) => b.start === "14:00")!;
    const changed = valid(JSON.stringify({ blocks: [{ ...one, action: "walk", place: "commons.duck_pond", note: "Air instead of a nap.", with: [] }],
      whim: null, barks: [], seek_player: null, intentions: [] }));
    expect(changed.changed).toBe(1);
    expect(changed.plan.blocks.length).toBe(routine().length);
    expect(changed.plan.blocks.find((b) => b.start === "14:00")).toMatchObject({ action: "walk", place: "commons.duck_pond" });
  });

  it("ends an evening block written through to the morning at 02:00, not a thrown-away plan", () => {
    // Soak 2026-10-19: 17% of plans failed "times" on blocks like 21:30-06:00 (sleep, to tomorrow's wake time).
    const last = routine().at(-1)!;
    const result = valid(modelPlan({ [last.start]: { end: "06:00" } }));
    expect(result.plan.blocks.at(-1)!.end).toBe("26:00"); // the engine writes the end of the day as 26:00
    expect(result.adjustments).toContain(`block ${routine().length - 1} ends at 02:00 (was 06:00)`);
    // A daytime block that ends before it starts is still wrong.
    const backwards = JSON.parse(modelPlan());
    backwards.blocks[2].end = "07:00";
    expect(validatePlan(JSON.stringify(backwards), ctx())).toMatchObject({ ok: false, category: "times" });
  });

  it("sorts blocks and fills gaps and the end of the day from the routine", () => {
    const blocks = JSON.parse(modelPlan()).blocks as Block[];
    // Out of order, with 13:00-16:00 and everything after 18:00 missing.
    const result = valid(JSON.stringify({
      blocks: [blocks[4], blocks[0], blocks[1]], whim: null, barks: [], seek_player: null, intentions: [],
    }));
    expect(result.changed).toBe(0);
    expect(brief(result.plan.blocks)).toEqual(brief(routine()));
    expect(result.adjustments).toEqual(expect.arrayContaining(["blocks sorted by start", "13:00-16:00 filled from the routine"]));
  });

  it("doesn't count a routine block split in two, or one cut short and filled, as a change", () => {
    const blocks = JSON.parse(modelPlan()).blocks as Block[];
    const split = [
      { ...blocks[0]!, end: "06:00" }, { ...blocks[0]!, start: "06:00", note: "Second batch." },
      { ...blocks[1]!, end: "12:00" }, ...blocks.slice(2, 5),
    ];
    const result = valid(JSON.stringify({ blocks: split, whim: null, barks: [], seek_player: null, intentions: [] }));
    expect(result.changed).toBe(0);
    expect(brief(result.plan.blocks)).toEqual(brief(routine()));
  });

  it("reads 00:00-02:00 as the small hours of the same game day", () => {
    expect(modelMinutes("01:30")).toBe(25 * 60 + 30);
    expect(modelMinutes("02:00")).toBe(26 * 60);
    expect(modelMinutes("04:00")).toBe(4 * 60);
    expect(modelMinutes("26:00")).toBe(26 * 60);
    expect(modelMinutes("26:01")).toBeNull();
    expect(modelMinutes("9am")).toBeNull();
    const result = valid(modelPlan({ "21:00": { end: "02:00" } }));
    expect(result.plan.blocks.at(-1)).toMatchObject({ start: "21:00", end: "26:00" });
  });

  it("filters barks, clamps urgency, drops unknown companions and impossible whims", () => {
    const result = valid(modelPlan({ "18:00": { with: ["june", "nobody", "odile", "player"] } }, {
      barks: ["Check the internet for it.", "Eat something.", "", "Hm.", "Rye's two.", "Sit or don't."],
      seek_player: { topic: "the starter", urgency: 7.6 },
      whim: { at: "10:00", action: "fly", place: "market_row.bakery", reason: "Why not." },
      intentions: ["Feed the starter.", "feed the starter.", "Find my damn keys."],
    }));
    expect(result.plan.barks).toEqual(["Eat something.", "Hm.", "Rye's two."]);
    expect(result.plan.seek_player).toEqual({ topic: "the starter", urgency: 3 });
    expect(valid(modelPlan({}, { seek_player: { topic: "x", urgency: -2 } })).plan.seek_player?.urgency).toBe(0);
    expect(result.plan.blocks[5]!.with).toEqual(["june"]);
    expect(result.plan.whim).toBeNull();
    expect(result.plan.intentions).toEqual(["Feed the starter."]);
    expect(result.adjustments.join()).toContain("bark dropped (lexical:modern_tech)");
  });

  it("holds animals to their verbs", () => {
    expect([...planVerbs(card("bastien"))].sort()).toEqual(["eat", "nap", "sit", "sleep", "wander"]);
    const bastien = templatePlan(card("bastien"), DAY);
    const blocks = bastien.blocks.map((b, i) => (i === 2 ? { ...b, action: "work" } : b));
    const result = valid(JSON.stringify({ ...bastien, blocks }), ctx("bastien"));
    expect(result.plan.blocks[2]!.action).toBe(bastien.blocks[2]!.action);
  });
});

describe("open places for the plan prompt", () => {
  it("lists registered places with hours only where they differ, and skips vacant houses and the mainland", () => {
    const odile = openPlacesFor(registry, card("odile"));
    const ids = odile.map((p) => p.id);
    expect(ids).toContain("market_row.bakery");
    expect(ids.some((id) => id.includes("vacant_house"))).toBe(false);
    expect(ids).not.toContain("offmap.city");
    expect(odile.find((p) => p.id === "market_row.general_store")).toEqual({ id: "market_row.general_store", hours: "open 07:00-19:00" });
    expect(odile.find((p) => p.id === "market_row.gull_and_anchor")).toEqual({ id: "market_row.gull_and_anchor", hours: "open 11:00-24:00" });
    expect(odile.find((p) => p.id === "market_row.bakery")).toEqual({ id: "market_row.bakery", hours: null });
    expect(ids.every((id) => registry.ids.has(id))).toBe(true);
    // Vane's routine goes to the mainland, so his list has it.
    expect(openPlacesFor(registry, card("vane")).map((p) => p.id)).toContain("offmap.city");
    expect(placeHours("old_quarter.library")).toEqual({ open: 360, close: 1560 });
  });

  it("leaves other census households' homes out of a Day-1 resident's list, never their own (MVP M-03)", async () => {
    const day1 = await templateRoster();
    const someone = day1.find((c) => /\.home_\d{2,3}$/.test(c.home))!;
    const ids = openPlacesFor(registry, someone).map((p) => p.id);
    expect(ids).toContain(someone.home);
    const otherHomes = new Set(day1.map((c) => c.home).filter((h) => /\.home_\d{2,3}$/.test(h) && h !== someone.home));
    expect(otherHomes.size).toBeGreaterThan(50);
    expect(ids.filter((id) => otherHomes.has(id))).toEqual([]);
    // The cast's lists lose them too, so the census never lengthens anyone's plan prompt.
    expect(openPlacesFor(registry, card("odile")).some((p) => /\.home_\d{2,3}$/.test(p.id))).toBe(false);
  });
});
