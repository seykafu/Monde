// The Quests' registry entry (SaveGame.quests: the dreams the player knows, the first-steps card) and the HUD
// objective line's on/off preference. No Phaser: the registry is anything with get/set.
import { SavedQuests, emptyQuests } from '@monde/shared';

export const QUESTS_KEY = 'monde.quests';
/** The objectives the HUD last showed (quests/hud.ts): currentObjective reads them for the dialogue's context. */
export const OBJECTIVE_KEY = 'monde.quests.objective';

interface Registry { get(key: string): unknown; set(key: string, value: unknown): unknown }

export function getQuests(r: Pick<Registry, 'get'>): SavedQuests {
  const q = r.get(QUESTS_KEY) as SavedQuests | undefined;
  return q ?? emptyQuests();
}

/** Apply `fn`; the registry is written only when it changed. */
export function updateQuests(r: Registry, fn: (q: SavedQuests) => SavedQuests): SavedQuests {
  const before = getQuests(r), after = fn(before);
  if (after !== before || !r.get(QUESTS_KEY)) r.set(QUESTS_KEY, after);
  return after;
}

// ── The objective line: shown or hidden, remembered on this device (like the text speed, mind/prefs.ts) ─────────

export const OBJECTIVE_PREF = 'monde.hud.objective';
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const storage = (): StorageLike | null => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };
let shown: boolean | null = null;
const listeners = new Set<() => void>();

export function objectiveShown(): boolean {
  if (shown === null) { try { shown = storage()?.getItem(OBJECTIVE_PREF) !== 'off'; } catch { shown = true; } }
  return shown;
}
export function setObjectiveShown(on: boolean): void {
  shown = on;
  try { storage()?.setItem(OBJECTIVE_PREF, on ? 'on' : 'off'); } catch { /* not remembered */ }
  listeners.forEach(fn => fn());
}
export function watchObjectiveShown(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
