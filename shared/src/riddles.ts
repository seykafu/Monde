import { z } from 'zod';
import data from '../../content/riddles.json';
export const RiddleDefinition = z.object({
  mark: z.string(), answerLocation: z.string(),
  id: z.string(), title: z.string(), chain: z.string(), district: z.string(), inscription: z.string(),
  accepted: z.array(z.string()).nonempty(), hints: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
  startDay: z.number(), previous: z.string().nullable(), prerequisites: z.array(z.string()),
  normalization: z.literal('fold-articles-punctuation-number-words'), worldConditions: z.string().nullable(),
  rewards: z.object({ namedXp: z.number(), foundXp: z.number(), charm: z.number(), spirit: z.number(), coins: z.number(), regard: z.number(), flags: z.array(z.string()), items: z.array(z.string()) }),
  fragment: z.string().nullable(), gaps: z.array(z.string())
});
export type RiddleDefinition = z.infer<typeof RiddleDefinition>;
export const SPRING_RIDDLES = z.array(RiddleDefinition).parse(data);
export const SavedRiddle = z.object({ status: z.enum(['found', 'solved']), foundAt: z.number().nonnegative(), hints: z.number().int().min(0).max(3), attempts: z.array(z.string()), method: z.enum(['named', 'found']).optional() });
export const SavedRiddles = z.object({ headlines: z.array(z.object({ day: z.number().int().positive(), text: z.string() })).default([]), entries: z.record(z.string(), SavedRiddle), tab: z.enum(['People', 'Marks', 'Today']).default('People'), selected: z.string().nullable().default(null), pinned: z.array(z.string()).default([]) });
export type SavedRiddles = z.infer<typeof SavedRiddles>;
export const emptyRiddles = (): SavedRiddles => ({ headlines: [], entries: {}, tab: 'People', selected: null, pinned: [] });
const small = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const tens = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
/** Fold number words as runs, so “seventy-eight” and “one thousand eight hundred fifty” work. */
export function normalizeRiddleAnswer(text: string): string {
  const words = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);
  const out: string[] = [], run: string[] = [];
  const low = (tokens: string[]): number | null => {
    if (!tokens.length) return 0;
    if (tokens.length === 1 && small.includes(tokens[0]!)) return small.indexOf(tokens[0]!);
    if (tens.includes(tokens[0]!) && (tokens.length === 1 || tokens.length === 2 && small.indexOf(tokens[1]!) > 0 && small.indexOf(tokens[1]!) < 10)) return (tens.indexOf(tokens[0]!) + 2) * 10 + (tokens.length === 2 ? small.indexOf(tokens[1]!) : 0);
    return null;
  };
  const hundreds = (tokens: string[]): number | null => {
    if (!tokens.includes('hundred')) return low(tokens);
    if (tokens[1] !== 'hundred' || small.indexOf(tokens[0]!) <= 0) return null;
    const rest = low(tokens.slice(2)); return rest === null ? null : small.indexOf(tokens[0]!) * 100 + rest;
  };
  const flush = () => {
    if (!run.length) return;
    const clean = run.filter(w => w !== 'and');
    const index = clean.indexOf('thousand');
    const high = index >= 0 ? hundreds(clean.slice(0, index)) : 0;
    const tail = hundreds(index >= 0 ? clean.slice(index + 1) : clean);
    const value = high === null || tail === null || index >= 0 && high === 0 ? null : high * 1000 + tail;
    out.push(value === null ? run.join(' ') : String(value)); run.length = 0;
  };
  for (const word of words) {
    if (['a', 'an', 'the'].includes(word)) continue;
    if (small.includes(word) || tens.includes(word) || ['hundred', 'thousand'].includes(word) || word === 'and' && run.length) run.push(word);
    else { flush(); if (word) out.push(word); }
  }
  flush(); return out.join(' ');
}

/** Shared normalization includes spelled-out numbers. */
export const normalizeAnswerText = normalizeRiddleAnswer;
/** Cheap obfuscation checks supplement the strict authored-hint boundary in validate.ts. */
export function containsAnswer(text: string, accepted: readonly string[]): boolean {
  const normal = normalizeAnswerText(text);
  const spelled = normal.replace(/\b(?:[a-z0-9] ){2,}[a-z0-9]\b/g, run => run.replace(/ /g, ''));
  const tokens = normal.split(' ');
  const aliases: Record<string, string[]> = { bell: ['belfry'], library: ['book repository'], lighthouse: ['pharos'], comb: ['hair rake'] };
  return accepted.some(answer => {
    const needle = normalizeAnswerText(answer);
    if (!needle) return false;
    if (` ${normal} `.includes(` ${needle} `)) return true;
    if ((aliases[needle] ?? []).some(a => ` ${normal} `.includes(` ${a} `))) return true;
    const joined = needle.replace(/ /g, '');
    if (joined.length >= 3 && ` ${spelled} `.includes(` ${joined} `)) return true;
    if (joined.length >= 4 && tokens.includes([...joined].reverse().join(''))) return true;
    // Anagrams only when explicitly signalled, to avoid treating ordinary prose as a cipher.
    return /anagram|unscramble|rearrange/i.test(text) && tokens.some(t => t.length === joined.length && [...t].sort().join('') === [...joined].sort().join(''));
  });
}
