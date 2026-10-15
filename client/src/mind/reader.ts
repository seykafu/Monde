// The dialogue panel's reading position over a streaming turn (GDD §18: typewriter with pages, "More ▾").
// Pure: the scene supplies a paginate function (Phaser word wrap) and the frame time; tests supply their own.
//
// The typewriter never runs ahead of the streamed text, so nothing shown is later taken back, except when the
// stream itself starts over (a new attempt, or a final turn that doesn't continue it): then the reader resets.
// Greedy word wrap is prefix-stable, so as a line grows its pages only ever gain text at the end.
import { StreamedTurn, type StreamChange } from './talkStream';
import type { LineDelta, TalkTurn } from './types';

export type TextSpeed = 'instant' | 'fast' | 'normal';
export const TEXT_SPEEDS: readonly TextSpeed[] = ['normal', 'fast', 'instant'];
/**
 * Milliseconds per character. GDD-GAP: §18 asks for a typewriter speed setting (including instant) without
 * numbers. Normal keeps Ravage's StoryScene pace (20 ms); fast is 2.5× that.
 */
export const MS_PER_CHAR: Readonly<Record<TextSpeed, number>> = { normal: 20, fast: 8, instant: 0 };

export type ReaderStatus =
  /** Characters of the current page are still to be revealed. */
  | 'typing'
  /** The page is shown; the line goes on to another page ("More ▾"). */
  | 'more'
  /** The page is shown; another line of this turn follows. */
  | 'next'
  /** Everything streamed so far is shown, and more is on its way. */
  | 'waiting'
  /** The whole turn has been read. */
  | 'done';

export type Paginate = (text: string) => string[];

/**
 * Where in `text` the characters of `shown` end, treating any run of whitespace as one space (word wrap may
 * turn a space into a line break), or -1 if `text` doesn't begin with them.
 */
export function continuedAt(text: string, shown: string): number {
  if (text.startsWith(shown)) return shown.length;
  const target = shown.replace(/\s+/g, ' ');
  let built = '', i = 0;
  while (built.length < target.length && i < text.length) {
    const c = text[i++]!;
    if (!/\s/.test(c)) built += c;
    else if (!built.endsWith(' ')) built += ' ';
  }
  return built === target ? i : -1;
}

export class DialogueReader {
  readonly stream = new StreamedTurn();
  line = 0;
  page = 0;
  chars = 0;
  private budget = 0;
  private readonly cache = new Map<string, string[]>();

  constructor(private readonly paginate: Paginate) {}

  /** Start a new turn (or a local line). */
  reset(): void {
    this.stream.attempt = 0;
    this.stream.lines = [];
    this.stream.final = null;
    this.rewind();
  }

  /** Feed a streamed delta. Returns 'reset' when the visible text was cleared. */
  delta(d: LineDelta): StreamChange {
    const shown = this.visible;
    return this.after(this.stream.applyDelta(d), shown);
  }

  /** Feed the authoritative turn. Returns 'reset' when the visible text was cleared. */
  finish(turn: TalkTurn): StreamChange {
    const shown = this.visible;
    return this.after(this.stream.applyTurn(turn), shown);
  }

  get hasText(): boolean { return this.stream.lines.some(l => l.length > 0); }

  pages(index = this.line): string[] {
    const text = this.stream.lines[index] ?? '';
    let pages = this.cache.get(text);
    if (!pages) {
      pages = text === '' ? [''] : this.paginate(text);
      if (pages.length === 0) pages = [''];
      if (this.cache.size > 64) this.cache.clear();
      this.cache.set(text, pages);
    }
    return pages;
  }

  /** Drop cached pages (the box was restyled). */
  repaginate(): void {
    const shown = this.visible;
    this.cache.clear();
    const page = this.pages()[this.page];
    if (page === undefined) { this.rewind(); return; }
    const at = continuedAt(page, shown);
    if (at < 0) this.rewind(); else this.chars = at;
  }

  /** The current page as far as it has been typed. */
  get visible(): string { return (this.pages()[this.page] ?? '').slice(0, this.chars); }

  /** The whole current page, typed or not (for sizing). */
  get pageText(): string { return this.pages()[this.page] ?? ''; }

  status(): ReaderStatus {
    const pages = this.pages();
    if (this.chars < (pages[this.page] ?? '').length) return 'typing';
    if (this.page < pages.length - 1) return 'more';
    if (!this.stream.complete(this.line)) return 'waiting';
    if (this.line < this.stream.lines.length - 1) return 'next';
    return this.stream.final ? 'done' : 'waiting';
  }

  /** Advance the typewriter by `dtMs`; returns the characters revealed (for voice blips). */
  tick(dtMs: number, msPerChar: number): string {
    const page = this.pages()[this.page] ?? '';
    if (this.chars >= page.length) { this.budget = 0; return ''; }
    let n: number;
    if (msPerChar <= 0) n = page.length - this.chars;
    else {
      // A long frame (or text arriving after a wait) doesn't dump a burst: at most ~70 ms' worth at once.
      this.budget = Math.min(this.budget + dtMs, Math.max(msPerChar, 70));
      n = Math.floor(this.budget / msPerChar);
      this.budget -= n * msPerChar;
    }
    const from = this.chars;
    this.chars = Math.min(page.length, this.chars + n);
    return page.slice(from, this.chars);
  }

  /** The player pressed advance. What happened: */
  advance(): 'revealed' | 'page' | 'line' | 'none' {
    switch (this.status()) {
      case 'typing':
        this.chars = (this.pages()[this.page] ?? '').length;
        return 'revealed';
      case 'more':
        this.page++; this.chars = 0; this.budget = 0;
        return 'page';
      case 'next':
        this.line++; this.page = 0; this.chars = 0; this.budget = 0;
        return 'line';
      default:
        return 'none';
    }
  }

  /** The current line's expression (from the final turn; streamed lines don't carry one yet). */
  expr(): string | null { return this.stream.final?.lines[this.line]?.expr ?? null; }

  private rewind(): void {
    this.line = 0; this.page = 0; this.chars = 0; this.budget = 0;
  }

  /** Keep the reading position on the same characters after the text grew, or start over. */
  private after(change: StreamChange, shown: string): StreamChange {
    if (change === 'reset') { this.rewind(); return 'reset'; }
    if (change === 'none') return 'none';
    const at = continuedAt(this.pages()[this.page] ?? '', shown);
    if (at < 0) { this.rewind(); return 'reset'; }
    this.chars = at;
    return change;
  }
}
