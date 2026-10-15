import { evaluate, type Command, type CompiledCommand, type CompiledOption, type CompiledScene, type SceneHeader } from "@monde/shared";
import { FlagStore, type StoryDiagnostics } from "./flags";
import { expressionContext, type StoryContext } from "./triggers";

export interface StoryLine {
  kind: "narrate" | "say" | "player";
  text: string;
  speaker?: string;
  expr?: string;
  business?: string;
}
export type HostCue = Exclude<CompiledCommand, { cmd: "set" | "unset" | "insert" | "goto_scene" }>
  | { cmd: "music"; id: string };
export interface CueContext {
  scene: string;
  /** Stable cue location; hosts can use it for idempotent side effects when restarting saves. */
  key: string;
  game: StoryContext;
  flags: FlagStore;
}
type MaybePromise<T> = T | Promise<T>;
export type StoryHandlers = {
  [K in HostCue["cmd"]]?: (
    cue: Extract<HostCue, { cmd: K }>, context: CueContext,
  ) => MaybePromise<K extends "ai_open" | "ai_line" ? readonly StoryLine[] : void>;
};
export interface StoryHost {
  /** Read afresh after every cue, including puzzle/scuffle/character-creation outcomes. */
  context(): StoryContext;
  handlers?: StoryHandlers;
  /** Confirm and stage summoned appointments here; false defers them. */
  enter?(header: SceneHeader, summoned: boolean): MaybePromise<boolean | void>;
}
export type StoryStep =
  | { kind: "line"; line: StoryLine }
  | { kind: "choice"; options: readonly string[] }
  | { kind: "progress" }
  | { kind: "end"; gotoScene?: string; checkpointLoaded?: boolean };

interface Frame { scene: CompiledScene; pc: number }

/** One op per next(): even a malformed jump cycle cannot lock up the presentation thread. */
export class StoryRuntime {
  private frame: Frame;
  private stack: Frame[] = [];
  private choice?: CompiledOption[];
  private lines: StoryLine[] = [];
  private expressions = new Map<string, string>();
  private started = false;
  private busy = false;
  private ended?: Extract<StoryStep, { kind: "end" }>;
  private readonly dev: boolean;
  private readonly warn: (message: string) => void;

  constructor(
    readonly scene: CompiledScene, readonly flags: FlagStore, readonly host: StoryHost,
    private readonly libraries: readonly CompiledScene[] = [], options: StoryDiagnostics = {},
  ) {
    this.frame = { scene, pc: 0 };
    this.dev = options.dev ?? flags.dev;
    this.warn = options.warn ?? flags.warn;
  }

  private warning(message: string): void { if (this.dev) this.warn(message); }
  private text(text: string): string {
    const ctx = expressionContext(this.host.context(), this.flags);
    return text.replace(/\{([A-Za-z_][\w.]*)\}/g, (token, path: string) => {
      const value = ctx.resolve(path.split("."));
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
      this.warning(`Unresolved story interpolation ${token} in ${this.scene.id}`);
      return token;
    });
  }

  private render(line: StoryLine): StoryLine {
    if (line.speaker && line.expr) this.expressions.set(line.speaker, line.expr);
    return { ...line, text: this.text(line.text),
      ...(line.business !== undefined ? { business: this.text(line.business) } : {}),
      ...(line.speaker && this.expressions.has(line.speaker) ? { expr: this.expressions.get(line.speaker) } : {}),
    };
  }

  private async dispatch(cue: HostCue, key: string): Promise<void> {
    const handler = this.host.handlers?.[cue.cmd] as
      ((cue: HostCue, context: CueContext) => MaybePromise<readonly StoryLine[] | void>) | undefined;
    let lines: readonly StoryLine[] | void = undefined;
    if (!handler) this.warning(`Unsupported story cue: ${cue.cmd}`);
    else {
      try { lines = await handler(cue, { scene: this.scene.id, key, game: this.host.context(), flags: this.flags }); }
      catch (error) {
        if (cue.cmd !== "ai_line" && cue.cmd !== "ai_open") throw error;
        this.warning(`Story AI handoff failed: ${String(error)}`);
      }
    }
    if (cue.cmd === "ai_line" && !lines?.length) {
      lines = [{ kind: "say", speaker: cue.speaker.id, text: cue.fallback }];
    }
    // ai_open's resident-specific Quiet Mode exchange belongs to the host's line library.
    if (lines) this.lines.push(...lines);
    if (cue.cmd === "load_checkpoint" && handler) this.ended = { kind: "end", checkpointLoaded: true };
  }

  private async command(command: CompiledCommand | Command, key: string): Promise<void> {
    switch (command.cmd) {
      case "set": this.flags.set(command.flag); return;
      case "unset": this.flags.unset(command.flag); return;
      case "goto": {
        const to = this.frame.scene.labels[command.label];
        if (to === undefined) throw new Error(`Unknown label ${command.label}`);
        this.frame.pc = to; return;
      }
      case "goto_scene": this.ended = { kind: "end", gotoScene: command.scene }; return;
      case "insert": {
        const library = this.libraries.find((s) => s.kind === "insert_library" && Object.hasOwn(s.labels, command.id));
        if (!library) { this.warning(`Missing story insert: ${command.id}`); return; }
        this.stack.push(this.frame);
        this.frame = { scene: library, pc: library.labels[command.id]! }; return;
      }
      case "fallback": return; // Compiler folds this into ai_line; standalone choice effects are harmless.
      case "ai_line":
        await this.dispatch({ ...command, brief: this.text(command.brief),
          fallback: this.text("fallback" in command ? command.fallback : "") }, key); return;
      case "ai_open": await this.dispatch({ ...command, topic: this.text(command.topic) }, key); return;
      case "memory": await this.dispatch({ ...command, text: this.text(command.text) }, key); return;
      default: await this.dispatch(command, key);
    }
  }

  private async exclusive(action: () => Promise<StoryStep>): Promise<StoryStep> {
    if (this.busy) throw new Error("Story runtime is awaiting a host cue");
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  next(): Promise<StoryStep> {
    return this.exclusive(async () => {
      if (this.lines.length) return { kind: "line", line: this.render(this.lines.shift()!) };
      if (this.ended) return this.ended;
      if (this.choice) return { kind: "choice", options: this.choice.map((o) => this.text(o.text)) };
      if (!this.started) {
        this.started = true;
        if (this.scene.header) {
          await this.dispatch({ cmd: "backdrop", id: this.scene.header.backdrop }, "header:backdrop");
          await this.dispatch({ cmd: "music", id: this.scene.header.music }, "header:music");
        }
        return { kind: "progress" };
      }
      const key = `${this.frame.scene.id}:${this.frame.pc}`;
      const op = this.frame.scene.ops[this.frame.pc++];
      if (!op) throw new Error(`Invalid story instruction: ${key}`);
      switch (op.op) {
        case "narrate": case "player": case "say":
          return { kind: "line", line: this.render({ ...op, kind: op.op }) };
        case "choice": this.choice = op.options; return { kind: "choice", options: op.options.map((o) => this.text(o.text)) };
        case "if": if (!evaluate(op.cond, expressionContext(this.host.context(), this.flags))) this.frame.pc = op.else; break;
        case "jump": this.frame.pc = op.to; break;
        case "cmd": await this.command(op.cmd, key); break;
        case "end": {
          const parent = this.stack.pop();
          if (parent) this.frame = parent;
          else { this.ended = { kind: "end" }; return this.ended; }
        }
      }
      return { kind: "progress" };
    });
  }

  choose(index: number): Promise<StoryStep> {
    return this.exclusive(async () => {
      if (!this.choice || !Number.isInteger(index) || index < 0 || index >= this.choice.length) throw new Error("Invalid story choice");
      const option = this.choice[index]!;
      const key = `${this.frame.scene.id}:${this.frame.pc - 1}:choice:${index}`;
      this.choice = undefined;
      for (const [i, effect] of option.effects.entries()) {
        await this.command(effect, `${key}:${i}`);
        if (this.ended) return this.ended;
      }
      if (option.to !== undefined) this.frame.pc = option.to;
      return { kind: "progress" };
    });
  }
}
