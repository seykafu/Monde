// What plays while the player walks the town (docs/AUDIO.md "Where it plays"). Pure: no Phaser, no DOM.
//
// The town owns the background music; story scenes, Scuffles and festivals can hold it for their own cue
// (Music.ts holdMusic/releaseMusic) and hand it back when they end.
import type { TrackKey } from './musicTracks';

/** The district tracks; any other board falls back to the main theme until it has its own. */
const DISTRICT: Readonly<Record<string, TrackKey>> = {
  old_quarter: 'old_quarter',
  market_row: 'market_row',
  wharf: 'wharf',
  commons: 'commons',
};

/** 06:00–07:00 is the morning: the Dawn Report and the first hour of every day (§5.3 minutes). */
export const MORNING_START = 360;
export const MORNING_END = 420;
/** Night music once it's this dark (sim/sunAngle darkness, 0..1). */
export const NIGHT_DARKNESS = 0.55;

export interface AmbientInput {
  zone: string;
  day: number;
  minute: number;
  /** sim/sunAngle darkness(day, minute). */
  darkness: number;
}

export function ambientTrack({ zone, minute, darkness }: AmbientInput): TrackKey {
  if (minute >= MORNING_START && minute < MORNING_END) return 'morning';
  if (darkness >= NIGHT_DARKNESS) return 'night';
  return DISTRICT[zone] ?? 'main_theme';
}
