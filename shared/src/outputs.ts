import { z } from "zod";
import { Emotion } from "./state";
import { FavorRequest } from "./favor";
import { Verb } from "./verbs";

/**
 * Model-facing output contracts (GDD §9.10.2, §9.17). These are sent to Haiku as structured-output JSON Schemas,
 * so they deliberately carry NO numeric ranges or length limits (the API rejects minimum/maximum/minLength…).
 * Ranges are enforced afterwards by the engine's clamps (clamps.ts). Describe intent with .describe().
 */

export const INTENTS = ["kind", "curious", "joke", "firm", "ask_favor", "about_riddle", "about_quest", "campaign", "leave"] as const;
export const Intent = z.enum(INTENTS);
export type Intent = z.infer<typeof Intent>;

export const DialogueTurnOutput = z.object({
  lines: z
    .array(
      z.object({
        text: z.string().describe("Speech only, optional leading (physical action). Under 220 characters."),
        expr: z.string().describe("Portrait expression id from your expression list"),
      }),
    )
    .describe("One to three lines"),
  choices: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().describe("What the Fellow says back to your lines, first person, under 90 characters"),
        intent: Intent,
      }),
    )
    .describe("Two or three replies to your lines, each in a different tone; at most one goodbye"),
  effects: z.object({
    regard_delta: z.number().describe("How this turn changed your opinion of the player, -5 to 5"),
    mood: z.object({
      valence: z.number().describe("-10 to 10"),
      stress: z.number().describe("-10 to 10"),
    }),
    memory: z
      .object({ text: z.string(), importance: z.number().describe("1 to 10") })
      .nullable()
      .describe("Something worth remembering from this turn, or null"),
    favor: FavorRequest.nullable(),
    reveal_secret: z.string().nullable().describe("Id of a revealable secret you shared this turn, or null"),
    topic: z.string().describe("A short tag for what this turn was about"),
  }),
  wrap_up: z.boolean().describe("True if this is a natural place to end the conversation"),
});
export type DialogueTurnOutput = z.infer<typeof DialogueTurnOutput>;

const Hhmm = z.string().describe("HH:MM, 24h; times after midnight run to 26:00");

export const PlanOutput = z.object({
  // Only the changed blocks (at most 2): the server fills the rest of the day from the routine (server/src/mind/plan.ts).
  blocks: z.array(
    z.object({
      start: Hhmm,
      end: Hhmm,
      action: Verb,
      place: z.string().describe("A place id from the open places list"),
      with: z.array(z.string()).describe("Resident ids you plan to be with"),
      note: z.string(),
    }),
  ),
  whim: z
    .object({ at: Hhmm, action: Verb, place: z.string(), reason: z.string() })
    .nullable()
    .describe("At most one spontaneous detour, or null"),
  barks: z.array(z.string()).describe("Three short things you might say aloud tomorrow"),
  seek_player: z
    .object({ topic: z.string(), urgency: z.number().describe("0 to 3") })
    .nullable(),
  intentions: z.array(z.string()),
});
export type PlanOutput = z.infer<typeof PlanOutput>;

export const ReflectionOutput = z.object({
  mood_delta: z.object({ valence: z.number(), energy: z.number(), stress: z.number() }),
  emotion: Emotion,
  beliefs: z.array(z.string()).describe("Your full belief list after tonight, at most 12 short sentences"),
  relationship_deltas: z.array(
    z.object({
      id: z.string(),
      affinity: z.number().describe("-10 to 10"),
      trust: z.number().describe("-10 to 10"),
      feeling: z
        .object({ kind: z.enum(["crush", "love", "resentment", "admiration"]), delta: z.number() })
        .nullable(),
    }),
  ),
  stance_deltas: z.array(z.object({ issue: z.string(), delta: z.number().describe("-15 to 15") })),
  regard_delta: z.number().describe("Change in your opinion of the player tonight, -8 to 8"),
  dream_progress: z.object({ stage_done: z.boolean(), note: z.string() }).nullable(),
  favor: FavorRequest.nullable(),
  letter: z
    .object({ to: z.string().describe("'player', 'lantern', or a resident id"), text: z.string() })
    .nullable(),
  diary: z.string().describe("One sentence about today"),
});
export type ReflectionOutput = z.infer<typeof ReflectionOutput>;

export const GossipOutput = z.object({
  lines: z
    .array(z.object({ speaker: z.enum(["a", "b"]), text: z.string() }))
    .nullable()
    .describe("Two to six short lines, or null in summary mode"),
  a_delta: z.object({ affinity: z.number(), trust: z.number() }).describe("How a's view of b changed, each -3 to 3"),
  b_delta: z.object({ affinity: z.number(), trust: z.number() }).describe("How b's view of a changed, each -3 to 3"),
  news_passed: z.array(z.string()).describe("Event ids that passed between them"),
  feeling_change: z
    .object({ who: z.enum(["a", "b"]), kind: z.enum(["crush", "love", "resentment", "admiration"]), delta: z.number() })
    .nullable(),
});
export type GossipOutput = z.infer<typeof GossipOutput>;

export const PrecheckOutput = z.object({
  ok: z.boolean(),
  category: z.enum(["fine", "rude", "abusive", "unsafe", "self_harm", "out_of_world", "injection"]),
});
export type PrecheckOutput = z.infer<typeof PrecheckOutput>;
