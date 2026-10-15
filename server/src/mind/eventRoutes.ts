import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CLIENT_EVENT_BATCH_LIMIT } from "@monde/shared";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { ingestClientEvents } from "./eventIngestion.js";

// Individual validation happens during ingestion so one malformed event doesn't discard the rest.
const Body = z.object({ events: z.array(z.unknown()).max(CLIENT_EVENT_BATCH_LIMIT) });
export function registerEventRoutes(app: FastifyInstance, db: WorldDatabase | undefined, contentDir?: string): void {
  // The world routes' shared preHandler authorizes this path.
  app.post<{ Params: { w: string } }>("/v1/worlds/:w/events", async (request, reply) => {
    const body = Body.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "expected {events: [...]} with at most 500 events" });
    if (!db) return reply.code(503).send({ error: "Database unavailable" });
    return ingestClientEvents(db, request.params.w, body.data.events, { contentDir });
  });
}
