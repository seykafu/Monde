import type Phaser from "phaser";
import { getAudioSettings, setAudioSettings, subscribeAudioSettings } from "./audioSettings";

// Procedurally synthesized SFX via WebAudio — no audio assets needed.
//
// Design language ("steel and drum"): every combat sound is LAYERED from
// the same four families so the whole game shares one sonic identity:
//   * sub-thump   — a sine with a fast exponential pitch drop (the body)
//   * noise       — filtered/swept noise (the air: whooshes, steps, paper)
//   * metal       — a stack of inharmonic partials at bell-like ratios
//                   (the steel: clangs, shings, shimmer)
//   * tone        — plain oscillators with optional pitch glides (UI, music
//                   stabs, fanfares)
// Two things keep it from sounding like programmer beeps:
//   1. A shared convolution REVERB SEND (impulse response generated from
//      shaped noise at first use) — sounds sit in a space instead of
//      clicking dryly out of nowhere.
//   2. HUMANIZATION — repeated sounds (steps, hits) get a few percent of
//      random pitch/level drift per play, so no two swings are the
//      identical waveform.
//
// Routing: every layer's gain feeds a shared MASTER gain (Settings UI
// scales it) and optionally the reverb send. All scheduling uses
// ctx.currentTime offsets — never setTimeout — so multi-layer sounds stay
// sample-accurate even when the main thread is busy.

let ctxRef: AudioContext | null = null;
let masterGain: GainNode | null = null;
let reverbSend: GainNode | null = null;
const effectiveVolume = (): number => { const s = getAudioSettings(); return s.mute ? 0 : s.master * s.sfx; };
subscribeAudioSettings(() => { if (masterGain && ctxRef) masterGain.gain.setTargetAtTime(effectiveVolume(), ctxRef.currentTime, 0.02); });

const audioCtx = (): AudioContext => {
  if (!ctxRef) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctxRef = new AC();
  }
  return ctxRef!;
};

const sfxBus = (): GainNode => {
  if (!masterGain) {
    const ctx = audioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = effectiveVolume();
    masterGain.connect(ctx.destination);
  }
  return masterGain!;
};

// Shared reverb: a ConvolverNode whose impulse response is 0.6s of
// exponentially decaying stereo noise (decorrelated channels). Feeds the
// master bus. Individual sounds route a portion of themselves here via
// the `send` option on the layer helpers.
const reverbBus = (): GainNode => {
  if (!reverbSend) {
    const ctx = audioCtx();
    const convolver = ctx.createConvolver();
    const seconds = 0.6;
    const len = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Exponential decay with a touch of early-reflection density.
        data[i] = (Math.random() * 2 - 1) * Math.exp(-5.5 * t) * (1 - 0.3 * t);
      }
    }
    convolver.buffer = ir;
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(convolver);
    convolver.connect(sfxBus());
  }
  return reverbSend!;
};

export const setMasterSfxVolume = (v: number): void => {
  setAudioSettings({ sfx: v });
};

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

// Connect a layer's output gain to the dry bus plus an optional reverb send.
const routeOut = (gain: GainNode, send: number): void => {
  gain.connect(sfxBus());
  if (send > 0) {
    const ctx = audioCtx();
    const s = ctx.createGain();
    s.gain.value = send;
    gain.connect(s);
    s.connect(reverbBus());
  }
};

interface ToneOpts {
  freq: number;
  freqEnd?: number;       // exponential glide target
  duration: number;
  type?: OscillatorType;
  vol: number;
  attack?: number;
  at?: number;            // schedule offset in seconds
  detune?: number;        // cents
  send?: number;          // reverb send amount 0..1
}

const tone = (o: ToneOpts): void => {
  const ctx = audioCtx();
  const now = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(Math.max(20, o.freq), now);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), now + o.duration);
  }
  if (o.detune) osc.detune.value = o.detune;
  const gain = ctx.createGain();
  const attack = o.attack ?? 0.004;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + o.duration);
  osc.connect(gain);
  routeOut(gain, o.send ?? 0);
  osc.start(now);
  osc.stop(now + o.duration + 0.02);
};

interface NoiseOpts {
  duration: number;
  vol: number;
  filterType?: BiquadFilterType;
  freq: number;
  freqEnd?: number;       // filter sweep target
  q?: number;
  attack?: number;
  at?: number;
  send?: number;
}

const noise = (o: NoiseOpts): void => {
  const ctx = audioCtx();
  const now = ctx.currentTime + (o.at ?? 0);
  const len = Math.max(1, Math.floor(ctx.sampleRate * o.duration));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filterType ?? "lowpass";
  filter.frequency.setValueAtTime(o.freq, now);
  if (o.freqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.freqEnd), now + o.duration);
  }
  filter.Q.value = o.q ?? 0.8;
  const gain = ctx.createGain();
  const attack = o.attack ?? 0.002;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + o.duration);
  src.connect(filter);
  filter.connect(gain);
  routeOut(gain, o.send ?? 0);
  src.start(now);
  src.stop(now + o.duration + 0.02);
};

// Inharmonic partial stack at bell/clang ratios — the "struck steel" layer.
// Each partial decays faster the higher it sits, like a real struck object.
const METAL_RATIOS = [1, 2.76, 5.4, 8.93];
const metal = (baseFreq: number, duration: number, vol: number, at = 0, send = 0.25): void => {
  METAL_RATIOS.forEach((r, i) => {
    tone({
      freq: baseFreq * r * rand(0.995, 1.005),
      duration: duration / (1 + i * 0.7),
      type: "sine",
      vol: vol / (1 + i * 1.2),
      attack: 0.001,
      at,
      send
    });
  });
};

// Sub-bass body: sine with a fast exponential pitch drop.
const thump = (freqStart: number, freqEnd: number, duration: number, vol: number, at = 0, send = 0.1): void => {
  tone({ freq: freqStart, freqEnd, duration, type: "sine", vol, attack: 0.003, at, send });
};

// ---- UI ----

export const sfxClick = (): void => {
  noise({ duration: 0.03, vol: 0.05, filterType: "bandpass", freq: 2600, q: 1.5 });
  tone({ freq: 900, duration: 0.04, type: "sine", vol: 0.035, at: 0.002 });
};

export const sfxHover = (): void => {
  noise({ duration: 0.02, vol: 0.025, filterType: "bandpass", freq: 3400, q: 2 });
};

export const sfxConfirm = (): void => {
  // Warm two-note rise with a detuned double — reads "sealed", not "beep".
  for (const d of [-5, 5]) {
    tone({ freq: 659, duration: 0.11, type: "triangle", vol: 0.04, detune: d, send: 0.2 });
    tone({ freq: 880, duration: 0.16, type: "triangle", vol: 0.038, detune: d, at: 0.075, send: 0.25 });
  }
};

export const sfxCancel = (): void => {
  thump(200, 120, 0.09, 0.06);
  noise({ duration: 0.05, vol: 0.03, freq: 700 });
};

// ---- Movement ----

export const sfxStep = (): void => {
  // Soft footfall, humanized — every step lands at a slightly different
  // pitch and weight so a walk never sounds like a looped sample.
  const p = rand(0.85, 1.15);
  noise({ duration: 0.055, vol: rand(0.03, 0.045), freq: 480 * p, freqEnd: 160 * p });
  thump(120 * p, 70 * p, 0.05, 0.02);
};

// ---- Combat ----

export const sfxAttackHit = (): void => {
  const p = rand(0.94, 1.06);
  // Transient bite → steel ring → body knock → sub weight.
  noise({ duration: 0.03, vol: 0.14, filterType: "highpass", freq: 5200, attack: 0.001 });
  metal(2300 * p, 0.16, 0.05, 0.008);
  tone({ freq: 190 * p, freqEnd: 120 * p, duration: 0.09, type: "triangle", vol: 0.09, at: 0.006 });
  thump(130 * p, 48, 0.13, 0.11, 0.008);
};

export const sfxLensBeam = (): void => {
  // Veya's lens: a glassy charge sweep up into a bright, brief sear.
  // Reads as light, not steel — no metal ring, no body knock.
  const p = rand(0.96, 1.04);
  tone({ freq: 620 * p, freqEnd: 1900 * p, duration: 0.09, type: "sine", vol: 0.05, send: 0.25 });
  tone({ freq: 2400 * p, duration: 0.12, type: "triangle", vol: 0.035, at: 0.085, send: 0.35 });
  noise({ duration: 0.07, vol: 0.05, filterType: "highpass", freq: 6200, attack: 0.002, at: 0.085 });
};

export const sfxAttackMiss = (): void => {
  // A real whoosh: band-passed noise with the FILTER swept down through
  // the swing arc (static hiss never reads as motion).
  const p = rand(0.9, 1.1);
  noise({ duration: 0.16, vol: 0.09, filterType: "bandpass", freq: 2300 * p, freqEnd: 340, q: 1.2, attack: 0.02 });
};

export const sfxCrit = (): void => {
  const p = rand(0.97, 1.03);
  // Everything the hit has, plus a rising zing and a longer, brighter ring.
  noise({ duration: 0.035, vol: 0.2, filterType: "highpass", freq: 4800, attack: 0.001 });
  metal(2800 * p, 0.3, 0.075, 0.008, 0.4);
  tone({ freq: 700, freqEnd: 1500, duration: 0.12, type: "sawtooth", vol: 0.035, at: 0.01, send: 0.3 });
  tone({ freq: 210 * p, freqEnd: 115, duration: 0.1, type: "triangle", vol: 0.11, at: 0.006 });
  thump(150 * p, 42, 0.18, 0.14, 0.008);
};

export const sfxStance = (): void => {
  // Armor set: a low brace-clunk under a short steel shing.
  thump(170, 95, 0.09, 0.07);
  metal(3300, 0.12, 0.028, 0.02);
};

export const sfxDeath = (): void => {
  // A heavy fall, not a downward beep: long sub drop, dark air, a distant
  // ring — with the most reverb of any combat sound so it lingers.
  thump(110, 34, 0.5, 0.14, 0, 0.35);
  noise({ duration: 0.4, vol: 0.07, freq: 900, freqEnd: 120, attack: 0.01, send: 0.3 });
  metal(1600, 0.25, 0.02, 0.05, 0.5);
};

// Ravage trigger — the unit snaps into its berserk turn. A dark riser
// (pitch and filter both opening upward) over a double heartbeat, capped
// with a high tension shimmer. Distinct from every impact sound so the
// player learns the cue instantly.
export const sfxRavage = (): void => {
  tone({ freq: 55, freqEnd: 115, duration: 0.55, type: "sawtooth", vol: 0.09, attack: 0.05, send: 0.3 });
  noise({ duration: 0.55, vol: 0.05, freq: 220, freqEnd: 1900, attack: 0.06, send: 0.3 });
  thump(75, 48, 0.1, 0.12, 0.0);
  thump(75, 48, 0.1, 0.14, 0.16);
  metal(4200, 0.3, 0.02, 0.3, 0.5);
};

// ---- Battle end / rewards ----

export const sfxVictory = (): void => {
  // A little brass fanfare: two detuned-saw stabs, then a held major
  // chord with a shimmer on top. Saw pairs through their own envelopes
  // read "horns", not "square-wave jingle".
  const stab = (freq: number, at: number, dur = 0.16, vol = 0.045): void => {
    for (const d of [-7, 7]) {
      tone({ freq, duration: dur, type: "sawtooth", vol, detune: d, at, send: 0.3 });
    }
  };
  stab(523, 0);          // C5
  stab(698, 0.14);       // F5
  // G4 + C5 + E5 held — the resolve chord.
  for (const [f, v] of [[392, 0.05], [523, 0.045], [659, 0.04]] as const) {
    for (const d of [-6, 6]) {
      tone({ freq: f, duration: 0.55, type: "sawtooth", vol: v, detune: d, at: 0.3, send: 0.4 });
    }
  }
  metal(4200, 0.5, 0.022, 0.34, 0.6);  // shimmer cap
  thump(98, 55, 0.25, 0.1, 0.3);       // timpani under the chord
};

export const sfxDefeat = (): void => {
  // Descending minor line with a darkening filter feel and a final
  // funeral thump. Longer and quieter than victory — loss, not punishment.
  const seq: Array<[number, number]> = [[392, 0], [311, 0.18], [262, 0.36], [196, 0.56]];
  for (const [f, at] of seq) {
    for (const d of [-5, 5]) {
      tone({ freq: f, duration: 0.3, type: "sawtooth", vol: 0.035, detune: d, at, send: 0.35 });
    }
  }
  thump(90, 38, 0.5, 0.1, 0.72, 0.4);
};

// Glass-bell ding for XP awards: fundamental + a stretched partial with
// shimmer decay. Bright and positive without crowding the post-kill audio.
export const sfxXpGain = (): void => {
  tone({ freq: 1046, duration: 0.3, type: "sine", vol: 0.045, send: 0.35 });
  tone({ freq: 1046 * 2.9, duration: 0.18, type: "sine", vol: 0.018, send: 0.35 });
  tone({ freq: 1568, duration: 0.35, type: "sine", vol: 0.04, at: 0.07, send: 0.4 });
};

// Dialogue voice blip — one short syllable-tick of a character's voice.
// Pitch and wave come from the per-character map in ui/voice.ts; a small
// random detune per call keeps a sentence from sounding machine-gun flat.
export const sfxVoiceBlip = (freq: number, type: OscillatorType = "triangle", vol = 0.035): void => {
  tone({ freq: freq * rand(0.94, 1.06), duration: 0.045, type, vol, attack: 0.004 });
};

export const sfxPageTurn = (): void => {
  // Paper: breathy band-passed noise that rises then falls.
  noise({ duration: 0.07, vol: 0.05, filterType: "bandpass", freq: 900, freqEnd: 2800, q: 0.7, attack: 0.015 });
  noise({ duration: 0.09, vol: 0.04, filterType: "bandpass", freq: 2600, freqEnd: 1100, q: 0.7, at: 0.06 });
};

// Resume audio on first user gesture (browser policy).
export const unlockAudio = (): void => {
  audioCtx().resume().catch(() => {});
};

export const installAudioUnlock = (scene: Phaser.Scene): void => {
  const handler = (): void => unlockAudio();
  scene.input.on("pointerdown", handler);
  scene.input.keyboard?.on("keydown", handler);
  scene.events.once("shutdown", () => { scene.input.off("pointerdown", handler); scene.input.keyboard?.off("keydown", handler); });
};

// ---- Finale cut-scenes (scenes/battle/Finale.ts) ----
// The same four families, scored for a closing shot rather than a hit:
// longer tails and more of the room.

// The camera slams in on the last blow: a deep drop with a long air tail.
export const sfxCineBoom = (): void => {
  thump(70, 26, 1.1, 0.2, 0, 0.5);
  thump(140, 40, 0.35, 0.08, 0, 0.3);
  noise({ duration: 1.2, vol: 0.06, freq: 700, freqEnd: 80, attack: 0.01, send: 0.6 });
};

// A great bell, struck once: a low fundamental under bell partials.
export const sfxCineBell = (pitch = 1): void => {
  metal(392 * pitch, 2.4, 0.03, 0, 0.8);
  tone({ freq: 196 * pitch, duration: 2.6, type: "sine", vol: 0.05, attack: 0.005, send: 0.7 });
  tone({ freq: 98 * pitch, duration: 2.2, type: "sine", vol: 0.04, attack: 0.01, send: 0.5 });
};

// A slow rising breath under a reveal: filtered air opening upward.
export const sfxCineRise = (): void => {
  noise({ duration: 2.2, vol: 0.05, freq: 180, freqEnd: 3200, attack: 0.9, send: 0.6 });
  tone({ freq: 110, freqEnd: 220, duration: 2.2, type: "triangle", vol: 0.03, attack: 0.8, send: 0.6 });
};

// One soft glass note — a name appearing in the air.
export const sfxCineChime = (pitch = 1): void => {
  tone({ freq: 880 * pitch, duration: 1.1, type: "sine", vol: 0.03, send: 0.7 });
  tone({ freq: 880 * pitch * 2.01, duration: 0.6, type: "sine", vol: 0.012, send: 0.7 });
};

// Steel set down point-first into stone.
export const sfxCineClang = (): void => {
  metal(1300, 1.4, 0.05, 0, 0.7);
  thump(160, 70, 0.25, 0.1, 0, 0.3);
  noise({ duration: 0.25, vol: 0.05, freq: 2600, freqEnd: 600, attack: 0.002, send: 0.4 });
};

// A distant battery: a far thud, then the shell's whistle.
export const sfxCineCannon = (): void => {
  thump(90, 40, 0.5, 0.1, 0, 0.6);
  noise({ duration: 0.5, vol: 0.04, freq: 400, freqEnd: 90, attack: 0.005, send: 0.6 });
  tone({ freq: 2400, freqEnd: 700, duration: 0.7, type: "sine", vol: 0.012, at: 0.12, send: 0.5 });
};

export interface SfxOptions { level?: number; resident?: string; frequency?: number; type?: OscillatorType }
const crowd = (duration: number, vol: number, freq: number, pulses = 4): void => {
  for (let i = 0; i < pulses; i++) noise({ duration: duration / 2, vol, freq, freqEnd: freq * 0.7,
    filterType: 'bandpass', q: 0.6, attack: duration / 12, at: i * duration / pulses, send: 0.15 });
};
const effects = {
  click: sfxClick, hover: sfxHover, confirm: sfxConfirm, cancel: sfxCancel, page_turn: sfxPageTurn,
  // A new whole heart (§9.11.2): two soft glass notes, a fifth apart, rising.
  heart_chime: () => {
    tone({ freq: 1318.5, duration: 0.55, vol: 0.022, send: 0.6 });
    tone({ freq: 1975.5, duration: 0.9, vol: 0.02, at: 0.12, send: 0.7 });
    tone({ freq: 3951, duration: 0.5, vol: 0.004, at: 0.12, send: 0.7 });
  },
  typewriter_tick: () => noise({ duration: 0.018, vol: 0.025, freq: 1700 }),
  voice_blip: (opts: SfxOptions = {}) => {
    let hash = 0; for (const c of opts.resident ?? 'narrator') hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
    sfxVoiceBlip(opts.frequency ?? 150 + hash % 190, opts.type ?? 'triangle');
  },
  footstep_cobble: sfxStep,
  footstep_boards: () => { thump(180, 95, 0.09, 0.04); noise({ duration: 0.05, vol: 0.035, freq: 1000 }); },
  footstep_grass: () => noise({ duration: 0.1, vol: 0.045, freq: 1600, freqEnd: 600 }),
  door_open: () => { tone({ freq: 220, freqEnd: 330, duration: 0.3, type: 'triangle', vol: 0.025 }); sfxClick(); },
  door_close: () => thump(160, 55, 0.18, 0.09),
  door_bang: () => { thump(200, 45, 0.3, 0.14); noise({ duration: 0.13, vol: 0.1, freq: 1200 }); },
  gull_cry: () => { tone({ freq: 950, freqEnd: 1600, duration: 0.16, vol: 0.025 }); tone({ freq: 1600, freqEnd: 750, duration: 0.4, vol: 0.03, at: 0.15 }); },
  waves: () => noise({ duration: 3, vol: 0.08, freq: 850, freqEnd: 300, attack: 1.2 }),
  coin: () => metal(1600, 0.3, 0.025), paper_rustle: sfxPageTurn,
  stamp_thud: () => thump(220, 75, 0.1, 0.08), bell: () => metal(523.25, 1.8, 0.045),
  clock_tick: () => { noise({ duration: 0.025, vol: 0.04, freq: 2000 }); tone({ freq: 1100, duration: 0.025, vol: 0.025 }); },
  clock_chime: (opts: SfxOptions = {}) => [60, 64, 69, 67, 62, 60].forEach((midi, i) => metal(440 * 2 ** ((midi - 69) / 12), 1.8, 0.045 * Math.max(0, Math.min(1, opts.level ?? 1)), i * 0.45)),
  splash: () => noise({ duration: 0.5, vol: 0.1, freq: 3600, freqEnd: 400, attack: 0.015 }),
  crate_scrape: () => noise({ duration: 0.65, vol: 0.07, freq: 600, freqEnd: 1400, filterType: 'bandpass' }),
  brakes_squeal: () => { tone({ freq: 2100, freqEnd: 900, duration: 0.7, vol: 0.025, type: 'triangle', attack: 0.1 }); noise({ duration: 0.7, vol: 0.035, freq: 2800, filterType: 'bandpass' }); },
  train_horn: () => [174.6, 220, 261.6].forEach(freq => tone({ freq, duration: 1.8, vol: 0.018, type: 'triangle', attack: 0.3, send: 0.4 })),
  air_hiss: () => noise({ duration: 0.8, vol: 0.045, freq: 4000, filterType: 'highpass', attack: 0.08 }),
  cough: () => [0, 0.18].forEach(at => noise({ duration: 0.14, vol: 0.05, freq: 430, filterType: 'bandpass', at })),
  pan_clang: () => metal(480, 0.65, 0.07), broom_swish: sfxAttackMiss,
  umbrella_pop: () => { thump(330, 90, 0.1, 0.07); noise({ duration: 0.1, vol: 0.08, freq: 2200 }); },
  slingshot_ping: () => tone({ freq: 1100, freqEnd: 2400, duration: 0.15, vol: 0.045 }),
  winded_thump: () => { thump(130, 45, 0.22, 0.08); noise({ duration: 0.2, vol: 0.045, freq: 500 }); },
  murmur: () => crowd(2, 0.035, 450), applause_polite: () => crowd(1.2, 0.04, 1600, 8),
  applause_warm: () => crowd(2, 0.065, 1900, 12), applause_mixed: () => { crowd(1.5, 0.04, 1500, 7); crowd(1.8, 0.025, 450, 3); },
  applause_thin: () => crowd(0.8, 0.025, 1800, 3), cheer_small: () => crowd(1.2, 0.05, 900),
  cheer_big: () => crowd(2.2, 0.08, 1100, 6), laughter: () => crowd(1, 0.05, 750, 7),
  roar: () => crowd(2.5, 0.08, 550, 8), fair_cheer: () => crowd(2.4, 0.075, 1400, 9)
} satisfies Record<string, (opts?: SfxOptions) => void>;
export type SfxKey = keyof typeof effects;
export const SFX_KEYS = Object.keys(effects) as SfxKey[];
export function playSfx(key: SfxKey, opts?: SfxOptions): void {
  if (typeof window === 'undefined') return;
  effects[key](opts);
}
