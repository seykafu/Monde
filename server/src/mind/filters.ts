/**
 * Lexical filters for model output (GDD §9.13 validation step 2). Every list lives here so content and QA can
 * tune them in one place. Patterns are whole-word and case-insensitive unless marked otherwise.
 *
 * Sources:
 * - profanity: E10+ rating rules (§9.13, World Bible "Tone and rating"). The cards' mild oaths ("Heavens",
 *   "Rot", "Goodness", "Oh, bother") are allowed and absent here.
 * - modern_tech: the anachronism group of Appendix A.3.7 V16 and §12.1 rule 6 ("Never text, online, app,
 *   email, download"). "Rotary phone" and "telephone" are era words (World Bible) and pass.
 * - brand: real-world brands and products (§9.13 "no real brands"). Words that are also ordinary nouns
 *   (apple, amazon the river…) are left out on purpose.
 * - self_reference: fourth-wall phrases (§9.13): AI, language model, Claude, NPC, "the player", "this game",
 *   quests, prompts. Phrase-level on purpose so in-world words ("shop assistant", "a card game") pass; tune
 *   against soak transcripts (§9.16).
 * - style: the voice bible's banned vocabulary and phrases (§12.1 rules 4 and 8, banned constructions).
 *
 * `currencyHit` is separate: money words that aren't Monde's (the World Bible: "Money is coins"). It's one of the
 * validator's soft checks (regenerate once, then accept; validate.ts), not a filter group, because a resident who
 * says "every shilling" is still in voice and an authored line in no voice is worse.
 */

export type FilterGroup = "profanity" | "modern_tech" | "brand" | "self_reference" | "style";

export interface FilterHit {
  group: FilterGroup;
  /** The matched text, as it appeared. */
  term: string;
}

/** Word list → one case-insensitive whole-word regex. Entries are regex sources (already escaped where needed). */
function words(entries: readonly string[], flags = "iu"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${entries.join("|")})(?![\\p{L}\\p{N}])`, flags);
}

export const PROFANITY: readonly string[] = [
  "fuck\\w*", "motherfuck\\w*", "shit\\w*", "bullshit", "bitch\\w*", "bastards?", "ass(?:hole)?s?", "arse(?:hole)?s?",
  "crap(?:py)?", "piss(?:ed|ing)?", "cunts?", "bollocks", "wank(?:er|ers|ing)?", "twats?", "sluts?", "whores?",
  "damn(?:ed|it)?", "dammit", "goddamn\\w*", "hell", "bloody", "bugger\\w*", "sod off",
  "retard(?:ed|s)?", "spastic", "fag(?:got)?s?", "n[i1]gg(?:er|a)s?", "trann(?:y|ies)",
];

export const MODERN_TECH: readonly string[] = [
  "smart ?phones?", "(?:mobile|cell) ?phones?", "iphones?", "internet", "online", "e-?mails?", "websites?",
  "web ?sites?", "apps?", "televisions?", "tv", "computers?", "laptops?", "social media",
  "download(?:s|ed|ing)?", "upload(?:s|ed|ing)?", "wi-?fi", "texting", "text messages?", "texted",
  "text (?:me|you|him|her|them|us)", "selfies?", "emojis?", "hashtags?", "video ?games?", "touch ?screens?",
  "screen time", "podcasts?", "bluetooth", "gps",
];

export const BRANDS: readonly string[] = [
  "google", "facebook", "instagram", "twitter", "tiktok", "youtube", "netflix", "coca-?cola", "pepsi",
  "mcdonald'?s", "starbucks", "walmart", "microsoft", "ipads?", "android", "nike", "adidas", "disney", "lego",
  "ikea", "uber", "spotify", "whatsapp", "snapchat", "reddit", "wikipedia", "chatgpt", "openai", "anthropic",
  "tesla", "playstation", "xbox", "nintendo",
];

/** Case-insensitive fourth-wall words. "AI" is matched separately, case-sensitively, so "ai" in names survives. */
export const SELF_REFERENCE: readonly string[] = [
  // Phrases, not bare words: "shop assistant", "a card game" and "piano player" are ordinary Monde speech.
  "a\\.i\\.", "artificial intelligence", "language models?", "llms?", "chatbots?", "claude", "npcs?",
  "non-player characters?", "as an (?:ai|assistant|language model)", "i'?m (?:just )?an? (?:ai|assistant|bot|program|language model)",
  "the players?'?s?", "this game", "in-game", "game mechanics?", "(?:side|main) quests?", "quest log",
  "(?:system|my|your|the) prompts?", "role-?play(?:ing)?",
];
const SELF_REFERENCE_CASED: readonly string[] = ["AI", "AIs"];

export const STYLE: readonly string[] = [
  "community", "communities", "journey", "resilien(?:ce|t)", "heart of the town", "special place", "vibrant",
  "tapestry", "healing", "closure", "stakeholders?", "revitali[sz](?:e|es|ed|ing|ation)", "give back",
  "safe space", "i'?d rather not say", "a story for another day", "here'?s the thing", "at the end of the day",
  "i want you to know that", "how can i help", "great question",
  // The banned "Not X, Y" / "It isn't X. It's Y." construction (§12.1), in its common spoken forms.
  "it'?s not (?:a |an |the )?[\\p{L}' -]{1,30}[,;:—-]+ ?(?:it'?s|that'?s)",
  "it isn'?t (?:a |an |the )?[\\p{L}' -]{1,30}[.,;:—-]+ ?it'?s",
  "not (?:a|an|the) [\\p{L}' -]{1,30}[,;—-]+ ?but (?:a|an|the) [\\p{L}]+",
];

const GROUPS: readonly { group: FilterGroup; pattern: RegExp }[] = [
  { group: "profanity", pattern: words(PROFANITY) },
  { group: "modern_tech", pattern: words(MODERN_TECH) },
  { group: "brand", pattern: words(BRANDS) },
  { group: "self_reference", pattern: words(SELF_REFERENCE) },
  { group: "self_reference", pattern: words(SELF_REFERENCE_CASED, "u") },
  { group: "style", pattern: words(STYLE) },
];

/** Typographic apostrophes fold to ASCII so "here’s the thing" matches. */
const fold = (text: string): string => text.replace(/[’‘]/g, "'");

/** Every filter group the text trips, with the first matching term in each. */
export function lexicalHits(text: string): FilterHit[] {
  const folded = fold(text);
  const hits: FilterHit[] = [];
  for (const { group, pattern } of GROUPS) {
    const match = pattern.exec(folded);
    if (match && !hits.some((hit) => hit.group === group)) hits.push({ group, term: match[0] });
  }
  return hits;
}

/**
 * Text that is still being typed may end mid-word ("game" on the way to "gamekeeper"). Check only up to the last
 * word boundary so a streaming check never trips on a prefix.
 */
export function completeWords(text: string): string {
  const match = /[\p{L}\p{N}'’-]+$/u.exec(text);
  return match ? text.slice(0, match.index) : text;
}

/**
 * Money that isn't Monde's (MVP Q-01; World Bible "Money is coins"): the matcher lives in shared
 * (shared/src/arrivals/money.ts) so the card repair and V16 share it; re-exported here unchanged.
 */
export { CURRENCY, currencyHit } from "@monde/shared";
