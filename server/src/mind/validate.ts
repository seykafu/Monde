/**
 * The dialogue validation pipeline (GDD §9.13, §9.10, §14.2). Every model output goes through these steps in
 * order; the first hard failure stops the pipeline and the caller regenerates once, then falls back:
 *
 *   1. schema      JSON.parse + zod DialogueTurnOutput, at least one non-empty line             (fail: "schema")
 *   2. clamps      clampDialogue (Heart perk off until skills land), topic length, choice ids,
 *                  favor template must be an MVP template the model may propose               (adjusts)
 *   3. portraits   each expr must be in the card's portrait_expressions, else mapped from
 *                  the resident's current emotion (§9.4)                                       (adjusts)
 *   4. lexical     profanity, modern tech, brands, self-reference, house style (filters.ts)   (fail: "lexical:<group>")
 *   5. riddle      only on riddle-topic turns: no line, choice or favor text may contain an
 *                  accepted answer from the server-side record (§14.2)                        (fail: "riddle")
 *   6. secrets     reveal_secret must be one of the revealable ids, else null                 (adjusts)
 *   7. echo        word-trigram overlap with the resident's last 20 lines must be ≤ 0.35      (fail: "echo")
 *
 * Canon checks (§9.13 step 3) are rules built from canon_locks and arrive with their content; nothing here
 * pretends to do them. Favor feasibility is M-09: favors are stored as "proposed".
 */
import {
  DialogueTurnOutput, MVP_FAVOR_TEMPLATES, clampDialogue, type Emotion, type PersonaCard,
} from "@monde/shared";
import { containsAnswer } from "./promptBuilder.js";
import { checkedExpression } from "./expressions.js";
import { lexicalHits, type FilterGroup } from "./filters.js";
import type { RiddleRecord } from "./riddles.js";

export type ValidationCategory = "schema" | `lexical:${FilterGroup}` | "riddle" | "echo";

export interface ValidationContext {
  card: Pick<PersonaCard, "portrait_expressions">;
  /** The resident's current emotion, for mapping missing expressions. */
  emotion: Emotion;
  /** Secret ids the engine allows this turn (revealableSecrets). */
  revealable: ReadonlySet<string>;
  /** Set only on riddle-topic turns. */
  riddle: RiddleRecord | null;
  /** The resident's most recent lines, newest first (the echo window). */
  recentLines: readonly string[];
  /** Heart skill perk widens the Regard clamp to ±7 (§9.10.2). Skills aren't built yet: false. */
  heartPerk?: boolean;
}

export type ValidationResult =
  | { ok: true; output: DialogueTurnOutput; adjustments: string[] }
  | { ok: false; category: ValidationCategory; detail: string };

/** §9.10 "Echo check": above this overlap with a recent line, regenerate. */
export const ECHO_THRESHOLD = 0.35;
/** §9.10: compared against the resident's last 20 lines. */
export const ECHO_WINDOW = 20;
/** GDD-GAP: §9.10.2 calls the topic "a short tag" with no length; 60 characters keeps already_discussed short. */
export const TOPIC_CHARS = 60;

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
  const lines = parsed.data.lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text !== "");
  if (lines.length === 0) return fail("schema", "no lines");

  // 2. Clamps.
  let out = clampDialogue({ ...parsed.data, lines }, { heartPerk: ctx.heartPerk ?? false });
  if (out.effects.regard_delta !== parsed.data.effects.regard_delta) {
    adjustments.push(`regard_delta ${parsed.data.effects.regard_delta}→${out.effects.regard_delta}`);
  }
  const choices = out.choices.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text !== "");
  if (choices.length < 2 && !choices.some((c) => c.intent === "leave")) choices.push({ id: "", text: "Leave", intent: "leave" });
  if (choices.length < 2) choices.unshift({ id: "", text: "Fair enough.", intent: "kind" });
  let favor = out.effects.favor;
  if (favor && !PROPOSABLE_FAVORS.has(favor.template)) {
    adjustments.push(`favor template ${favor.template} dropped`);
    favor = null;
  }
  out = {
    ...out,
    choices: choices.map((c, i) => ({ ...c, id: CHOICE_IDS[i]! })),
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
    for (const text of visibleTexts(out)) {
      if (containsAnswer(text, ctx.riddle.accepted)) return fail("riddle", ctx.riddle.id);
    }
  }

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

  return { ok: true, output: out, adjustments };
}

/**
 * The one-line instruction appended (as an extra user-message text block, never a prefill) when a turn is
 * regenerated. Blocks 1-3 stay untouched so the retry still reads the cache.
 */
export function correctiveNote(category: ValidationCategory): string {
  if (category === "schema") {
    return "Your last reply didn't match the schema. Reply again with JSON only: one to three lines and two or three choices.";
  }
  if (category === "riddle") {
    return "Your last reply came too close to the answer of the founder's riddle. Give only the hints in <hints>, in your own words, or say you're stumped.";
  }
  if (category === "echo") return "You've said almost exactly that before. Say it differently.";
  return "Your last reply used words that don't belong in Monde: rough language, modern things, brands, talk of games or players, or the banned words in your voice rules. Say it again, in-world.";
}
