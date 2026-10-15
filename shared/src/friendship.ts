import type { PersonaCard } from "./persona";
import { moodBand } from "./state";

/**
 * Friendship (GDD §9.11, D16): hearts for the player's Regard, the earning rules and caps, the labels of ties
 * between residents, what moves their affinity, the Ambient encounter rule and who may court whom. The model
 * judges how a moment lands; these rules own the numbers. Pure: no I/O, no randomness (rolls are seeded).
 */

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

// ---------------------------------------------------------------------------------------------------------------
// Hearts (§9.11.1)
// ---------------------------------------------------------------------------------------------------------------

/** Regard runs −100..100 (§9.4). */
export const REGARD_MIN = -100;
export const REGARD_MAX = 100;

/** §9.11.1: 10 hearts, one per 10 Regard, half hearts at 5. */
export const HEARTS = { max: 10, regardPerHeart: 10, regardPerHalf: 5 } as const;

/** Hearts shown for a Regard value: 0..10 in steps of 0.5. Below 0 there are none (the row shows a cracked heart). */
export function heartsOf(regard: number): number {
  if (!(regard > 0)) return 0;
  return clampTo(Math.floor(regard / HEARTS.regardPerHalf) / 2, 0, HEARTS.max);
}

/** How the name plate draws a Regard value. */
export interface HeartRow {
  /** 0..10 in steps of 0.5. */
  hearts: number;
  /** Whole hearts. */
  full: number;
  /** A half heart after the whole ones. */
  half: boolean;
  /** Regard below 0 (Wary): a single cracked heart instead of the row. */
  cracked: boolean;
}
export function heartRow(regard: number): HeartRow {
  const hearts = heartsOf(regard);
  return { hearts, full: Math.floor(hearts), half: hearts % 1 !== 0, cracked: regard < 0 };
}

/** §9.11.2 feedback: a new whole heart plays the chime. */
export const gainedWholeHeart = (before: number, after: number): boolean => Math.floor(heartsOf(after)) > Math.floor(heartsOf(before));

// ---------------------------------------------------------------------------------------------------------------
// Earning Regard (§9.11.2, §11.4)
// ---------------------------------------------------------------------------------------------------------------

export type GiftReaction = "love" | "like" | "neutral" | "dislike";

/** §9.11.2 table. */
export const REGARD_EARNING = {
  /** First chat of the day, once per resident per day. */
  firstChat: 1,
  /** Conversation gains per resident per day. Losses are not capped. */
  talkDailyCap: 6,
  /** §11.4: gift reactions, doubled on the resident's birthday, one gift per resident per day, outside the talk cap. */
  gift: { love: 8, like: 4, neutral: 1, dislike: -4 } as Readonly<Record<GiftReaction, number>>,
  birthdayMultiplier: 2,
  giftsPerDay: 1,
  /** §9.9: a Favor done; the engine picks within the range. */
  favor: { min: 5, max: 15 },
  /** Work on a Project or community task they care about, per task. */
  caredTask: 2,
  /** Word of the player's deeds, per night (the reflection's clamp, LIMITS.reflection.regard). */
  wordOfDeeds: 8,
  /** Neglect: −1 per 3 days without a word, only at Friend and above, never below 40. */
  neglect: { days: 3, delta: -1, floor: 40 },
} as const;

/** §11.4: the Regard a gift is worth. */
export function giftRegard(reaction: GiftReaction, options: { birthday?: boolean } = {}): number {
  return REGARD_EARNING.gift[reaction] * (options.birthday ? REGARD_EARNING.birthdayMultiplier : 1);
}

/** What the server keeps per resident to enforce the talk rules. */
export interface TalkLedger {
  /** The day `gains` belongs to (null: never). */
  day: number | null;
  /** Conversation gains so far on `day` (the first-chat bonus included). */
  gains: number;
  /** The last day the player said a word to them (null: never). */
  lastTalkDay: number | null;
}
export const EMPTY_TALK_LEDGER: TalkLedger = { day: null, gains: 0, lastTalkDay: null };

/**
 * One proposed per-turn delta against today's conversation gains so far: gains stop at +6 a day, losses always
 * apply in full and don't give the allowance back. `applied` is before the −100..100 clamp.
 */
export function applyTalkDelta(proposed: number, gainsToday: number): { applied: number; gains: number; capped: boolean } {
  const delta = Math.round(Number.isFinite(proposed) ? proposed : 0);
  if (delta <= 0) return { applied: delta, gains: gainsToday, capped: false };
  const room = Math.max(0, REGARD_EARNING.talkDailyCap - gainsToday);
  const applied = Math.min(delta, room);
  return { applied, gains: gainsToday + applied, capped: applied < delta };
}

/** The applied Regard change of one dialogue turn, as the `turn` event reports it. */
export interface TurnRegard {
  before: number;
  after: number;
  /** after − before: the bonus, the capped reply judgment and the −100..100 clamp, all applied. */
  delta: number;
  hearts_before: number;
  hearts_after: number;
  /** This turn opened the day's talk with them (the +1 first-chat bonus was due). */
  first_chat: boolean;
  /** The reply judgment was cut by the daily cap. */
  capped: boolean;
}

/**
 * One dialogue turn on `day`: the first-chat bonus (if this is the day's first word with them), then the model's
 * proposed reply judgment (already clamped to ±5, ±7 with Heart), both under the day's +6 conversation cap.
 *
 * GDD-GAP: §9.11.2 lists the first-chat +1 on its own row, but the MVP acceptance (G-13) bounds everything the
 * player earns "from talk" at +6 a day, so the bonus is the first point of the six. A day of pleasant 0-judged
 * talk still earns +1; a day of good replies earns 6, not 7.
 */
export function applyTalkTurn(regard: number, ledger: TalkLedger, day: number, proposed: number): { regard: number; ledger: TalkLedger; change: TurnRegard } {
  // The client owns the clock, so a turn stamped earlier than the ledger counts against the ledger's day: the cap
  // never resets by going backwards, and only a later day is a new first chat.
  const today = ledger.day !== null && ledger.day > day ? ledger.day : day;
  const firstChat = ledger.lastTalkDay === null || day > ledger.lastTalkDay;
  let gains = ledger.day === today ? ledger.gains : 0;
  let total = 0;
  if (firstChat) {
    const bonus = applyTalkDelta(REGARD_EARNING.firstChat, gains);
    total += bonus.applied;
    gains = bonus.gains;
  }
  const reply = applyTalkDelta(proposed, gains);
  total += reply.applied;
  gains = reply.gains;
  const before = regard;
  const after = clampTo(regard + total, REGARD_MIN, REGARD_MAX);
  return {
    regard: after,
    ledger: { day: today, gains, lastTalkDay: Math.max(day, ledger.lastTalkDay ?? day) },
    change: {
      before, after, delta: after - before, hearts_before: heartsOf(before), hearts_after: heartsOf(after),
      first_chat: firstChat, capped: reply.capped,
    },
  };
}

/**
 * Neglect on the night of `day` (§9.11.2): −1 for every 3 full days without a word (on the 3rd, 6th, 9th… day of
 * silence), only above 40, and never taking Regard below 40. Never spoken to counts from the start of the game.
 * GDD-GAP: a night the client skipped (it played offline and caught up) doesn't accrue its neglect.
 */
export function neglectDelta(regard: number, lastTalkDay: number | null, day: number): number {
  const { days, delta, floor } = REGARD_EARNING.neglect;
  const silent = day - (lastTalkDay ?? 0);
  if (!(regard > floor) || silent < days || silent % days !== 0) return 0;
  return Math.max(floor, regard + delta) - regard;
}

// ---------------------------------------------------------------------------------------------------------------
// Residents and each other: labels (§9.11.3)
// ---------------------------------------------------------------------------------------------------------------

export const PAIR_LABELS = ["strangers", "acquaintances", "friends", "close_friends", "rivals", "enemies"] as const;
export type PairLabel = (typeof PAIR_LABELS)[number];

export const PAIR_LABEL_NAMES: Readonly<Record<PairLabel, string>> = {
  strangers: "Strangers", acquaintances: "Acquaintances", friends: "Friends", close_friends: "Close friends",
  rivals: "Rivals", enemies: "Enemies",
};

export interface PairEmote { id: "note" | "heart" | "ellipsis" | "anger"; glyph: string }
/** §9.11.3: the emote that floats over a pair when they meet (§16). */
export const PAIR_EMOTES: Readonly<Record<PairLabel, PairEmote | null>> = {
  strangers: null, acquaintances: null,
  friends: { id: "note", glyph: "♪" }, close_friends: { id: "heart", glyph: "♥" },
  rivals: { id: "ellipsis", glyph: "…" }, enemies: { id: "anger", glyph: "💢" },
};

/** Affinity runs −100..100 per directed pair (§9.4). */
export const AFFINITY_MIN = -100;
export const AFFINITY_MAX = 100;
/** "Friends" is the same 40 the Stay formula counts as `friends_in_town` (§6.4). */
export const FRIEND_AFFINITY = 40;

/** §9.11.3 thresholds on the mean of the two directions. */
export const PAIR_THRESHOLDS = { closeFriends: 70, friends: FRIEND_AFFINITY, rivals: -20, enemies: -60 } as const;

/**
 * The mean of the two directions, or null if neither exists (they've never met).
 * GDD-GAP: §9.11.3 assumes both directions exist. When only one does (a reflection noticed someone the other
 * hasn't), the missing side counts as 0: they've met, and one of them has no opinion yet.
 */
export function pairMean(ab: number | null | undefined, ba: number | null | undefined): number | null {
  if (ab == null && ba == null) return null;
  return ((ab ?? 0) + (ba ?? 0)) / 2;
}

/**
 * The label for a mean affinity. GDD-GAP: the table's bands leave gaps at the half points a mean can land on
 * (−19.5, −59.5); they go to the band nearer zero, so the cut-offs are m > −20 (Acquaintances) and m > −60 (Rivals).
 */
export function labelForMean(m: number): Exclude<PairLabel, "strangers"> {
  const t = PAIR_THRESHOLDS;
  if (m >= t.closeFriends) return "close_friends";
  if (m >= t.friends) return "friends";
  if (m > t.rivals) return "acquaintances";
  if (m > t.enemies) return "rivals";
  return "enemies";
}

/** A pair's label from its two directed affinities (null/undefined: no relationship row that way). */
export function pairLabel(ab: number | null | undefined, ba: number | null | undefined): PairLabel {
  const m = pairMean(ab, ba);
  return m === null ? "strangers" : labelForMean(m);
}

/** "Friends" for the Stay formula and life events: the pair's mean is 40 or more. */
export const areFriends = (ab: number | null | undefined, ba: number | null | undefined): boolean =>
  (pairMean(ab, ba) ?? -Infinity) >= FRIEND_AFFINITY;

export const TIE_MILESTONES = ["became_friends", "became_close_friends", "became_rivals", "became_enemies", "made_up"] as const;
export type TieMilestone = (typeof TIE_MILESTONES)[number];

const WARMTH: Readonly<Record<PairLabel, number>> = {
  enemies: 0, rivals: 1, strangers: 2, acquaintances: 2, friends: 3, close_friends: 4,
};
const isFeud = (label: PairLabel): boolean => label === "rivals" || label === "enemies";

/**
 * The milestone a label change makes (§9.11.3 "What the player sees"), or null. Warming into Friends or Close
 * friends, cooling into Rivals or Enemies, or leaving Rivals/Enemies altogether ("made up"). Drifting the other way
 * (Close friends → Friends, Enemies → Rivals, Friends → Acquaintances) and first meetings are not milestones.
 */
export function tieMilestone(from: PairLabel, to: PairLabel): TieMilestone | null {
  if (from === to) return null;
  if (isFeud(from) && !isFeud(to)) return "made_up";
  if (WARMTH[to] > WARMTH[from]) {
    if (to === "close_friends") return "became_close_friends";
    if (to === "friends") return "became_friends";
    return null;
  }
  if (to === "rivals" && WARMTH[from] > WARMTH.rivals) return "became_rivals";
  if (to === "enemies") return "became_enemies";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// What moves affinity (§9.11.3)
// ---------------------------------------------------------------------------------------------------------------

export type AffinitySource = "encounter" | "together" | "meeting" | "gossip" | "introduce_favor" | "drift" | "ladder";

/** §9.11.3 "What moves affinity" (each direction). */
export const AFFINITY_SOURCES = {
  /** An encounter, summary or live: −3..+3 (model-judged for Core/Acquainted pairs, by rule for Ambient pairs). */
  encounter: 3,
  /** Planned time together: `companions` in a plan, a `visit` that happens. */
  together: 1,
  /** A town meeting where both hold a stance of 30+ on the issue: +1 same side, −1 opposite sides. */
  meeting: { stance: 30, sameSide: 1, oppositeSide: -1 },
  /** Gossip heard about the other (nightly reflection): −10..+10 (LIMITS.reflection.relationship). */
  gossip: 10,
  /** The player's `introduce` Favor. */
  introduceFavor: 10,
  /** A week without meeting: 1 toward 40, only above 40. */
  drift: { days: 7, step: 1, target: FRIEND_AFFINITY },
  /** A pair's net change per day, each direction, except the Favor and the ladder's events. */
  dailyCap: 6,
} as const;

/** Sources outside the ±6 daily cap (§9.11.3). */
export const UNCAPPED_AFFINITY_SOURCES: readonly AffinitySource[] = ["introduce_favor", "ladder"];

/** A source's own range, before the daily cap. */
export function clampSourceDelta(source: AffinitySource, delta: number): number {
  const d = Math.round(Number.isFinite(delta) ? delta : 0);
  const s = AFFINITY_SOURCES;
  switch (source) {
    case "encounter": return clampTo(d, -s.encounter, s.encounter);
    case "together": return clampTo(d, 0, s.together);
    case "meeting": return clampTo(d, s.meeting.oppositeSide, s.meeting.sameSide);
    case "gossip": return clampTo(d, -s.gossip, s.gossip);
    case "introduce_favor": return clampTo(d, 0, s.introduceFavor);
    case "drift": return clampTo(d, -s.drift.step, s.drift.step);
    case "ladder": return d;
  }
}

/** One directed relationship's affinity and its daily ledger. */
export interface AffinityEdge {
  affinity: number;
  /** The day `net` belongs to (null: nothing moved it yet). */
  netDay: number | null;
  /** Net capped change applied on `netDay`. */
  net: number;
}

/**
 * Apply one change from `source` on `day`: the source's range, then (unless the source is uncapped) the ±6 net
 * daily window, then −100..100. `applied` is what actually moved.
 */
export function applyAffinity(edge: AffinityEdge, day: number, delta: number, source: AffinitySource): { edge: AffinityEdge; applied: number } {
  const wanted = clampSourceDelta(source, delta);
  const net = edge.netDay === day ? edge.net : 0;
  const capped = !UNCAPPED_AFFINITY_SOURCES.includes(source);
  const cap = AFFINITY_SOURCES.dailyCap;
  const allowed = capped ? clampTo(net + wanted, -cap, cap) - net : wanted;
  const affinity = clampTo(edge.affinity + allowed, AFFINITY_MIN, AFFINITY_MAX);
  const applied = affinity - edge.affinity;
  return { edge: { affinity, netDay: day, net: capped ? net + applied : net }, applied };
}

/** §9.11.3: a town meeting where both hold a stance of 30+ on the issue. */
export function meetingDelta(stanceA: number, stanceB: number): number {
  const { stance, sameSide, oppositeSide } = AFFINITY_SOURCES.meeting;
  if (Math.abs(stanceA) < stance || Math.abs(stanceB) < stance) return 0;
  return Math.sign(stanceA) === Math.sign(stanceB) ? sameSide : oppositeSide;
}

/**
 * §9.11.3 drift on the night of `day`: 1 toward 40 for every full week without meeting (the 7th, 14th… day since
 * they last met), only above 40. Never met in play counts from the start of the game.
 */
export function driftDelta(affinity: number, lastSeenDay: number | null, day: number): number {
  const { days, step, target } = AFFINITY_SOURCES.drift;
  const apart = day - (lastSeenDay ?? 0);
  if (!(affinity > target) || apart < days || apart % days !== 0) return 0;
  return Math.max(target, affinity - step) - affinity;
}

/**
 * §9.11.3 Ambient rule (no model call): +1 when both moods are "even" or better, −1 when either is "glum" and the
 * pair's affinity is below 0, 0 otherwise. GDD-GAP: "the pair's affinity" is the mean of the two directions
 * (strangers count as 0), and the same delta goes both ways.
 */
export function ambientEncounterDelta(valenceA: number, valenceB: number, pairAffinity: number | null): number {
  const a = moodBand(valenceA);
  const b = moodBand(valenceB);
  const evenOrBetter = (band: typeof a) => band === "even" || band === "bright" || band === "glowing";
  if (evenOrBetter(a) && evenOrBetter(b)) return 1;
  if ((a === "glum" || b === "glum") && (pairAffinity ?? 0) < 0) return -1;
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Encounters (§9.11.3)
// ---------------------------------------------------------------------------------------------------------------

/**
 * GDD-GAP: §9.11.3 says the encounter chance "rises with affinity and with shared unresolved topics" without a
 * formula. Chance = 0.30 + 0.003 × m (the pair's mean affinity; strangers 0), +0.5 when one of them planned the
 * time together (named the other in a plan block), clamped to 0.05..0.95. So two strangers crossing in the market
 * meet 30% of the time, Friends at 60 about half the time, Enemies at −60 one time in eight, and a planned visit
 * almost always. Shared unresolved topics aren't tracked yet, so they add nothing.
 */
export const ENCOUNTER_CHANCE = { base: 0.3, perAffinity: 0.003, planned: 0.5, min: 0.05, max: 0.95 } as const;
export function encounterChance(meanAffinity: number | null, planned: boolean): number {
  const c = ENCOUNTER_CHANCE;
  return clampTo(c.base + c.perAffinity * (meanAffinity ?? 0) + (planned ? c.planned : 0), c.min, c.max);
}

/** The two ids of a pair in a stable order. */
export const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
/** A pair's key, the same whichever way round: "june+odile". */
export const pairKey = (a: string, b: string): string => orderedPair(a, b).join("+");

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A deterministic number in [0, 1) from its parts (FNV-1a, finished with one mulberry32 step). */
export function seededUnit(...parts: readonly (string | number)[]): number {
  let t = (fnv1a(parts.join("|")) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The encounter roll for a pair on a day in a world: the same every time, whichever way round the pair is named. */
export const encounterRoll = (worldSeed: number | string, day: number, a: string, b: string): number =>
  seededUnit("encounter", worldSeed, day, pairKey(a, b));

// ---------------------------------------------------------------------------------------------------------------
// Romance rules (§9.11.3 "Feelings and the ladder"; the ladder itself is G-12)
// ---------------------------------------------------------------------------------------------------------------

/** §9.11.3: both residents are adults. */
export const ADULT_AGE = 18;

/**
 * Relationship tags that mark family (cards use mother, father, son, nephew, grandmother, cousin, brother so far).
 * GDD-GAP: the tag vocabulary is authored per card; this is every kin word a card could reasonably use.
 */
export const FAMILY_TAGS: ReadonlySet<string> = new Set([
  "family", "kin", "parent", "mother", "father", "mum", "mom", "dad", "child", "son", "daughter", "sibling",
  "brother", "sister", "twin", "half_brother", "half_sister", "stepmother", "stepfather", "stepson", "stepdaughter",
  "stepbrother", "stepsister", "grandparent", "grandmother", "grandfather", "grandchild", "grandson",
  "granddaughter", "aunt", "uncle", "niece", "nephew", "cousin",
]);

/**
 * Romance stages kept as per-resident flags `<stage>:<partner id>` (e.g. "courting:kasimir" on Priya).
 * GDD-GAP: the ladder (Crush → Courting → Together → Wedding) is G-12's; Crush is a feeling, not a flag, and a
 * wedding leaves the pair "married". These are the flag names G-12 should set.
 */
export const ROMANCE_STAGES = ["courting", "together", "married"] as const;
export type RomanceStage = (typeof ROMANCE_STAGES)[number];
export const romanceFlag = (stage: RomanceStage, partnerId: string): string => `${stage}:${partnerId}`;

/** Every partner a resident's flags name, with the stage. */
export function romancePartners(flags: readonly string[]): { stage: RomanceStage; id: string }[] {
  return flags.flatMap((flag) => {
    const colon = flag.indexOf(":");
    const stage = flag.slice(0, colon);
    return colon > 0 && (ROMANCE_STAGES as readonly string[]).includes(stage) && flag.length > colon + 1
      ? [{ stage: stage as RomanceStage, id: flag.slice(colon + 1) }] : [];
  });
}

/** The furthest stage either resident's flags record for the pair, or null. */
export function romanceStageOf(aId: string, aFlags: readonly string[], bId: string, bFlags: readonly string[]): RomanceStage | null {
  let best = -1;
  for (const p of [...romancePartners(aFlags).filter((x) => x.id === bId), ...romancePartners(bFlags).filter((x) => x.id === aId)]) {
    best = Math.max(best, ROMANCE_STAGES.indexOf(p.stage));
  }
  return best < 0 ? null : ROMANCE_STAGES[best]!;
}

export type RomanceCard = Pick<PersonaCard, "id" | "age" | "kind" | "relationships" | "romance">;
export interface RomanceCandidate { card: RomanceCard; flags: readonly string[] }
export type RomanceBlock = "same" | "minor" | "animal" | "opted_out" | "family" | "taken";

/** Are these two the same family? Either card naming the other with a family tag is enough. */
export function areFamily(a: RomanceCard, b: RomanceCard): boolean {
  const kin = (from: RomanceCard, to: string) => from.relationships.some((r) => r.id === to && FAMILY_TAGS.has(r.tag.toLowerCase()));
  return kin(a, b.id) || kin(b, a.id);
}

/**
 * §9.11.3 romance rules: both adults (18+), not family, neither courting or together with someone else, and
 * neither card opted out (`romance: false`). Animals never. The player is never a candidate (D13).
 */
export function romanceEligibility(a: RomanceCandidate, b: RomanceCandidate): { ok: true } | { ok: false; reason: RomanceBlock } {
  if (a.card.id === b.card.id) return { ok: false, reason: "same" };
  if (a.card.kind === "animal" || b.card.kind === "animal") return { ok: false, reason: "animal" };
  if (a.card.age < ADULT_AGE || b.card.age < ADULT_AGE) return { ok: false, reason: "minor" };
  if (a.card.romance === false || b.card.romance === false) return { ok: false, reason: "opted_out" };
  if (areFamily(a.card, b.card)) return { ok: false, reason: "family" };
  const elsewhere = (self: RomanceCandidate, other: string) => romancePartners(self.flags).some((p) => p.id !== other);
  if (elsewhere(a, b.card.id) || elsewhere(b, a.card.id)) return { ok: false, reason: "taken" };
  return { ok: true };
}
export const romanceEligible = (a: RomanceCandidate, b: RomanceCandidate): boolean => romanceEligibility(a, b).ok;

/** Feelings that are romance: the engine drops them between residents who may not court (§9.11.3, §9.13). */
export const ROMANTIC_FEELINGS: ReadonlySet<string> = new Set(["crush", "love"]);

// ---------------------------------------------------------------------------------------------------------------
// Wire shapes (dawn package `ties`, GET /v1/worlds/:w/dawn/:day)
// ---------------------------------------------------------------------------------------------------------------

/** One pair of residents who have met, ids in order (a < b). */
export interface TieView {
  a: string;
  b: string;
  label: Exclude<PairLabel, "strangers">;
  /** From the residents' flags; null when they aren't courting. */
  romance: RomanceStage | null;
}

/** A label change recorded on the night of `day`. */
export interface TieMilestoneView {
  day: number;
  a: string;
  b: string;
  kind: TieMilestone;
  from: PairLabel;
  to: PairLabel;
}

export interface DawnTies {
  pairs: TieView[];
  /** Milestones from the night before this dawn. */
  milestones: TieMilestoneView[];
}
