import { z } from "zod";

/** The engine's complete action vocabulary (GDD §9.7). Each verb has an animation set (§16.5). */
export const VERBS = [
  "work", "eat", "nap", "sleep", "shop", "socialize", "walk", "read", "garden", "fish", "play_music",
  "clean", "cook", "visit", "attend", "exercise", "tinker", "write", "pray", "wander", "sit", "volunteer",
] as const;
export const Verb = z.enum(VERBS);
export type Verb = z.infer<typeof Verb>;

/** Bastien's verbs. "follow" is a wander toward a person; "beg" is sitting near food with intent. */
export const ANIMAL_VERBS = ["sleep", "wander", "sit", "nap", "eat", "follow", "beg"] as const;
