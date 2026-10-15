/**
 * The player's Fellowship application (GDD §11.1), stored on the world row and fed to dialogue prompts as the
 * <player> block (§9.10.1). The schema is shared with the client (@monde/shared player.ts); the server adds its
 * word filter on the name and stays the authority. Only the fields residents can know about live here; looks
 * (build, hair…) are client-only.
 *
 * Saving a profile also applies the Background's starting Regard (§11.1: a Homecomer starts at Regard 20 with
 * Pell, Bertrand, Odile, Hollis, Roz and Delphine). Regard lives on the server, so this is where it happens.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  PlayerName as SharedPlayerName, PlayerProfile as SharedPlayerProfile, ResidentState, regardStartsFor,
  type PlayerProfile as SharedProfile,
} from "@monde/shared";
import { residents, worlds } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import type { PlayerView } from "./promptBuilder.js";
import { lexicalHits } from "./filters.js";

export { BACKGROUNDS, WHY_MONDE, LOVES } from "@monde/shared";

export const PlayerName = SharedPlayerName
  .refine((name) => !lexicalHits(name).some((hit) => hit.group === "profanity"), "that name isn't allowed");

export const PlayerProfile = SharedPlayerProfile.extend({ name: PlayerName });
export type PlayerProfile = SharedProfile;

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
  running: "Running from something",
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

/** A stored profile, read leniently (older rows may predate a schema change); null if it no longer parses. */
export function storedProfile(raw: unknown): PlayerProfile | null {
  const parsed = SharedPlayerProfile.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Save a complete profile on the world and apply its Background's starting Regard, in one transaction. Regard
 * starts are floors (Regard already above them stays) and apply only when the Background changes, so re-sending
 * the same application never re-applies them. Returns the residents whose Regard was raised.
 */
export async function savePlayerProfile(db: WorldDatabase, worldId: string, before: PlayerProfile | null, after: PlayerProfile): Promise<string[]> {
  const starts = regardStartsFor(before, after);
  const ids = Object.keys(starts);
  return db.transaction(async (tx) => {
    await tx.update(worlds).set({ player: after }).where(eq(worlds.id, worldId));
    if (!ids.length) return [];
    const rows = await tx.select({ id: residents.id, state: residents.state }).from(residents)
      .where(and(eq(residents.worldId, worldId), inArray(residents.id, ids)));
    const raised: string[] = [];
    for (const row of rows) {
      const floor = starts[row.id]!;
      if (row.state.regard >= floor) continue;
      await tx.update(residents).set({ state: ResidentState.parse({ ...row.state, regard: floor }), updatedAt: new Date() })
        .where(and(eq(residents.worldId, worldId), eq(residents.id, row.id)));
      raised.push(row.id);
    }
    return raised.sort();
  });
}
