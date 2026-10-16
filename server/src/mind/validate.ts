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
 * Then two soft checks (MVP Q-01). They regenerate once with a note, like any failure, but a turn that still trips
 * one is accepted rather than swapped for an authored line (dialogue.ts): the slip is in voice, a fallback isn't.
 *   8. borrowed    no line may use another resident's signature phrase (voice.ts)            (soft: "borrowed")
 *      tic_repeat  nor one of the resident's own a second time in this conversation          (soft: "tic_repeat")
 *   9. samples     no line may echo one of the resident's own card samples: trigram overlap
 *                  above 0.35, or a run of six or more words lifted from one                  (soft: "sample_echo")
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
import { lexicalHits, type FilterGroup } from "./filters.js";
import type { RiddleRecord } from "./riddles.js";
import { borrowedHits, type Signature } from "./voice.js";

export type ValidationCategory = "schema" | `lexical:${FilterGroup}` | "riddle" | "echo" | SoftCategory;
/** Checks that regenerate once and then accept (dialogue.ts), never fall back. */
export type SoftCategory = "borrowed" | "tic_repeat" | "sample_echo";

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
  /** Heart skill perk widens the Regard clamp to ±7 (§9.10.2). Skills aren't built yet: false. */
  heartPerk?: boolean;
}

export type ValidationResult =
  | { ok: true; output: DialogueTurnOutput; adjustments: string[] }
  | {
    ok: false; category: ValidationCategory; detail: string;
    /** Set when only a soft check failed: the otherwise valid turn, to keep if the regeneration fails too. */
    soft?: { output: DialogueTurnOutput; adjustments: string[] };
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

/** The first of `samples` a line echoes (step 9), with why, or null. */
export function sampleEcho(line: string, samples: readonly string[]): string | null {
  for (const sample of samples) {
    const overlap = echoOverlap(line, [sample]);
    const run = sharedRun(line, sample);
    if (overlap > ECHO_THRESHOLD || run >= SAMPLE_RUN_WORDS) return `${overlap.toFixed(2)}/${run} words: ${sample}`;
  }
  return null;
}

/** *Stage business in asterisks* becomes the house style's (stage business in parentheses). */
export function parenthesizeStageBusiness(text: string): string {
  return text.replace(/\*([^*\n]+)\*/g, (_match, inner: string) => `(${inner.trim()})`);
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
  const lines = parsed.data.lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text !== "").map((l) => {
    const text = parenthesizeStageBusiness(l.text);
    if (text !== l.text) adjustments.push("asterisk stage business→parentheses");
    return { ...l, text };
  });
  if (lines.length === 0) return fail("schema", "no lines");

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

  // 8-9. Soft voice checks: another resident's catchphrase, a card sample quoted back.
  const soft = (category: SoftCategory, detail: string): ValidationResult =>
    ({ ok: false, category, detail, soft: { output: out, adjustments } });
  for (const line of out.lines) {
    const borrowed = borrowedHits(line.text, ctx.borrowed ?? [])[0];
    if (borrowed) return soft("borrowed", `"${borrowed.phrase}" (${borrowed.owner})`);
  }
  const said = [...(ctx.conversationLines ?? [])];
  for (const line of out.lines) {
    const again = borrowedHits(line.text, ctx.own ?? []).find((s) => said.some((earlier) => borrowedHits(earlier, [s]).length > 0));
    if (again) return soft("tic_repeat", `"${again.phrase}"`);
    said.push(line.text);
  }
  for (const line of out.lines) {
    const echo = sampleEcho(line.text, ctx.samples ?? []);
    if (echo) return soft("sample_echo", echo);
  }

  return { ok: true, output: out, adjustments };
}

/**
 * The one-line instruction appended (as an extra user-message text block, never a prefill) when a turn is
 * regenerated. Blocks 1-3 stay untouched so the retry still reads the cache.
 */
export function correctiveNote(category: ValidationCategory, detail = ""): string {
  if (category === "borrowed") {
    const what = /^"[^"]*"/.exec(detail)?.[0] ?? "that phrase";
    return `${what} is another resident's catchphrase, not yours. Say it again in your own voice, with your own words.`;
  }
  if (category === "tic_repeat") {
    const what = /^"[^"]*"/.exec(detail)?.[0] ?? "that phrase";
    return `You've already said ${what} in this conversation. It's a habit for once a conversation: say something else.`;
  }
  if (category === "sample_echo") {
    return "That repeats one of your card's samples nearly word for word. The samples only show your tone: say something new, in your own words.";
  }
  if (category === "schema") {
    return "Your last reply didn't match the schema. Reply again with JSON only: one to three lines and two or three choices.";
  }
  if (category === "riddle") {
    return "Your last reply came too close to the answer of the founder's riddle. Give only the hints in <hints>, in your own words, or say you're stumped.";
  }
  if (category === "echo") return "You've said almost exactly that before. Say it differently.";
  return "Your last reply used words that don't belong in Monde: rough language, modern things, brands, talk of games or players, or the banned words in your voice rules. Say it again, in-world.";
}
