/**
 * One dialogue turn against the model (GDD §9.10 flow, §9.13 pipeline; MVP M-05).
 *
 *   build (promptBuilder) → stream (MindClient) → check stop_reason → validate (validate.ts)
 *     → on a validation failure, regenerate ONCE with a corrective note → else the authored fallback.
 *
 * Deadlines (§9.10 step 4): if nothing visible has streamed by 2.5 s the caller gets `onThinking` (the client
 * plays "Hm."); if the model has produced no text by 6 s the call is abandoned. Refusals, max_tokens stops,
 * timeouts and API errors go straight to the fallback: none of them is fixed by asking again inside the budget.
 *
 * This module has no I/O of its own beyond the MindClient: the route streams, effects.ts persists.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { LIMITS, type DialogueTurnOutput } from "@monde/shared";
import { apiParams, containsAnswer, requestSettings, type MindRequest } from "./promptBuilder.js";
import { MindStreamError, MindUnavailableError, tokensOf, type MindClient } from "./mindClient.js";
import { completeWords, lexicalHits } from "./filters.js";
import { LineTextExtractor } from "./partialJson.js";
import { NO_TOKENS, costUsd, type CallTokens } from "./pricing.js";
import { correctiveNote, validateTurn, type ValidationContext } from "./validate.js";
import { prefixSystemBlocks, type ResidentPrefix } from "./context.js";

export interface DialogueTimings {
  /** §9.10: nothing visible by 2.5 s → the authored "thinking" beat. */
  thinkingMs: number;
  /** §9.10: no model text by 6 s → abandon the call and fall back. */
  firstTextMs: number;
  /**
   * GDD-GAP: §9.10 bounds only the first character. A stream that starts and then stalls needs a cap too; at
   * Haiku speeds a 400-token turn takes 2-4 s, so 12 s per attempt is generous without letting a turn hang.
   */
  attemptMs: number;
}

export const DEFAULT_TIMINGS: DialogueTimings = { thinkingMs: 2500, firstTextMs: 6000, attemptMs: 12000 };

/** §9.10 step 6: up to 6 exchanges, then the resident wraps up. The 7th exchange (index 6) is forced. */
export const MAX_EXCHANGES = 6;
export const WRAP_UP_NOTE = "This is your last line in this conversation: bring it to a natural close and set wrap_up to true.";

/** One model call, for the ai_log row (§19.6). */
export interface CallRecord {
  attempt: number;
  model: string;
  tokens: CallTokens;
  costUsd: number;
  latencyMs: number;
  /** Time to the first text delta, or null if none arrived. */
  firstTokenMs: number | null;
  /** The API's stop_reason, or "none" when no message came back (timeout, error, no key). */
  stopReason: string;
  /** "ok", a validation category ("schema", "lexical:brand", "riddle", "echo"), or what stopped the call. */
  validation: string;
}

export type TurnFailureCode = "unavailable" | "timeout" | "refusal" | "max_tokens" | "api_error" | "invalid_output" | "aborted";

export interface TurnFailure {
  code: TurnFailureCode;
  message: string;
}

export interface GenerateResult {
  /** The validated, clamped turn, or null when the caller must use the authored fallback. */
  output: DialogueTurnOutput | null;
  failure: TurnFailure | null;
  calls: CallRecord[];
  /** What validation changed on the accepted output (clamped deltas, mapped expressions…), for logs. */
  adjustments: string[];
}

export interface LineDelta {
  index: number;
  text_so_far: string;
  /** 1 for the first call, 2 for the regeneration. Lines from an earlier attempt are void. */
  attempt: number;
}

export interface GenerateOptions {
  mind: MindClient;
  request: MindRequest;
  /** Extra instructions appended to the user message on every attempt (the forced wrap-up). */
  notes?: readonly string[];
  validation: ValidationContext;
  timings?: Partial<DialogueTimings>;
  /** The client went away: abandon the call. */
  signal?: AbortSignal;
  onLineDelta?: (delta: LineDelta) => void;
  onThinking?: () => void;
  now?: () => number;
}

const FAILURE_MESSAGES: Record<TurnFailureCode, string> = {
  unavailable: "No model is configured; using an authored line.",
  timeout: "The resident took too long to answer; using an authored line.",
  refusal: "The model declined this turn; using an authored line.",
  max_tokens: "The reply ran past its length cap; using an authored line.",
  api_error: "The model call failed; using an authored line.",
  invalid_output: "The reply failed validation twice; using an authored line.",
  aborted: "The client went away.",
};
const failure = (code: TurnFailureCode): TurnFailure => ({ code, message: FAILURE_MESSAGES[code] });

/**
 * The API body for a dialogue attempt: the builder's request with `notes` appended as extra text blocks in the
 * same (last, user) message. Never an assistant prefill, never sampling parameters, and blocks 1-3 untouched.
 */
export function dialogueParams(request: MindRequest, notes: readonly string[] = []): Anthropic.MessageCreateParamsNonStreaming {
  if (notes.length === 0) return apiParams("dialogue", request);
  const messages = [...request.messages];
  const last = messages.pop();
  if (!last || last.role !== "user") throw new Error("dialogue request must end with a user message");
  const content: Anthropic.ContentBlockParam[] = typeof last.content === "string"
    ? [{ type: "text", text: last.content }]
    : [...last.content];
  for (const note of notes) content.push({ type: "text", text: note });
  return apiParams("dialogue", { ...request, messages: [...messages, { role: "user", content }] });
}

/**
 * A `max_tokens: 0` request with the dialogue's blocks 1-3 and settings, to write the prompt cache before the
 * first real turn (§9.10 step 1). `max_tokens: 0` rejects `stream: true` and `output_config.format`, so this
 * goes through `createMessage` without the schema. Check `cache_read_input_tokens` on the first real turn in
 * staging (M-14's acceptance) to confirm the format block doesn't sit ahead of the cached prefix.
 */
export function prewarmParams(prefix: ResidentPrefix, day: number): Anthropic.MessageCreateParamsNonStreaming {
  const settings = requestSettings("dialogue");
  return {
    model: settings.model,
    max_tokens: 0,
    ...(settings.thinking ? { thinking: settings.thinking } : {}),
    system: prefixSystemBlocks(prefix, day),
    messages: [{ role: "user", content: "warmup" }],
  };
}

const textOf = (message: Anthropic.Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

type Attempt =
  | { kind: "message"; message: Anthropic.Message; latencyMs: number; firstTokenMs: number | null }
  | { kind: "failed"; code: "timeout" | "aborted" | "unavailable" | "api_error"; error: unknown; tokens: CallTokens; latencyMs: number; firstTokenMs: number | null };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function callOnce(
  mind: MindClient,
  params: Anthropic.MessageCreateParamsNonStreaming,
  timings: DialogueTimings,
  outer: AbortSignal | undefined,
  onText: (delta: string) => void,
  now: () => number,
): Promise<Attempt> {
  const controller = new AbortController();
  // Assigned from timer and abort callbacks; the cast keeps TypeScript from narrowing it to null.
  let stopped = null as "timeout" | "aborted" | null;
  const start = now();
  let first = null as number | null;
  const stop = (why: "timeout" | "aborted") => { stopped ??= why; controller.abort(); };
  const firstTimer = setTimeout(() => { if (first === null) stop("timeout"); }, timings.firstTextMs);
  const totalTimer = setTimeout(() => stop("timeout"), timings.attemptMs);
  const onOuterAbort = () => stop("aborted");
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  if (outer?.aborted) stop("aborted");
  const elapsed = () => Math.round(now() - start);
  const firstMs = () => (first === null ? null : Math.round(first - start));

  const call = mind.streamMessage(params, {
    signal: controller.signal,
    onText: (delta) => {
      if (stopped) return;
      if (first === null) first = now();
      onText(delta);
    },
  });
  // Whatever happens below, a late rejection from an abandoned call must not go unhandled.
  call.catch(() => undefined);
  const abandoned = new Promise<"abandoned">((resolve) => {
    if (controller.signal.aborted) resolve("abandoned");
    else controller.signal.addEventListener("abort", () => resolve("abandoned"), { once: true });
  });
  try {
    const result = await Promise.race([call, abandoned]);
    if (result === "abandoned" || stopped) {
      // The SDK rejects right after an abort; give it a moment so the usage it saw (input is billed) is logged.
      const settled = await Promise.race([call.then(() => null, (error: unknown) => error), sleep(250).then(() => null)]);
      const tokens = settled instanceof MindStreamError ? settled.tokens : NO_TOKENS;
      return { kind: "failed", code: stopped ?? "timeout", error: settled, tokens, latencyMs: elapsed(), firstTokenMs: firstMs() };
    }
    return { kind: "message", message: result, latencyMs: elapsed(), firstTokenMs: firstMs() };
  } catch (error) {
    const tokens = error instanceof MindStreamError ? error.tokens : NO_TOKENS;
    const original = error instanceof MindStreamError ? error.original : error;
    const code = stopped ?? (original instanceof MindUnavailableError ? "unavailable" : "api_error");
    return { kind: "failed", code, error: original, tokens, latencyMs: elapsed(), firstTokenMs: firstMs() };
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

/** Is this (whole-word) partial line safe to show before validation? Same lexical and riddle rules. */
function streamSafe(text: string, validation: ValidationContext): boolean {
  if (lexicalHits(text).length > 0) return false;
  return !validation.riddle || !containsAnswer(text, validation.riddle.accepted);
}

export async function generateTurn(options: GenerateOptions): Promise<GenerateResult> {
  const timings = { ...DEFAULT_TIMINGS, ...options.timings };
  const now = options.now ?? (() => performance.now());
  const notes = options.notes ?? [];
  const calls: CallRecord[] = [];
  let visible = false;
  let finished = false;
  const thinkingTimer = setTimeout(() => {
    if (!visible && !finished) options.onThinking?.();
  }, timings.thinkingMs);

  try {
    let corrective: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const params = dialogueParams(options.request, corrective ? [...notes, corrective] : notes);
      const extractor = new LineTextExtractor();
      const shown: string[] = [];
      let suppressed = false;
      const onText = (delta: string) => {
        for (const line of extractor.push(delta)) {
          if (suppressed || line.index >= LIMITS.dialogue.maxLines) continue;
          // Hold back a word still being typed: "game" may become "gamekeeper", and "smartph" must not show.
          const capped = line.text.slice(0, LIMITS.dialogue.lineChars);
          const text = line.done && capped.length === line.text.length ? capped : completeWords(capped);
          if (!streamSafe(text, options.validation)) { suppressed = true; continue; }
          if (text.trim() === "" || text === shown[line.index]) continue;
          shown[line.index] = text;
          visible = true;
          options.onLineDelta?.({ index: line.index, text_so_far: text, attempt });
        }
      };
      const result = await callOnce(options.mind, params, timings, options.signal, onText, now);
      const record = (tokens: CallTokens, stopReason: string, validation: string): void => {
        calls.push({
          attempt, model: params.model, tokens, costUsd: costUsd(tokens), latencyMs: result.latencyMs,
          firstTokenMs: result.firstTokenMs, stopReason, validation,
        });
      };

      if (result.kind === "failed") {
        record(result.tokens, "none", result.code);
        return { output: null, failure: failure(result.code), calls, adjustments: [] };
      }
      const { message } = result;
      const tokens = tokensOf(message.usage);
      const stopReason = message.stop_reason ?? "none";
      // Always check stop_reason before reading content (AGENTS.md; refusals have no server-side fallback on Haiku).
      if (stopReason === "refusal" || stopReason === "max_tokens") {
        record(tokens, stopReason, stopReason);
        return { output: null, failure: failure(stopReason), calls, adjustments: [] };
      }
      if (stopReason !== "end_turn" && stopReason !== "stop_sequence") {
        record(tokens, stopReason, `stop:${stopReason}`);
        return { output: null, failure: failure("invalid_output"), calls, adjustments: [] };
      }
      const validated = validateTurn(textOf(message), options.validation);
      if (validated.ok) {
        record(tokens, stopReason, "ok");
        return { output: validated.output, failure: null, calls, adjustments: validated.adjustments };
      }
      record(tokens, stopReason, validated.category);
      corrective = correctiveNote(validated.category);
    }
    return { output: null, failure: failure("invalid_output"), calls, adjustments: [] };
  } finally {
    finished = true;
    clearTimeout(thinkingTimer);
  }
}
