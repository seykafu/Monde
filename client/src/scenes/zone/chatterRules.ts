/** Pure encounter triggers; no renderer or DOM. */
import { encounterRoll, type PairLabel } from '@monde/shared';
export interface ChatterSpot { id: string; x: number; y: number; place: string; idle: boolean; visible: boolean; talking: boolean }
// GDD-GAP: earshot 8 tiles, idle neighbours 2 tiles, check every 10 s, 30 s between exchanges.
export const CHATTER_RULES = { earshot: 8, near: 2, checkMs: 10000, gapMs: 30000 } as const;
export function eligibleChatter(a: ChatterSpot, b: ChatterSpot, player: { x: number; y: number }): boolean {
  const distance = (x: { x: number; y: number }, y: { x: number; y: number }) => Math.hypot(x.x - y.x, x.y - y.y);
  return a.id !== b.id && a.visible && b.visible && !a.talking && !b.talking
    && distance(a, player) <= CHATTER_RULES.earshot && distance(b, player) <= CHATTER_RULES.earshot
    && ((!!a.place && a.place === b.place) || (a.idle && b.idle && distance(a, b) <= CHATTER_RULES.near));
}
// GDD-GAP: per-check probability; friendly pairs linger, rivals rarely stop to bicker.
export const chatterChance = (label?: PairLabel): number => label === 'close_friends' ? 0.65 : label === 'friends' ? 0.5
  : label === 'rivals' || label === 'enemies' ? 0.06 : 0.2;
export const chatterRoll = (seed: string, day: number, bucket: number, a: string, b: string): number => encounterRoll(`${seed}:${bucket}`, day, a, b);
