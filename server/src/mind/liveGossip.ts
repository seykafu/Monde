import { LiveGossipOutput, modelOutputFormat, type ChatLine, type ChatBody } from '@monde/shared';
import { buildGossipRequest, type GossipInput } from './promptBuilder.js';
import type { ResidentPrefix } from './context.js';
import { lexicalHits } from './filters.js';
import { checkedExpression } from './expressions.js';
import { validateEncounter } from './encounters.js';

/** Add dynamic live facts without changing any cached system bytes or dialogue builders. */
export function buildLiveGossipRequest(input: GossipInput, scene: ChatBody, a: ResidentPrefix, b: ResidentPrefix) {
  const request = buildGossipRequest({ ...input, mode: 'live' });
  request.output_config = { format: modelOutputFormat(LiveGossipOutput) };
  request.messages[0]!.content += '\nLive facts: ' + JSON.stringify({
    weather: scene.weather, topic_hint: scene.topic_hint ?? null,
    a_mood: a.state.mood, b_mood: b.state.mood,
    a_expressions: a.card.portrait_expressions, b_expressions: b.card.portrait_expressions,
  });
  return request;
}

export function validateLiveGossip(raw: string, a: ResidentPrefix, b: ResidentPrefix, offered: ReadonlySet<string>, romanceAllowed: boolean) {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  const parsed = LiveGossipOutput.safeParse(json);
  if (!parsed.success) return null;
  const out = parsed.data;
  if (out.lines.length < 2 || out.lines.length > 6) return null;
  if (out.lines.some((l, i) => l.speaker !== (i % 2 ? 'b' : 'a') || !l.text.trim() || l.text.length > 220 || lexicalHits(l.text).length)) return null;
  const effects = validateEncounter(raw, { offered, romanceAllowed });
  if (!effects.ok) return null;
  const lines: ChatLine[] = out.lines.map(l => {
    const side = l.speaker === 'a' ? a : b;
    return { speaker: side.card.id, text: l.text.trim(), expr: checkedExpression(side.card, l.expr, side.state.mood.emotion) };
  });
  return { lines, effects: effects.outcome };
}
