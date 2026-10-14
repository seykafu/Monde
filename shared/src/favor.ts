import { z } from "zod";

/** Favor templates (GDD §9.9). The model chooses a template and writes the text; the engine instantiates it. */
export const FAVOR_TEMPLATES = [
  "fetch", "deliver", "find", "repair", "introduce", "accompany", "help_chore", "persuade", "stand_up", "last_chance",
] as const;
export const FavorTemplate = z.enum(FAVOR_TEMPLATES);
export type FavorTemplate = z.infer<typeof FavorTemplate>;

/** MVP subset (MVP_PLAN §4.1). */
export const MVP_FAVOR_TEMPLATES: readonly FavorTemplate[] = [
  "fetch", "deliver", "find", "introduce", "help_chore", "last_chance",
];

export const FavorRequest = z.object({
  template: FavorTemplate.describe("Which kind of favor this is"),
  target: z.string().describe("Item id, resident id or place id the favor is about"),
  text: z.string().describe("The request in the resident's own voice, one or two sentences"),
});
export type FavorRequest = z.infer<typeof FavorRequest>;
