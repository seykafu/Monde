import { evaluate, type CompiledScene } from "@monde/shared";
import { FlagStore } from "./flags";
import { StoryRuntime, type StoryHost, type StoryStep } from "./runtime";
import { eligibleScenes, expressionContext, isSummoned, sceneDone } from "./triggers";

interface QueuedScene { id: string; from?: string; restart?: boolean }
export interface StorySave {
  version: 1;
  flags: string[];
  completed: string[];
  queue: QueuedScene[];
  active?: { id: string; initialFlags: string[] };
}

/** Call refresh on entry/ticks, then drive next()/choose() from the presentation layer. */
export class StoryDirector {
  private queue: QueuedScene[] = [];
  private completed = new Set<string>();
  private runtime?: StoryRuntime;
  private initialFlags: string[] = [];
  private busy = false;
  private readonly byId: Map<string, CompiledScene>;

  constructor(readonly scenes: readonly CompiledScene[], readonly flags: FlagStore, readonly host: StoryHost) {
    this.byId = new Map(scenes.map((scene) => [scene.id, scene]));
  }

  get current(): StoryRuntime | undefined { return this.runtime; }
  get queued(): readonly string[] { return this.queue.map((entry) => entry.id); }

  refresh(): void {
    const special = this.queue.filter((entry) => entry.from || entry.restart);
    const pending = new Set(special.map((entry) => entry.id));
    this.queue = [...special, ...eligibleScenes(this.scenes, this.host.context(), this.flags, this.completed)
      .filter((scene) => scene.id !== this.runtime?.scene.id && !pending.has(scene.id))
      .map((scene) => ({ id: scene.id }))];
  }

  private async start(): Promise<void> {
    this.refresh();
    while (this.queue.length) {
      const entry = this.queue.shift()!;
      const scene = this.byId.get(entry.id);
      if (!scene?.header) continue;
      const context = this.host.context();
      if (context.asleep || context.inScuffle) { this.queue.unshift(entry); return; }
      if (!entry.restart) {
        if (sceneDone(scene, this.flags, this.completed)) continue;
        if (entry.from && ((scene.header.calledFrom && scene.header.calledFrom !== entry.from)
          || !evaluate(scene.header.trigger, expressionContext(context, this.flags)))) continue;
      }
      if (await this.host.enter?.(scene.header, isSummoned(scene)) === false) {
        this.queue.unshift(entry); return;
      }
      this.initialFlags = this.flags.serialize();
      this.runtime = new StoryRuntime(scene, this.flags, this.host, this.scenes);
      return;
    }
  }

  private finish(step: StoryStep): void {
    if (step.kind !== "end" || !this.runtime) return;
    const id = this.runtime.scene.id;
    if (!step.checkpointLoaded) this.completed.add(id);
    this.runtime = undefined;
    if (step.checkpointLoaded) { this.queue = []; return; }
    if (step.gotoScene) {
      if (!this.byId.has(step.gotoScene)) {
        if (this.flags.dev) this.flags.warn(`Missing story scene: ${step.gotoScene}`);
      } else this.queue.unshift({ id: step.gotoScene, from: id });
    }
  }

  private async exclusive(action: () => Promise<StoryStep | null>): Promise<StoryStep | null> {
    if (this.busy) throw new Error("Story director is awaiting a host cue");
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  next(): Promise<StoryStep | null> {
    return this.exclusive(async () => {
      if (!this.runtime) await this.start();
      if (!this.runtime) return null;
      const step = await this.runtime.next();
      this.finish(step);
      return step;
    });
  }

  choose(index: number): Promise<StoryStep | null> {
    return this.exclusive(async () => {
      if (!this.runtime) throw new Error("No active story scene");
      const step = await this.runtime.choose(index);
      this.finish(step);
      return step;
    });
  }

  serialize(): StorySave {
    return { version: 1, flags: this.flags.serialize(), completed: [...this.completed],
      queue: this.queue.map((entry) => ({ ...entry })),
      ...(this.runtime ? { active: { id: this.runtime.scene.id, initialFlags: [...this.initialFlags] } } : {}),
    };
  }

  restore(save: StorySave): void {
    if (this.busy) throw new Error("Cannot restore during a story handoff");
    if (save.version !== 1) throw new Error("Unsupported story save version");
    this.flags.restore(save.flags);
    this.completed = new Set(save.completed);
    this.runtime = undefined;
    this.queue = save.queue.filter((entry) => this.byId.has(entry.id)).map((entry) => ({ ...entry }));
    if (save.active) {
      const scene = this.byId.get(save.active.id);
      if (scene) {
        // Restart authored branches with their entry flags. Unrelated world flags survive.
        const before = new Set(save.active.initialFlags);
        for (const flag of scene.refs.flagsWritten) {
          if (before.has(flag)) this.flags.set(flag); else this.flags.unset(flag);
        }
        this.completed.delete(scene.id);
        this.queue = [{ id: scene.id, restart: true }, ...this.queue.filter((entry) => entry.id !== scene.id)];
      }
    }
  }
}
