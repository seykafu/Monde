// Quiet Mode dialogue (GDD §9.14; Appendix B.1 selection rules; MVP M-11). Pure: no Phaser, no DOM.
//
// When monde-mind can't be reached (no invite, no network, a failed stream), residents speak from the authored
// line library in content/lines/lines.yaml. B.1, step by step:
//   1. Filter: the line's kind matches, every tag present matches the context, `req` holds, and every
//      placeholder can be filled.
//   2. Score: ev 8 · w 4 · z 3 · r:= 3 · t 2 · m 2 · r: 1.
//   3. Draw: keep every survivor within 2 points of the best; pick one weighted by 1 ÷ (1 + uses of the
//      line's group by this resident in the last 3 in-game days). A group is lines with identical kind + tags.
//   4. Window: no line id within the resident's last 12 or the player's last 40, no group within the
//      resident's last 4, and a line another resident used today only if fewer than 2 others survive.
//      Exhaustion: under 2 survivors → halve the windows; none → drop the player's rule, then the
//      resident's; nothing at all → the always-valid fillers ST-046 to ST-051.
//   5. Fill placeholders.
// The windows are applied to the filtered pool before scoring (so a window that empties the best band lets
// the next band through rather than exhausting). For `ctx` with an event set, an `ev` line is preferred 70% of
// the time: the other 30% the `ev` lines sit out (unless nothing else matches).
//
// Everything random comes from the `rng` passed in, so a seed reproduces a pick exactly.
import {
  INTENTS, MAX_REPLIES, MIN_REPLIES, REPLY_CHARS, derivedReplies, evaluate, fillReply, gameContext, moodBand, regardTier,
  replyHash, replyId, type ExprContext, type MoodBand, type PortraitExpression, type RegardTier, type Reply, type ReplyCue,
  type ReplyNext
} from '@monde/shared';
import type { TalkChoice, TalkInput, TalkTurn } from './types';

export const LINE_KINDS = ['greet', 'talk', 'ctx', 'react', 'bye'] as const;
export type LineKind = typeof LINE_KINDS[number];
export const TIME_BANDS = ['dawn', 'morning', 'midday', 'afternoon', 'evening', 'night'] as const;
export type TimeBand = typeof TIME_BANDS[number];
export const WEATHER_TAGS = ['sun', 'cloud', 'rain', 'fog', 'wind', 'snow'] as const;
export type WeatherTag = typeof WEATHER_TAGS[number];
export const MOOD_BANDS: readonly MoodBand[] = ['glum', 'low', 'even', 'bright', 'glowing'];
/** Regard tiers, lowest first (§10.2): `r:` is a minimum in this order. */
export const TIERS: readonly RegardTier[] = ['Wary', 'Stranger', 'Neighbor', 'Friend', 'Confidant'];

/** B.1 scores per tag. */
export const SCORE = { ev: 8, w: 4, z: 3, r_exact: 3, t: 2, m: 2, r: 1 } as const;
/** B.1 step 3: survivors within this many points of the best are drawn from. */
export const DRAW_BAND = 2;
/** B.1 step 3: group uses count over this many in-game days (today and the two before). */
export const GROUP_DAYS = 3;
/** B.1: `ctx` with an event prefers an `ev` line this often. */
export const EVENT_PREFERENCE = 0.7;
/** B.1 no-repeat windows. */
export const WINDOWS = { residentLines: 12, residentGroups: 4, playerLines: 40 } as const;
/** B.2.5: the always-valid fillers, the last resort. */
export const FILLER_IDS: readonly string[] = ['ST-046', 'ST-047', 'ST-048', 'ST-049', 'ST-050', 'ST-051'];
/** §9.10 step 6 (server MAX_EXCHANGES): the 7th exchange (index 6) wraps up. */
export const MAX_EXCHANGES = 6;

const TAG_KEYS = ['t', 'm', 'r', 'r_exact', 'w', 'z', 'ev', 'req'] as const;
type TagKey = typeof TAG_KEYS[number];

export interface LineWhen {
  t?: TimeBand[];
  m?: MoodBand[];
  /** Minimum Regard tier. */
  r?: RegardTier[];
  /** Exactly these tiers (`r:=` in the GDD tables). */
  r_exact?: RegardTier[];
  w?: WeatherTag[];
  z?: string[];
  ev?: string[];
  /** Flag expressions (shared/src/expr.ts); all must hold. */
  req?: string[];
}

export interface QuietLine {
  id: string;
  kind: LineKind;
  when: LineWhen;
  text: string;
  /** Identical kind + tags (B.1 step 3). */
  group: string;
  /**
   * Authored replies for the Fellow (2–3, at most one goodbye). Lines without them get replies derived from
   * their kind, tags and text (shared/src/replies.ts).
   */
  replies?: readonly Reply[];
}

export interface LineLibrary {
  lines: readonly QuietLine[];
  byId: ReadonlyMap<string, QuietLine>;
  fillers: readonly QuietLine[];
}

// ── The library ─────────────────────────────────────────────────────────────

const ALLOWED: Partial<Record<TagKey, readonly string[]>> = {
  t: TIME_BANDS, m: MOOD_BANDS, r: TIERS, r_exact: TIERS, w: WEATHER_TAGS
};

const groupKey = (kind: string, when: LineWhen): string =>
  `${kind}|${TAG_KEYS.filter(k => when[k]?.length).map(k => `${k}:${[...when[k]!].sort().join(',')}`).join(' ')}`;

const REPLY_NEXT: readonly ReplyNext[] = ['talk', 'ctx'];
/** Placeholders a reply may use: the resident's first name and the player's name. */
const REPLY_PLACEHOLDER = /\{(?!name\}|player\})[^}]*\}/;

/** A line's `replies`: 2–3 of {text ≤ 90 characters, intent, next?}, at most one goodbye. */
export function parseReplies(raw: unknown, fail: (why: string) => never): Reply[] {
  if (!Array.isArray(raw)) fail('replies must be a list');
  const list = raw as unknown[];
  if (list.length < MIN_REPLIES || list.length > MAX_REPLIES) fail(`needs ${MIN_REPLIES}–${MAX_REPLIES} replies, has ${list.length}`);
  const replies = list.map((entry, i): Reply => {
    const r = entry as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') fail(`reply ${i + 1} must be a mapping`);
    for (const key of Object.keys(r!)) if (!['text', 'intent', 'next'].includes(key)) fail(`reply ${i + 1}: unknown field ${key}`);
    const text = typeof r!.text === 'string' ? r!.text.trim() : '';
    if (!text) fail(`reply ${i + 1} needs text`);
    if (text.length > REPLY_CHARS) fail(`reply ${i + 1} is over ${REPLY_CHARS} characters`);
    if (REPLY_PLACEHOLDER.test(text)) fail(`reply ${i + 1}: only {name} and {player} can be filled`);
    const intent = r!.intent;
    if (typeof intent !== 'string' || !(INTENTS as readonly string[]).includes(intent)) fail(`reply ${i + 1}: unknown intent ${String(intent)}`);
    const next = r!.next;
    if (next !== undefined && !(REPLY_NEXT as readonly unknown[]).includes(next)) fail(`reply ${i + 1}: next must be talk or ctx`);
    return { text, intent: intent as Reply['intent'], ...(next ? { next: next as ReplyNext } : {}) };
  });
  if (replies.filter(r => r.intent === 'leave').length > 1) fail('at most one reply may say goodbye');
  if (new Set(replies.map(r => r.text.toLowerCase())).size !== replies.length) fail('replies repeat');
  return replies;
}

/** Parse lines.yaml's `{ lines: [...] }`. Throws with the offending id on a malformed entry. */
export function parseLineLibrary(raw: unknown): LineLibrary {
  const root = raw as { lines?: unknown } | null;
  if (!root || typeof root !== 'object' || !Array.isArray(root.lines)) throw new Error('lines.yaml: expected { lines: [...] }');
  const lines: QuietLine[] = [];
  const byId = new Map<string, QuietLine>();
  for (const entry of root.lines as unknown[]) {
    const e = entry as Record<string, unknown> | null;
    const id = typeof e?.id === 'string' ? e.id : '?';
    const fail = (why: string): never => { throw new Error(`lines.yaml ${id}: ${why}`); };
    if (!e || typeof e !== 'object' || !/^[A-Z]{2}-\d{3}$/.test(id)) fail('needs an id like GR-001');
    if (byId.has(id)) fail('duplicate id');
    const kind = e!.kind;
    if (typeof kind !== 'string' || !(LINE_KINDS as readonly string[]).includes(kind)) fail(`unknown kind ${String(kind)}`);
    if (typeof e!.text !== 'string' || e!.text.trim() === '') fail('needs text');
    const rawWhen = (e!.when ?? {}) as Record<string, unknown>;
    if (typeof rawWhen !== 'object' || Array.isArray(rawWhen)) fail('when must be a mapping');
    const when: LineWhen = {};
    for (const [key, value] of Object.entries(rawWhen)) {
      if (!(TAG_KEYS as readonly string[]).includes(key)) fail(`unknown tag ${key}`);
      const values = (Array.isArray(value) ? value : [value]).map(String);
      const allowed = ALLOWED[key as TagKey];
      for (const v of values) if (allowed && !allowed.includes(v)) fail(`${key}:${v} is not a known value`);
      if (values.length) (when as Record<string, string[]>)[key] = values;
    }
    const replies = e!.replies === undefined ? undefined : parseReplies(e!.replies, fail);
    const line: QuietLine = {
      id, kind: kind as LineKind, when, text: e!.text as string, group: groupKey(kind as string, when), ...(replies ? { replies } : {})
    };
    lines.push(line);
    byId.set(id, line);
  }
  const fillers = FILLER_IDS.map(id => {
    const line = byId.get(id);
    if (!line) throw new Error(`lines.yaml: filler ${id} is missing`);
    return line;
  });
  return { lines, byId, fillers };
}

// ── Context ─────────────────────────────────────────────────────────────────

export interface QuietContext {
  kind: LineKind;
  time: TimeBand;
  weather: WeatherTag;
  /** The speaker's zone; null off the map. */
  zone: string | null;
  mood: MoodBand;
  tier: RegardTier;
  /** The one highest-priority recent town event (B.1), or null. */
  event: string | null;
  /** In-game day: `today` and the 3-day group weighting are counted from it. */
  day: number;
  speaker: { id: string; firstName: string };
  /** {player} */
  player: string;
  /** {place}: the display name of where the speaker is standing, if known. */
  place: string | null;
  /** Residents in town: id → first name, for {resident:<id>}. */
  residents: Readonly<Record<string, string>>;
  /** Resolves `req` expressions. Absent: no flags are set and no values are known. */
  req?: ExprContext;
}

/** B.1 time bands. Minutes run 360..1560; anything before 06:00 is the small hours (night). */
export function timeBand(minute: number): TimeBand {
  const m = Math.floor(minute);
  if (m < 6 * 60) return 'night';
  if (m < 9 * 60) return 'dawn';
  if (m < 12 * 60) return 'morning';
  if (m < 14 * 60) return 'midday';
  if (m < 18 * 60) return 'afternoon';
  if (m < 22 * 60) return 'evening';
  return 'night';
}

/** B.1 {time_of_day}: morning (dawn, morning), afternoon (midday, afternoon), evening or night. */
export function timeOfDay(band: TimeBand): 'morning' | 'afternoon' | 'evening' | 'night' {
  return band === 'dawn' || band === 'morning' ? 'morning' : band === 'midday' || band === 'afternoon' ? 'afternoon' : band;
}

/** B.1 {weather}: the weather noun. */
export const WEATHER_NOUN: Readonly<Record<WeatherTag, string>> = { sun: 'sun', cloud: 'cloud', rain: 'rain', fog: 'fog', wind: 'wind', snow: 'snow' };

/** B.1 {place}: display names of the zones ("the Wharf"); §2.3 district names. */
export const ZONE_DISPLAY: Readonly<Record<string, string>> = {
  old_quarter: 'the Old Quarter', market_row: 'Market Row', wharf: 'the Wharf', commons: 'the Commons',
  millbrook: 'Millbrook', station_hill: 'Station Hill', briar_woods: 'Briar Woods'
};

const TITLES = new Set(['captain', 'mayor', 'doctor', 'dr', 'mr', 'mrs', 'ms', 'miss', 'father', 'sister', 'reverend']);
/** What people call a resident: the quoted nickname if the card has one ("June"), else the first name after any title. */
export function firstName(name: string): string {
  const nick = /"([^"]+)"/.exec(name)?.[1];
  if (nick) return nick;
  const words = name.trim().split(/\s+/);
  return words.find(w => !TITLES.has(w.toLowerCase().replace(/\.$/, ''))) ?? words[0] ?? name;
}

export interface ContextInput {
  kind: LineKind;
  day: number;
  minute: number;
  weather: WeatherTag;
  zone: string | null;
  /** Mood valence −100..100 (§9.4). */
  valence: number;
  /** Regard −100..100 (§10.2). */
  regard: number;
  event?: string | null;
  speaker: { id: string; name: string };
  player: string;
  residents: Readonly<Record<string, string>>;
  req?: ExprContext;
}

export function quietContext(input: ContextInput): QuietContext {
  return {
    kind: input.kind, time: timeBand(input.minute), weather: input.weather, zone: input.zone,
    mood: moodBand(input.valence), tier: regardTier(input.regard), event: input.event ?? null, day: input.day,
    speaker: { id: input.speaker.id, firstName: firstName(input.speaker.name) }, player: input.player,
    place: input.zone ? ZONE_DISPLAY[input.zone] ?? null : null, residents: input.residents, req: input.req
  };
}

// ── State (B.1 "State": what the save keeps) ────────────────────────────────

export interface ResidentMemory {
  /** The resident's last 12 lines (oldest first), with their groups for the 4-group window. */
  recent: { id: string; group: string }[];
  /**
   * Group uses with their day, for the draw weighting. B.1 counts uses over 3 in-game days, which the
   * 12-line ring can't always cover, so this short log (pruned to 3 days) is kept beside it.
   */
  uses: { group: string; day: number }[];
}

export interface QuietState {
  /** The in-game day `today` refers to. */
  day: number;
  residents: Record<string, ResidentMemory>;
  /** The last 40 line ids the player has seen from anyone (oldest first). */
  player: string[];
  /** Line ids used on `day`, with the residents who used them. */
  today: Record<string, string[]>;
}

export const emptyQuietState = (): QuietState => ({ day: 0, residents: {}, player: [], today: {} });

/** A saved state, tolerating anything malformed (it falls back to empty pieces). */
export function restoreQuietState(raw: unknown): QuietState {
  const s = emptyQuietState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<QuietState>;
  if (typeof r.day === 'number' && Number.isFinite(r.day)) s.day = r.day;
  if (Array.isArray(r.player)) s.player = r.player.filter((id): id is string => typeof id === 'string').slice(-WINDOWS.playerLines);
  if (r.today && typeof r.today === 'object') {
    for (const [id, who] of Object.entries(r.today)) if (Array.isArray(who)) s.today[id] = who.filter((w): w is string => typeof w === 'string');
  }
  if (r.residents && typeof r.residents === 'object') {
    for (const [id, m] of Object.entries(r.residents)) {
      if (!m || typeof m !== 'object') continue;
      const recent = Array.isArray(m.recent) ? m.recent.filter(e => e && typeof e.id === 'string' && typeof e.group === 'string') : [];
      const uses = Array.isArray(m.uses) ? m.uses.filter(e => e && typeof e.group === 'string' && typeof e.day === 'number') : [];
      s.residents[id] = { recent: recent.slice(-WINDOWS.residentLines), uses };
    }
  }
  return s;
}

/** Record that `residentId` said `line` on `day` (mutates `state`). */
export function rememberLine(state: QuietState, residentId: string, line: QuietLine, day: number): void {
  if (state.day !== day) { state.day = day; state.today = {}; }
  const mem = state.residents[residentId] ??= { recent: [], uses: [] };
  mem.recent.push({ id: line.id, group: line.group });
  if (mem.recent.length > WINDOWS.residentLines) mem.recent.splice(0, mem.recent.length - WINDOWS.residentLines);
  mem.uses.push({ group: line.group, day });
  mem.uses = mem.uses.filter(u => u.day > day - GROUP_DAYS && u.day <= day);
  state.player.push(line.id);
  if (state.player.length > WINDOWS.playerLines) state.player.splice(0, state.player.length - WINDOWS.playerLines);
  const who = state.today[line.id] ??= [];
  if (!who.includes(residentId)) who.push(residentId);
}

// ── Selection ───────────────────────────────────────────────────────────────

const PLACEHOLDER = /\{([a-z_]+)(?::([a-z0-9_]+))?\}/g;

/** Every placeholder in `text` can be filled for this speaker (B.1 step 1). */
export function canFill(text: string, ctx: QuietContext): boolean {
  for (const [, name, arg] of text.matchAll(PLACEHOLDER)) {
    switch (name) {
      case 'player': case 'weather': case 'time_of_day': continue;
      case 'name': if (ctx.speaker.firstName) continue; return false;
      case 'place': if (ctx.place) continue; return false;
      // GDD-GAP: B.1 skips a {resident:<id>} line when that resident isn't in town; a resident naming
      // themself in the third person reads wrong, so it's skipped for them too.
      case 'resident': if (arg && arg !== ctx.speaker.id && ctx.residents[arg]) continue; return false;
      default: return false;
    }
  }
  // Anything brace-shaped the pattern didn't recognise can't be filled either.
  return !/\{[^}]*\}/.test(text.replace(PLACEHOLDER, ''));
}

/** B.1 step 5. */
export function fillLine(text: string, ctx: QuietContext): string {
  return text.replace(PLACEHOLDER, (whole, name: string, arg?: string) => {
    switch (name) {
      case 'player': return ctx.player;
      case 'name': return ctx.speaker.firstName;
      case 'place': return ctx.place ?? whole;
      case 'weather': return WEATHER_NOUN[ctx.weather];
      case 'time_of_day': return timeOfDay(ctx.time);
      case 'resident': return (arg && ctx.residents[arg]) || whole;
      default: return whole;
    }
  });
}

const tierIndex = (t: RegardTier): number => TIERS.indexOf(t);

function holds(expressions: readonly string[], ctx: QuietContext): boolean {
  const resolver = ctx.req ?? gameContext({ flags: new Set() });
  return expressions.every(src => {
    try { return evaluate(src, resolver); } catch { return false; }
  });
}

/** B.1 step 1. */
export function lineMatches(line: QuietLine, ctx: QuietContext): boolean {
  const w = line.when;
  if (line.kind !== ctx.kind) return false;
  if (w.t && !w.t.includes(ctx.time)) return false;
  if (w.m && !w.m.includes(ctx.mood)) return false;
  if (w.r && !w.r.some(min => tierIndex(ctx.tier) >= tierIndex(min))) return false;
  if (w.r_exact && !w.r_exact.includes(ctx.tier)) return false;
  if (w.w && !w.w.includes(ctx.weather)) return false;
  if (w.z && (!ctx.zone || !w.z.includes(ctx.zone))) return false;
  if (w.ev && (!ctx.event || !w.ev.includes(ctx.event))) return false;
  if (w.req && !holds(w.req, ctx)) return false;
  return canFill(line.text, ctx);
}

/** B.1 step 2. */
export function lineScore(line: QuietLine): number {
  const w = line.when;
  return (w.ev ? SCORE.ev : 0) + (w.w ? SCORE.w : 0) + (w.z ? SCORE.z : 0) + (w.r_exact ? SCORE.r_exact : 0)
    + (w.t ? SCORE.t : 0) + (w.m ? SCORE.m : 0) + (w.r ? SCORE.r : 0);
}

/** Window sizes; 0 turns a rule off. */
export interface WindowSizes { residentLines: number; residentGroups: number; playerLines: number }
/** B.1 exhaustion, in order: full · halved · halved without the player's rule · none. */
export const WINDOW_LEVELS: readonly WindowSizes[] = [
  { ...WINDOWS },
  { residentLines: WINDOWS.residentLines / 2, residentGroups: WINDOWS.residentGroups / 2, playerLines: WINDOWS.playerLines / 2 },
  { residentLines: WINDOWS.residentLines / 2, residentGroups: WINDOWS.residentGroups / 2, playerLines: 0 },
  { residentLines: 0, residentGroups: 0, playerLines: 0 }
];

const last = <T>(items: readonly T[], n: number): readonly T[] => (n > 0 ? items.slice(-n) : []);

/** B.1 step 4 at one window size. */
export function applyWindows(pool: readonly QuietLine[], ctx: QuietContext, state: QuietState, w: WindowSizes): QuietLine[] {
  const recent = state.residents[ctx.speaker.id]?.recent ?? [];
  const ids = new Set(last(recent, w.residentLines).map(r => r.id));
  const groups = new Set(last(recent, w.residentGroups).map(r => r.group));
  const seen = new Set(last(state.player, w.playerLines));
  let out = pool.filter(l => !ids.has(l.id) && !groups.has(l.group) && !seen.has(l.id));
  if (w.playerLines > 0 && state.day === ctx.day) {
    // A line another resident used today only while fewer than 2 other candidates survive.
    const fresh = out.filter(l => !(state.today[l.id] ?? []).some(who => who !== ctx.speaker.id));
    if (fresh.length >= 2) out = fresh;
  }
  return out;
}

/** The window level and survivors B.1's exhaustion rules settle on (empty only if the pool is). */
export function windowed(pool: readonly QuietLine[], ctx: QuietContext, state: QuietState): { level: number; lines: QuietLine[] } {
  const full = applyWindows(pool, ctx, state, WINDOW_LEVELS[0]!);
  if (full.length >= 2) return { level: 0, lines: full };
  for (let level = 1; level < WINDOW_LEVELS.length; level++) {
    const lines = applyWindows(pool, ctx, state, WINDOW_LEVELS[level]!);
    if (lines.length > 0) return { level, lines };
  }
  return { level: WINDOW_LEVELS.length - 1, lines: [] };
}

export interface LinePick {
  line: QuietLine;
  /** The filled text. */
  text: string;
  /** Which exhaustion level the windows ended at (0 = full windows). */
  level: number;
  /** Fell through to the always-valid fillers. */
  filler: boolean;
}

/** Choose one line for `ctx` (B.1 steps 1–5). Doesn't record it: call rememberLine once it's shown. */
export function pickLine(lib: LineLibrary, ctx: QuietContext, state: QuietState, rng: () => number): LinePick {
  let pool = lib.lines.filter(l => lineMatches(l, ctx));
  if (ctx.kind === 'ctx' && ctx.event && rng() >= EVENT_PREFERENCE) {
    const plain = pool.filter(l => !l.when.ev);
    if (plain.length > 0) pool = plain;
  }
  let { level, lines } = windowed(pool, ctx, state);
  let filler = false;
  if (lines.length === 0) {
    filler = true;
    ({ level, lines } = windowed(lib.fillers, ctx, state));
    if (lines.length === 0) lines = [...lib.fillers];
  }
  const best = Math.max(...lines.map(lineScore));
  const band = lines.filter(l => lineScore(l) >= best - DRAW_BAND);
  const uses = state.residents[ctx.speaker.id]?.uses ?? [];
  const weights = band.map(l => 1 / (1 + uses.filter(u => u.group === l.group && u.day > ctx.day - GROUP_DAYS && u.day <= ctx.day).length));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total, index = 0;
  for (; index < band.length - 1; index++) {
    roll -= weights[index]!;
    if (roll < 0) break;
  }
  const line = band[index]!;
  return { line, text: fillLine(line.text, ctx), level, filler };
}

// ── A Quiet Mode turn ───────────────────────────────────────────────────────

/** The bare Leave: the panel's own button (every Quiet Mode turn ends with it). */
export const QUIET_CHOICES = {
  leave: { id: 'leave', text: 'Leave', intent: 'leave' }
} as const satisfies Record<string, TalkChoice>;

/**
 * Narrated-action residents (Bastien, §9.3 voice modes) never speak, and Appendix B is all speech.
 * GDD-GAP: these mirror the server's authored fallback (server/src/mind/fallback.ts), plus a farewell.
 */
const ANIMAL_LINES: Readonly<Record<'low' | 'even' | 'high', string>> = {
  low: '({name} sleeps with one ear turned your way.)',
  even: '({name} sits down and gives you a slow blink.)',
  high: '({name} wanders over and sits on your boot.)'
};
const ANIMAL_FILLER = '({name} yawns.)';
const ANIMAL_BYE = '({name} watches you go.)';
const MOOD_GROUP: Readonly<Record<MoodBand, 'low' | 'even' | 'high'>> = { glum: 'low', low: 'low', even: 'even', bright: 'high', glowing: 'high' };

/** Words that ask for the news, typed or chosen: the resident answers with a `ctx` line. */
const ASKS_NEWS = /\b(?:news|what'?s new|anything new|happening|going on|heard anything)\b/i;

/**
 * Which B.1 kind a player input asks for: walking up greets, Leave (or six exchanges) says goodbye, a reply
 * that asks for the news (a `news…` id or the words) gets a `ctx` line, and anything else more talk.
 */
export function kindFor(input: TalkInput, turnIndex: number): LineKind {
  if (turnIndex >= MAX_EXCHANGES) return 'bye';
  if (input.kind === 'open') return 'greet';
  if (input.kind === 'choice') {
    if (input.intent === 'leave') return 'bye';
    if (input.choice_id.startsWith('news')) return 'ctx';
  }
  return ASKS_NEWS.test(input.text) ? 'ctx' : 'talk';
}

/** What the Fellow's replies respond to: the line as shown, with its kind and tags. */
export function replyCue(line: QuietLine, text: string, ctx: Pick<QuietContext, 'mood'>): ReplyCue {
  const w = line.when;
  return { text, kind: line.kind, mood: w.m?.[0] ?? ctx.mood, weather: w.w?.[0] ?? null, zone: w.z?.[0] ?? null, event: w.ev?.[0] ?? null };
}

/** Replies as choices: names filled, ids saying what each asks for (`news…` → a ctx line). */
function asChoices(replies: readonly Reply[], ctx: Pick<QuietContext, 'speaker' | 'player'>): TalkChoice[] {
  return replies.map((r, i) => ({ id: replyId(r, i + 1), text: fillReply(r.text, { name: ctx.speaker.firstName, player: ctx.player }), intent: r.intent }));
}

/** The line's authored replies, or ones derived from its kind, tags and text. */
export function quietReplies(line: QuietLine, text: string, ctx: Pick<QuietContext, 'mood' | 'speaker' | 'player'>, seed = 0): TalkChoice[] {
  return asChoices(line.replies ?? derivedReplies(replyCue(line, text, ctx), seed), ctx);
}

const EVENT_EXPR: Readonly<Record<string, PortraitExpression>> = {
  tollmen_near: 'worried', scuffle_seen: 'surprised', scuffle_lost: 'worried', scuffle_won: 'warm',
  gift_dislike: 'worried', refused_by_player: 'sad', declined_by_resident: 'worried'
};
const SURPRISE = /^oh\b|didn't see you|did you see|pinch me|can you believe/i;
const WORRY = /\b(?:mind (?:the|your|how)|careful|deeper than|hold your hat|ice|cross the street|don't stare|panicking)\b/i;
const SORROW = /\b(?:tired|sorry|worse|can't sleep|long day|long one|flagging|poor company|not my best|nobody can see)\b/i;
const DELIGHT = /\b(?:lovely|adore|love|perfect|marvelous|wonderful|happiness|good one|smiling)\b/i;

/**
 * The portrait for a library line (§16.2's six), from its tags and words: an event's own face, a low or high
 * mood tag, then worry, sorrow, surprise or delight in the text. Greetings are warm unless the resident is
 * Wary; everything else is neutral.
 */
export function quietExpression(line: QuietLine, text: string): PortraitExpression {
  const w = line.when;
  if (line.kind === 'bye') return 'warm';
  const event = w.ev?.find(e => EVENT_EXPR[e]);
  if (event) return EVENT_EXPR[event]!;
  if (w.m?.length && w.m.every(m => m === 'glum' || m === 'low')) return 'sad';
  if (w.m?.length && w.m.every(m => m === 'bright' || m === 'glowing')) return 'warm';
  if (w.ev?.length) return 'warm';
  if (SURPRISE.test(text)) return 'surprised';
  if (WORRY.test(text)) return 'worried';
  if (SORROW.test(text)) return 'sad';
  if (w.r_exact?.includes('Wary')) return 'neutral';
  if (text.includes('!') || DELIGHT.test(text) || line.kind === 'greet') return 'warm';
  return 'neutral';
}

export interface QuietTurnInput {
  lib: LineLibrary;
  state: QuietState;
  rng: () => number;
  conversationId: string;
  residentId: string;
  turnIndex: number;
  input: TalkInput;
  /** The context for the speaker; `kind` is set from the input. */
  context: Omit<QuietContext, 'kind'>;
  /** A narrated-action resident (no speech). */
  narrated?: boolean;
}

export interface QuietTurn {
  turn: TalkTurn;
  /** The library line used (null for narrated lines). */
  pick: LinePick | null;
}

/**
 * One Quiet Mode turn in the server's `turn` shape: one line with a portrait that fits it, two or three
 * replies to that line (authored or derived) and Leave, or just Leave once the resident wraps up. Records the
 * line in `state`. Replies are seeded by the conversation and turn, so a replay offers the same ones.
 */
export function quietTurn(q: QuietTurnInput): QuietTurn {
  const kind = kindFor(q.input, q.turnIndex);
  const ctx: QuietContext = { ...q.context, kind };
  const wrapUp = kind === 'bye';
  const seed = replyHash(`${q.conversationId}:${q.turnIndex}`);
  let text: string, expr: PortraitExpression, replies: TalkChoice[], pick: LinePick | null = null;
  if (q.narrated) {
    const group = MOOD_GROUP[ctx.mood];
    const template = kind === 'bye' ? ANIMAL_BYE : kind === 'greet' ? ANIMAL_LINES[group] : ANIMAL_FILLER;
    text = template.replaceAll('{name}', ctx.speaker.firstName);
    expr = kind === 'greet' ? (group === 'low' ? 'sad' : 'warm') : 'neutral';
    replies = asChoices(derivedReplies({ text, kind: 'animal' }, seed), ctx);
  } else {
    pick = pickLine(q.lib, ctx, q.state, q.rng);
    rememberLine(q.state, q.residentId, pick.line, ctx.day);
    text = pick.text;
    expr = quietExpression(pick.line, text);
    replies = quietReplies(pick.line, text, ctx, seed);
  }
  return {
    turn: {
      conversation_id: q.conversationId, resident_id: q.residentId, turn_index: q.turnIndex,
      lines: [{ text, expr }], choices: wrapUp ? [{ ...QUIET_CHOICES.leave }] : [...replies, { ...QUIET_CHOICES.leave }],
      wrap_up: wrapUp, fallback: true
    },
    pick
  };
}
