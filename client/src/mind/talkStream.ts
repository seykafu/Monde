import { Favor } from "@monde/shared";
// Typed talk events and the streamed text of one turn (GDD §9.10 flow step 4). Pure.
//
// The server streams `line_delta {index, text_so_far, attempt}`: within an attempt a line's text only grows
// (whole words, already filtered). When validation fails the server regenerates once and attempt 2's deltas
// start over, so everything from attempt 1 is void. The final `turn` is authoritative: if its lines carry on
// from what was streamed the typewriter just keeps going; if they don't (an authored fallback after a
// streamed attempt), the client clears and starts again.
import { INTENTS, type Intent, type TurnRegard } from '@monde/shared';
import type { SseEvent } from './sse';
import type { LineDelta, TalkChoice, TalkEvent, TalkLine, TalkTurn } from './types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isString = (v: unknown): v is string => typeof v === 'string';
const isIntent = (v: unknown): v is Intent => typeof v === 'string' && (INTENTS as readonly string[]).includes(v);

function asLine(v: unknown): TalkLine | null {
  return isObject(v) && isString(v.text) && isString(v.expr) ? { text: v.text, expr: v.expr } : null;
}
function asChoice(v: unknown): TalkChoice | null {
  return isObject(v) && isString(v.id) && v.id.length > 0 && isString(v.text) && isIntent(v.intent)
    ? { id: v.id, text: v.text, intent: v.intent } : null;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The turn's applied Regard (G-13), or null if it's missing or malformed (the hearts then show no change). */
export function asTurnRegard(v: unknown): TurnRegard | null {
  if (!isObject(v) || !isNumber(v.before) || !isNumber(v.after)) return null;
  const { before, after } = v;
  return {
    before, after, delta: isNumber(v.delta) ? v.delta : after - before,
    hearts_before: isNumber(v.hearts_before) ? v.hearts_before : 0, hearts_after: isNumber(v.hearts_after) ? v.hearts_after : 0,
    first_chat: v.first_chat === true, capped: v.capped === true
  };
}

/** A `turn` payload, or null if it isn't one (no lines, a bad choice, a missing field). */
export function asTurn(v: unknown): TalkTurn | null {
  if (!isObject(v) || !isString(v.conversation_id) || !isString(v.resident_id) || !isInt(v.turn_index, 0)) return null;
  if (!Array.isArray(v.lines) || !Array.isArray(v.choices) || typeof v.wrap_up !== 'boolean') return null;
  const lines = v.lines.map(asLine), choices = v.choices.map(asChoice);
  if (lines.length === 0 || lines.some(l => !l) || choices.some(c => !c)) return null;
  return {
    ...('resumed' in v ? { resumed: v.resumed === true } : {}),
    ...(Array.isArray(v.history) ? { history: v.history.flatMap(h => isObject(h) && (h.who === 'player' || h.who === 'resident') && isString(h.text) ? [{ who: h.who, text: h.text }] : []) } : {}),
    conversation_id: v.conversation_id, resident_id: v.resident_id, turn_index: v.turn_index,
    lines: lines as TalkLine[], choices: choices as TalkChoice[], wrap_up: v.wrap_up, fallback: v.fallback === true,
    ...(Array.isArray(v.favors) ? { favors: v.favors.flatMap(f => { const result = Favor.safeParse(f); return result.success ? [result.data] : []; }) } : {}),
    ...('regard' in v ? { regard: asTurnRegard(v.regard) } : {})
  };
}

/** One SSE event as a typed talk event, or null for unknown events and malformed payloads. */
export function parseTalkEvent(event: SseEvent): TalkEvent | null {
  let data: unknown;
  try { data = JSON.parse(event.data); } catch { return null; }
  if (!isObject(data)) return null;
  switch (event.event) {
    case 'line_delta':
      return isInt(data.index, 0) && isString(data.text_so_far) && isInt(data.attempt, 1)
        ? { type: 'line_delta', data: { index: data.index, text_so_far: data.text_so_far, attempt: data.attempt } } : null;
    case 'thinking':
      return isString(data.text) ? { type: 'thinking', data: { text: data.text } } : null;
    case 'error':
      return { type: 'error', data: { code: isString(data.code) ? data.code : 'unknown', message: isString(data.message) ? data.message : '' } };
    case 'turn': {
      const turn = asTurn(data);
      return turn ? { type: 'turn', data: turn } : null;
    }
    default:
      return null;
  }
}

/** What applying a delta or the final turn did to the text the player may already be reading. */
export type StreamChange =
  /** Nothing changed (a stale attempt, or the same text again). */
  | 'none'
  /** Text was added after what was there: keep typing. */
  | 'grow'
  /** Earlier text is void (a new attempt, or a final turn that doesn't continue the stream): start over. */
  | 'reset';

/** The lines of one turn as they arrive. */
export class StreamedTurn {
  attempt = 0;
  lines: string[] = [];
  final: TalkTurn | null = null;

  /** A line is complete once a later line has started or the turn has arrived. */
  complete(index: number): boolean {
    return this.final !== null || this.lines.length > index + 1;
  }

  applyDelta(d: LineDelta): StreamChange {
    if (this.final || d.attempt < this.attempt) return 'none';
    let change: StreamChange = 'grow';
    if (d.attempt > this.attempt) {
      change = this.lines.length > 0 ? 'reset' : 'grow';
      this.attempt = d.attempt;
      this.lines = [];
    }
    // Deltas for a line arrive in order; one that skips ahead leaves blanks that fill in later.
    while (this.lines.length < d.index) this.lines.push('');
    const before = this.lines[d.index] ?? '';
    if (d.text_so_far === before) return change === 'reset' ? 'reset' : 'none';
    if (!d.text_so_far.startsWith(before)) change = 'reset';
    this.lines[d.index] = d.text_so_far;
    return change;
  }

  /** The authoritative lines. 'grow' when they carry on from everything streamed, else 'reset'. */
  applyTurn(turn: TalkTurn): StreamChange {
    const lines = turn.lines.map(l => l.text);
    const continues = this.lines.length <= lines.length && this.lines.every((text, i) => lines[i]!.startsWith(text));
    const same = continues && this.lines.length === lines.length && this.lines.every((text, i) => lines[i] === text);
    this.final = turn;
    this.lines = lines;
    return !continues ? 'reset' : same ? 'none' : 'grow';
  }
}
