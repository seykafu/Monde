import { z } from "zod";
import { PlaceId, ResidentId } from "./ids";
import type { PersonaCard } from "./persona";

/**
 * Quest-aware conversations (Kasey's playtest, 2026-10-18: key characters "help the player progress through the
 * game and the main quests"). With each talk turn the client reports the player's main objective (the HUD's Next
 * hint, client/src/story/hint.ts) and this resident's open threads with the Fellow (a Favor they asked, a Project
 * they lead, a Mark they can help with) as `TalkContext.quest`. Everything here is something the HUD, the Journal or
 * the Ledger already shows the player: never a scene's lines, a secret or a riddle answer.
 *
 * The server (server/src/mind/quest.ts) decides whether any of it reaches the prompt, and only ever in block 4.
 */

const Text = (max: number) => z.string().trim().min(1).max(max);

/** Longest client text in a quest field; the client cuts to it (client/src/mind/quest.ts). */
export const QUEST_TEXT_MAX = 200;
/** At most this many threads per turn: the prompt stays small. */
export const QUEST_THREADS_MAX = 3;

/** The objective the Next hint names: a story scene's window, or a Project's opening (projects/attach.ts). */
export const QuestObjective = z.object({
  /** The scene (`s07a_chime_runs`) or the Project opening (`project:fountain`). */
  id: z.string().min(1).max(48),
  /** `zone.place` where it happens. */
  place: PlaceId,
  /** "Clocktower", or "Fountain Square in the Old Quarter" from another district. */
  where: Text(80),
  /** "this afternoon (16:00–17:45)", or "now, until 11:30" once the window is open. */
  when: Text(60),
  /** The hint's own reason: "Bertrand is at the clocktower." */
  reason: Text(120),
  /** Who it involves: the scene's cast or the Project's leads. Never rendered; the server matches the resident. */
  people: z.array(ResidentId).max(10),
});
export type QuestObjective = z.infer<typeof QuestObjective>;

export const QuestThread = z.discriminatedUnion("kind", [
  /** A Favor this resident asked and the Fellow took on (the Journal's Favors), in the resident's own words. */
  z.object({ kind: z.literal("favor"), text: Text(QUEST_TEXT_MAX), until: z.number().int().min(1) }),
  /** A Project this resident leads, begun and not yet open, with the Ledger's next step. */
  z.object({ kind: z.literal("project"), name: Text(60), next: Text(QUEST_TEXT_MAX) }),
  /** The Fellow has an unsolved Mark this resident can help with. No title or inscription: hints stay behind the guard. */
  z.object({ kind: z.literal("mark") }),
]);
export type QuestThread = z.infer<typeof QuestThread>;

export const TalkQuest = z.object({
  objective: QuestObjective.nullable(),
  threads: z.array(QuestThread).max(QUEST_THREADS_MAX),
});
export type TalkQuest = z.infer<typeof TalkQuest>;

/**
 * The key characters: the hand-written core cast (content/residents/*.yaml) and the census people finished by hand
 * (`curated: true`, content/residents/day1/). The cat never speaks, so he has no quest talk.
 */
export function isKeyCharacter(card: Pick<PersonaCard, "kind" | "generated_by" | "curated">): boolean {
  return card.kind !== "animal" && (!card.generated_by || card.curated === true);
}

/**
 * How the objective involves a key character: they're in it (the scene's cast, the Project's leads), or it happens at
 * their workplace or home; null for anyone else. The client offers its quest reply on it and the server keeps the
 * objective in block 4 on it, so both read it the same way.
 */
export function questInvolvement(
  objective: Pick<QuestObjective, "people" | "place"> | null | undefined,
  card: Pick<PersonaCard, "id" | "kind" | "generated_by" | "curated" | "home" | "workplace">,
): "cast" | "workplace" | "home" | null {
  if (!objective || !isKeyCharacter(card)) return null;
  if (objective.people.includes(card.id)) return "cast";
  if (objective.place === card.workplace) return "workplace";
  if (objective.place === card.home) return "home";
  return null;
}
