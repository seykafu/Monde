import { modelParams, defaultRouter, type ModelRouter } from "./models.js";
import { BudgetError } from "./budget.js";
/**
 * One dialogue turn against the model (GDD §9.10 flow, §9.13 pipeline; MVP M-05).
 *
 *   build (promptBuilder) → stream (MindClient) → check stop_reason → validate (validate.ts)
 *     → on a validation failure, regenerate ONCE with a corrective note → else the authored fallback.
 *
 * Soft slips regenerate only while silent. Once an attempt has shown text, accept its repaired lines and log
 * every slip. A visible regeneration owns the final turn: never return the earlier attempt after showing it.
 * Hard failures can replace visible text with a regeneration or authored fallback.
 * Streaming shares validation's line repairs, holding unresolved text (stage actions, exit tics, length splits)
 * until its final spelling and position are known, so the authoritative turn continues what the player read.
 *
 * Deadlines (§9.10 step 4): if nothing visible has streamed by 2.5 s the caller gets `onThinking` (the client
 * plays "Hm."); if the model has produced no text by 6 s the call is abandoned. Inside that window a call that
 * has produced nothing is not left to hang: at 2.5 s the same request is sent again alongside it (a hedge; the
 * first to stream wins and the other is cancelled), and a call that fails outright before its first text is
 * retried at once if there's time. Both target a dead or stalled connection (a cold machine after a deploy).
 *
 * A reply cut short (stop_reason `max_tokens`, or a stream that stalls or drops after it started) is salvaged
 * (salvage.ts): the whole lines are kept, choices come from the last line, and effects only if they arrived
 * whole. Refusals, timeouts with nothing streamed and API errors go to the authored fallback.
 *
 * This module has no I/O of its own beyond the MindClient: the route streams, effects.ts persists.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { DialogueTurnOutput, LIMITS, fitText, modelOutputFormat, splitLine } from "@monde/shared";
import { apiParams, historyBlock, requestSettings, type MindRequest } from "./promptBuilder.js";
import { MindStreamError, MindUnavailableError, tokensOf, type MindClient } from "./mindClient.js";
import { currencyHit, lexicalHits } from "./filters.js";
import { misgenderHit } from "./naming.js";
import { borrowedHits, stripTics } from "./voice.js";
import { LineTextExtractor } from "./partialJson.js";
import { NO_TOKENS, costUsd, type CallTokens } from "./pricing.js";
import { correctiveNote, neverSaysHit, repairDialogueLine, sampleEcho, softNote, validateTurn, type ValidationContext } from "./validate.js";
import { prefixSystemBlocks, type ResidentPrefix } from "./context.js";
import { salvageTurn } from "./salvage.js";

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
  /**
   * GDD-GAP: §9.10 says nothing about a call that simply never answers. With no text after this long the same
   * request goes out again in parallel and the first to stream wins. Staging's first token is ~0.9 s p50 and
   * ~1.8 s p95 (ai_log, 2026-10-15), so 2.5 s (the thinking beat) is past the normal tail and leaves the second
   * call 3.5 s before the 6 s fallback. The duplicate reads the same prompt cache, so it costs little.
   */
  hedgeMs: number;
  /** A call that fails before any text is retried at once only if at least this long is left before `firstTextMs`. */
  retryWindowMs: number;
}

export const DEFAULT_TIMINGS: DialogueTimings = { thinkingMs: 2500, firstTextMs: 6000, attemptMs: 12000, hedgeMs: 2500, retryWindowMs: 1500 };

/** §9.10 step 6: the sixth exchange wraps up; a resumed session may grant two more. */
export { MAX_EXCHANGES } from "@monde/shared";
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
  /**
   * "ok", a validation category ("schema", "lexical:brand", "riddle", "echo", "misgender", "never_says", "currency",
   * "borrowed", "tic_repeat", "sample_echo", "exit_tic"),
   * "kept:<soft category>" (accepted despite a soft check), "salvaged" / "salvaged:<code>" (a cut-short reply whose
   * whole lines were kept), "hedge_lost" / "retried:<code>" (an extra call of the same attempt that didn't supply
   * the turn), or what stopped the call.
   */
  validation: string;
}

export type TurnFailureCode = "budget" | "safety" | "unavailable" | "timeout" | "refusal" | "max_tokens" | "api_error" | "invalid_output" | "aborted" | "riddle_authored";

export interface TurnFailure {
  code: TurnFailureCode;
  message: string;
}

export interface GenerateResult {
  /** The validated, clamped turn, or null when the caller must use the authored fallback. */
  output: DialogueTurnOutput | null;
  rawOutput?: string;
  failure: TurnFailure | null;
  calls: CallRecord[];
  /** What validation changed on the accepted output (clamped deltas, mapped expressions…), for logs. */
  adjustments: string[];
  /** The output was rebuilt from a reply that was cut short (max_tokens, or a stream that stopped). */
  salvaged: boolean;
}

export interface LineDelta {
  index: number;
  text_so_far: string;
  /** 1 for the first call, 2 for the regeneration. Lines from an earlier attempt are void. */
  attempt: number;
}

export interface GenerateOptions {
  mind: MindClient;
  router?: ModelRouter;
  request: MindRequest;
  /** Extra instructions appended to the user message on every attempt (the forced wrap-up). */
  notes?: readonly string[];
  validation: ValidationContext;
  timings?: Partial<DialogueTimings>;
  /** The client went away: abandon the call. */
  signal?: AbortSignal;
  onLineDelta?: (delta: LineDelta) => void;
  onThinking?: () => void;
  /** A hard validation failure; lets the route attach its reason to a subsequent visible restart. */
  onHardFailure?: (reason: string) => void;
  now?: () => number;
}

const FAILURE_MESSAGES: Record<TurnFailureCode, string> = {
  riddle_authored: "A riddle-topic turn: the resident gives the authored hint for the unlocked level (§14.2).",
  budget: "Written lines for today.", safety: "Let’s keep this in town.",
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
export function dialogueParams(request: MindRequest, notes: readonly string[] = [], router = defaultRouter, selected = router.resolve("dialogue").model): Anthropic.MessageCreateParamsNonStreaming {
  if (notes.length === 0) return apiParams("dialogue", request, router, selected);
  const messages = [...request.messages];
  const last = messages.pop();
  if (!last || last.role !== "user") throw new Error("dialogue request must end with a user message");
  const content: Anthropic.ContentBlockParam[] = typeof last.content === "string"
    ? [{ type: "text", text: last.content }]
    : [...last.content];
  for (const note of notes) content.push({ type: "text", text: note });
  return apiParams("dialogue", { ...request, messages: [...messages, { role: "user", content }] }, router, selected);
}

/**
 * A one-token request with exactly the dialogue's blocks 1-3, settings and output format, to write the prompt
 * cache before the first real turn (§9.10 step 1). The structured-output schema is part of the cached prefix, so
 * the prewarm must carry the same `output_config.format` as a real turn or the first turn misses the cache
 * (measured on staging 2026-10-14: a schema-less prewarm cached 5.8k tokens, the real turn then wrote 7.2k).
 * `max_tokens: 0` rejects a format, so the prewarm asks for one token and ignores it (stop_reason max_tokens).
 */
export function prewarmParams(prefix: ResidentPrefix, day: number, history = "", router = defaultRouter): Anthropic.MessageCreateParamsNonStreaming {
  const settings = requestSettings("dialogue");
  return modelParams("dialogue", {
    model: settings.model,
    max_tokens: 1,
    ...(settings.thinking ? { thinking: settings.thinking } : {}),
    system: prefixSystemBlocks(prefix, day),
    messages: [{ role: 'user', content: [{ type: 'text', text: historyBlock(history), cache_control: { type: 'ephemeral' } }] }, { role: 'user', content: 'warmup' }],
    output_config: { format: modelOutputFormat(DialogueTurnOutput) },
  } as Anthropic.MessageCreateParamsNonStreaming, router);
}

const textOf = (message: Anthropic.Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

/** A call of an attempt that didn't supply its result (a hedge that lost, a first try that failed). */
interface ExtraCall { tokens: CallTokens; latencyMs: number; firstTokenMs: number | null; validation: string }

type Attempt =
  | { kind: "message"; message: Anthropic.Message; latencyMs: number; firstTokenMs: number | null; extra: ExtraCall[] }
  | {
    kind: "failed"; code: "timeout" | "aborted" | "budget" | "safety" | "unavailable" | "api_error"; error: unknown; tokens: CallTokens; latencyMs: number;
    firstTokenMs: number | null; extra: ExtraCall[];
  };

/** GDD-GAP: after abandoning a call, wait this long for the SDK to report the usage it saw (input is billed). */
const SETTLE_MS = 250;

interface Leg {
  controller: AbortController;
  started: number;
  first: number | null;
  done: boolean;
  settled: number | null;
  /** Cancelled because the other call streamed first. */
  lost: boolean;
  message?: Anthropic.Message;
  error?: unknown;
}

const originalError = (error: unknown): unknown => (error instanceof MindStreamError ? error.original : error);
const tokensOfError = (error: unknown): CallTokens => (error instanceof MindStreamError ? error.tokens : NO_TOKENS);

/**
 * One attempt: a streamed call, plus at most one more of the same request (the hedge at `hedgeMs`, or a fast retry
 * when the first fails before any text). Whichever streams first supplies the attempt; the other is cancelled.
 */
async function callOnce(
  mind: MindClient,
  params: Anthropic.MessageCreateParamsNonStreaming,
  timings: DialogueTimings,
  outer: AbortSignal | undefined,
  onText: (delta: string) => void,
  now: () => number,
): Promise<Attempt> {
  const start = now();
  // Assigned from timer and abort callbacks; the casts keep TypeScript from narrowing them to null.
  let stopped = null as "timeout" | "aborted" | null;
  let stoppedAt = 0;
  let winner = null as Leg | null;
  const legs: Leg[] = [];
  let wake: () => void = () => undefined;
  const changed = () => wake();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };

  const launch = (): void => {
    const leg: Leg = { controller: new AbortController(), started: now(), first: null, done: false, settled: null, lost: false };
    legs.push(leg);
    const call = mind.streamMessage(params, {
      signal: leg.controller.signal,
      onText: (delta) => {
        if (stopped || (winner && winner !== leg)) return;
        if (!winner) {
          winner = leg;
          leg.first = now();
          for (const other of legs) if (other !== leg && !other.done) { other.lost = true; other.controller.abort(); }
        }
        onText(delta);
      },
    });
    call.then((message) => { leg.message = message; }, (error: unknown) => { leg.error = error; })
      .finally(() => { leg.done = true; leg.settled = now(); changed(); });
  };
  const stop = (why: "timeout" | "aborted"): void => {
    if (stopped) return;
    stopped = why;
    stoppedAt = now();
    for (const leg of legs) leg.controller.abort();
    later(SETTLE_MS, changed);
    changed();
  };

  later(timings.firstTextMs, () => { if (!winner) stop("timeout"); });
  later(timings.attemptMs, () => stop("timeout"));
  later(timings.hedgeMs, () => {
    if (!stopped && !winner && legs.length === 1 && !legs[0]!.done) { launch(); changed(); }
  });
  const onOuterAbort = () => stop("aborted");
  outer?.addEventListener("abort", onOuterAbort, { once: true });

  const elapsed = () => Math.round(now() - start);
  const sinceStart = (leg: Leg | null) => (leg?.first == null ? null : Math.round(leg.first - start));
  const extras = (main: Leg | null): ExtraCall[] => legs.filter((leg) => leg !== main).map((leg) => {
    const code = originalError(leg.error) instanceof BudgetError ? "budget" : originalError(leg.error) instanceof MindUnavailableError ? "unavailable" : "api_error";
    return {
      tokens: leg.message ? tokensOf(leg.message.usage) : tokensOfError(leg.error),
      latencyMs: Math.round((leg.settled ?? now()) - leg.started),
      firstTokenMs: leg.first === null ? null : Math.round(leg.first - leg.started),
      validation: leg.lost ? "hedge_lost" : `retried:${code}`,
    };
  });
  const failed = (code: Extract<Attempt, { kind: "failed" }>["code"], leg: Leg | null): Attempt => ({
    kind: "failed", code, error: originalError(leg?.error), tokens: tokensOfError(leg?.error), latencyMs: elapsed(),
    firstTokenMs: sinceStart(leg), extra: extras(leg),
  });
  const codeOf = (leg: Leg): "budget" | "safety" | "unavailable" | "api_error" =>
    originalError(leg.error) instanceof BudgetError ? "budget" : originalError(leg.error) instanceof MindUnavailableError ? "unavailable" : "api_error";

  const decide = (): Attempt | null => {
    if (stopped) {
      const main = winner ?? legs.at(-1) ?? null;
      if (legs.some((leg) => !leg.done) && now() - stoppedAt < SETTLE_MS) return null;
      return failed(stopped, main);
    }
    if (!winner) {
      // A call can end without any text (a refusal, an empty reply): that's its answer.
      const quiet = legs.find((leg) => leg.done && leg.message);
      if (quiet) winner = quiet;
    }
    if (winner) {
      if (!winner.done) return null;
      for (const leg of legs) if (leg !== winner && !leg.done) { leg.lost = true; leg.controller.abort(); }
      if (winner.message) {
        return { kind: "message", message: winner.message, latencyMs: elapsed(), firstTokenMs: sinceStart(winner), extra: extras(winner) };
      }
      return failed(codeOf(winner), winner);
    }
    if (legs.length > 0 && legs.every((leg) => leg.done)) {
      const last = legs.at(-1)!;
      const left = timings.firstTextMs - (now() - start);
      if (legs.length === 1 && codeOf(last) !== "unavailable" && left >= timings.retryWindowMs) { launch(); return null; }
      return failed(codeOf(last), last);
    }
    return null;
  };

  try {
    if (outer?.aborted) stop("aborted");
    else launch();
    for (;;) {
      const result = decide();
      if (result) return result;
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
    for (const leg of legs) if (!leg.done) leg.controller.abort();
  }
}

/**
 * Is this complete line safe to show before validation? Same lexical and riddle rules, and none of the line-level
 * soft slips: another resident's catchphrase, the Fellow wrongly gendered, a never-says word, money that isn't
 * Monde's, a card sample quoted back, the resident's own tic said twice (`earlier`: this turn's lines before it).
 * A slip held back before anything shows leaves the attempt silent, so its regeneration never reads as a restart.
 */
function streamSafe(text: string, validation: ValidationContext, earlier: readonly string[]): boolean {
  if (lexicalHits(text).length > 0) return false;
  if (borrowedHits(text, validation.borrowed ?? []).length > 0) return false;
  if (validation.fellow && misgenderHit(text, validation.fellow)) return false;
  if (neverSaysHit(text, validation.neverSays ?? [])) return false;
  if (currencyHit(text)) return false;
  if (sampleEcho(text, validation.samples ?? [], validation.vocabulary ?? [], validation.tics ?? [])) return false;
  const said = [...(validation.conversationLines ?? []), ...earlier];
  if (borrowedHits(text, validation.own ?? []).some((s) => said.some((line) => borrowedHits(line, [s]).length > 0))) return false;
  return !validation.riddle; // Riddle-topic output is held until the complete turn has passed the guard.
}

/**
 * Rebuild and validate a reply that was cut short. Null when no whole line survives or the rebuilt turn fails
 * validation (it isn't regenerated: a cut-short reply has already used the time a second attempt would need).
 */
function salvage(raw: string, validation: ValidationContext): { output: DialogueTurnOutput; rawOutput: string; adjustments: string[] } | null {
  const rebuilt = salvageTurn(raw);
  if (!rebuilt) return null;
  const rawOutput = JSON.stringify(rebuilt.turn);
  const validated = validateTurn(rawOutput, validation);
  const kept = validated.ok ? validated : validated.soft
    ? { output: validated.soft.output, adjustments: [...validated.soft.adjustments, `kept despite ${validated.category}: ${validated.detail}`] }
    : null;
  if (!kept) return null;
  return { output: kept.output, rawOutput, adjustments: [`salvaged ${JSON.stringify(rebuilt.kept)}`, ...kept.adjustments] };
}

export async function generateTurn(options: GenerateOptions): Promise<GenerateResult> {
  const router = options.router ?? defaultRouter;
  const selectedModel = router.resolve("dialogue").model;
  const timings = { ...DEFAULT_TIMINGS, ...options.timings };
  const now = options.now ?? (() => performance.now());
  const notes = options.notes ?? [];
  const calls: CallRecord[] = [];
  let visible = false;
  let finished = false;
  const thinkingTimer = setTimeout(() => {
    if (!visible && !finished) options.onThinking?.();
  }, timings.thinkingMs);
  // A first attempt that failed only soft checks: kept if the regeneration can't do better (validate.ts 8-10).
  let spare: { output: DialogueTurnOutput; rawOutput: string; adjustments: string[]; slips: number } | null = null;
  const fail = (code: TurnFailureCode): GenerateResult => (spare
    ? { output: spare.output, rawOutput: spare.rawOutput, adjustments: spare.adjustments, failure: null, calls, salvaged: false }
    : { output: null, failure: failure(code), calls, adjustments: [], salvaged: false });

  try {
    // Riddle-topic turns may only show authored hint wording (validate.ts step 5), so a model call can only fail
    // the guard and cost ~3.7 s before the same authored hint appears. Serve it straight away instead.
    if (options.validation.riddle) return fail("riddle_authored");
    let corrective: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const params = dialogueParams(options.request, corrective ? [...notes, corrective] : notes, router, selectedModel);
      const extractor = new LineTextExtractor();
      const shown: string[] = [];
      let raw = "";
      let suppressed = false;
      let attemptVisible = false;
      // Exit-tic removal depends on the final wrap_up flag; defer affected lines until it is known.
      const exitTics = options.validation.exit ? [] : options.validation.exitOnly ?? [];
      const onText = (delta: string) => {
        raw += delta;
        for (const line of extractor.push(delta)) {
          if (suppressed || line.index >= LIMITS.dialogue.maxLines) continue;
          // A complete line decides actions, address agreement and money idioms. Partial spellings can
          // still change ("penny" → "penny whistle", "*action*" → "(action)"). Hold them until decided.
          if (!line.done) continue;
          const repaired = repairDialogueLine(line.text, options.validation);
          const stripped = exitTics.length > 0 ? stripTics(repaired, exitTics) : repaired;
          // wrap_up arrives later and can keep an exit tic; removing an empty line also shifts indices.
          // Defer this line and everything after it until the authoritative turn resolves those choices.
          if (!repaired || stripped !== repaired) { suppressed = true; continue; }
          const fitted = fitText(repaired, LIMITS.dialogue.lineChars);
          const head = splitLine(repaired, LIMITS.dialogue.lineChars)?.[0] ?? fitted;
          // Whether splitting is allowed depends on the final line count. Only show their common prefix,
          // then defer later indices (a split could insert a new line ahead of them).
          let text = fitted;
          if (repaired.length > LIMITS.dialogue.lineChars) {
            let end = 0;
            while (end < fitted.length && end < head.length && fitted[end] === head[end]) end++;
            text = fitted.slice(0, end).trimEnd();
            suppressed = true;
          }
          if (!streamSafe(text, options.validation, shown.slice(0, line.index).filter(Boolean))) { suppressed = true; continue; }
          if (text.trim() === "" || text === shown[line.index]) continue;
          shown[line.index] = text;
          if (options.onLineDelta) {
            visible = true;
            attemptVisible = true;
            if (attempt === 2) spare = null;
            options.onLineDelta({ index: line.index, text_so_far: text, attempt });
          }
        }
      };
      const result = await callOnce(options.mind, params, timings, options.signal, onText, now);
      for (const extra of result.extra) {
        calls.push({ attempt, model: params.model, costUsd: costUsd(extra.tokens, params.model), stopReason: "none", ...extra });
      }
      const record = (tokens: CallTokens, stopReason: string, validation: string): void => {
        calls.push({
          attempt, model: params.model, tokens, costUsd: costUsd(tokens, params.model), latencyMs: result.latencyMs,
          firstTokenMs: result.firstTokenMs, stopReason, validation,
        });
      };
      const salvaged = (tokens: CallTokens, stopReason: string, validation: string): GenerateResult | null => {
        const kept = salvage(raw, options.validation);
        if (!kept) return null;
        record(tokens, stopReason, validation);
        return { ...kept, failure: null, calls, salvaged: true };
      };

      if (result.kind === "failed") {
        // It started and then stalled or dropped: keep what already streamed rather than swap in a filler.
        if (result.firstTokenMs !== null && result.code !== "aborted") {
          const kept = salvaged(result.tokens, "none", `salvaged:${result.code}`);
          if (kept) return kept;
        }
        record(result.tokens, "none", result.code);
        return fail(result.code);
      }
      const { message } = result;
      const tokens = tokensOf(message.usage);
      const stopReason = message.stop_reason ?? "none";
      // Always check stop_reason before reading content (AGENTS.md; refusals have no server-side fallback on Haiku).
      if (stopReason === "refusal") {
        record(tokens, stopReason, stopReason);
        return fail("refusal");
      }
      if (stopReason === "max_tokens") {
        raw = textOf(message) || raw;
        const kept = salvaged(tokens, stopReason, "salvaged");
        if (kept) return kept;
        record(tokens, stopReason, stopReason);
        return fail("max_tokens");
      }
      if (stopReason !== "end_turn" && stopReason !== "stop_sequence") {
        record(tokens, stopReason, `stop:${stopReason}`);
        return fail("invalid_output");
      }
      const validated = validateTurn(textOf(message), options.validation);
      if (validated.ok) {
        record(tokens, stopReason, "ok");
        return { output: validated.output, rawOutput: textOf(message), failure: null, calls, adjustments: validated.adjustments, salvaged: false };
      }
      if (validated.soft) {
        const kept = {
          output: validated.soft.output, rawOutput: textOf(message), slips: validated.soft.slips.length,
          adjustments: [...validated.soft.adjustments, `kept despite ${validated.soft.slips.map((s) => `${s.category}: ${s.detail}`).join("; ")}`],
        };
        if (attemptVisible || attempt === 2) {
          // Visible text wins. Only silent attempts may compete on their number of slips.
          const first = !attemptVisible && spare && spare.slips < kept.slips ? spare : null;
          record(tokens, stopReason, first ? validated.category : `kept:${validated.category}`);
          const chosen = first ?? kept;
          return { output: chosen.output, rawOutput: chosen.rawOutput, adjustments: chosen.adjustments, failure: null, calls, salvaged: false };
        }
        spare = kept;
      }
      if (!validated.soft) options.onHardFailure?.(`${validated.category}: ${validated.detail}`);
      record(tokens, stopReason, validated.category);
      // Every soft slip in one note, which still sends the retry back to the Fellow's line first.
      corrective = validated.soft ? softNote(validated.soft.slips) : correctiveNote(validated.category, validated.detail);
    }
    return fail("invalid_output");
  } finally {
    finished = true;
    clearTimeout(thinkingTimer);
  }
}
