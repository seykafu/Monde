// Small persisted dialogue preferences and Quiet Mode memory (localStorage, every access guarded: private mode
// and blocked storage simply forget).
import { emptyQuietState, restoreQuietState, type QuietState } from './quietMode';
import { TEXT_SPEEDS, type TextSpeed } from './reader';
import type { StorageLike } from './api';

export const PREF_KEYS = { textSpeed: 'monde.textSpeed', quiet: 'monde.quiet' } as const;

export function loadTextSpeed(storage: StorageLike | null): TextSpeed {
  try {
    const v = storage?.getItem(PREF_KEYS.textSpeed);
    return (TEXT_SPEEDS as readonly string[]).includes(v ?? '') ? v as TextSpeed : 'normal';
  } catch { return 'normal'; }
}

export function saveTextSpeed(storage: StorageLike | null, speed: TextSpeed): void {
  try { storage?.setItem(PREF_KEYS.textSpeed, speed); } catch { /* not remembered */ }
}

/** B.1 "State": the per-resident rings, the player's ring and today's lines (kept here until the save file holds it). */
export function loadQuietState(storage: StorageLike | null): QuietState {
  try {
    const text = storage?.getItem(PREF_KEYS.quiet);
    return text ? restoreQuietState(JSON.parse(text)) : emptyQuietState();
  } catch { return emptyQuietState(); }
}

export function saveQuietState(storage: StorageLike | null, state: QuietState): void {
  try { storage?.setItem(PREF_KEYS.quiet, JSON.stringify(state)); } catch { /* not remembered */ }
}
