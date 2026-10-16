/**
 * Ambient lines (content/lines/ambient.yaml; GDD §9.11.3, §9.14): what residents say to each other in passing and in
 * the exchanges that aren't live, with no server call. Parsing and selection; pure: no Phaser, no DOM.
 *
 * Selection: the lines that fit the pair's tie, the time band and the weather; half the time a line written for this
 * weather when there is one, and one written for this tie or band more often than a general one; a seeded pick,
 * skipping lines said lately on this board while others remain. A resident's own `voices` line, when one fits, is
 * used about half the time. A narrated speaker (Bastien) acts instead (`animals`); a resident speaking to one says one
 * of `to_animals`. `{name}` is the other resident's first name.
 */
import { parse } from 'yaml';
import { PAIR_LABELS, type ChatLine, type PairLabel } from '@monde/shared';
import { TIME_BANDS, WEATHER_TAGS, type TimeBand, type WeatherTag } from '../../mind/quietMode';
import ambientYaml from '../../../../content/lines/ambient.yaml?raw';

export interface AmbientLine {
  text: string; to?: readonly PairLabel[]; t?: readonly TimeBand[]; w?: readonly WeatherTag[];
  /** A greeting's own answers (the other says one); without them, a plain reply. */
  reply?: readonly string[];
}
export interface AmbientExchange { lines: readonly string[]; to?: readonly PairLabel[]; t?: readonly TimeBand[]; w?: readonly WeatherTag[] }
export interface AmbientLibrary {
  greetings: readonly AmbientLine[];
  replies: readonly AmbientLine[];
  voices: Readonly<Record<string, readonly AmbientLine[]>>;
  animals: readonly string[];
  toAnimals: readonly string[];
  exchanges: readonly AmbientExchange[];
}

/** Lengths the bubbles are drawn for. */
export const AMBIENT_LIMITS = { greeting: 60, exchange: 110 } as const;
const PLACEHOLDER = /\{(?!name\})[^}]*\}/;

/** Parse ambient.yaml. Throws on the first problem, saying where. */
export function parseAmbient(text: string): AmbientLibrary {
  const root = parse(text) as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') throw new Error('ambient.yaml: expected a mapping');
  const fail = (where: string, why: string): never => { throw new Error(`ambient.yaml ${where}: ${why}`); };
  const tags = <T extends string>(v: unknown, allowed: readonly T[], where: string, key: string): T[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || !v.length || !v.every(x => (allowed as readonly unknown[]).includes(x))) fail(where, `${key} must list ${allowed.join(', ')}`);
    return v as T[];
  };
  const textOf = (v: unknown, where: string, max: number): string => {
    if (typeof v !== 'string' || !v.trim()) fail(where, 'needs text');
    const s = (v as string).trim();
    if (s.length > max) fail(where, `is over ${max} characters`);
    if (PLACEHOLDER.test(s)) fail(where, 'only {name} can be filled');
    return s;
  };
  const line = (v: unknown, where: string, max: number, replies = false): AmbientLine => {
    const o = v as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') fail(where, 'must be a mapping');
    for (const k of Object.keys(o!)) if (!['text', 'to', 't', 'w', ...(replies ? ['reply'] : [])].includes(k)) fail(where, `unknown field ${k}`);
    const to = tags(o!.to, PAIR_LABELS, where, 'to'), t = tags(o!.t, TIME_BANDS, where, 't'), w = tags(o!.w, WEATHER_TAGS, where, 'w');
    if (o!.reply !== undefined && (!Array.isArray(o!.reply) || !o!.reply.length || o!.reply.length > 3)) fail(where, 'reply lists 1 to 3 answers');
    const reply = o!.reply === undefined ? undefined : (o!.reply as unknown[]).map((x, i) => textOf(x, `${where}.reply[${i}]`, max));
    return { text: textOf(o!.text, where, max), ...(to ? { to } : {}), ...(t ? { t } : {}), ...(w ? { w } : {}), ...(reply ? { reply } : {}) };
  };
  const lines = (key: string, max: number, replies = false): AmbientLine[] => {
    const v = root[key];
    if (!Array.isArray(v) || !v.length) fail(key, 'must be a non-empty list');
    return (v as unknown[]).map((x, i) => line(x, `${key}[${i}]`, max, replies));
  };
  const strings = (key: string): string[] => {
    const v = root[key];
    if (!Array.isArray(v) || !v.length) fail(key, 'must be a non-empty list');
    return (v as unknown[]).map((x, i) => textOf(x, `${key}[${i}]`, AMBIENT_LIMITS.greeting));
  };
  const voicesRaw = (root.voices ?? {}) as Record<string, unknown>;
  if (typeof voicesRaw !== 'object' || Array.isArray(voicesRaw)) fail('voices', 'must map resident ids to lines');
  const voices: Record<string, AmbientLine[]> = {};
  for (const [id, v] of Object.entries(voicesRaw)) {
    if (!/^[a-z0-9_]+$/.test(id)) fail(`voices.${id}`, 'is not a resident id');
    if (!Array.isArray(v) || !v.length) fail(`voices.${id}`, 'must be a non-empty list');
    voices[id] = (v as unknown[]).map((x, i) => line(x, `voices.${id}[${i}]`, AMBIENT_LIMITS.greeting));
  }
  const exRaw = root.exchanges;
  if (!Array.isArray(exRaw) || !exRaw.length) fail('exchanges', 'must be a non-empty list');
  const exchanges = (exRaw as unknown[]).map((v, i): AmbientExchange => {
    const where = `exchanges[${i}]`, o = v as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') fail(where, 'must be a mapping');
    for (const k of Object.keys(o!)) if (!['lines', 'to', 't', 'w'].includes(k)) fail(where, `unknown field ${k}`);
    if (!Array.isArray(o!.lines) || o!.lines.length < 2 || o!.lines.length > 4) fail(where, 'needs 2 to 4 lines');
    const to = tags(o!.to, PAIR_LABELS, where, 'to'), t = tags(o!.t, TIME_BANDS, where, 't'), w = tags(o!.w, WEATHER_TAGS, where, 'w');
    return { lines: (o!.lines as unknown[]).map((x, j) => textOf(x, `${where}.lines[${j}]`, AMBIENT_LIMITS.exchange)),
      ...(to ? { to } : {}), ...(t ? { t } : {}), ...(w ? { w } : {}) };
  });
  return { greetings: lines('greetings', AMBIENT_LIMITS.greeting, true), replies: lines('replies', AMBIENT_LIMITS.greeting), voices,
    animals: strings('animals'), toAnimals: strings('to_animals'), exchanges };
}

/** The shipped library (content/lines/ambient.yaml). */
export const AMBIENT: AmbientLibrary = parseAmbient(ambientYaml);

export interface AmbientContext { label: PairLabel; band: TimeBand; weather: WeatherTag | null }
export interface AmbientSpeaker { id: string; name: string; animal: boolean }
type Tagged = { to?: readonly PairLabel[]; t?: readonly TimeBand[]; w?: readonly WeatherTag[] };

/** A line fits when every tag it has matches; a weather line only in its weather. */
export const fits = (x: Tagged, c: AmbientContext): boolean =>
  (!x.to || x.to.includes(c.label)) && (!x.t || x.t.includes(c.band)) && (!x.w || (c.weather !== null && x.w.includes(c.weather)));
const score = (x: Tagged): number => (x.w ? 4 : 0) + (x.to ? 1 : 0) + (x.t ? 1 : 0);

/**
 * The best-fitting entries (weather first, then the more specific), a seeded pick among them; entries whose key is in
 * `recent` sit out while any other fits. Null when nothing fits.
 */
export function pick<T extends Tagged>(pool: readonly T[], c: AmbientContext, rng: () => number, key: (x: T) => string,
  recent: ReadonlySet<string> = new Set()): T | null {
  const fitting = pool.filter(x => fits(x, c));
  if (!fitting.length) return null;
  const fresh = fitting.filter(x => !recent.has(key(x)));
  const from = fresh.length ? fresh : fitting;
  // A line for this weather half the time when one fits; otherwise the specific and the general share the draw (more
  // of the specific), so a board doesn't hear the same three lines all day.
  const weather = from.filter(x => x.w);
  const band = weather.length && rng() < 0.5 ? weather : from.filter(x => !x.w).length ? from.filter(x => !x.w) : from;
  const top = Math.max(...band.map(score));
  const best = band.filter(x => score(x) === top);
  const chosen = rng() < 0.6 ? best : band;
  return chosen[Math.floor(rng() * chosen.length) % chosen.length]!;
}

const fill = (text: string, other: AmbientSpeaker): string => text.replaceAll('{name}', other.name);

const pickOf = (pool: readonly string[], rng: () => number): string => pool[Math.floor(rng() * pool.length) % pool.length]!;

/**
 * The nod when two pass: a's greeting and b's answer. a says one of their own lines about half the time when one fits,
 * else a general greeting; b answers with the greeting's own reply if it has one, else a plain reply. A narrated
 * speaker acts instead; a resident greeting an animal speaks to it.
 */
export function greetingBeat(lib: AmbientLibrary, a: AmbientSpeaker, b: AmbientSpeaker, c: AmbientContext, rng: () => number,
  recent: ReadonlySet<string> = new Set()): [ChatLine, ChatLine] {
  let opener: AmbientLine;
  if (a.animal) opener = { text: pickOf(lib.animals, rng) };
  else if (b.animal) opener = { text: pickOf(lib.toAnimals, rng) };
  else {
    const own = lib.voices[a.id];
    const voiced = own && rng() < 0.5 ? pick(own, c, rng, x => x.text, recent) : null;
    opener = voiced ?? pick(lib.greetings, c, rng, x => x.text, recent) ?? { text: '(nods)' };
  }
  const answer = b.animal ? pickOf(lib.animals, rng) : a.animal ? pickOf(lib.toAnimals, rng)
    : opener.reply?.length ? pickOf(opener.reply, rng) : (pick(lib.replies, c, rng, x => x.text, recent) ?? { text: '(nods)' }).text;
  return [
    { speaker: a.id, text: fill(opener.text, b), expr: 'neutral' },
    { speaker: b.id, text: fill(answer, a), expr: 'neutral' },
  ];
}

/** An authored exchange, alternating a, b, a…; with an animal in the pair it's a greeting beat instead. */
export function authoredExchange(lib: AmbientLibrary, a: AmbientSpeaker, b: AmbientSpeaker, c: AmbientContext, rng: () => number,
  recent: ReadonlySet<string> = new Set()): ChatLine[] {
  if (a.animal || b.animal) return greetingBeat(lib, a, b, c, rng, recent);
  const ex = pick(lib.exchanges, c, rng, x => x.lines[0]!, recent);
  const lines = ex?.lines ?? ['A little rest does no harm.', 'Quite right. The errands can wait a moment.'];
  return lines.map((text, i) => ({ speaker: i % 2 ? b.id : a.id, text: fill(text, i % 2 ? a : b), expr: 'neutral' }));
}

/** The narrated stand-in for a narrated speaker's line in a live exchange. */
export const animalLine = (lib: AmbientLibrary, other: AmbientSpeaker, rng: () => number): string =>
  fill(lib.animals[Math.floor(rng() * lib.animals.length)]!, other);
