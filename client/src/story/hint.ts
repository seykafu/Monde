// "Where to go next" (MVP polish): the HUD's small Next hint and the Ledger's line. Pure: no Phaser, no DOM.
//
// Scripted scenes wait at a place in a time window (§13.1 headers; §13.2 calendar). Nothing in the world points at
// them, so a new player who dawdles after S01a slips S01b/S01c to the next day. The hint names the next scene the
// player can still catch today:
//   - candidates: scenes not done, on or after their day, whose window hasn't closed yet, and whose trigger would be
//     true if the player stood at the scene's place (flags, day, Appeal… as they are now); handoff-only scenes
//     (`calledFrom`) and the scene playing now don't count;
//   - the one whose window opens first wins (ties in calendar order), so Day 25 points at the Bloom Fair's opening
//     before its closing;
//   - where: the scene's place, with the zone if it's elsewhere, and the next district to walk through when it's more
//     than one away ("Market Row, then Fountain Square");
//   - when: "before 11:30" once the window is open, "10:40–11:30" before it;
//   - why: a short line from §13.2's calendar row (or the scene's own lead-in) where it gives one, else "Someone is
//     expecting you at …".
// A gentle toast when an open window is about to close and the player isn't there yet (closingToast).
import { evaluate, type CompiledScene } from '@monde/shared';
import { formatClock } from '../sim/clock';
import type { FlagStore } from './flags';
import { calendarOrder, expressionContext, isSummoned, minutes, sceneDone, type StoryContext } from './triggers';

/** The registry entry holding the latest hint (or null) for the Town Ledger; scenes/story/attach.ts writes it. */
export const HINT_KEY = 'monde.story.hint';

/** Why someone is waiting, where the §13.2 calendar row (or the scene's lead-in) says. Others get the generic line. */
export const SCENE_REASONS: Readonly<Record<string, string>> = {
  s01a_ferry: 'The Gannet is coming in.', // D1: "New game opens 09:50 aboard the Gannet."
  s01b_walk: 'Pell is waiting.', // S01a's last words: "Come up with me and I'll point at things."
  s01c_cottage: 'Pell is taking you to the cottage.', // S01b: "Cottage. Kettle."
  s02_marks: 'Margo is opening the Marks log.', // D2: "Marks log opens. Library hours 10:00–17:00." (S02 cast: Margo)
  s03_tolls: 'The Tollmen are paying the bakery an early call.', // D3: "Scripted early 'welcome' shakedown."
  s04_water_again: 'Market day, and the fountain might run again.', // D5: "Market day … {project: fountain} unlocks."
  s05_first_arrival: 'The ferry is due in.', // D7–8: S05 plays on a ferry day.
  s05b_empty_boat: 'The ferry is due in.',
  s06_good_coat: 'A man in a good coat is coming to the square.', // D10: "Vane's first on-screen visit."
  s07a_chime_runs: 'Bertrand is at the clocktower.', // D14 A: "the clock runs for good."
  s07b_chime_loan: 'Bertrand is at the clocktower.', // D14 B: "Bertrand lends the tower one borrowed chime."
  s10a_bloom_open: 'The Bloom Fair is opening.', // D25: Bloom Fair.
  s10b_bloom_close: 'The Bloom Fair is closing.'
};

/**
 * GDD-GAP: nothing says how early to warn. Half an hour of game time is about 22 real seconds (§5.3: 0.75 s a
 * minute): enough to walk a district.
 */
export const CLOSING_WARNING_MINUTES = 30;

export interface HintPlaces {
  /** "Fountain Square" for `fountain_square`. */
  placeName(placeId: string): string;
  /** "Old Quarter" for `old_quarter`. */
  zoneName(zoneId: string): string;
  /** The districts to walk through from one zone to another, ending with `to`; [] when already there, null if unreachable. */
  route(from: string, to: string): readonly string[] | null;
}

export interface StoryHint {
  sceneId: string;
  /** `zone.place` */
  place: string;
  placeName: string;
  zoneName: string;
  /** The next district to walk to on the way, when the place is more than one district away. */
  via: string | null;
  /** The window, minutes since midnight of the game day. */
  start: number;
  end: number;
  /** The window is open now (the scene starts as soon as the player is there). */
  open: boolean;
  /** The scene summons the player itself (§13.3: S10a/b, S11). */
  summoned: boolean;
  /** "Pell is waiting." or "Someone is expecting you at …". */
  reason: string;
  /** "Fountain Square, Old Quarter" / "Market Row, then Fountain Square". */
  where: string;
  /** "before 11:30" / "10:40–11:30". */
  when: string;
  /** One line: "Market Row, then Fountain Square, before 11:30 — Pell is waiting." */
  text: string;
}

interface Candidate { scene: CompiledScene; start: number; end: number }

/** The scenes the player could still catch today, soonest window first (then calendar order). */
export function catchableToday(scenes: readonly CompiledScene[], context: StoryContext, flags: FlagStore,
  completed: ReadonlySet<string> = new Set(), active?: string): Candidate[] {
  if (context.asleep || context.inScuffle) return [];
  const out: Candidate[] = [];
  for (const scene of scenes) {
    const h = scene.header;
    if (!h || h.calledFrom || scene.id === active || context.day < h.day || sceneDone(scene, flags, completed)) continue;
    const start = minutes(h.time.start), end = minutes(h.time.end);
    if (context.minute >= end) continue;
    const [zone = ''] = h.place.split('.');
    // As if the player were there when the window is open: the trigger's place, zone and time tests pass.
    const there: StoryContext = { ...context, zone, place: h.place, minute: Math.max(context.minute, start) };
    let ok = false;
    try { ok = !!evaluate(h.trigger, expressionContext(there, flags)); } catch { ok = false; }
    if (ok) out.push({ scene, start, end });
  }
  return out.sort((a, b) => a.start - b.start || calendarOrder(a.scene, b.scene));
}

/** The Next hint for now, or null when nothing more can be caught today. */
export function storyHint(scenes: readonly CompiledScene[], context: StoryContext, flags: FlagStore, places: HintPlaces,
  completed: ReadonlySet<string> = new Set(), active?: string): StoryHint | null {
  const next = catchableToday(scenes, context, flags, completed, active)[0];
  if (!next) return null;
  const h = next.scene.header!;
  const [zone = '', placeId = ''] = h.place.split('.');
  const placeName = places.placeName(placeId), zoneName = places.zoneName(zone);
  const summoned = isSummoned(next.scene);
  const route = summoned ? [] : places.route(context.zone, zone) ?? [];
  const via = route.length > 1 ? places.zoneName(route[0]!) : null;
  const where = via ? `${via}, then ${placeName}` : zone === context.zone ? placeName : `${placeName}, ${zoneName}`;
  const open = context.minute >= next.start;
  const when = open ? `before ${formatClock(next.end)}` : `${formatClock(next.start)}–${formatClock(next.end)}`;
  const reason = SCENE_REASONS[next.scene.id] ?? `Someone is expecting you at ${placeName}.`;
  return {
    sceneId: next.scene.id, place: h.place, placeName, zoneName, via, start: next.start, end: next.end, open, summoned,
    reason, where, when, text: `${where}, ${when} — ${reason.replace(/\.$/, '')}`
  };
}

/**
 * The toast for a window about to close, once per scene and day (`warned` holds `sceneId@day`): the window is open,
 * it closes within CLOSING_WARNING_MINUTES, and the player isn't at the place. Null otherwise.
 */
export function closingToast(hint: StoryHint | null, now: Pick<StoryContext, 'day' | 'minute' | 'place'>, warned: Set<string>): string | null {
  if (!hint || !hint.open || hint.summoned || now.place === hint.place) return null;
  const left = hint.end - now.minute;
  if (left <= 0 || left > CLOSING_WARNING_MINUTES) return null;
  const key = `${hint.sceneId}@${now.day}`;
  if (warned.has(key)) return null;
  warned.add(key);
  return `Nearly ${formatClock(hint.end)}. ${hint.placeName}: ${SCENE_REASONS[hint.sceneId] ?? 'someone is still expecting you.'}`;
}

/** Breadth-first through the zones' edges: the districts to walk through from `from` to `to` (ending with `to`). */
export function zoneRoute(zones: Readonly<Record<string, { edges: readonly { zone: string }[] }>>, from: string, to: string): string[] | null {
  if (from === to) return [];
  const prev = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    for (const { zone } of zones[at]?.edges ?? []) {
      if (prev.has(zone)) continue;
      prev.set(zone, at);
      if (zone === to) {
        const path = [zone];
        for (let z = at; z !== from; z = prev.get(z)!) path.unshift(z);
        return path;
      }
      queue.push(zone);
    }
  }
  return null;
}
