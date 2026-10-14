import type { DialogueTurnOutput, ReflectionOutput, GossipOutput } from "./outputs";

/** Engine-side limits on model-proposed changes (GDD §9.10.2, §9.17). The model proposes; the engine disposes. */
export const LIMITS = {
  dialogue: { regard: 5, regardHeart: 7, mood: 10, maxLines: 3, maxChoices: 3, lineChars: 220, choiceChars: 90 },
  reflection: { relationship: 10, regard: 8, stance: 15, mood: 15, feeling: 15, beliefs: 12 },
  gossip: { relationship: 6, feeling: 10 },
  memoryImportance: { min: 1, max: 10 },
} as const;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
const sym = (v: number, m: number): number => Math.round(clamp(v, -m, m));

export function clampDialogue(out: DialogueTurnOutput, opts: { heartPerk?: boolean } = {}): DialogueTurnOutput {
  const L = LIMITS.dialogue;
  return {
    ...out,
    lines: out.lines.slice(0, L.maxLines).map((l) => ({ ...l, text: l.text.slice(0, L.lineChars) })),
    choices: out.choices.slice(0, L.maxChoices).map((c) => ({ ...c, text: c.text.slice(0, L.choiceChars) })),
    effects: {
      ...out.effects,
      regard_delta: sym(out.effects.regard_delta, opts.heartPerk ? L.regardHeart : L.regard),
      mood: { valence: sym(out.effects.mood.valence, L.mood), stress: sym(out.effects.mood.stress, L.mood) },
      memory: out.effects.memory
        ? { text: out.effects.memory.text.slice(0, 200), importance: Math.round(clamp(out.effects.memory.importance, 1, 10)) }
        : null,
    },
  };
}

export function clampReflection(out: ReflectionOutput): ReflectionOutput {
  const L = LIMITS.reflection;
  return {
    ...out,
    mood_delta: {
      valence: sym(out.mood_delta.valence, L.mood),
      energy: sym(out.mood_delta.energy, L.mood),
      stress: sym(out.mood_delta.stress, L.mood),
    },
    beliefs: out.beliefs.slice(0, L.beliefs),
    relationship_deltas: out.relationship_deltas.map((r) => ({
      ...r,
      affinity: sym(r.affinity, L.relationship),
      trust: sym(r.trust, L.relationship),
      feeling: r.feeling ? { ...r.feeling, delta: sym(r.feeling.delta, L.feeling) } : null,
    })),
    stance_deltas: out.stance_deltas.map((s) => ({ ...s, delta: sym(s.delta, L.stance) })),
    regard_delta: sym(out.regard_delta, L.regard),
  };
}

export function clampGossip(out: GossipOutput): GossipOutput {
  const L = LIMITS.gossip;
  const d = (x: { affinity: number; trust: number }) => ({ affinity: sym(x.affinity, L.relationship), trust: sym(x.trust, L.relationship) });
  return {
    ...out,
    lines: out.lines ? out.lines.slice(0, 6) : null,
    a_delta: d(out.a_delta),
    b_delta: d(out.b_delta),
    feeling_change: out.feeling_change ? { ...out.feeling_change, delta: sym(out.feeling_change.delta, L.feeling) } : null,
  };
}
