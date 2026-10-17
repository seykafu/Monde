/** Mirrors server/src/mind/validate.ts: whole words, folded case/apostrophes and possessives. */
export function neverSaysHit(text: string, phrases: readonly string[]): string | null {
  const normalizeWords = (value: string): string[] => value.toLowerCase().replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
  const words = normalizeWords(text);
  const forms = [` ${words.join(' ')} `, ` ${words.map(word => word.replace(/'s$/, '')).join(' ')} `];
  for (const phrase of phrases) {
    const key = normalizeWords(phrase).join(' ');
    if (key && forms.some(form => form.includes(` ${key} `))) return phrase;
  }
  return null;
}
