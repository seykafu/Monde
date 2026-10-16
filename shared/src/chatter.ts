/** Shared wire contract and authored Quiet Mode exchanges (§9.11). */
import { z } from 'zod';
import { GossipOutput } from './outputs';
import { pairLabel } from './friendship';

export const ChatBody = z.object({
  a: z.string().regex(/^[a-z0-9_]+$/).max(80), b: z.string().regex(/^[a-z0-9_]+$/).max(80),
  place: z.string().min(1).max(120), day: z.number().int().min(1).max(100000),
  minute: z.number().int().min(0).max(1560), weather: z.string().min(1).max(80),
  topic_hint: z.string().max(240).optional(),
}).strict().refine(v => v.a !== v.b, 'Two different residents are required');
export type ChatBody = z.infer<typeof ChatBody>;
export const ChatLine = z.object({ speaker: z.string(), text: z.string().min(1).max(220), expr: z.string() });
export type ChatLine = z.infer<typeof ChatLine>;
export const LiveGossipOutput = GossipOutput.extend({
  lines: z.array(z.object({ speaker: z.enum(['a', 'b']), text: z.string(), expr: z.string() })),
});
export const ChatReply = z.object({
  lines: z.array(ChatLine).min(2).max(6), fallback: z.boolean(), reason: z.string(),
  effects: z.object({ a: z.object({ affinity: z.number(), trust: z.number() }), b: z.object({ affinity: z.number(), trust: z.number() }),
    feeling: GossipOutput.shape.feeling_change, news: z.array(z.string()) }),
  applied: z.object({ ab: z.number(), ba: z.number() }),
});
export type ChatReply = z.infer<typeof ChatReply>;

/** Authored for any speaking resident: no invented jobs, relatives, secrets or news. */
export function ambientExchange(a: string, b: string, mean: number | null = null, glum = false): ChatLine[] {
  const label = pairLabel(mean ?? undefined, mean ?? undefined);
  const texts = label === 'rivals' || label === 'enemies'
    ? ['You always have to have the last word.', 'Only when you leave it lying about.']
    : glum ? ['Would you mind a little quiet?', 'Not at all. I can stay a moment.']
      : label === 'friends' || label === 'close_friends'
        ? ['I was hoping I might run into you.', 'Well, here I am. Walk a little with me?']
        : ['A little rest does no harm.', 'Quite right. The errands can wait a moment.'];
  return texts.map((text, i) => ({ speaker: i % 2 ? b : a, text, expr: 'neutral' }));
}
