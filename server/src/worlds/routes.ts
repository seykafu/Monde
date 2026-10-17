import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Config } from "../config.js";
import { residents, worlds } from "../db/schema.js";
import { createWorld, ensureRoster, type WorldDatabase } from "./createWorld.js";

export function worldToken(worldId: string, deviceId: string, secret: string) {
  return createHmac("sha256", secret).update(worldId + deviceId).digest("hex");
}
export function requireWorld(db: WorldDatabase | undefined, secret: string, contentDirectory?: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { w } = request.params as { w: string };
    const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token || !z.uuid().safeParse(w).success) return reply.code(401).send({ error: "Unauthorized" });
    if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const [world] = await db.select().from(worlds).where(eq(worlds.id, w));
    if (!world || !timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(worldToken(w, world.deviceId, secret), "hex"))) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    // MVP M-03: a world made before the Day-1 census was written gets its residents the first time it's loaded here.
    // A failed backfill never fails the request (it is tried again on the next).
    await ensureRoster(db, w, contentDirectory).catch((err: unknown) => { request.log.error({ err, worldId: w }, "roster backfill failed"); });
  };
}
export function registerWorldRoutes(app: FastifyInstance, config: Config, db?: WorldDatabase) {
  const secret = config.MONDE_TOKEN_SECRET ?? "monde-local-development-only";
  const authorize = requireWorld(db, secret, config.MONDE_CONTENT_DIR);
  // Covers both the world resource and all current/future nested world endpoints.
  app.addHook("preHandler", async (request, reply) => {
    if (/^\/v1\/worlds\/:w(?:\/|$)/.test(request.routeOptions.url ?? "")) {
      return authorize(request, reply);
    }
  });
  app.post("/v1/worlds", async (request, reply) => {
    const body = z.object({ device_id: z.string().min(1).max(256), invite_code: z.string().min(1).max(256) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "device_id and invite_code are required strings" });
    const codes = (config.MONDE_INVITE_CODES ?? "").split(",").map((code) => code.trim()).filter(Boolean);
    if (config.MONDE_ENV !== "dev" && !codes.includes(body.data.invite_code)) {
      return reply.code(403).send({ error: "Invalid invite code" });
    }
    if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const world = await createWorld(db, body.data.device_id, body.data.invite_code, config.MONDE_CONTENT_DIR);
    return { world_id: world.id, token: worldToken(world.id, world.deviceId, secret) };
  });
  app.get<{ Params: { w: string } }>("/v1/worlds/:w", async (request) => {
    const [world] = await db!.select().from(worlds).where(eq(worlds.id, request.params.w));
    const [total] = await db!.select({ count: count() }).from(residents).where(eq(residents.worldId, request.params.w));
    return { world_id: world!.id, day: world!.day, minute: world!.minute, residents: total!.count };
  });
}
