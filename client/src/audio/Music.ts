import Phaser from "phaser";

// The Phaser-free music constants live in musicKeys.ts so static content
// (battles.ts, story/beats.ts) can reference track keys without transitively
// importing Phaser. Re-exported here so every existing `from "../audio/Music"`
// import — MUSIC, MUSIC_FILES, MusicKey — keeps resolving unchanged.
import { MUSIC, MUSIC_FILES, type MusicKey } from "./musicKeys";
export { MUSIC, MUSIC_FILES };
export type { MusicKey };

// Singleton-ish music manager. Lives across scenes via game.registry.
// Tweens require a Scene context, so we re-bind to the latest scene on each
// getMusic() call (see bottom of file).
export class MusicManager {
  private scene: Phaser.Scene;
  private current: Phaser.Sound.BaseSound | null = null;
  private currentKey: MusicKey | null = null;
  private targetVolume = 0.55;
  // Deferred playback for the streaming boot: if a scene asks for a
  // track that hasn't finished background-loading yet (AssetStreamScene
  // pulls the ~60MB music tail in behind the title screen), remember the
  // request and start it the moment the file lands. Only the LATEST
  // request is kept — scenes overwrite each other's pending intent the
  // same way play() calls overwrite live tracks.
  private pendingPlay: { key: MusicKey; opts: { loop?: boolean; fadeMs?: number } } | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  bindScene(scene: Phaser.Scene): void {
    this.scene = scene;
  }

  setVolume(v: number): void {
    this.targetVolume = Phaser.Math.Clamp(v, 0, 1);
    if (this.current && "setVolume" in this.current) {
      (this.current as Phaser.Sound.WebAudioSound).setVolume(this.targetVolume);
    }
  }

  isPlaying(key: MusicKey): boolean {
    return this.currentKey === key && !!this.current && this.current.isPlaying;
  }

  // Force-destroy a sound. Safe to call repeatedly. Survives scene shutdown
  // because it doesn't rely on the bound scene's tween manager.
  private retireSound(s: Phaser.Sound.BaseSound, fadeMs: number): void {
    // Tween fade for smoothness — may die if the bound scene shuts down.
    try {
      this.scene.tweens.addCounter({
        from: this.targetVolume,
        to: 0,
        duration: fadeMs,
        onUpdate: (t: Phaser.Tweens.Tween) => {
          try {
            if ("setVolume" in s) (s as Phaser.Sound.WebAudioSound).setVolume(t.getValue() ?? 0);
          } catch { /* sound already destroyed */ }
        }
      });
    } catch { /* scene without tweens */ }
    // setTimeout backup — runs even if the scene is gone. Each step in its own
    // try/catch so a thrown stop() can't skip destroy() and leak a looped sound.
    setTimeout(() => {
      try { if ("setVolume" in s) (s as Phaser.Sound.WebAudioSound).setVolume(0); } catch { /* */ }
      try { s.stop(); } catch { /* */ }
      try { s.destroy(); } catch { /* */ }
    }, fadeMs + 120);
  }

  // Belt-and-suspenders: stop any music-key sound still running in Phaser's
  // global sound manager that isn't the one we're about to keep.
  private killOrphans(keep: Phaser.Sound.BaseSound | null): void {
    const mgr = this.scene.sound as unknown as { sounds?: Phaser.Sound.BaseSound[] };
    const list = mgr.sounds;
    if (!list) return; // NoAudioSoundManager — nothing to sweep.
    const musicKeys = new Set<string>(Object.values(MUSIC));
    for (const s of [...list]) {
      if (s === keep) continue;
      if (!musicKeys.has(s.key)) continue;
      try { s.stop(); } catch { /* */ }
      try { s.destroy(); } catch { /* */ }
    }
  }

  // Called by AssetStreamScene when a background-loaded track arrives.
  onTrackLoaded(key: MusicKey): void {
    if (this.pendingPlay && this.pendingPlay.key === key) {
      const p = this.pendingPlay;
      this.pendingPlay = null;
      this.play(p.key, p.opts);
    }
  }

  play(key: MusicKey, opts: { loop?: boolean; fadeMs?: number } = {}): void {
    // Not loaded yet (streaming boot) — hold the request; onTrackLoaded
    // starts it when the file lands. Clears any older pending intent.
    if (!this.scene.cache.audio.exists(key)) {
      this.pendingPlay = { key, opts };
      return;
    }
    this.pendingPlay = null;
    const { loop = true, fadeMs = 700 } = opts;

    // Ensure the WebAudio context is running BEFORE the same-key check
    // below. A scene transition can leave the context in "suspended" for
    // a few ms — during that window an existing sound's isPlaying flag
    // can lie (still true while actual audio is silent). Resuming here
    // first means the same-key short-circuit sees an honest state.
    const sm = this.scene.sound as unknown as { context?: AudioContext };
    if (sm.context && sm.context.state === "suspended") {
      void sm.context.resume();
    }

    // ---- Same-track continuity ----
    //
    // Load-bearing for seamless cross-scene audio. When two consecutive
    // scenes call play() with the same MusicKey, we DON'T restart the
    // track — the player should experience uninterrupted audio across
    // the transition. Examples this protects:
    //   * Two chained StoryScene arcs that share arc.music (e.g., a
    //     pre/post pair both using "danger")
    //   * Camp → BattlePrep → Battle when consecutive scenes happen
    //     to share a cue
    //   * Same battle re-loaded after a Try Again that didn't change
    //     the music underneath
    //
    // Three states the existing sound might be in:
    //   isPlaying           → no-op, just snap volume to target in case
    //                         a previous fade was interrupted
    //   isPaused            → resume() and return (Phaser can pause
    //                         sounds briefly on some scene transitions)
    //   neither / destroyed → stale reference; fall through to a fresh
    //                         play with the normal fade-in
    if (this.currentKey === key && this.current) {
      const s = this.current as Phaser.Sound.WebAudioSound;
      if (s.isPlaying) {
        // Snap volume so a half-finished prior fade doesn't leave the
        // track stuck quiet across the seam.
        if ("setVolume" in s) s.setVolume(this.targetVolume);
        return;
      }
      if (s.isPaused) {
        try { s.resume(); } catch { /* fall through to fresh play */ }
        if (s.isPlaying) {
          if ("setVolume" in s) s.setVolume(this.targetVolume);
          return;
        }
      }
      // Sound exists but isn't playing or paused — stale ref, fall
      // through. The retire below will clean it up before fresh play.
    }

    // Retire the tracked sound first so a play() failure below can't strand it.
    if (this.current) this.retireSound(this.current, fadeMs);

    const sound = this.scene.sound.add(key, { loop, volume: 0 });
    try { sound.play(); } catch { /* autoplay blocked — track anyway */ }
    // Sweep any orphaned music sounds we may have lost track of (e.g. across
    // scene transitions where a prior retire never completed).
    this.killOrphans(sound);
    this.scene.tweens.addCounter({
      from: 0,
      to: this.targetVolume,
      duration: fadeMs,
      onUpdate: (t: Phaser.Tweens.Tween) => {
        // Guarded like retireSound's fade: a quick second play() retires and
        // destroys this sound while its fade-in may still be running, and a
        // throw inside a tween stops the game loop dead.
        try {
          if ("setVolume" in sound) (sound as Phaser.Sound.WebAudioSound).setVolume(t.getValue() ?? 0);
        } catch { /* sound already destroyed */ }
      }
    });
    this.current = sound;
    this.currentKey = key;

    // Retry-on-unlock: if context.resume() raced with play() and the sound
    // is still not playing 250ms in, force a second play() attempt now that
    // the context should be running. Most of the time this is a no-op (the
    // first play already worked); when it fires, it salvages the silent-arc
    // bug instead of leaving the player in eerie quiet.
    setTimeout(() => {
      if (this.current === sound && !sound.isPlaying) {
        try { sound.play(); } catch { /* */ }
        if (import.meta.env.DEV && !sound.isPlaying) {
           
          console.warn(`[MusicManager] Track "${key}" failed to start. AudioContext state: ${sm.context?.state ?? "n/a"}`);
        }
      }
    }, 250);
  }

  stop(fadeMs = 500): void {
    // An explicit stop also cancels any not-yet-loaded pending request —
    // a deferred track must never start AFTER the scene asked for silence.
    this.pendingPlay = null;
    const old = this.current;
    this.current = null;
    this.currentKey = null;
    if (old) this.retireSound(old, fadeMs);
    // Sweep any orphan music sounds the manager may have lost track of.
    this.killOrphans(null);
  }
}

const REGISTRY_KEY = "ravage:music";

export const getMusic = (scene: Phaser.Scene): MusicManager => {
  let m = scene.game.registry.get(REGISTRY_KEY) as MusicManager | undefined;
  if (!m) {
    m = new MusicManager(scene);
    scene.game.registry.set(REGISTRY_KEY, m);
  } else {
    m.bindScene(scene);
  }
  return m;
};
