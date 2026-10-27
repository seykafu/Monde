// One game's story: the director, its flags, the ledger and the StoryHost that joins them to the world.
// Pure (no Phaser): scenes/story/attach.ts supplies the StoryWorld, StoryScene binds itself as the presenter.
import type { CompiledScene, SceneHeader } from '@monde/shared';
import { StoryDirector, type StorySave } from './director';
import { FlagStore, type StoryDiagnostics } from './flags';
import {
  buildStoryContext, createStoryHandlers, decodeStory, emptyLedger, encodeStory, summonText,
  type StoryLedger, type StoryPresenter, type StoryWorld
} from './host';
import type { StoryHost } from './runtime';
import type { StoryContext } from './triggers';
import scenesJson from './scenes.gen.json?raw';

interface ScenesFile { version: number; scenes: Record<string, CompiledScene> }
const compiled = JSON.parse(scenesJson) as ScenesFile;
if (compiled.version !== 1) throw new Error(`scenes.gen.json version ${compiled.version}; expected 1 (run npm run scenes)`);

/** Every compiled scene and insert library. */
export const ALL_SCENES: readonly CompiledScene[] = Object.values(compiled.scenes);
/** The MVP calendar ("Spring in Monde", Days 1–25): S01–S10, as MVP_PLAN G-10 ships them. */
export const SPRING_SCENES: readonly CompiledScene[] = ALL_SCENES.filter(s => s.kind === 'insert_library' || /^s(0\d|10)[a-z]?_/.test(s.id));
/** The board a New Game opens on: S01a's place (scenes/story/attach.ts takes a fresh game straight there). */
export const OPENING_BOARD: string | undefined = ALL_SCENES.find(s => s.id === 's01a_ferry')?.header?.place.split('.')[0];

/**
 * GDD-GAP: §13.3 doesn't say how long a declined summons waits before it asks again; half an hour of game
 * time keeps it from nagging every minute while the window is still open.
 */
export const SUMMON_COOLDOWN_MINUTES = 30;

const absMinute = (day: number, minute: number): number => day * 10_000 + minute;

export interface SessionOptions extends StoryDiagnostics {
  scenes?: readonly CompiledScene[];
  world: StoryWorld | null;
  /** The save's `story_flags` record, if any. */
  saved?: Parameters<typeof decodeStory>[0];
}

export class StorySession {
  readonly flags: FlagStore;
  readonly director: StoryDirector;
  readonly scenes: readonly CompiledScene[];
  ledger: StoryLedger = emptyLedger();
  world: StoryWorld | null;
  presenter: StoryPresenter | null = null;
  private outcomes: Record<string, unknown> = {};
  /** A summoned scene's place, published before travel finishes (README: enter publishes the new place). */
  private staged: { zone: string; place: string } | null = null;
  private declined = new Map<string, number>();
  private readonly headers: Map<string, SceneHeader>;
  private readonly dev: boolean;
  private readonly warn: (message: string) => void;

  constructor(opts: SessionOptions) {
    this.scenes = opts.scenes ?? SPRING_SCENES;
    this.world = opts.world;
    this.flags = new FlagStore(opts);
    this.dev = this.flags.dev;
    this.warn = this.flags.warn;
    this.headers = new Map(this.scenes.flatMap(s => (s.header ? [[s.id, s.header] as const] : [])));
    this.director = new StoryDirector(this.scenes, this.flags, this.host());
    if (opts.saved) this.restore(opts.saved);
  }

  header(id: string): SceneHeader | undefined { return this.headers.get(id); }
  scene(id: string): CompiledScene | undefined { return this.scenes.find(s => s.id === id); }
  get active(): string | undefined { return this.director.current?.scene.id; }

  context(): StoryContext {
    const now = this.world?.now() ?? { day: 1, minute: 360, zone: '', place: '' };
    const placed = this.staged ? { ...now, zone: this.staged.zone, place: this.staged.place } : now;
    return buildStoryContext(placed, this.ledger, this.outcomes);
  }

  /** The `story_flags` record the save system stores. */
  snapshot(): ReturnType<typeof encodeStory> { return encodeStory(this.director.serialize(), this.ledger); }

  restore(saved: Parameters<typeof decodeStory>[0]): void {
    const { save, ledger } = decodeStory(saved);
    this.ledger = ledger;
    this.outcomes = {};
    this.staged = null;
    try {
      this.director.restore(save);
    } catch (error) {
      // A development save naming a flag the registry no longer declares: keep what still validates.
      this.warn(`[story] restore: ${String(error)}`);
      this.director.restore({ ...save, flags: save.flags.filter(flag => this.known(flag)) });
    }
  }

  /** Something can start now: refresh the triggers and look past summonses still cooling down. */
  ready(): boolean {
    if (this.director.current) return false;
    this.director.refresh();
    return this.director.queued.some(id => !this.cooling(id));
  }

  /**
   * Dev and `?scene=`: queue a scene to play next whatever its window, place or trigger (a restart entry,
   * which the director starts unconditionally). Its durable effects may apply again.
   */
  play(id: string): boolean {
    if (!this.headers.has(id) || this.director.current) return false;
    const save: StorySave = this.director.serialize();
    this.director.restore({ ...save, queue: [{ id, restart: true }, ...save.queue.filter(q => q.id !== id)] });
    this.ledger.applied = this.ledger.applied.filter(key => !key.startsWith(`${id}|`));
    return true;
  }

  /** The scene ended (or the presenter closed): forget its transient state. */
  settle(): void {
    if (this.director.current) return;
    this.staged = null;
    this.outcomes = {};
  }

  private known(flag: string): boolean {
    try { this.flags.has(flag); return true; } catch { return false; }
  }

  private cooling(id: string): boolean {
    const until = this.declined.get(id);
    if (until === undefined) return false;
    const now = this.world?.now();
    return !!now && absMinute(now.day, now.minute) < until;
  }

  private host(): StoryHost {
    return {
      context: () => this.context(),
      handlers: createStoryHandlers({
        dev: this.flags.dev, warn: this.flags.warn,
        ledger: () => this.ledger,
        world: () => this.world,
        presenter: () => this.presenter,
        setOutcome: (name, value) => { this.outcomes = { ...this.outcomes, [name]: value }; },
        scenePlace: id => this.headers.get(id)?.place ?? ''
      }),
      enter: async (header, summoned) => {
        if (!summoned) return true;
        if (this.cooling(header.id)) return false;
        const world = this.world, presenter = this.presenter;
        const zone = header.place.split('.')[0]!;
        const here = world?.now();
        if (here?.place === header.place) return true;
        if (presenter && world) {
          const go = await presenter.confirm(summonText(header, this.scene(header.id)?.title, world.zoneName(zone)), 'Go now', 'Not yet');
          if (!go) {
            const now = world.now();
            this.declined.set(header.id, absMinute(now.day, now.minute) + SUMMON_COOLDOWN_MINUTES);
            return false;
          }
          await presenter.fade();
          world.travel(header.place);
        } else if (this.dev) this.warn(`[story] summoned ${header.id} without a presenter: staging the place only`);
        this.staged = { zone, place: header.place };
        return true;
      }
    };
  }
}

