import { getAudioSettings, subscribeAudioSettings } from './audioSettings';
import { TRACK_KEYS, resolveMusicCue, trackFiles, type TrackFile, type TrackKey } from './musicTracks';
import { generateNoteSchedule, placeholderDuration, schedulePlaceholderNote } from './placeholderMusic';
export type MusicSource = 'file' | 'placeholder';
interface Voice { bus: GainNode; nodes: Set<AudioScheduledSourceNode>; tick: (until: number) => void; retireAt: number }
/** Reject HTML SPA fallbacks, and retry servers which do not implement HEAD. */
export async function probeMusicFile(url: string, signal?: AbortSignal): Promise<boolean> {
  const valid = (r: Response) => r.ok && !/text\/html/i.test(r.headers.get('content-type') ?? '');
  try {
    const head = await fetch(url, { method: 'HEAD', signal });
    if (valid(head)) return true;
  } catch { /* try a small GET */ }
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
    const exists = valid(response);
    await response.body?.cancel();
    return exists;
  } catch { return false; }
}
export class MusicManager {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private voices: Voice[] = [];
  private active: Voice | null = null;
  private request = 0;
  private disposed = false;
  private ducked = false;
  private unlocked = false;
  private timer: ReturnType<typeof setInterval>;
  private abort = new AbortController();
  /** Per file: does it exist? Probed once at startup for every take of every track. */
  private availability = new Map<string, Promise<boolean>>();
  private buffers = new Map<string, AudioBuffer>();
  /** Which take each track played last, so alternate takes rotate. */
  private takes = new Map<TrackKey, number>();
  private unsubscribe: () => void;
  currentTrack: TrackKey | null = null;
  source: MusicSource | null = null;
  constructor() {
    for (const track of TRACK_KEYS) for (const take of trackFiles(track)) this.availability.set(take.file, probeMusicFile(this.url(take.file), this.abort.signal));
    document.addEventListener('pointerdown', this.unlock);
    document.addEventListener('keydown', this.unlock);
    document.addEventListener('visibilitychange', this.visibility);
    this.unsubscribe = subscribeAudioSettings(() => this.updateVolume());
    this.timer = setInterval(() => this.tick(), 100);
  }
  private url(file: string): string { return `${import.meta.env.BASE_URL}audio/music/${file}`; }
  /** The next take of a track that exists (rotating through alternates), or null for the placeholder. */
  private async pickTake(track: TrackKey): Promise<TrackFile | null> {
    const files = trackFiles(track);
    const present: TrackFile[] = [];
    for (const take of files) if (await this.availability.get(take.file)) present.push(take);
    if (!present.length) return null;
    const next = ((this.takes.get(track) ?? -1) + 1) % present.length;
    this.takes.set(track, next);
    return present[next]!;
  }
  private unlock = (): void => {
    if (this.disposed || document.hidden) return;
    this.context ??= new AudioContext();
    if (!this.output) { this.output = this.context.createGain(); this.output.connect(this.context.destination); this.updateVolume(); }
    void this.context.resume().then(() => {
      if (this.disposed) return;
      if (document.hidden) { void this.context?.suspend(); return; }
      if (!this.unlocked) { this.unlocked = true; if (this.currentTrack) void this.start(this.currentTrack, this.fadeSeconds, this.request); }
    }).catch(() => { /* next gesture retries */ });
  };
  private visibility = (): void => {
    if (!this.context) return;
    if (document.hidden) void this.context.suspend().catch(() => {});
    else if (this.unlocked) void this.context.resume().catch(() => {});
  };
  private updateVolume(): void {
    if (!this.context || !this.output) return;
    const s = getAudioSettings();
    this.output.gain.setTargetAtTime(s.mute ? 0 : s.master * s.music * (this.ducked ? 0.4 : 1), this.context.currentTime, 0.08);
  }
  duck(on: boolean): void { this.ducked = on; this.updateVolume(); }
  private fadeSeconds = 1.5;
  play(cue: string, options: { fadeMs?: number } = {}): void {
    const track = resolveMusicCue(cue);
    if (track === this.currentTrack) return;
    this.currentTrack = track; this.source = null;
    this.fadeSeconds = Number.isFinite(options.fadeMs) ? Math.max(0, options.fadeMs! / 1000) : 1.5;
    const request = ++this.request;
    if (this.unlocked) void this.start(track, this.fadeSeconds, request);
  }
  private async start(track: TrackKey, fade: number, request: number): Promise<void> {
    const ctx = this.context!;
    const take = await this.pickTake(track);
    let buffer = take ? this.buffers.get(take.file) : undefined;
    if (take && !buffer) {
      try {
        const response = await fetch(this.url(take.file), { signal: this.abort.signal });
        if (!response.ok) throw new Error('Music fetch failed');
        buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(take.file, buffer);
      } catch { /* Missing, invalid or unsupported file: use the placeholder. */ }
    }
    if (this.disposed || request !== this.request) return;
    const now = ctx.currentTime, bus = ctx.createGain();
    bus.connect(this.output!); bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(buffer && take ? take.gain : 1, now + fade);
    if (this.active) this.retire(this.active, fade);
    const voice: Voice = { bus, nodes: new Set(), tick: () => {}, retireAt: Infinity };
    const trackNode = (node: AudioScheduledSourceNode) => {
      voice.nodes.add(node);
      node.addEventListener('ended', () => { voice.nodes.delete(node); node.disconnect(); });
    };
    if (buffer && buffer.duration > 0) {
      const audio = buffer, overlap = Math.min(1.5, audio.duration / 4);
      let next = now;
      voice.tick = until => {
        while (next < until) {
          const source = ctx.createBufferSource(), envelope = ctx.createGain();
          source.buffer = audio; source.connect(envelope); envelope.connect(bus);
          envelope.gain.setValueAtTime(0, next);
          envelope.gain.linearRampToValueAtTime(1, next + overlap);
          envelope.gain.setValueAtTime(1, next + audio.duration - overlap);
          envelope.gain.linearRampToValueAtTime(0, next + audio.duration);
          source.addEventListener('ended', () => envelope.disconnect());
          trackNode(source); source.start(next); next += audio.duration - overlap;
        }
      };
      this.source = 'file';
    } else {
      const notes = generateNoteSchedule(42, track), duration = placeholderDuration(track);
      let origin = now, index = 0;
      voice.tick = until => {
        while (origin + notes[index]!.time < until) {
          const note = notes[index]!;
          if (origin + note.time >= ctx.currentTime - 0.05) trackNode(schedulePlaceholderNote(ctx, bus, track, note, Math.max(ctx.currentTime, origin + note.time)));
          if (++index === notes.length) { index = 0; origin += duration; }
        }
      };
      this.source = 'placeholder';
    }
    this.active = voice; this.voices.push(voice); this.tick();
  }
  private retire(voice: Voice, fade: number): void {
    const now = this.context!.currentTime;
    voice.bus.gain.cancelAndHoldAtTime(now);
    voice.bus.gain.linearRampToValueAtTime(0, now + fade);
    voice.retireAt = now + fade;
  }
  private tick(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    this.voices = this.voices.filter(voice => {
      if (ctx.currentTime >= voice.retireAt) { this.destroyVoice(voice); return false; }
      voice.tick(Math.min(ctx.currentTime + 0.35, voice.retireAt)); return true;
    });
  }
  private destroyVoice(voice: Voice): void {
    voice.nodes.forEach(node => { try { node.stop(); } catch { /* already ended */ } });
    voice.bus.disconnect();
  }
  stop(fadeMs = 500): void {
    ++this.request; this.currentTrack = null; this.source = null;
    if (this.active) this.retire(this.active, Math.max(0, fadeMs / 1000));
    this.active = null;
  }
  dispose(): void {
    this.disposed = true; ++this.request; this.abort.abort(); clearInterval(this.timer); this.unsubscribe();
    document.removeEventListener('pointerdown', this.unlock); document.removeEventListener('keydown', this.unlock);
    document.removeEventListener('visibilitychange', this.visibility);
    this.voices.forEach(voice => this.destroyVoice(voice)); this.voices = [];
    void this.context?.close().catch(() => {});
  }
}
