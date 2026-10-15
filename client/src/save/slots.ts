import type { SaveGame } from '@monde/shared';
export const MANUAL_SLOTS = ['manual:1', 'manual:2', 'manual:3'] as const;
export const AUTO_SLOTS = ['dawn:1', 'dawn:2', 'dawn:3'] as const;
export interface SaveEntry { slot: string; save: SaveGame }
export const checkpointSlot = (key: string): string => {
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error('Invalid checkpoint key');
  return `checkpoint:${key}`;
};
export function chooseAutosaveSlot(entries: readonly SaveEntry[]): string {
  return AUTO_SLOTS.find(slot => !entries.some(e => e.slot === slot))
    ?? [...entries].filter(e => AUTO_SLOTS.some(s => s === e.slot)).sort((a, b) => a.save.saved_at.localeCompare(b.save.saved_at) || a.slot.localeCompare(b.slot))[0]!.slot;
}
export const sortForMenu = (entries: readonly SaveEntry[]): SaveEntry[] => [...entries].sort((a, b) =>
  b.save.saved_at.localeCompare(a.save.saved_at) || a.slot.localeCompare(b.slot));
export const formatSummary = ({ summary: s }: SaveGame): string =>
  `${s.player_name} · Day ${s.day} (${s.weekday}) · ${Math.floor(s.time / 60) % 24}:${String(Math.floor(s.time % 60)).padStart(2, '0')} · ${s.zone.replaceAll('_', ' ')} · ${Math.floor(s.playtime / 60)}m`;
