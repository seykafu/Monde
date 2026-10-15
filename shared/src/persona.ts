import { z } from "zod";
import { PlaceId, ResidentId } from "./ids";
import { Verb } from "./verbs";

/** Persona Card (GDD §9.3, with the §12.5 additions `portrait_expressions` and `beliefs`). Authored content. */

export const STANDARD_EXPRESSIONS = [
  "neutral", "warm", "laugh", "sad", "angry", "surprised", "worried", "thinking",
] as const;

/**
 * The six portraits drawn for every character (Kasey, 2026-10-14): the dialogue picks one per line from the
 * conversation's emotion and content. Card expressions outside the six map onto them (laugh → warm,
 * thinking → neutral); signature expressions return later with more art.
 */
export const PORTRAIT_SET = ["neutral", "warm", "sad", "angry", "surprised", "worried"] as const;
export type PortraitExpression = (typeof PORTRAIT_SET)[number];
const PORTRAIT_ALIASES: Readonly<Record<string, PortraitExpression>> = {
  laugh: "warm", happy: "warm", thinking: "neutral", guarded: "neutral", deadpan: "neutral",
  ashamed_glance: "sad", alarmed: "surprised", grim: "angry",
};
/** The portrait for an expression id, or null if it has no sensible mapping. */
export function toPortraitExpression(expr: string): PortraitExpression | null {
  if ((PORTRAIT_SET as readonly string[]).includes(expr)) return expr as PortraitExpression;
  return PORTRAIT_ALIASES[expr] ?? null;
}

const HomePlace = z.union([PlaceId, z.literal("offmap.city")]);

export const RoutineBlock = z.object({
  at: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM; times past midnight run to 26:00 (GDD §5.3)"),
  do: z.union([Verb, z.enum(["follow", "beg"])]),
  where: HomePlace,
  with: z.array(ResidentId).optional(),
});
export type RoutineBlock = z.infer<typeof RoutineBlock>;

export const Values = z
  .object({
    prosperity: z.number().min(0).max(1),
    safety: z.number().min(0).max(1),
    spirit: z.number().min(0).max(1),
    charm: z.number().min(0).max(1),
  })
  .refine((v) => Math.abs(v.prosperity + v.safety + v.spirit + v.charm - 1) < 0.011, "values must sum to 1.0");
export type Values = z.infer<typeof Values>;

const Score = z.number().int().min(0).max(100);

export const Relationship = z.object({
  id: ResidentId,
  affinity: z.number().int().min(-100).max(100),
  trust: z.number().int().min(-100).max(100),
  tag: z.string(),
  note: z.string(),
});

export const Reveal = z
  .object({
    regard_min: z.number().int().optional(),
    flag: z.string().optional(),
    day: z.number().int().optional(),
  })
  .refine((r) => r.regard_min !== undefined || r.flag !== undefined || r.day !== undefined, "reveal needs a condition");

export const Secret = z.object({ text: z.string(), reveal: Reveal });

/** `while` is an expression evaluated by the engine (see expr.ts). A false lock is left out of the prompt. */
export const CanonLock = z.object({ while: z.string(), fact: z.string() });

const HumanVoice = z.object({
  mode: z.literal("speech").optional(),
  register: z.string(),
  tics: z.array(z.string()),
  never_says: z.array(z.string()),
  samples: z.array(z.string()).length(3),
});
const AnimalVoice = z.object({
  mode: z.literal("narrated_action"),
  register: z.string(),
  tics: z.array(z.string()),
  never_says: z.array(z.string()),
  action_verbs: z.array(z.string()),
});

export const PersonaCard = z.object({
  id: ResidentId,
  name: z.string(),
  age: z.number().int().min(0).max(110),
  pronouns: z.string(),
  kind: z.enum(["canon", "resident", "arrival", "animal"]),
  occupation: z.string(),
  workplace: HomePlace,
  home: HomePlace,
  portrait: z.string(),
  portrait_expressions: z.array(z.string()).min(1),
  sprite: z.string(),
  appearance: z.string(),
  backstory: z
    .string()
    .refine((s) => s.trim().split(/\s+/).length <= 120, "backstory must be 120 words or fewer"),
  personality: z.object({
    traits: z.array(z.string()).min(3).max(5),
    big5: z.object({ open: Score, conscientious: Score, extravert: Score, agreeable: Score, neurotic: Score }),
  }),
  values: Values,
  beliefs: z.array(z.string()).max(12),
  voice: z.union([HumanVoice, AnimalVoice]),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  fears: z.array(z.string()),
  dream: z.object({ text: z.string(), stages: z.array(z.string()).min(1) }),
  routine: z.object({ weekday: z.array(RoutineBlock).min(1), weekend: z.array(RoutineBlock).min(1) }),
  chores: z.array(z.string()),
  relationships: z.array(Relationship),
  secrets: z.array(Secret),
  canon_locks: z.array(CanonLock),
  story_role: z.string().optional(),
  will_scuffle: z.boolean().optional(),
  /** §9.11.3: `false` opts the resident out of romance (the ladder never starts for them). Absent means eligible. */
  romance: z.boolean().optional(),
});
export type PersonaCard = z.infer<typeof PersonaCard>;
