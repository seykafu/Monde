// G-02 arrivals, the shared half: archetype weights (A.3.2), households (A.3.3), the portrait library (A.3.5), the
// persona contract and its validator (A.3.6–A.3.7) and the template fallback (A.3.8).
import { describe, expect, it } from "vitest";
import {
  ARCHETYPES, ARRIVAL_SYSTEM_PROMPT, ArrivalHouseholdOutput, HOME_TOKEN, PORTRAIT_LIBRARY, PersonaCard, ROUTINE_PLACES, SeededRng,
  UNSUPPORTED_SCHEMA_KEYS, arrivalUserMessage, archetypeWeights, assignPortrait, cardLookProblems, cardsFromHousehold, drawHousehold,
  firstArrival, householdLine, matchPortrait, modelOutputFormat, portraitById, residentIdFor, templateHousehold, validateHousehold,
  type ArrivalFacts, type DrawContext, type HouseholdDraw, type PromptContext,
} from "../index";

const PLACES = new Set([
  ...ROUTINE_PLACES.map(p => p.id), "millbrook.school", "wharf.fish_market", "wharf.boathouse", "old_quarter.town_hall",
  "old_quarter.lantern_office", "old_quarter.lamplighter_lane", "commons.community_garden", "commons.glasshouse", "pell",
]);
const CAST = new Map([["pell", { name: "Edwina Pell" }], ["odile", { name: "Odile Fournier" }], ["june", { name: 'Juniper "June" Castellanos' }]]);
const vctx = { places: PLACES, residents: CAST };

const facts = (over: Partial<ArrivalFacts> = {}): ArrivalFacts => ({
  day: 8, pillars: { prosperity: 21, safety: 33, spirit: 33, charm: 44 }, flags: new Set(["project_bakery_ovens_done"]),
  freeHomes: [{ home: "old_quarter.vacant_house_47", beds: 3 }], unrestoredHomes: 60, pupils: 9, storefrontsFree: 0, ...over,
});
const ctx = (over: Partial<DrawContext> = {}): DrawContext => ({
  seed: 7, day: 8, slot: 0, facts: facts(), youthShare: 0.48, recent: [], alive: new Map(), portraitUses: new Map(), ...over,
});

describe("the portrait library (§16.2, A.3.5)", () => {
  it("has sixteen tagged busts across every age band, each with a look the rig can draw", () => {
    expect(PORTRAIT_LIBRARY).toHaveLength(16);
    expect(new Set(PORTRAIT_LIBRARY.map(p => p.band))).toEqual(new Set(["child", "teen", "young_adult", "adult", "elder"]));
    expect(new Set(PORTRAIT_LIBRARY.map(p => p.presentation))).toEqual(new Set(["f", "m", "a"]));
    expect(new Set(PORTRAIT_LIBRARY.map(p => p.skin)).size).toBe(6);
    for (const p of PORTRAIT_LIBRARY) {
      expect(cardLookProblems({ kind: "arrival", look: p.look })).toEqual([]);
      expect(p.id.slice(4, 5)).toBe(p.presentation);
    }
  });

  it("assigns by band and presentation, prefers attire, and avoids a bust someone already wears", () => {
    const rng = new SeededRng(1);
    const elderF = assignPortrait({ band: "elder", presentation: "f", attire: ["cardigan", "brooch"] }, rng, new Map());
    expect(elderF).toMatchObject({ id: "lib_f68_013", band: "elder", presentation: "f" });
    const worn = assignPortrait({ band: "elder", presentation: "f", attire: ["cardigan", "brooch"] }, new SeededRng(1), new Map([["lib_f68_013", 1]]));
    expect(worn.id).toBe("lib_f76_015");
    // A band with no bust of that presentation still gives someone of that age.
    expect(assignPortrait({ band: "teen", presentation: "m", attire: [] }, rng, new Map()).band).toBe("teen");
  });

  it("matches a look to the bust that wears it", () => {
    for (const p of PORTRAIT_LIBRARY) expect(matchPortrait(p.look, p.band, p.presentation).id).toBe(p.id);
  });
});

describe("archetype weights (A.3.2)", () => {
  it("reproduces the worked example's weights for Day 30", () => {
    const day30 = archetypeWeights({
      day: 30,
      facts: facts({ day: 30, pillars: { prosperity: 45, safety: 50, spirit: 40, charm: 55 }, pupils: 11, storefrontsFree: 1,
        flags: new Set(["project_bakery_ovens_done", "project_homes_started"]),
        freeHomes: [{ home: "a", beds: 2 }, { home: "b", beds: 2 }, { home: "c", beds: 3 }, { home: "d", beds: 3 }, { home: "e", beds: 1 }] }),
      // The last 20 people: 30% under 40 (Y-lean ×1.25) and 30% 60 or over (no boost); three households in 10 days.
      recent: [
        { archetype: "cartographer", day: 12, ages: [35, 33, 25] }, { archetype: "radio_tinkerer", day: 14, ages: [61, 62, 63, 64] },
        { archetype: "mill_hand", day: 16, ages: [45, 46, 47, 48, 49, 50, 51] },
        { archetype: "young_family", day: 25, ages: [30, 28, 2] }, { archetype: "retired_couple", day: 26, ages: [70, 68] }, { archetype: "fisher", day: 27, ages: [40] },
      ],
      alive: new Map(),
    });
    const w = (id: string) => day30.find(r => r.id === id)!;
    // The table's w column (lift × base × gate × fatigue × need × balance), to its rounding.
    expect(w("young_family").w).toBeCloseTo(0.638, 2);
    expect(w("school_family").w).toBeCloseTo(1.598, 2);
    expect(w("drifter").w).toBeCloseTo(1.083, 2);
    expect(w("shop_founder").w).toBeCloseTo(0.969, 2);
    expect(w("retired_organizer").w).toBeCloseTo(0.363, 2);
    expect(w("clinician").gate).toBe(0);
    expect(w("schoolteacher").gate).toBe(0);
    expect(w("retired_keeper").gate).toBe(0);
    expect(w("market_gardener").gate).toBe(0);
    expect(Math.max(...day30.map(r => r.prob))).toBeLessThanOrEqual(0.35);
    expect(day30.reduce((s, r) => s + r.prob, 0)).toBeCloseTo(1, 6);
  });

  it("clamps a lopsided town at 35% and keeps every eligible archetype at 0.5% or more", () => {
    const lop = archetypeWeights({ day: 30, facts: facts({ pillars: { prosperity: 95, safety: 5, spirit: 5, charm: 5 } }), recent: [], alive: new Map() });
    const eligible = lop.filter(r => r.gate === 1);
    expect(Math.max(...eligible.map(r => r.prob))).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(Math.min(...eligible.map(r => r.prob))).toBeGreaterThanOrEqual(0.005 - 1e-9);
  });

  it("closes the oddballs at their Day-1 count + 2 and an archetype after two households today", () => {
    const alive = new Map([["birdwatcher", 4]]);
    expect(archetypeWeights({ day: 8, facts: facts(), recent: [], alive }).find(r => r.id === "birdwatcher")!.gate).toBe(0);
    expect(archetypeWeights({ day: 8, facts: facts(), recent: [], alive: new Map(), today: ["drifter", "drifter"] }).find(r => r.id === "drifter")!.gate).toBe(0);
  });
});

describe("households (A.3.1, A.3.3)", () => {
  it("is the same household for the same world, day and slot", () => {
    expect(drawHousehold(ctx())).toEqual(drawHousehold(ctx()));
    expect(drawHousehold(ctx({ slot: 1 }))!.id).not.toBe(drawHousehold(ctx())!.id);
  });

  it("follows the shapes: ages inside the bands and ranges, parents 18+ older, couples within 25 years", () => {
    for (let slot = 0; slot < 60; slot++) {
      const d = drawHousehold(ctx({ slot, youthShare: (slot % 5) / 4 }))!;
      const a = ARCHETYPES.find(x => x.id === d.archetype)!;
      expect(d.members.length).toBeGreaterThan(0);
      expect(d.members.length).toBeLessThanOrEqual(6);
      for (const m of d.members) {
        expect(m.age).toBeGreaterThanOrEqual(m.age_min);
        expect(m.age).toBeLessThanOrEqual(m.age_max);
        expect(portraitById(m.portrait)!.band).toBe(m.band);
        // A.2: pronouns default to the portrait.
        expect(m.pronoun_default).toBe({ f: "she/her", m: "he/him", a: "they/them" }[portraitById(m.portrait)!.presentation]);
      }
      const first = d.members[0]!;
      if (d.members.some(m => m.role === "child")) expect(Math.min(...d.members.filter(m => m.role === "child").map(m => first.age - m.age))).toBeGreaterThanOrEqual(18);
      for (const m of d.members.filter(x => x.role === "partner")) expect(Math.abs(m.age - first.age)).toBeLessThanOrEqual(25);
      if (a.id === "retired_couple") expect(d.members.map(m => m.role)).toEqual(["adult", "partner"]);
      // A.3.4 rule 1: the household fits the free home (three beds: six people).
      expect(d.beds).toBeLessThanOrEqual(3);
    }
  });

  it("leans young or old with §6.2's youth share", () => {
    const young = Array.from({ length: 30 }, (_, slot) => drawHousehold(ctx({ slot, youthShare: 1 }))!);
    const old = Array.from({ length: 30 }, (_, slot) => drawHousehold(ctx({ slot, youthShare: 0 }))!);
    expect(young.every(h => ARCHETYPES.find(a => a.id === h.archetype)!.lean === "Y")).toBe(true);
    expect(old.every(h => ARCHETYPES.find(a => a.id === h.archetype)!.lean !== "Y")).toBe(true);
  });

  it("trims a big household to a two-bed cottage (A.3.4 rule 1)", () => {
    const d = drawHousehold(ctx({ archetype: "school_family", facts: facts({ freeHomes: [{ home: "wharf.vacant_house_50", beds: 2 }] }) }))!;
    expect(d.members.length).toBeLessThanOrEqual(4);
  });
});

/** A fake Haiku answer: the template household, rewritten the way the model writes (its own words, the contract's shape). */
function modelAnswer(draw: HouseholdDraw): ArrivalHouseholdOutput {
  const out = structuredClone(templateHousehold(draw, vctx, "model"));
  out.members.forEach(m => {
    m.backstory = `${m.name.split(" ")[0]} kept the books for a chandler in Port Sallow for eleven years and was wrong about the tides every single spring. Came for the light.`;
    m.voice.samples = ["Can't say I mind the wind.", "That's the third gull today. They've a system.", "Right. I'll put the kettle on."];
    m.values = { prosperity: m.values.prosperity + 0.05, safety: m.values.safety - 0.05, spirit: m.values.spirit, charm: m.values.charm };
  });
  return out;
}

describe("the persona contract (A.3.6)", () => {
  const draw = drawHousehold(ctx({ archetype: "retired_couple" }))!;
  const prompt: PromptContext = {
    town: { day: 8, season: "Spring", weekday: "Tue", pillars: { prosperity: 21, safety: 33, spirit: 33, charm: 44 }, census: 210, shopsOpen: 6, pupils: 9, projectsDone: ["fountain"], projectsActive: [] },
    mode: "arrival", home: null, knownResidents: [{ id: "pell", name: "Edwina Pell", line: "Mayor" }], avoidFirst: ["Odile"], avoidFull: [], whim: "w1",
  };

  it("is A.3.6's system prompt and user message, with the portrait, the archetype, the AVOID list and the contract", () => {
    expect(ARRIVAL_SYSTEM_PROMPT).toMatch(/^You write Persona Cards for the residents of Monde/);
    expect(ARRIVAL_SYSTEM_PROMPT).toContain("The portrait is fixed. Fit the person to it");
    const msg = arrivalUserMessage(draw, prompt);
    expect(msg).toContain("ARCHETYPE retired_couple · Retired couple");
    expect(msg).toContain(`portrait ${draw.members[0]!.portrait}: ${portraitById(draw.members[0]!.portrait)!.caption}`);
    expect(msg).toContain("AVOID: first names Odile");
    expect(msg).toContain(`HOME: ${HOME_TOKEN}`);
    expect(msg).toContain("OUTPUT CONTRACT");
    expect(arrivalUserMessage(draw, { ...prompt, validatorErrors: ["V02 bad"] })).toContain("YOUR LAST ANSWER FAILED VALIDATION. Fix exactly these and change nothing else: V02 bad");
  });

  it("sends a schema structured outputs accept: closed objects, every key required, no ranges or lengths", () => {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) { expect(UNSUPPORTED_SCHEMA_KEYS).not.toContain(k); visit(v); }
      if ("properties" in node) {
        const n = node as { properties: object; required: string[]; additionalProperties: boolean };
        expect(n.additionalProperties).toBe(false);
        expect([...n.required].sort()).toEqual(Object.keys(n.properties).sort());
      }
    };
    visit(modelOutputFormat(ArrivalHouseholdOutput).schema);
  });
});

describe("validation (A.3.7)", () => {
  const draw = drawHousehold(ctx({ archetype: "retired_couple" }))!;

  it("accepts a well-written household and normalises its values", () => {
    const v = validateHousehold(modelAnswer(draw), draw, vctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    for (const m of v.output.members) expect(Object.values(m.values).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 2);
  });

  it("names the field and the value on failure, so a retry can fix exactly that", () => {
    const bad = modelAnswer(draw);
    bad.members[0]!.name = "Odile Fournier";
    bad.members[0]!.age = 30;
    bad.members[1]!.name = "Dr Who";
    bad.members[1]!.appearance = "A young woman with jet black hair.";
    bad.members[1]!.routine.weekday[1]!.where = "carrow.docks";
    bad.members[1]!.voice.samples = ["Not a town, but a feeling.", "Hm.", "Yes?"];
    bad.members[0]!.secrets = [{ text: "Owes the Tollmen money.", reveal: { regard_min: 90 } }];
    const v = validateHousehold(bad, draw, { ...vctx, banned: t => (/internet/i.test(t) ? ["modern_tech"] : []) });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const codes = v.errors.map(e => e.slice(0, 3));
    for (const code of ["V02", "V03", "V04", "V06", "V10", "V13", "V15"]) expect(codes).toContain(code);
    expect(v.errors.some(e => e.includes("Odile Fournier"))).toBe(true);
    const banned = modelAnswer(draw);
    banned.members[0]!.backstory += " Ran a shop on the internet.";
    const v2 = validateHousehold(banned, draw, { ...vctx, banned: t => (/internet/i.test(t) ? ["modern_tech"] : []) });
    expect(v2.ok ? [] : v2.errors.map(e => e.slice(0, 3))).toContain("V16");
  });

  it("cuts a backstory a little over 120 words at a sentence, and fails one far over", () => {
    const long = modelAnswer(draw);
    long.members[0]!.backstory = `${"Word ".repeat(118).trim()}. Another short sentence here.`;
    const v = validateHousehold(long, draw, vctx);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.output.members[0]!.backstory.split(/\s+/).length).toBeLessThanOrEqual(120);
    long.members[0]!.backstory = `${"Word ".repeat(200).trim()}.`;
    expect(validateHousehold(long, draw, vctx).ok).toBe(false);
  });
});

describe("cards and the template fallback (A.3.6 engine keys, A.3.8)", () => {
  it("templates pass the validator for every archetype the town can draw", () => {
    for (let slot = 0; slot < 40; slot++) {
      const d = drawHousehold(ctx({ slot, youthShare: (slot % 3) / 2 }))!;
      const v = validateHousehold(templateHousehold(d, vctx, 3), d, vctx);
      expect(v.ok ? [] : [d.archetype, ...v.errors]).toEqual([]);
    }
  });

  it("assembles valid arrival cards: library portrait and its look, the home bound, kin ties, unique ids", () => {
    const d = drawHousehold(ctx({ archetype: "young_family" }))!;
    const out = templateHousehold(d, vctx, 3);
    const taken = new Set([residentIdFor(out.members[0]!.name, new Set())]);
    const built = cardsFromHousehold(out, d, taken, "old_quarter.vacant_house_47");
    expect(built.length).toBe(d.members.length);
    for (const [i, b] of built.entries()) {
      expect(PersonaCard.safeParse(b.card).success).toBe(true);
      expect(b.card).toMatchObject({ kind: "arrival", home: "old_quarter.vacant_house_47", portrait: d.members[i]!.portrait, canon_locks: [] });
      expect(b.card.look).toEqual(portraitById(d.members[i]!.portrait)!.look);
      expect(JSON.stringify(b.card.routine)).not.toContain(HOME_TOKEN);
      expect(b.card.relationships.filter(r => built.some(o => o.card.id === r.id)).length).toBe(built.length - 1);
    }
    expect(built[0]!.card.id).toMatch(/_2$/);
    expect(new Set(built.map(b => b.card.id)).size).toBe(built.length);
  });

  it("never takes a reserved or living name, and prints the paper's line", () => {
    for (let slot = 0; slot < 40; slot++) {
      const d = drawHousehold(ctx({ slot }))!;
      for (const m of templateHousehold(d, vctx, slot).members) {
        expect(["Odile", "Edwina", "June", "Juniper", "Robin", "Ada"]).not.toContain(m.name.split(" ")[0]);
        expect(m.name.split(" ").at(-1)).not.toBe("Fournier");
      }
    }
    const d = drawHousehold(ctx({ archetype: "retired_couple" }))!;
    const built = cardsFromHousehold(templateHousehold(d, vctx, 1), d, new Set(), "old_quarter.vacant_house_47");
    const h = { id: d.id, archetype: d.archetype, day: 8, home: "old_quarter.vacant_house_47", summary: "", generated_by: "template" as const,
      residents: built.map(b => ({ card: b.card, household: d.id, archetype: d.archetype, arrived_day: 8, dream_template: b.dream_template })) };
    expect(householdLine(h, "No. 47 Lamplighter Lane")).toMatch(/^[A-Z][\p{L}' -]+, \d+, [a-z ]+, has taken No\. 47 Lamplighter Lane, with [A-Z]\p{L}+ \(\d+\)\.$/u);
    expect(firstArrival({ households: [], pending: [h], leaving: [], departed: [], unsynced: [], stayed: [] }, 8)!.card.id).toBe(built[0]!.card.id);
  });
});
