import { z } from "zod";
import { ModelIdSchema } from "./mind/models.js";

const schema = z.object({
  MIND_MODEL: ModelIdSchema.optional(),
  MIND_MODEL_DIALOGUE: ModelIdSchema.optional(),
  MIND_MODEL_PRECHECK: ModelIdSchema.optional(),
  MIND_MODEL_PLAN: ModelIdSchema.optional(),
  MIND_MODEL_REFLECT: ModelIdSchema.optional(),
  MIND_MODEL_GOSSIP: ModelIdSchema.optional(),
  MIND_MODEL_PRESS: ModelIdSchema.optional(),
  MIND_MODEL_ARRIVAL: ModelIdSchema.optional(),
  MIND_MODEL_SUMMARY: ModelIdSchema.optional(),

  ADMIN_TOKEN: z.string().min(1).optional(),
  WORLD_DAILY_BUDGET_USD: z.coerce.number().positive().default(0.06), // GDD §9.15
  // GDD-GAP: global UTC-day hard cap default; operator can change it.
  GLOBAL_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(10),
  // MVP M-03: the whole Day-1 census run (/admin/census/write) is charged to one census world and stops at this, all
  // days together. GDD-GAP: the plan's figure; the global daily cap still applies on top.
  CENSUS_BUDGET_USD: z.coerce.number().nonnegative().default(3),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().optional(),
  // Migrations need a session connection; Supabase's pooled DATABASE_URL (port 6543) is transaction mode.
  DATABASE_DIRECT_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Needed only when the API key is org-level rather than scoped to a workspace (sent as anthropic-workspace-id).
  ANTHROPIC_WORKSPACE_ID: z.string().min(1).optional(),
  MONDE_ENV: z.enum(["dev", "staging", "production"]).default("dev"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MONDE_TOKEN_SECRET: z.string().min(1).optional(),
  MONDE_INVITE_CODES: z.string().optional(),
  MONDE_CONTENT_DIR: z.string().min(1).optional(),
  GIT_SHA: z.string().min(1).default("dev"),
});

export type Config = z.infer<typeof schema>;
export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.MONDE_ENV !== "dev" && !config.MONDE_TOKEN_SECRET) {
    throw new Error("MONDE_TOKEN_SECRET is required outside dev");
  }
  return config;
}
