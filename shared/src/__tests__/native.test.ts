// MVP M-03 step 2, the shared half: the Day-1 card prompt (A.3.6 with MODE: native), the census's validation profile
// (each rule that differs from an arrival's), the card assembly (ids, kin and spouse ties) and the native template card.
import { describe, expect, it } from "vitest";
import {
  ARRIVAL_SYSTEM_PROMPT, ArrivalHouseholdOutput, MONDE_DAY1_BLOCK, NATIVE_SYSTEM_BLOCKS, NativeDrawSchema, NativePromptContextSchema, PersonaCard,
  WHIMS, assignedWorkplace, cardProblems, cardsFromHousehold, censusOrder, fourWordOverlap, nativeContextFor, nativeDrawFor, nativeMaxTokens,
  nativeTemplateHousehold, nativeUserMessage, nativeValidationContext, portraitById, validateHousehold, whimFor, type CensusInput, type SkeletonHousehold,
} from "../index";
import { censusInput, findHousehold, handCards, household, modelAnswer } from "./censusFixtures";

const writes = (m: { kind: string }) => m.kind === "named" || m.kind === "anonymous";
const setup = (id: string | ((h: SkeletonHousehold) => boolean), input: CensusInput = censusInput()) => {
  const h = typeof id === "string" ? household(input, id) : findHousehold(input, id);
  const draw = nativeDrawFor(input, h);
  const vctx = nativeValidationContext(input, h, draw);
  return { input, h, draw, vctx };
};
const codes = (v: ReturnType<typeof validateHousehold>) => (v.ok ? [] : v.errors);

describe("the native prompt (A.3.6, MODE: native)", () => {
  it("is A.3.6's layout for a named Day-1 household: Day 1, the Pillars, the real home, the work, the names, the ties, the seed", async () => {
    const { input, h, draw } = setup("dunmore_barney");
    const msg = nativeUserMessage(draw, nativeContextFor(input, h, draw, whimFor(input.skeleton.seed, h.id, 1)));
    await expect(msg).toMatchFileSnapshot("./__snapshots__/native-prompt.dunmore_barney.txt");
    expect(msg.split("\n").slice(0, 4)).toEqual([
      "DAY 1 · Spring · Tuesday", "PILLARS: prosperity 18, safety 30, spirit 22, charm 25",
      "TOWN: census 210; shops open 6; school pupils 9; projects done: none; in progress: none", "MODE: native",
    ]);
    expect(msg).toContain("HOME: market_row.dunmore_flat, the flat over Dunmore's");
    expect(msg).toContain("work: counter clerk (Dunmore's General Store), at market_row.general_store");
    expect(msg).toContain('name: Barnaby "Barney" Dunmore (canon: write it exactly)');
    expect(msg).toMatch(/REQUIRED TIES .*m1 → nell \(Nell Dunmore\), tag kin/);
    expect(msg).toMatch(/m1 → bru \(Bru Haskett\): Bru Haskett's card ties to them as "embarrassed" \(affinity 40, trust 35\); return it/);
    expect(msg).toMatch(/SEED .*Hands the Tollmen 20 coins/);
    expect(msg).toContain("Kin: nell (Nell Dunmore).");
    expect(WHIMS).toContain(/WHIM: (.+)/.exec(msg)![1]);
    expect(msg).not.toMatch(/§|A\.1\.|Greyline/);
    expect(msg).toContain("OUTPUT CONTRACT");
    expect(msg).toContain('"workplace": "<place id from workplace options> | market_row.dunmore_flat | null"');
    expect(msg).not.toContain("home.own");
  });

  it("gives every member six first names and the surname, years in Monde, and the engine's day for a pupil", async () => {
    const { input, h, draw } = setup("szabo_maud");
    const msg = nativeUserMessage(draw, nativeContextFor(input, h, draw, "a kite with no tail"));
    await expect(msg).toMatchFileSnapshot("./__snapshots__/native-prompt.szabo_maud.txt");
    const m1 = draw.members[0]!.native!;
    expect(m1.first_names).toHaveLength(6);
    expect(msg).toContain(`name: a first name from ${m1.first_names.join(", ")}; surname Szabo (use one, or invent if none fits)`);
    expect(msg).toContain("in Monde: born here");
    expect(msg).toContain("routine: the engine writes this child's day");
    expect(msg).toContain("Kin: nettie (Nettie Szabo), ilona (Ilona Szabo).");
  });

  it("caches A.3.6's exact system prompt and MONDE ON DAY 1, which says nothing secret", async () => {
    expect(NATIVE_SYSTEM_BLOCKS).toEqual([ARRIVAL_SYSTEM_PROMPT, MONDE_DAY1_BLOCK]);
    await expect(MONDE_DAY1_BLOCK).toMatchFileSnapshot("./__snapshots__/monde-day1-block.txt");
    for (const fact of ["14 years ago", "11 years ago", "9 years ago", "4:17", "every Saturday", "26 years"]) expect(MONDE_DAY1_BLOCK.toLowerCase()).toContain(fact.toLowerCase());
    expect(MONDE_DAY1_BLOCK).not.toMatch(/option|loan|greyline|charter|vane/i);
    // About 400 tokens (a token is about four characters of English).
    expect(MONDE_DAY1_BLOCK.length / 4).toBeLessThan(560);
  });

  it("is what the census endpoint accepts, and asks for 1,500 + 1,200 × size tokens", () => {
    for (const h of censusOrder(censusInput().skeleton, censusInput().homes, censusInput().pins)) {
      const input = censusInput();
      const draw = nativeDrawFor(input, household(input, h.id));
      expect(NativeDrawSchema.safeParse(draw).success, h.id).toBe(true);
      expect(NativePromptContextSchema.safeParse(nativeContextFor(input, household(input, h.id), draw, "w")).success, h.id).toBe(true);
    }
    expect(nativeMaxTokens(3)).toBe(5100);
  });

  it("knows six to ten people: the required ties, colleagues, the cast in the zone", () => {
    const { input, h, draw } = setup("cobb");
    const ctx = nativeContextFor(input, h, draw, "w");
    expect(ctx.knownResidents.length).toBeGreaterThanOrEqual(6);
    expect(ctx.knownResidents.length).toBeLessThanOrEqual(10);
    expect(ctx.knownResidents.map(r => r.id)).not.toContain("cobb");
  });
});

describe("the native validation profile (A.3.7, each difference GDD-GAP)", () => {
  it("accepts a well-written Day-1 household", () => {
    for (const id of ["dunmore_barney", "szabo_maud", "calloway", "pub_rooms", "ramaswamy"]) {
      const { input, h, draw, vctx } = setup(id);
      expect(codes(validateHousehold(modelAnswer(input, h, draw), draw, vctx)), id).toEqual([]);
    }
  });

  it("V02/V03: a canon name is the engine's; an invented one must not be another household's surname", () => {
    const { input, h, draw, vctx } = setup("dunmore_barney");
    const out = modelAnswer(input, h, draw);
    out.members[0]!.name = "Barney Dunmore";
    const v = validateHousehold(out, draw, vctx);
    expect(v.ok && v.output.members[0]!.name).toBe('Barnaby "Barney" Dunmore');
    expect(v.ok && v.warnings.some(w => w.startsWith("V03"))).toBe(true);
    // Maud's father is a Szabo: the household's own surname (reserved for the canon Szabos) is allowed.
    const maud = setup("szabo_maud");
    expect(codes(validateHousehold(modelAnswer(maud.input, maud.h, maud.draw), maud.draw, maud.vctx))).toEqual([]);
    const other = modelAnswer(maud.input, maud.h, maud.draw);
    other.members[0]!.name = `${maud.draw.members[0]!.native!.first_names[0]} Fournier`;
    expect(codes(validateHousehold(other, maud.draw, maud.vctx))).toEqual(expect.arrayContaining([expect.stringMatching(/^V03 .*surname "Fournier" belongs to another household/)]));
    // A surname the census gave a household not written yet is that household's too.
    const theirs = maud.input.skeleton.households.find(x => x.id === "mb_a01")!.surname!;
    other.members[0]!.name = `${maud.draw.members[0]!.native!.first_names[0]} ${theirs}`;
    expect(codes(validateHousehold(other, maud.draw, maud.vctx))).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^V03 .*surname "${theirs}" belongs to another household`))]));
  });

  it("V04: the census age is kept whatever the model writes", () => {
    const { input, h, draw, vctx } = setup("szabo_maud");
    const out = modelAnswer(input, h, draw);
    out.members[1]!.age = 12;
    const v = validateHousehold(out, draw, vctx);
    expect(v.ok && v.output.members[1]!.age).toBe(9);
  });

  it("V11: two likes from the archetype's list or the gift catalog", () => {
    const { input, h, draw, vctx } = setup("dunmore_barney");
    const out = modelAnswer(input, h, draw);
    out.members[0]!.likes = ["warm bread on a cold morning", "strong tea", "a quiet till"];
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([]);
    out.members[0]!.likes = ["pigeons", "puzzles", "a quiet till"];
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([expect.stringMatching(/^V11 members\[0\]\.likes: at least two/)]);
  });

  it("V13: the workplace is the one A.1.4 assigned, and work happens only there", () => {
    const { input, h, draw, vctx } = setup("dunmore_barney");
    const out = modelAnswer(input, h, draw);
    out.members[0]!.workplace = "market_row.cafe_liss";
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(expect.arrayContaining([expect.stringMatching(/^V13 members\[0\]\.workplace "market_row\.cafe_liss" must be market_row\.general_store/)]));
    const work = modelAnswer(input, h, draw);
    work.members[0]!.routine.weekday[1] = { at: "08:30", do: "work", where: "market_row.bakery" };
    expect(codes(validateHousehold(work, draw, vctx))).toEqual(expect.arrayContaining([expect.stringMatching(/work at "market_row\.bakery"; their work is at market_row\.general_store/)]));
  });

  it("V13: a commuter's weekdays are at offmap.city; nobody else goes there", () => {
    const { input, h, draw, vctx } = setup(x => x.members.some(m => writes(m) && m.job?.row === 24));
    const slot = draw.members.findIndex(m => m.native?.job?.row === 24);
    expect(assignedWorkplace(draw.members[slot]!, h.home)).toBe("offmap.city");
    expect(codes(validateHousehold(modelAnswer(input, h, draw), draw, vctx))).toEqual([]);
    const home = modelAnswer(input, h, draw);
    home.members[slot]!.routine.weekday = home.members[slot]!.routine.weekend;
    expect(codes(validateHousehold(home, draw, vctx))).toEqual(expect.arrayContaining([`V13 members[${slot}].routine.weekday: a commuter works at offmap.city on weekdays`]));
    const away = modelAnswer(input, h, draw);
    away.members[slot]!.routine.weekend[3] = { at: "14:30", do: "wander", where: "offmap.city" };
    expect(codes(validateHousehold(away, draw, vctx))).toEqual(expect.arrayContaining([expect.stringMatching(/only a commuter's weekdays go to offmap\.city/)]));
  });

  it("V13n: a Millbrook or Station Hill resident of 13 or more spends a weekday and a weekend block on an open board", () => {
    const pick = (x: SkeletonHousehold) => x.zone === "millbrook" && x.members.some(m => writes(m) && m.age >= 13 && m.age < 85 && m.job?.row !== 24 && m.minor !== "pupil");
    const { input, h, draw, vctx } = setup(pick);
    const i = draw.members.findIndex(m => m.age >= 13 && m.age < 85 && m.native?.job?.row !== 24 && m.native?.minor !== "pupil");
    const home = h.home;
    const out = modelAnswer(input, h, draw);
    const stay = [{ at: "08:00", do: "eat" as const, where: home }, { at: "10:00", do: "walk" as const, where: "millbrook.weir" }, { at: "12:30", do: "eat" as const, where: home }, { at: "15:00", do: "sit" as const, where: "millbrook.laundry_green" }, { at: "21:00", do: "sleep" as const, where: home }];
    if (!draw.members[i]!.native!.job) out.members[i]!.routine = { weekday: stay, weekend: stay };
    else out.members[i]!.routine.weekend = stay;
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^V13n members\\[${i}\\]\\.routine\\.weekend needs at least one block on an open board`))]));
    // The housebound (85 and over) are exempt.
    const old = structuredClone(draw);
    old.members[i]!.age = 88;
    const o = modelAnswer(input, h, draw);
    o.members[i]!.age = 88;
    o.members[i]!.routine.weekend = stay;
    expect(codes(validateHousehold(o, old, vctx)).filter(e => e.startsWith("V13n"))).toEqual([]);
  });

  it("V13: pupils and under-fives live the engine's school day, whatever the model writes", () => {
    const { input, h, draw, vctx } = setup("szabo_maud");
    const out = modelAnswer(input, h, draw);
    const nowhere = [{ at: "09:00", do: "sit" as const, where: "carrow.docks" }];
    out.members[1]!.routine = { weekday: nowhere, weekend: nowhere };
    const v = validateHousehold(out, draw, vctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.output.members[1]!.routine.weekday).toEqual(expect.arrayContaining([{ at: "08:30", do: "attend", where: "millbrook.school" }]));
    expect(v.output.members[1]!.routine.weekday[0]!.where).toBe("millbrook.home_07");
  });

  it("V14: ties outside the household run to ±60, and the required ties must be there", () => {
    const { input, h, draw, vctx } = setup("dunmore_barney");
    const out = modelAnswer(input, h, draw);
    out.members[0]!.relationships.push({ id: "odile", affinity: 55, trust: -45, tag: "fond", note: "Buys her rye on credit." });
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([]);
    out.members[0]!.relationships.at(-1)!.affinity = 61;
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([expect.stringMatching(/^V14 .*"odile": affinity and trust must be integers within ±60/)]);
    const missing = modelAnswer(input, h, draw);
    missing.members[0]!.relationships = missing.members[0]!.relationships.filter(r => r.id !== "nell");
    expect(codes(validateHousehold(missing, draw, vctx))).toEqual([expect.stringMatching(/^V14 members\[0\]\.relationships must include nell \(Nell Dunmore\)/)]);
    const untagged = modelAnswer(input, h, draw);
    untagged.members[0]!.relationships.find(r => r.id === "nell")!.tag = "fond";
    expect(codes(validateHousehold(untagged, draw, vctx))).toEqual(['V14 members[0].relationships "nell" must be tagged kin']);
  });

  it("V19: a backstory under 35% four-word overlap with the last 30 of its archetype", () => {
    const { input, h, draw } = setup("dunmore_barney");
    const out = modelAnswer(input, h, draw);
    const story = out.members[0]!.backstory;
    expect(fourWordOverlap(story, [story])).toBe(1);
    expect(fourWordOverlap(story, ["Something else entirely about the harbour and its gulls."])).toBe(0);
    const vctx = { ...nativeValidationContext(input, h, draw), recentBackstories: new Map([["shop_founder", [story]]]) };
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([expect.stringMatching(/^V19 members\[0\]\.backstory repeats 100% of its four-word runs from recent shop_founder cards/)]);
    // Only the same archetype counts, and only the last 30.
    expect(codes(validateHousehold(out, draw, { ...vctx, recentBackstories: new Map([["fisher", [story]]]) }))).toEqual([]);
    expect(codes(validateHousehold(out, draw, { ...vctx, recentBackstories: new Map([["shop_founder", [story, ...Array.from({ length: 30 }, (_, i) => `Story ${i} of the harbour.`)]]]) }))).toEqual([]);
  });
});

describe("building the Day-1 cards (A.3.6's engine keys, native)", () => {
  const build = (id: string | ((h: SkeletonHousehold) => boolean)) => {
    const { input, h, draw, vctx } = setup(id);
    const v = validateHousehold(modelAnswer(input, h, draw), draw, vctx);
    if (!v.ok) throw new Error(v.errors.join("; "));
    return { h, draw, cards: cardsFromHousehold(v.output, draw, new Set(handCards.map(c => c.id)), h.home, { profile: "native", generatedBy: "model" }).map(b => b.card) };
  };

  it("keeps a named person's id, names the rest from their names, and writes the census's facts", () => {
    const { h, draw, cards } = build("dunmore_barney");
    const [barney] = cards;
    expect(barney).toMatchObject({
      id: "barney", name: 'Barnaby "Barney" Dunmore', age: 51, kind: "resident", home: "market_row.dunmore_flat", workplace: "market_row.general_store",
      generated_by: "model", household: "dunmore_barney", archetype: "shop_founder", employment: "employed", canon_locks: [],
    });
    expect(barney!.portrait).toBe(draw.members[0]!.portrait);
    expect(barney!.look).toEqual(portraitById(draw.members[0]!.portrait)!.look);
    expect(barney!.birthday).toBe(h.members[0]!.birthday);
    expect(PersonaCard.safeParse(barney).success).toBe(true);
    const anon = build(x => x.members.length === 1 && x.members[0]!.kind === "anonymous" && x.members[0]!.portrait.source === "procedural");
    const c = anon.cards[0]!;
    expect(c.id).toMatch(/^[a-z]+_[a-z_]+$/);
    expect(c.portrait).toBe(c.id);
    expect(c.look).toEqual(anon.draw.members[0]!.look);
    expect(JSON.stringify(c)).not.toContain("home.own");
  });

  it("ties a household together by its roles: spouses and partners, parents and children, twins and cousins", () => {
    const tag = (cards: PersonaCard[], from: number, to: number) => cards[from]!.relationships.find(r => r.id === cards[to]!.id)?.tag;
    const same = build(x => x.type === "B" && x.members[0]!.surname === x.members[1]!.surname);
    expect([tag(same.cards, 0, 1), tag(same.cards, 1, 0)]).toEqual(["spouse", "spouse"]);
    const apart = build(x => (x.type === "B" || x.type === "E") && x.members[0]!.surname !== x.members[1]!.surname);
    expect([tag(apart.cards, 0, 1), tag(apart.cards, 1, 0)]).toEqual(["partner", "partner"]);
    const maud = build("szabo_maud");
    const parentWord = { "she/her": "mother", "he/him": "father", "they/them": "parent" }[maud.cards[0]!.pronouns]!;
    expect(tag(maud.cards, 1, 0)).toBe(parentWord);
    expect(tag(maud.cards, 0, 1)).toBe("daughter");
    expect(["sister", "brother", "sibling"]).toContain(tag(maud.cards, 1, 2));
    expect(maud.cards[1]!.relationships.find(r => r.id === "nettie")?.tag).toBe("kin");
    const calloway = build("calloway");
    expect([tag(calloway.cards, 0, 1), tag(calloway.cards, 1, 0)]).toEqual(["twin", "twin"]);
    expect([tag(calloway.cards, 2, 0), tag(calloway.cards, 0, 2)]).toEqual(["cousin", "cousin"]);
    // A housemate whose card exists: Raman and his daughter Priya.
    const raman = build("ramaswamy");
    expect(raman.cards[0]!.relationships.find(r => r.id === "priya")?.tag).toBe("daughter");
    const lodger = build("pub_rooms");
    expect(lodger.cards[0]!.relationships.filter(r => r.id === "june" || r.id === "ines").map(r => r.tag)).toEqual(["flatmate", "flatmate"]);
  });
});

describe("the native template card (A.3.8)", () => {
  it("passes the native validator for every Day-1 household and builds cards flagged template", () => {
    const input = censusInput();
    for (const h of censusOrder(input.skeleton, input.homes, input.pins)) {
      const draw = nativeDrawFor(input, h);
      const vctx = nativeValidationContext(input, h, draw, { novelty: false });
      const out = nativeTemplateHousehold(draw, vctx, input.skeleton.seed);
      expect(ArrivalHouseholdOutput.safeParse(out).success).toBe(true);
      const v = validateHousehold(out, draw, vctx);
      expect(v.ok ? [] : [h.id, ...v.errors]).toEqual([]);
      if (!v.ok) continue;
      const cards = cardsFromHousehold(v.output, draw, new Set(handCards.map(c => c.id)), h.home, { profile: "native", generatedBy: "template" }).map(b => b.card);
      for (const c of cards) {
        expect(PersonaCard.safeParse(c).success, c.id).toBe(true);
        expect(c.generated_by).toBe("template");
        expect(cardProblems(c, { canonName: c.id in input.pins.people, household: new Set([...cards.map(x => x.id), ...h.members.map(m => m.id ?? "")]) }), c.id).toEqual([]);
      }
      expect(cards.length).toBe(h.members.filter(writes).length);
    }
  });
});
