/** MVP catalogue, from docs/AUDIO.md. Pure data: safe in Node and content tooling. */
export const MUSIC_TRACKS = {
  main_theme: { file: 'main_theme.mp3', gain: 1, description: 'Hopeful, wistful town waltz' },
  morning: { file: 'morning.mp3', gain: 1, description: 'Fresh, quiet, kettle-on' },
  old_quarter: { file: 'old_quarter.mp3', gain: 1, description: 'Cobbles, clocks, gentle bustle' },
  market_row: { file: 'market_row.mp3', gain: 1, description: 'Warm, busy, cheeky' },
  wharf: { file: 'wharf.mp3', gain: 1, description: 'Salt air and slow swell' },
  commons: { file: 'commons.mp3', gain: 1, description: 'Green, open, birdsong' },
  night: { file: 'night.mp3', gain: 1, description: 'Lamplight and hush' },
  cottage: { file: 'cottage.mp3', gain: 1, description: 'Home, safe, small' },
  tension: { file: 'tension.mp3', gain: 1, description: 'Uneasy, restrained' },
  scuffle: { file: 'scuffle.mp3', gain: 1, description: 'Comic, bouncy fight' },
  vane_theme: { file: 'vane_theme.mp3', gain: 1, description: 'Smooth, too polished' },
  tender: { file: 'tender.mp3', gain: 1, description: 'Heartfelt, hopeful' },
  arrival: { file: 'arrival.mp3', gain: 1, description: 'Beginning, open water' },
  bloom_fair: { file: 'bloom_fair.mp3', gain: 1, description: 'Bright festival dance' }
} as const;
export type TrackKey = keyof typeof MUSIC_TRACKS;
export const TRACK_KEYS = Object.keys(MUSIC_TRACKS) as TrackKey[];
export const MUSIC_CUES: Readonly<Record<string, TrackKey>> = {
  dawn_report: 'morning', dawn_report_soft: 'morning', slip_morning: 'morning',
  walk_theme: 'old_quarter', civic_hum: 'old_quarter', library_hush: 'old_quarter', clock_hush: 'old_quarter', fountain_work: 'old_quarter',
  cafe_idle: 'market_row', dusk_harbor: 'wharf', slip_empty: 'wharf', ledger_dusk: 'night', cottage_warm: 'cottage',
  tension_light: 'tension', tension_slow: 'tension', quiet_strain: 'tension', quiet_resolve: 'tender', pell_private: 'tender',
  vane_theme: 'vane_theme', arrival_theme: 'arrival', fair_bright: 'bloom_fair', fair_dusk: 'bloom_fair',
  station_wind: 'commons', station_open: 'commons', quarry_wind: 'tension', harvest_fiddle: 'market_row',
  folly_theme: 'tension', debate_theme: 'tension', 'lantern_night*': 'main_theme'
};
export function resolveMusicCue(cue: string): TrackKey {
  if (Object.hasOwn(MUSIC_TRACKS, cue)) return cue as TrackKey;
  if (Object.hasOwn(MUSIC_CUES, cue)) return MUSIC_CUES[cue]!;
  if (cue.startsWith('lantern_night')) return 'main_theme';
  if (import.meta.env?.DEV) console.warn(`[Music] Unknown cue: ${cue}`);
  return 'main_theme';
}
