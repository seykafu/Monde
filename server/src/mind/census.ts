/**
 * Writing the Day-1 residents (MVP M-03 step 2; GDD Appendix A.1.5: one Haiku call per household with A.3.6's prompt in
 * MODE: native). tools/gen-residents.ts drives the run and validates every answer itself; this endpoint only makes
 * the call, so the API key never leaves Fly.
 *
 *   POST /admin/census/write   { draw, context }   (ADMIN_TOKEN as a Bearer header; 404 while ADMIN_TOKEN is unset)
 *     → 200 { text, stop_reason, usage, cost_usd, spent_usd, cap_usd }   (text is "" unless stop_reason is end_turn)
 *     → 429 { error: "budget", spent_usd, cap_usd }                       (CENSUS_BUDGET_USD, or the global daily cap)
 *
 * Not a proxy: the body is a household (shared NativeDrawSchema) and its roster context (NativePromptContextSchema),
 * zod-validated with every list and string bounded. The server builds the request itself: the model, A.3.6's exact
 * system prompt and MONDE ON DAY 1 (both cached, byte-stable), the user message from nativeUserMessage, effort low,
 * the contract as output_config.format, max_tokens 900 + 750 × size. No sampling parameters, no prefill.
 *
 * Budget: every call is charged to one dedicated census world row (created on first use) and admitted while that world's
 * spend, all days together, stays under CENSUS_BUDGET_USD; the global daily cap applies as it does to every world.
 * Each call is logged to ai_log (kind census, prompt census-v1).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  HOUSEHOLD_JSON_BLOCK, NATIVE_PROMPT_VERSION, NATIVE_SYSTEM_BLOCKS, NativeDrawSchema, NativePromptContextSchema,
  nativeMaxTokens, nativeUserMessage, type HouseholdDraw, type NativePromptContext,
} from "@monde/shared";
import type { Config } from "../config.js";
import { aiLog, budgetCalls, devices, worlds } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { adminTokenMatches } from "./admin.js";
import { BudgetError, budgetLimits, globalSpendTx, reservingMind } from "./budget.js";
import { callModel } from "./callModel.js";
import { aiLogRow } from "./effects.js";
import type { MindClient } from "./mindClient.js";
import { MIND_MODEL } from "./promptBuilder.js";

/** The census's own world row: every census call is charged to it (a fixed id, so every run shares one ledger). */
export const CENSUS_WORLD_ID = "c3a50000-0000-4000-8000-000000000001";
export const CENSUS_DEVICE_ID = "census";
/** GDD-GAP: a five-person household's answer is about 4k tokens; two minutes covers it with room to spare. */
export const CENSUS_CALL_TIMEOUT_MS = 120_000;

export const CensusWriteBody = z.object({ draw: NativeDrawSchema, context: NativePromptContextSchema }).strict();

/** The census request (A.3.6, MODE: native): fixed model and system blocks, the household's user message. */
export function censusRequest(draw: HouseholdDraw, ctx: NativePromptContext): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MIND_MODEL,
    max_tokens: nativeMaxTokens(draw.members.length),
    // The card contract rides in the cached system blocks, not output_config.format (householdJson.ts: the grammar is
    // too large for strict structured output). One breakpoint at the end caches all three.
    system: [...NATIVE_SYSTEM_BLOCKS, HOUSEHOLD_JSON_BLOCK].map((text, i, all) => ({ type: "text" as const, text, ...(i === all.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}) })),
    messages: [{ role: "user", content: nativeUserMessage(draw, ctx) }],
    output_config: { effort: "low" },
  };
}

/** The census world and its device, once. */
export async function ensureCensusWorld(db: WorldDatabase): Promise<void> {
  await db.insert(devices).values({ id: CENSUS_DEVICE_ID, inviteCode: "census" }).onConflictDoNothing();
  await db.insert(worlds).values({ id: CENSUS_WORLD_ID, deviceId: CENSUS_DEVICE_ID, seed: 0, branchId: CENSUS_WORLD_ID, status: "census", aiSpendDay: 1 }).onConflictDoNothing();
}

/** What the census world has spent so far, reservations included. */
export async function censusSpend(db: WorldDatabase): Promise<number> {
  const [row] = await db.select({ cost: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls).where(eq(budgetCalls.worldId, CENSUS_WORLD_ID));
  return Number(row?.cost ?? 0);
}

/**
 * The census's budget adapter: the global daily cap as everywhere, and in place of the per-world caps one total for the
 * whole census run (`capUsd`, CENSUS_BUDGET_USD).
 */
export function censusBudgetMind(db: WorldDatabase, mind: MindClient, capUsd: number): MindClient {
  return reservingMind(db, mind, async (tx, reserve) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${CENSUS_WORLD_ID}))`);
    const [own] = await tx.select({ cost: sql<string>`coalesce(sum(${budgetCalls.costUsd}), 0)` }).from(budgetCalls).where(eq(budgetCalls.worldId, CENSUS_WORLD_ID));
    const global = await globalSpendTx(tx);
    if (global + reserve > budgetLimits(db).global || Number(own?.cost ?? 0) + reserve > capUsd) throw new BudgetError("budget");
    return { worldId: CENSUS_WORLD_ID, day: 1, kind: "census" };
  });
}

export function registerCensusRoutes(app: FastifyInstance, config: Config, db: WorldDatabase | undefined, mind: MindClient): void {
  app.post("/admin/census/write", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!config.ADMIN_TOKEN) return reply.code(404).send({ error: "not found" });
    const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!adminTokenMatches(config, token)) return reply.code(401).send({ error: "unauthorized" });
    if (!db) return reply.code(503).send({ error: "database unavailable" });
    const parsed = CensusWriteBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid census request", issues: parsed.error.issues.slice(0, 5).map(i => `${i.path.join(".")}: ${i.message}`) });
    if (!mind.enabled) return reply.code(503).send({ error: "mind unavailable" });
    const { draw, context } = parsed.data;
    await ensureCensusWorld(db);
    const cap = config.CENSUS_BUDGET_USD;
    const call = await callModel(censusBudgetMind(db, mind, cap), censusRequest(draw, context), { timeoutMs: CENSUS_CALL_TIMEOUT_MS });
    if (!call.ok && call.failure === "budget") return reply.code(429).send({ error: "budget", spent_usd: await censusSpend(db), cap_usd: cap });
    if (call.call) {
      await db.insert(aiLog).values(aiLogRow({
        worldId: CENSUS_WORLD_ID, residentId: draw.id, kind: "census", promptVersion: NATIVE_PROMPT_VERSION, call: call.call, fallback: !call.ok,
      }));
    }
    const t = call.call?.tokens;
    const usage = { input_tokens: t?.input ?? 0, output_tokens: t?.output ?? 0, cache_read_input_tokens: t?.cacheRead ?? 0, cache_creation_input_tokens: t?.cacheWrite ?? 0 };
    const spent = await censusSpend(db);
    if (call.ok) return { text: call.text, stop_reason: call.call.stopReason, usage, cost_usd: call.call.costUsd, spent_usd: spent, cap_usd: cap };
    // A refusal or the token cap is an answer the tool handles (no text to read); a timeout or an API error isn't.
    if (call.call && (call.failure === "refusal" || call.failure === "max_tokens" || call.failure.startsWith("stop:")))
      return { text: "", stop_reason: call.call.stopReason, usage, cost_usd: call.call.costUsd, spent_usd: spent, cap_usd: cap };
    // The API's own message (e.g. a 400 invalid_request) is what explains a failed call: log it and hand it back.
    const detail = !call.ok && call.error instanceof Error ? call.error.message.slice(0, 500) : undefined;
    request.log.warn({ failure: call.failure, detail }, "census call failed");
    return reply.code(502).send({ error: call.failure, ...(detail ? { detail } : {}), usage, spent_usd: spent, cap_usd: cap });
  });
}
