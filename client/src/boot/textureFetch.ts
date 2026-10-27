// Textures fetched outside a scene's preload: the other boards' town sprites in idle time (world/boardAssets.ts
// prefetchOrder) and the residents' portrait sheets as a conversation nears. One hidden scene's loader does it for the
// whole game (its scene keeps running, so the loader keeps ticking), a few files at a time and most wanted first
// (fetchQueue.ts). While a zone loads its own board (hold()) the idle fetches wait. A zone that needs a file this
// fetcher already has on the wire waits for it (await()) instead of fetching it twice; one it has only queued, the
// zone fetches itself (claim()).
import Phaser from 'phaser';
import { FetchQueue, type FetchPriority } from './fetchQueue';

export interface TextureSpec {
  key: string;
  url: string;
  /** A sprite sheet's frame size (portraits); a plain image without. */
  frame?: { frameWidth: number; frameHeight: number };
}

export const FETCH_SCENE = 'Fetch';
/** Files on the wire at once: keeps a fast link busy, and leaves most of a slow one to a zone's own load. */
const PARALLEL = 4;

class FetchScene extends Phaser.Scene {
  constructor() { super({ key: FETCH_SCENE }); }
  // Starting a scene makes it visible; this one has nothing to draw.
  init(): void { this.sys.setVisible(false); }
}

class TextureFetcher {
  private readonly queue = new FetchQueue<TextureSpec>();
  private readonly waits = new Map<string, { promise: Promise<boolean>; resolve: (ok: boolean) => void }>();
  private readonly onWire = new Set<string>();
  private holds = 0;

  constructor(private readonly scene: Phaser.Scene) {
    const load = scene.load;
    load.maxParallelDownloads = PARALLEL;
    const done = (key: string, ok: boolean) => {
      if (!this.onWire.delete(key)) return;
      this.settle(key, ok);
      this.pump();
    };
    load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => done(key, true));
    load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => done(file.key, false));
    // A file that downloaded but wouldn't decode sends neither event: whatever is still on the wire at the end is over.
    load.on(Phaser.Loader.Events.COMPLETE, () => {
      for (const key of [...this.onWire]) { this.onWire.delete(key); this.settle(key, scene.textures.exists(key)); }
      this.pump();
    });
  }

  /** Fetch a texture (already there: at once). Resolves false if it failed; never rejects. */
  fetch(spec: TextureSpec, priority: FetchPriority): Promise<boolean> {
    if (this.scene.textures.exists(spec.key)) return Promise.resolve(true);
    const wait = this.wait(spec.key);
    if (!this.onWire.has(spec.key)) this.queue.push(spec, priority);
    this.pump();
    return wait;
  }

  /** Fetch these in idle time, in this order, in place of whatever idle list there was. */
  prefetch(specs: readonly TextureSpec[]): void {
    this.queue.clear('idle');
    for (const spec of specs) if (!this.onWire.has(spec.key) && !this.scene.textures.exists(spec.key)) this.queue.push(spec, 'idle');
    this.pump();
  }

  /** The files a scene's preload is about to load: in flight here → their promise to wait on; queued here → dropped. */
  claim(keys: readonly string[]): Map<string, Promise<boolean>> {
    const flying = new Map<string, Promise<boolean>>();
    for (const key of keys) {
      if (this.onWire.has(key)) flying.set(key, this.wait(key));
      else if (this.queue.remove(key) && this.waits.has(key)) {
        // The scene loads it now; whoever else is waiting hears when the texture lands.
        this.scene.textures.once(`${Phaser.Textures.Events.ADD_KEY}${key}`, () => this.settle(key, true));
      }
    }
    return flying;
  }

  /** Keep idle fetches off the wire until the returned release is called (a zone's own load). */
  hold(): () => void {
    this.holds++;
    let released = false;
    return () => { if (!released) { released = true; this.holds--; this.pump(); } };
  }

  private wait(key: string): Promise<boolean> {
    let entry = this.waits.get(key);
    if (!entry) {
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>(r => { resolve = r; });
      entry = { promise, resolve };
      this.waits.set(key, entry);
    }
    return entry.promise;
  }

  private settle(key: string, ok: boolean): void {
    this.waits.get(key)?.resolve(ok);
    this.waits.delete(key);
  }

  private pump(): void {
    const load = this.scene.load;
    const next = this.queue.take(PARALLEL - this.onWire.size, this.holds === 0);
    for (const spec of next) {
      if (this.scene.textures.exists(spec.key)) { this.settle(spec.key, true); continue; }
      this.onWire.add(spec.key);
      if (spec.frame) load.spritesheet(spec.key, spec.url, spec.frame);
      else load.image(spec.key, spec.url);
    }
    if (this.onWire.size && !load.isLoading()) load.start();
  }
}

let fetcher: TextureFetcher | null = null;

/** Add the fetcher's hidden scene to the game (main.ts, before the game boots). */
export function installTextureFetch(game: Phaser.Game): void {
  game.scene.add(FETCH_SCENE, FetchScene, true);
}

/** The game's fetcher (after boot). */
export function textureFetch(scene: Phaser.Scene): TextureFetcher {
  fetcher ??= new TextureFetcher(scene.scene.get(FETCH_SCENE));
  return fetcher;
}

/**
 * A loader entry that completes when another load does (the fetcher's): the scene's preload waits for a file already
 * on the wire, and the loading screen counts it, without a second request. Made on first use, not at import, so code
 * that imports this module runs against a stubbed Phaser in tests.
 */
let AwaitFile: (new (loader: Phaser.Loader.LoaderPlugin, key: string, until: Promise<unknown>) => Phaser.Loader.File) | null = null;
function awaitFile(loader: Phaser.Loader.LoaderPlugin, key: string, until: Promise<unknown>): Phaser.Loader.File {
  AwaitFile ??= class extends Phaser.Loader.File {
    constructor(loader: Phaser.Loader.LoaderPlugin, key: string, private readonly until: Promise<unknown>) {
      super(loader, { type: 'await', key, url: key });
    }

    override load(): void {
      this.state = Phaser.Loader.FILE_LOADING;
      // Done either way: a failed fetch has already said so, and the scene draws without the texture as before. Not if
      // the scene restarted meanwhile (its loader was reset): that load is over.
      const loader = this.loader;
      void this.until.finally(() => { if (loader.inflight.contains(this)) loader.nextFile(this, true); });
    }
  };
  return new AwaitFile(loader, key, until);
}

/**
 * Queue a texture on a scene's preload unless it's there already: a file the fetcher has on the wire is waited for,
 * anything else is loaded by the scene itself.
 */
export function preloadTexture(scene: Phaser.Scene, spec: TextureSpec, flying: ReadonlyMap<string, Promise<boolean>>): void {
  if (scene.textures.exists(spec.key)) return;
  const wait = flying.get(spec.key);
  if (wait) scene.load.addFile(awaitFile(scene.load, spec.key, wait));
  else if (spec.frame) scene.load.spritesheet(spec.key, spec.url, spec.frame);
  else scene.load.image(spec.key, spec.url);
}
