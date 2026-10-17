/**
 * Voice ownership (GDD §12.1 character registers, §9.10 "Novelty and anti-repetition"; MVP Q-01).
 *
 * Every hand-written resident's catchphrases are theirs alone. Live evals caught residents borrowing each other's
 * (June seeing the Fellow off with Odile's "Mind the step."), so:
 *   - the persona block (block 2) lists the resident's own tics as theirs and the other residents' signature
 *     phrases as never to borrow (`borrowedLine`), and
 *   - the validator flags a line that uses another resident's signature phrase (`borrowedHits`), or the resident's
 *     own a second time in one conversation (§12.1: a habit once per conversation); the turn is regenerated once
 *     and then accepted, never swapped for an authored fallback over it.
 *
 * A signature phrase is a tic from a canon or resident card (the twenty-four hand-written ones) that isn't an
 * everyday word (COMMON_TICS). A tic two hand-written cards share belongs to both ("Right." is Augusta's and
 * Priya's, so Margo may not borrow it). Generated arrivals and animals own none and never take a phrase from its
 * owner, so an arrival stepping off the ferry never changes anyone else's cached persona block. Everything here is
 * pure and deterministic: the same roster always gives the same bytes.
 *
 * Some tics are for leaving (a card's `voice.exit_only`, June's "Anyway."): the persona block marks them, and the
 * validator strips one said before the conversation's last line (`stripTics`).
 */
import type { PersonaCard } from "@monde/shared";

/** One resident's tics, as the world's roster holds them (context.ts loads it from the residents table). */
export interface RosterVoice {
  id: string;
  kind: PersonaCard["kind"];
  tics: readonly string[];
}

/** A catchphrase that belongs to one resident. */
export interface Signature {
  /** The owner's resident id. */
  owner: string;
  /** The tic as the owner's card writes it, e.g. "Mind the step." */
  phrase: string;
}

/**
 * Tics that are everyday speech: any resident may say them, so nobody owns them. Keys are `phraseKey` forms.
 * Kept short on purpose: tune against eval transcripts (§9.16), not by guesswork. ("Right." left this list after
 * the 2026-10-16 eval: as a sentence of its own it is Augusta's and Priya's, and Margo saying it read as Priya.)
 */
export const COMMON_TICS: ReadonlySet<string> = new Set([
  "hm", "sorry", "sure", "look", "don't", "easy", "visitor", "gloves", "roland",
  "show me", "let's see", "forgive me", "to be clear", "right then", "your money", "walk with me", "it's well",
  "oh and", "between us", "my dear", "for the record", "let's have a look", "give it a day", "one two",
]);

/** Oaths are used as interjections too ("Heavens, that's a fine drain."), so a comma after one still counts. */
const OATHS: ReadonlySet<string> = new Set(["heavens", "goodness", "rot"]);

const OWNER_KINDS: ReadonlySet<PersonaCard["kind"]> = new Set(["canon", "resident"]);

/** Lower case, typographic apostrophes folded, punctuation dropped: "Sit. Sleeves up." → "sit sleeves up". */
export function phraseKey(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, "")).filter(Boolean).join(" ");
}

/**
 * Every signature phrase in the roster, by owner id and then in card order. A phrase on two hand-written cards is
 * listed once for each owner.
 */
export function signatures(roster: readonly RosterVoice[]): Signature[] {
  return [...roster]
    .filter((voice) => OWNER_KINDS.has(voice.kind))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((voice) => {
      const seen = new Set<string>();
      return voice.tics.flatMap((tic) => {
        const key = phraseKey(tic);
        if (!key || COMMON_TICS.has(key) || seen.has(key)) return [];
        seen.add(key);
        return [{ owner: voice.id, phrase: tic.trim() }];
      });
    });
}

/** The tic keys a card owns, and so may say: its own tics, and any phrase one of them starts ("Right, then." covers "Right."). */
function ownsKey(own: readonly string[], key: string): boolean {
  return own.some((mine) => mine === key || mine.startsWith(`${key} `));
}

/**
 * The signature phrases this resident must never borrow: everyone else's, minus any the resident's own card
 * also lists (or opens one of its own with). Animals never speak, so they borrow nothing.
 */
export function borrowedFor(card: Pick<PersonaCard, "id" | "voice">, roster: readonly RosterVoice[]): Signature[] {
  if (card.voice.mode === "narrated_action") return [];
  const own = card.voice.tics.map(phraseKey).filter(Boolean);
  return signatures(roster).filter((s) => s.owner !== card.id && !ownsKey(own, phraseKey(s.phrase)));
}

/** This resident's own signature phrases, for the once-per-conversation check (§12.1 "Same-conversation repetition"). */
export function ownSignatures(card: Pick<PersonaCard, "id">, roster: readonly RosterVoice[]): Signature[] {
  return signatures(roster).filter((s) => s.owner === card.id);
}

/** The card's tics saved for leaving (`voice.exit_only`, each also one of its `tics`), as the card's own phrases. */
export function exitOnlyTics(card: Pick<PersonaCard, "id" | "voice">): Signature[] {
  if (card.voice.mode === "narrated_action") return [];
  const exit = new Set((card.voice.exit_only ?? []).map(phraseKey));
  return card.voice.tics.filter((tic) => exit.has(phraseKey(tic))).map((tic) => ({ owner: card.id, phrase: tic.trim() }));
}

const label = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

/** The persona block's never-borrow line (empty when there's nothing to list, so the template drops it). */
export function borrowedLine(borrowed: readonly Signature[]): string {
  if (borrowed.length === 0) return "";
  const byOwner = new Map<string, string[]>();
  for (const s of borrowed) byOwner.set(s.owner, [...(byOwner.get(s.owner) ?? []), `"${s.phrase}"`]);
  const groups = [...byOwner].map(([owner, phrases]) => `${label(owner)} ${phrases.join(", ")}`);
  return `Other residents' catchphrases, never yours to borrow: ${groups.join("; ")}.`;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = new Map<string, RegExp>();

/**
 * How a tic is matched in a line. A phrase of two or more words counts anywhere, whole words, case and punctuation
 * ignored ("Mind the step on your way out", never "mind the steps"); a question ("On the record?") only as a
 * question. A one-word tic counts only where it's used as one: a sentence of its own ("Anyway."), or opening a
 * sentence when the tic is written that way ("Technically, …") or is an oath ("Heavens, …").
 */
function patternFor(phrase: string): RegExp {
  let pattern = patterns.get(phrase);
  if (!pattern) {
    const key = phraseKey(phrase);
    const words = key.split(" ").map(escapeRegex);
    const trimmed = phrase.trim();
    if (words.length === 1) {
      const start = "(?<=^|[.!?…)\\]]\\s*)\\s*";
      const end = trimmed.endsWith(",") || OATHS.has(key) ? "(?=\\s*[,.!?…]|\\s+\\p{L})" : "(?=\\s*[.!?…])";
      // A comma tic ("Technically,") reads the same with or without its comma; a full stop one must stand alone.
      pattern = new RegExp(`${start}${words[0]}${end}`, "iu");
    } else {
      const body = words.join("[^\\p{L}\\p{N}']+");
      const end = trimmed.endsWith("?") ? "[^\\p{L}\\p{N}]*\\?" : "(?![\\p{L}\\p{N}'])";
      pattern = new RegExp(`(?<![\\p{L}\\p{N}'])${body}${end}`, "iu");
    }
    patterns.set(phrase, pattern);
  }
  return pattern;
}

/** The borrowed signature phrases a line uses, in roster order. */
export function borrowedHits(text: string, borrowed: readonly Signature[]): Signature[] {
  const folded = text.replace(/[’‘]/g, "'");
  return borrowed.filter((s) => patternFor(s.phrase).test(folded));
}

/**
 * `text` without the given tics where each stands as a sentence of its own ("Mm, the reed's split. Anyway. You
 * wanted the waltz?" → "Mm, the reed's split. You wanted the waltz?"). A tic inside a sentence is left alone, so
 * `borrowedHits` still sees it.
 */
export function stripTics(text: string, tics: readonly Signature[]): string {
  // Folding apostrophes is one character for one, so match positions line up with `text`.
  let out = text;
  for (const tic of tics) {
    const words = phraseKey(tic.phrase).split(" ").map(escapeRegex);
    if (words.length === 0 || words[0] === "") continue;
    const sentence = new RegExp(
      `(?<=^|[.!?…)\\]])\\s*${words.join("[^\\p{L}\\p{N}']+")}\\s*[.!?…]+(?=\\s|$|["')\\]])`, "giu",
    );
    const folded = out.replace(/[’‘]/g, "'");
    let kept = "";
    let from = 0;
    for (const match of folded.matchAll(sentence)) {
      kept += out.slice(from, match.index);
      from = match.index + match[0].length;
    }
    out = kept + out.slice(from);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

