/** W-06 / GDD §19.5. JSONB is the MVP store; TODO/GDD-GAP: move payloads to Tigris. */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import * as s from "../db/schema.js";
import { LIVE_FAVOR_STATUSES } from "../mind/context.js";
import type { NightRunner } from "../mind/night.js";
import type { WorldDatabase } from "./createWorld.js";
import { worldToken } from "./routes.js";

// GDD-GAP: MVP storage/rate limits are unspecified. Keep 12, cap at 2 MiB, one per game minute.
export const SNAPSHOT_LIMIT = 12;
export const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
type JsonRow<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] };
export interface SnapshotPayload {
  version: 1;
  processedClientEvents?: (typeof s.processedClientEvents.$inferSelect)[];
  world: JsonRow<typeof s.worlds.$inferSelect>;
  residents: JsonRow<typeof s.residents.$inferSelect>[];
  relationships: (typeof s.relationships.$inferSelect)[];
  memories: (typeof s.memories.$inferSelect)[];
  events: (typeof s.events.$inferSelect)[];
  plans: (typeof s.plans.$inferSelect)[];
  favors: (typeof s.favors.$inferSelect)[];
  letters: (typeof s.letters.$inferSelect)[];
  tieMilestones: (typeof s.tieMilestones.$inferSelect)[];
  /** Turns of conversations not yet compacted; compacted ones live on as summaries and the digest (§9.10.3). */
  dialogueTurns: JsonRow<typeof s.dialogueTurns.$inferSelect>[];
  conversationSessions?: JsonRow<typeof s.conversationSessions.$inferSelect>[];
  conversationSummaries?: (typeof s.conversationSummaries.$inferSelect)[];
  conversationDigests?: (typeof s.conversationDigests.$inferSelect)[];
}
const Body = z.object({
  day: z.number().int().min(1).max(100_000), minute: z.number().int().min(0).max(1439),
  label: z.string().trim().min(1).max(200),
});
class SnapshotError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function registerSnapshotRoutes(app: FastifyInstance, config: Config, db: WorldDatabase | undefined, runner?: NightRunner) {
  // Auth is the shared /v1/worlds/:w preHandler from worlds/routes.ts.
  app.post<{ Params: { w: string } }>("/v1/worlds/:w/snapshots", async (request, reply) => {
    const parsed = Body.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid snapshot: day, minute and label required" });
    if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const worldId = request.params.w;
    const { day, minute, label } = parsed.data;
    // Don't capture this process's partially completed dawn. SQL isolation also gives all tables one view.
    await runner?.idle(worldId);
    try {
      return await db.transaction(async (tx) => {
        const [world] = await tx.select().from(s.worlds).where(eq(s.worlds.id, worldId)).for("update");
        if (!world) throw new SnapshotError(404, "World not found");
        if (day < world.day) throw new SnapshotError(409, "snapshot day precedes the world's completed night");
        const existing = await tx.select({ id: s.snapshots.id, day: s.snapshots.day, minute: s.snapshots.minute, checkpoint: s.snapshots.checkpoint })
          .from(s.snapshots).where(eq(s.snapshots.worldId, worldId))
          .orderBy(asc(s.snapshots.createdAt), asc(s.snapshots.id));
        if (existing.some((row) => row.day === day && row.minute === minute)) {
          throw new SnapshotError(429, "Only one snapshot per in-game minute is allowed");
        }
        // The current wire format has no kind. Day-70 dawn can be pinned locally under an ordinary dawn label.
        // GDD-GAP: named custom checkpoints need a future explicit kind; accept checkpoint: labels meanwhile.
        const checkpoint = (day === 70 && minute === 360) || label === "Campaign Season" || label.startsWith("checkpoint:");
        const remove = existing.filter((row) => !row.checkpoint).slice(0, Math.max(0, existing.length + 1 - SNAPSHOT_LIMIT));
        if (existing.length + 1 - remove.length > SNAPSHOT_LIMIT) {
          throw new SnapshotError(409, "Snapshot storage is full of protected checkpoints");
        }
        const data = {
          processedClientEvents: await tx.select().from(s.processedClientEvents).where(eq(s.processedClientEvents.worldId, worldId)),
          version: 1, world: { ...world, day, minute },
          residents: await tx.select().from(s.residents).where(eq(s.residents.worldId, worldId)),
          relationships: await tx.select().from(s.relationships).where(eq(s.relationships.worldId, worldId)),
          memories: await tx.select().from(s.memories).where(eq(s.memories.worldId, worldId)),
          events: await tx.select().from(s.events).where(eq(s.events.worldId, worldId)),
          plans: await tx.select().from(s.plans).where(and(eq(s.plans.worldId, worldId), inArray(s.plans.day, [day, day + 1]))),
          favors: await tx.select().from(s.favors).where(and(eq(s.favors.worldId, worldId), inArray(s.favors.status, [...LIVE_FAVOR_STATUSES]))),
          letters: await tx.select().from(s.letters).where(and(eq(s.letters.worldId, worldId), eq(s.letters.delivered, false))),
          tieMilestones: await tx.select().from(s.tieMilestones).where(eq(s.tieMilestones.worldId, worldId)),
          ...await conversationState(tx, worldId),
        };
        const json = JSON.stringify(data);
        const bytes = Buffer.byteLength(json, "utf8");
        request.log.info({ worldId, bytes, cap: SNAPSHOT_MAX_BYTES }, "world snapshot size");
        if (bytes > SNAPSHOT_MAX_BYTES) throw new SnapshotError(413, "Snapshot exceeds the 2 MiB size limit");
        const id = randomUUID();
        await tx.insert(s.snapshots).values({
          worldId, id, branchId: world.branchId, day, minute, label, checkpoint,
          objectKey: `jsonb:${id}`, payload: JSON.parse(json) as SnapshotPayload,
        });
        if (remove.length) await tx.delete(s.snapshots).where(and(eq(s.snapshots.worldId, worldId), inArray(s.snapshots.id, remove.map((r) => r.id))));
        return { snapshot_id: id, branch_id: world.branchId };
      }, { isolationLevel: "serializable" });
    } catch (error) { return failure(error, reply); }
  });

  app.post<{ Params: { w: string; id: string } }>("/v1/worlds/:w/snapshots/:id/restore", async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: "invalid snapshot id" });
    if (!db) return reply.code(503).send({ error: "Database unavailable" });
    try {
      const world = await db.transaction(async (tx) => {
        const [snapshot] = await tx.select().from(s.snapshots).where(and(eq(s.snapshots.worldId, request.params.w), eq(s.snapshots.id, request.params.id)));
        if (!snapshot?.payload) throw new SnapshotError(404, "Snapshot not found");
        const p = snapshot.payload;
        if (p.version !== 1) throw new SnapshotError(409, "Unsupported snapshot version");
        const worldId = randomUUID();
        const [branch] = await tx.insert(s.worlds).values({
          ...p.world, id: worldId, branchId: randomUUID(), parentWorldId: request.params.w, createdAt: new Date(),
        }).returning();
        if (p.residents.length) await tx.insert(s.residents).values(p.residents.map((r) => ({ ...r, worldId, state: { ...r.state, world_id: worldId }, updatedAt: new Date(r.updatedAt) })));
        if (p.relationships.length) await tx.insert(s.relationships).values(p.relationships.map((r) => ({ ...r, worldId })));
        if (p.memories.length) await tx.insert(s.memories).values(p.memories.map((r) => ({ ...r, worldId })));
        if (p.processedClientEvents?.length) await tx.insert(s.processedClientEvents).values(p.processedClientEvents.map(r => ({ ...r, worldId })));
        if (p.events.length) await tx.insert(s.events).values(p.events.map((r) => ({ ...r, worldId })));
        if (p.plans.length) await tx.insert(s.plans).values(p.plans.map((r) => ({ ...r, worldId })));
        if (p.favors.length) await tx.insert(s.favors).values(p.favors.map((r) => ({ ...r, worldId })));
        if (p.letters.length) await tx.insert(s.letters).values(p.letters.map((r) => ({ ...r, worldId })));
        if (p.tieMilestones.length) await tx.insert(s.tieMilestones).values(p.tieMilestones.map((r) => ({ ...r, worldId })));
        if (p.dialogueTurns.length) await tx.insert(s.dialogueTurns).values(p.dialogueTurns.map((r) => ({ ...r, worldId, createdAt: new Date(r.createdAt) })));
        if (p.conversationSessions?.length) await tx.insert(s.conversationSessions).values(p.conversationSessions.map((r) => ({ ...r, worldId, createdAt: new Date(r.createdAt) })));
        if (p.conversationSummaries?.length) await tx.insert(s.conversationSummaries).values(p.conversationSummaries.map((r) => ({ ...r, worldId })));
        if (p.conversationDigests?.length) await tx.insert(s.conversationDigests).values(p.conversationDigests.map((r) => ({ ...r, worldId })));
        return branch!;
      });
      return { world_id: world.id, token: worldToken(world.id, world.deviceId, config.MONDE_TOKEN_SECRET ?? "monde-local-development-only"), branch_id: world.branchId };
    } catch (error) { return failure(error, reply); }
  });
}

/** Conversation memory for a snapshot: open sessions with their turns, plus every summary and digest. */
async function conversationState(tx: Pick<WorldDatabase, "select">, worldId: string) {
  const sessions = await tx.select().from(s.conversationSessions)
    .where(and(eq(s.conversationSessions.worldId, worldId), eq(s.conversationSessions.compacted, false)));
  const open = sessions.map((row) => row.id);
  return {
    conversationSessions: sessions,
    dialogueTurns: open.length
      ? await tx.select().from(s.dialogueTurns).where(and(eq(s.dialogueTurns.worldId, worldId), inArray(s.dialogueTurns.conversationId, open)))
      : [],
    conversationSummaries: await tx.select().from(s.conversationSummaries).where(eq(s.conversationSummaries.worldId, worldId)),
    conversationDigests: await tx.select().from(s.conversationDigests).where(eq(s.conversationDigests.worldId, worldId)),
  };
}

function failure(error: unknown, reply: import("fastify").FastifyReply) {
  if (error instanceof SnapshotError) return reply.code(error.status).send({ error: error.message });
  // Drizzle wraps driver errors; concurrent serializable saves can safely be retried by the caller.
  const cause = error instanceof Error && error.cause ? error.cause : error;
  if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "40001") {
    return reply.code(409).send({ error: "World changed during snapshot; retry the save" });
  }
  throw error;
}
