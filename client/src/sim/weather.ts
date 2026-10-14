// Daily weather, wind and tides (GDD §5.3, §6.6, §14.5 MR-5, §14.6 WF-1 / WF-5).
//
// Pure and deterministic: the same (worldSeed, day) always gives the same day,
// so the Dawn Report can print it at 06:00 (§6.6) and every client agrees.
// Days are drawn independently; the intra-day shape (when rain falls, when
// fog burns off) is decided at dawn with the rest of the day.

import { Rng } from '../util/rng';
import { DAY_START, PASS_OUT, MIDNIGHT, seasonOf, sunset, type Season } from './clock';

export type WeatherKind = 'sun' | 'cloud' | 'rain' | 'fog' | 'wind' | 'snow';
/** Where the wind blows FROM. West is from the sea (MR-5). */
export type WindDir = 'N' | 'E' | 'S' | 'W';

export const WEATHER_KINDS: readonly WeatherKind[] = ['sun', 'cloud', 'rain', 'fog', 'wind', 'snow'];
export const WIND_DIRS: readonly WindDir[] = ['N', 'E', 'S', 'W'];

// GDD-GAP: §5.3 lists the kinds (snow in winter only) but gives no odds. Each
// row sums to 1. Spring is showery, summer mostly fair, autumn wet and foggy,
// winter brings snow (Days 76–100 only).
export const WEATHER_ODDS: Readonly<Record<Season, Readonly<Record<WeatherKind, number>>>> = {
  spring: { sun: 0.30, cloud: 0.25, rain: 0.25, fog: 0.12, wind: 0.08, snow: 0 },
  summer: { sun: 0.50, cloud: 0.18, rain: 0.12, fog: 0.08, wind: 0.12, snow: 0 },
  autumn: { sun: 0.22, cloud: 0.25, rain: 0.25, fog: 0.15, wind: 0.13, snow: 0 },
  winter: { sun: 0.20, cloud: 0.25, rain: 0.10, fog: 0.10, wind: 0.10, snow: 0.25 }
};

// GDD-GAP: no wind table in the GDD. Prevailing westerlies off the sea: 40%
// west gives 2.8 west-wind days a week on average, so MR-5 (climb on a west-wind
// day) is never more than a few days away.
export const WIND_ODDS: Readonly<Record<WindDir, number>> = { N: 0.2, E: 0.2, S: 0.2, W: 0.4 };

// GDD-GAP: intra-day shapes. Fog is a morning thing: it burns off between
// 10:00 and 13:00 (thinning over the last two hours), and on half of fog days
// sea fog rolls back in from an hour after sunset. Rain and snow fall in one
// spell that starts between 06:00 and 14:00 and lasts 4–13 hours; the rest of
// the day is overcast.
export const FOG_BURN_OFF = { earliest: 10 * 60, latest: 13 * 60, thinning: 120 } as const;
export const EVENING_FOG = { chance: 0.5, afterSunset: 60, rampUp: 120, max: 0.7 } as const;
export const SPELL = { earliestStart: 6 * 60, latestStart: 14 * 60, minLength: 4 * 60, maxLength: 13 * 60 } as const;
// GDD-GAP: wind strength (0 calm … 1 gale) is drawn from base + roll × spread:
// strong on wind days, still on fog days (fog doesn't survive a breeze).
export const WIND_STRENGTH: Readonly<Record<WeatherKind, { base: number; spread: number }>> = {
  sun: { base: 0.1, spread: 0.35 }, cloud: { base: 0.1, spread: 0.35 }, rain: { base: 0.3, spread: 0.35 },
  fog: { base: 0.02, spread: 0.12 }, wind: { base: 0.7, spread: 0.3 }, snow: { base: 0.3, spread: 0.35 }
};

export interface DailyWeather {
  day: number;
  /** The day's headline weather, as the Dawn Report prints it. */
  kind: WeatherKind;
  wind: WindDir;
  /** 0 calm … 1 gale. */
  windStrength: number;
  /** Rain and snow days: when it falls, in game minutes. Null otherwise. */
  spell: { from: number; until: number } | null;
  /** Fog days: when the morning fog has burned off. Null otherwise. */
  fogUntil: number | null;
  /** Fog days: whether sea fog returns after dark (hides the lighthouse beam, WF-5). */
  eveningFog: boolean;
}

/** What the sky is doing right now. */
export interface WeatherNow {
  kind: WeatherKind;
  /** 0..1: how thick the fog, how hard the rain, how strong the gusts. */
  intensity: number;
}

// ── Determinism ──────────────────────────────────────────────────────────────

/** murmur3's finalizer: a well-mixed 32-bit hash. */
const fmix = (h: number): number => {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};
/** Hash any integers into one well-mixed seed. */
export const hashInts = (...values: number[]): number => {
  let h = 0x811c9dc5;
  for (const v of values) h = fmix(h ^ Math.imul((v | 0) + 0x7f4a7c15, 0x9e3779b1));
  return h;
};

const pickWeighted = <K extends string>(keys: readonly K[], odds: Readonly<Record<K, number>>, roll: number): K => {
  let acc = 0;
  for (const key of keys) {
    acc += odds[key];
    if (roll < acc) return key;
  }
  // Float rounding on a row that sums to 1: the last key with any weight.
  return [...keys].reverse().find(k => odds[k] > 0) ?? keys[0]!;
};

const WEATHER_SALT = 0x57454154; // "WEAT"

export const dailyWeather = (worldSeed: number, day: number): DailyWeather => {
  const rng = new Rng(hashInts(worldSeed, day, WEATHER_SALT));
  // Every roll is drawn, in this order, whatever the day turns out to be, so
  // tuning one table never reshuffles the others.
  const kindRoll = rng.next(), windRoll = rng.next(), strengthRoll = rng.next();
  const spellStartRoll = rng.next(), spellLengthRoll = rng.next();
  const burnOffRoll = rng.next(), eveningFogRoll = rng.next();

  const kind = pickWeighted(WEATHER_KINDS, WEATHER_ODDS[seasonOf(day)], kindRoll);
  const wind = pickWeighted(WIND_DIRS, WIND_ODDS, windRoll);
  const strength = WIND_STRENGTH[kind];
  let spell: DailyWeather['spell'] = null;
  if (kind === 'rain' || kind === 'snow') {
    const from = Math.round(SPELL.earliestStart + spellStartRoll * (SPELL.latestStart - SPELL.earliestStart));
    const length = Math.round(SPELL.minLength + spellLengthRoll * (SPELL.maxLength - SPELL.minLength));
    spell = { from, until: Math.min(PASS_OUT, from + length) };
  }
  const fogUntil = kind === 'fog'
    ? Math.round(FOG_BURN_OFF.earliest + burnOffRoll * (FOG_BURN_OFF.latest - FOG_BURN_OFF.earliest))
    : null;
  return {
    day, kind, wind,
    windStrength: Math.min(1, strength.base + strengthRoll * strength.spread),
    spell, fogUntil,
    eveningFog: kind === 'fog' && eveningFogRoll < EVENING_FOG.chance
  };
};

const OVERCAST: Readonly<WeatherNow> = { kind: 'cloud', intensity: 0.7 };

/**
 * The weather at `minute` (game minutes, 360..1560) of a day from dailyWeather().
 * Rain and snow fall only inside their spell; fog is thickest at dawn and gone
 * by its burn-off time.
 */
export const weatherAt = (w: DailyWeather, minute: number): WeatherNow => {
  const m = minute < DAY_START ? minute + MIDNIGHT : minute;
  switch (w.kind) {
    case 'sun': return { kind: 'sun', intensity: 1 };
    case 'cloud': return { kind: 'cloud', intensity: 1 };
    case 'wind': {
      // Gusty: two slow overlapping swells, never quite calm.
      const swell = 0.5 + 0.25 * Math.sin(m / 23 + w.day) + 0.25 * Math.sin(m / 61 + 2 * w.day);
      return { kind: 'wind', intensity: 0.55 + 0.45 * swell };
    }
    case 'rain':
    case 'snow': {
      const s = w.spell!;
      if (m < s.from || m >= s.until) return { ...OVERCAST };
      // Starts light, builds to the middle of the spell, eases off.
      return { kind: w.kind, intensity: 0.35 + 0.65 * Math.sin((Math.PI * (m - s.from)) / (s.until - s.from)) };
    }
    case 'fog': {
      const until = w.fogUntil!;
      if (m < until) {
        const thinFrom = until - FOG_BURN_OFF.thinning;
        return { kind: 'fog', intensity: m <= thinFrom ? 1 : Math.max(0.05, (until - m) / FOG_BURN_OFF.thinning) };
      }
      const back = sunset(w.day) + EVENING_FOG.afterSunset;
      if (w.eveningFog && m >= back) {
        return { kind: 'fog', intensity: Math.max(0.05, EVENING_FOG.max * Math.min(1, (m - back) / EVENING_FOG.rampUp)) };
      }
      return { kind: 'cloud', intensity: 0.5 };
    }
  }
};

// ── Labels ───────────────────────────────────────────────────────────────────

const LABEL: Readonly<Record<WeatherKind, readonly [light: string, normal: string, heavy: string]>> = {
  sun: ['Sunny', 'Sunny', 'Sunny'],
  cloud: ['Bright spells', 'Cloudy', 'Overcast'],
  rain: ['Drizzle', 'Rain', 'Heavy rain'],
  fog: ['Mist', 'Fog', 'Thick fog'],
  wind: ['Breezy', 'Windy', 'Gale'],
  snow: ['Flurries', 'Snow', 'Heavy snow']
};
export const describeWeather = (now: WeatherNow): string =>
  LABEL[now.kind][now.intensity < 0.45 ? 0 : now.intensity < 0.85 ? 1 : 2];

/** Compass bearing the wind blows FROM (N = 0, clockwise). */
export const WIND_FROM_BEARING: Readonly<Record<WindDir, number>> = { N: 0, E: 90, S: 180, W: 270 };
/** Compass bearing the wind blows TOWARD: what a wind arrow points at. */
export const windToward = (dir: WindDir): number => (WIND_FROM_BEARING[dir] + 180) % 360;
export const isWestWind = (w: Pick<DailyWeather, 'wind'>): boolean => w.wind === 'W';

// ── Tides (WF-1) ─────────────────────────────────────────────────────────────
// WF-1: two low waters a day, about 50 minutes later each day. A semidiurnal
// tide: one ebb-and-flow every 12h25 (745 min), two per 24h50 tidal day, so each
// low comes 2×745 − 1440 = 50 minutes later than the day before.
export const TIDE_PERIOD = 745;
// GDD-GAP: the tide's phase. Day 1's first low water is at 04:10.
export const TIDE_FIRST_LOW = 4 * 60 + 10;

export interface TideTable {
  day: number;
  /**
   * The day's two low waters, in minutes since its midnight: the first at or
   * after 00:00, the second 12h25 later. The second can fall just past midnight
   * (up to 24:50), which is still the same game day (it runs to 26:00).
   */
  lows: [number, number];
  /** The two high waters, likewise. */
  highs: [number, number];
}

const firstAtOrAfter = (epoch: number, dayStart: number): number => {
  const k = Math.ceil((dayStart - epoch) / TIDE_PERIOD);
  return epoch + k * TIDE_PERIOD - dayStart;
};

export const tideTable = (day: number): TideTable => {
  const dayStart = (day - 1) * MIDNIGHT;
  const low = firstAtOrAfter(TIDE_FIRST_LOW, dayStart);
  // Half a period after a low; rounded up, so every high also moves exactly 50 min a day.
  const high = Math.round(firstAtOrAfter(TIDE_FIRST_LOW + TIDE_PERIOD / 2, dayStart));
  return { day, lows: [low, low + TIDE_PERIOD], highs: [high, high + TIDE_PERIOD] };
};

/** Water level at `minute` of `day`: 0 at low water, 1 at high water. */
export const tideLevel = (day: number, minute: number): number => {
  const t = (day - 1) * MIDNIGHT + minute - TIDE_FIRST_LOW;
  return (1 - Math.cos((2 * Math.PI * t) / TIDE_PERIOD)) / 2;
};
