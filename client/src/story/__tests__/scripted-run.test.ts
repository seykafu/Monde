import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { compileScenes, registryFromContent } from "@monde/shared";
import { StoryDirector } from "../director";
import { FlagStore } from "../flags";
import type { StoryHost, StoryLine } from "../runtime";
import { context } from "./helpers";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");
const registry = registryFromContent({ flagsYaml: read("content/flags.yaml"),
  residentYamls: fs.readdirSync(path.join(root, "content/residents")).filter((f) => f.endsWith(".yaml")).map((f) => read(`content/residents/${f}`)),
  placesYaml: read("content/places/places.yaml"),
});
const compiled = compileScenes(fs.readdirSync(path.join(root, "content/scenes")).filter((f) => f.endsWith(".scene.md"))
  .map((file) => ({ file, source: read(`content/scenes/${file}`) })), registry);
const spring = compiled.scenes.filter((s) => s.header && /^s(0\d|10)/.test(s.id));
const expected = ["s01a_ferry", "s01b_walk", "s01c_cottage", "s02_marks", "s03_tolls", "s04_water_again", "s05_first_arrival",
  "s06_good_coat", "s07b_chime_loan", "s08_option", "s09_pell_confession", "s10a_bloom_open", "s10b_bloom_close"];

it("compiles all 37 scripts with zero diagnostics", () => { expect(compiled.scenes).toHaveLength(37); expect(compiled.diagnostics).toEqual([]); });

describe.each(["first", "last"] as const)("Days 1–25, %s choices", (choice) => {
  it("fires all ten beats in calendar order with live handoffs and persistent flags", async () => {
    const game = context(); const warn = vi.fn(); const flags = new FlagStore({ dev: true, warn });
    const played: string[] = []; const memories: string[] = []; const ai: string[] = [];
    const host: StoryHost = { context: () => game,
      enter: (header) => { played.push(header.id); game.place = header.place; game.zone = header.place.split(".")[0]!; },
      handlers: {
        backdrop: () => {}, music: () => {}, wait: () => {}, fade: () => {}, sfx: () => {}, cam: () => {}, charcreate: () => {},
        regard: (cue) => { game.regard[cue.resident] = (game.regard[cue.resident] ?? 0) + cue.delta; },
        pillar: (cue) => { game.pillar[cue.pillar] = (game.pillar[cue.pillar] ?? 0) + cue.delta; },
        coins: (cue) => { game.values!.coins = Number(game.values!.coins) + cue.delta; },
        item: () => {}, project: () => {},
        puzzle: async () => { game.values!.puzzle = { solved: true }; },
        riddle: async () => { game.values!.riddle = { solved: true }; },
        scuffle: async () => { game.values!.scuffle = { won: true }; },
        memory: (cue, ctx) => { expect(ctx.game.day).toBeGreaterThan(0); expect(cue.importance).toBeGreaterThan(0); memories.push(cue.text); },
        ai_open: async (cue) => { ai.push("ai_open"); return [{ kind: "say", speaker: cue.resident, text: "An answer from the fake resident." }]; },
        ai_line: async (cue) => { ai.push("ai_line"); return [{ kind: "say", speaker: cue.speaker.id, text: "A live slot from the fake resident." }]; },
      },
    };
    const director = new StoryDirector(spring, flags, host);
    const places = [...new Set(spring.map((s) => s.header!.place))];
    const lines: StoryLine[] = [];
    // A minute clock plus a deterministic itinerary. No direct scene starts or done-flag injection.
    for (let day = 1; day <= 25; day++) {
      game.day = day; game.weekday = ["tue", "wed", "thu", "fri", "sat", "sun", "mon"][(day - 1) % 7]!;
      game.values!.ferry_day = game.weekday === "tue" || game.weekday === "fri";
      for (let minute = 360; minute < 1560; minute++) {
        game.minute = minute;
        for (const place of places) {
          game.place = place; game.zone = place.split(".")[0]!;
          director.refresh();
          if (!director.queued.length) continue;
          let ended = false;
          for (let n = 0; n < 2000; n++) {
            const step = await director.next();
            if (step === null) { ended = true; break; }
            if (step.kind === "line") lines.push(step.line);
            if (step.kind === "choice") await director.choose(choice === "first" ? 0 : step.options.length - 1);
          }
          expect(ended).toBe(true);
        }
      }
    }
    expect(played).toEqual(expected);
    for (const flag of ["s01a_done", "s01b_done", "s01c_done", "s02_done", "s03_done", "s04_done", "s05_done", "s06_done", "s07_done", "s08_done", "s09_done", "s10a_done", "s10b_done", "option_known", "pell_confessed", "bloom_fair_closed"]) expect(flags.has(flag), flag).toBe(true);
    expect(flags.has("vanes_coin")).toBe(choice === "first");
    expect(flags.has("option_kept_secret")).toBe(choice === "first");
    expect(flags.has("option_public")).toBe(choice === "last");
    expect(ai).toContain("ai_open"); expect(ai).toContain("ai_line");
    expect(memories.length).toBeGreaterThan(30);
    expect(lines.some((line) => /\{[\w.]+\}/.test(line.text))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    const restoredFlags = new FlagStore();
    const restored = new StoryDirector(spring, restoredFlags, host);
    restored.restore(JSON.parse(JSON.stringify(director.serialize())));
    expect(restoredFlags.serialize()).toEqual(flags.serialize()); expect(await restored.next()).toBeNull();
  }, 20000);
});

it("re-arms arrival after the empty boat and allows the early repaired-clock variant", async () => {
  const { eligibleScenes } = await import("../triggers");
  const game = context(); const flags = new FlagStore({ warn: vi.fn() });
  game.day = 8; game.minute = 480; game.zone = "wharf"; game.place = "wharf.ferry_slip";
  game.values!.ferry_day = true; game.values!.appeal = 34;
  expect(eligibleScenes(spring, game, flags).map((s) => s.id)).toEqual(["s05b_empty_boat"]);
  const director = new StoryDirector(spring, flags, { context: () => game });
  for (let n = 0; n < 200; n++) {
    const step = await director.next();
    if (!step) break;
    if (step.kind === "choice") await director.choose(0);
  }
  expect(flags.has("s05_b_seen")).toBe(true); expect(flags.has("s05_done")).toBe(false);
  expect(eligibleScenes(spring, game, flags)).toEqual([]);
  game.day = 11; game.values!.appeal = 35;
  expect(eligibleScenes(spring, game, flags).map((s) => s.id)).toEqual(["s05_first_arrival"]);
  game.day = 6; game.minute = 960; game.zone = "old_quarter"; game.place = "old_quarter.clocktower";
  flags.set("pinion_found");
  expect(eligibleScenes(spring, game, flags).map((s) => s.id)).toEqual(["s07a_chime_runs"]);
  const clock = new StoryDirector(spring, flags, { context: () => game, handlers: { puzzle: async () => { game.values!.puzzle = { solved: true }; } } });
  for (let n = 0; n < 300; n++) {
    const step = await clock.next();
    if (!step) break;
    if (step.kind === "choice") await clock.choose(0);
  }
  expect(flags.has("clock_running")).toBe(true); expect(flags.has("s07_done")).toBe(true);
  game.day = 14; expect(eligibleScenes(spring, game, flags)).toEqual([]);
});
