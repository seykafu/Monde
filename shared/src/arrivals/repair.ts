// Repairing a household reply before it is validated (GDD Appendix A.3.7; §9.10.2: the model proposes, the engine
// disposes). The household cards come back as text (householdJson.ts), and a staging trial (2026-10-17) failed every
// household six times on things the engine can put right without inventing anything: a summary or backstory a little
// over its cap, a tie tagged "brother" or "neighbour", a routine at "market_street", a required tie at the hand-written
// card's 70, a member tied to their own slot, likes that miss the archetype's list, two members' Big Five a few points
// apart. A full census run (2026-10-17) then still fell back to the template for 35 of 107 households, on more slips of
// the same kind: elders reminiscing in pennies (V16's money), a verb the engine doesn't have, ten routine blocks, a
// block past 26:00 or out of order, a day that doesn't start or end at home, a work block away from the workplace.
// After two rounds of those, 15 households still fell back, on the World Bible's banned words (V16 style), ties to
// people who don't exist (V14), samples a contraction short (V10), a Millbrook day that never reaches an open board
// (V13n), an appearance that names nothing the portrait wears (V06), work with no job (V13) and a Big Five with no
// strong trait (V08): the engine fixes those too, each with the smallest change its rule needs.
// repairHousehold fixes those deterministically and lists each change; validateHousehold then judges what is left, and
// only that goes back to the model on a retry. Names, canon, novelty and the rest of banned language (V02, V03,
// V15–V19) stay with the validator and the retry loop, and so does anything that needs new content. Pure: no I/O, and
// the input is never mutated.
import { OPEN_BOARDS } from "../census/day1Tables";
import { VERBS, type Verb } from "../verbs";
import {
  APPEARANCE_SENTENCES, ARRIVAL_HOUSEHOLD_TIE, BIG5_APART, BIG5_KEYS, CONTRACTION, DAY_END_MINUTES, HOME_TOKEN, HOUSEBOUND_AGE, LENGTH_CAPS, LIKES_RANGE,
  NOT_X_BUT_Y, PRONOUNS, RELATION_TAGS, ROUTINE_BLOCKS, ROUTINE_TIME, STORY_ROLES, TIES_RANGE, assignedWorkplace, big5Apart, countSentences, countWords,
  hasEngineRoutine, householdIds, householdTieFor, isCommuter, isTollmenRound, likeRule, memberArchetype, memberTags, mentionsAttire, routineClock,
  surnameOfName, tieLimit, type Big5Key, type TieEnd, type ValidationContext,
} from "./card";
import type { PortraitTags } from "../census/portraitPlan";
import type { HouseholdDraw } from "./draw";
import { currencyHit, currencySpans, foldApostrophes } from "./money";
import { SeededRng } from "./rng";

export interface HouseholdRepair {
  /** The reply with the repairs made: a copy, still unvalidated (validateHousehold decides). */
  output: unknown;
  /**
   * One line per change, led by the rule it serves and naming the field, the old value and the new one, e.g.
   * `V07 members[0].backstory trimmed from 142 to 118 words` or `V01 members[0].relationships "nell".tag "sister" → "kin"`.
   */
  adjustments: string[];
}

type Rec = Record<string, unknown>;
type RelationTag = (typeof RELATION_TAGS)[number];
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const show = (x: unknown): string => JSON.stringify(x) ?? String(x);
/** An integer within ±lim (never −0). */
const bound = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, Math.round(v))) || 0;

// ── V06/V07: lengths ────────────────────────────────────────────────────────

/** Where a sentence may end for a cut: . ! ? or … (and a closing quote or bracket) before a space. */
const SENTENCE_END = /[.!?…]["'”’)\]]?(?=\s)/g;
const ENDS_SENTENCE = /[.!?…]["'”’)\]]?$/;

/**
 * `text` within `max` words, cut where fitText cuts (clamps.ts): after the last whole sentence that fits, if that keeps
 * at least half the cap; else after the last whole word that fits, with an ellipsis. Never mid-word. Text within the
 * cap that `fits` is returned as it is; `fits` can ask more of a cut (V06's two sentences).
 * GDD-GAP: A.3.7 V07 truncates text over by under 10% and fails the rest. The trial's backstories ran 17–22% over;
 * the engine trims any overrun instead of spending a retry on it.
 */
export function trimToWords(text: string, max: number, fits: (cut: string) => boolean = () => true): string {
  if (countWords(text) <= max && fits(text)) return text;
  const body = text.trim();
  let sentence: string | null = null;
  for (const end of body.matchAll(SENTENCE_END)) {
    const cut = body.slice(0, end.index + end[0].length);
    if (countWords(cut) > max) break;
    if (fits(cut)) sentence = cut;
  }
  const tokens = [...body.matchAll(/\S+/g)];
  const last = tokens[Math.min(max, tokens.length) - 1];
  let word = last ? body.slice(0, last.index + last[0].length).replace(/[\s,;:—–-]+$/u, "") : body;
  if (word && !ENDS_SENTENCE.test(word)) word = `${word}…`;
  if (sentence !== null && (countWords(sentence) >= max / 2 || !fits(word))) return sentence;
  return word;
}

// ── Enums ───────────────────────────────────────────────────────────────────

const PRONOUN_FORMS: readonly (readonly [(typeof PRONOUNS)[number], ReadonlySet<string>])[] = [
  ["she/her", new Set(["she", "her", "hers", "herself"])],
  ["he/him", new Set(["he", "him", "his", "himself"])],
  ["they/them", new Set(["they", "them", "their", "theirs", "themself", "themselves"])],
];
/** "She", "she/her/hers", "HE / HIM" → the one set every part belongs to; null for a mix (she/they) or anything else. */
export function pronounsOf(v: string): (typeof PRONOUNS)[number] | null {
  const parts = v.toLowerCase().split(/[\s/,]+/).filter(Boolean);
  return parts.length ? PRONOUN_FORMS.find(([, forms]) => parts.every(p => forms.has(p)))?.[0] ?? null : null;
}

/** "Favour-giver", "shop keeper" → the story role; anything that isn't one is "none" (no role is the safe claim). */
export function storyRoleOf(v: unknown): (typeof STORY_ROLES)[number] {
  if (!isStr(v)) return "none";
  const s = v.trim().toLowerCase().replace(/favour/g, "favor").replace(/[\s-]+/g, "_").replace(/^shop_keeper$/, "shopkeeper");
  return (STORY_ROLES as readonly string[]).includes(s) ? (s as (typeof STORY_ROLES)[number]) : "none";
}

/** A routine verb in another form ("Socialising", "napping", "reads", "playing music"); null unless exactly one fits. */
export function verbOf(v: string): Verb | null {
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/^socialis/, "socializ").replace(/^playing_/, "play_");
  const verbs = VERBS as readonly string[];
  if (verbs.includes(s)) return s as Verb;
  const stem = s.endsWith("ing") ? s.slice(0, -3) : null;
  const options = [...new Set([
    ...(stem ? [stem, `${stem}e`, stem.replace(/(.)\1$/, "$1")] : []),
    ...(s.endsWith("s") ? [s.slice(0, -1)] : []),
  ])].filter(x => verbs.includes(x));
  return options.length === 1 ? (options[0] as Verb) : null;
}

/**
 * GDD-GAP: A.3.7 V01 fails a routine verb outside §9.7's list. These words name an activity plainly enough to take the
 * closest verb (the model's "chat", "stroll", "knit", "bake", "chapel"). WORK_WORDS are work at the member's workplace
 * and the verb given elsewhere (a lesson somewhere else is attended). Any other word is a wander.
 */
const VERB_WORDS: Readonly<Partial<Record<Verb, readonly string[]>>> = {
  socialize: ["chat", "gossip", "talk", "natter", "mingle", "meet", "converse", "banter", "greet", "catch_up", "company", "cards", "darts", "dominoes", "pint", "pub"],
  walk: ["stroll", "amble", "ramble", "hike", "saunter", "promenade", "constitutional", "dog", "dog_walk"],
  tinker: ["knit", "sew", "mend", "repair", "darn", "fix", "patch", "whittle", "carve", "craft", "build", "make", "weave", "embroider", "paint", "sketch", "draw", "woodwork", "carpentry"],
  clean: ["wash", "washing", "laundry", "launder", "scrub", "sweep", "dust", "tidy", "iron", "polish", "mop", "chores", "housework"],
  cook: ["bake", "brew", "roast", "boil", "prepare", "kitchen"],
  eat: ["breakfast", "lunch", "dinner", "supper", "tea", "meal", "dine", "snack", "elevenses", "picnic"],
  pray: ["worship", "chapel", "church", "mass", "service", "vespers", "evensong", "devotions", "hymns"],
  sleep: ["sleep_in", "lie_in", "bed", "bedtime", "turn_in"],
  nap: ["doze", "snooze", "siesta", "rest", "lie_down", "kip"],
  read: ["study", "paper", "newspaper", "book", "library"],
  write: ["letter", "letters", "journal", "diary", "correspondence", "ledger", "accounts"],
  garden: ["weed", "plant", "prune", "hoe", "dig", "allotment", "greenhouse"],
  fish: ["angle", "angling", "crab", "crabbing"],
  play_music: ["music", "sing", "song", "choir", "fiddle", "piano", "violin", "accordion", "concertina", "guitar"],
  shop: ["buy", "errand", "errands", "market", "groceries", "browse", "shops"],
  visit: ["call", "call_on", "drop_in", "see"],
  attend: ["meeting", "council", "lecture"],
  exercise: ["swim", "run", "jog", "cycle", "bike", "row", "stretch", "train", "dip", "sea_swim"],
  sit: ["relax", "bench", "sunbathe", "wait", "think", "ponder", "daydream", "idle"],
  volunteer: ["help", "help_out", "charity"],
  wander: ["potter", "explore", "roam", "mooch", "loiter", "dawdle", "beachcomb"],
};
const WORK_WORDS: ReadonlyMap<string, Verb> = new Map([
  ...["teach", "lesson", "tutor", "class", "school"].map(w => [w, "attend"] as const),
  ...["serve", "serving"].map(w => [w, "volunteer"] as const),
  ...["watch", "guard"].map(w => [w, "sit"] as const),
  ...["shift", "job", "labour", "labor", "duty", "deliver", "delivery", "round", "patrol", "collect", "collection"].map(w => [w, "wander"] as const),
]);
const VERB_OF_WORD = new Map<string, Verb>(
  (Object.entries(VERB_WORDS) as [Verb, readonly string[]][]).flatMap(([verb, list]) => list.map(w => [w, verb] as const)),
);
const VERB_STOP = new Set([
  "a", "an", "the", "at", "to", "with", "and", "of", "on", "in", "for", "by", "out", "up", "around", "about", "some", "go", "goes", "going",
  "have", "has", "having", "do", "does", "doing", "get", "gets", "his", "her", "their", "my", "own", "early", "late", "quick", "long", "bit", "time",
]);
/** A word's plainer forms: "chatting" → chat, "strolls" → stroll, "baked" → bake. */
const wordForms = (w: string): string[] => {
  const out = [w];
  const base = (stem: string) => out.push(stem, `${stem}e`, stem.replace(/(.)\1$/, "$1"));
  if (w.endsWith("ing")) base(w.slice(0, -3));
  if (w.endsWith("ed")) base(w.slice(0, -2));
  if (w.endsWith("ies")) out.push(`${w.slice(0, -3)}y`);
  if (w.endsWith("es")) out.push(w.slice(0, -2));
  if (w.endsWith("s")) out.push(w.slice(0, -1));
  return [...new Set(out)];
};

/**
 * The routine verb for whatever the model wrote in `do`: an inflection of a verb (verbOf), else the synonym table (the
 * whole phrase, then its words from the first: "go for a stroll" → walk), with `atWork` deciding the work words; else
 * wander. `known` is false for the wander nothing pointed to.
 */
export function routineVerbFor(v: string, atWork: boolean): { verb: Verb; known: boolean } {
  const exact = verbOf(v);
  if (exact) return { verb: exact, known: true };
  const verbs = VERBS as readonly string[];
  const lookup = (w: string): Verb | null => {
    for (const f of wordForms(w)) {
      if (verbs.includes(f)) return f as Verb;
      const mapped = VERB_OF_WORD.get(f);
      if (mapped) return mapped;
      const work = WORK_WORDS.get(f);
      if (work) return atWork ? "work" : work;
    }
    return null;
  };
  const tokens = foldApostrophes(v).toLowerCase().replace(/[^\p{L}\s_-]+/gu, " ").split(/[\s_-]+/).filter(Boolean);
  const verb = (tokens.length ? lookup(tokens.join("_")) : null) ?? tokens.filter(t => !VERB_STOP.has(t)).map(lookup).find(x => x !== null) ?? null;
  return verb ? { verb, known: true } : { verb: "wander", known: false };
}

/** GDD-GAP: A.3.7 V01 fails a tag outside the six; these words name one of them plainly enough to map. */
const TAG_WORDS: Readonly<Record<RelationTag, readonly string[]>> = {
  kin: [
    "family", "relative", "relation", "kinship", "kinsman", "kinswoman", "brother", "sister", "sibling", "twin", "mother", "father", "mum", "mom",
    "mam", "dad", "parent", "son", "daughter", "child", "cousin", "aunt", "auntie", "uncle", "niece", "nephew", "grandmother", "grandfather",
    "grandparent", "grandma", "grandpa", "gran", "granny", "grandad", "granddad", "granddaughter", "grandson", "grandchild", "spouse", "husband",
    "wife", "partner", "stepmother", "stepfather", "stepbrother", "stepsister", "stepson", "stepdaughter",
  ],
  friend: [
    "neighbour", "neighbor", "colleague", "coworker", "co worker", "workmate", "pal", "mate", "chum", "friendly", "flatmate", "housemate",
    "roommate", "lodger", "crew", "crewmate", "shipmate",
  ],
  rival: ["dislike", "enemy", "rivalry", "nemesis", "grudge", "foe", "competitor"],
  wary: ["cautious", "suspicious", "distrust", "distrustful", "mistrust", "uneasy", "guarded"],
  curious: ["interested", "intrigued", "curiosity"],
  fond: ["fondness", "affection", "affectionate"],
};
const TAG_OF = new Map<string, RelationTag>([
  ...RELATION_TAGS.map(t => [t, t] as const),
  ...(Object.entries(TAG_WORDS) as [RelationTag, readonly string[]][]).flatMap(([tag, list]) => list.map(w => [w, tag] as const)),
]);
const tagWord = (w: string): RelationTag | null => TAG_OF.get(w) ?? (w.endsWith("s") ? TAG_OF.get(w.slice(0, -1)) ?? null : null);

/**
 * A relationship tag through the synonym table: the whole phrase, "… in law", then its words from the last (the head
 * noun: "older brother", "old friend", "fond of"). A negated phrase ("not friendly") maps to nothing. Null: unknown.
 */
export function relationTagOf(v: unknown): RelationTag | null {
  if (!isStr(v)) return null;
  const s = v.toLowerCase().replace(/[_\-/]+/g, " ").replace(/[^\p{L} ]+/gu, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const whole = tagWord(s);
  if (whole) return whole;
  if (/\bin law\b/.test(s)) return "kin";
  const words = s.split(" ");
  if (words.some(w => w === "not" || w === "no" || w === "never")) return null;
  for (const w of [...words].reverse()) { const t = tagWord(w); if (t) return t; }
  return null;
}

// ── V13: places ─────────────────────────────────────────────────────────────

/**
 * A place id as the registry has it: an exact id stays; a case or spacing slip is fixed; "home" is the household's
 * home; a bare local id ("market_street") takes its zone when exactly one registered place has that local id. Anything
 * else is returned as it is, for V13.
 */
function placeFixer(ctx: ValidationContext, home: string): (v: string) => string {
  const known = new Set([...ctx.places, home, HOME_TOKEN]);
  const byLocal = new Map<string, string[]>();
  for (const p of ctx.places) {
    const dot = p.indexOf(".");
    if (dot > 0) byLocal.set(p.slice(dot + 1), [...(byLocal.get(p.slice(dot + 1)) ?? []), p]);
  }
  return v => {
    if (known.has(v)) return v;
    const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (known.has(s)) return s;
    if (s === "home") return home;
    const only = s.includes(".") ? undefined : byLocal.get(s);
    return only?.length === 1 ? only[0]! : v;
  };
}

// ── V13: a day's shape ──────────────────────────────────────────────────────

/** Minutes from midnight → "HH:MM", the hours running on past 23 (24:30, 26:00). */
export const clockTime = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** The earliest a day's added first block at home starts. */
const EARLIEST_START = 5 * 60;
/** The latest time that can be past midnight (V13 runs to 26:00), and the hour after which a small time is. */
const WRAP_LIMIT = DAY_END_MINUTES - 1440;
const NOON = 12 * 60;
const blockLine = (e: unknown): string => (isRec(e) ? `${show(e.at)} ${isStr(e.do) ? e.do : show(e.do)} at ${isStr(e.where) ? e.where : show(e.where)}` : show(e));
const zoneOf = (place: string): string => (place.includes(".") ? place.slice(0, place.indexOf(".")) : place);

/**
 * V13's shape for one day of a routine, in order:
 *  1. blocks with no readable time go;
 *  2. if V13's clock fails, the blocks are sorted by time (a time up to 02:00 that follows a block from noon on is past
 *     midnight, and is written on: "00:30" → "24:30"), and any block past 26:00 goes;
 *  3. while the day is over nine blocks (counting the home blocks step 4 will add), the shortest block away from home
 *     and not work goes (a tie: the later one);
 *  4. a day that doesn't start at home starts with a meal there 30 minutes before its first block (not before 05:00; if
 *     that isn't before the first block, at the first block's time), and a day that doesn't end at home ends with sleep
 *     there an hour after its last (by 26:00): each only if the day stays within nine.
 * `homes` are the places a day may start and end (the home, home.own; offmap.city for a commuter's weekday); added
 * blocks are at `home`. A day that already has V13's shape comes back as it is.
 */
function repairDay(list: readonly unknown[], path: string, homes: ReadonlySet<string>, home: string, note: (line: string) => void): unknown[] {
  let day = list.filter(e => {
    if (isRec(e) && isStr(e.at) && ROUTINE_TIME.test(e.at)) return true;
    note(`V13 ${path}: dropped ${blockLine(e)} (not a time)`);
    return false;
  }) as Rec[];
  if (routineClock(day.map(e => e.at)).some(m => m === null)) {
    let late = false;
    const timed = day.map((e, k) => {
      const [, h, mm] = ROUTINE_TIME.exec(e.at as string)!;
      let min = Number(h) * 60 + Number(mm);
      if (late && min <= WRAP_LIMIT) min += 1440;
      if (min >= NOON) late = true;
      return { e, min, k };
    }).sort((a, b) => a.min - b.min || a.k - b.k);
    const before = day.map(e => e.at as string);
    for (const t of timed) if (t.min >= 1440 && t.min <= DAY_END_MINUTES) t.e.at = clockTime(t.min);
    day = timed.map(t => t.e);
    const after = day.map(e => e.at as string);
    if (timed.some((t, i) => t.k !== i) || after.some((a, i) => a !== before[i]))
      note(`V13 ${path} sorted by time: ${show(before.join(", "))} → ${show(after.join(", "))}`);
    day = day.filter((e, i) => {
      if (timed[i]!.min <= DAY_END_MINUTES) return true;
      note(`V13 ${path}: dropped ${blockLine(e)} (past 26:00)`);
      return false;
    });
  }
  const isHome = (e: Rec | undefined) => !!e && isStr(e.where) && homes.has(e.where);
  const toAdd = () => (day.length ? Number(!isHome(day[0])) + Number(!isHome(day.at(-1))) : 0);
  const max = ROUTINE_BLOCKS[1];
  while (day.length + toAdd() > max) {
    const mins = routineClock(day.map(e => e.at)) as number[];
    let pick = -1, best = Infinity;
    day.forEach((e, i) => {
      if (isHome(e) || e.do === "work") return;
      const length = (mins[i + 1] ?? DAY_END_MINUTES) - mins[i]!;
      if (length <= best) { best = length; pick = i; }
    });
    if (pick < 0) break;
    const adding = toAdd();
    note(`V13 ${path}: dropped ${blockLine(day[pick])} (${day.length} blocks${adding ? ` and ${adding} to add at home` : ""}; at most ${max})`);
    day.splice(pick, 1);
  }
  if (day.length && !isHome(day[0]) && day.length < max) {
    const first = routineClock([day[0]!.at])[0]!;
    let at = Math.max(first - 30, EARLIEST_START);
    if (at >= first) at = first;
    day.unshift({ at: clockTime(at), do: "eat", where: home });
    note(`V13 ${path}: added ${blockLine(day[0])} (the day starts at home)`);
  }
  if (day.length && !isHome(day.at(-1)) && day.length < max) {
    const last = (routineClock(day.map(e => e.at)) as number[]).at(-1)!;
    day.push({ at: clockTime(Math.min(last + 60, DAY_END_MINUTES)), do: "sleep", where: home });
    note(`V13 ${path}: added ${blockLine(day.at(-1))} (the day ends at home)`);
  }
  return day;
}

// ── V16: money is coins ─────────────────────────────────────────────────────

/**
 * The World Bible: "Money is coins, never pounds or shillings" (server/src/mind/prompts/world_bible.md; MONDE ON DAY 1
 * says it for memories too). The census's elders still reminisce in pennies ("A penny, it was"), and V16 fails the card
 * on money.ts's currencyHit. The engine swaps the money word for coins, keeping the number: only what that matcher
 * flags changes, so "penny whistle", "the penny dropped" and "a pound of flour" stay. An old-money sum with a flagged
 * word in it ("four and sixpence", "two shillings and six") is "a few coins"; a bare "four and six" passes V16 and stays.
 * Each entry: the money word, and its coins after "a", "an" or "one" (single) or otherwise.
 */
const COINS: readonly (readonly [RegExp, (single: boolean) => string])[] = [
  [/^tuppence$/i, single => (single ? "coin" : "two coins")],
  [/^(?:thruppence|threepence)$/i, single => (single ? "coin" : "three coins")],
  [/^sixpence$/i, single => (single ? "coin" : "six coins")],
  [/^(?:shilling|penny|ha'?penny|halfpenny|farthing|dollar|euro|franc|guinea)$/i, () => "coin"],
  [/^(?:shillings|pence|pennies|ha'?pennies|halfpennies|farthings|dollars|cents|euros|francs|guineas|sixpences|threepences|quid)$/i, single => (single ? "coin" : "coins")],
];
/** The matcher's count + pound(s) ("five pounds", "a pound"; a note or coin after it goes too). */
const COUNTED_POUNDS = /^(.+?)\s+pounds?$/iu;
/** "pounds a week", "pound notes", "every cent": the money word becomes coin(s), the rest stays. */
const POUNDS_A = /^(pounds?)(\s+(?:a|per)\s+\S+)$/iu;
const POUND_NOTES = /^pound\s+(?:notes?|coins?)$/iu;
const A_CENT = /^(.+\s)cent$/iu;
const AMOUNT = "(?:\\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const SMALL_COIN = "(?:\\p{L}*pence|pennies|penny(?![\\s-]*(?:whistles?|farthings?|dropped|drops))|ha'?penn(?:y|ies)|halfpenn(?:y|ies)|farthings?|sixpences?|threepences?)";
/** An old-money sum with a word V16 flags: "two shillings and sixpence", "two shillings and six", "four and six pence". */
const OLD_MONEY = new RegExp(`(?<![\\p{L}\\p{N}])(?:${AMOUNT}\\s+shillings?(?:,?\\s+and|,)?\\s+(?:${AMOUNT}\\s+)?${SMALL_COIN}|${AMOUNT}\\s+shillings?\\s+and\\s+${AMOUNT}|${AMOUNT}\\s+and\\s+(?:${AMOUNT}\\s+)?${SMALL_COIN})(?![\\p{L}\\p{N}])`, "giu");
/** The bicycle: V16 reads its "farthing" as money. */
const PENNY_FARTHING = /(?<![\p{L}\p{N}])penny[\s-]*farthing(s?)(?![\p{L}\p{N}])/giu;
const SINGLE_BEFORE = /(?<![\p{L}\p{N}])(?:an?|one|1)\s+$/iu;
const AFTER_POUND = /^\s+(?:notes?|coins?)(?![\p{L}\p{N}])/iu;
const SIGN_AMOUNT = /^[£$€]\s?(\d[\d,]*(?:\.\d+)?)/u;

/** `to` in `from`'s case: all capitals, a capital first letter, or as it is. */
const inCase = (from: string, to: string): string => {
  const letters = from.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return to.toUpperCase();
  return /^\p{Lu}/u.test(from) ? `${to.charAt(0).toUpperCase()}${to.slice(1)}` : to;
};

/**
 * `text` with its money in coins (the COINS table), and each swap made, left to right; null when the text has no money
 * V16 flags, or when the swaps wouldn't clear it (the text is then left for V16 and the retry).
 */
export function coinsFor(text: string): { text: string; swaps: [string, string][] } | null {
  if (!currencyHit(text)) return null;
  const folded = foldApostrophes(text);
  const edits: { start: number; end: number; to: string }[] = [];
  const free = (start: number, end: number) => edits.every(e => end <= e.start || start >= e.end);
  for (const m of folded.matchAll(PENNY_FARTHING)) edits.push({ start: m.index, end: m.index + m[0].length, to: `high-wheeler${m[1]}` });
  for (const m of folded.matchAll(OLD_MONEY)) if (free(m.index, m.index + m[0].length)) edits.push({ start: m.index, end: m.index + m[0].length, to: "a few coins" });
  for (const span of currencySpans(text)) {
    const start = span.index;
    let end = start + span.text.length;
    if (!free(start, end)) continue;
    const word = foldApostrophes(span.text);
    const single = SINGLE_BEFORE.test(text.slice(0, start));
    let to: string | null = null, m: RegExpExecArray | null;
    if (span.sign) {
      const amount = SIGN_AMOUNT.exec(text.slice(start))!;
      end = start + amount[0].length;
      to = `${amount[1]} ${amount[1] === "1" ? "coin" : "coins"}`;
    } else if ((m = COUNTED_POUNDS.exec(word))) {
      end += AFTER_POUND.exec(folded.slice(end))?.[0].length ?? 0;
      to = `${span.text.slice(0, m[1]!.length)} ${/^(?:an?|one|1|half an?)$/i.test(m[1]!) ? "coin" : "coins"}`;
    } else if ((m = POUNDS_A.exec(word))) to = `${/s$/i.test(m[1]!) ? "coins" : "coin"}${span.text.slice(m[1]!.length)}`;
    else if (POUND_NOTES.test(word)) to = /s$/i.test(word) ? "coins" : "coin";
    else if ((m = A_CENT.exec(word))) to = `${span.text.slice(0, m[1]!.length)}coin`;
    else to = COINS.find(([re]) => re.test(word))?.[1](single) ?? null;
    if (to !== null) edits.push({ start, end, to });
  }
  edits.sort((a, b) => a.start - b.start);
  let out = text;
  for (const e of [...edits].reverse()) out = `${out.slice(0, e.start)}${inCase(text.slice(e.start, e.end), e.to)}${out.slice(e.end)}`;
  if (!edits.length || currencyHit(out)) return null;
  return { text: out, swaps: edits.map(e => [text.slice(e.start, e.end), inCase(text.slice(e.start, e.end), e.to)]) };
}

// ── V16: the style list ─────────────────────────────────────────────────────

const WORD_START = "(?<![\\p{L}\\p{N}])", WORD_END = "(?![\\p{L}\\p{N}])";
type Swap = readonly [RegExp, string | ((m: RegExpExecArray) => string)];
/** A whole-word, case-blind pattern, bounded the way server/src/mind/filters.ts bounds its lists. */
const wordSwap = (src: string, to: Swap[1]): Swap => [new RegExp(`${WORD_START}(?:${src})${WORD_END}`, "giu"), to];
const POSSESSOR = "(?:my|his|her|their|our|your|own|life['’]s)";
const DETERMINER = "(?:the|its|his|her|their|our|my|your|this|that|whose|\\p{L}+['’]s)";
const GIVE_BACK_OBJECT = "(?:the|a|an|his|her|their|my|your|our|its|what|every|some|that|this|those|these|it)";

/**
 * §12.1's style list as the World Bible gives it (community, journey, resilience, heart of the town, special place,
 * vibrant, tapestry, healing, closure, stakeholders, revitalize, give back, safe space; server/src/mind/filters.ts
 * STYLE, which V16 runs through ctx.banned), each in the plain words that say the same thing. Context picks the word: a
 * mill's "closure" is its closing, a person's "closure" an ending; "her journey" is her road, "the journey" a trip;
 * "give back the ladder" returns it. Earlier rows win where two overlap. The rest of the list (the stock phrases, "Not
 * X, Y") has no plain swap: a text with one is left for V16 and the retry.
 */
const STYLE_SWAPS: readonly Swap[] = [
  wordSwap("community spirit", "neighbourliness"),
  wordSwap("sense of community", "sense of neighbourliness"),
  wordSwap("(?:members|folk|people) of the community", "neighbours"),
  wordSwap("community garden", "garden plots"),
  wordSwap("community work", "work for the town"),
  wordSwap("communities", "towns"),
  wordSwap("community", "town"),
  wordSwap(`(?<=${POSSESSOR}\\s)journey`, "road"),
  wordSwap("journey", "trip"),
  wordSwap("resilience", "staying power"),
  wordSwap("resilient", "hardy"),
  wordSwap("heart of the town", "middle of town"),
  wordSwap("special place", "good place"),
  wordSwap("vibrant", "lively"),
  wordSwap("tapestry", "patchwork"),
  wordSwap("healing", "mending"),
  wordSwap("an? closure", "an ending"),
  wordSwap(`(?<=${DETERMINER}\\s)closure`, "closing"),
  wordSwap("(?<=(?:some|any|no)\\s)closure", "ending"),
  wordSwap("closure", "an ending"),
  wordSwap("stakeholders", "people with a say"),
  wordSwap("stakeholder", "person with a say"),
  wordSwap("revitali[sz]e", "bring back"),
  wordSwap("revitali[sz]es", "brings back"),
  wordSwap("revitali[sz]ed", "brought back"),
  wordSwap("revitali[sz]ing", "bringing back"),
  wordSwap("revitali[sz]ation", "revival"),
  wordSwap("give back to (him|her|them|us|me|you)", m => `help ${m[1]!.toLowerCase()} out`),
  wordSwap("give back to", "help out"),
  wordSwap(`give back(?=\\s+${GIVE_BACK_OBJECT}${WORD_END})`, "return"),
  wordSwap("give back", "help out"),
  wordSwap("safe space", "quiet corner"),
];

/** Does `text` end where a sentence starts (nothing yet, or a sentence end, a space and perhaps an opening quote)? */
const atSentenceStart = (before: string): boolean => /^\s*["'“‘(]?$/u.test(before) || /[.!?…]["'”’)\]]?\s+["'“‘(]?$/u.test(before);
/** `to` in `from`'s case at that point of a text: capitals stay capitals; a capital that starts a sentence stays. */
const caseAt = (before: string, from: string, to: string): string => {
  const letters = from.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return to.toUpperCase();
  return /^\p{Lu}/u.test(from) && atSentenceStart(before) ? `${to.charAt(0).toUpperCase()}${to.slice(1)}` : to;
};

/**
 * `text` with the style list's words in plain words (STYLE_SWAPS), and each swap made, left to right; null unless
 * `banned` (the validator's own matcher, ctx.banned) flags the text as style and passes it after the swaps without a
 * group it didn't flag before. Anything else is left for V16 and the retry.
 */
export function plainWordsFor(text: string, banned: (text: string) => readonly string[]): { text: string; swaps: [string, string][] } | null {
  const before = banned(text);
  if (!before.includes("style")) return null;
  const edits: { start: number; end: number; to: string }[] = [];
  for (const [re, to] of STYLE_SWAPS) for (const m of text.matchAll(re)) {
    const start = m.index, end = m.index + m[0].length;
    if (edits.every(e => end <= e.start || start >= e.end)) edits.push({ start, end, to: caseAt(text.slice(0, start), m[0], typeof to === "string" ? to : to(m)) });
  }
  if (!edits.length) return null;
  edits.sort((a, b) => a.start - b.start);
  let out = text;
  for (const e of [...edits].reverse()) out = `${out.slice(0, e.start)}${e.to}${out.slice(e.end)}`;
  const after = banned(out);
  if (after.includes("style") || after.some(g => !before.includes(g))) return null;
  return { text: out, swaps: edits.map(e => [text.slice(e.start, e.end), e.to]) };
}

// ── V10: voice samples ──────────────────────────────────────────────────────

/**
 * V10's common pairs and their contractions (an "I" keeps its capital). Most can't end a clause ("who you are", never
 * "who you're"), so they need a word after them; "I have to" and "let us in" aren't contractions, and "I will not" is
 * "I won't".
 */
const CONTRACTION_PAIRS: readonly (readonly [pair: string, to: string, needsWord?: boolean])[] = [
  ["i am", "I'm", true], ["it is", "it's", true], ["do not", "don't"], ["does not", "doesn't"], ["did not", "didn't"], ["is not", "isn't"],
  ["are not", "aren't"], ["was not", "wasn't"], ["i will(?!\\s+not\\b)", "I'll", true], ["you are", "you're", true], ["that is", "that's", true],
  ["there is", "there's", true], ["i have(?!\\s+to\\b)", "I've", true], ["we are", "we're", true], ["cannot", "can't"], ["will not", "won't"],
  ["would not", "wouldn't"], ["could not", "couldn't"], ["should not", "shouldn't"],
  ["let us(?!\\s+(?:in|out|through|past|off|down|up|over|by|know|alone|be|pass|stay)\\b)", "let's", true], ["i would(?!\\s+not\\b)", "I'd", true],
  ["they are", "they're", true],
];
const CONTRACTIONS: readonly (readonly [RegExp, string])[] = CONTRACTION_PAIRS.map(([pair, to, needsWord]) =>
  [new RegExp(`(?<![\\p{L}\\p{N}'’])${pair.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}'’])${needsWord ? "(?=\\s+\\p{L})" : ""}`, "giu"), to] as const);

/** The places in a sample a pair contracts, left to right: the pair and its contraction, in the sample's case and apostrophe. */
function contractionsIn(sample: string): { start: number; end: number; from: string; to: string }[] {
  const apostrophe = sample.includes("’") ? "’" : "'";
  const out = CONTRACTIONS.flatMap(([re, to]) => [...sample.matchAll(re)].map(m => {
    const form = to.replace("'", apostrophe);
    const letters = m[0].replace(/[^\p{L}]/gu, "");
    const cased = letters.length > 1 && letters === letters.toUpperCase() ? form.toUpperCase() : /^\p{Lu}/u.test(m[0]) ? `${form.charAt(0).toUpperCase()}${form.slice(1)}` : form;
    return { start: m.index, end: m.index + m[0].length, from: m[0], to: cased };
  }));
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Words that make a sentence a question when they lead it (or, for the first set, end it). */
const ASKING = new Set(["who", "whom", "whose", "what", "which", "when", "where", "why", "how"]);
const ASKING_LEAD = new Set([
  ...ASKING, "am", "is", "are", "was", "were", "do", "does", "did", "have", "has", "had", "can", "could", "will", "would", "shall", "should", "may",
  "might", "must", "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "haven't", "hasn't", "hadn't", "can't", "couldn't", "won't",
  "wouldn't", "shan't", "shouldn't", "mightn't", "mustn't", "ain't", "want", "fancy", "know", "got", "seen", "heard", "anyone", "anybody", "anything",
  "any", "eh", "sorry", "pardon",
]);
/** Words that open a sentence without deciding what it is ("And where were you?"). */
const LEADING = new Set(["and", "but", "so", "then", "well", "oh", "now", "or", "ah", "look", "listen", "right", "still", "anyway"]);
const TAG_QUESTION = /,\s*(?:\p{L}+n['’]t|is|are|was|were|do|does|did|will|would|can|could|shall|should|have|has|had|am)\s+(?:it|he|she|they|you|we|i|there|that|this)\s*$|,\s*(?:right|eh|yes|no|okay|ok|aye|innit|see|mind)\s*$/iu;

/** Would this sentence (its "?" taken off) read as a statement with a full stop: two words or more, not led or ended by a question word, no tag? */
export function readsAsStatement(sentence: string): boolean {
  const words = foldApostrophes(sentence).toLowerCase().replace(/[^\p{L}'\s-]+/gu, " ").split(/\s+/).filter(Boolean);
  let k = 0;
  while (k < words.length - 1 && LEADING.has(words[k]!)) k++;
  const rest = words.slice(k);
  return rest.length >= 2 && !ASKING_LEAD.has(rest[0]!) && !ASKING.has(rest.at(-1)!) && !TAG_QUESTION.test(sentence.trim());
}

/**
 * A sample with more than one question (V10) kept as it is up to its first "?", and each later question a statement:
 * its "?" a "." when the sentence reads as one (readsAsStatement). Null when any later one doesn't, or a "?" sits in a
 * run of marks ("?!", "??").
 */
export function oneQuestion(sample: string): string | null {
  const marks = [...sample.matchAll(/\?/g)].map(m => m.index);
  if (marks.length < 2) return null;
  let out = sample;
  for (const q of marks.slice(1)) {
    if (/[.!?…]/.test(sample[q - 1] ?? "") || /[.!?…]/.test(sample[q + 1] ?? "")) return null;
    const start = Math.max(...[...sample.slice(0, q).matchAll(/[.!?…]/g)].map(m => m.index)) + 1;
    if (!readsAsStatement(sample.slice(start, q).replace(/^[\s"'“‘(—–-]+/u, ""))) return null;
    out = `${out.slice(0, q)}.${out.slice(q + 1)}`;
  }
  return out;
}

// ── V06: what the portrait wears ────────────────────────────────────────────

/**
 * V06: an appearance that names nothing the portrait wears takes the first attire tag this table has, after its first
 * sentence: worn ("in a cardigan") or carried ("with a satchel"). Each names the word mentionsAttire looks for.
 */
const WEARING: Readonly<Record<string, string>> = {
  coat: "in a coat", work_jacket: "in a work jacket", cardigan: "in a cardigan", raincoat: "in a raincoat", jumper: "in a jumper",
  school_jumper: "in a school jumper", navy_jumper: "in a navy jumper", apron: "in an apron", blazer: "in a blazer", velvet_jacket: "in a velvet jacket",
  peaked_cap: "in a peaked cap", flat_cap: "in a flat cap", knit_cap: "in a knit cap", pinafore: "in a pinafore", oilskin: "in an oilskin",
  glasses: "in glasses", smock: "in a smock", shirt: "in a shirt", checked: "in a checked shirt", scarf: "in a scarf", dungarees: "in dungarees",
  skirt: "in a skirt", boots: "in boots", neckerchief: "in a neckerchief", satchel: "with a satchel", tote: "with a tote", brooch: "with a brooch",
  tape_measure: "with a tape measure", tool_belt: "with a tool belt", badge: "with a badge", pencil: "with a pencil", binoculars: "with binoculars",
};

/** `appearance` with ", in <the first attire tag>" at the end of its first sentence, if V06's cap allows it; else null. */
export function withAttireWord(appearance: string, tags: Pick<PortraitTags, "attire">): string | null {
  const body = appearance.trim();
  const phrase = tags.attire.map(t => WEARING[t]).find((p): p is string => !!p && mentionsAttire(p, tags));
  if (!body || !phrase) return null;
  const end = /[.!?…]["'”’)\]]?(?=\s|$)/u.exec(body);
  const at = end ? end.index : body.length;
  const out = `${body.slice(0, at).replace(/[\s,;:—–-]+$/u, "")}, ${phrase}${body.slice(at)}`;
  return countWords(out) <= LENGTH_CAPS.appearance && countSentences(out) <= APPEARANCE_SENTENCES && mentionsAttire(out, tags) ? out : null;
}

// ── V13n: a day on an open board ────────────────────────────────────────────

/**
 * V13n: an open-board place for a block's verb (content/places/places.yaml), the street for any other verb. Verbs tied
 * to their own place (sleep, nap, garden, fish, cook, clean) and work never move.
 */
const BOARD_PLACE: Readonly<Partial<Record<Verb, string>>> = {
  shop: "market_row.general_store", eat: "market_row.cafe_liss", walk: "commons.duck_pond", wander: "commons.duck_pond",
  socialize: "market_row.gull_and_anchor", read: "old_quarter.library", pray: "old_quarter.st_brigids", attend: "old_quarter.town_hall",
};
const BOARD_STREET = "market_row.market_street";
const STAYS_PUT: ReadonlySet<string> = new Set<Verb>(["work", "sleep", "nap", "garden", "fish", "cook", "clean"]);

// ── V08: Big Five ───────────────────────────────────────────────────────────

type Big5 = Record<Big5Key, number>;
const vec = (b: Big5): number[] => BIG5_KEYS.map(k => b[k]);
const extreme = (b: Big5): boolean => BIG5_KEYS.some(k => b[k] >= 70 || b[k] <= 30);

function shuffled<T>(xs: readonly T[], rng: SeededRng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = rng.int(0, i); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

/**
 * The smallest move of `me`'s scores (the summed change) that sets it 15+ apart from every earlier member on two traits,
 * keeping each score in 0–100 and keeping a trait at 70+ or 30− if it had one. The candidates for a trait are its own
 * score or exactly 15 from an earlier member's; ties go by `rng` (seeded by the household). Null: no move does it.
 */
export function nudgeBig5(me: Big5, earlier: readonly Big5[], rng: SeededRng): Big5 | null {
  const passes = (b: Big5) => earlier.every(e => big5Apart(vec(b), vec(e))) && (!extreme(me) || extreme(b));
  const keys = shuffled(BIG5_KEYS, rng);
  const options = new Map(keys.map(k => {
    const alt = [...new Set(earlier.flatMap(e => [e[k] - BIG5_APART, e[k] + BIG5_APART]))].filter(v => v >= 0 && v <= 100 && v !== me[k]);
    return [k, [me[k], ...shuffled(alt, rng)]] as const;
  }));
  const pick: Big5 = { ...me };
  let best: Big5 | null = null, bestCost = Infinity;
  const walk = (i: number, cost: number): void => {
    if (cost >= bestCost) return;
    if (i === keys.length) { if (passes(pick)) { best = { ...pick }; bestCost = cost; } return; }
    const k = keys[i]!;
    for (const v of options.get(k)!) { pick[k] = v; walk(i + 1, cost + Math.abs(v - me[k])); }
    pick[k] = me[k];
  };
  walk(0, 0);
  return best;
}

// ── The repair ──────────────────────────────────────────────────────────────

/**
 * Repair a parsed household reply (anything parseJsonObject returned) against its draw, before validateHousehold:
 *  0. V16: money words in every text V16 scans (all but the name) become coins (coinsFor); then, where ctx.banned
 *     flags a text as style, the style list's words become plain ones (plainWordsFor). Before the trims: "sixpence" is
 *     two words as "six coins".
 *  1. V06/V07 lengths over their caps are trimmed (trimToWords); an appearance keeps its attire word or is left alone.
 *     V06: an appearance that names nothing the portrait wears gains ", in <its first attire>" in its first sentence,
 *     if the cap allows (withAttireWord).
 *  2. Enums: relationship tags through the synonym table (an unknown tag with positive affinity becomes "fond"; with
 *     none, the tie is dropped unless it is required or the member's last); pronouns and story roles in another
 *     spelling; a routine verb in another spelling or through its synonym table, else "wander" (routineVerbFor). A
 *     required tie takes the tag the engine requires (kin).
 *     V10: a sample with two questions keeps its first, and a later one that reads as a statement ends in a full stop
 *     (oneQuestion); when fewer than two samples have a contraction, the ones without contract a common pair
 *     (CONTRACTIONS) until two do. Each edit is re-checked with V10's and V16's matchers.
 *  3. V13: a bare local place id takes its zone when exactly one place has it. Each day's routine takes V13's shape
 *     (repairDay: times, order, at most nine blocks, starting and ending at home), unless the engine writes that
 *     member's day (pupils, under-fives). A work block away from the workplace becomes a visit when the workplace is on
 *     an open board and the block isn't at home (a Tollman's Saturday round is work: isTollmenRound); otherwise V13
 *     judges it. Someone with no job works nowhere: a work block is a visit (housework at home, natives). V13n: a
 *     Millbrook or Station Hill day with no block on an open board moves its most suitable block to one (BOARD_PLACE).
 *  4. V14: ties to the member themself (slot or id), ties to anyone who isn't a resident or in the household, and
 *     second ties to one person are dropped; a housemate's slot becomes their id (the others' slots stay: assembly
 *     resolves them to the household tie); affinity and trust are rounded and held to tieLimit's range (±100 for the
 *     household and required ties, which keep their numbers). A member left with no tie gets the one assembly would
 *     add to a housemate, else (ctx.neighbours) a neutral one to a neighbour; with neither, the unknown ties stay for V14.
 *  5. V11: too few qualifying likes → the archetype's likes are added until enough qualify; the model's last
 *     non-qualifying likes go if the list would pass five.
 *  6. V08: Big Five rounded into 0–100; a member with no trait at 70+ or 30− has the closer of their highest and lowest
 *     moved to it; a member too close to an earlier one is nudged just apart (nudgeBig5).
 * Deterministic and idempotent: a repaired reply repairs to itself, and a reply that passes comes back equal.
 */
export function repairHousehold(raw: unknown, draw: HouseholdDraw, ctx: ValidationContext): HouseholdRepair {
  const adjustments: string[] = [];
  if (!isRec(raw)) return { output: raw, adjustments };
  const out = structuredClone(raw);
  const note = (line: string) => { adjustments.push(line); };
  const native = ctx.profile === "native";
  // The household's home: the draw's (a Day-1 household), else the context's (home.own for an arrival in the buffer).
  const home = draw.native?.home.id ?? ctx.home ?? HOME_TOKEN;
  const place = placeFixer(ctx, ctx.home ?? HOME_TOKEN);
  const housemateBySlot = new Map((draw.native?.housemates ?? []).map(h => [h.slot, h.id]));
  const pinnedBySlot = new Map(draw.members.flatMap(m => (m.native?.pinned ? [[m.slot, m.native.pinned.id] as const] : [])));
  const slots = new Set(draw.members.map(m => m.slot));
  const knownId = (id: string) => slots.has(id) || housemateBySlot.has(id) || ctx.residents.has(id);

  const trim = (holder: Rec, key: string | number, max: number, path: string, rule = "V07", fits?: (s: string) => boolean) => {
    const v = holder[key];
    if (!isStr(v)) return;
    const cut = trimToWords(v, max, fits);
    if (cut === v || (fits && !fits(cut))) return;
    holder[key] = cut;
    const sentences = rule === "V06" ? `; ${countSentences(v)} to ${countSentences(cut)} sentences` : "";
    note(`${rule} ${path} trimmed from ${countWords(v)} to ${countWords(cut)} words${sentences}`);
  };
  const trimAll = (list: unknown, max: number, path: string) => {
    if (Array.isArray(list)) list.forEach((_, k) => trim(list as unknown as Rec, k, max, `${path}[${k}]`));
  };
  type TextFix = (holder: unknown, key: string | number, path: string) => void;
  /** A V16 fix for one text: the swaps it makes, each `"from" → "to"`. */
  const v16Fix = (fix: (s: string) => { text: string; swaps: [string, string][] } | null): TextFix => (holder, key, path) => {
    if (!isRec(holder) && !Array.isArray(holder)) return;
    const h = holder as Rec;
    const v = h[key];
    if (!isStr(v)) return;
    const fixed = fix(v);
    if (!fixed) return;
    h[key] = fixed.text;
    note(`V16 ${path} ${fixed.swaps.map(([from, to]) => `${show(from)} → ${show(to)}`).join(", ")}`);
  };
  const coins = v16Fix(coinsFor);
  const banned = ctx.banned;
  const plain = banned ? v16Fix(s => plainWordsFor(s, banned)) : null;
  /** Every text V16 scans on a member but the name, in the validator's order (a dream stage copied from A.2 is skipped). */
  const eachV16Text = (m: Rec, at: string, authored: ReadonlySet<string>, fix: TextFix) => {
    const all = (list: unknown, path: string, skip: (s: unknown) => boolean = () => false) => {
      if (Array.isArray(list)) list.forEach((x, k) => { if (!skip(x)) fix(list, k, `${path}[${k}]`); });
    };
    for (const key of ["occupation", "appearance", "backstory"]) fix(m, key, `${at}.${key}`);
    for (const key of ["beliefs", "likes", "dislikes", "fears", "chores"]) all(m[key], `${at}.${key}`);
    if (isRec(m.voice)) { fix(m.voice, "register", `${at}.voice.register`); all(m.voice.tics, `${at}.voice.tics`); all(m.voice.samples, `${at}.voice.samples`); }
    if (isRec(m.dream)) { fix(m.dream, "text", `${at}.dream.text`); all(m.dream.stages, `${at}.dream.stages`, x => isStr(x) && authored.has(x)); }
    if (Array.isArray(m.relationships)) m.relationships.forEach((r: unknown, k) => fix(r, "note", `${at}.relationships[${k}].note`));
    if (Array.isArray(m.secrets)) m.secrets.forEach((x: unknown, k) => fix(x, "text", `${at}.secrets[${k}].text`));
  };

  if (isRec(out.household)) {
    coins(out.household, "summary", "household.summary");
    plain?.(out.household, "summary", "household.summary");
    trim(out.household, "summary", LENGTH_CAPS.summary, "household.summary");
  }
  const members = Array.isArray(out.members) ? out.members : [];
  members.forEach((m: unknown, i) => {
    if (!isRec(m)) return;
    const d = draw.members[i];
    const at = `members[${i}]`;
    // 0. Money, then the style list, in every text V16 scans but the name (and a dream stage copied from the archetype,
    // which it skips).
    const archetype = d ? memberArchetype(d, draw) : null;
    const authored = new Set(archetype ? archetype.dreams.flatMap(x => x.stages) : []);
    eachV16Text(m, at, authored, coins);
    if (plain) eachV16Text(m, at, authored, plain);
    // 1. Lengths, and the appearance naming what the portrait wears.
    trim(m, "occupation", LENGTH_CAPS.occupation, `${at}.occupation`);
    trim(m, "backstory", LENGTH_CAPS.backstory, `${at}.backstory`);
    if (isStr(m.appearance)) {
      const tags = d ? memberTags(d) : null;
      const attire = tags !== null && mentionsAttire(m.appearance, tags);
      trim(m, "appearance", LENGTH_CAPS.appearance, `${at}.appearance`, "V06", s => countSentences(s) <= APPEARANCE_SENTENCES && (!attire || mentionsAttire(s, tags!)));
      const dressed = tags && !attire ? withAttireWord(m.appearance as string, tags) : null;
      if (dressed) { note(`V06 ${at}.appearance ${show(m.appearance)} → ${show(dressed)} (names what the portrait wears)`); m.appearance = dressed; }
    }
    if (isRec(m.voice)) { trim(m.voice, "register", LENGTH_CAPS.register, `${at}.voice.register`); trimAll(m.voice.samples, LENGTH_CAPS.sample, `${at}.voice.samples`); }
    if (isRec(m.dream)) { trim(m.dream, "text", LENGTH_CAPS.dreamText, `${at}.dream.text`); trimAll(m.dream.stages, LENGTH_CAPS.stage, `${at}.dream.stages`); }
    if (Array.isArray(m.secrets)) m.secrets.forEach((s: unknown, k) => { if (isRec(s)) trim(s, "text", LENGTH_CAPS.secret, `${at}.secrets[${k}].text`); });

    // 2. Enums (relationship tags below, with the ties).
    if (isStr(m.pronouns) && !(PRONOUNS as readonly string[]).includes(m.pronouns)) {
      const p = pronounsOf(m.pronouns);
      if (p) { note(`V05 ${at}.pronouns ${show(m.pronouns)} → ${show(p)}`); m.pronouns = p; }
    }
    if (!(STORY_ROLES as readonly unknown[]).includes(m.story_role)) {
      const role = storyRoleOf(m.story_role);
      note(`V18 ${at}.story_role ${show(m.story_role)} → ${show(role)}`);
      m.story_role = role;
    }

    // 2b. Voice samples (V10): one question each, and two with a contraction.
    if (d && archetype && isRec(m.voice) && Array.isArray(m.voice.samples) && m.voice.samples.every(isStr)) {
      const samples = m.voice.samples as string[];
      const neverSays = Array.isArray(m.voice.never_says) ? m.voice.never_says.filter(isStr).filter(x => x.trim()) : [];
      const problems = (s: string): string[] => [
        ...neverSays.filter(n => s.toLowerCase().includes(n.toLowerCase())).map(n => `never_says ${n}`),
        ...(NOT_X_BUT_Y.test(s) ? ["not X, but Y"] : []), ...(banned ? banned(s) : []),
      ];
      /** An edit V10 or V16 would fail on something the sample didn't have before is no edit. */
      const clean = (before: string, after: string) => { const was = new Set(problems(before)); return problems(after).every(p => was.has(p)); };
      samples.forEach((s, k) => {
        const fixed = oneQuestion(s);
        if (fixed === null || !clean(s, fixed)) return;
        note(`V10 ${at}.voice.samples[${k}] ${show(s)} → ${show(fixed)} (one question)`);
        samples[k] = fixed;
      });
      // GDD-GAP: A.3.7 V10 fails samples a contraction short; the engine contracts the model's own words instead.
      const need = 2 - samples.filter(s => CONTRACTION.test(s)).length;
      if (!archetype.formal && d.band !== "child" && need > 0) {
        const edits: { k: number; from: string; to: string; text: string }[] = [];
        for (let k = 0; k < samples.length && edits.length < need; k++) {
          const s = samples[k]!;
          if (CONTRACTION.test(s)) continue;
          const edit = contractionsIn(s).map(c => ({ ...c, text: `${s.slice(0, c.start)}${c.to}${s.slice(c.end)}` })).find(c => clean(s, c.text) && CONTRACTION.test(c.text));
          if (edit) edits.push({ k, from: edit.from, to: edit.to, text: edit.text });
        }
        // Only when it gets V10 there: a sample changed for nothing is a change the retry has to read past.
        if (edits.length >= need) for (const e of edits) { note(`V10 ${at}.voice.samples[${e.k}] ${show(e.from)} → ${show(e.to)}`); samples[e.k] = e.text; }
      }
    }

    // 3. Places, and the routine's verbs and shape.
    if (isStr(m.workplace)) {
      const w = place(m.workplace);
      if (w !== m.workplace) { note(`V13 ${at}.workplace ${show(m.workplace)} → ${show(w)}`); m.workplace = w; }
    }
    // Where the member works: the census's assignment (native), or the card's own (an arrival; home.own is home).
    const workplace = native ? (d ? assignedWorkplace(d, home) : null) : isStr(m.workplace) ? m.workplace : null;
    const atWork = (day: "weekday" | "weekend", where: unknown) =>
      isStr(where) && ((native && where === HOME_TOKEN ? home : where) === workplace || (!!d && isTollmenRound(d, day, where)));
    if (isRec(m.routine)) for (const day of ["weekday", "weekend"] as const) {
      const list = m.routine[day];
      if (!Array.isArray(list)) continue;
      const path = `${at}.routine.${day}`;
      list.forEach((e: unknown, k) => {
        if (!isRec(e)) return;
        if (isStr(e.where)) {
          const w = place(e.where);
          if (w !== e.where) { note(`V13 ${path}[${k}].where ${show(e.where)} → ${show(w)}`); e.where = w; }
        }
        if (isStr(e.do) && !(VERBS as readonly string[]).includes(e.do)) {
          const { verb, known } = routineVerbFor(e.do, atWork(day, e.where));
          note(`V13 ${path}[${k}].do ${show(e.do)} → ${show(verb)}${known ? "" : " (not a verb the engine has)"}`);
          e.do = verb;
        }
      });
      // The engine writes a pupil's or an under-five's day (native), and V13 reads no member past the draw's.
      if (!d || (native && hasEngineRoutine(d))) continue;
      const away = native && isCommuter(d) && day === "weekday";
      const homes = new Set(native ? [home, HOME_TOKEN, ...(away ? ["offmap.city"] : [])] : [HOME_TOKEN]);
      const shaped = repairDay(list, path, homes, native ? home : HOME_TOKEN, note);
      m.routine[day] = shaped;
      // Work away from the workplace: there, but not working.
      const onBoard = workplace !== null && (OPEN_BOARDS as readonly string[]).includes(zoneOf(workplace));
      shaped.forEach((e, k) => {
        if (!onBoard || !isRec(e) || e.do !== "work" || !isStr(e.where) || homes.has(e.where) || atWork(day, e.where)) return;
        note(`V13 ${path}[${k}].do "work" → "visit" (at ${e.where}; their work is at ${workplace})`);
        e.do = "visit";
      });
      // No job, so no work: a visit, or (a native at home, which V13 fails too) the housework.
      // GDD-GAP: V13 fails work with no job; a carer's or a homemaker's work at home is the house's, so it's "clean".
      const jobless = native ? workplace === null : m.workplace === null;
      if (jobless) shaped.forEach((e, k) => {
        if (!isRec(e) || e.do !== "work" || !isStr(e.where)) return;
        const atHome = homes.has(e.where) && e.where !== "offmap.city";
        if (atHome && !native) return;
        const verb = atHome ? "clean" : "visit";
        note(`V13 ${path}[${k}].do "work" → ${show(verb)} (at ${e.where}; they have no job)`);
        e.do = verb;
      });
      // V13n: a Millbrook or Station Hill day (13 and over, not housebound, not a commuter's weekday) on an open board.
      const zone = draw.native?.zone;
      const board = (where: unknown) => isStr(where) && (OPEN_BOARDS as readonly string[]).includes(zoneOf(where === HOME_TOKEN ? home : where));
      if (native && (zone === "millbrook" || zone === "station_hill") && d.age >= 13 && d.age < HOUSEBOUND_AGE && !away && !shaped.some(e => isRec(e) && board(e.where))) {
        const target = (e: Rec): string | null => {
          const p = BOARD_PLACE[e.do as Verb] ?? BOARD_STREET;
          return ctx.places.has(p) && board(p) ? p : null;
        };
        const movable = shaped.map((e, k) => [e, k] as const).filter((x): x is readonly [Rec, number] => {
          const e = x[0];
          return isRec(e) && isStr(e.do) && isStr(e.where) && !homes.has(e.where) && !STAYS_PUT.has(e.do) && target(e) !== null;
        });
        // The most suitable: the first whose verb has a place of its own on the boards, else the first that moves at all.
        const pick = movable.find(([x]) => BOARD_PLACE[x.do as Verb]) ?? movable[0];
        if (pick) {
          const [e, k] = pick;
          const to = target(e)!;
          note(`V13n ${path}[${k}].where ${show(e.where)} → ${show(to)} (${e.do as string}; their day needs a block on an open board)`);
          e.where = to;
        }
      }
    }

    // 4. Relationships.
    if (d && Array.isArray(m.relationships)) m.relationships = repairTies(m.relationships, i, m, `${at}.relationships`);

    // 5. Likes.
    if (d && Array.isArray(m.likes) && m.likes.every(isStr)) {
      const a = memberArchetype(d, draw);
      const rule = likeRule(a, ctx);
      const likes: string[] = [...m.likes];
      let have = likes.filter(rule.qualifies).length;
      if (have < rule.need) {
        const lower = (s: string) => s.trim().toLowerCase();
        const dislikes = new Set((Array.isArray(m.dislikes) ? m.dislikes.filter(isStr) : []).map(lower));
        const added: string[] = [];
        for (const l of a.likes) {
          if (have >= rule.need) break;
          if (likes.some(x => lower(x) === lower(l)) || dislikes.has(lower(l))) continue;
          likes.push(l); added.push(l); have++;
        }
        const dropped: string[] = [];
        for (let k = m.likes.length - 1; k >= 0 && likes.length > LIKES_RANGE[1]; k--) {
          if (rule.qualifies(likes[k]!)) continue;
          dropped.unshift(likes[k]!);
          likes.splice(k, 1);
        }
        if (added.length) {
          note(`V11 ${at}.likes: added ${added.map(show).join(", ")} from the archetype's list${dropped.length ? `; dropped ${dropped.map(show).join(", ")} to stay within ${LIKES_RANGE[1]}` : ""}`);
          m.likes = likes;
        }
      }
    }
  });

  // 6. Big Five.
  const scores: (Big5 | null)[] = members.map((m: unknown, i) => {
    const b = isRec(m) && isRec(m.personality) && isRec(m.personality.big5) ? m.personality.big5 : null;
    if (!b || !BIG5_KEYS.every(k => typeof b[k] === "number" && Number.isFinite(b[k]))) return null;
    for (const k of BIG5_KEYS) {
      const v = b[k] as number, next = Math.max(0, Math.min(100, Math.round(v))) || 0;
      if (next !== v) { note(`V08 members[${i}].personality.big5.${k} ${v} → ${next}`); b[k] = next; }
    }
    return b as Big5;
  });
  // V08's one trait at 70+ or 30-: the highest up to 70 or the lowest down to 30, whichever is the smaller move (a tie
  // raises; the first such trait in the contract's order).
  scores.forEach((b, i) => {
    if (!b || extreme(b)) return;
    const hi = BIG5_KEYS.reduce((a, k) => (b[k] > b[a] ? k : a)), lo = BIG5_KEYS.reduce((a, k) => (b[k] < b[a] ? k : a));
    const [k, to] = 70 - b[hi] <= b[lo] - 30 ? [hi, 70] : [lo, 30];
    note(`V08 members[${i}].personality.big5.${k} ${b[k]} → ${to} (one trait at 70+ or 30-)`);
    b[k] = to;
  });
  scores.forEach((me, j) => {
    if (!me || j === 0) return;
    const earlier = scores.slice(0, j).map((b, i) => [b, i] as const).filter((x): x is readonly [Big5, number] => !!x[0]);
    const close = earlier.filter(([b]) => !big5Apart(vec(me), vec(b))).map(([, i]) => `members[${i}]`);
    if (!close.length) return;
    const next = nudgeBig5(me, earlier.map(([b]) => b), SeededRng.of(draw.id, "big5", j));
    if (!next) return;
    const moved = BIG5_KEYS.filter(k => next[k] !== me[k]).map(k => `${k} ${me[k]} → ${next[k]}`);
    note(`V08 members[${j}].personality.big5 nudged apart from ${close.join(", ")}: ${moved.join(", ")}`);
    for (const k of BIG5_KEYS) me[k] = next[k];
  });
  return { output: out, adjustments };

  /** A member as a household tie's end (cardsFromHousehold's: the canon name when pinned, the census age when native). */
  function tieEnd(j: number): TieEnd {
    const dj = draw.members[j]!, mj = members[j];
    const p = isRec(mj) && isStr(mj.pronouns) ? ((PRONOUNS as readonly string[]).includes(mj.pronouns) ? mj.pronouns : pronounsOf(mj.pronouns)) : null;
    const name = dj.native?.pinned?.name ?? (isRec(mj) && isStr(mj.name) ? mj.name : "");
    const age = native ? dj.age : isRec(mj) && typeof mj.age === "number" ? mj.age : dj.age;
    return { slot: dj.slot, role: dj.role, pronouns: p ?? dj.pronoun_default, age, surname: surnameOfName(name) };
  }

  /**
   * V14's floor for member `i` when no tie of theirs names anyone in Monde: the tie assembly adds to the first housemate
   * by slot (a member written now, by slot; a carded housemate, by id), else a neutral tie to the first of
   * ctx.neighbours in their zone or at their workplace. Null: neither (V14 then names the ties).
   * GDD-GAP: A.3.7 V14 fails a tie to an unknown id and fails a card with none. A.3.4 rule 2 gives everyone their
   * household's ties, so that one is no invention; a lone member's neighbour tie (friend, 20/20, "A neighbour.") is
   * the engine's smallest claim, and its adjustment says so.
   */
  function floorTie(i: number, m: Rec): { tie: Rec; why: string } | null {
    const d = draw.members[i]!;
    const others = [
      ...draw.members.map((o, j) => ({ slot: o.slot, id: o.slot, end: () => tieEnd(j) })).filter(o => o.slot !== d.slot),
      ...(draw.native?.housemates ?? []).map(h => ({ slot: h.slot, id: h.id, end: (): TieEnd => ({ slot: h.slot, role: h.role, pronouns: h.pronouns, age: h.age, surname: surnameOfName(h.name) }) })),
    ].sort((a, b) => a.slot.localeCompare(b.slot, "en", { numeric: true }));
    const mate = others[0];
    if (mate && !native) return { tie: { id: mate.id, ...ARRIVAL_HOUSEHOLD_TIE }, why: "the household tie" };
    if (mate) {
      const word = draw.native?.ties.find(t => (t.a === d.slot && t.b === mate.slot) || (t.b === d.slot && t.a === mate.slot))?.word;
      const t = householdTieFor(tieEnd(i), mate.end(), word);
      return { tie: { id: mate.id, affinity: t.affinity, trust: t.trust, tag: t.word === "flatmate" ? "friend" : "kin", note: t.note }, why: `the household tie (${t.word})` };
    }
    const zone = draw.native?.zone ?? (ctx.home && ctx.home !== HOME_TOKEN ? zoneOf(ctx.home) : null);
    const wp = native ? assignedWorkplace(d, home) : isStr(m.workplace) ? m.workplace : null;
    const work = wp && wp !== home && wp !== HOME_TOKEN && wp !== "offmap.city" ? wp : null;
    const inside = householdIds(draw);
    const n = (ctx.neighbours ?? []).find(x => ctx.residents.has(x.id) && !inside.has(x.id) && ((zone !== null && x.zone === zone) || (work !== null && x.workplace === work)));
    if (!n) return null;
    return { tie: { id: n.id, affinity: 20, trust: 20, tag: "friend", note: "A neighbour." }, why: `a neutral tie to a neighbour ${n.zone === zone ? `in ${zone}` : `at ${work}`}` };
  }

  /** Step 4 for one member's ties (and their tags, step 2). */
  function repairTies(list: unknown[], i: number, m: Rec, path: string): unknown[] {
    const ownSlot = draw.members[i]!.slot, ownId = draw.members[i]!.native?.pinned?.id ?? null;
    const required = native ? (ctx.requiredLinks ?? []).filter(l => l.slot === ownSlot) : [];
    // V14's own test (a household slot or a resident), and the household's and the required ties, which always stay.
    const inside = householdIds(draw);
    const known = (id: string) => slots.has(id) || ctx.residents.has(id) || inside.has(id) || required.some(l => l.id === id);
    let unique: unknown[] = [];
    const unknown: Rec[] = [];
    const seen = new Set<string>();
    for (const r of list) {
      if (!isRec(r) || !isStr(r.id)) { unique.push(r); continue; }
      const before = r.id;
      let id = before.trim();
      if (!knownId(id) && knownId(id.toLowerCase())) id = id.toLowerCase();
      const mate = housemateBySlot.get(id);
      if (mate) id = mate;
      if (id !== before) { note(`V14 ${path} ${show(before)} → ${show(id)}${mate ? " (a housemate's slot)" : ""}`); r.id = id; }
      if (id === ownSlot || id === ownId) { note(`V14 ${path}: dropped the tie to themself (${show(before)})`); continue; }
      if (!known(id)) unknown.push(r);
      else {
        const who = pinnedBySlot.get(id) ?? id;
        if (seen.has(who)) { note(`V14 ${path}: dropped a second tie to ${show(id)}`); continue; }
        seen.add(who);
      }
      unique.push(r);
    }
    // Ties to nobody in Monde go when the member keeps one (or gets V14's floor); otherwise they stay for V14 to name.
    const rest = unique.filter(r => !unknown.includes(r as Rec));
    const floor = rest.length < TIES_RANGE[0] ? floorTie(i, m) : null;
    if (unknown.length && (floor || rest.length >= TIES_RANGE[0])) {
      for (const r of unknown) note(`V14 ${path}: dropped the tie to ${show(r.id)} (not a resident or a household slot)`);
      unique = rest;
    }
    if (floor && unique.length < TIES_RANGE[0]) {
      note(`V14 ${path}: added ${show(floor.tie.id)} (engine-added: ${floor.why})`);
      unique.push(floor.tie);
    }
    const kept: unknown[] = [];
    let left = unique.length;
    for (const r of unique) {
      if (!isRec(r)) { kept.push(r); continue; }
      const id = isStr(r.id) ? r.id : "";
      const tie = `${path} ${show(id)}`;
      const need = required.find(l => l.id === id);
      if (!(RELATION_TAGS as readonly unknown[]).includes(r.tag)) {
        const mapped = relationTagOf(r.tag);
        if (mapped) { note(`V01 ${tie}.tag ${show(r.tag)} → ${show(mapped)}`); r.tag = mapped; }
        else if (!need?.tag) {
          // Not a word the table knows (a required kin tie takes "kin" below): warm means fond; otherwise the tie goes,
          // unless it is required or the member's last (V01 then says why).
          if (typeof r.affinity === "number" && r.affinity > 0) { note(`V01 ${tie}.tag ${show(r.tag)} → "fond" (not a tag; positive affinity)`); r.tag = "fond"; }
          else if (!need && left > 1) { note(`V01 ${tie}: dropped (${show(r.tag)} is not a tag, affinity ${show(r.affinity)})`); left--; continue; }
        }
      }
      if (need?.tag && r.tag !== need.tag) { note(`V14 ${tie}.tag ${show(r.tag)} → ${show(need.tag)} (a required ${need.tag} tie)`); r.tag = need.tag; }
      const lim = tieLimit(id, ownSlot, draw, ctx);
      for (const key of ["affinity", "trust"] as const) {
        const v = r[key];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const next = bound(v, lim);
        if (next !== v) { note(`V14 ${tie}.${key} ${v} → ${next}${Math.abs(Math.round(v)) > lim ? ` (within ±${lim})` : ""}`); r[key] = next; }
      }
      kept.push(r);
    }
    return kept;
  }
}
