import { findLoopRegion } from './loopRegion';
import { AMBIENCE, type Bed } from './ambienceDirector';
import { getAudioSettings, subscribeAudioSettings } from './audioSettings';
import { probeMusicFile } from './MusicManager';
interface Voice { source: AudioBufferSourceNode; gain: GainNode; target: number; retireAt: number }
/** Shares the music context/output: music slider, mute, visibility and dialogue ducking apply identically. */
export class AmbienceManager {
  private wanted: Partial<Record<Bed, number>> = {};
  private voices = new Map<Bed, Voice>();
  private pending = new Set<Bed>();
  private buffers = new Map<Bed, AudioBuffer | null>();
  private abort = new AbortController();
  private disposed = false;
  private unsubscribe: () => void;
  constructor(private ctx: AudioContext, private output: GainNode) {
    this.unsubscribe = subscribeAudioSettings(() => this.mix(this.wanted));
  }
  mix(wanted: Partial<Record<Bed, number>>): void {
    this.wanted = wanted;
    for (const [bed, voice] of this.voices) {
      // GDD-GAP: 1 second time constant, ~3 second crossfade. SFX slider also controls ambience.
      const gain = (wanted[bed] ?? 0) * getAudioSettings().sfx;
      if (gain !== voice.target) {
        voice.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 1);
        voice.target = gain;
      }
      if (wanted[bed]) voice.retireAt = Infinity;
      else if (voice.retireAt === Infinity) voice.retireAt = this.ctx.currentTime + 8;
      // Release silent sources after eight time constants; do not accumulate loops across district changes.
      if (this.ctx.currentTime >= voice.retireAt) {
        voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect(); this.voices.delete(bed);
      }
    }
    for (const bed of Object.keys(wanted) as Bed[]) {
      if (wanted[bed]! > 0 && !this.voices.has(bed) && !this.pending.has(bed) && this.buffers.get(bed) !== null) void this.start(bed);
    }
  }
  private async start(bed: Bed): Promise<void> {
    this.pending.add(bed);
    try {
      let buffer = this.buffers.get(bed);
      if (!buffer) {
        const url = `${import.meta.env.BASE_URL}audio/ambience/${AMBIENCE[bed]}`;
        if (!await probeMusicFile(url, this.abort.signal)) { this.buffers.set(bed, null); return; }
        const response = await fetch(url, { signal: this.abort.signal });
        if (!response.ok) throw new Error('unavailable');
        buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(bed, buffer);
      }
      if (this.disposed || !this.wanted[bed]) return;
      const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      source.buffer = buffer; source.loop = true; source.connect(gain); gain.connect(this.output);
      const region = findLoopRegion(
        Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate);
      source.loopStart = region.start; source.loopEnd = region.end;
      gain.gain.value = 0; source.start(0, region.start);
      const target = this.wanted[bed]! * getAudioSettings().sfx;
      this.voices.set(bed, { source, gain, target, retireAt: Infinity });
      gain.gain.setTargetAtTime(target, this.ctx.currentTime, 1);
    } catch { this.buffers.set(bed, null); } finally { this.pending.delete(bed); }
  }
  dispose(): void {
    this.disposed = true; this.abort.abort(); this.unsubscribe();
    for (const { source, gain } of this.voices.values()) { source.stop(); source.disconnect(); gain.disconnect(); }
    this.voices.clear(); this.buffers.clear();
  }
}
