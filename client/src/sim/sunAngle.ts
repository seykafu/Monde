// Where the sun is: drives the diorama's sun shadows (§16.4: they rotate with
// the clock), the night pass, and CM-2's sundial (§14.8: on sunny afternoons
// 15:00–16:00 the gnomon's shadow reaches for the Old Elm).
//
// Pure, no Phaser. The path is a simple, consistent model rather than an
// ephemeris: the sun rises at sunrise(day) and sets at sunset(day) (clock.ts),
// climbs on a sine to its noon height at 13:00 (solar noon), and sweeps its
// azimuth evenly from its rising point through due south to its setting point.
// Below the horizon it mirrors that path, so it is deepest around 01:00 and
// twilight eases in and out on both sides.

import { MIDNIGHT, sunrise, sunset } from './clock';

export interface SunPosition {
  /** Compass bearing of the sun, degrees clockwise from north (90 = east, 180 = south). */
  azimuth: number;
  /** Degrees above the horizon; negative at night. */
  elevation: number;
}

// GDD-GAP: Monde is a mid-latitude coastal town; no latitude is given. Noon
// height follows the length of the day: 42° on the equinox days (13h20 of
// daylight), ~62° at midsummer, ~22° at midwinter. Likewise the sun rises in
// the east-north-east at the equinox (70°), the north-east at midsummer (45°)
// and just south of east at midwinter (95°).
export const NOON_ELEVATION_AT_EQUINOX = 42;
export const NOON_ELEVATION_PER_DAYLIGHT_MINUTE = 0.2;
export const EQUINOX_DAYLIGHT_MINUTES = 800;
export const RISE_AZIMUTH_AT_12H = 90;
export const RISE_AZIMUTH_PER_DAYLIGHT_MINUTE = -0.25;

// GDD-GAP: twilight. The night layer is fully up once the sun is 8° below the
// horizon and fully gone at 4° above it (about an hour each side of sunset in
// spring, shorter in summer, longer in winter).
export const DARK_BELOW = -8;
export const LIGHT_ABOVE = 4;

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** The sun at `minute` (minutes since midnight; values past 24:00 wrap into the small hours). */
export const sunPosition = (day: number, minute: number): SunPosition => {
  const m = mod(minute, MIDNIGHT);
  const rise = sunrise(day), set = sunset(day);
  const daylight = set - rise, night = MIDNIGHT - daylight;
  const noonElevation = NOON_ELEVATION_AT_EQUINOX + NOON_ELEVATION_PER_DAYLIGHT_MINUTE * (daylight - EQUINOX_DAYLIGHT_MINUTES);
  const riseAzimuth = RISE_AZIMUTH_AT_12H + RISE_AZIMUTH_PER_DAYLIGHT_MINUTE * (daylight - 720);
  if (m >= rise && m <= set) {
    const s = (m - rise) / daylight;
    return {
      azimuth: riseAzimuth + (360 - 2 * riseAzimuth) * s,
      elevation: noonElevation * Math.sin(Math.PI * s)
    };
  }
  // Below the horizon: the same arc mirrored, scaled so the sun sinks at the
  // rate it set (no kink in the twilight at the horizon).
  const u = (m > set ? m - set : m + MIDNIGHT - set) / night;
  return {
    azimuth: mod(360 - riseAzimuth + 2 * riseAzimuth * u, 360),
    elevation: -noonElevation * (night / daylight) * Math.sin(Math.PI * u)
  };
};

export const isDaylight = (day: number, minute: number): boolean => sunPosition(day, minute).elevation > 0;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 1 in full daylight, 0 in full night, easing through twilight. */
export const daylightLevel = (day: number, minute: number): number =>
  smoothstep(DARK_BELOW, LIGHT_ABOVE, sunPosition(day, minute).elevation);

/** How deep the night is: 0 by day, 1 at night. The night layer's strength. */
export const darkness = (day: number, minute: number): number => 1 - daylightLevel(day, minute);

/** 0..1, strongest with the sun on the horizon: the warm light of sunrise and sunset. */
export const twilightGlow = (day: number, minute: number): number => {
  const e = sunPosition(day, minute).elevation;
  return Math.max(0, 1 - Math.abs(e - 1) / 9);
};

/** Compass bearing a vertical stick's shadow points along, or null with the sun down. */
export const shadowBearing = (day: number, minute: number): number | null => {
  const sun = sunPosition(day, minute);
  return sun.elevation > 0 ? mod(sun.azimuth + 180, 360) : null;
};
