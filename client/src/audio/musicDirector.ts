// What plays while the player walks the town (docs/AUDIO.md "Where it plays"). Pure: no Phaser, no DOM.
//
// The town owns the background music; story scenes, Scuffles and festivals can hold it for their own cue
// (Music.ts holdMusic/releaseMusic) and hand it back when they end.
import { MUSIC_TRACKS, type TrackKey } from './musicTracks';

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

/** Indoors (W-03, zone `kind: interior`): a room's own track, or its district's played softly. */
export interface AmbientRoom {
  /** The room's own track (the cottage's): it plays at every hour there. */
  music?: string;
  /** A hushed room (the library, the Town Hall): its district's track, softer still. */
  quiet: boolean;
}

export interface AmbientInput {
  /** The district (a room's building's, indoors). */
  zone: string;
  day: number;
  minute: number;
  /** sim/sunAngle darkness(day, minute). */
  darkness: number;
  /** Indoors: the room. */
  room?: AmbientRoom;
}

/**
 * How loud the town's music plays indoors, against the street's 1. Art tuning: a room is a little softer, a hushed one
 * (the library, the Town Hall) softer again; a room's own track (home) plays full.
 */
export const INDOOR_LEVEL = 0.8;
export const QUIET_LEVEL = 0.55;

const isTrack = (key: string): key is TrackKey => Object.hasOwn(MUSIC_TRACKS, key);

/** The track and how loud it plays: district by day, morning for the first hour, night after dark; a room's own track. */
export function ambientMusic({ zone, minute, darkness, room }: AmbientInput): { track: TrackKey; level: number } {
  if (room?.music && isTrack(room.music)) return { track: room.music, level: 1 };
  const level = room ? (room.quiet ? QUIET_LEVEL : INDOOR_LEVEL) : 1;
  if (minute >= MORNING_START && minute < MORNING_END) return { track: 'morning', level };
  if (darkness >= NIGHT_DARKNESS) return { track: 'night', level };
  return { track: DISTRICT[zone] ?? 'main_theme', level };
}

export function ambientTrack(input: AmbientInput): TrackKey {
  return ambientMusic(input).track;
}
