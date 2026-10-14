import { z } from "zod";
import { PlaceId } from "./ids";

/** Mutable resident state (GDD §9.4). Owned by the server; mirrored to the client per day. */

export const EMOTIONS = [
  "content", "cheerful", "excited", "tender", "wistful", "sad", "anxious", "irritated", "angry", "embarrassed",
] as const;
export const Emotion = z.enum(EMOTIONS);
export type Emotion = z.infer<typeof Emotion>;

export const Mood = z.object({
  valence: z.number().min(-100).max(100),
  energy: z.number().min(0).max(100),
  stress: z.number().min(0).max(100),
  emotion: Emotion,
  intensity: z.number().min(0).max(100),
});
export type Mood = z.infer<typeof Mood>;

export const Needs = z.object({
  rest: z.number().min(0).max(100),
  food: z.number().min(0).max(100),
  social: z.number().min(0).max(100),
  purpose: z.number().min(0).max(100),
  comfort: z.number().min(0).max(100),
});

export const Tier = z.enum(["core", "acquainted", "ambient"]);

export const ResidentState = z.object({
  id: z.string(),
  world_id: z.string(),
  tier: Tier,
  mood: Mood,
  needs: Needs,
  regard: z.number().min(-100).max(100),
  stances: z.record(z.string(), z.number().min(-100).max(100)),
  beliefs: z.array(z.string()).max(12),
  recent_topics: z.array(z.string()).max(10),
  dream: z.object({ stage: z.number().int().min(0), notes: z.string() }),
  stay: z.number().min(0).max(100),
  leaving_notice_since: z.number().int().nullable(),
  location: PlaceId.nullable(),
  flags: z.array(z.string()),
});
export type ResidentState = z.infer<typeof ResidentState>;

/** Regard tiers (GDD §10.2). */
export type RegardTier = "Wary" | "Stranger" | "Neighbor" | "Friend" | "Confidant";
export function regardTier(regard: number): RegardTier {
  if (regard < 0) return "Wary";
  if (regard < 20) return "Stranger";
  if (regard < 40) return "Neighbor";
  if (regard < 70) return "Friend";
  return "Confidant";
}

/** Mood bands used by Quiet Mode line selection (GDD Appendix B.1). */
export type MoodBand = "glum" | "low" | "even" | "bright" | "glowing";
export function moodBand(valence: number): MoodBand {
  const v = (valence + 100) / 2; // −100..100 → 0..100
  if (v < 20) return "glum";
  if (v < 40) return "low";
  if (v < 60) return "even";
  if (v < 80) return "bright";
  return "glowing";
}
