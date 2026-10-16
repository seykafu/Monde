/**
 * Gathering places and linger blocks (GDD §9.7 template routines, §9.11.3 encounters, §16.4.1 social spots).
 * Pure: no I/O, no Phaser, no DOM.
 *
 * A template day (a persona routine turned into plan blocks) gets up to two short outdoor stops: around lunch and
 * again late in the afternoon, a resident steps out to their district's gathering place, lingers for half an hour
 * or so, and goes back to what they were doing. Everyone in a district who stops on a given weekday stops at the
 * same place at the same time, so pairs are often outdoors together: that is where the player sees them talk
 * (client/src/scenes/zone/chatter.ts) and where the night pass finds them meeting (server/src/mind/encounters.ts,
 * 30 minutes together is a meeting). Where on a place they stand comes from the zone files' `social:` spots
 * (client/src/world/zoneFormat.ts); every place listed here has at least one (a client test checks).
 *
 * The client's template days (client/src/sim/plans.ts `dayPlan`) and the server's template plans
 * (server/src/mind/templatePlan.ts `templatePlan`) both call `withLingers`, so they still agree block for block.
 * Everything depends only on the resident id, the weekday and the routine, never on the game day or a random source.
 */

/** Open places on the built boards where residents stop to talk, by zone (§9.5 ids). */
export const GATHERING_PLACES: Readonly<Record<string, readonly string[]>> = {
  old_quarter: ['old_quarter.fountain_square'],
  market_row: ['market_row.market_street'],
  wharf: ['wharf.harbor_steps', 'wharf.ferry_slip'],
  commons: ['commons.picnic_lawn', 'commons.sundial_lawn', 'commons.community_garden'],
};

export interface LingerWindow {
  id: string;
  /** Candidate start minutes; one is picked per weekday, the same for everybody. */
  starts: readonly number[];
  /** How long the stop is, before clipping and folding. */
  minutes: number;
}

/**
 * GDD-GAP: §9.7's routines have no outdoor breaks and the GDD gives no times for them. Two stops a day: lunch, 40
 * minutes from 12:00-12:45, and late afternoon, 35 minutes from 16:30-17:15 (the start fixed per weekday). At 0.75 s a
 * game minute that is 25-30 real seconds at the spot: long enough for an exchange (2-6 lines, at most ~40 s while the
 * pair holds still for it) to start while they're there.
 */
export const LINGER_WINDOWS: readonly LingerWindow[] = [
  { id: 'lunch', starts: [720, 735, 750, 765], minutes: 40 },
  { id: 'afternoon', starts: [990, 1005, 1020, 1035], minutes: 35 },
];
/** GDD-GAP: each resident stops in a given window on 70% of weekdays (fixed per resident and weekday). */
export const LINGER_CHANCE = 0.7;
/** A stop clipped shorter than this (by a nap or a service next to it) isn't made. */
export const LINGER_MIN_MINUTES = 20;
/** Leftovers of a block shorter than this are folded into the stop: half an hour isn't worth walking back for. */
export const LINGER_MIN_PIECE = 30;
/** Verbs nobody steps out of: asleep, at a service or meeting, already in company, on a Project shift. */
export const LINGER_KEEP_VERBS: ReadonlySet<string> = new Set(['sleep', 'nap', 'attend', 'pray', 'socialize', 'visit', 'volunteer']);

export type LingerVerb = 'socialize' | 'eat';

/** The part of a plan block the lingers need (client DayPlanBlock and server TimedBlock both have it). */
export interface LingerBlock {
  start: string;
  end: string;
  action: string;
  place: string;
  with: string[];
  note: string;
  startMin: number;
  endMin: number;
}

/** FNV-1a, the same 32-bit hash as the client's `hashString` (client/src/sim/plans.ts). */
export function gatherHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const hhmm = (minute: number): string => {
  const m = Math.round(minute);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The gathering places of a zone, or none (an unbuilt district, the mainland). */
export const gatheringPlaces = (zone: string): readonly string[] => GATHERING_PLACES[zone] ?? [];
/** Every gathering place, flat. */
export const ALL_GATHERING_PLACES: readonly string[] = Object.values(GATHERING_PLACES).flat();

/** A planned stop: where and when (before it is spliced into the day). */
export interface Linger { window: string; place: string; action: LingerVerb; startMin: number; endMin: number }

/**
 * The stop a resident makes in one window on one weekday, or null. The start is the window's pick for the weekday, the
 * place the pick for the weekday and window of the district they go on to afterwards (so a district's residents meet);
 * the stop is clipped at a block it can't interrupt, and leftovers under 30 minutes on either side are folded in.
 */
export function lingerFor(blocks: readonly LingerBlock[], resident: string, weekday: string, window: LingerWindow): Linger | null {
  if (gatherHash(`${resident}|${weekday}|${window.id}`) / 2 ** 32 >= LINGER_CHANCE) return null;
  let s = window.starts[gatherHash(`${weekday}|${window.id}`) % window.starts.length]!;
  let e = s + window.minutes;
  const head = blocks.find(b => b.startMin <= s && s < b.endMin);
  if (!head || LINGER_KEEP_VERBS.has(head.action)) return null;
  // Stop short of anything they wouldn't leave (a nap after lunch, a service).
  for (const b of blocks) if (b.startMin > s && b.startMin < e && LINGER_KEEP_VERBS.has(b.action)) e = Math.min(e, b.startMin);
  if (e - s < LINGER_MIN_MINUTES) return null;
  if (s - head.startMin < LINGER_MIN_PIECE) s = head.startMin;
  const tail = blocks.find(b => b.startMin < e && e < b.endMin);
  if (tail && !LINGER_KEEP_VERBS.has(tail.action) && tail.endMin - e < LINGER_MIN_PIECE) e = tail.endMin;
  // The district is the one they go on to when the stop ends, so the walk on from it stays short (the executor leaves
  // early to arrive on time, so a long walk afterwards would eat the stop). None in an unbuilt district or the mainland.
  const after = blocks.find(b => b.startMin < e && e < b.endMin) ?? blocks.find(b => b.startMin >= e) ?? head;
  const zone = after.place.split('.')[0]!;
  const places = gatheringPlaces(zone);
  if (!places.length) return null;
  const place = places[gatherHash(`${zone}|${weekday}|${window.id}`) % places.length]!;
  const covered = blocks.filter(b => b.startMin < e && b.endMin > s);
  if (covered.some(b => b.place === place)) return null; // already there
  return { window: window.id, place, action: covered.some(b => b.action === 'eat') ? 'eat' : 'socialize', startMin: s, endMin: e };
}

/** One stop into a contiguous day: the blocks it covers are trimmed or split around it. */
export function spliceLinger<T extends LingerBlock>(blocks: readonly T[], linger: Linger, make: (linger: Linger) => T): T[] {
  const { startMin: s, endMin: e } = linger;
  const cut = (b: T, from: number, to: number): T => ({ ...b, startMin: from, endMin: to, start: hhmm(from), end: hhmm(to) });
  const out: T[] = [];
  for (const b of blocks) {
    if (b.endMin <= s || b.startMin >= e) { out.push(b); continue; }
    if (b.startMin < s) out.push(cut(b, b.startMin, s));
    if (b.endMin > e) out.push(cut(b, e, b.endMin));
  }
  out.push(make(linger));
  return out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

/**
 * A template day with its stops (lunch, then late afternoon). Animals don't stop to chat. `make` builds the new block in
 * the caller's own block type: action, place and times from the stop, `with: []`, `note: ''`.
 */
export function withLingers<T extends LingerBlock>(blocks: readonly T[], who: { id: string; kind?: string }, weekday: string,
  make: (linger: Linger) => T): T[] {
  let out = [...blocks];
  if (who.kind === 'animal') return out;
  for (const window of LINGER_WINDOWS) {
    const linger = lingerFor(out, who.id, weekday, window);
    if (linger) out = spliceLinger(out, linger, make);
  }
  return out;
}

/** The new block's times as plan text. */
export const lingerTimes = (linger: Linger): { start: string; end: string } => ({ start: hhmm(linger.startMin), end: hhmm(linger.endMin) });
