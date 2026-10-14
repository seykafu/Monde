import type { TrackKey } from './musicTracks';
interface Palette { root: number; scale: readonly number[]; bpm: number; timbre: 'sine' | 'triangle'; cutoff: number; sparse: boolean; bass: boolean; beats: number }
const major = [0, 2, 4, 5, 7, 9, 11], minor = [0, 2, 3, 5, 7, 8, 10], dorian = [0, 2, 3, 5, 7, 9, 10];
// GDD-GAP: placeholder voicings, tempos and synthesis levels are provisional sound-design parameters.
const palette = (root: number, scale: readonly number[], bpm: number, timbre: 'sine' | 'triangle', cutoff: number, sparse = false, bass = true, beats = 4): Palette =>
  ({ root, scale, bpm, timbre, cutoff, sparse, bass, beats });
export const PLACEHOLDER_PARAMS: Record<TrackKey, Palette> = {
  main_theme: palette(60, major, 84, 'triangle', 1600, false, true, 3),
  morning: palette(62, major, 74, 'sine', 1800, true, false),
  old_quarter: palette(67, major, 88, 'triangle', 1900),
  market_row: palette(65, major, 96, 'triangle', 2200),
  wharf: palette(50, dorian, 72, 'triangle', 950, true),
  commons: palette(65, major, 80, 'sine', 2000, false, false),
  night: palette(57, minor, 70, 'sine', 650, true),
  cottage: palette(60, major, 73, 'sine', 1400, true, false),
  tension: palette(50, minor, 71, 'triangle', 550, true),
  scuffle: palette(62, dorian, 100, 'triangle', 2400),
  vane_theme: palette(58, dorian, 86, 'sine', 1300),
  tender: palette(65, major, 72, 'triangle', 1000, true),
  arrival: palette(67, major, 90, 'triangle', 1700),
  bloom_fair: palette(60, major, 100, 'triangle', 2600)
};
export interface MusicNote { time: number; duration: number; midi: number; voice: 'pad' | 'pluck' | 'bass'; velocity: number }
export const placeholderDuration = (track: TrackKey): number => 8 * PLACEHOLDER_PARAMS[track].beats * 60 / PLACEHOLDER_PARAMS[track].bpm;
/** One repeatable eight-bar phrase. Times are seconds relative to phrase start. */
export function generateNoteSchedule(seed: number, track: TrackKey): MusicNote[] {
  let state = seed >>> 0;
  for (const char of track) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const p = PLACEHOLDER_PARAMS[track], beat = 60 / p.bpm, notes: MusicNote[] = [];
  const pitch = (degree: number) => p.root + p.scale[degree % 7]! + 12 * Math.floor(degree / 7);
  for (let bar = 0; bar < 8; bar++) {
    const degree = [0, 5, 3, 4][bar % 4]!, time = bar * p.beats * beat;
    for (const d of [degree, degree + 2, degree + 4]) notes.push({ time, duration: p.beats * beat, midi: pitch(d) - 12, voice: 'pad', velocity: 0.024 });
    if (p.bass && bar % 2 === 0) notes.push({ time, duration: beat * 1.7, midi: pitch(degree) - 24, voice: 'bass', velocity: 0.045 });
    for (let step = 0; step < p.beats * 2; step++) {
      if (p.sparse && (step % 3 !== 0 || random() < 0.25)) continue;
      notes.push({ time: time + step * beat / 2, duration: beat * 0.8, midi: pitch(degree + [0, 2, 4, 2][step % 4]!) + (random() > 0.8 ? 12 : 0), voice: 'pluck', velocity: 0.035 + random() * 0.012 });
    }
  }
  if (track === 'main_theme' || track === 'bloom_fair') {
    // Give the literal town motif its own space above the opening chord.
    const end = 6 * beat;
    for (let i = notes.length - 1; i >= 0; i--) if (notes[i]!.voice === 'pluck' && notes[i]!.time < end) notes.splice(i, 1);
    [72, 76, 81, 79, 74, 72].forEach((midi, i) => notes.push({ time: i * beat, duration: beat * 0.9, midi, voice: 'pluck', velocity: 0.05 }));
  }
  return notes.sort((a, b) => a.time - b.time);
}
/** Schedules a single note on the audio clock; callers run a low-frequency lookahead timer. */
export function schedulePlaceholderNote(ctx: AudioContext, bus: AudioNode, track: TrackKey, note: MusicNote, at: number): OscillatorNode {
  const p = PLACEHOLDER_PARAMS[track], osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
  osc.type = note.voice === 'bass' ? 'sine' : p.timbre;
  osc.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
  filter.type = 'lowpass'; filter.frequency.value = note.voice === 'pad' ? p.cutoff / 2 : p.cutoff;
  const attack = note.voice === 'pad' ? 0.35 : 0.012;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(note.velocity, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
  osc.connect(filter); filter.connect(gain); gain.connect(bus);
  osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); };
  osc.start(at); osc.stop(at + note.duration + 0.03);
  return osc;
}
