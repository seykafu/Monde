import { z } from 'zod';
const day = z.number().int().positive();
export const ScuffleOutcome = z.enum(['win', 'loss', 'flee', 'talk_down', 'paid']);
export const TollmenState = z.object({
  modifiers: z.array(z.object({ zone: z.string(), delta: z.number().int(), until: day, key: z.string() })).default([]),
  quit: z.record(z.string(), z.string()).default({}),
  deputies: z.array(z.string()).max(4).default([]),
  ledgerDay: day.nullable().default(null), charter: z.boolean().default(false)
});
export type TollmenState = z.infer<typeof TollmenState>;
export const emptyTollmen = (): TollmenState => TollmenState.parse({});
export const SavedScuffles = z.object({
  recovery: z.boolean().default(false),
  results: z.record(z.string(), z.object({ id: z.string(), outcome: ScuffleOutcome, day, zone: z.string() })).default({}),
  nettieWins: z.number().int().nonnegative().default(0)
});
export type SavedScuffles = z.infer<typeof SavedScuffles>;
export const emptyScuffles = (): SavedScuffles => SavedScuffles.parse({});
