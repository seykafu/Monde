import type { DialogueTurnOutput, ReflectionOutput, GossipOutput } from "./outputs";

/** Engine-side limits on model-proposed changes (GDD §9.10.2, §9.17). The model proposes; the engine disposes. */
export const LIMITS = {
  dialogue: { regard: 5, regardHeart: 7, mood: 10, maxLines: 3, maxChoices: 3, lineChars: 220, choiceChars: 90 },
  reflection: { relationship: 10, regard: 8, stance: 15, mood: 15, feeling: 15, beliefs: 12 },
  /** §9.11.3: an encounter, summary or live, moves each direction by −3..+3. */
  gossip: { relationship: 3, feeling: 10 },
  memoryImportance: { min: 1, max: 10 },
} as const;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

/**
 * Fit text to a length cap without cutting a word in half: the last full sentence that fits (if it keeps at least
 * half the cap), else the last whole word with an ellipsis. Text already within the cap is returned unchanged.
 */
export function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max);
  const sentence = Math.max(...[". ", "! ", "? ", "… ", ".) ", "!) ", "?) "].map((end) => {
    const at = room.lastIndexOf(end);
    return at < 0 ? -1 : at + end.length - 1;
  }));
  if (sentence >= max / 2) return room.slice(0, sentence).trimEnd();
  const word = room.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[\s,;:—–-]+$/, "");
  return `${word || room.slice(0, max - 1)}…`;
}
const sym = (v: number, m: number): number => Math.round(clamp(v, -m, m));

export function clampDialogue(out: DialogueTurnOutput, opts: { heartPerk?: boolean } = {}): DialogueTurnOutput {
  const L = LIMITS.dialogue;
  return {
    ...out,
    lines: out.lines.slice(0, L.maxLines).map((l) => ({ ...l, text: fitText(l.text, L.lineChars) })),
    choices: out.choices.slice(0, L.maxChoices).map((c) => ({ ...c, text: fitText(c.text, L.choiceChars) })),
    effects: {
      ...out.effects,
      regard_delta: sym(out.effects.regard_delta, opts.heartPerk ? L.regardHeart : L.regard),
      mood: { valence: sym(out.effects.mood.valence, L.mood), stress: sym(out.effects.mood.stress, L.mood) },
      memory: out.effects.memory
        ? { text: fitText(out.effects.memory.text, 200), importance: Math.round(clamp(out.effects.memory.importance, 1, 10)) }
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
