/**
 * Night and dawn routes (GDD §19.4; MVP M-07). Both sit under /v1/worlds/:w, so the world-token hook in
 * worlds/routes.ts authorizes them.
 *
 * POST /v1/worlds/:w/night   {day, events?: TownEvent[], client_events?: ClientEvent[], town?: {pillars?, census?, weather_tomorrow?}}
 *   → 200 {day, next_day, done, pending, complete, tiers, elapsed_ms, already?, ingestion?} within 4 s; unfinished work
 *     continues in the background. 409 if the world is already past that night.
 * GET  /v1/worlds/:w/dawn/:day
 *   → 200 {day, weekday, plans[{resident_id, tier, source, plan}], letters[…], favors[…],
 *          ties: {pairs[{a, b, label, romance}], milestones[{day, a, b, kind, from, to}]}, regard, pending, complete}.
 *     Letters are marked delivered as they're returned. `ties` (G-13) lists every pair of residents who have met
 *     (a < b; label per §9.11.3, romance stage from their flags) and the milestones recorded the night before.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { buildDawnPackage } from "./dawn.js";
import { NightBody, type NightRunner } from "./night.js";

const DayParam = z.coerce.number().int().min(1).max(100_000);
const issues = (error: z.ZodError) => error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

export function registerNightRoutes(app: FastifyInstance, db: WorldDatabase | undefined, runner: NightRunner | undefined): void {
  app.post<{ Params: { w: string } }>("/v1/worlds/:w/night", async (request, reply) => {
    const parsed = NightBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid night request", issues: issues(parsed.error) });
    if (!runner) return reply.code(503).send({ error: "Database unavailable" });
    const result = await runner.start(request.params.w, parsed.data);
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { w: string; day: string } }>("/v1/worlds/:w/dawn/:day", async (request, reply) => {
    const day = DayParam.safeParse(request.params.day);
    if (!day.success) return reply.code(400).send({ error: "day must be a whole number from 1", issues: issues(day.error) });
    if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const dawn = await buildDawnPackage(db, request.params.w, day.data);
    return { ...dawn, ...(runner?.status(request.params.w, day.data) ?? { pending: 0, complete: true }) };
  });

  // Background night work finishes (or falls back) before onClose hooks close the database.
  if (runner) app.addHook("preClose", async () => { await runner.close(); });
}
