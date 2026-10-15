import type { CompiledScene, Op } from "@monde/shared";
import type { StoryContext } from "../triggers";
import type { StoryRuntime, StoryStep } from "../runtime";

export function context(): StoryContext {
  return { day: 1, minute: 600, weekday: "tue", zone: "old_quarter", place: "old_quarter.library",
    pillar: { prosperity: 50, safety: 50, spirit: 50, charm: 50 }, regard: {},
    values: { name: "Alex", they: "they", them: "them", their: "their", theyre: "they're",
      player: { background: "local", why: "to_help" }, census: 210, coins: 1000, appeal: 40,
      arrival: { name: "Robin", trade: "baker", reason: "a fresh start" },
    },
  };
}
export function scene(ops: Op[], id = "s01_test"): CompiledScene {
  return { id, kind: "scene", file: "test", header: {
    kind: "scene", id, day: 1, time: { start: "09:00", end: "12:00" }, place: "old_quarter.library",
    trigger: "", backdrop: "bg_library", music: "library", cast: [], sets: [],
  }, ops: [...ops, { op: "end", line: 0 }], labels: {},
  refs: { flagsRead: [], flagsWritten: [], speakers: [], interpolations: [], scenes: [], inserts: [] },
  stats: { lines: 0, choices: 0, options: 0, commands: 0 },
  };
}
export async function drain(runtime: StoryRuntime): Promise<StoryStep[]> {
  const steps: StoryStep[] = [];
  for (let i = 0; i < 1000; i++) {
    const step = await runtime.next(); steps.push(step);
    if (step.kind === "end") return steps;
    if (step.kind === "choice") await runtime.choose(0);
  }
  throw new Error("Scene did not terminate");
}
