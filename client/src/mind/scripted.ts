// Scripted Quiet Mode exchanges (GDD §9.14, §13.1; content/lines/scripted.yaml). Pure: no Phaser, no DOM.
//
// A scene's `{ai_open: resident, topic, turns}` cue opens a live conversation online. With no model to talk to,
// the cue plays the exchange written for it here instead of generic small talk (quietMode.ts): a small graph of
// resident turns, each a few lines with a portrait, followed by two or three replies for the Fellow. The schema
// is documented at the top of the YAML; `parseScriptedLibrary` enforces it and throws with the offending
// exchange and node, so a broken exchange fails at boot (and in `npm run lint:content`) rather than mid-scene.
//
// `scriptedTurn` is the whole engine: given the node on show and the player's input it returns the next turn in
// the talk API's `turn` shape (so the dialogue panel treats it like any other Quiet Mode turn), plus the node it
// landed on. It keeps no state; the caller remembers the node. `exchangePaths` walks every branch for tests.
import { INTENTS, MAX_REPLIES, MIN_REPLIES, PORTRAIT_SET, REPLY_CHARS, type CompiledScene, type Intent, type PortraitExpression } from '@monde/shared';
import { QUIET_CHOICES } from './quietMode';
import type { TalkChoice, TalkInput, TalkTurn } from './types';

/** The S01–S10 scene ids (the MVP's Spring calendar); mirrors story/session.ts SPRING_SCENES. */
export const SPRING_SCENE_ID = /^s(0\d|10)[a-z]?_/;
/** A resident turn shows at most this many lines (the reply's `react` counts as one of them). */
export const MAX_TURN_LINES = 3;
/** A line is at most this many words (§12.1 Monde rule 9; scripted scenes are exempt, exchanges are not). */
export const MAX_LINE_WORDS = 55;
const LINE_KEYS = ['expr', 'text'] as const;
type Fail = (why: string) => never;

export interface ScriptedLine { readonly expr: PortraitExpression; readonly text: string }

export interface ScriptedReply {
  readonly text: string;
  readonly intent: Intent;
  /** The node that follows; absent on a goodbye (`leave`), which ends the exchange through `farewell`. */
  readonly next?: string;
  /** One short line the resident says before the next node's own lines, so a shared node can answer each reply. */
  readonly react?: ScriptedLine;
}

export interface ScriptedNode {
  readonly id: string;
  /** Replies the Fellow chooses from before the next turn; the exchange's turn number this node is shown at. */
  readonly depth: number;
  readonly lines: readonly ScriptedLine[];
  /** None on a close: the last turn, which offers only Leave. */
  readonly replies: readonly ScriptedReply[];
}

export interface ScriptedExchange {
  /** `<scene>.<resident>` */
  readonly key: string;
  readonly scene: string;
  readonly resident: string;
  /** The cue's `turns`: how many replies the player gets before the close. */
  readonly turns: number;
  readonly start: string;
  readonly nodes: Readonly<Record<string, ScriptedNode>>;
  /** Said when the player leaves before the close. */
  readonly farewell: readonly ScriptedLine[];
}

export interface ScriptedLibrary {
  readonly exchanges: readonly ScriptedExchange[];
  /** The exchange for a scene's `{ai_open}` cue to this resident, if one was written. */
  find(scene: string, resident: string): ScriptedExchange | undefined;
}

export const scriptedKey = (scene: string, resident: string): string => `${scene}.${resident}`;

// ── Parsing ─────────────────────────────────────────────────────────────────

const ID = /^[a-z][a-z0-9_]*$/;
/** Any brace-shaped token that isn't {name} or {player}. */
const FOREIGN_TOKEN = /\{(?!name\}|player\})[^}]*\}/;
const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parseLine(raw: unknown, fail: Fail): ScriptedLine {
  if (!isRecord(raw)) fail('a line must be { expr, text }');
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) if (!(LINE_KEYS as readonly string[]).includes(key)) fail(`unknown line field ${key}`);
  if (typeof r.expr !== 'string' || !(PORTRAIT_SET as readonly string[]).includes(r.expr)) fail(`expr must be one of ${PORTRAIT_SET.join(', ')} (got ${String(r.expr)})`);
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) fail('a line needs text');
  if (FOREIGN_TOKEN.test(text)) fail(`only {name} and {player} can be filled: "${text}"`);
  if (wordCount(text) > MAX_LINE_WORDS) fail(`a line is over ${MAX_LINE_WORDS} words: "${text}"`);
  return { expr: r.expr as PortraitExpression, text };
}

function parseLines(raw: unknown, what: string, fail: Fail): ScriptedLine[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_TURN_LINES) fail(`${what} needs 1–${MAX_TURN_LINES} lines`);
  return (raw as unknown[]).map((line, i) => parseLine(line, why => fail(`${what} line ${i + 1}: ${why}`)));
}

/**
 * Parse `{ exchanges: [...] }` (content/lines/scripted.yaml). Throws on the first problem, naming the exchange and
 * node. Checks the schema, then the graph: every `next` exists, every node is reachable and sits at one depth
 * however it is reached (so there are no loops), nodes with replies are shallower than `turns` and closes sit at
 * exactly `turns`, and a reply's `react` plus the next node's lines fit in three.
 */
export function parseScriptedLibrary(raw: unknown): ScriptedLibrary {
  const root = raw as { exchanges?: unknown } | null;
  if (!isRecord(root) || !Array.isArray(root.exchanges)) throw new Error('scripted.yaml: expected { exchanges: [...] }');
  const exchanges: ScriptedExchange[] = [];
  const byKey = new Map<string, ScriptedExchange>();
  for (const entry of root.exchanges as unknown[]) {
    const e = isRecord(entry) ? entry : {};
    const key = typeof e.scene === 'string' && typeof e.resident === 'string' ? scriptedKey(e.scene, e.resident) : '?';
    const failAt = (where: string): Fail => (why: string): never => { throw new Error(`scripted.yaml ${key}${where ? ` ${where}` : ''}: ${why}`); };
    const fail: Fail = failAt('');
    if (!isRecord(entry)) fail('each exchange must be a mapping');
    for (const k of Object.keys(e)) if (!['scene', 'resident', 'turns', 'start', 'farewell', 'nodes'].includes(k)) fail(`unknown field ${k}`);
    if (!ID.test(String(e.scene)) || !ID.test(String(e.resident))) fail('needs a scene id and a resident id');
    if (byKey.has(key)) fail('duplicate exchange');
    const turns = e.turns;
    if (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 1 || turns > 8) fail('turns must be a whole number from 1 to 8');
    if (typeof e.start !== 'string' || !ID.test(e.start)) fail('needs a start node');
    if (!isRecord(e.nodes) || Object.keys(e.nodes).length === 0) fail('needs nodes');
    const rawNodes = e.nodes as Record<string, unknown>;
    if (!(e.start as string in rawNodes)) fail(`start node ${String(e.start)} doesn't exist`);
    const farewell = parseLines(e.farewell, 'farewell', fail);

    // Pass 1: each node's lines and replies, without checking where `next` leads.
    const parsed = new Map<string, { lines: ScriptedLine[]; replies: ScriptedReply[] }>();
    for (const [id, rawNode] of Object.entries(rawNodes)) {
      const at: Fail = failAt(`node ${id}`);
      if (!ID.test(id)) at('node ids are lowercase letters, digits and underscores');
      if (!isRecord(rawNode)) at('a node must be a mapping');
      const n = rawNode as Record<string, unknown>;
      for (const k of Object.keys(n)) if (!['lines', 'replies'].includes(k)) at(`unknown field ${k}`);
      const lines = parseLines(n.lines, 'lines', at);
      let replies: ScriptedReply[] = [];
      if (n.replies !== undefined) {
        const list = n.replies;
        if (!Array.isArray(list) || list.length < MIN_REPLIES || list.length > MAX_REPLIES) at(`needs ${MIN_REPLIES}–${MAX_REPLIES} replies (or none, for a close)`);
        replies = (list as unknown[]).map((entryReply, i): ScriptedReply => {
          const atReply: Fail = (why: string): never => at(`reply ${i + 1}: ${why}`);
          if (!isRecord(entryReply)) atReply('must be a mapping');
          const r = entryReply as Record<string, unknown>;
          for (const k of Object.keys(r)) if (!['text', 'intent', 'next', 'react'].includes(k)) atReply(`unknown field ${k}`);
          const text = typeof r.text === 'string' ? r.text.trim() : '';
          if (!text) atReply('needs text');
          if (text.length > REPLY_CHARS) atReply(`is over ${REPLY_CHARS} characters`);
          if (FOREIGN_TOKEN.test(text)) atReply('only {name} and {player} can be filled');
          if (typeof r.intent !== 'string' || !(INTENTS as readonly string[]).includes(r.intent)) atReply(`unknown intent ${String(r.intent)}`);
          const intent = r.intent as Intent;
          if (intent === 'leave') {
            if (r.next !== undefined || r.react !== undefined) atReply('a goodbye ends the exchange: no next or react');
            return { text, intent };
          }
          if (typeof r.next !== 'string' || !ID.test(r.next)) atReply('needs a next node');
          return {
            text, intent, next: r.next as string,
            ...(r.react !== undefined ? { react: parseLine(r.react, why => atReply(`react: ${why}`)) } : {})
          };
        });
        if (replies.filter(r => r.intent === 'leave').length > 1) at('at most one reply may say goodbye');
        if (new Set(replies.map(r => r.text.toLowerCase())).size !== replies.length) at('replies repeat');
        if (!replies.some(r => r.next)) at('needs at least one reply that goes on');
      }
      parsed.set(id, { lines, replies });
    }

    // Pass 2: the graph. Depth is the turn a node is shown at; reaching it two ways at two depths is a loop or a skip.
    const depth = new Map<string, number>([[e.start as string, 0]]);
    const stack = [e.start as string];
    while (stack.length) {
      const id = stack.pop()!;
      const d = depth.get(id)!;
      parsed.get(id)!.replies.forEach((reply, i) => {
        if (!reply.next) return;
        const target = parsed.get(reply.next);
        if (!target) failAt(`node ${id}`)(`reply ${i + 1} goes to ${reply.next}, which doesn't exist`);
        if (reply.react && 1 + target!.lines.length > MAX_TURN_LINES) {
          failAt(`node ${id}`)(`reply ${i + 1}: react plus ${reply.next}'s ${target!.lines.length} lines is over ${MAX_TURN_LINES}`);
        }
        const have = depth.get(reply.next);
        if (have === undefined) { depth.set(reply.next, d + 1); stack.push(reply.next); }
        else if (have !== d + 1) failAt(`node ${reply.next}`)(`is reached at depth ${have} and depth ${d + 1} (a loop, or a shortcut around a turn)`);
      });
    }
    const nodes: Record<string, ScriptedNode> = {};
    for (const [id, node] of parsed) {
      const d = depth.get(id);
      const at: Fail = failAt(`node ${id}`);
      if (d === undefined) at('is unreachable from the start node');
      const close = node.replies.length === 0;
      if (close && d !== turns) at(`is a close at depth ${d}; with turns: ${String(turns)} a close sits at depth ${String(turns)}`);
      if (!close && d! >= (turns as number)) at(`has replies at depth ${d}, but the exchange closes at depth ${String(turns)}`);
      nodes[id] = { id, depth: d!, lines: node.lines, replies: node.replies };
    }
    const exchange: ScriptedExchange = { key, scene: e.scene as string, resident: e.resident as string, turns: turns as number, start: e.start as string, nodes, farewell };
    exchanges.push(exchange);
    byKey.set(key, exchange);
  }
  return { exchanges, find: (scene, resident) => byKey.get(scriptedKey(scene, resident)) };
}

// ── The cues an exchange answers ────────────────────────────────────────────

export interface AiOpenCue { scene: string; resident: string; turns: number }

/** Every `{ai_open}` cue in compiled scenes, in script order. */
export function aiOpenCues(scenes: readonly Pick<CompiledScene, 'id' | 'ops'>[]): AiOpenCue[] {
  return scenes.flatMap(scene => scene.ops.flatMap(op => (op.op === 'cmd' && op.cmd.cmd === 'ai_open'
    ? [{ scene: scene.id, resident: op.cmd.resident, turns: op.cmd.turns }] : [])));
}

// ── The engine ──────────────────────────────────────────────────────────────

export interface ScriptedVars {
  /** {name}: the speaker's first name. */
  name: string;
  /** {player}: the Fellow's name. */
  player: string;
}

export const fillScripted = (text: string, vars: ScriptedVars): string => text.replaceAll('{name}', vars.name).replaceAll('{player}', vars.player);

export interface ScriptedTurnContext {
  conversationId: string;
  residentId: string;
  /** The turn being made (0 for the opener). */
  turnIndex: number;
  vars: ScriptedVars;
}

export interface ScriptedStep {
  /** The turn in the talk API's shape: lines with portraits, the replies and Leave, `fallback: true`. */
  turn: TalkTurn;
  /** The node now on show (unchanged by a farewell); pass it back with the next input. */
  at: string;
}

/** The reply a choice names (`r1`, `r2`…), else the one whose words match. */
function repliedTo(node: ScriptedNode, input: Extract<TalkInput, { kind: 'choice' }>, vars: ScriptedVars): ScriptedReply | undefined {
  const n = /^r(\d)$/.exec(input.choice_id)?.[1];
  if (n && node.replies[Number(n) - 1]) return node.replies[Number(n) - 1];
  return node.replies.find(r => fillScripted(r.text, vars).toLowerCase() === input.text.trim().toLowerCase());
}

/**
 * The next turn of an exchange. `at` is the node the player is answering (null before the opener).
 * - `open` plays the start node.
 * - a reply plays its `next` node, led by its `react` line if it has one.
 * - free text continues down the first reply that goes on, without a `react` (nothing was said to react to).
 * - Leave, or a goodbye, plays the `farewell` and wraps up.
 * Returns null when it can't continue (no node yet, an unknown reply, an `open` that isn't the first turn), so the
 * caller falls back to ordinary Quiet Mode.
 */
export function scriptedTurn(ex: ScriptedExchange, at: string | null, input: TalkInput, ctx: ScriptedTurnContext): ScriptedStep | null {
  const turn = (node: string, lines: readonly ScriptedLine[], choices: TalkChoice[], wrapUp: boolean): ScriptedStep => ({
    at: node,
    turn: {
      conversation_id: ctx.conversationId, resident_id: ctx.residentId, turn_index: ctx.turnIndex,
      lines: lines.map(l => ({ text: fillScripted(l.text, ctx.vars), expr: l.expr })),
      choices, wrap_up: wrapUp, fallback: true
    }
  });
  const leave = (): TalkChoice => ({ ...QUIET_CHOICES.leave });

  if (input.kind === 'choice' && input.intent === 'leave') return at === null ? null : turn(at, ex.farewell, [leave()], true);

  let nextId: string;
  let react: ScriptedLine | undefined;
  if (input.kind === 'open') {
    if (at !== null || ctx.turnIndex !== 0) return null;
    nextId = ex.start;
  } else {
    const node = at === null ? undefined : ex.nodes[at];
    if (!node) return null;
    const picked = input.kind === 'choice' ? repliedTo(node, input, ctx.vars) : node.replies.find(r => r.next);
    if (!picked?.next) return null;
    nextId = picked.next;
    if (input.kind === 'choice') react = picked.react;
  }
  const node = ex.nodes[nextId];
  if (!node) return null;
  const close = node.replies.length === 0;
  const replies = node.replies.map((r, i): TalkChoice => ({ id: `r${i + 1}`, text: fillScripted(r.text, ctx.vars), intent: r.intent }));
  return turn(nextId, react ? [react, ...node.lines] : node.lines, [...replies, leave()], close);
}

// ── Walking every branch ────────────────────────────────────────────────────

export interface ScriptedPath {
  /** The nodes shown, start to close. */
  nodes: string[];
  /** The 0-based reply picked at each node but the close. */
  picks: number[];
}

/** Every path from the start through replies that go on (not goodbyes) to a close. */
export function exchangePaths(ex: ScriptedExchange): ScriptedPath[] {
  const out: ScriptedPath[] = [];
  const walk = (id: string, nodes: string[], picks: number[]): void => {
    const node = ex.nodes[id]!;
    if (node.replies.length === 0) { out.push({ nodes: [...nodes, id], picks }); return; }
    node.replies.forEach((reply, i) => { if (reply.next) walk(reply.next, [...nodes, id], [...picks, i]); });
  };
  walk(ex.start, [], []);
  return out;
}
