/**
 * Pure rules for residents talking to each other on screen (GDD §9.11.3 "Encounters", §9.15 cost): who may start an
 * exchange, when a running one stops, whether it is a live one from the server or an authored one, and the throttles.
 * No renderer or DOM; the Phaser side is chatter.ts.
 */
import { encounterRoll, pairKey, type PairLabel } from '@monde/shared';

export interface ChatterSpot {
  id: string;
  /** Tile coordinates on the board. */
  x: number;
  y: number;
  /** The plan block's place. */
  place: string;
  /** The social spot (zone `social:`) they stand at, if any. */
  spot: string | null;
  idle: boolean;
  /** Shown and on screen: may start an exchange. */
  visible: boolean;
  /** Shown and on or near the screen (a margin round the view): a running exchange carries on. */
  near: boolean;
  /** Held by the player's own conversation. */
  talking: boolean;
}

/**
 * GDD-GAP: §9.11.3 says "within earshot" and gives no numbers. Art and cost tuning:
 *   earshot 10 tiles from the player (most of the screen across at the game's zoom); two idle residents within 3 tiles
 *   of each other, or at the same social spot, may talk; a check every 4 s; 15 s between exchanges on the board, and
 *   3 game hours before the same pair talks again. A running exchange stops only when the pair is more than 5 tiles
 *   apart, either is more than 18 tiles from the player, or one leaves the view's margin (a camera scroll doesn't).
 *   Live (server) exchanges: only when the player is within 6 tiles of both and has stood still (under a tile's move)
 *   for 2.5 s, at most one every 45 s and 20 a game day (the server's own cap, CHAT_DAILY_BUDGET); otherwise the
 *   exchange is authored (content/lines/ambient.yaml), with no call. §9.15 prices a live gossip exchange at
 *   ≈ $0.00022: 20 a day is at most ≈ $0.0044 a day (≈ $0.44 a 100-day run), as before; a live one also stands in for
 *   that pair's night summary call (≈ $0.00015) when they'd have had one, so the real cost is lower. Authored
 *   exchanges and passing greetings (greetings.ts) cost nothing, so more talk on screen costs no more.
 */
export const CHATTER_RULES = {
  earshot: 10, near: 3, apart: 5, far: 18,
  checkMs: 4000, gapMs: 15000, pairGapMinutes: 180,
  liveRange: 6, lingerMs: 2500, lingerTiles: 1, liveGapMs: 45000, livePerDay: 20,
} as const;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Two residents who could start talking now. */
export function eligibleChatter(a: ChatterSpot, b: ChatterSpot, player: { x: number; y: number }): boolean {
  return a.id !== b.id && a.visible && b.visible && !a.talking && !b.talking
    && dist(a, player) <= CHATTER_RULES.earshot && dist(b, player) <= CHATTER_RULES.earshot
    && ((a.spot !== null && a.spot === b.spot) || (a.idle && b.idle && dist(a, b) <= CHATTER_RULES.near));
}

/** A running exchange carries on: both still there, together, and not far off screen. */
export function chatterContinues(a: ChatterSpot | undefined, b: ChatterSpot | undefined, player: { x: number; y: number }): boolean {
  return !!a && !!b && a.near && b.near && !a.talking && !b.talking && dist(a, b) <= CHATTER_RULES.apart
    && dist(a, player) <= CHATTER_RULES.far && dist(b, player) <= CHATTER_RULES.far;
}

// GDD-GAP: per-check probability; friendly pairs linger, rivals now and then stop to bicker.
export const chatterChance = (label?: PairLabel): number => label === 'close_friends' ? 0.6 : label === 'friends' ? 0.45
  : label === 'rivals' || label === 'enemies' ? 0.12 : 0.25;
export const chatterRoll = (seed: string, day: number, bucket: number, a: string, b: string): number => encounterRoll(`${seed}:${bucket}`, day, a, b);

/** The social spot a resident is standing at: the nearest whose standing cells they're on or next to. */
export function spotAt(spots: readonly { id: string; at: readonly [number, number]; stand: readonly (readonly [number, number])[] }[],
  pos: { x: number; y: number }): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const s of spots) {
    const d = Math.hypot(pos.x - (s.at[0] + 0.5), pos.y - (s.at[1] + 0.5));
    if (d < bestD && s.stand.some(([x, y]) => Math.hypot(pos.x - (x + 0.5), pos.y - (y + 0.5)) <= 0.75)) { best = s.id; bestD = d; }
  }
  return best;
}

/** Whether the player has stood about in one place for a moment (they've stopped to listen). */
export class PlayerLinger {
  private anchor: { x: number; y: number } | null = null;
  private still = 0;
  update(dtMs: number, pos: { x: number; y: number }): void {
    if (!this.anchor || dist(this.anchor, pos) > CHATTER_RULES.lingerTiles) { this.anchor = { ...pos }; this.still = 0; return; }
    this.still += dtMs;
  }
  get lingering(): boolean { return this.still >= CHATTER_RULES.lingerMs; }
  reset(): void { this.anchor = null; this.still = 0; }
}

export type ChatterMode = 'live' | 'authored';

/** Live from the server only when it can answer, the player is close and listening, and the budget allows. */
export function chatterMode(o: { online: boolean; lingering: boolean; player: { x: number; y: number }; a: { x: number; y: number };
  b: { x: number; y: number }; sinceLiveMs: number; liveToday: number }): ChatterMode {
  const close = dist(o.player, o.a) <= CHATTER_RULES.liveRange && dist(o.player, o.b) <= CHATTER_RULES.liveRange;
  return o.online && o.lingering && close && o.sinceLiveMs >= CHATTER_RULES.liveGapMs && o.liveToday < CHATTER_RULES.livePerDay
    ? 'live' : 'authored';
}

/** The board's pacing: a gap between any two exchanges, and a pair's rest (in game minutes) before they talk again. */
export class ChatterThrottle {
  private lastAny = -Infinity;
  private readonly pairs = new Map<string, number>();
  /** May this pair start now (`now` real ms, `minute` game minutes since the day began, any monotone count)? */
  allows(a: string, b: string, now: number, minute: number): boolean {
    const last = this.pairs.get(pairKey(a, b));
    return now - this.lastAny >= CHATTER_RULES.gapMs && (last === undefined || minute - last >= CHATTER_RULES.pairGapMinutes);
  }
  record(a: string, b: string, now: number, minute: number): void { this.lastAny = now; this.pairs.set(pairKey(a, b), minute); }
  /** A new day: pairs may talk again (the board gap stands). */
  newDay(): void { this.pairs.clear(); }
}
