// MVP Q-01, second pass, from the 2026-10-16 live eval: the Fellow's pronouns, Monde's money, how the town stands
// (the clocktower), card samples lifted near-verbatim, June's leaving tic, Margo borrowing "Right.", never_says on
// model and authored lines, and riddle hints asked for twice.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  DialogueTurnOutput, LIMITS, ResidentState, SPRING_RIDDLES, containsAnswer, modelOutputFormat, type PersonaCard,
} from "@monde/shared";
import { loadContent } from "../../content/loadContent.js";
import { generateTurn } from "../dialogue.js";
import {
  FALLBACK_LINES, GIFT_LINES, MET_LINES, MOMENT_LINES, STUMPED_LINE, authoredHint, fallbackTurn, giftLine, speakable,
  type FallbackInput,
} from "../fallback.js";
import { currencyHit, lexicalHits } from "../filters.js";
import { validateLiveGossip } from "../liveGossip.js";
import type { ResidentPrefix } from "../context.js";
import { fellowLine, misgenderHit, pronounRule } from "../naming.js";
import {
  buildDialogueRequest, buildGossipRequest, buildPlanRequest, buildReflectRequest, personaBlock, worldBible, type DialogueInput,
} from "../promptBuilder.js";
import { loadRiddleLeads, riddleHintText, riddleLeadIn, trailsOff } from "../riddleLeads.js";
import { RIDDLES } from "../riddles.js";
import { townFacts } from "../townState.js";
import {
  cardVocabulary, correctiveNote, neverSaysHit, sampleEcho, sharedRuns, validateTurn, type ValidationContext,
} from "../validate.js";
import { borrowedFor, borrowedHits, exitOnlyTics, ownSignatures, stripTics, type RosterVoice } from "../voice.js";
import { FakeMind } from "./fakeMind.js";

let cards: PersonaCard[];
let roster: RosterVoice[];
const card = (id: string): PersonaCard => cards.find((c) => c.id === id)!;
beforeAll(async () => {
  cards = await loadContent();
  roster = cards.map((c) => ({ id: c.id, kind: c.kind, tics: c.voice.tics })).sort((a, b) => (a.id < b.id ? -1 : 1));
});
const speaking = () => cards.filter((c) => c.voice.mode !== "narrated_action");
const samplesOf = (id: string): string[] => { const voice = card(id).voice; return voice.mode === "narrated_action" ? [] : voice.samples; };
const WREN = { name: "Wren", pronouns: "she/her" };

function turn(lines: string[], wrapUp = false): DialogueTurnOutput {
  return {
    lines: lines.map((text) => ({ text, expr: "warm" })),
    choices: [{ id: "a", text: "Go on.", intent: "curious" }, { id: "b", text: "I'll sit.", intent: "kind" }],
    effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "the cafe" },
    wrap_up: wrapUp,
  };
}
/** The validation context context.ts builds for a resident talking with Wren. */
const vctx = (id: string, extra: Partial<ValidationContext> = {}): ValidationContext => {
  const c = card(id);
  return {
    card: c, emotion: "content", revealable: new Set(), riddle: null, recentLines: [],
    borrowed: borrowedFor(c, roster), own: ownSignatures(c, roster),
    samples: c.voice.mode === "narrated_action" ? [] : c.voice.samples, vocabulary: cardVocabulary(c),
    neverSays: c.voice.mode === "narrated_action" ? [] : c.voice.never_says,
    fellow: WREN, exitOnly: exitOnlyTics(c), exit: false, ...extra,
  };
};
const check = (lines: string[], ctx: ValidationContext, wrapUp = false) => validateTurn(JSON.stringify(turn(lines, wrapUp)), ctx);

const state = (c: PersonaCard, overrides: Partial<ResidentState> = {}): ResidentState => ResidentState.parse({
  id: c.id, world_id: "w", tier: "core", mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 0 },
  needs: { rest: 70, food: 70, social: 70, purpose: 70, comfort: 70 }, regard: 10, stances: {}, beliefs: c.beliefs,
  recent_topics: [], dream: { stage: 0, notes: "" }, stay: 50, leaving_notice_since: null, location: null, flags: [], ...overrides,
});
const dialogueInput = (c: PersonaCard, extra: Partial<DialogueInput> = {}): DialogueInput => ({
  card: c, state: state(c), relationships: c.relationships, flags: [], voices: roster,
  scene: { day: 2, weekday: "Wed", minute: 600, place: "market_row.bakery", weather: "clear" },
  player: { name: "Wren", pronouns: "she/her", background: "Tinkerer: fixes things" }, memories: [], topics: [],
  playerSaid: "Did I tell you what I was hoping to fix?", ...extra,
});
const userText = (req: ReturnType<typeof buildDialogueRequest>): string => {
  const content = req.messages.at(-1)!.content;
  if (typeof content !== "string") throw new Error("expected a string user message");
  return content;
};

// ---------------------------------------------------------------------------------------------------------------
// 1. Pronouns
// ---------------------------------------------------------------------------------------------------------------

describe("the Fellow's pronouns", () => {
  it("are spelled out in one sentence for every pronoun set", () => {
    expect(pronounRule("she/her")).toBe('Words for her are "she" and "her": never "he", "him", "his", "a man", "lad" or "sir".');
    expect(pronounRule("he/him")).toBe('Words for him are "he", "him" and "his": never "she", "her", "a woman", "lass" or "madam".');
    expect(pronounRule("they/them")).toBe('Words for them are "they", "them" and "their": never "he", "she", "a man", "a woman", "lad" or "lass".');
    expect(pronounRule("xe/xem/xyr")).toBe('Words for xem are "xe", "xem" and "xyr": never "he", "she", "a man", "a woman", "lad" or "lass".');
    expect(fellowLine(WREN)).toBe(`The Fellow is Wren. ${pronounRule("she/her")}`);
    expect(fellowLine({ name: "Fellow", pronouns: "they/them" })).toMatch(/^The Fellow hasn't given a name yet\. Words for them/);
  });

  it("reach the dialogue's <player> line, never blocks 1-3", () => {
    const odile = card("odile");
    const she = buildDialogueRequest(dialogueInput(odile));
    const he = buildDialogueRequest(dialogueInput(odile, { player: { name: "Wren", pronouns: "he/him", background: "Tinkerer: fixes things" } }));
    expect(userText(she)).toContain(`<player> Name: Wren (she/her). ${pronounRule("she/her")} Your regard:`);
    expect(userText(he)).toContain(pronounRule("he/him"));
    expect(JSON.stringify(he.system)).toBe(JSON.stringify(she.system));
    expect(JSON.stringify(she.system)).not.toContain("Words for her");
    expect(worldBible()).toContain("or guessed pronouns: call the Fellow what <player> says");
  });

  it("reach the plan, the reflection and live gossip, in block 4 only", () => {
    const odile = card("odile");
    const base = { card: odile, state: state(odile), relationships: odile.relationships, flags: [], voices: roster, day: 2 };
    const plan = (fellow?: typeof WREN) => buildPlanRequest({
      ...base, tomorrowWeekday: "Thu", forecast: "fair", events: [], intentions: [], openPlaces: [{ id: "market_row.bakery" }], fellow,
    });
    const reflect = (fellow?: typeof WREN) => buildReflectRequest({
      ...base, memoriesToday: [], town: { pillars: { prosperity: 20, safety: 20, spirit: 20, charm: 20 }, census: 200, events: [] }, fellow,
    });
    const gossip = (fellow?: typeof WREN) => buildGossipRequest({
      a: { card: odile, view: null, news: [] }, b: { card: card("june"), view: null, news: [] },
      flags: [], day: 2, weekday: "Wed", minute: 600, place: "market_row.bakery", mode: "live", fellow,
    });
    for (const build of [plan, reflect, gossip]) {
      const withFellow = build(WREN);
      expect(String(withFellow.messages[0]!.content)).toContain(fellowLine(WREN));
      expect(String(build().messages[0]!.content)).not.toContain("The Fellow is");
      expect(JSON.stringify(withFellow.system)).toBe(JSON.stringify(build().system));
    }
  });

  it("are checked where a wrong word is tied to 'you'", () => {
    const hit = (text: string, fellow = WREN) => misgenderHit(text, fellow);
    expect(hit("Sit down, lad.")).toBe("lad");
    expect(hit("Morning, sir?")).toBe("sir");
    expect(hit("Lad, sit down.")).toBe("Lad");
    expect(hit("You're a handy lad, I'll give you that.")).toBe("You're a handy lad");
    expect(hit("You look like a man who knows his clocks.")).toBe("You look like a man");
    expect(hit("A clever lad like you could fix that door.")).toBe("A clever lad like you");
    expect(hit("Eat something, petit.")).toBe("petit");
    expect(hit("Thank you, Mr. Wren.")).toBe("Mr. Wren");
    expect(hit("Sit down, lass.", { name: "Wren", pronouns: "he/him" })).toBe("lass");
    expect(hit("You're a good lad.", { name: "Wren", pronouns: "he/him" })).toBeNull();
    expect(hit("You're a fine woman.", { name: "Wren", pronouns: "they/them" })).toBe("You're a fine woman");
    expect(hit("Eat something, petit.", { name: "Wren", pronouns: "they/them" })).toBeNull();
  });

  it("let 'he' and 'she' about everyone else alone", () => {
    for (const line of [
      "Hollis? He's on the platform by six.", "Tib's a good lad, mind.", "You'll want the lad at the quay.",
      "Ask the man at the fish market.", "You were looking for a man called Hollis?", "Eat something, petite.",
      "Sit, petite, if you're staying.", "Margo's a woman who keeps her word.", "You and the lad from the quay, then.",
      "Mister Achterberg winds it on Sundays.", "Her son, Rook, was at the door.", "I'd miss it, the old oven.",
    ]) expect(misgenderHit(line, WREN), line).toBeNull();
  });

  it("regenerate once with a note naming the right words, and the slip never streams", async () => {
    const ctx = vctx("odile");
    const wrong = turn(["(Slides a heel across.) I'd not say no to a handy lad. Eat something, petit."]);
    const right = turn(["(Slides a heel across.) Clocks, is it. Eat something, petite."]);
    expect(validateTurn(JSON.stringify(wrong), ctx)).toMatchObject({ ok: false, category: "misgender", detail: '"petit" (she/her)' });
    const mind = new FakeMind([{ output: wrong, chunk: 6 }, { output: right }]);
    const streamed: string[] = [];
    const request = { system: [], messages: [{ role: "user" as const, content: "<player_said> Hi. </player_said>" }], output_config: { format: modelOutputFormat(DialogueTurnOutput) } };
    const result = await generateTurn({ mind, request, validation: ctx, onLineDelta: (d) => streamed.push(d.text_so_far) });
    expect(result.output!.lines[0]!.text).toBe(right.lines[0]!.text);
    expect(result.calls.map((c) => c.validation)).toEqual(["misgender", "ok"]);
    const note = (mind.streams[1]!.messages.at(-1)!.content as { text: string }[]).at(-1)!.text;
    expect(note).toBe(correctiveNote("misgender", '"petit" (she/her)'));
    expect(note).toContain(pronounRule("she/her"));
    expect(streamed.some((t) => /\bpetit\b/.test(t))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Money
// ---------------------------------------------------------------------------------------------------------------

describe("Monde's money is coins", () => {
  it("flags money that isn't Monde's", () => {
    for (const [line, term] of [
      ["Every shilling goes to the lamps.", "shilling"], ["That's five pounds, dear.", "five pounds"], ["Not a penny more.", "penny"],
      ["Ten pence the loaf.", "pence"], ["Fifty cents, if you're asking.", "cents"], ["Two dollars, mind.", "dollars"],
      ["A quid says it rains.", "quid"], ["It's £5 at the hatch.", "£5"], ["A pound a week, the Tollmen want.", "A pound"],
      ["Pennies, all of it.", "Pennies"], ["Not a cent from the Fund.", "Not a cent"],
    ] as const) expect(currencyHit(line), line).toBe(term);
  });

  it("leaves weight, idiom and Monde's coins alone", () => {
    for (const line of [
      "Rye's two coins, white's three.", "Twenty coins every Saturday.", "A pound of rye flour, please.", "It weighs two pounds.",
      "Two pounds of butter and a pound cake.", "June's penny whistle.", "Then the penny dropped.", "Ten per cent of the till.",
      "The guinea fowl got out again.", "Pound the dough flat.", "Every coin counts.",
    ]) expect(currencyHit(line), line).toBeNull();
  });

  it("regenerates once with a coins note (Pell's 'every shilling'), and the World Bible says so", () => {
    expect(check(["Heavens. Every shilling of it goes on the lamps. Now. Lamplighter Lane."], vctx("pell")))
      .toMatchObject({ ok: false, category: "currency", detail: '"shilling"' });
    expect(correctiveNote("currency", '"shilling"')).toBe('"shilling" isn\'t Monde money. Money here is coins: "two coins", "every coin". Say it again.');
    expect(worldBible()).toContain("Money is coins, never pounds or shillings.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. How the town stands
// ---------------------------------------------------------------------------------------------------------------

describe("the town now (story flags)", () => {
  it("always says whether the clocktower is stopped, chimed once or running", () => {
    expect(townFacts([])).toEqual(["The clocktower is stopped at 4:17, as it has been for fourteen years. It doesn't tell the time."]);
    expect(townFacts(["clock_chimed", "clock_pending_pinion"])[0]).toMatch(/^The clocktower struck once at the Quarter Chime, then stopped again at 4:18/);
    expect(townFacts(["clock_chimed", "clock_running"])).toEqual(["The clocktower runs again: it keeps the time and strikes the hour."]);
    expect(townFacts(["flag.clock_running"])[0]).toMatch(/runs again/);
    expect(townFacts(["project_clocktower_done"])[0]).toMatch(/runs again/);
  });

  it("adds a World Bible fact only once a flag overturns it", () => {
    expect(townFacts(["project_fountain_done", "project_lighthouse_done"])).toEqual([
      "The clocktower is stopped at 4:17, as it has been for fourteen years. It doesn't tell the time.",
      "The fountain in Fountain Square runs again.", "Point Lumière is lit again; its beam turns at night.",
    ]);
    expect(townFacts(["met_pell", "s01a_done"])).toHaveLength(1);
  });

  it("reaches every resident request in block 4, so blocks 1-3 don't change with the clock", () => {
    const odile = card("odile");
    const stopped = buildDialogueRequest(dialogueInput(odile));
    const running = buildDialogueRequest(dialogueInput(odile, { flags: ["clock_chimed", "clock_running"] }));
    expect(userText(stopped)).toContain("<town_now> The clocktower is stopped at 4:17");
    expect(userText(running)).toContain("<town_now> The clocktower runs again");
    expect(userText(stopped).indexOf("<town_now>")).toBeGreaterThan(userText(stopped).indexOf("</scene>"));
    // Odile has no clock canon lock, so nothing else about her prompt prefix moves.
    expect(JSON.stringify(running.system)).toBe(JSON.stringify(stopped.system));
    const plan = buildPlanRequest({ card: odile, state: state(odile), relationships: [], flags: ["clock_running"], day: 2,
      tomorrowWeekday: "Thu", forecast: "fair", events: [], intentions: [], openPlaces: [] });
    expect(String(plan.messages[0]!.content)).toContain("<town_now> The clocktower runs again");
    const gossip = buildGossipRequest({ a: { card: odile, view: null, news: [] }, b: { card: card("june"), view: null, news: [] },
      flags: [], day: 2, weekday: "Wed", minute: 600, place: "market_row.bakery", mode: "live" });
    expect(String(gossip.messages[0]!.content)).toContain("<town_now> The clocktower is stopped at 4:17");
    expect(worldBible()).toContain("Where <town_now>, <canon>, your memories or the request say something newer, they win.");
  });

  it("keeps Margo's lantern-pinion lock for when it comes up", () => {
    expect(personaBlock(card("margo"), { flags: [], day: 2, voices: roster })).toContain("does not know what the lantern pinion is, and says so if it comes up");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Card samples quoted back
// ---------------------------------------------------------------------------------------------------------------

describe("sample echo: near-verbatim lifts", () => {
  it("catches the eval's Odile line: a distinctive four-word run and most of its words from one sample", () => {
    const samples = samplesOf("odile");
    expect(sampleEcho("Sit, petite, if you're staying. Don't block the door.", samples)).toMatch(/^"don't block the door"/);
    expect(check(["Sit, petite, if you're staying. Don't block the door."], vctx("odile"))).toMatchObject({ ok: false, category: "sample_echo" });
    // High word overlap with no shared run of four: the same sample's words shuffled.
    expect(sampleEcho("The door's blocked, so sit. Hot oven since four.", samples)).toMatch(/words \(/);
    expect(sharedRuns("Sit, petite, if you're staying. Don't block the door.", samples[0]!)).toEqual([["don't", "block", "the", "door"]]);
  });

  it("lets prices, counts and ordinary phrases recur", () => {
    const samples = samplesOf("odile");
    for (const line of [
      "Rye. Two coins.", "(Slides a loaf over.) Rye's two coins, white's three, and the heel's going spare.",
      "Sit, then. Kettle's on.", "Hm. The rye sells out by nine.", "Rook was here at seven. I said nothing.",
    ]) expect(sampleEcho(line, samples), line).toBeNull();
    const pell = samplesOf("pell");
    expect(sampleEcho("Sit, Fellow. Tell me what you need from me.", pell)).toBeNull();
    // Her own chore ("count the lamps at dusk") and register words never make a lift; names never do either.
    expect(sampleEcho("Now. I count the lamps at dusk, and I'm late.", pell, cardVocabulary(card("pell")))).toBeNull();
    expect(sampleEcho("Now. I count the lamps at dusk, and I'm late.", pell)).not.toBeNull();
    const bertrand = samplesOf("bertrand");
    expect(sampleEcho("Hollis Brandt. Time and date beside the name.", bertrand, cardVocabulary(card("bertrand")))).toBeNull();
    expect(check(["Now. I count the lamps at dusk, and I'm late."], vctx("pell"))).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Tics saved for leaving
// ---------------------------------------------------------------------------------------------------------------

describe("exit-only tics (June's 'Anyway.')", () => {
  it("are marked on the card, a subset of its tics, and in the persona block", () => {
    expect(exitOnlyTics(card("june")).map((t) => t.phrase)).toEqual(["Anyway."]);
    for (const c of speaking()) {
      const voice = c.voice.mode === "narrated_action" ? null : c.voice;
      for (const tic of voice?.exit_only ?? []) expect(voice!.tics, `${c.id}: ${tic}`).toContain(tic);
    }
    expect(personaBlock(card("june"), { flags: [], day: 2, voices: roster })).toContain('"Anyway." (only as the conversation ends)');
  });

  it("are stripped mid-conversation where they stand alone, and kept on the way out", () => {
    const mid = check(["Mm, the reed's split. Anyway. You wanted the waltz?"], vctx("june"));
    expect(mid).toMatchObject({ ok: true, output: { lines: [{ text: "Mm, the reed's split. You wanted the waltz?" }] } });
    if (mid.ok) expect(mid.adjustments).toContain('exit-only tic stripped: "Anyway."');
    expect(check(["Sure.", "Anyway."], vctx("june"))).toMatchObject({ ok: true, output: { lines: [{ text: "Sure." }] } });
    expect(check(["Off you go, friend. Anyway."], vctx("june", { exit: true }))).toMatchObject({ ok: true, output: { lines: [{ text: "Off you go, friend. Anyway." }] } });
    expect(check(["Off you go, friend. Anyway."], vctx("june"), true)).toMatchObject({ ok: true, output: { lines: [{ text: "Off you go, friend. Anyway." }] } });
    // "anyway" inside a sentence isn't the tic.
    expect(check(["It was going in the bin anyway."], vctx("june"))).toMatchObject({ ok: true, output: { lines: [{ text: "It was going in the bin anyway." }] } });
    // A turn that is only the tic can't be stripped: regenerate.
    expect(check(["Anyway."], vctx("june"))).toMatchObject({ ok: false, category: "exit_tic", detail: '"Anyway."' });
    expect(stripTics("(Hums.) Anyway.", exitOnlyTics(card("june")))).toBe("(Hums.)");
  });

  it("never stream before the goodbye", async () => {
    const streamed: string[] = [];
    const request = { system: [], messages: [{ role: "user" as const, content: "<player_said> Go on. </player_said>" }], output_config: { format: modelOutputFormat(DialogueTurnOutput) } };
    const result = await generateTurn({
      mind: new FakeMind([{ output: turn(["Mm, the reed's split. Anyway. You wanted the waltz?"]), chunk: 3 }]),
      request, validation: vctx("june"), onLineDelta: (d) => streamed.push(d.text_so_far),
    });
    expect(result.output!.lines[0]!.text).toBe("Mm, the reed's split. You wanted the waltz?");
    expect(streamed.some((t) => /anyway/i.test(t))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Borrowed tics: "Right."
// ---------------------------------------------------------------------------------------------------------------

describe("'Right.' is Augusta's and Priya's", () => {
  it("is borrowed when Margo says it as a sentence of its own (the eval's margo_riddle_ask)", () => {
    expect(check(["Right. The plaque by your door is number one, and it's not telling you anything."], vctx("margo")))
      .toMatchObject({ ok: false, category: "borrowed", detail: '"Right." (augusta)' });
    expect(borrowedFor(card("margo"), roster).filter((s) => s.phrase === "Right.").map((s) => s.owner)).toEqual(["augusta", "priya"]);
  });

  it("is never flagged for its owners, for Nell (whose 'Right, then.' starts with it), or inside a sentence", () => {
    expect(check(["Right. Sleeves up."], vctx("priya"))).toMatchObject({ ok: true });
    expect(check(["Right. Noted."], vctx("augusta"))).toMatchObject({ ok: true });
    expect(check(["Right."], vctx("nell"))).toMatchObject({ ok: true });
    for (const line of ["That's right, it's on the east wall.", "All right. Gloves.", "Right now, nothing.", "Right, then."]) {
      expect(borrowedHits(line, borrowedFor(card("margo"), roster)).map((s) => s.phrase), line).not.toContain("Right.");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7. never_says, on model lines and on every authored line a resident can be served
// ---------------------------------------------------------------------------------------------------------------

const contentDir = fileURLToPath(new URL("../../../../content/", import.meta.url));
const parsed = new Map<string, unknown>();
const yaml = (path: string): unknown => {
  if (!parsed.has(path)) parsed.set(path, parse(readFileSync(`${contentDir}${path}`, "utf8")));
  return parsed.get(path);
};

/**
 * Every authored line `c` can be served by the server's fallbacks: openers at every tier, mood and met state; each
 * moment's pool as the picker walks it (it skips lines already said, so three asks reach three lines); gifts; and
 * riddle turns, whose lead-ins are checked pool by pool with every wording of every hint the picker can choose.
 */
function servedLines(c: PersonaCard): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const borrowed = borrowedFor(c, roster);
  const base = (extra: Partial<FallbackInput>): FallbackInput => ({
    card: c, state: { regard: 0, mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 10 } },
    playerName: "Wren", playerPronouns: "she/her", turnIndex: 0, borrowed, ...extra,
  });
  const said = (input: FallbackInput) => fallbackTurn(input).lines[0]!.text;
  for (const regard of [-30, 0, 25, 50, 80]) for (const valence of [-90, 0, 90]) for (const met of [false, true]) {
    out.push({ where: `opener ${regard}/${valence}/${met}`, text: said(base({ state: { regard, mood: { valence, energy: 50, stress: 0, emotion: "content", intensity: 10 } }, met })) });
  }
  const moments = ["What do you bake first?", "I'm homesick today.", "Thanks.", "I'm Wren, by the way.", "I should get going.", "Fair enough."];
  for (const playerText of moments) {
    let history: string[] = [];
    for (let i = 0; i < 4; i++) {
      const text = said(base({ playerText, turnIndex: 2, said: history }));
      out.push({ where: `moment "${playerText}"`, text });
      history = [...history, text];
    }
  }
  out.push({ where: "resume", text: said(base({ turnIndex: 2 })) });
  for (const kind of ["love", "like", "neutral", "dislike", "meal"] as const) out.push({ where: `gift ${kind}`, text: giftLine(kind, { card: c, borrowed }) });
  const leads = loadRiddleLeads().leads;
  const pools = Object.hasOwn(leads, c.id) ? leads[c.id]! : leads.default!;
  for (const lead of [...pools.give, ...pools.again, ...(pools.trail ?? [])]) out.push({ where: "riddle lead-in", text: lead });
  for (const riddle of Object.values(RIDDLES)) for (const allowed of [1, 2, 3]) {
    const hint = authoredHint(riddle, allowed);
    if (!hint) { out.push({ where: `riddle ${riddle.id}`, text: said(base({ riddle: { record: riddle, allowed }, turnIndex: 1 })) }); continue; }
    const ok = (text: string) => speakable(text, { card: c, borrowed });
    const first = riddleHintText({ riddleId: riddle.id, level: riddle.hints.indexOf(hint), hint, said: [], speakable: ok }).text;
    const again = riddleHintText({ riddleId: riddle.id, level: riddle.hints.indexOf(hint), hint, said: [first], speakable: ok }).text;
    out.push({ where: `riddle ${riddle.id}@${allowed}`, text: first }, { where: `riddle ${riddle.id}@${allowed} again`, text: again });
    out.push({ where: `riddle ${riddle.id}@${allowed} turn`, text: said(base({ riddle: { record: riddle, allowed }, turnIndex: 1, playerText: "About the plaque on my door…" })) });
  }
  return out;
}

/** The resident's own lines in content/lines and content/projects.yaml (client-served, but theirs). */
function ownContentLines(c: PersonaCard): { where: string; text: string }[] {
  const ambient = yaml("lines/ambient.yaml") as { voices: Record<string, { text: string }[]> };
  const poll = yaml("lines/straw_poll.yaml") as { residents: Record<string, Record<string, string>>; generic: Record<string, string[]> };
  const projects = yaml("projects.yaml") as {
    pell: Record<string, string>;
    projects: { id: string; donors?: { resident: string; line: string }[]; ceremony?: { lines?: { speaker: string; text: string }[] } }[];
  };
  const fill = (text: string) => text.replace(/\{[a-z_]+\}/g, "Wren");
  return [
    ...(ambient.voices[c.id] ?? []).map((v) => ({ where: "ambient voice", text: fill(v.text) })),
    ...Object.values(poll.residents[c.id] ?? {}).map((text) => ({ where: "straw poll", text })),
    ...Object.values(poll.generic).flat().map((text) => ({ where: "straw poll generic", text })),
    ...(c.id === "pell" ? Object.values(projects.pell).map((text) => ({ where: "projects pell", text: fill(text) })) : []),
    ...projects.projects.flatMap((p) => [
      ...(p.donors ?? []).filter((d) => d.resident === c.id).map((d) => ({ where: `${p.id} donor`, text: d.line })),
      ...(p.ceremony?.lines ?? []).filter((l) => l.speaker === c.id).map((l) => ({ where: `${p.id} ceremony`, text: l.text })),
    ]),
  ];
}

describe("never_says", () => {
  it("is enforced on model lines, as a soft check that regenerates once", () => {
    expect(check(["(Checks the watch.) Came up around 07:12, I'd say."], vctx("hollis"))).toMatchObject({ ok: false, category: "never_says", detail: '"around"' });
    expect(check(["(Takes the jar.) Thank you, petite."], vctx("odile"))).toMatchObject({ ok: false, category: "never_says", detail: '"thank you"' });
    expect(check(["Claudine's letters are none of your business."], vctx("odile"))).toMatchObject({ ok: false, category: "never_says", detail: '"Claudine"' });
    expect(check(["I'm leaving on the Friday boat."], vctx("priya"))).toMatchObject({ ok: false, category: "never_says" });
    expect(check(["(Takes the jar.) Hm. Eat something, petite."], vctx("odile"))).toMatchObject({ ok: true });
    expect(neverSaysHit("Round the back, 07:12 sharp.", ["around"])).toBeNull();
    expect(correctiveNote("never_says", '"around"')).toBe('You never say "around": it\'s on your card\'s never-says list. Say it again without it, in your own words.');
  });

  it("is never broken by an authored line the server can serve any resident", () => {
    for (const c of speaking()) {
      for (const { where, text } of servedLines(c)) {
        const voice = c.voice.mode === "narrated_action" ? null : c.voice;
        expect(neverSaysHit(text, voice?.never_says ?? []), `${c.id} ${where}: ${text}`).toBeNull();
        expect(borrowedHits(text, borrowedFor(c, roster)), `${c.id} ${where}: ${text}`).toEqual([]);
        expect(lexicalHits(text), `${c.id} ${where}: ${text}`).toEqual([]);
        expect(text.length, `${c.id} ${where}`).toBeLessThanOrEqual(LIMITS.dialogue.lineChars);
      }
    }
  });

  it("is never broken by a resident's own lines in content/", () => {
    for (const c of speaking()) {
      const voice = c.voice.mode === "narrated_action" ? null : c.voice;
      for (const { where, text } of ownContentLines(c)) expect(neverSaysHit(text, voice?.never_says ?? []), `${c.id} ${where}: ${text}`).toBeNull();
    }
  });

  it("is enforced on live gossip lines too, per speaker, with Monde's money", () => {
    const side = (id: string): ResidentPrefix => ({ card: card(id), state: state(card(id)), relationships: [], flags: [], names: {}, voices: roster });
    const gossip = (a: string, b: string) => JSON.stringify({
      lines: [{ speaker: "a", text: a, expr: "neutral" }, { speaker: "b", text: b, expr: "neutral" }],
      a_delta: { affinity: 0, trust: 0 }, b_delta: { affinity: 0, trust: 0 }, news_passed: [], feeling_change: null,
    });
    const odile = side("odile"), hollis = side("hollis");
    expect(validateLiveGossip(gossip("Heel's yours. Eat something.", "05:40, exact change."), odile, hollis, new Set(), false)).not.toBeNull();
    expect(validateLiveGossip(gossip("Thank you, Hollis.", "05:40, exact change."), odile, hollis, new Set(), false)).toBeNull();
    expect(validateLiveGossip(gossip("Heel's yours.", "I'll be around at six."), odile, hollis, new Set(), false)).toBeNull();
    expect(validateLiveGossip(gossip("Heel's yours.", "A shilling, exact."), odile, hollis, new Set(), false)).toBeNull();
    // "around" is Hollis's never-says, not Odile's.
    expect(validateLiveGossip(gossip("I'll be around at six.", "05:40, exact change."), odile, hollis, new Set(), false)).not.toBeNull();
  });

  it("keeps the eval's cases out: Odile never thanks a gift in words, Nettie and Rook never stall with 'sorry'", () => {
    for (const kind of ["love", "like", "neutral", "dislike"] as const) {
      expect(giftLine(kind, { card: card("odile") })).not.toMatch(/thank you/i);
      expect(giftLine(kind, { card: card("pell") })).toBe(GIFT_LINES[kind][0]);
    }
    for (const id of ["nettie", "rook"]) {
      for (const { text } of servedLines(card(id))) expect(text, id).not.toMatch(/\bsorry\b/i);
    }
    expect(speakable("Sorry, I was miles away. Say that again?", { card: card("nettie") })).toBe(false);
    // Every pool keeps at least one line for everyone.
    for (const c of speaking()) {
      for (const [moment, pool] of Object.entries(MOMENT_LINES)) {
        expect(pool.some((line) => speakable(line.replaceAll("{player}", "Wren"), { card: c, borrowed: borrowedFor(c, roster) })), `${c.id} ${moment}`).toBe(true);
      }
    }
    expect([...Object.values(FALLBACK_LINES).flatMap((row) => Object.values(row)), ...Object.values(MET_LINES), STUMPED_LINE].length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 8. Riddle hints asked for twice
// ---------------------------------------------------------------------------------------------------------------

describe("riddle hints, asked again", () => {
  const library = () => loadRiddleLeads();
  const margo = () => card("margo");
  const ask = (playerText: string, turnIndex: number, said: string[] = [], c = margo(), allowed = 1, riddle = "OQ-1") => fallbackTurn({
    card: c, state: { regard: 0, mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 10 } }, playerName: "Wren",
    playerPronouns: "she/her", turnIndex, playerText, said, riddle: { record: RIDDLES[riddle]!, allowed }, borrowed: borrowedFor(c, roster),
  }).lines[0]!.text;

  it("never gives the identical hint sentence twice in a row, and says it's the same hint", () => {
    const hint = authoredHint(RIDDLES["OQ-1"]!, 1)!;
    const retold = library().retold["OQ-1"]![0]!;
    const first = ask("What about the plaque on my door?", 1);
    const second = ask("Can you just tell me the answer?", 2, [first]);
    const third = ask("Go on, once more.", 3, [first, second]);
    expect(first.endsWith(` ${hint}`)).toBe(true);
    expect(second.endsWith(` ${retold}`)).toBe(true);
    expect(third.endsWith(` ${hint}`)).toBe(true);
    for (const line of [second, third]) expect(library().leads.margo!.again.some((lead) => line.startsWith(lead)), line).toBe(true);
    expect(riddleHintText({ riddleId: "OQ-1", level: 0, hint, said: ["Unrelated.", first, "Also unrelated."] })).toEqual({ text: retold, again: true });
    expect(riddleHintText({ riddleId: "OQ-1", level: 0, hint, said: [] })).toEqual({ text: hint, again: false });
  });

  it("picks up a line that trails off before the hint", () => {
    expect(trailsOff("About the plaque on my door…")).toBe(true);
    expect(trailsOff("About OQ-1...")).toBe(true);
    expect(trailsOff("About the plaque on my door?")).toBe(false);
    const line = ask("About the plaque on my door…", 1);
    expect(library().leads.margo!.trail!.some((lead) => line.startsWith(lead)), line).toBe(true);
    expect(riddleLeadIn({ residentId: "margo", riddleId: "OQ-1", turnIndex: 1, again: false, trailing: true })).toMatch(/^\(.*\) The plaque\./);
    // A trailing line on a second ask is still "again".
    expect(library().leads.margo!.again.some((lead) => ask("Still about that plaque…", 2, [line]).startsWith(lead))).toBe(true);
  });

  it("serves a resident a wording they can say: Hollis never says 'around'", () => {
    const original = authoredHint(RIDDLES["OQ-3"]!, 2)!;
    expect(original).toMatch(/\baround\b/);
    const line = ask("What about the plaque?", 1, [], card("hollis"), 2, "OQ-3");
    expect(line).not.toMatch(/\baround\b/);
    expect(line.endsWith(` ${library().retold["OQ-3"]![1]}`)).toBe(true);
  });

  it("has an authored retelling for every hint that can be served, and none for one that can't", () => {
    const leads = Object.values(library().leads).flatMap((pools) => [...pools.give, ...pools.again, ...(pools.trail ?? [])]);
    const longestLead = Math.max(...leads.map((l) => l.length));
    for (const riddle of SPRING_RIDDLES) {
      const retold = library().retold[riddle.id];
      riddle.hints.forEach((hint, level) => {
        const served = !!hint && !containsAnswer(hint, riddle.accepted);
        const text = retold?.[level] ?? null;
        if (!served) { expect(text, `${riddle.id} hint ${level + 1} is never served`).toBeNull(); return; }
        expect(text, `${riddle.id} hint ${level + 1} needs a retelling`).toBeTruthy();
        expect(text).not.toBe(hint);
        expect(containsAnswer(text!, riddle.accepted), `${riddle.id}: ${text}`).toBe(false);
        expect(lexicalHits(text!), text!).toEqual([]);
        expect(text!).not.toMatch(/[!…]|\.\.\./);
        expect(longestLead + 1 + text!.length, text!).toBeLessThanOrEqual(LIMITS.dialogue.lineChars);
        for (const c of speaking()) {
          const voice = c.voice.mode === "narrated_action" ? null : c.voice;
          expect(neverSaysHit(text!, voice?.never_says ?? []), `${c.id}: ${text}`).toBeNull();
        }
      });
    }
    for (const id of Object.keys(library().retold)) expect(SPRING_RIDDLES.some((r) => r.id === id), id).toBe(true);
  });

  it("has a trail lead-in for every resident who speaks", () => {
    for (const c of speaking()) expect(library().leads[c.id]?.trail?.length ?? 0, c.id).toBeGreaterThan(0);
    expect(library().leads.default!.trail!.length).toBeGreaterThan(0);
  });
});
