// When to prewarm a resident's prompt cache (GDD §9.10 flow step 1). Pure.
import { DAY_SPAN, DAY_START } from '../sim/clock';

/** §9.10 step 1: the player walks within 6 tiles of a resident. */
export const PREWARM_RANGE = 6;
/**
 * At most once per resident per 4 in-game hours (MVP M-05 brief). The server separately allows one per
 * resident per 4 real minutes; 4 game hours is 3 real minutes at 0.75 s per game minute (§5.3).
 */
export const PREWARM_EVERY_MINUTES = 4 * 60;

/** Game minutes since Day 1 06:00. */
export const absoluteMinute = (day: number, minute: number): number => (day - 1) * DAY_SPAN + (minute - DAY_START);

export class PrewarmGate {
  private readonly last = new Map<string, number>();

  /** True (and remembered) if `residentId` may be prewarmed now. A clock moved backwards (dev keys) allows it again. */
  allow(residentId: string, day: number, minute: number): boolean {
    const now = absoluteMinute(day, minute), before = this.last.get(residentId);
    if (before !== undefined && now >= before && now - before < PREWARM_EVERY_MINUTES) return false;
    this.last.set(residentId, now);
    return true;
  }
}
