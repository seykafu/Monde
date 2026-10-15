// The conversation log's entries and scrolling, as data (backlog.ts draws them). Pure: no Phaser, no DOM.

export interface LogEntry {
  /** `narrator`: a scripted scene's narration (no name, set in italics). */
  who: 'resident' | 'player' | 'narrator';
  text: string;
  /** The speaker's name, for logs with more than one resident (scripted scenes); else the log's resident. */
  name?: string;
}

/** Space between entries, design pixels. */
export const LOG_GAP = 12;

/**
 * Which entries show, scrolled so that `first` is the top one: as many whole entries as fit in `room` from
 * there (always at least `first` itself, however tall).
 */
export function visibleRange(heights: readonly number[], first: number, room: number, gap = LOG_GAP): { first: number; last: number } {
  let used = 0, last = first - 1;
  for (let i = first; i < heights.length; i++) {
    const next = used + (i > first ? gap : 0) + heights[i]!;
    if (next > room && i > first) break;
    used = next;
    last = i;
  }
  return { first, last };
}

/** The top entry that puts the newest entry at the bottom. */
export function bottomFirst(heights: readonly number[], room: number, gap = LOG_GAP): number {
  let used = 0;
  for (let i = heights.length - 1; i >= 0; i--) {
    const next = used + (used > 0 ? gap : 0) + heights[i]!;
    if (next > room && used > 0) return i + 1;
    used = next;
  }
  return 0;
}
