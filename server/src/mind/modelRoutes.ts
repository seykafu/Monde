import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import type { MindClient } from './mindClient.js';
import { adminTokenMatches } from './admin.js';
import { bindModelRouter, ModelIdSchema, ModelRoleSchema, ModelRouter, ModelRoutingUnavailableError } from './models.js';

export function registerModelRoutes(app: FastifyInstance, config: Config, db: WorldDatabase | undefined, mind: MindClient): void {
  const router = new ModelRouter(config, db, mind.retrieveModel?.bind(mind));
  if (db) bindModelRouter(db, router);
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', async () => {
    // Invalid persisted configuration fails startup. Capability lookups run separately in the background.
    try { await router.refresh(); } catch (err) {
      // Keep the health endpoint available during a database outage; malformed configuration still fails boot.
      if (!(err instanceof ModelRoutingUnavailableError)) throw err;
      app.log.warn({ err }, 'model routing storage unavailable; will retry in one minute');
    }
    timer = setInterval(() => { void router.refresh().catch(err => app.log.error({ err }, 'model routing refresh failed')); }, 60_000);
    timer.unref();
  });
  app.addHook('onClose', async () => { clearInterval(timer); });
  const body = z.object({ role: ModelRoleSchema, model: ModelIdSchema.nullable() }).strict();
  for (const method of ['GET', 'PUT'] as const) app.route<{ Querystring: { token?: string } }>({ method, url: '/admin/models', handler: async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (!config.ADMIN_TOKEN) return reply.code(404).send({ error: 'not found' });
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? request.query.token ?? '';
    if (!adminTokenMatches(config, token)) return reply.code(401).send({ error: 'unauthorized' });
    if (!db) return reply.code(503).send({ error: 'database unavailable' });
    if (method === 'PUT') {
      const parsed = body.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid model routing', issues: parsed.error.issues });
      await router.set(parsed.data.role, parsed.data.model);
    }
    return router.status();
  } });
}
