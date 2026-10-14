import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().optional(),
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
