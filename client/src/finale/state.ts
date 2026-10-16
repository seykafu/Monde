// The Spring finale's state (MVP G-11): the Straw Poll, the quotes printed with it, the day the End-of-Spring report was
// shown and whether the player kept wandering. One SavedFinale in the registry (`monde.finale`), saved with the game
// (SaveGame.finale). Pure: the registry is anything with get/set/remove.
import { emptyFinale, type SavedFinale } from '@monde/shared';
import type { RegistryLike } from '../fellow/state';

export const FINALE_KEY = 'monde.finale';
/** The Straw Poll is taken at the Bloom Fair (Day 25); the morning after, the Lantern prints it and Spring is over. */
export const POLL_DAY = 25;
export const REPORT_DAY = 26;

export const finaleOf = (r: Pick<RegistryLike, 'get'>): SavedFinale => (r.get(FINALE_KEY) as SavedFinale | undefined) ?? emptyFinale();
export function updateFinale(r: RegistryLike, fn: (s: SavedFinale) => SavedFinale): SavedFinale {
  const next = fn(finaleOf(r));
  r.set(FINALE_KEY, next);
  return next;
}

/**
 * The End-of-Spring report is due once Spring is over (the morning of Day 26 or later) and it hasn't been shown. The
 * Dawn Report comes first: the report waits while a paper is pending or open.
 */
export const reportDue = (r: Pick<RegistryLike, 'get'>, day: number): boolean => day >= REPORT_DAY && finaleOf(r).reportDay === null;
