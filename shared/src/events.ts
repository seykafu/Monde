import { FavorProof, LeavingFavorNotice } from "./favorEngine";
import { z } from "zod";
import { PlaceId } from "./ids";

/** GDD-GAP: §9.6 refers to an event table but only supplies these three values.
 * Restrict ingestion to those authored types until the remaining table is specified. */
export const EVENT_IMPORTANCE = { scuffle: 7, project_open: 6, sweeping: 2 } as const;
const key = z.string().trim().min(1).max(200);
const stamp = { id: key, day: z.number().int().min(1).max(100_000), minute: z.number().int().min(0).max(1560) };
const cue = { ...stamp, resident: key, scene_id: key, cue_key: key };
const importance = z.number().int().min(1).max(10);

/** GDD-GAP: transport bounds aren't specified; 500 events / 1000 flags bound each request. */
export const CLIENT_EVENT_BATCH_LIMIT = 500;
export const ClientEvent = z.discriminatedUnion("kind", [
  z.object({ ...stamp, kind: z.literal("favor_choice"), resident: key, favor: key, accept: z.boolean(), notice: LeavingFavorNotice.optional() }),
  z.object({ ...stamp, kind: z.literal("favor_done"), resident: key, favor: key, proof: FavorProof }),
  z.object({
    ...stamp, kind: z.literal("town_event"),
    type: z.enum(["scuffle", "project_open", "sweeping"]), place: PlaceId,
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
