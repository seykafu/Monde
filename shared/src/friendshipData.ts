import { Press, PressEventData } from "./press";
import { Favor } from "./favorEngine";
import { z } from "zod";
import { PAIR_LABELS, ROMANCE_STAGES, TIE_MILESTONES } from "./friendship";
import { PlanOutput } from "./outputs";

/**
 * Friendship as data (GDD §9.11, §6.6; MVP G-13 client): the dawn package's pieces as the client reads them off the
 * wire (GET /v1/worlds/:w/dawn/:day, server/src/mind/dawn.ts), and the `friendship` section of a save, which keeps
 * what the client knows between sessions: the Regard it mirrors per resident, the last ties and milestones, which
 * ties the player has learned, and the dawn's letters and Favors for the tasks that will show them.
 */

const n = z.number().finite();
const day = n.int().positive();

/** One pair of residents who have met (shared TieView). */
export const TieData = z.object({
  a: z.string(), b: z.string(),
  label: z.enum(PAIR_LABELS).exclude(["strangers"]),
  romance: z.enum(ROMANCE_STAGES).nullable(),
});
export type TieData = z.infer<typeof TieData>;

/** A label change recorded on the night of `day` (shared TieMilestoneView). */
export const TieMilestoneData = z.object({
  day, a: z.string(), b: z.string(), kind: z.enum(TIE_MILESTONES), from: z.enum(PAIR_LABELS), to: z.enum(PAIR_LABELS),
});
export type TieMilestoneData = z.infer<typeof TieMilestoneData>;

/** A letter written last night (§9.7), handed over once. */
export const DawnLetterData = z.object({ id: z.string(), from: z.string(), to: z.string(), day, text: z.string() });
export type DawnLetterData = z.infer<typeof DawnLetterData>;

/** A Favor proposed since yesterday and still open (§9.9). */
export const DawnFavorData = z.object({
  id: z.string(), resident_id: z.string(), template: z.string(), target: z.string(), text: z.string(),
  created_day: n.int(), expires_day: n.int(), contract: Favor.optional(),
});
export type DawnFavorData = z.infer<typeof DawnFavorData>;

/** One resident's plan in the dawn package. `plan` is checked on its own (DawnPlanData then PlanOutput). */
export const DawnPlanData = z.object({
  resident_id: z.string(), tier: z.string(), source: z.enum(["model", "template"]), plan: z.unknown(),
});
export type DawnPlanData = z.infer<typeof DawnPlanData>;

/** How the player learned a tie (§9.11.3 "What the player sees"). */
export const TIE_SOURCES = ["seen", "heard", "read"] as const;
export type TieSource = (typeof TIE_SOURCES)[number];

/** What the client mirrors of one resident's friendship with the player. */
export const SavedBond = z.object({
  /** Regard toward the player, −100..100: the server's last word, or the client's seed until there is one. */
  regard: n.min(-100).max(100),
  /** "server": from a `turn` event's applied Regard. "seed": the Background's start, or 0 (Quiet Mode never earns). */
  source: z.enum(["server", "seed"]),
  /** The first day the player spoke with them (the People page lists only residents met). */
  met_day: day,
  last_talk_day: day,
  /** Gift likes the player has learned (§9.11.3; gifts are a later task). */
  likes: z.array(z.string()),
});
export type SavedBond = z.infer<typeof SavedBond>;

export const SavedFriendship = z.object({
  /** Directed resident-to-resident Regard, distinct from Regard toward the player. */
  resident_regard: z.record(z.string(), z.record(z.string(), n.min(-100).max(100))).optional(),
  option_regard_applied: z.boolean().optional(),
  favor_book: z.array(Favor).default([]),
  papers: z.array(Press).default([]),
  news_log: z.array(PressEventData).default([]),
  residents: z.record(z.string(), SavedBond),
  /** The last ties the server sent, and the dawn they came with; null until the first online dawn. */
  ties: z.object({ day, pairs: z.array(TieData) }).nullable(),
  /** Tie milestones from recent dawns (the Dawn Report's lines, §6.6). */
  milestones: z.array(TieMilestoneData),
  /** Pair key ("june+odile") → when and how the player learned the tie. */
  known_ties: z.record(z.string(), z.object({ day, how: z.enum(TIE_SOURCES) })),
  /** Resident id → detail tier from the last dawn ("core", "acquainted", "ambient"). */
  tiers: z.record(z.string(), z.string()),
  /** The model plans that replaced template routines on `day`. */
  plans: z.object({ day, plans: z.record(z.string(), PlanOutput) }).nullable(),
  letters: z.array(DawnLetterData),
  favors: z.array(DawnFavorData),
  /** The friendship lines of the latest dawn summary (milestones and romance news), for the Dawn Report (M-10). */
  report: z.object({ day, lines: z.array(z.string()) }).nullable(),
  /**
   * M-06: every resident's Regard toward the player as the server last reported it (a turn's applied Regard, the
   * events reply, the dawn package), met or not. Absent in older saves: nothing reported yet.
   */
  regard: z.record(z.string(), n.min(-100).max(100)).default({}),
});
export type SavedFriendship = z.infer<typeof SavedFriendship>;

export const emptyFriendship = (): SavedFriendship => ({
  favor_book: [], papers: [], news_log: [], residents: {}, ties: null, milestones: [], known_ties: {}, tiers: {}, plans: null, letters: [], favors: [], report: null, regard: {},
});
