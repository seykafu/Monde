import { describe, expect, it, vi } from "vitest";
import type { CompiledCommand, Command } from "@monde/shared";
import { FlagStore } from "../flags";
import { StoryRuntime, type HostCue, type StoryHandlers, type StoryHost } from "../runtime";
import { context, drain, scene } from "./helpers";

const cues = {
  regard: { cmd: "regard", resident: "pell", delta: 5 }, pillar: { cmd: "pillar", pillar: "spirit", delta: 2 },
  coins: { cmd: "coins", delta: -20 }, item: { cmd: "item", item: "pinion", delta: 1 },
  scuffle: { cmd: "scuffle", id: "tutorial" }, riddle: { cmd: "riddle", id: "OQ-1" },
  puzzle: { cmd: "puzzle", id: "PZ-01" }, project: { cmd: "project", id: "fountain" },
  ai_open: { cmd: "ai_open", resident: "pell", topic: "Hello {name}", turns: 3 },
  ai_line: { cmd: "ai_line", speaker: { id: "pell", auto: true }, slot: "test", brief: "{name}", fallback: "Hello {name}" },
  memory: { cmd: "memory", resident: "pell", text: "Met {name}", importance: 7 },
  wait: { cmd: "wait", seconds: 2 }, fade: { cmd: "fade" }, sfx: { cmd: "sfx", id: "bell" },
  cam: { cmd: "cam", effect: "shake" }, backdrop: { cmd: "backdrop", id: "square" },
  charcreate: { cmd: "charcreate" }, checkpoint: { cmd: "checkpoint", key: "campaign_season" },
  load_checkpoint: { cmd: "load_checkpoint", key: "campaign_season" }, campaign: { cmd: "campaign", key: "open" },
  debate_score: { cmd: "debate_score", delta: 1 }, pick_planks: { cmd: "pick_planks", count: 3 },
  tally: { cmd: "tally", district: "final" }, music: { cmd: "music", id: "library" },
} satisfies { [K in HostCue["cmd"]]: Extract<HostCue, { cmd: K }> };

const flags = () => new FlagStore({ dev: true, warn: vi.fn() });

describe("host dispatch", () => {
  for (const cue of Object.values(cues)) it(`dispatches ${cue.cmd} with context and substitutions`, async () => {
    const game = context();
    const handler = vi.fn(async () => cue.cmd === "ai_open" || cue.cmd === "ai_line"
      ? [{ kind: "say" as const, speaker: "pell", text: "Live {name}" }] : undefined);
    const s = scene(cue.cmd === "music" ? [] : [{ op: "cmd", line: 1, cmd: cue }]);
    const runtime = new StoryRuntime(s, flags(), { context: () => game, handlers: { [cue.cmd]: handler } as StoryHandlers });
    const steps = await drain(runtime);
    const expected = { ...cue };
    if ("text" in expected) expected.text = "Met Alex";
    if ("topic" in expected) expected.topic = "Hello Alex";
    if ("brief" in expected) { expected.brief = "Alex"; expected.fallback = "Hello Alex"; }
    expect(handler).toHaveBeenLastCalledWith(expected, expect.objectContaining({ scene: s.id, game, flags: runtime.flags, key: expect.any(String) }));
    if (cue.cmd.startsWith("ai_")) expect(steps).toContainEqual({ kind: "line", line: { kind: "say", speaker: "pell", text: "Live Alex" } });
    if (cue.cmd === "load_checkpoint") expect(steps.at(-1)).toEqual({ kind: "end", checkpointLoaded: true });
  });

  it("warns and continues for every unsupported host cue", async () => {
    const store = flags();
    const s = scene(Object.values(cues).filter((c): c is Exclude<typeof c, { cmd: "music" }> => c.cmd !== "music")
      .map((cmd) => ({ op: "cmd", line: 1, cmd })));
    const steps = await drain(new StoryRuntime(s, store, { context }));
    expect(steps.at(-1)).toEqual({ kind: "end" });
    for (const cue of Object.values(cues)) expect(store.warn).toHaveBeenCalledWith(`Unsupported story cue: ${cue.cmd}`);
    expect(steps).toContainEqual({ kind: "line", line: { kind: "say", speaker: "pell", text: "Hello Alex" } });
  });

  it("hands a live {ai_line} on with its stored turn and the cue's authored fallback, for Report line (§9.13)", async () => {
    const live = { kind: "say" as const, speaker: "pell", text: "Live line", report: { conversation_id: "c", turn_index: 0 } };
    const runtime = new StoryRuntime(scene([{ op: "cmd", line: 1, cmd: cues.ai_line }]), flags(), { context, handlers: { ai_line: async () => [live] } });
    const steps = await drain(runtime);
    expect(steps).toContainEqual({ kind: "line", line: { ...live, report: { conversation_id: "c", turn_index: 0, fallback: "Hello Alex" } } });
  });

  it("awaits AI, rejects concurrent steps, and uses authored fallback on failure", async () => {
    let release!: () => void;
    const handler = vi.fn(() => new Promise<never>((_resolve, reject) => { release = () => reject(new Error("offline")); }));
    const runtime = new StoryRuntime(scene([{ op: "cmd", line: 1, cmd: cues.ai_line }]), flags(), { context, handlers: { ai_line: handler } });
    await runtime.next();
    const pending = runtime.next();
    await expect(runtime.next()).rejects.toThrow("awaiting");
    release(); await pending;
    expect(await runtime.next()).toMatchObject({ kind: "line", line: { text: "Hello Alex" } });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

it("runs choice effects in order, jumps, conditions, unsets, expression retention and stage business", async () => {
  const game = context();
  const store = flags();
  const effects: Command[] = [{ cmd: "set", flag: "met_pell" }, { cmd: "coins", delta: 5 }, { cmd: "unset", flag: "met_pell" }];
  const host: StoryHost = { context: () => game, handlers: { coins: () => { expect(store.has("met_pell")).toBe(true); game.values!.coins = 5; } } };
  const s = scene([
    { op: "choice", line: 1, options: [{ text: "Hi {name}", line: 1, effects, to: 2 }] },
    { op: "narrate", line: 2, text: "SKIP" },
    { op: "if", line: 3, cond: "coins == 5 && !flag.met_pell", else: 6 },
    { op: "say", line: 4, speaker: "pell", expr: "warm", business: "waves at {name}", text: "Hi {name}" },
    { op: "say", line: 5, speaker: "pell", text: "Again" },
    { op: "jump", line: 6, to: 7 },
    { op: "narrate", line: 7, text: "SKIP" },
  ]);
  const runtime = new StoryRuntime(s, store, host);
  await runtime.next();
  expect(await runtime.next()).toEqual({ kind: "choice", options: ["Hi Alex"] });
  expect(await runtime.next()).toEqual({ kind: "choice", options: ["Hi Alex"] });
  await expect(runtime.choose(-1)).rejects.toThrow("Invalid");
  await runtime.choose(0);
  const steps = await drain(runtime);
  const lines = steps.filter((step) => step.kind === "line").map((step) => step.line);
  expect(lines).toMatchObject([{ text: "Hi Alex", expr: "warm", business: "waves at Alex" }, { text: "Again", expr: "warm" }]);
  await expect(runtime.choose(0)).rejects.toThrow("Invalid");
});

it("branches on fresh asynchronous puzzle results", async () => {
  const game = context();
  const runtime = new StoryRuntime(scene([
    { op: "cmd", line: 1, cmd: cues.puzzle },
    { op: "if", line: 2, cond: "puzzle.solved", else: 3 },
    { op: "narrate", line: 3, text: "solved" },
  ]), flags(), { context: () => game, handlers: { puzzle: async () => { game.values!.puzzle = { solved: false }; } } });
  expect((await drain(runtime)).some((s) => s.kind === "line")).toBe(false);
});

it("returns from inserts, handles raw goto/fallback choice effects, and ends on goto_scene", async () => {
  const library = scene([{ op: "narrate", line: 1, text: "Inserted" }], "inserts");
  library.kind = "insert_library"; library.header = null; library.labels.greeting = 0;
  const s = scene([
    { op: "cmd", line: 1, cmd: { cmd: "insert", id: "greeting" } },
    { op: "choice", line: 2, options: [{ line: 2, text: "Go", effects: [{ cmd: "fallback", text: "hidden" }, { cmd: "goto", label: "end" }] }] },
    { op: "narrate", line: 3, text: "SKIP" },
    { op: "cmd", line: 4, cmd: { cmd: "goto_scene", scene: "s02_test" } },
  ]);
  s.labels.end = 3;
  const steps = await drain(new StoryRuntime(s, flags(), { context }, [library]));
  expect(steps.filter((s) => s.kind === "line")).toMatchObject([{ line: { text: "Inserted" } }]);
  expect(steps.at(-1)).toEqual({ kind: "end", gotoScene: "s02_test" });
});

// This union check makes new compiler commands require a coverage decision here.
const internal: Record<Exclude<Command["cmd"], HostCue["cmd"]>, true> = { set: true, unset: true, goto: true, goto_scene: true, insert: true, fallback: true };
const compiled: CompiledCommand = cues.wait;
it("covers the command union", () => { expect(internal.set && compiled.cmd === "wait").toBe(true); });
