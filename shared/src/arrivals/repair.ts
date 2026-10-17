// Repairing a household reply before it is validated (GDD Appendix A.3.7; §9.10.2: the model proposes, the engine
// disposes). The household cards come back as text (householdJson.ts), and a staging trial (2026-10-17) failed every
// household six times on things the engine can put right without inventing anything: a summary or backstory a little
// over its cap, a tie tagged "brother" or "neighbour", a routine at "market_street", a required tie at the hand-written
// card's 70, a member tied to their own slot, likes that miss the archetype's list, two members' Big Five a few points
// apart. A full census run (2026-10-17) then still fell back to the template for 35 of 107 households, on more slips of
// the same kind: elders reminiscing in pennies (V16's money), a verb the engine doesn't have, ten routine blocks, a
// block past 26:00 or out of order, a day that doesn't start or end at home, a work block away from the workplace.
// repairHousehold fixes those deterministically and lists each change; validateHousehold then judges what is left, and
// only that goes back to the model on a retry. Names, canon, novelty and the rest of banned language (V02, V03,
// V15–V19) stay with the validator and the retry loop, and so does anything that needs new content (V10's
// contractions). Pure: no I/O, and the input is never mutated.
import { OPEN_BOARDS } from "../census/day1Tables";
import { VERBS, type Verb } from "../verbs";
import {
  APPEARANCE_SENTENCES, BIG5_APART, BIG5_KEYS, DAY_END_MINUTES, HOME_TOKEN, LENGTH_CAPS, LIKES_RANGE, PRONOUNS, RELATION_TAGS, ROUTINE_BLOCKS,
  ROUTINE_TIME, STORY_ROLES, assignedWorkplace, big5Apart, countSentences, countWords, hasEngineRoutine, isCommuter, isTollmenRound, likeRule,
  memberArchetype, memberTags, mentionsAttire, routineClock, tieLimit, type Big5Key, type ValidationContext,
} from "./card";
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
 *  0. V16: money words in every text V16 scans (all but the name) become coins (coinsFor). Before the trims: "sixpence"
 *     is two words as "six coins".
 *  1. V06/V07 lengths over their caps are trimmed (trimToWords); an appearance keeps its attire word or is left alone.
 *  2. Enums: relationship tags through the synonym table (an unknown tag with positive affinity becomes "fond"; with
 *     none, the tie is dropped unless it is required or the member's last); pronouns and story roles in another
 *     spelling; a routine verb in another spelling or through its synonym table, else "wander" (routineVerbFor). A
 *     required tie takes the tag the engine requires (kin).
 *  3. V13: a bare local place id takes its zone when exactly one place has it. Each day's routine takes V13's shape
 *     (repairDay: times, order, at most nine blocks, starting and ending at home), unless the engine writes that
 *     member's day (pupils, under-fives). A work block away from the workplace becomes a visit when the workplace is on
 *     an open board and the block isn't at home (a Tollman's Saturday round is work: isTollmenRound); otherwise V13
 *     judges it.
 *  4. V14: ties to the member themself (slot or id) and second ties to one person are dropped; a housemate's slot
 *     becomes their id (the others' slots stay: assembly resolves them to the household tie); affinity and trust are
 *     rounded and held to tieLimit's range (±100 for the household and required ties, which keep their numbers).
 *  5. V11: too few qualifying likes → the archetype's likes are added until enough qualify; the model's last
 *     non-qualifying likes go if the list would pass five.
 *  6. V08: Big Five rounded into 0–100, and a member too close to an earlier one nudged just apart (nudgeBig5).
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
  const coins = (holder: unknown, key: string | number, path: string) => {
    if (!isRec(holder) && !Array.isArray(holder)) return;
    const h = holder as Rec;
    const v = h[key];
    if (!isStr(v)) return;
    const fixed = coinsFor(v);
    if (!fixed) return;
    h[key] = fixed.text;
    note(`V16 ${path} ${fixed.swaps.map(([from, to]) => `${show(from)} → ${show(to)}`).join(", ")}`);
  };
  const coinsAll = (list: unknown, path: string, skip: (s: unknown) => boolean = () => false) => {
    if (Array.isArray(list)) list.forEach((x, k) => { if (!skip(x)) coins(list, k, `${path}[${k}]`); });
  };

  if (isRec(out.household)) {
    coins(out.household, "summary", "household.summary");
    trim(out.household, "summary", LENGTH_CAPS.summary, "household.summary");
  }
  const members = Array.isArray(out.members) ? out.members : [];
  members.forEach((m: unknown, i) => {
    if (!isRec(m)) return;
    const d = draw.members[i];
    const at = `members[${i}]`;
    // 0. Money, in every text V16 scans but the name (and a dream stage copied from the archetype, which it skips).
    const authored = new Set(d ? memberArchetype(d, draw).dreams.flatMap(x => x.stages) : []);
    for (const key of ["occupation", "appearance", "backstory"]) coins(m, key, `${at}.${key}`);
    for (const key of ["beliefs", "likes", "dislikes", "fears", "chores"]) coinsAll(m[key], `${at}.${key}`);
    if (isRec(m.voice)) { coins(m.voice, "register", `${at}.voice.register`); coinsAll(m.voice.tics, `${at}.voice.tics`); coinsAll(m.voice.samples, `${at}.voice.samples`); }
    if (isRec(m.dream)) { coins(m.dream, "text", `${at}.dream.text`); coinsAll(m.dream.stages, `${at}.dream.stages`, x => isStr(x) && authored.has(x)); }
    if (Array.isArray(m.relationships)) m.relationships.forEach((r: unknown, k) => coins(r, "note", `${at}.relationships[${k}].note`));
    if (Array.isArray(m.secrets)) m.secrets.forEach((x: unknown, k) => coins(x, "text", `${at}.secrets[${k}].text`));
    // 1. Lengths.
    trim(m, "occupation", LENGTH_CAPS.occupation, `${at}.occupation`);
    trim(m, "backstory", LENGTH_CAPS.backstory, `${at}.backstory`);
    if (isStr(m.appearance)) {
      const tags = d ? memberTags(d) : null;
      const attire = tags !== null && mentionsAttire(m.appearance, tags);
      trim(m, "appearance", LENGTH_CAPS.appearance, `${at}.appearance`, "V06", s => countSentences(s) <= APPEARANCE_SENTENCES && (!attire || mentionsAttire(s, tags!)));
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
    }

    // 4. Relationships.
    if (d && Array.isArray(m.relationships)) m.relationships = repairTies(m.relationships, d.slot, d.native?.pinned?.id ?? null, `${at}.relationships`);

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

  /** Step 4 for one member's ties (and their tags, step 2). */
  function repairTies(list: unknown[], ownSlot: string, ownId: string | null, path: string): unknown[] {
    const unique: unknown[] = [];
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
      const who = pinnedBySlot.get(id) ?? id;
      if (seen.has(who)) { note(`V14 ${path}: dropped a second tie to ${show(id)}`); continue; }
      seen.add(who);
      unique.push(r);
    }
    const required = native ? (ctx.requiredLinks ?? []).filter(l => l.slot === ownSlot) : [];
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
