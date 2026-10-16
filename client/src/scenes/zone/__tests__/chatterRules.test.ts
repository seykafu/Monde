import { describe, it, expect } from 'vitest';
import { ambientExchange, ChatBody, ChatReply } from '@monde/shared';
import { eligibleChatter, chatterChance, chatterRoll, type ChatterSpot } from '../chatterRules';
const a: ChatterSpot = { id: 'a', x: 0, y: 0, place: 'square', idle: true, visible: true, talking: false };
const b = { ...a, id: 'b', x: 1 };
describe('visible chatter', () => {
  it('requires two visible, available residents within earshot', () => {
    expect(eligibleChatter(a, b, a)).toBe(true);
    for (const patch of [{ visible: false }, { talking: true }, { x: 9 }, { id: 'a' }]) expect(eligibleChatter(a, { ...b, ...patch }, a)).toBe(false);
    expect(eligibleChatter(a, b, { x: 20, y: 0 })).toBe(false);
  });
  it('allows a shared place or two idle neighbours, but not passing strangers', () => {
    expect(eligibleChatter(a, { ...b, place: 'elsewhere' }, a)).toBe(true);
    expect(eligibleChatter(a, { ...b, place: 'elsewhere', idle: false }, a)).toBe(false);
    expect(eligibleChatter(a, { ...b, place: 'elsewhere', x: 3 }, a)).toBe(false);
  });
  it('is seeded and favours friends over rivals', () => {
    expect(chatterRoll('world', 2, 3, 'a', 'b')).toBe(chatterRoll('world', 2, 3, 'b', 'a'));
    expect(chatterChance('close_friends')).toBeGreaterThan(chatterChance('friends'));
    expect(chatterChance('friends')).toBeGreaterThan(chatterChance('rivals'));
  });
  it('has short alternating authored fallback exchanges for every mood and tie', () => {
    for (const mean of [null, -80, -30, 0, 50, 80]) for (const glum of [true, false]) {
      const lines = ambientExchange('a', 'b', mean, glum);
      expect(lines.map(l => l.speaker)).toEqual(['a', 'b']);
      expect(lines.every(l => l.text.length > 0 && l.text.length <= 220)).toBe(true);
      expect(ChatReply.safeParse({ lines, fallback: true, reason: 'offline', effects: { a: { affinity: 0, trust: 0 }, b: { affinity: 0, trust: 0 }, feeling: null, news: [] }, applied: { ab: 0, ba: 0 } }).success).toBe(true);
    }
    expect(ambientExchange('a', 'b', -30)).not.toEqual(ambientExchange('a', 'b', 80));
  });
  it('rejects self conversations and malformed clock values', () => {
    const body = { a: 'a', b: 'b', place: 'square', day: 1, minute: 600, weather: 'clear' };
    expect(ChatBody.safeParse(body).success).toBe(true);
    for (const patch of [{ b: 'a' }, { minute: -1 }, { day: 1.1 }, { topic_hint: 'x'.repeat(241) }]) expect(ChatBody.safeParse({ ...body, ...patch }).success).toBe(false);
  });
});
