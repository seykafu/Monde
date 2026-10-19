// Money that isn't Monde's (MVP Q-01; the World Bible's "Money is coins, never pounds or shillings",
// server/src/mind/prompts/world_bible.md). The matcher lives here so the card repair (repair.ts) and the validator's V16
// (the server's and the census tool's `banned`) use the very same one; server/src/mind/filters.ts re-exports it for the
// dialogue checks. Pure: no I/O.

/** Word list → one case-insensitive whole-word regex. Entries are regex sources (already escaped where needed). */
function words(entries: readonly string[], flags = "iu"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${entries.join("|")})(?![\\p{L}\\p{N}])`, flags);
}

/** Typographic apostrophes fold to ASCII so "ha’penny" matches. One character for one, so indices carry over. */
export const foldApostrophes = (text: string): string => text.replace(/[’‘]/g, "'");

/**
 * Money that isn't Monde's (MVP Q-01; World Bible "Money is coins"). Whole words, case-insensitive. Weight and
 * idiom are left alone: "a pound of rye", "it weighs two pounds", "pound cake", "per cent", "penny whistle", "the
 * penny dropped", "guinea fowl".
 */
const NUMBER = "(?:\\d[\\d,.]*|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|few|several|many|half a|a few|a hundred|a thousand)";
const POUND_NOT_MONEY = "(?!\\s*(?:of|heavier|lighter|in weight|weight|cake|cakes|loaf|loaves|bag|bags|sack|sacks|tin|tins)\\b)";
export const CURRENCY: readonly string[] = [
  "shillings?", "pence", "sixpences?", "threepences?", "thruppence", "tuppence",
  // "fourpence", "ninepence" (the census review found "fourpence" on three cards: only the bare "pence" matched).
  "(?:two|four|five|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)pences?", "ha'?pennies", "ha'?penny", "halfpenn(?:y|ies)",
  "farthings?", "dollars?", "quid(?!\\s+pro\\s+quo)", "cents", "euros?", "francs?", "guineas?(?!\\s+(?:pigs?|fowl|hens?))",
  "pennies", "penny(?![\\s-]*(?:whistles?|farthings?|dropped|drops))",
  "(?:every|a|one|not\\s+a|single)\\s+cent",
  // "Five pounds, dear", "a pound a week", "pound notes" (never "a pound of flour" or "weighs two pounds").
  `(?<!weigh\\w*\\s+(?:about\\s+|nearly\\s+|near\\s+|over\\s+|under\\s+|maybe\\s+)?)${NUMBER}\\s+pounds?${POUND_NOT_MONEY}`,
  "pounds?\\s+(?:a|per)\\s+(?:week|day|month|year|head|loaf|go)", "pound\\s+(?:notes?|coins?)",
];
const CURRENCY_PATTERN = words(CURRENCY);
const CURRENCY_ALL = words(CURRENCY, "giu");
const MONEY_SIGN = /[£$€]\s?\d/u;
const MONEY_SIGN_ALL = /[£$€]\s?\d/gu;

/** The first non-Monde money word in the text, as it appeared, or null. */
export function currencyHit(text: string): string | null {
  const folded = foldApostrophes(text);
  const sign = MONEY_SIGN.exec(folded);
  if (sign) return sign[0];
  const match = CURRENCY_PATTERN.exec(folded);
  return match ? match[0] : null;
}

/**
 * Every place currencyHit would stop, left to right and not overlapping: the money signs ("£5": the sign and the first
 * digit), then the words. `index` is into the text as given (folding keeps every index).
 */
export function currencySpans(text: string): { index: number; text: string; sign: boolean }[] {
  const folded = foldApostrophes(text);
  const out: { index: number; text: string; sign: boolean }[] = [];
  for (const m of folded.matchAll(MONEY_SIGN_ALL)) out.push({ index: m.index, text: text.slice(m.index, m.index + m[0].length), sign: true });
  for (const m of folded.matchAll(CURRENCY_ALL)) {
    const end = m.index + m[0].length;
    if (out.some(s => s.index < end && m.index < s.index + s.text.length)) continue;
    out.push({ index: m.index, text: text.slice(m.index, end), sign: false });
  }
  return out.sort((a, b) => a.index - b.index);
}
