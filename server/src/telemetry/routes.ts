import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import { requireWorld } from '../worlds/routes.js';
import { telemetryEvents, surveyAnswers } from '../db/schema.js';
import { TelemetryBatch } from '@monde/shared';
export { TelemetryBatch } from '@monde/shared';

export function registerTelemetryRoutes(app: FastifyInstance, config: Config, db?: WorldDatabase): void {
  // GDD-GAP: operational limits: 64 KiB, 25 events, 12 batches/minute/install; bounded process-local limiter.
  const windows = new Map<string, { start: number; count: number }>();
  const auth = requireWorld(db, config.MONDE_TOKEN_SECRET ?? 'monde-local-development-only');
  app.post('/v1/telemetry', { bodyLimit: 65536 }, async (request, reply) => {
    const parsed = TelemetryBatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid telemetry batch' });
    const { telemetry_id, world_id, events } = parsed.data;
    const now = Date.now();
    for (const [id, w] of windows) if (now - w.start >= 60000) windows.delete(id);
    const w = windows.get(telemetry_id) ?? { start: now, count: 0 };
    if (w.count >= 12 || (!windows.has(telemetry_id) && windows.size >= 10000)) return reply.code(429).send({ error: 'Try later' });
    w.count++; windows.set(telemetry_id, w);
    if (world_id) {
      request.params = { w: world_id };
      await auth(request, reply);
      if (reply.sent) return;
    }
    if (!db) return reply.code(503).send({ error: 'Database unavailable' });
    await db.transaction(async tx => {
      for (const event of events) {
        const rows = await tx.insert(telemetryEvents).values({ eventId: event.event_id, telemetryId: telemetry_id,
          worldId: world_id ?? null, at: new Date(event.at), type: event.data.type, day: event.data.day, data: event.data,
        }).onConflictDoNothing().returning();
        if (rows.length && event.data.type === 'survey_answer') {
          const a = event.data.answer;
          await tx.insert(surveyAnswers).values({ eventId: event.event_id, telemetryId: telemetry_id, worldId: world_id ?? null,
            survey: a.survey, question: a.question, resident: 'resident' in a ? a.resident : null, value: a.value });
        }
      }
    });
    return reply.code(202).send({ accepted: events.length });
  });
}
