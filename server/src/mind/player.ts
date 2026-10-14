/**
 * The player's Fellowship application (GDD §11.1), stored on the world row and fed to dialogue prompts as the
 * <player> block (§9.10.1). Only the fields residents can know about live here; looks (build, hair…) are
 * client-only.
 */
import { z } from "zod";
import type { PlayerView } from "./promptBuilder.js";
import { lexicalHits } from "./filters.js";

export const BACKGROUNDS = ["homecomer", "tinkerer", "scrapper", "organizer"] as const;
/** "Why Monde?" (§11.1): a fresh start · to help · running from something · curious. */
export const WHY_MONDE = ["fresh_start", "to_help", "running_from_something", "curious"] as const;

const PRESET_PRONOUNS = ["she/her", "he/him", "they/them"] as const;
/** Custom pronouns are subject/object/possessive (§11.1), e.g. "xe/xem/xyr". */
const CUSTOM_PRONOUNS = /^[a-z]{1,8}\/[a-z]{1,8}\/[a-z]{1,8}$/;

export const PlayerName = z.string().trim().min(1).max(16, "name is at most 16 characters")
  .refine((name) => !/[<>{}\p{Cc}]/u.test(name), "name has characters that aren't allowed")
  .refine((name) => !lexicalHits(name).some((hit) => hit.group === "profanity"), "that name isn't allowed");

export const PlayerProfile = z.object({
  name: PlayerName,
  pronouns: z.string().trim().toLowerCase().refine(
    (p) => (PRESET_PRONOUNS as readonly string[]).includes(p) || CUSTOM_PRONOUNS.test(p),
    "pronouns are she/her, he/him, they/them or subject/object/possessive",
  ),
  background: z.enum(BACKGROUNDS),
  why: z.enum(WHY_MONDE),
  // GDD-GAP: §11.1 lists "Something you love" as a pick from 12 but names only six (rain, old books, the sea,
  // bread, music, puzzles…). Until the list is written down, accept one short lowercase phrase.
  loves: z.string().trim().toLowerCase().min(1).max(24).regex(/^[a-z][a-z '-]*$/, "loves is a short phrase"),
}).strict();
export type PlayerProfile = z.infer<typeof PlayerProfile>;

/** PATCH body: any subset of the profile. The merged result must be a complete profile. */
export const PlayerProfilePatch = PlayerProfile.partial().strict()
  .refine((patch) => Object.keys(patch).length > 0, "send at least one field");

const BACKGROUND_TEXT: Record<PlayerProfile["background"], string> = {
  homecomer: "Homecomer: lived in Monde until age twelve",
  tinkerer: "Tinkerer: fixes things",
  scrapper: "Scrapper: has been in fights and doesn't like them",
  organizer: "Organizer: has run things before",
};
const WHY_TEXT: Record<PlayerProfile["why"], string> = {
  fresh_start: "Came for a fresh start",
  to_help: "Came to help",
  running_from_something: "Running from something",
  curious: "Came out of curiosity",
};

/** Before the application is filled in (S01), residents just see "the Fellow". */
export const DEFAULT_PLAYER_VIEW: PlayerView = { name: "Fellow", pronouns: "they/them", background: "Newly arrived" };

/** The prompt's view of the player. Shared past for Homecomers is engine-supplied later (§12.1 rule 11). */
export function playerView(profile: PlayerProfile | null | undefined): PlayerView {
  if (!profile) return DEFAULT_PLAYER_VIEW;
  return {
    name: profile.name,
    pronouns: profile.pronouns,
    background: `${BACKGROUND_TEXT[profile.background]}. ${WHY_TEXT[profile.why]}. Loves ${profile.loves}`,
    sharedPast: null,
  };
}
