import { expect, it, vi } from "vitest";
import { StoryDirector } from "../director";
import { FlagStore } from "../flags";
import { context, scene } from "./helpers";

const flags = () => new FlagStore({ dev: true, warn: vi.fn() });

it("revalidates the queue, persists completion, and restarts active scenes with entry flags", async () => {
  const game = context(); const store = flags();
  const a = scene([{ op: "cmd", line: 1, cmd: { cmd: "set", flag: "met_pell" } }, { op: "narrate", line: 2, text: "hello" }]);
  a.refs.flagsWritten = ["met_pell"];
  const b = scene([], "s02_test"); b.header!.trigger = "!flag.met_pell";
  const director = new StoryDirector([b, a], store, { context: () => game });
  director.refresh(); expect(director.queued).toEqual([a.id, b.id]);
  await director.next(); await director.next(); expect(store.has("met_pell")).toBe(true);
  store.set("met_moss");
  const save = JSON.parse(JSON.stringify(director.serialize()));
  const restored = new StoryDirector([b, a], store, { context: () => game }); restored.restore(save);
  expect(store.has("met_pell")).toBe(false); expect(store.has("met_moss")).toBe(true);
  await restored.next(); expect(restored.current?.scene.id).toBe(a.id);
  await restored.next(); await restored.next(); expect(await restored.next()).toEqual({ kind: "end" });
  expect(await restored.next()).toBeNull();
  const final = restored.serialize(); restored.restore(final);
  expect(await restored.next()).toBeNull(); expect(final.completed).toEqual([a.id]);
});

it("hands off called scenes without requiring their place/time and does not auto-trigger them", async () => {
  const game = context(); const store = flags();
  const a = scene([{ op: "cmd", line: 1, cmd: { cmd: "goto_scene", scene: "s02_test" } }]);
  const b = scene([], "s02_test"); b.header!.calledFrom = a.id; b.header!.place = "wharf.ferry_slip";
  b.header!.day = 100;
  const director = new StoryDirector([a, b], store, { context: () => game });
  director.refresh(); expect(director.queued).toEqual([a.id]);
  await director.next(); await director.next(); await director.next();
  await director.next(); expect(director.current?.scene.id).toBe(b.id);
  expect(await director.next()).toEqual({ kind: "end" });
  expect(await director.next()).toBeNull();
});

it("tells the host which scene handed off, so it carries the player along instead of summoning", async () => {
  const game = context(); const enter = vi.fn().mockResolvedValue(true);
  const a = scene([{ op: "cmd", line: 1, cmd: { cmd: "goto_scene", scene: "s02_test" } }]);
  const b = scene([], "s02_test"); b.header!.place = "old_quarter.fountain_square";
  const director = new StoryDirector([a, b], flags(), { context: () => game, enter });
  for (let n = 0; n < 6 && director.current?.scene.id !== b.id; n++) await director.next();
  expect(director.current?.scene.id).toBe(b.id);
  expect(enter).toHaveBeenNthCalledWith(1, a.header, false, undefined);
  expect(enter).toHaveBeenLastCalledWith(b.header, false, a.id);
});

it("defers declined summons and clears stale queued scenes on movement", async () => {
  const game = context(); const enter = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const fair = scene([], "s10a_bloom_open");
  const director = new StoryDirector([fair], flags(), { context: () => game, enter });
  expect(await director.next()).toBeNull();
  await director.next(); expect(enter).toHaveBeenLastCalledWith(fair.header, true, undefined);
  const local = new StoryDirector([scene([])], flags(), { context: () => game });
  local.refresh(); game.place = "elsewhere"; expect(await local.next()).toBeNull();
});

it("plays a repeating scene once a day its trigger holds, with fresh cue keys each time (the weekly rhythm)", async () => {
  const game = context(); game.weekday = "sat"; game.day = 5;
  const regard = vi.fn();
  const quiz = scene([{ op: "cmd", line: 1, cmd: { cmd: "regard", resident: "roz", delta: 2 } }], "wk_pub_quiz");
  quiz.header!.repeats = true; quiz.header!.trigger = "weekday == 'sat'";
  const director = new StoryDirector([quiz], flags(), { context: () => game, handlers: { regard: (_cue, ctx) => { regard(ctx.key); } } });
  const play = async () => { for (let n = 0; n < 6; n++) if ((await director.next())?.kind === "end") return true; return false; };
  expect(await play()).toBe(true);
  expect(director.serialize().completed).toEqual(["wk_pub_quiz@5"]);
  // Done for Day 5: it doesn't play twice in a day.
  director.refresh(); expect(director.queued).toEqual([]);
  // Not on a Sunday; back the next Saturday, its cue keyed afresh.
  Object.assign(game, { day: 6, weekday: "sun" }); director.refresh(); expect(director.queued).toEqual([]);
  Object.assign(game, { day: 12, weekday: "sat" }); director.refresh(); expect(director.queued).toEqual(["wk_pub_quiz"]);
  expect(await play()).toBe(true);
  expect(director.serialize().completed).toEqual(["wk_pub_quiz@5", "wk_pub_quiz@12"]);
  expect(regard.mock.calls.map(c => c[0])).toEqual(["wk_pub_quiz:0@5", "wk_pub_quiz:0@12"]);
});
