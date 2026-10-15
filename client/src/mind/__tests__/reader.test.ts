import { describe, expect, it } from 'vitest';
import { continuedAt, DialogueReader, MS_PER_CHAR } from '../reader';
import type { TalkTurn } from '../types';

/** A stand-in for Phaser word wrap: greedy wrap at `width` characters, `lines` lines per page. */
const wrap = (width: number, lines: number) => (text: string): string[] => {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + word.length > width) { out.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  const pages: string[] = [];
  for (let i = 0; i < out.length; i += lines) pages.push(out.slice(i, i + lines).join('\n'));
  return pages;
};

/** Run the typewriter in 16 ms frames until the page is out (or nothing more can be typed). */
const typeOut = (r: DialogueReader, ms = MS_PER_CHAR.normal): void => {
  for (let i = 0; i < 1000 && r.status() === 'typing'; i++) r.tick(16, ms);
};

const turn = (...texts: string[]): TalkTurn => ({
  conversation_id: 'c', resident_id: 'pell', turn_index: 0, lines: texts.map(text => ({ text, expr: 'warm' })),
  choices: [], wrap_up: false, fallback: false
});

describe('DialogueReader', () => {
  it('types only what has streamed, waits for more, and never takes shown text back', () => {
    const r = new DialogueReader(wrap(40, 3));
    r.delta({ index: 0, text_so_far: 'Morning,', attempt: 1 });
    typeOut(r);
    expect(r.visible).toBe('Morning,');
    const seen: string[] = [r.visible];
    expect(r.status()).toBe('waiting');
    r.delta({ index: 0, text_so_far: 'Morning, Fellow. Lovely day for it.', attempt: 1 });
    for (let i = 0; i < 200; i++) { r.tick(16, MS_PER_CHAR.normal); seen.push(r.visible); }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.startsWith(seen[i - 1]!)).toBe(true);
    expect(r.visible).toBe('Morning, Fellow. Lovely day for it.');
    expect(r.status()).toBe('waiting');
    r.finish(turn('Morning, Fellow. Lovely day for it.'));
    expect(r.status()).toBe('done');
    expect(r.expr()).toBe('warm');
  });

  it('starts over quietly when a new attempt begins', () => {
    const r = new DialogueReader(wrap(40, 3));
    r.delta({ index: 0, text_so_far: 'The gamekeeper said', attempt: 1 });
    r.tick(10_000, 0);
    expect(r.visible).toBe('The gamekeeper said');
    expect(r.delta({ index: 0, text_so_far: 'Well.', attempt: 2 })).toBe('reset');
    expect(r.visible).toBe('');
    r.tick(16, 0);
    expect(r.visible).toBe('Well.');
  });

  it('pages a long line ("More ▾") and steps through lines', () => {
    const r = new DialogueReader(wrap(20, 2));
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    r.finish(turn(long, 'Second line.'));
    expect(r.pages().length).toBeGreaterThan(1);
    expect(r.status()).toBe('typing');
    expect(r.advance()).toBe('revealed'); // the first press completes the page
    expect(r.status()).toBe('more');
    let guard = 0;
    while (r.status() === 'more' && guard++ < 10) { expect(r.advance()).toBe('page'); typeOut(r, MS_PER_CHAR.fast); }
    expect(r.status()).toBe('next');
    expect(r.advance()).toBe('line');
    r.tick(10_000, 0);
    expect(r.visible).toBe('Second line.');
    expect(r.status()).toBe('done');
    expect(r.advance()).toBe('none');
  });

  it('keeps its place when wrapping turns a space into a line break', () => {
    expect(continuedAt('Hello there\nfriend', 'Hello there ')).toBe(12);
    expect(continuedAt('Hello there friend', 'Hello there')).toBe(11);
    expect(continuedAt('Goodbye', 'Hello')).toBe(-1);
  });

  it('types at the chosen speed: instant shows the page at once, normal at 20 ms a character', () => {
    const r = new DialogueReader(wrap(80, 4));
    r.finish(turn('Twenty characters!!!'));
    expect(r.tick(100, MS_PER_CHAR.normal)).toHaveLength(3); // bursts are capped at ~70 ms
    r.reset();
    r.finish(turn('Twenty characters!!!'));
    expect(r.tick(16, MS_PER_CHAR.instant)).toBe('Twenty characters!!!');
  });
});
