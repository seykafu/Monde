// What the client tells the server about a conversation's scene (GDD §9.10.1 block 4). Pure.
// The client owns the clock, positions and weather; the routine executor knows where a resident is and why.
import { describeWeather, type WeatherNow } from '../sim/weather';
import type { ResidentState } from '../sim/routineExecutor';
import type { ZoneDef } from '../world/zoneFormat';
import type { TalkContext } from './types';

const PLACE_ID = /^[a-z_]+\.[a-z0-9_]+$/;

/**
 * The `zone.place` the resident is standing in: their block's place when they're at it, else (walking between
 * places) whichever of this board's places is nearest.
 */
export function talkPlace(state: Pick<ResidentState, 'place' | 'traveling' | 'position'> | null, zone: Pick<ZoneDef, 'id' | 'places'>): string {
  if (state && !state.traveling && PLACE_ID.test(state.place) && state.place.startsWith(`${zone.id}.`)) return state.place;
  const at = state?.position;
  let best = zone.places[0], bestD = Infinity;
  if (at) {
    for (const p of zone.places) {
      const [x, y, w, h] = p.rect;
      const dx = Math.max(x - at.x, 0, at.x - (x + w)), dy = Math.max(y - at.y, 0, at.y - (y + h));
      const d = Math.hypot(dx, dy);
      if (d < bestD) { best = p; bestD = d; }
    }
  }
  if (best) return `${zone.id}.${best.id}`;
  return state && PLACE_ID.test(state.place) ? state.place : `${zone.id}.street`;
}

/** The resident's plan block in the server's words: "work at market_row.bakery", "walking to old_quarter.library". */
export function talkActivity(state: Pick<ResidentState, 'activity' | 'place' | 'traveling'> | null): string | null {
  if (!state) return null;
  const text = state.traveling ? `walking to ${state.place}` : `${state.activity} at ${state.place}`;
  return text.slice(0, 120);
}

/** "drizzle", "bright spells", "thick fog": the HUD's words for the sky. */
export const weatherPhrase = (now: WeatherNow): string => describeWeather(now).toLowerCase();

export function talkContext(args: {
  day: number; minute: number; state: ResidentState | null; zone: Pick<ZoneDef, 'id' | 'places'>; weather: WeatherNow;
}): TalkContext {
  return {
    day: Math.max(1, Math.floor(args.day)),
    minute: Math.min(1560, Math.max(0, Math.floor(args.minute))),
    place: talkPlace(args.state, args.zone),
    weather: weatherPhrase(args.weather),
    current_activity: talkActivity(args.state)
  };
}
