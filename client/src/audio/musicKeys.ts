import { MUSIC_TRACKS, TRACK_KEYS, type TrackKey } from './musicTracks';
export const MUSIC = { mainTheme: 'main_theme' } as const;
export type MusicKey = TrackKey;
export interface AudioFile { key: MusicKey; src: string }
export const MUSIC_FILES: AudioFile[] = TRACK_KEYS.map(key => ({ key, src: `audio/music/${MUSIC_TRACKS[key].file}` }));
