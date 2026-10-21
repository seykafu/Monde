import { BudgetError } from "./budget.js";
/**
 * One non-streaming structured-output call for the night jobs (plans and reflections, GDD §9.7, §9.17), with a
 * deadline and the stop_reason check AGENTS.md requires before any content is read. The caller validates the text
 * and writes the ai_log row from `call` (§19.6).
 *
 * Night calls don't stream: nothing is shown while they run, and the response is one small JSON object.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { CallRecord } from "./dialogue.js";
import { MindStreamError, MindUnavailableError, tokensOf, type MindClient } from "./mindClient.js";
import { NO_TOKENS, costUsd, type CallTokens } from "./pricing.js";
import { AbortedError } from "./semaphore.js";

export type CallFailure = "budget" | "unavailable" | "timeout" | "aborted" | "api_error" | "refusal" | "max_tokens" | `stop:${string}`;

export type ModelCall =
  | { ok: true; text: string; call: CallRecord }
  /** `call` is null when no request was sent (aborted while waiting for a slot). */
  | { ok: false; failure: CallFailure; call: CallRecord | null; error?: unknown };

export interface CallOptions {
  /** Per-call deadline, counted from when the request is sent (not from when it was queued). */
  timeoutMs: number;
  /** Abandon the call (server shutting down). */
  signal?: AbortSignal;
  /** Wraps the request in a concurrency slot (the per-world semaphore). */
  gate?: <T>(task: () => Promise<T>) => Promise<T>;
  now?: () => number;
}

const textOf = (message: Anthropic.Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

export async function callModel(mind: MindClient, params: Anthropic.MessageCreateParamsNonStreaming, options: CallOptions): Promise<ModelCall> {
  const now = options.now ?? (() => performance.now());
  const gate = options.gate ?? (<T>(task: () => Promise<T>) => task());
  let sent = false;
  let started = 0;
  let timeout: AbortSignal | null = null;
  const record = (tokens: CallTokens, stopReason: string, validation: string): CallRecord => ({
    attempt: 1, model: params.model, tokens, costUsd: costUsd(tokens, params.model), latencyMs: Math.round(now() - started),
    firstTokenMs: null, stopReason, validation,
  });
  try {
    const message = await gate(() => {
      sent = true;
      started = now();
      timeout = AbortSignal.timeout(options.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      return mind.createMessage(params, { signal });
    });
    const tokens = tokensOf(message.usage);
    const stopReason = message.stop_reason ?? "none";
    if (stopReason === "refusal" || stopReason === "max_tokens") {
      return { ok: false, failure: stopReason, call: record(tokens, stopReason, stopReason) };
    }
    if (stopReason !== "end_turn" && stopReason !== "stop_sequence") {
      return { ok: false, failure: `stop:${stopReason}`, call: record(tokens, stopReason, `stop:${stopReason}`) };
    }
    return { ok: true, text: textOf(message), call: record(tokens, stopReason, "ok") };
  } catch (error) {
    const original = error instanceof MindStreamError ? error.original : error;
    if (original instanceof BudgetError) return { ok: false, failure: "budget", call: null };
    if (!sent) return { ok: false, failure: "aborted", call: null, error: original };
    const failure: CallFailure = (timeout as AbortSignal | null)?.aborted ? "timeout"
      : options.signal?.aborted || original instanceof AbortedError ? "aborted"
        : original instanceof MindUnavailableError ? "unavailable"
          : "api_error";
    const tokens = error instanceof MindStreamError ? error.tokens : NO_TOKENS;
    return { ok: false, failure, call: record(tokens, "none", failure), error: original };
  }
}
