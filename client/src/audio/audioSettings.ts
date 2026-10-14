export interface AudioSettings { master: number; music: number; sfx: number; mute: boolean }
const STORAGE_KEY = 'monde:audio';
const defaults: AudioSettings = { master: 1, music: 1, sfx: 1, mute: false };
const clamp = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
function sanitize(value: Partial<AudioSettings>, base: AudioSettings): AudioSettings {
  return { master: clamp(value.master, base.master), music: clamp(value.music, base.music),
    sfx: clamp(value.sfx, base.sfx), mute: typeof value.mute === 'boolean' ? value.mute : base.mute };
}
let settings = { ...defaults };
try { settings = sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {}, defaults); } catch { /* unavailable storage */ }
const listeners = new Set<(settings: AudioSettings) => void>();
export const getAudioSettings = (): AudioSettings => ({ ...settings });
export function setAudioSettings(patch: Partial<AudioSettings>): void {
  settings = sanitize(patch, settings);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private mode / quota */ }
  listeners.forEach(listener => listener(getAudioSettings()));
}
export function subscribeAudioSettings(listener: (settings: AudioSettings) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
