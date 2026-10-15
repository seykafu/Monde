import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Config } from "./config.js";
import { createDatabase } from "./db/client.js";
import { createRedis } from "./redis.js";

import { registerWorldRoutes } from "./worlds/routes.js";
import type { WorldDatabase } from "./worlds/createWorld.js";
import { promptVersion } from "./mind/promptBuilder.js";
import { createMindClient, type MindClient } from "./mind/mindClient.js";
import { registerMindRoutes } from "./mind/routes.js";
import type { DialogueTimings } from "./mind/dialogue.js";
import { NightRunner } from "./mind/night.js";
import { registerNightRoutes } from "./mind/nightRoutes.js";

type Check = "ok" | "down" | "off";
async function check(probe?: () => Promise<unknown>): Promise<Check> {
  if (!probe) return "off";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Health check timed out")), 2500);
      }),
    ]);
    return "ok";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/** Test and wiring seams. Production passes nothing: the Mind client comes from config (no key → fallbacks). */
export interface AppOptions {
  mind?: MindClient;
  dialogueTimings?: Partial<DialogueTimings>;
  prewarmIntervalMs?: number;
  /** The night pass runner (M-07). Tests pass their own to tune the budget and await background work. */
  nightRunner?: NightRunner;
}

export function buildApp(config: Config, testDb?: WorldDatabase, options: AppOptions = {}) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, genReqId: () => randomUUID() });
  const database = createDatabase(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);

  app.register(cors, {
    origin: [
      /^https:\/\/(?:[a-z0-9-]+\.)+itch\.zone$/i,
      /^https:\/\/(?:[a-z0-9-]+\.)*itch\.io$/i,
      "http://localhost:5173",
    ],
    // The default (GET, HEAD, POST) would make browsers refuse PATCH /v1/worlds/:w/player at preflight.
    methods: ["GET", "HEAD", "POST", "PATCH"],
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.addHook("onClose", async () => {
    redis?.disconnect();
    await database?.client.end({ timeout: 2 });
  });

  app.get("/v1/health", async () => {
    const [db, redisStatus] = await Promise.all([
      check(database ? async () => database.client`select 1` : undefined),
      check(redis ? async () => {
        if (redis.status === "wait" || redis.status === "end") await redis.connect();
        await redis.ping();
      } : undefined),
    ]);
    return {
      ok: db !== "down" && redisStatus !== "down",
      service: "monde-mind",
      env: config.MONDE_ENV,
      version: config.GIT_SHA,
      checks: { db, redis: redisStatus },
    };
  });
  // Loading the prompt version at request time proves the prompt templates shipped with the build.
  app.get("/v1/version", async () => ({ version: config.GIT_SHA, prompt_version: promptVersion() }));
  const db = testDb ?? database?.db;
  const mind = options.mind ?? createMindClient(config);
  registerWorldRoutes(app, config, db);
  registerMindRoutes(app, db, {
    mind,
    timings: options.dialogueTimings,
    prewarmIntervalMs: options.prewarmIntervalMs,
  });
  const nightRunner = options.nightRunner
    ?? (db ? new NightRunner({ db, mind, contentDir: config.MONDE_CONTENT_DIR, log: app.log }) : undefined);
  registerNightRoutes(app, db, nightRunner);
  return app;
}
