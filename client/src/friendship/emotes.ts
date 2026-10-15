// When two residents with a tie meet in the world (GDD §9.11.3, §16.5 emotes; MVP G-13 client). Pure: no Phaser.
//
// Residents standing or passing close together are a meeting. A pair whose tie has an emote (♪ Friends, ♥ Close
// friends or sweethearts, … Rivals, 💢 Enemies) floats it over the two of them, now and then: each pair at most once a
// minute and a half, and the board at most one pair every few seconds, so a busy square isn't a cloud of hearts.
// A meeting the player can see also teaches them the tie (knownTies.ts, "seen").
import { pairKey } from '@monde/shared';

/**
 * GDD-GAP: §9.11.3 and §16.5 give no distances or timings. Meeting: within 1.8 tiles of each other (a step apart
 * or side by side). Seen: both within 9 tiles of the player (about half the screen across at the game's zoom).
 * Each pair emotes at most every 90 s of real time, the board at most every 4 s; the emote shows for 1.8 s.
 */
export const PAIR_EMOTE_RULES = { meetTiles: 1.8, seenTiles: 9, pairCooldownMs: 90_000, globalGapMs: 4_000, showMs: 1_800, checkMs: 500 } as const;

export interface Spot { id: string; x: number; y: number }
export interface NearPair { a: string; b: string; key: string; distance: number }

/** Every pair of spots within `range` of each other, closest first. */
export function nearPairs(spots: readonly Spot[], range: number = PAIR_EMOTE_RULES.meetTiles): NearPair[] {
  const out: NearPair[] = [];
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const p = spots[i]!, q = spots[j]!;
    if (p.id === q.id) continue;
    const distance = Math.hypot(p.x - q.x, p.y - q.y);
    if (distance <= range) out.push({ a: p.id < q.id ? p.id : q.id, b: p.id < q.id ? q.id : p.id, key: pairKey(p.id, q.id), distance });
  }
  return out.sort((x, y) => x.distance - y.distance || (x.key < y.key ? -1 : 1));
}

/** Both of the pair within sight of the player. */
export const inSight = (pair: Pick<NearPair, 'a' | 'b'>, spots: ReadonlyMap<string, Spot>, player: { x: number; y: number },
  range: number = PAIR_EMOTE_RULES.seenTiles): boolean =>
  [pair.a, pair.b].every(id => { const s = spots.get(id); return !!s && Math.hypot(s.x - player.x, s.y - player.y) <= range; });

/** Which meeting pair may emote now. */
export class PairEmoteThrottle {
  private readonly last = new Map<string, number>();
  private lastAny = -Infinity;

  constructor(private readonly rules: { pairCooldownMs: number; globalGapMs: number } = PAIR_EMOTE_RULES) {}

  /** The first of `candidates` (in order) allowed to emote at `now`, recorded as emoting; null if none may. */
  pick(candidates: readonly { key: string }[], now: number): string | null {
    if (now - this.lastAny < this.rules.globalGapMs) return null;
    for (const c of candidates) {
      const last = this.last.get(c.key);
      if (last !== undefined && now - last < this.rules.pairCooldownMs) continue;
      this.last.set(c.key, now);
      this.lastAny = now;
      return c.key;
    }
    return null;
  }
}
