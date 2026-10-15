import { expect, it, vi } from "vitest";
import { FlagStore } from "../flags";
import { eligibleScenes } from "../triggers";
import { context, scene } from "./helpers";

it("validates flags and restores atomically; production warns and ignores unknowns", () => {
  const flags = new FlagStore({ dev: true });
  flags.set("s03_done"); flags.set("met_generated_resident");
  expect(() => flags.set("typo_flag")).toThrow("Unknown");
  expect(() => flags.has("typo_flag")).toThrow("Unknown");
  expect(() => flags.restore(["typo_flag"])).toThrow("Unknown");
  expect(flags.has("s03_done")).toBe(true);
  const warn = vi.fn(); const prod = new FlagStore({ dev: false, warn });
  prod.restore([...flags.serialize(), "typo_flag"]); prod.set("typo_flag"); prod.unset("typo_flag");
  expect(prod.serialize()).toEqual(flags.serialize()); expect(warn).toHaveBeenCalledTimes(3);
  prod.unset("s03_done"); expect(prod.has("s03_done")).toBe(false);
});

it("enforces earliest day, exact place, time boundaries, expressions, and once-only flags", () => {
  const game = context(); const flags = new FlagStore(); const s = scene([]);
  s.header!.day = 2;
  s.header!.trigger = "player.zone == 'old_quarter' && weekday == 'tue' && pillar.spirit >= 50 && regard.pell >= 5";
  s.header!.sets = ["s01_done", "met_pell"];
  game.regard.pell = 5;
  const eligible = () => eligibleScenes([s], game, flags).length;
  expect(eligible()).toBe(0); game.day = 3; expect(eligible()).toBe(1);
  game.place = "old_quarter.square"; expect(eligible()).toBe(0); game.place = s.header!.place;
  game.minute = 539; expect(eligible()).toBe(0); game.minute = 540; expect(eligible()).toBe(1);
  game.minute = 720; expect(eligible()).toBe(0); game.minute = 719; expect(eligible()).toBe(1);
  game.regard.pell = 4; expect(eligible()).toBe(0); game.regard.pell = 5;
  flags.set("met_pell"); expect(eligible()).toBe(1);
  flags.set("s01_done"); expect(eligible()).toBe(0);
  flags.unset("s01_done"); expect(eligibleScenes([s], game, flags, new Set([s.id]))).toEqual([]);
  s.header!.calledFrom = "previous"; expect(eligible()).toBe(0);
});

it("supports authored 24:00–26:00 on the same game day", () => {
  const game = context(); const s = scene([]); const flags = new FlagStore();
  s.header!.time = { start: "23:00", end: "26:00" };
  for (const minute of [1380, 1440, 1559]) { game.minute = minute; expect(eligibleScenes([s], game, flags)).toEqual([s]); }
  for (const minute of [60, 1379, 1560]) { game.minute = minute; expect(eligibleScenes([s], game, flags)).toEqual([]); }
});

it("sorts competing scenes by calendar and summons festivals only when available", () => {
  const game = context(); const flags = new FlagStore();
  const a = scene([], "s01a_test"), b = scene([], "s01b_test"), c = scene([], "s02_test");
  expect(eligibleScenes([c, b, a], game, flags).map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  const fair = scene([], "s10a_bloom_open"); fair.header!.place = "commons.sundial_lawn";
  expect(eligibleScenes([fair], game, flags)).toEqual([fair]);
  game.asleep = true; expect(eligibleScenes([fair], game, flags)).toEqual([]);
  game.asleep = false; game.inScuffle = true; expect(eligibleScenes([fair], game, flags)).toEqual([]);
});
