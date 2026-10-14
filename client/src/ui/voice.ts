import { sfxVoiceBlip } from "../audio/Sfx";

// Per-character dialogue voices — the pitched blip that plays while a
// character's text types out. One entry per PortraitId; the pitch IS the
// voice: Ning sits high and quick, Archbold low and square, the narrator
// a soft murmur under the prose. Characters without an entry (stand-in
// officers, one-off speakers) get the default register.
//
// Wave choice is characterization too: triangle reads warm/rounded,
// square reads hard/authoritative. Volumes stay low — the blip is
// texture under reading, never a sound the player should notice as such.

interface VoiceProfile {
  freq: number;
  type: OscillatorType;
  vol: number;
}

const DEFAULT_VOICE: VoiceProfile = { freq: 235, type: "triangle", vol: 0.034 };

const VOICES: Record<string, VoiceProfile> = {
  amar:     { freq: 205, type: "triangle", vol: 0.036 },
  lucian:   { freq: 150, type: "triangle", vol: 0.036 },
  ning:     { freq: 330, type: "triangle", vol: 0.032 },
  maya:     { freq: 255, type: "triangle", vol: 0.034 },
  leo:      { freq: 305, type: "triangle", vol: 0.034 },
  kian:     { freq: 185, type: "square",   vol: 0.028 },
  ranatoli: { freq: 165, type: "triangle", vol: 0.036 },
  selene:   { freq: 275, type: "triangle", vol: 0.033 },
  // Veya: lower-mid register with the square's slight machine-shop edge —
  // a craftswoman's voice, distinct from the square-wave men (kian 185,
  // ndari 175) by sitting a fair way above them.
  veya:     { freq: 225, type: "square",   vol: 0.029 },
  // Corin: a soldier's baritone — triangle warmth (he is not a villain
  // register) sitting between Ranatoli (165) and Kian (185).
  corin:    { freq: 195, type: "triangle", vol: 0.032 },
  ndari:    { freq: 175, type: "square",   vol: 0.028 },
  ndara:    { freq: 245, type: "triangle", vol: 0.034 },
  nebu:     { freq: 145, type: "square",   vol: 0.028 },
  dawn:     { freq: 235, type: "triangle", vol: 0.034 },
  fergus:   { freq: 170, type: "triangle", vol: 0.034 },
  khione:   { freq: 205, type: "triangle", vol: 0.033 },
  mira:     { freq: 380, type: "triangle", vol: 0.030 },
  tali:     { freq: 360, type: "triangle", vol: 0.030 },
  rose:     { freq: 315, type: "triangle", vol: 0.033 },
  coyne:    { freq: 190, type: "triangle", vol: 0.033 },
  royal_guard: { freq: 160, type: "square", vol: 0.027 },
  // The narrator murmurs — low, soft, half the presence of a character.
  narrator: { freq: 118, type: "triangle", vol: 0.018 }
};

// Fire one blip of a character's voice. Callers decide cadence (the
// typewriter fires on every other letter-character).
export const speakBlip = (portraitId?: string): void => {
  const v = (portraitId && VOICES[portraitId]) || DEFAULT_VOICE;
  sfxVoiceBlip(v.freq, v.type, v.vol);
};
