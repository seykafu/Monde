import { describe, expect, it } from 'vitest';
import { readSse, SseParser, type SseEvent } from '../sse';
import { parseTalkEvent, StreamedTurn } from '../talkStream';
import type { TalkTurn } from '../types';

const feed = (chunks: readonly string[]): SseEvent[] => {
  const p = new SseParser();
  const out = chunks.flatMap(c => p.push(c));
  return [...out, ...p.end()];
};

const delta = (index: number, text: string, attempt = 1) =>
  `event: line_delta\ndata: ${JSON.stringify({ index, text_so_far: text, attempt })}\n\n`;
const turnPayload: TalkTurn = {
  conversation_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', resident_id: 'pell', turn_index: 0,
  lines: [{ text: 'Hello again.', expr: 'warm' }], choices: [{ id: 'a', text: 'Hello.', intent: 'kind' }, { id: 'b', text: 'Leave', intent: 'leave' }],
  wrap_up: false, fallback: false
};
const STREAM = [
  delta(0, 'Hello'), delta(0, 'Hello again.'),
  `event: thinking\ndata: {"text":"Hm."}\n\n`,
  `event: turn\ndata: ${JSON.stringify(turnPayload)}\n\n`
].join('');

describe('SseParser', () => {
  it('parses a whole stream in one chunk, several events per chunk', () => {
    const events = feed([STREAM]);
    expect(events.map(e => e.event)).toEqual(['line_delta', 'line_delta', 'thinking', 'turn']);
    expect(JSON.parse(events[3]!.data)).toEqual(turnPayload);
  });

  it('gives the same events however the stream is cut, down to one character per chunk', () => {
    const whole = feed([STREAM]);
    expect(feed([...STREAM])).toEqual(whole);
    for (const size of [2, 3, 5, 7, 11, 64]) {
      const chunks: string[] = [];
      for (let i = 0; i < STREAM.length; i += size) chunks.push(STREAM.slice(i, i + size));
      expect(feed(chunks)).toEqual(whole);
    }
    // Cut right inside a field name, between the colon and the value, and between the two newlines.
    const at = (s: string) => STREAM.indexOf(s);
    const cuts = [at('event: th') + 3, at('data: {"text"') + 5, at('\n\nevent: turn') + 1];
    const pieces = [STREAM.slice(0, cuts[0]), STREAM.slice(cuts[0], cuts[1]), STREAM.slice(cuts[1], cuts[2]), STREAM.slice(cuts[2])];
    expect(feed(pieces)).toEqual(whole);
  });

  it('handles CRLF and CR line endings, including a CRLF split across chunks', () => {
    const crlf = 'event: a\r\ndata: 1\r\n\r\nevent: b\rdata: 2\r\r';
    expect(feed([crlf]).map(e => [e.event, e.data])).toEqual([['a', '1'], ['b', '2']]);
    // "data: 1\r" | "\n\r\n": the LF after the split CR must not count as a blank line.
    expect(feed(['event: a\r\ndata: 1\r', '\n', 'data: 2\r\n\r\n']).map(e => e.data)).toEqual(['1\n2']);
  });

  it('joins multi-line data, skips comments and data-less events, strips one leading space, defaults the type', () => {
    const events = feed([': keep-alive\n\ndata:first\ndata:  second\n\nevent: empty\n\nid: 9\ndata: x\n\n']);
    expect(events).toEqual([{ event: 'message', data: 'first\n second' }, { event: 'message', data: 'x', id: '9' }]);
  });

  it('drops an event whose blank line never came', () => {
    expect(feed(['data: done\n\ndata: cut off\n'])).toEqual([{ event: 'message', data: 'done' }]);
  });

  it('reads a byte stream, decoding UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('event: line_delta\ndata: {"index":0,"text_so_far":"Café — oui","attempt":1}\n\n');
    const split = bytes.indexOf(0xc3) + 1; // inside the two bytes of "é"
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split)); c.close(); }
    });
    const seen: SseEvent[] = [];
    await readSse(stream, e => seen.push(e));
    expect(JSON.parse(seen[0]!.data).text_so_far).toBe('Café — oui');
  });
});

describe('talk events', () => {
  it('types the four events and rejects malformed ones', () => {
    const [d0, , thinking, turn] = feed([STREAM]).map(parseTalkEvent);
    expect(d0).toEqual({ type: 'line_delta', data: { index: 0, text_so_far: 'Hello', attempt: 1 } });
    expect(thinking).toEqual({ type: 'thinking', data: { text: 'Hm.' } });
    expect(turn).toEqual({ type: 'turn', data: turnPayload });
    expect(parseTalkEvent({ event: 'turn', data: '{not json' })).toBeNull();
    expect(parseTalkEvent({ event: 'line_delta', data: '{"index":-1,"text_so_far":"x","attempt":1}' })).toBeNull();
    expect(parseTalkEvent({ event: 'turn', data: JSON.stringify({ ...turnPayload, lines: [] }) })).toBeNull();
    expect(parseTalkEvent({ event: 'turn', data: JSON.stringify({ ...turnPayload, choices: [{ id: 'a', text: 'x', intent: 'shout' }] }) })).toBeNull();
    expect(parseTalkEvent({ event: 'ping', data: '{}' })).toBeNull();
    expect(parseTalkEvent({ event: 'error', data: '{"code":"timeout","message":"slow"}' })).toEqual({ type: 'error', data: { code: 'timeout', message: 'slow' } });
  });
});

describe('StreamedTurn', () => {
  it('grows lines within an attempt and marks a line complete once the next starts', () => {
    const s = new StreamedTurn();
    expect(s.applyDelta({ index: 0, text_so_far: 'Morning,', attempt: 1 })).toBe('grow');
    expect(s.applyDelta({ index: 0, text_so_far: 'Morning, Fellow.', attempt: 1 })).toBe('grow');
    expect(s.applyDelta({ index: 0, text_so_far: 'Morning, Fellow.', attempt: 1 })).toBe('none');
    expect(s.complete(0)).toBe(false);
    s.applyDelta({ index: 1, text_so_far: 'Tea?', attempt: 1 });
    expect(s.complete(0)).toBe(true);
    expect(s.lines).toEqual(['Morning, Fellow.', 'Tea?']);
  });

  it('discards earlier-attempt text when the attempt increases, and ignores stale deltas after', () => {
    const s = new StreamedTurn();
    s.applyDelta({ index: 0, text_so_far: 'The gamekeeper', attempt: 1 });
    s.applyDelta({ index: 1, text_so_far: 'said so.', attempt: 1 });
    expect(s.applyDelta({ index: 0, text_so_far: 'Well.', attempt: 2 })).toBe('reset');
    expect(s.lines).toEqual(['Well.']);
    expect(s.applyDelta({ index: 1, text_so_far: 'said so, and more.', attempt: 1 })).toBe('none');
    expect(s.lines).toEqual(['Well.']);
  });

  it('treats the turn as authoritative: continue if it carries on from the stream, else reset', () => {
    const s = new StreamedTurn();
    s.applyDelta({ index: 0, text_so_far: 'Hello', attempt: 1 });
    expect(s.applyTurn(turnPayload)).toBe('grow');
    expect(s.lines).toEqual(['Hello again.']);
    const t = new StreamedTurn();
    t.applyDelta({ index: 0, text_so_far: 'Something else entirely', attempt: 2 });
    expect(t.applyTurn(turnPayload)).toBe('reset');
    expect(t.applyDelta({ index: 0, text_so_far: 'late', attempt: 3 })).toBe('none');
  });
});
