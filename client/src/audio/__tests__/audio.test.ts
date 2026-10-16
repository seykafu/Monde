import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_TRACKS, trackFiles, TRACK_KEYS, resolveMusicCue } from '../musicTracks';
import { generateNoteSchedule, placeholderDuration } from '../placeholderMusic';
import { probeMusicFile } from '../MusicManager';
import { getAudioSettings, setAudioSettings } from '../audioSettings';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());
describe('MVP catalogue', () => {
  it('resolves every documented cue, including later chapters and wildcard suffixes', () => {
    const groups = {
      morning: 'dawn_report dawn_report_soft slip_morning', old_quarter: 'walk_theme civic_hum library_hush clock_hush fountain_work',
      market_row: 'cafe_idle harvest_fiddle', wharf: 'dusk_harbor slip_empty', night: 'ledger_dusk', cottage: 'cottage_warm',
      tension: 'tension_light tension_slow quiet_strain quarry_wind folly_theme debate_theme', tender: 'quiet_resolve pell_private',
      vane_theme: 'vane_theme', arrival: 'arrival_theme', bloom_fair: 'fair_bright fair_dusk', commons: 'station_wind station_open',
      main_theme: 'lantern_night*'
    };
    const doc = readFileSync(new URL('../../../../docs/AUDIO.md', import.meta.url), 'utf8');
    for (const [track, cues] of Object.entries(groups)) for (const cue of cues.split(' ')) {
      expect(doc).toContain(cue);
      expect(resolveMusicCue(cue)).toBe(track);
    }
    expect(resolveMusicCue('lantern_night_finale')).toBe('main_theme');
    expect(resolveMusicCue('not_a_cue')).toBe('main_theme');
    expect(resolveMusicCue('toString')).toBe('main_theme');
  });
  it('provides fourteen file names and accepts direct track keys', () => {
    expect(TRACK_KEYS).toHaveLength(14);
    for (const key of TRACK_KEYS) {
      expect(MUSIC_TRACKS[key].file).toBe(`${key}.mp3`);
      expect(resolveMusicCue(key)).toBe(key);
      // Gains even out measured loudness (about −17 LUFS); keep them in a sane band.
      for (const take of trackFiles(key)) {
        expect(take.gain).toBeGreaterThan(0.4);
        expect(take.gain).toBeLessThanOrEqual(1.5);
        expect(take.file).toMatch(new RegExp(`^${key}(_\\d+)?\\.mp3$`));
      }
    }
  });
  it('lists alternate takes after the main take', () => {
    expect(trackFiles('old_quarter').map((t) => t.file)).toEqual(['old_quarter.mp3', 'old_quarter_2.mp3']);
    expect(trackFiles('night').map((t) => t.file)).toEqual(['night.mp3']);
  });
});
describe('placeholder score', () => {
  for (const track of TRACK_KEYS) it(`${track} is deterministic, bounded and seeded`, () => {
    const notes = generateNoteSchedule(42, track);
    expect(notes).toEqual(generateNoteSchedule(42, track));
    expect(notes).not.toEqual(generateNoteSchedule(43, track));
    expect(notes.length).toBeGreaterThan(24);
    for (const note of notes) {
      expect(note.time).toBeGreaterThanOrEqual(0);
      expect(note.time).toBeLessThan(placeholderDuration(track));
      expect(note.duration).toBeGreaterThan(0);
      expect(note.midi).toBeGreaterThan(0);
    }
  });
  it('quotes the exact town chime in both town themes', () => {
    for (const track of ['main_theme', 'bloom_fair'] as const)
      expect(generateNoteSchedule(42, track).filter(n => n.voice === 'pluck').slice(0, 6).map(n => n.midi)).toEqual([72, 76, 81, 79, 74, 72]);
  });
});
describe('file probe', () => {
  it('uses HEAD first', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await probeMusicFile('audio/music/main_theme.mp3')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' });
  });
  it('falls back to ranged GET and rejects HTML fallbacks', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 206, headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await probeMusicFile('track')).toBe(true);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ headers: { Range: 'bytes=0-0' } });
    fetcher.mockResolvedValue(new Response(null, { headers: { 'content-type': 'text/html' } }));
    expect(await probeMusicFile('missing')).toBe(false);
  });
  it('handles network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await probeMusicFile('missing')).toBe(false);
  });
});
it('clamps settings and survives denied storage', () => {
  vi.stubGlobal('localStorage', { setItem: () => { throw new Error('denied'); } });
  expect(() => setAudioSettings({ master: 3, music: -1, mute: true })).not.toThrow();
  expect(getAudioSettings()).toMatchObject({ master: 1, music: 0, mute: true });
  setAudioSettings({ master: 1, music: 1, sfx: 1, mute: false });
});
