import { describe, it, expect } from 'vitest';
import { ambientExchange, ChatBody, ChatReply } from '@monde/shared';
import {
  CHATTER_RULES, ChatterThrottle, PlayerLinger, chatterChance, chatterContinues, chatterMode, chatterRoll, eligibleChatter, spotAt,
  type ChatterSpot
} from '../chatterRules';

const a: ChatterSpot = { id: 'a', x: 0, y: 0, place: 'market_row.market_street', spot: null, idle: true, visible: true, near: true, talking: false };
const b: ChatterSpot = { ...a, id: 'b', x: 1 };
const here = { x: 0, y: 0 };

describe('who may start talking', () => {
  it('requires two visible, available residents within earshot (10 tiles)', () => {
    expect(eligibleChatter(a, b, here)).toBe(true);
    for (const patch of [{ visible: false }, { talking: true }, { id: 'a' }]) expect(eligibleChatter(a, { ...b, ...patch }, here)).toBe(false);
    expect(eligibleChatter(a, b, { x: 9.5, y: 0 })).toBe(true);
    expect(eligibleChatter(a, b, { x: 10.5, y: 0 })).toBe(false);
  });

  it('pairs residents at the same social spot, or two standing within 3 tiles, not passers-by', () => {
    expect(eligibleChatter(a, { ...b, x: 3 }, here)).toBe(true);
    expect(eligibleChatter(a, { ...b, x: 3.5 }, here)).toBe(false);
    expect(eligibleChatter(a, { ...b, idle: false }, here)).toBe(false);
    // The same social spot: even walking up to it, and a little further apart.
    const pump = { spot: 'market_row.pump' };
    expect(eligibleChatter({ ...a, ...pump, idle: false }, { ...b, ...pump, x: 3.5 }, here)).toBe(true);
    expect(eligibleChatter({ ...a, ...pump }, { ...b, spot: 'market_row.pub_front', x: 3.5 }, here)).toBe(false);
  });

  it('is seeded, and favours friends over rivals (who still bicker now and then)', () => {
    expect(chatterRoll('world', 2, 3, 'a', 'b')).toBe(chatterRoll('world', 2, 3, 'b', 'a'));
    expect(chatterChance('close_friends')).toBeGreaterThan(chatterChance('friends'));
    expect(chatterChance('friends')).toBeGreaterThan(chatterChance());
    expect(chatterChance()).toBeGreaterThan(chatterChance('rivals'));
    expect(chatterChance('rivals')).toBeGreaterThan(0);
  });
});

describe('a running exchange', () => {
  it('carries on while the pair is together and near the view, even off its edge', () => {
    expect(chatterContinues(a, b, here)).toBe(true);
    expect(chatterContinues({ ...a, visible: false }, { ...b, visible: false }, here)).toBe(true); // the camera scrolled a little
    expect(chatterContinues(a, b, { x: 17, y: 0 })).toBe(true);
  });
  it('stops when one goes, walks off, is far off screen or is called away by the player', () => {
    expect(chatterContinues(a, undefined, here)).toBe(false);
    expect(chatterContinues(a, { ...b, near: false }, here)).toBe(false);
    expect(chatterContinues(a, { ...b, x: CHATTER_RULES.apart + 0.5 }, here)).toBe(false);
    expect(chatterContinues(a, b, { x: 20, y: 0 })).toBe(false);
    expect(chatterContinues(a, { ...b, talking: true }, here)).toBe(false);
  });
});

describe('live or authored', () => {
  const base = { online: true, lingering: true, player: here, a, b, sinceLiveMs: Infinity, liveToday: 0 };
  it('asks the server only when the player is close and has stopped to listen', () => {
    expect(chatterMode(base)).toBe('live');
    expect(chatterMode({ ...base, online: false })).toBe('authored');
    expect(chatterMode({ ...base, lingering: false })).toBe('authored');
    expect(chatterMode({ ...base, player: { x: 6.5, y: 0 } })).toBe('authored');
  });
  it('keeps to the budget: one every 45 s, 20 a day', () => {
    expect(chatterMode({ ...base, sinceLiveMs: 44_000 })).toBe('authored');
    expect(chatterMode({ ...base, sinceLiveMs: 45_000 })).toBe('live');
    expect(chatterMode({ ...base, liveToday: 19 })).toBe('live');
    expect(chatterMode({ ...base, liveToday: 20 })).toBe('authored');
  });
  it('knows when the player is lingering', () => {
    const l = new PlayerLinger();
    l.update(16, { x: 5, y: 5 });
    for (let t = 0; t < 2400; t += 100) l.update(100, { x: 5.4, y: 5.2 });
    expect(l.lingering).toBe(false);
    l.update(200, { x: 5.4, y: 5.3 });
    expect(l.lingering).toBe(true);
    l.update(16, { x: 7, y: 5 });
    expect(l.lingering).toBe(false);
  });
});

describe('pacing', () => {
  it('keeps 15 s between exchanges on the board and rests a pair three game hours', () => {
    const t = new ChatterThrottle();
    expect(t.allows('a', 'b', 0, 600)).toBe(true);
    t.record('a', 'b', 0, 600);
    expect(t.allows('c', 'd', 14_000, 610)).toBe(false);
    expect(t.allows('c', 'd', 15_000, 610)).toBe(true);
    expect(t.allows('b', 'a', 60_000, 779)).toBe(false);
    expect(t.allows('b', 'a', 60_000, 780)).toBe(true);
    t.newDay();
    expect(t.allows('a', 'b', 60_000, 0)).toBe(true);
  });
});

describe('social spots', () => {
  const spots = [
    { id: 'pump', at: [17, 20] as const, stand: [[16, 19], [17, 20], [18, 20]] as const },
    { id: 'pub', at: [13, 11] as const, stand: [[12, 11], [13, 11]] as const },
  ];
  it('says which spot a resident stands at, if any', () => {
    expect(spotAt(spots, { x: 17.5, y: 20.5 })).toBe('pump');
    expect(spotAt(spots, { x: 16.6, y: 19.4 })).toBe('pump');
    expect(spotAt(spots, { x: 12.5, y: 11.5 })).toBe('pub');
    expect(spotAt(spots, { x: 15, y: 15 })).toBeNull();
  });
});

describe('the server fallback', () => {
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
