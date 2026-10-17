/**
 * What a resident calls the Fellow (GDD §12.1: the character registers and the anti-pattern "Generic address";
 * the hand-written resident cards' registers; MVP Q-01).
 *
 * The rule depends on who is speaking, the Fellow's Regard with them and whether they have talked before. It
 * reaches the model as one explicit line in the dynamic block (dialogue.md, inside <player>), never in blocks 1-3,
 * and the authored fallbacks use the same term (fallback.ts), so a resident sounds the same either way:
 *   - Pell: "Fellow" (or "dear"); the Fellow's name only in private, once Regard passes 40.
 *   - Hollis, Augusta, Rook, Nettie, Ada, Bru, Ines: "Fellow".
 *   - Odile: "petite" / "petit" (the young), or plain "you"; never the name.
 *   - June: "friend" (the only one who may); Bertrand: "my dear" or "young person"; Rosalind: "pet".
 *   - Vane: first names from the second meeting.
 *   - Everyone else: "Fellow" until they're introduced or have met, then the name or "Fellow".
 *
 * The Fellow's pronouns come from the signed Fellowship form (§11.1; "they/them" before it's signed). The dialogue's
 * <player> line carries them with the wrong words in the name's parentheses (`pronounNote`); the plan, reflection and
 * gossip requests carry `pronounRule`, one plain sentence; both always in block 4. `misgenderHit` is the validator's check (validate.ts):
 * only wrong-gendered words tied to "you" (a vocative, "you're a good lad", "a man like you", "Mr. Wren"), since a
 * resident talking to the Fellow says "he" and "she" about everyone else.
 */
import { pronounSet, regardTier } from "@monde/shared";

export interface AddressInput {
  residentId: string;
  /** The Fellow's name, as the Fellowship form gave it. */
  playerName: string;
  /** e.g. "she/her", "he/him", "they/them". */
  pronouns: string;
  /** The Fellow's Regard with this resident. */
  regard: number;
  /** They have talked before (a history with the Fellow, or a resumed conversation). */
  met: boolean;
}

export interface Address {
  /** What the resident calls the Fellow in speech, e.g. "Fellow", "petite", "Wren". */
  term: string;
  /** The prompt's line for it, e.g. `Call her "Fellow" ...`. */
  line: string;
}

/** The object pronoun from a "she/her" pair; anything unrecognised is "them". */
function objectPronoun(pronouns: string): string {
  const parts = pronouns.toLowerCase().split("/").map((p) => p.trim());
  if (parts[0] === "she") return "her";
  if (parts[0] === "he") return "him";
  return "them";
}

/** Residents who call the Fellow "Fellow" whatever the Regard (§12.1 registers and the resident cards). */
const ALWAYS_FELLOW: Readonly<Record<string, string>> = {
  hollis: "",
  augusta: "",
  ada: "",
  bru: "",
  rook: ", like a dare",
  nettie: ", like a dare",
  ines: ": you use titles, not names",
};

export function addressFor(input: AddressInput): Address {
  const name = input.playerName.trim() || "Fellow";
  // Before the Fellowship form is signed the Fellow has no name but "Fellow" (player.ts DEFAULT_PLAYER_VIEW).
  const named = name.toLowerCase() !== "fellow";
  const them = objectPronoun(input.pronouns);
  const call = (...parts: string[]) => `Call ${them} ${parts.filter(Boolean).join("")}.`;
  const tier = regardTier(input.regard);
  const id = input.residentId;

  if (id in ALWAYS_FELLOW) {
    const rest = ALWAYS_FELLOW[id]!;
    return { term: "Fellow", line: call(`"Fellow"${rest}`, named && !rest.startsWith(":") ? `, never "${name}"` : "") };
  }
  switch (id) {
    case "pell":
      // §12.1: the player's name "in private once Regard passes 40" (Friend tier); "Fellow" in public.
      return input.regard >= 40 && named
        ? { term: name, line: call(`"${name}" when it's just the two of you, "Fellow" in front of others`) }
        : { term: "Fellow", line: call(`"Fellow" ("dear" now and then)`, named ? `, not "${name}": first names are for friends, in private` : "") };
    case "odile": {
      // GDD-GAP: §12.1 gives "petit" or "petite" with no rule for they/them; "petit" is the unmarked French form.
      const petit = them === "her" ? "petite" : "petit";
      return { term: petit, line: call(`"${petit}", or just "you"`, named ? `; never "${name}"` : "") };
    }
    case "june":
      return { term: "friend", line: call(`"friend"`, input.met && named ? `, and "${name}" now and then` : "") };
    case "bertrand":
      return { term: "my dear", line: call(`"my dear" or "young person"`) };
    case "rosalind":
      return { term: "pet", line: call(`"pet"`) };
    case "vane":
      return input.met && named
        ? { term: name, line: call(`"${name}": first names from the second meeting`) }
        : { term: "Fellow", line: call(`"Fellow"`, named ? " today; first names come from the second meeting" : "") };
    default:
      if (!named) return { term: "Fellow", line: call(`"Fellow"`) };
      if (tier === "Wary") return { term: "Fellow", line: call(`"Fellow", coolly; not "${name}"`) };
      if (tier === "Stranger" && !input.met) {
        return { term: "Fellow", line: call(`"Fellow"; "${name}" only once the Fellow has told you the name`) };
      }
      return { term: name, line: call(`"${name}" or "Fellow"`) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pronouns (GDD §11.1 Fellowship form; MVP Q-01)
// ---------------------------------------------------------------------------------------------------------------

/** Who the Fellow is, as the prompts and the validator need it: the form's name and pronouns. */
export interface FellowView {
  name: string;
  /** "she/her", "he/him", "they/them" or a custom "xe/xem/xyr". */
  pronouns: string;
}

type Gender = "she" | "he" | "neutral";
const genderOf = (pronouns: string): Gender => {
  const subject = pronounSet(pronouns).subject;
  return subject === "she" ? "she" : subject === "he" ? "he" : "neutral";
};

/** The words never to use for the Fellow, by pronoun set (the prompt's list; the validator's lists are below). */
const NEVER_WORDS: Record<Gender, string> = {
  she: '"he", "him", "his", "a man", "lad" or "sir"',
  he: '"she", "her", "a woman", "lass" or "madam"',
  neutral: '"he", "she", "a man", "a woman", "lad" or "lass"',
};

/**
 * One sentence saying which words are right for the Fellow, e.g. `Words for her are "she" and "her": never "he",
 * "him", "his", "a man", "lad" or "sir".` Custom sets name all three of their words.
 */
export function pronounRule(pronouns: string): string {
  const set = pronounSet(pronouns);
  const gender = genderOf(pronouns);
  const words = gender === "she" ? `"she" and "her"` : gender === "he" ? `"he", "him" and "his"`
    : [...new Set([set.subject, set.object, set.possessive])].map((w) => `"${w}"`).join(", ").replace(/, ([^,]+)$/, " and $1");
  return `Words for ${set.object} are ${words}: never ${NEVER_WORDS[gender]}.`;
}

/**
 * The short form for the dialogue's <player> line, inside the name's parentheses: `she/her; never "he", "him", "a
 * man" or "lad"`. Kept short so the Fellow's words, not the pronoun rule, are what the turn answers.
 */
export function pronounNote(pronouns: string): string {
  const never: Record<Gender, string> = {
    she: '"he", "him", "a man" or "lad"', he: '"she", "her", "a woman" or "lass"', neutral: '"he", "she", "a man" or "a woman"',
  };
  return `${pronouns.trim().toLowerCase()}; never ${never[genderOf(pronouns)]}`;
}

/** For prompts outside a conversation (plan, reflection, gossip): who the Fellow is and how to speak of them. */
export function fellowLine(fellow: FellowView): string {
  const name = fellow.name.trim();
  const who = name && name.toLowerCase() !== "fellow" ? `The Fellow is ${name}.` : "The Fellow hasn't given a name yet.";
  return `${who} ${pronounRule(fellow.pronouns)}`;
}

/** Nouns and forms of address that gender the Fellow wrongly, by the Fellow's pronouns. */
const MALE = ["man", "lad", "laddie", "boy", "gentleman", "chap", "bloke", "fella", "son", "sonny", "sir", "mister", "young man"];
const FEMALE = ["woman", "lass", "lassie", "girl", "lady", "madam", "ma'am", "miss", "missus", "young lady"];
const WRONG_NOUNS: Record<Gender, readonly string[]> = { she: MALE, he: FEMALE, neutral: [...MALE, ...FEMALE] };
// Odile's word for the young (naming.ts addressFor): "petit" is the unmarked form she uses for they/them too.
const WRONG_VOCATIVES: Record<Gender, readonly string[]> = {
  she: [...MALE, "petit"], he: [...FEMALE, "petite"], neutral: [...MALE, ...FEMALE, "petite"],
};
const WRONG_TITLES: Record<Gender, readonly string[]> = {
  she: ["mr", "mister", "master", "sir"], he: ["mrs", "miss", "ms", "missus", "madam", "lady"],
  neutral: ["mr", "mister", "master", "sir", "mrs", "miss", "ms", "missus", "madam", "lady"],
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = (words: readonly string[]): string =>
  [...words].sort((a, b) => b.length - a.length).map((w) => escape(w).replace(/ /g, "\\s+")).join("|");
/** Up to two describing words between the article and the noun ("a fine young lad"), never a clause. */
const FILLER = "(?:(?!(?:who|that|for|to|with|from|at|in|on|of|and|or|but|than|as|is|was)\\b)[\\p{L}'-]+\\s+){0,2}?";
const ARTICLE = "(?:a|an|the|such\\s+a|quite\\s+a|quite\\s+the|one|some|a\\s+real|a\\s+proper)";
const COPULA = "(?:'re|\\s+are|\\s+were|\\s+was|\\s+look|\\s+looked|\\s+seem|\\s+sound|'d\\s+be|\\s+would\\s+be|\\s+make|\\s+made)";

const patterns = new Map<string, RegExp[]>();
function misgenderPatterns(fellow: FellowView): RegExp[] {
  const gender = genderOf(fellow.pronouns);
  const name = fellow.name.trim();
  const key = `${gender}|${name.toLowerCase()}`;
  let list = patterns.get(key);
  if (!list) {
    const noun = `(?:${alternation(WRONG_NOUNS[gender])})`;
    const voc = `(?:${alternation(WRONG_VOCATIVES[gender])})`;
    const end = "(?![\\p{L}\\p{N}'-])";
    list = [
      // "you're a good lad", "you look like a man who…", "you'd make a fine gentleman"
      new RegExp(`(?<![\\p{L}])you${COPULA}(?:\\s+like)?\\s+${ARTICLE}\\s+${FILLER}${noun}${end}`, "iu"),
      // "a man like you", "a clever lad like you"
      new RegExp(`(?<![\\p{L}])(?:a|an|the|such\\s+a)\\s+${FILLER}${noun}\\s+like\\s+you${end}`, "iu"),
      // Vocatives: "Sit down, lad." "Morning, sir?" "Eat something, petit."
      new RegExp(`,\\s*(?:my\\s+|young\\s+|dear\\s+|good\\s+)?${voc}\\s*(?=[.!?…,;]|$)`, "iu"),
      // …and opening a sentence: "Lad, sit down."
      new RegExp(`(?:^|(?<=[.!?…)]\\s))\\s*(?:my\\s+|young\\s+|dear\\s+|good\\s+)?${voc},`, "iu"),
    ];
    if (name && name.toLowerCase() !== "fellow") {
      list.push(new RegExp(`(?<![\\p{L}])(?:${alternation(WRONG_TITLES[gender])})\\.?\\s+${escape(name)}${end}`, "iu"));
    }
    patterns.set(key, list);
  }
  return list;
}

/** The first wrong-gendered reference to the Fellow in a line, as it appeared ("a man", "lad"), or null. */
export function misgenderHit(text: string, fellow: FellowView): string | null {
  const folded = text.replace(/[’‘]/g, "'");
  for (const pattern of misgenderPatterns(fellow)) {
    const match = pattern.exec(folded);
    if (match) return match[0].trim().replace(/^[,\s]+|[,.!?…;\s]+$/g, "");
  }
  return null;
}

