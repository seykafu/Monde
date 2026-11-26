import { FavorProof, LeavingFavorNotice } from "./favorEngine";
import { z } from "zod";
import { PlaceId } from "./ids";

// GDD-GAP: §9.6 gives no importance for a leaving notice or a departure.
export const EVENT_IMPORTANCE = { scuffle: 7, project_open: 6, sweeping: 2, leaving_notice: 6, departure: 5 } as const;
export const FERRY_SAILING_MINUTE = 9 * 60 + 30;
export const departureEventId = (resident: string, day: number): string => `departure_${resident}_${day}`;
const key = z.string().trim().min(1).max(200);
const stamp = { id: key, day: z.number().int().min(1).max(100_000), minute: z.number().int().min(0).max(1560) };
const cue = { ...stamp, resident: key, scene_id: key, cue_key: key };
const importance = z.number().int().min(1).max(10);

/** GDD-GAP: transport bounds aren't specified; 500 events / 1000 flags bound each request. */
export const CLIENT_EVENT_BATCH_LIMIT = 500;
export const ClientEvent = z.discriminatedUnion("kind", [
  z.object({ ...stamp, kind: z.literal("favor_choice"), resident: key, favor: key, accept: z.boolean(), offered_day: z.number().int().positive().optional(), notice: LeavingFavorNotice.optional() }),
  z.object({ ...stamp, kind: z.literal("favor_done"), resident: key, favor: key, proof: FavorProof }),
  z.object({
    ...stamp, kind: z.literal("town_event"),
    type: z.enum(["scuffle", "project_open", "sweeping", "leaving_notice", "departure"]), place: PlaceId,
    participants: z.array(key).max(500), summary: z.string().trim().min(1).max(200), importance,
  }).refine(e => e.importance === EVENT_IMPORTANCE[e.type], { path: ["importance"], message: "importance must match the event type" }),
  z.object({
    ...cue, kind: z.literal("scripted_memory"), place: PlaceId,
    text: z.string().trim().min(1).max(200), importance,
  }),
  z.object({ ...cue, kind: z.literal("scripted_regard"), delta: z.number().int().safe() }),
  // Full snapshots repair a missed offline delta; a persisted monotonic revision prevents stale retries.
  z.object({ ...stamp, kind: z.literal("flags"), revision: z.number().int().min(1).max(2_147_483_647),
    flags: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/).max(200)).max(1000) }),
  z.object({ ...stamp, kind: z.literal("gift"), resident: key, item: key }),
  z.object({ ...stamp, kind: z.literal("meal"), resident: key, item: key }),
  z.object({ ...stamp, kind: z.literal("community_work"), task: key, place: PlaceId, participants: z.array(key).max(500) }),
  // A stage of the resident's dream is done (client/src/quests/dreams.ts): `stage` is how many are done now, mirrored
  // into ResidentState.dream.stage (§9.4) so the prompt's dream stage moves on. Never lowers the stage.
  z.object({ ...stamp, kind: z.literal("dream_stage"), resident: key, stage: z.number().int().min(1).max(20) }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;
export const ClientEventBatch = z.array(ClientEvent).max(CLIENT_EVENT_BATCH_LIMIT);
export const RegardSnapshot = z.record(z.string(), z.number().int().min(-100).max(100));
export type RegardSnapshot = z.infer<typeof RegardSnapshot>;
export const EventIngestionResult = z.object({
  accepted: z.array(z.string()), duplicates: z.array(z.string()),
  rejected: z.array(z.object({ id: z.string(), reason: z.string() })), regard: RegardSnapshot,
});
export type EventIngestionResult = z.infer<typeof EventIngestionResult>;
