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
