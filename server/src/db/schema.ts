import type { PersonaCard, ResidentState, PlanOutput, DialogueTurnOutput } from "@monde/shared";
import type { PlayerProfile } from "../mind/player.js";
import { pgTable, text, timestamp, uuid, integer, numeric, jsonb, boolean, bigserial, primaryKey, index } from "drizzle-orm/pg-core";

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const devices = pgTable("devices", {
  id: text("id").primaryKey(), inviteCode: text("invite_code").notNull(),
  createdAt: createdAt(), lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
export const worlds = pgTable("worlds", {
  id: uuid("id").primaryKey(), deviceId: text("device_id").notNull().references(() => devices.id),
  seed: integer("seed").notNull(), day: integer("day").notNull().default(1),
  minute: integer("minute").notNull().default(360), status: text("status").notNull(),
  branchId: uuid("branch_id").notNull(), createdAt: createdAt(),
  parentWorldId: uuid("parent_world_id"),
  aiSpendDay: integer("ai_spend_day").notNull(), aiSpendUsd: numeric("ai_spend_usd").notNull().default("0"),
  /** The Fellowship application (GDD §11.1), set by PATCH /v1/worlds/:w/player. Null until the player fills it in. */
  player: jsonb("player").$type<PlayerProfile>(),
  storyFlags: text("story_flags").array().notNull().default([]),
  flagsRevision: integer("flags_revision").notNull().default(0),
});
const worldId = () => uuid("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" });
export const residents = pgTable("residents", {
  worldId: worldId(),
  id: text("id").notNull(),
  card: jsonb("card").$type<PersonaCard>().notNull(),
  state: jsonb("state").$type<ResidentState>().notNull(),
  tier: text("tier").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** §9.11.2 talk ledger (shared/friendship.ts TalkLedger): the day `talk_gain` counts, and the last day they spoke. */
  talkDay: integer("talk_day"),
  talkGain: integer("talk_gain").notNull().default(0),
  lastTalkDay: integer("last_talk_day"),
}, (t) => [primaryKey({ columns: [t.worldId, t.id] })]);
export const relationships = pgTable("relationships", {
  worldId: worldId(),
  fromId: text("from_id").notNull(),
  toId: text("to_id").notNull(),
  affinity: integer("affinity").notNull(),
  trust: integer("trust").notNull(),
  tag: text("tag").notNull(),
  note: text("note").notNull(),
  feelingKind: text("feeling_kind"),
  feelingIntensity: integer("feeling_intensity").notNull().default(0),
  lastSeenDay: integer("last_seen_day"),
  /** §9.11.3 daily cap ledger (shared/friendship.ts AffinityEdge): capped net change applied on `net_day`. */
  netDay: integer("net_day"),
  net: integer("net").notNull().default(0),
  /** Encounters this pair has had (the ladder's "5+ shared encounters", §9.11.3). */
  encounters: integer("encounters").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.worldId, t.fromId, t.toId] })]);
/** §9.11.3 tie milestones: a pair's label changed on the night of `day` (a < b). Read by the dawn package. */
export const tieMilestones = pgTable("tie_milestones", {
  worldId: worldId(),
  day: integer("day").notNull(),
  aId: text("a_id").notNull(),
  bId: text("b_id").notNull(),
  kind: text("kind").notNull(),
  fromLabel: text("from_label").notNull(),
  toLabel: text("to_label").notNull(),
}, (t) => [primaryKey({ columns: [t.worldId, t.day, t.aId, t.bId] })]);
export const memories = pgTable("memories", {
  worldId: worldId(),
  id: text("id").notNull(),
  residentId: text("resident_id").notNull(),
  day: integer("day").notNull(),
  minute: integer("minute").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  who: text("who").array().notNull(),
  wherePlace: text("where_place").notNull(),
  importance: integer("importance").notNull(),
  valence: integer("valence").notNull(),
  sourceEvent: text("source_event"),
  archived: boolean("archived").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.worldId, t.id] }), index("memories_world_resident_day_idx").on(t.worldId, t.residentId, t.day)]);
export const events = pgTable("events", {
  worldId: worldId(),
  id: text("id").notNull(),
  day: integer("day").notNull(),
  minute: integer("minute").notNull(),
  type: text("type").notNull(),
  wherePlace: text("where_place").notNull(),
  who: text("who").array().notNull(),
  importance: integer("importance").notNull(),
  tags: text("tags").array().notNull(),
  summary: text("summary").notNull(),
}, (t) => [primaryKey({ columns: [t.worldId, t.id] }), index("events_world_day_idx").on(t.worldId, t.day)]);
export const plans = pgTable("plans", {
  worldId: worldId(),
  residentId: text("resident_id").notNull(),
  day: integer("day").notNull(),
  plan: jsonb("plan").$type<PlanOutput>().notNull(),
  source: text("source").$type<"model" | "template">().notNull(),
  promptVersion: text("prompt_version"),
}, (t) => [primaryKey({ columns: [t.worldId, t.residentId, t.day] })]);
export const favors = pgTable("favors", {
  worldId: worldId(),
  id: text("id").notNull(),
  residentId: text("resident_id").notNull(),
  template: text("template").notNull(),
  target: text("target").notNull(),
  text: text("text").notNull(),
  status: text("status").notNull(),
  createdDay: integer("created_day").notNull(),
  expiresDay: integer("expires_day").notNull(),
  reward: jsonb("reward").notNull(),
}, (t) => [primaryKey({ columns: [t.worldId, t.id] })]);
export const letters = pgTable("letters", {
  worldId: worldId(),
  id: text("id").notNull(),
  fromId: text("from_id").notNull(),
  toId: text("to_id").notNull(),
  day: integer("day").notNull(),
  text: text("text").notNull(),
  delivered: boolean("delivered").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.worldId, t.id] })]);
export const dialogueTurns = pgTable("dialogue_turns", {
  worldId: worldId(),
  id: text("id").notNull(),
  residentId: text("resident_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  day: integer("day").notNull(),
  minute: integer("minute").notNull(),
  playerInput: text("player_input"),
  output: jsonb("output").$type<DialogueTurnOutput>().notNull(),
  fallback: boolean("fallback").notNull(),
  rawOutput: text("raw_output"),
  promptUser: text("prompt_user"),
  /** 0-based exchange number inside the conversation (the id is `<conversation_id>/<turn_index>`). */
  turnIndex: integer("turn_index").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.worldId, t.id] }),
  index("dialogue_turns_world_conversation_idx").on(t.worldId, t.conversationId),
  index("dialogue_turns_world_resident_created_idx").on(t.worldId, t.residentId, t.createdAt),
]);
export const snapshots = pgTable("snapshots", {
  worldId: worldId(),
  id: uuid("id").notNull(),
  branchId: uuid("branch_id").notNull(),
  day: integer("day").notNull(),
  objectKey: text("object_key").notNull(),
  minute: integer("minute"),
  label: text("label"),
  checkpoint: boolean("checkpoint").notNull().default(false),
  payload: jsonb("payload").$type<import("../worlds/snapshots.js").SnapshotPayload>(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.worldId, t.id] })]);
export const aiLog = pgTable("ai_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  worldId: uuid("world_id").references(() => worlds.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), residentId: text("resident_id"),
  promptVersion: text("prompt_version").notNull(), model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(), cachedTokens: integer("cached_tokens").notNull(),
  cacheWriteTokens: integer("cache_write_tokens").notNull(), outputTokens: integer("output_tokens").notNull(),
  costUsd: numeric("cost_usd").notNull(), latencyMs: integer("latency_ms").notNull(),
  firstTokenMs: integer("first_token_ms"), stopReason: text("stop_reason").notNull(),
  validation: text("validation").notNull(), fallback: boolean("fallback").notNull(), createdAt: createdAt(),
});

/** Durable, world-scoped ingestion receipts, including scene cue aliases. */
export const processedClientEvents = pgTable("processed_client_events", {
  worldId: worldId(),
  key: text("key").notNull(),
}, (t) => [primaryKey({ columns: [t.worldId, t.key] })]);

/** D18: immutable prompt prefix and bounded live conversation. */
export const conversationSessions = pgTable("conversation_sessions", {
  worldId: worldId(), id: text("id").notNull(), residentId: text("resident_id").notNull(),
  openedDay: integer("opened_day").notNull(), openedMinute: integer("opened_minute").notNull(),
  lastDay: integer("last_day").notNull(), lastMinute: integer("last_minute").notNull(),
  closedDay: integer("closed_day"), closedMinute: integer("closed_minute"),
  exchanges: integer("exchanges").notNull().default(0), exchangeLimit: integer("exchange_limit").notNull().default(6),
  place: text("place").notNull(),
  resumeUntil: integer("resume_until").notNull().default(0),
  compacted: boolean("compacted").notNull().default(false),
  history: text("history").notNull(),
  system: jsonb("system").$type<import("@anthropic-ai/sdk").default.TextBlockParam[]>().notNull(),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.worldId, t.id] }), index("sessions_latest_idx").on(t.worldId, t.residentId, t.createdAt)]);
export const conversationSummaries = pgTable("conversation_summaries", {
  worldId: worldId(), conversationId: text("conversation_id").notNull(), residentId: text("resident_id").notNull(),
  day: integer("day").notNull(), minute: integer("minute").notNull(),
  summary: text("summary").notNull(),
  facts: jsonb("facts").$type<{ promises: string[]; asks: string[]; learned_about_player: string[] }>().notNull(),
  topics: text("topics").array().notNull(), feltAfter: text("felt_after").notNull(),
  digested: boolean("digested").notNull().default(false),
}, t => [primaryKey({ columns: [t.worldId, t.conversationId] })]);
export const conversationDigests = pgTable("conversation_digests", {
  worldId: worldId(), residentId: text("resident_id").notNull(), digest: text("digest").notNull(),
}, t => [primaryKey({ columns: [t.worldId, t.residentId] })]);

/**
 * G-02 arrivals (GDD §6.4, Appendix A.3): one row per generated household. `buffered` rows are written ahead by the
 * model (cards bound to `home.own`), so a ferry day never waits on it (§9.2's arrival buffer); a ferry day commits
 * them (`committed`: arrival day and home set, the residents inserted). Template households are written at commit
 * time when the buffer runs short, and `adopted` ones come from the client's Quiet Mode.
 */
export const arrivals = pgTable("arrivals", {
  worldId: worldId(),
  id: text("id").notNull(),
  status: text("status").$type<"buffered" | "committed">().notNull(),
  archetype: text("archetype").notNull(),
  /** The draw (archetype, members, portraits) the cards were written for. */
  draw: jsonb("draw").notNull(),
  /** The household's cards (PersonaCard[]), with `home.own` until committed. */
  cards: jsonb("cards").$type<PersonaCard[]>().notNull(),
  dreamTemplates: text("dream_templates").array().notNull(),
  summary: text("summary").notNull(),
  source: text("source").$type<"model" | "template">().notNull(),
  createdDay: integer("created_day").notNull(),
  arrivalDay: integer("arrival_day"),
  home: text("home"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.worldId, t.id] }), index("arrivals_world_status_idx").on(t.worldId, t.status)]);
