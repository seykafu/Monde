/** Server-owned records: answers never come from the request or enter model prompts. */
import { SPRING_RIDDLES } from '@monde/shared';
import type { RiddleTopic } from './promptBuilder.js';
export interface RiddleRecord { id: string; inscription: string; hints: readonly [string, string, string]; accepted: readonly string[] }
export const RIDDLES: Readonly<Record<string, RiddleRecord>> = Object.fromEntries(SPRING_RIDDLES.map(r => [r.id, {
  id: r.id, inscription: r.inscription, accepted: r.accepted,
  // GDD-GAP: Tib has no authored hints. An empty slot is unavailable, never invented.
  hints: r.hints.map(h => h ?? '') as [string, string, string]
}]));
export function riddleRecord(id: string): RiddleRecord | null { return Object.hasOwn(RIDDLES, id) ? RIDDLES[id]! : null; }
export function riddleTopic(record: RiddleRecord, allowed: number): RiddleTopic {
  return { ...record, allowed };
}
