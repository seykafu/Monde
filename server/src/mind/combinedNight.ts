import { aiLog } from "../db/schema.js";
import { budgetMind } from "./budget.js";
import { callModel, type ModelCall } from "./callModel.js";
import { nightLogRow, type NightJobDeps, type NightWorld } from "./nightJob.js";
import { preparePlan, planResident } from "./plan.js";
import { prepareReflection, reflectResident } from "./reflect.js";
import { apiParams, buildNightRequest, promptVersion } from "./promptBuilder.js";
import { NO_TOKENS } from "./pricing.js";

/** One cold prefix write; each half keeps its own validator, transaction and fallback. */
export async function combinedNight(deps: NightJobDeps, world: NightWorld, residentId: string): Promise<void> {
  const reflection = await prepareReflection(deps, world, residentId);
  const plan = await preparePlan(deps, world, residentId);
  if (!reflection || !plan) return;
  const result = await callModel(budgetMind(deps.db, deps.mind, world.worldId, residentId, "night", world.day),
    apiParams("night", buildNightRequest(reflection.request, plan.request)), {
      timeoutMs: deps.callTimeoutMs, signal: deps.signal, gate: deps.gate, now: deps.now,
    });
  // Admission rejected without an API call. Reflect has the less restrictive budget policy;
  // its own atomic admission still enforces Ambient, global and 200% caps.
  if (!result.ok && result.failure === "budget") {
    await reflectResident(deps, world, residentId);
    await planResident(deps, world, residentId, { model: false });
    return;
  }
  let halves: Record<string, unknown> = {};
  if (result.ok) {
    try {
      const parsed: unknown = JSON.parse(result.text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) halves = parsed as Record<string, unknown>;
    } catch { /* Both validators receive invalid JSON and take their existing schema fallback. */ }
  }
  const half = (key: string): ModelCall => {
    const call = result.call ? { ...result.call, tokens: NO_TOKENS, costUsd: 0 } : null;
    return result.ok
      ? { ok: true, text: JSON.stringify(halves[key]) ?? "", call: call! }
      : { ...result, call };
  };
  // Log usage once even if a later persistence transaction fails.
  if (result.call) await deps.db.insert(aiLog).values(nightLogRow(world.worldId, residentId, "night", promptVersion(),
    { ...result.call, validation: result.ok && (!halves.reflection || !halves.plan) ? "schema" : result.call.validation }, !result.ok));
  await reflection.finish(half("reflection"));
  await plan.finish(half("plan"));
}
