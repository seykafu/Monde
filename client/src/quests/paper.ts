// A line in the Lantern's notices for a dream the player helped along (§6.6's notices; Kasey's playtest 2026-10-18).
// scenes/friendship.ts publish() runs it on every morning's edition, after the Projects' notices.
import { isHiddenDream, type DreamProgress, type Press, type SavedQuests } from '@monde/shared';
import { findCard } from '../world/roster';
import { getQuests, updateQuests } from './state';

/** GDD-GAP: §6.6 gives the notices no count; the dreams take at most this many lines of a morning. */
export const DREAM_NOTICES_MAX = 3;

/**
 * The notices for stages done since the last paper (on or before `day`), one line per resident, and the dreams with
 * those stages marked printed. A "(hidden)" dream is nobody's business: it never makes the paper. Pure.
 */
export function dreamNotices(dreams: Readonly<Record<string, DreamProgress>>, day: number, name: (id: string) => string,
  hidden: (id: string) => boolean): { notices: string[]; dreams: Record<string, DreamProgress> } {
  const notices: string[] = [];
  let out: Record<string, DreamProgress> | null = null;
  for (const [resident, p] of Object.entries(dreams)) {
    const fresh = p.done.filter(d => d.printed === null && d.day <= day);
    if (!fresh.length) continue;
    (out ??= { ...dreams })[resident] = { ...p, done: p.done.map(d => (d.printed === null && d.day <= day ? { ...d, printed: day } : d)) };
    if (hidden(resident) || notices.length >= DREAM_NOTICES_MAX) continue;
    notices.push(fresh.some(d => d.stage === lastStage(resident))
      ? `${name(resident)}'s long-held wish has come true, with the Fellow's help.`
      : `${name(resident)} is a step nearer a long-held wish, with the Fellow's help.`);
  }
  return { notices, dreams: out ?? (dreams as Record<string, DreamProgress>) };
}

const lastStage = (resident: string): number => (findCard(resident)?.dream.stages.length ?? 0) - 1;

interface Registry { get(key: string): unknown; set(key: string, value: unknown): unknown }

/** The morning's edition with the dream notices in (the quests marked printed). */
export function dreamPaper(r: Registry, day: number, edition: Press, name: (id: string) => string): Press {
  const q: SavedQuests = getQuests(r);
  const { notices, dreams } = dreamNotices(q.dreams, day, name, id => isHiddenDream(findCard(id)?.dream.text ?? ''));
  if (dreams !== q.dreams) updateQuests(r, s => ({ ...s, dreams }));
  return notices.length ? { ...edition, notices: [...edition.notices, ...notices] } : edition;
}
