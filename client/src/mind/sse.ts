// A Server-Sent Events parser for fetch() bodies (the talk endpoint is a POST, so EventSource can't be used).
// Pure apart from TextDecoder (in Node and browsers). Follows the WHATWG event-stream rules: lines end in
// CRLF, LF or CR (a CRLF may be split across chunks); a blank line dispatches; `:` lines are comments;
// "field: value" drops one leading space; several `data` lines join with "\n"; an event with no data is not
// dispatched; a final event without its blank line is discarded at end of stream.

export interface SseEvent {
  /** The `event` field, or "message". */
  event: string;
  data: string;
  id?: string;
}

export class SseParser {
  private buffer = '';
  /** The previous chunk ended in CR: a leading LF in the next one belongs to it. */
  private pendingCr = false;
  private started = false;
  private eventType = '';
  private data: string[] = [];
  private id: string | undefined;

  /** Feed decoded text; returns the events completed by it, in order. */
  push(chunk: string): SseEvent[] {
    if (!this.started && chunk.length > 0) {
      this.started = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    if (chunk.length === 0) return [];
    if (this.pendingCr && chunk.startsWith('\n')) chunk = chunk.slice(1);
    this.pendingCr = false;
    this.buffer += chunk;
    const out: SseEvent[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (c !== '\n' && c !== '\r') continue;
      this.line(this.buffer.slice(start, i), out);
      if (c === '\r') {
        if (i + 1 < this.buffer.length) { if (this.buffer[i + 1] === '\n') i++; }
        else this.pendingCr = true;
      }
      start = i + 1;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** End of stream: a trailing event that never got its blank line is dropped (per the spec). */
  end(): SseEvent[] {
    this.buffer = '';
    this.reset();
    return [];
  }

  private line(line: string, out: SseEvent[]): void {
    if (line === '') {
      if (this.data.length > 0) {
        out.push({ event: this.eventType || 'message', data: this.data.join('\n'), ...(this.id !== undefined ? { id: this.id } : {}) });
      }
      this.reset();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventType = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    // `retry` and unknown fields are ignored.
  }

  private reset(): void {
    this.eventType = '';
    this.data = [];
  }
}

/**
 * Read an event stream body to the end, calling `onEvent` for each event. Decodes UTF-8 across chunk
 * boundaries. Resolves when the stream ends; rejects if reading fails (including an abort).
 */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) onEvent(event);
    }
    for (const event of parser.push(decoder.decode())) onEvent(event);
    parser.end();
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
