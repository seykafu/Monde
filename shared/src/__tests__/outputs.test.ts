import { describe, expect, it } from "vitest";
import {
  DialogueTurnOutput, PlanOutput, ReflectionOutput, GossipOutput, PrecheckOutput,
  modelJsonSchema, UNSUPPORTED_SCHEMA_KEYS, clampDialogue, clampReflection,
} from "../index";

function walk(node: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((v) => walk(v, visit));
  }
}

describe("model output schemas", () => {
  const schemas = { DialogueTurnOutput, PlanOutput, ReflectionOutput, GossipOutput, PrecheckOutput };
  for (const [name, s] of Object.entries(schemas)) {
    it(`${name} converts to an API-safe JSON Schema`, () => {
      const js = modelJsonSchema(s);
      walk(js, (o) => {
        for (const k of UNSUPPORTED_SCHEMA_KEYS) expect(o, `${name} has ${k}`).not.toHaveProperty(k);
        if (o.type === "object") {
          expect(o.additionalProperties).toBe(false);
          expect(new Set(o.required as string[])).toEqual(new Set(Object.keys(o.properties as object)));
        }
      });
    });
  }
});

describe("clamps", () => {
  it("clamps a greedy dialogue turn", () => {
    const out = clampDialogue({
      lines: [1, 2, 3, 4].map((i) => ({ text: "x".repeat(400) + i, expr: "warm" })),
      choices: [1, 2, 3, 4].map((i) => ({ id: String(i), text: "y".repeat(200), intent: "kind" as const })),
      effects: { regard_delta: 40, mood: { valence: -99, stress: 12 }, memory: { text: "m", importance: 42 },
        favor: null, reveal_secret: null, topic: "t" },
      wrap_up: false,
    });
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]!.text).toHaveLength(220);
    expect(out.choices).toHaveLength(3);
    expect(out.effects.regard_delta).toBe(5);
    expect(out.effects.mood).toEqual({ valence: -10, stress: 10 });
    expect(out.effects.memory!.importance).toBe(10);
  });

  it("clamps a reflection", () => {
    const out = clampReflection({
      mood_delta: { valence: 50, energy: -50, stress: 3 }, emotion: "wistful",
      beliefs: Array.from({ length: 20 }, (_, i) => `b${i}`),
      relationship_deltas: [{ id: "june", affinity: 30, trust: -30, feeling: { kind: "crush", delta: 99 } }],
      stance_deltas: [{ issue: "port_vane", delta: -40 }], regard_delta: 20,
      dream_progress: null, favor: null, letter: null, diary: "d",
    });
    expect(out.beliefs).toHaveLength(12);
    expect(out.relationship_deltas[0]).toMatchObject({ affinity: 10, trust: -10, feeling: { delta: 15 } });
    expect(out.stance_deltas[0]!.delta).toBe(-15);
    expect(out.regard_delta).toBe(8);
  });
});
