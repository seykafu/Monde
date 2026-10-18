// When to prewarm a resident's prompt cache (GDD §9.10 flow step 1). Pure.
import { DAY_SPAN, DAY_START } from '../sim/clock';

/** §9.10 step 1: the player walks within 6 tiles of a resident. */
export const PREWARM_RANGE = 6;
/**
 * At most once per resident per 4 in-game hours (MVP M-05 brief). The server separately allows one per
 * resident per 4 real minutes; 4 game hours is 3 real minutes at 0.75 s per game minute (§5.3).
 */
export const PREWARM_EVERY_MINUTES = 4 * 60;
/**
 * GDD-GAP: §9.10 prewarms everyone within 6 tiles. With the Day-1 census (MVP M-03) most of the 212 are Ambient (§9.8)
 * and a walk down Market Street passes dozens, few of whom the player will talk to. A prewarm writes the resident's
 * cache whether or not anyone talks, and in a playtest (2026-10-18) prewarms were half a world's day spend: an Ambient
 * resident is prewarmed only when the player is close enough to be about to talk (2 tiles), at most 12 a game day.
 */
export const AMBIENT_PREWARM_RANGE = 2;
export const AMBIENT_PREWARMS_PER_DAY = 12;

export type PrewarmTier = 'core' | 'acquainted' | 'ambient';

/** A resident's detail tier as the client knows it: the last dawn's (the friendship mirror's `tiers`), else canon → Core. */
export function prewarmTier(kind: string | undefined, dawnTier: string | undefined): PrewarmTier {
  if (dawnTier === 'core' || dawnTier === 'acquainted' || dawnTier === 'ambient') return dawnTier;
  return kind === 'canon' ? 'core' : 'ambient';
}

/** How close the player comes before a resident of `tier` is prewarmed. */
export const prewarmRange = (tier: PrewarmTier): number => (tier === 'ambient' ? AMBIENT_PREWARM_RANGE : PREWARM_RANGE);

/** Game minutes since Day 1 06:00. */
export const absoluteMinute = (day: number, minute: number): number => (day - 1) * DAY_SPAN + (minute - DAY_START);

export class PrewarmGate {
  private readonly last = new Map<string, number>();
  private ambientDay = NaN;
  private ambientToday = 0;

  /**
   * True (and remembered) if `residentId` may be prewarmed now. A clock moved backwards (dev keys) allows it again.
   * An Ambient resident also takes one of the day's AMBIENT_PREWARMS_PER_DAY.
   */
  allow(residentId: string, day: number, minute: number, tier: PrewarmTier = 'core'): boolean {
    const now = absoluteMinute(day, minute), before = this.last.get(residentId);
    if (before !== undefined && now >= before && now - before < PREWARM_EVERY_MINUTES) return false;
    if (tier === 'ambient') {
      if (day !== this.ambientDay) { this.ambientDay = day; this.ambientToday = 0; }
      if (this.ambientToday >= AMBIENT_PREWARMS_PER_DAY) return false;
      this.ambientToday++;
    }
    this.last.set(residentId, now);
    return true;
  }
}
