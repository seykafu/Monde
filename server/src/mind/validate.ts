/**
 * The dialogue validation pipeline (GDD §9.13, §9.10, §14.2). Every model output goes through these steps in
 * order; the first hard failure stops the pipeline and the caller regenerates once, then falls back:
 *
 *   1. schema      JSON.parse + zod DialogueTurnOutput, at least one non-empty line             (fail: "schema")
 *   2. clamps      clampDialogue (Heart perk off until skills land), topic length, choice ids,
 *                  favor template must be an MVP template the model may propose; choices made
 *                  2–3 distinct replies with at most one goodbye, padded from the last line   (adjusts)
 *   3. portraits   each expr must be in the card's portrait_expressions, else mapped from
 *                  the resident's current emotion (§9.4)                                       (adjusts)
 *   4. lexical     profanity, modern tech, brands, self-reference, house style (filters.ts)   (fail: "lexical:<group>")
 *   5. riddle      only on riddle-topic turns: no line, choice or favor text may contain an
 *                  accepted answer from the server-side record (§14.2)                        (fail: "riddle")
 *   6. secrets     reveal_secret must be one of the revealable ids, else null                 (adjusts)
 *   7. echo        word-trigram overlap with the resident's last 20 lines must be ≤ 0.35      (fail: "echo")
 *
 * Then the soft checks (MVP Q-01). They regenerate once with a note, like any failure, but a turn that still trips
 * one is accepted rather than swapped for an authored line (dialogue.ts): the slip is in voice, a fallback isn't.
 *   8. misgender   no line may gender the Fellow wrongly where it's tied to "you": a
 *                  vocative ("Sit, lad."), "you're a good lad", "a man like you", "Mr. Wren"
 *                  against the Fellowship form's pronouns (naming.ts)                         (soft: "misgender")
 *      never_says  nor use a word or phrase on the resident's card's never_says               (soft: "never_says")
 *      currency    nor money that isn't Monde's: shillings, pence, pennies, dollars, quid,
 *                  cents, "five pounds" (filters.ts currencyHit)                              (soft: "currency")
 *      borrowed    nor another resident's signature phrase (voice.ts)                         (soft: "borrowed")
 *      tic_repeat  nor one of the resident's own a second time in this conversation          (soft: "tic_repeat")
 *   9. samples     no line may echo one of the resident's own card samples: a whole sample
 *                  sentence of four words or more, verbatim or but for one word (prices and
 *                  counts included), trigram overlap above 0.35, a run of six or more words
 *                  lifted from one, a distinctive run of four or five (two distinctive words,
 *                  no price or count), or most of a line's distinctive words from one sample  (soft: "sample_echo")
 *  10. exit_tic    a tic the card saves for leaving (June's "Anyway.") outside the turn that
 *                  sees the Fellow off: stripped in step 2 where it stands as a sentence of
 *                  its own and the line survives; anything left is a soft failure              (soft: "exit_tic")
 *
 * Every soft slip a turn has is collected (`slips`), so the one regeneration's note names them all (softNote), and
 * the note always sends the retry back to answering the Fellow's line first. When the retry slips too, the attempt
 * with fewer slips is kept (dialogue.ts).
 *
 * Step 2 also turns *asterisk* stage business into the house style's (parentheses) (adjusts).
 *
 * Canon checks (§9.13 step 3) are rules built from canon_locks and arrive with their content; nothing here
 * pretends to do them. Favor feasibility is M-09: favors are stored as "proposed".
 */
import {
  DialogueTurnOutput, MVP_FAVOR_TEMPLATES, callName, clampDialogue, normalizeChoices, type Emotion, type PersonaCard,
} from "@monde/shared";
import { containsAnswer } from "./promptBuilder.js";
import { checkedExpression } from "./expressions.js";
import { currencyHit, lexicalHits, type FilterGroup } from "./filters.js";
import { agreeAddress, misgenderHit, pronounRule, type FellowView } from "./naming.js";
import type { RiddleRecord } from "./riddles.js";
import { borrowedHits, stripTics, type Signature } from "./voice.js";

export type ValidationCategory = "schema" | `lexical:${FilterGroup}` | "riddle" | "echo" | SoftCategory;
/** Checks that regenerate once and then accept (dialogue.ts), never fall back. */
export type SoftCategory = "misgender" | "never_says" | "currency" | "borrowed" | "tic_repeat" | "sample_echo" | "exit_tic";
/** One soft check a turn failed, with what tripped it. */
export interface Slip { category: SoftCategory; detail: string }

export interface ValidationContext {
  /** The name fills `{name}` in padded replies; kind keeps an animal's own expressions. */
  card: Pick<PersonaCard, "portrait_expressions"> & Partial<Pick<PersonaCard, "name" | "kind">>;
  /** The resident's current emotion, for mapping missing expressions. */
  emotion: Emotion;
  /** Secret ids the engine allows this turn (revealableSecrets). */
  revealable: ReadonlySet<string>;
  /** Set only on riddle-topic turns. */
  riddle: RiddleRecord | null;
  hintsAllowed?: number;
  /** The resident's most recent lines, newest first (the echo window). */
  recentLines: readonly string[];
  /** Other residents' signature phrases this resident must not borrow (voice.ts borrowedFor). */
  borrowed?: readonly Signature[];
  /** The resident's own signature phrases (voice.ts ownSignatures): each at most once per conversation. */
  own?: readonly Signature[];
  /** What the resident has said so far in this conversation, oldest first. */
  conversationLines?: readonly string[];
  /** The resident's own card samples: tone, never script (step 9). */
  samples?: readonly string[];
  /** The resident's own words (cardVocabulary), which never make a sample lift distinctive (step 9). */
  vocabulary?: readonly string[];
  /** The resident's own tics: a sample sentence that is one of them ("I never shoot at people.") may be said (step 9). */
  tics?: readonly string[];
  /** The card's never_says: words and phrases this resident never uses (step 8). */
  neverSays?: readonly string[];
  /** Who the Fellow is, from the Fellowship form (step 8, misgender). */
  fellow?: FellowView;
  /** Tics the card saves for leaving (voice.ts exitOnlyTics; step 10). */
  exitOnly?: readonly Signature[];
  /** This turn sees the Fellow off (focus "bye", or the forced last exchange). A turn that sets wrap_up counts too. */
  exit?: boolean;
  /** Heart skill perk widens the Regard clamp to ±7 (§9.10.2). Skills aren't built yet: false. */
  heartPerk?: boolean;
}

export type ValidationResult =
  | { ok: true; output: DialogueTurnOutput; adjustments: string[] }
  | {
    ok: false; category: ValidationCategory; detail: string;
    /**
     * Set when only soft checks failed: the otherwise valid turn, to keep if the regeneration fails too, and every
     * slip it has (`category` and `detail` are the first).
     */
    soft?: { output: DialogueTurnOutput; adjustments: string[]; slips: Slip[] };
  };

/** §9.10 "Echo check": above this overlap with a recent line, regenerate. */
export const ECHO_THRESHOLD = 0.35;
/** §9.10: compared against the resident's last 20 lines. */
export const ECHO_WINDOW = 20;
/** GDD-GAP: §9.10.2 calls the topic "a short tag" with no length; 60 characters keeps already_discussed short. */
export const TOPIC_CHARS = 60;
/**
 * GDD-GAP: §9.10 sets only the 0.35 overlap for echoes. A card sample is quoted verbatim mostly as one long phrase
 * inside a longer line ("you look like a coat on a hook"), which a share of trigrams misses, so a run of this many
 * words lifted from one sample counts too. Five catches ordinary prices and counts ("rye's two coins, white's
 * three"), which residents may repeat; six is a quotation.
 */
export const SAMPLE_RUN_WORDS = 6;

const CHOICE_IDS = ["a", "b", "c"] as const;
const PROPOSABLE_FAVORS: ReadonlySet<string> = new Set(MVP_FAVOR_TEMPLATES.filter((t) => t !== "last_chance"));

function normalizeWords(text: string): string[] {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
}

export function wordTrigrams(text: string): Set<string> {
  const words = normalizeWords(text);
  const grams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return grams;
}

/**
 * The share of a line's word trigrams that already appear in one earlier line (the worst match wins). Lines under
 * three words have no trigrams and never count as echoes, so "Hm." may recur.
 */
export function echoOverlap(line: string, previous: readonly string[]): number {
  const grams = wordTrigrams(line);
  if (grams.size === 0) return 0;
  let worst = 0;
  for (const earlier of previous) {
    const other = wordTrigrams(earlier);
    let shared = 0;
    for (const gram of grams) if (other.has(gram)) shared++;
    worst = Math.max(worst, shared / grams.size);
  }
  return worst;
}

/**
 * The longest run of consecutive words in `line` that also appears in `other`, in words (counted by trigrams, so
 * runs under three words are 0).
 */
export function sharedRun(line: string, other: string): number {
  const words = normalizeWords(line);
  const grams = wordTrigrams(other);
  let best = 0;
  let streak = 0;
  for (let i = 0; i + 2 < words.length; i++) {
    streak = grams.has(`${words[i]} ${words[i + 1]} ${words[i + 2]}`) ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  return best === 0 ? 0 : best + 2;
}

/**
 * GDD-GAP: §9.10 has no rule for a short lift. The 2026-10-16 eval caught Odile turning her sample "Sit or don't, but
 * don't block the door." into "Sit, petite, if you're staying. Don't block the door.": a four-word run and a third of
 * the trigrams, under both limits above. So a shorter run counts when it's distinctive (this many words or more,
 * with at least two distinctive words, and no price or count in it: "rye's two coins, white's three" may recur), and
 * so does a line whose distinctive words come mostly from one sample (SAMPLE_WORD_SHARE of them, and at least
 * SAMPLE_WORDS_SHARED). A distinctive word is a content word that isn't a price, a count, a weekday, a name, or the
 * resident's own vocabulary (their register, tics, chores and likes: Pell counting the lamps at dusk is her chore,
 * not a quotation; `cardVocabulary`).
 */
export const SAMPLE_DISTINCT_RUN = 4;
/**
 * GDD-GAP: §9.10 doesn't say how much of a sample may come back. The blind A/B eval (2026-10-16) caught Odile opening
 * with two whole sample sentences ("Rye's two coins, white's three. Today it's rye."; "Eat something, you look like
 * a coat on a hook."), so a sample sentence of SAMPLE_SENTENCE_WORDS or more is a hit whatever prices or counts it
 * holds: verbatim, or (from SAMPLE_SENTENCE_SLACK_WORDS up) with one word added, dropped or changed. Shorter price
 * fragments ("Rye. Two coins.") still pass, and so does a sample sentence that is mostly the resident's own tic
 * ("May I be frank, Fellow?" is Vane's tic and a name).
 */
export const SAMPLE_SENTENCE_WORDS = 4;
export const SAMPLE_SENTENCE_SLACK_WORDS = 7;
export const SAMPLE_WORD_SHARE = 0.5;
export const SAMPLE_WORDS_SHARED = 3;

/** Words that carry no voice of their own: function words, contractions, and the Fellow's address terms. */
const STOPWORDS: ReadonlySet<string> = new Set((
  "a an the and or but if so as at by for from in into of off on onto out over to up with without about after before "
  + "than then too very just only also even still yet again here there this that these those it it's its is are was "
  + "were be been being am do does did don't doesn't didn't done have has had haven't hasn't i i'm i'll i'd i've me "
  + "my mine you you're you'll you'd you've your yours he he's him his she she's her hers we we're us our they "
  + "they're them their what what's who who's whom how when where why which all any some no not nor never can can't "
  + "could couldn't would wouldn't should shouldn't will won't shall may might must let's that's there's here's "
  + "oh ah well yes yeah now one ones get got go going gone come came say said see saw know like way thing things "
  + "fellow petit petite friend dear pet"
).split(" "));
/** Prices, counts, days and "time": facts a resident may repeat in their own words (World Bible: "two coins a loaf"). */
const COUNT_WORDS: ReadonlySet<string> = new Set((
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen "
  + "eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand half quarter dozen "
  + "coin coins penny monday tuesday wednesday thursday friday saturday sunday time"
).split(" "));

/** A word with its possessive dropped ("rye's" → "rye"), for comparing content words. */
const stem = (word: string): string => word.replace(/'s$/, "");
const isCount = (word: string): boolean => /^\d/.test(word) || COUNT_WORDS.has(stem(word));
const isContent = (word: string): boolean => !STOPWORDS.has(word) && !isCount(word) && word.length > 1;

/** Names: words written with a capital inside a sentence ("Hollis Brandt would tell you"), lower-cased and stemmed. */
function names(text: string): Set<string> {
  const out = new Set<string>();
  for (const sentence of text.replace(/[’‘]/g, "'").split(/(?<=[.!?…)])\s+/)) {
    const words = sentence.replace(/^[^\p{L}]+/u, "").split(/[^\p{L}']+/u).filter(Boolean);
    for (const word of words.slice(1)) if (/^\p{Lu}/u.test(word)) out.add(stem(word.toLowerCase()));
  }
  return out;
}

/** The words a card gives its resident to use (register, tics, chores, likes), stemmed, for `sampleEcho`. */
export function cardVocabulary(card: Pick<PersonaCard, "voice" | "chores" | "likes">): string[] {
  const text = [card.voice.register, ...card.voice.tics, ...card.chores, ...card.likes].join(" ");
  return [...new Set(normalizeWords(text).filter(isContent).map(stem))].sort();
}

/** Word-level edit distance (insert, delete, substitute), for near-verbatim sentences. */
function editDistance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * The first sentence of `sample` (SAMPLE_SENTENCE_WORDS or more, and more than the resident's own tics) that the
 * line reproduces: verbatim, or but for one word once the sentence has SAMPLE_SENTENCE_SLACK_WORDS. Null if none.
 */
export function sampleSentenceHit(line: string, sample: string, tics: readonly string[] = []): string | null {
  const words = normalizeWords(line);
  const ticWords = new Set(tics.flatMap((tic) => normalizeWords(tic)));
  // Sentence ends, but not "Mr." or "St." inside one.
  for (const sentence of sample.replace(/[’‘]/g, "'").split(/(?<=[.!?…])(?<!\b(?:Mr|Mrs|Ms|Dr|St)\.)\s+/)) {
    const target = normalizeWords(sentence);
    if (target.length < SAMPLE_SENTENCE_WORDS || target.filter((word) => !ticWords.has(word)).length < 2) continue;
    const slack = target.length >= SAMPLE_SENTENCE_SLACK_WORDS ? 1 : 0;
    for (let size = target.length - slack; size <= target.length + slack; size++) {
      for (let i = 0; i + size <= words.length; i++) {
        if (editDistance(words.slice(i, i + size), target) <= slack) return sentence.trim().replace(/^[^\p{L}\p{N}(]+/u, "");
      }
    }
  }
  return null;
}

/** Every maximal run (three words or more) of `line` that also appears in `other`, as word lists. */
export function sharedRuns(line: string, other: string): string[][] {
  const words = normalizeWords(line);
  const grams = wordTrigrams(other);
  const runs: string[][] = [];
  let start = -1;
  // One step past the last trigram, so a run that reaches the end is closed too.
  for (let i = 0; i <= words.length - 2; i++) {
    const hit = i + 2 < words.length && grams.has(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    if (hit && start < 0) start = i;
    // The last matching trigram started at i - 1, so the run ends with word i + 1.
    if (!hit && start >= 0) { runs.push(words.slice(start, i + 2)); start = -1; }
  }
  return runs;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `sample` without the resident's own tics, which are theirs to say even where a sample holds one (Nettie's "I never
 * shoot at people." opens her sample). A tic of two words or more goes wherever it appears; a one-word tic only where
 * it stands as a sentence ("Hm.").
 */
function withoutTics(sample: string, tics: readonly string[]): string {
  let out = sample.replace(/[’‘]/g, "'");
  for (const tic of tics) {
    const words = normalizeWords(tic).map(escapeRegex);
    if (words.length === 0) continue;
    const body = words.join("[^\\p{L}\\p{N}']+");
    const pattern = words.length > 1
      ? new RegExp(`(?<![\\p{L}\\p{N}'])${body}(?![\\p{L}\\p{N}'])[.!?…]*`, "giu")
      : new RegExp(`(?<=^|[.!?…)]\\s*)\\s*${body}\\s*[.!?…]+`, "giu");
    out = out.replace(pattern, " ");
  }
  return out;
}

/**
 * The first of `samples` a line echoes (step 9), with why, or null; the detail opens with the lifted words in quotes
 * when there are some to name. `vocabulary` is the resident's own words (`cardVocabulary`), which never make a lift
 * distinctive; `tics` are theirs to say even where a sample holds one.
 */
export function sampleEcho(
  line: string, samples: readonly string[], vocabulary: readonly string[] = [], tics: readonly string[] = [],
): string | null {
  const own = new Set(vocabulary);
  const compared = samples.map((sample) => ({ sample, text: withoutTics(sample, tics) }));
  for (const { sample, text } of compared) {
    const sentence = sampleSentenceHit(line, text, tics);
    if (sentence) return `"${sentence}" (a whole sample sentence): ${sample}`;
  }
  for (const { sample, text: compare } of compared) {
    const overlap = echoOverlap(line, [compare]);
    const run = sharedRun(line, compare);
    if (overlap > ECHO_THRESHOLD || run >= SAMPLE_RUN_WORDS) return `${overlap.toFixed(2)}/${run} words: ${sample}`;
    const named = new Set([...names(line), ...names(sample)]);
    const distinctive = (word: string): boolean => isContent(word) && !own.has(stem(word)) && !named.has(stem(word));
    const lifted = sharedRuns(line, compare).find((words) => words.length >= SAMPLE_DISTINCT_RUN
      && !words.some(isCount) && words.filter(distinctive).length >= 2);
    if (lifted) return `"${lifted.join(" ")}": ${sample}`;
    const mine = [...new Set(normalizeWords(line).filter(distinctive).map(stem))];
    const theirs = new Set(normalizeWords(compare).filter(distinctive).map(stem));
    const shared = mine.filter((word) => theirs.has(word));
    if (shared.length >= SAMPLE_WORDS_SHARED && shared.length / mine.length >= SAMPLE_WORD_SHARE) {
      return `${shared.length}/${mine.length} words (${shared.join(", ")}): ${sample}`;
    }
  }
  return null;
}

/** The first of `phrases` (a card's never_says) the text uses, whole words, case and apostrophes folded; or null. */
export function neverSaysHit(text: string, phrases: readonly string[]): string | null {
  const words = normalizeWords(text);
  // "Claudine's" still names her: possessives are checked without their 's too.
  const forms = [` ${words.join(" ")} `, ` ${words.map(stem).join(" ")} `];
  for (const phrase of phrases) {
    const key = normalizeWords(phrase).join(" ");
    if (key && forms.some((form) => form.includes(` ${key} `))) return phrase;
  }
  return null;
}

/** *Stage business in asterisks* becomes the house style's (stage business in parentheses). */
export function parenthesizeStageBusiness(text: string): string {
  // "*Slides a heel.*" and "(*Slides a heel.*)" both end as one pair of parentheses, never "((…))".
  return text.replace(/\*([^*\n]+)\*/g, (_match, inner: string) => `(${inner.trim()})`).replace(/\(\(([^()]*)\)\)/g, "($1)");
}

/** Text the player will see (and that a riddle answer could leak through). */
function visibleTexts(out: DialogueTurnOutput): string[] {
  return [...out.lines.map((l) => l.text), ...out.choices.map((c) => c.text), ...(out.effects.favor ? [out.effects.favor.text] : [])];
}

const fail = (category: ValidationCategory, detail: string): ValidationResult => ({ ok: false, category, detail });

export function validateTurn(raw: string, ctx: ValidationContext): ValidationResult {
  // 1. Schema.
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return fail("schema", `not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = DialogueTurnOutput.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("schema", issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid");
  }
  const adjustments: string[] = [];
  let lines = parsed.data.lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text !== "").map((l) => {
    const staged = parenthesizeStageBusiness(l.text);
    if (staged !== l.text) adjustments.push("asterisk stage business→parentheses");
    const text = ctx.fellow ? agreeAddress(staged, ctx.fellow) : staged;
    if (text !== staged) adjustments.push(`address agreed with ${ctx.fellow!.pronouns}`);
    return { ...l, text };
  });
  if (lines.length === 0) return fail("schema", "no lines");
  // A tic saved for leaving, before the conversation's last line: dropped where it stands as a sentence of its own
  // and something is left to say (step 10 catches the rest).
  const exitTics = ctx.exit || parsed.data.wrap_up ? [] : ctx.exitOnly ?? [];
  if (exitTics.length > 0) {
    const stripped = lines.map((l) => ({ ...l, text: stripTics(l.text, exitTics) }));
    const kept = stripped.filter((l) => l.text !== "");
    if (kept.length > 0 && stripped.some((l, i) => l.text !== lines[i]!.text)) {
      adjustments.push(`exit-only tic stripped: ${exitTics.map((t) => `"${t.phrase}"`).join(", ")}`);
      lines = kept;
    }
  }

  // 2. Clamps. Choices first, so a reply dropped as a repeat or a second goodbye can be replaced by a fourth.
  const choices = normalizeChoices(parsed.data.choices, {
    cue: { text: lines.at(-1)!.text }, name: ctx.card.name ? callName(ctx.card.name) : null,
  });
  const given = parsed.data.choices.map((c) => c.text.trim());
  if (choices.length !== given.length || choices.some((c, i) => c.text !== given[i])) {
    adjustments.push(`choices ${JSON.stringify(given)}→${JSON.stringify(choices.map((c) => c.text))}`);
  }
  let out = clampDialogue({ ...parsed.data, lines, choices }, { heartPerk: ctx.heartPerk ?? false });
  if (out.effects.regard_delta !== parsed.data.effects.regard_delta) {
    adjustments.push(`regard_delta ${parsed.data.effects.regard_delta}→${out.effects.regard_delta}`);
  }
  let favor = out.effects.favor;
  if (favor && !PROPOSABLE_FAVORS.has(favor.template)) {
    adjustments.push(`favor template ${favor.template} dropped`);
    favor = null;
  }
  out = {
    ...out,
    choices: out.choices.map((c, i) => ({ ...c, id: CHOICE_IDS[i]! })),
    effects: { ...out.effects, favor, topic: out.effects.topic.trim().slice(0, TOPIC_CHARS) },
  };

  // 3. Portraits.
  out = {
    ...out,
    lines: out.lines.map((line) => {
      const expr = checkedExpression(ctx.card, line.expr, ctx.emotion);
      if (expr !== line.expr) adjustments.push(`expr ${line.expr}→${expr}`);
      return { ...line, expr };
    }),
  };

  // 4. Lexical filters.
  for (const text of visibleTexts(out)) {
    const hit = lexicalHits(text)[0];
    if (hit) return fail(`lexical:${hit.group}`, hit.term);
  }

  // 5. Riddle post-filter, riddle-topic turns only (§14.2: many answers are ordinary words residents need).
  if (ctx.riddle) {
    const safeHints = ctx.riddle.hints.slice(0, ctx.hintsAllowed ?? 3).filter(h => h && !containsAnswer(h, ctx.riddle!.accepted));
    // Arbitrary paraphrases cannot be proven free of semantic leaks or higher-level hints.
    // GDD-GAP: fail closed to authored wording rather than trusting a model to paraphrase.
    if (out.lines.some(l => !safeHints.includes(l.text))) return fail("riddle", ctx.riddle.id);
    for (const text of [...visibleTexts(out), out.effects.memory?.text ?? "", out.effects.topic]) {
      if (containsAnswer(text, ctx.riddle.accepted)) return fail("riddle", ctx.riddle.id);
    }
  }

  // Riddle replies/effects are engine-owned too: arbitrary text can encode an answer without naming it.
  if (ctx.riddle) out = { ...out, choices: [{ id: 'a', text: "I'll think about it.", intent: 'curious' }, { id: 'b', text: 'Thank you.', intent: 'kind' }], effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: '' } };

  // 6. Secrets: only engine-approved ids.
  if (out.effects.reveal_secret !== null && !ctx.revealable.has(out.effects.reveal_secret)) {
    adjustments.push(`reveal_secret ${out.effects.reveal_secret} dropped`);
    out = { ...out, effects: { ...out.effects, reveal_secret: null } };
  }

  // 7. Echo check.
  const window = ctx.recentLines.slice(0, ECHO_WINDOW);
  for (const line of out.lines) {
    const overlap = echoOverlap(line.text, window);
    if (overlap > ECHO_THRESHOLD) return fail("echo", `${overlap.toFixed(2)}: ${line.text}`);
  }

  // 8-10. Soft voice checks: the Fellow's pronouns, the card's never_says, Monde's money, another resident's
  // catchphrase, the resident's own twice, a card sample quoted back, a leaving tic too early. Every one is
  // collected, so the regeneration's note can name them all.
  const slips: Slip[] = [];
  const slip = (category: SoftCategory, detail: string | null | undefined): void => {
    if (detail && !slips.some((s) => s.category === category)) slips.push({ category, detail });
  };
  for (const line of out.lines) {
    if (ctx.fellow) {
      const hit = misgenderHit(line.text, ctx.fellow);
      if (hit) slip("misgender", `"${hit}" (${ctx.fellow.pronouns})`);
    }
    const never = neverSaysHit(line.text, ctx.neverSays ?? []);
    if (never) slip("never_says", `"${never}"`);
    const money = currencyHit(line.text);
    if (money) slip("currency", `"${money}"`);
    const borrowed = borrowedHits(line.text, ctx.borrowed ?? [])[0];
    if (borrowed) slip("borrowed", `"${borrowed.phrase}" (${borrowed.owner})`);
  }
  const said = [...(ctx.conversationLines ?? [])];
  for (const line of out.lines) {
    const again = borrowedHits(line.text, ctx.own ?? []).find((s) => said.some((earlier) => borrowedHits(earlier, [s]).length > 0));
    if (again) slip("tic_repeat", `"${again.phrase}"`);
    said.push(line.text);
  }
  for (const line of out.lines) slip("sample_echo", sampleEcho(line.text, ctx.samples ?? [], ctx.vocabulary ?? [], ctx.tics ?? []));
  for (const line of out.lines) {
    const early = borrowedHits(line.text, exitTics)[0];
    if (early) slip("exit_tic", `"${early.phrase}"`);
  }
  if (slips.length > 0) {
    return { ok: false, category: slips[0]!.category, detail: slips[0]!.detail, soft: { output: out, adjustments, slips } };
  }

  return { ok: true, output: out, adjustments };
}

/** What one soft slip needs fixing, as a sentence for the regeneration's note. */
function slipSentence({ category, detail }: Slip): string {
  const what = /^"[^"]*"/.exec(detail)?.[0];
  switch (category) {
    case "misgender": {
      const pronouns = /\(([^)]+)\)\s*$/.exec(detail)?.[1];
      return `${what ?? "A word"} gets the Fellow wrong.${pronouns ? ` ${pronounRule(pronouns)}` : ""}`;
    }
    case "never_says": return `You never say ${what ?? "that"}: it's on your card's never-says list.`;
    case "currency": return `${what ?? "That"} isn't Monde money: money here is coins ("two coins", "every coin").`;
    case "borrowed": return `${what ?? "That phrase"} is another resident's catchphrase, not yours.`;
    case "tic_repeat": return `You've already said ${what ?? "that"} in this conversation; it's a habit for once a conversation.`;
    case "sample_echo": return what
      ? `${what} comes from your card's samples, which only show your tone: keep any facts, in new words.`
      : "That repeats one of your card's samples nearly word for word; they only show your tone.";
    case "exit_tic": return `${what ?? "That phrase"} is how you leave a conversation, and you aren't leaving yet.`;
  }
}

/**
 * The note for a regeneration after soft slips: every slip, then the same instruction every time, so the retry
 * still answers the Fellow's line first and changes only the words that slipped (a note that just said "say
 * something new" sent retries off the subject).
 */
export function softNote(slips: readonly Slip[]): string {
  const fix = slips.length > 1 ? "those words" : "that";
  return `${slips.map(slipSentence).join(" ")} Reply again: answer what the Fellow just said first, as before, and change only ${fix}.`;
}

/**
 * The one-line instruction appended (as an extra user-message text block, never a prefill) when a turn is
 * regenerated. Blocks 1-3 stay untouched so the retry still reads the cache. Soft categories go through softNote.
 */
export function correctiveNote(category: ValidationCategory, detail = ""): string {
  switch (category) {
    case "misgender": case "never_says": case "currency": case "borrowed": case "tic_repeat": case "sample_echo": case "exit_tic":
      return softNote([{ category, detail }]);
    case "schema":
      return "Your last reply didn't match the schema. Reply again with JSON only: one to three lines and two or three choices.";
    case "riddle":
      return "Your last reply came too close to the answer of the founder's riddle. Give only the hints in <hints>, in your own words, or say you're stumped.";
    case "echo":
      return "You've said almost exactly that before. Reply again: answer what the Fellow just said first, in different words.";
    default:
      return "Your last reply used words that don't belong in Monde: rough language, modern things, brands, talk of games or players, or the banned words in your voice rules. Reply again, in-world: answer what the Fellow just said first.";
  }
}
