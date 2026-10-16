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
 * A signature phrase is a tic from a canon or resident card (the twenty-four hand-written ones) that no other card
 * shares and that isn't an everyday word (COMMON_TICS). Generated arrivals and animals own none, so an arrival
 * stepping off the ferry never changes anyone else's cached persona block. Everything here is pure and
 * deterministic: the same roster always gives the same bytes.
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
 * (A shared tic, like "Right." on two cards, is nobody's too.) Kept short on purpose: tune against eval
 * transcripts (§9.16), not by guesswork.
 */
export const COMMON_TICS: ReadonlySet<string> = new Set([
  "hm", "right", "sorry", "sure", "look", "don't", "easy", "visitor", "gloves", "roland",
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

/** Every signature phrase in the roster, by owner id and then in card order. */
export function signatures(roster: readonly RosterVoice[]): Signature[] {
  const owners = new Map<string, number>();
  for (const voice of roster) {
    if (voice.kind === "animal") continue;
    for (const key of new Set(voice.tics.map(phraseKey))) owners.set(key, (owners.get(key) ?? 0) + 1);
  }
  return [...roster]
    .filter((voice) => OWNER_KINDS.has(voice.kind))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((voice) => voice.tics.flatMap((tic) => {
      const key = phraseKey(tic);
      return key && !COMMON_TICS.has(key) && owners.get(key) === 1 ? [{ owner: voice.id, phrase: tic.trim() }] : [];
    }));
}

/**
 * The signature phrases this resident must never borrow: everyone else's, minus any the resident's own card
 * also lists. Animals never speak, so they borrow nothing.
 */
export function borrowedFor(card: Pick<PersonaCard, "id" | "voice">, roster: readonly RosterVoice[]): Signature[] {
  if (card.voice.mode === "narrated_action") return [];
  const own = new Set(card.voice.tics.map(phraseKey));
  return signatures(roster).filter((s) => s.owner !== card.id && !own.has(phraseKey(s.phrase)));
}

/** This resident's own signature phrases, for the once-per-conversation check (§12.1 "Same-conversation repetition"). */
export function ownSignatures(card: Pick<PersonaCard, "id">, roster: readonly RosterVoice[]): Signature[] {
  return signatures(roster).filter((s) => s.owner === card.id);
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
