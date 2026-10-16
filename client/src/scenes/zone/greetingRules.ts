/**
 * Passing greetings (GDD §9.11.3: residents who meet in view; MVP polish): when two residents on screen pass close while
 * walking, each says a one-line beat (content/lines/ambient.yaml), with no server call. Pure rules: who is passing, and
 * the throttle. The Phaser side is greetings.ts.
 */
import { pairKey } from '@monde/shared';

/**
 * GDD-GAP: no numbers in the GDD. Passing: within 1.5 tiles, at least one of them walking, both within 10 tiles of the
 * player and on screen. One greeting on the board at a time and 4.5 s between their starts; a pair greets again only
 * after 4 game hours (about 3 real minutes). The greeting shows 1.7 s, then gives way to the answer, which shows 2.2 s.
 */
export const GREETING_RULES = { range: 1.5, seen: 10, checkMs: 300, globalGapMs: 4500, pairGapMinutes: 240, showMs: 2200, replyDelayMs: 1700 } as const;

export interface GreetSpot {
  id: string;
  x: number;
  y: number;
  moving: boolean;
  /** Shown and on screen. */
  visible: boolean;
  /** Talking to the player or in an exchange, or already speaking. */
  busy: boolean;
}

export interface PassingPair { a: string; b: string; key: string; distance: number }

/** Pairs passing each other now, closest first. `a` is the walker (the one who speaks first). */
export function passingPairs(spots: readonly GreetSpot[], player: { x: number; y: number }): PassingPair[] {
  const ok = spots.filter(s => s.visible && !s.busy && Math.hypot(s.x - player.x, s.y - player.y) <= GREETING_RULES.seen);
  const out: PassingPair[] = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    const p = ok[i]!, q = ok[j]!;
    if (p.id === q.id || !(p.moving || q.moving)) continue;
    const distance = Math.hypot(p.x - q.x, p.y - q.y);
    if (distance > GREETING_RULES.range) continue;
    const [a, b] = p.moving ? [p, q] : [q, p];
    out.push({ a: a.id, b: b.id, key: pairKey(p.id, q.id), distance });
  }
  return out.sort((x, y) => x.distance - y.distance || (x.key < y.key ? -1 : 1));
}

/** The board's greeting pace: a gap between any two, and a pair's rest in game minutes. */
export class GreetingThrottle {
  private lastAny = -Infinity;
  private readonly pairs = new Map<string, number>();
  /** The first candidate allowed at `now` (real ms) and `minute` (game minutes, monotone within a day), recorded. */
  pick(candidates: readonly PassingPair[], now: number, minute: number): PassingPair | null {
    if (now - this.lastAny < GREETING_RULES.globalGapMs) return null;
    for (const c of candidates) {
      const last = this.pairs.get(c.key);
      if (last !== undefined && minute - last < GREETING_RULES.pairGapMinutes) continue;
      this.pairs.set(c.key, minute);
      this.lastAny = now;
      return c;
    }
    return null;
  }
  /** A pair just talked some other way (an exchange): they've said hello. */
  note(a: string, b: string, minute: number): void { this.pairs.set(pairKey(a, b), minute); }
  newDay(): void { this.pairs.clear(); }
}
