/**
 * The seam between monde-mind and the Claude API. Everything that talks to Anthropic goes through a MindClient,
 * so tests inject a fake and a server with no API key runs on authored fallbacks (like Quiet Mode, GDD §9.14).
 */
import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { NO_TOKENS, type CallTokens } from "./pricing.js";
import { DEFAULT_MODEL } from "./models.js";

export interface StreamOptions {
  /** Aborts the call (deadline or client gone). The returned promise then rejects. */
  signal: AbortSignal;
  /** Called with each text delta as it arrives. */
  onText: (delta: string) => void;
}

export type BatchOptions = { signal?: AbortSignal };
export type BatchRequest = { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming };
export type BatchStatus = Pick<Anthropic.Messages.MessageBatch, "id" | "processing_status">;
export type BatchResult = Anthropic.Messages.MessageBatchIndividualResponse;

export interface MindClient {
  listBatches(options?: BatchOptions): AsyncIterable<BatchStatus & { created_at: string }>;
  createBatch(requests: BatchRequest[], options?: BatchOptions): Promise<BatchStatus>;
  retrieveBatch(id: string, options?: BatchOptions): Promise<BatchStatus>;
  batchResults(id: string, options?: BatchOptions): AsyncIterable<BatchResult>;
  /** False when no model is configured; callers skip straight to the authored fallback. */
  readonly enabled: boolean;
  /** `client.messages.stream(params)` → the final message. Never retried past the signal. */
  streamMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: StreamOptions): Promise<Anthropic.Message>;
  /** A plain `client.messages.create(params)` (used for `max_tokens: 0` prewarms, which reject `stream: true`). */
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
  /**
   * Open the connection to the API without spending tokens (DNS, TLS, the SDK's first request), so the first
   * dialogue turn after a deploy or a cold start doesn't pay for it. Optional; never rejects.
   */
  warm?(model?: string): Promise<void>;
  retrieveModel?(id: string): Promise<unknown>;
  /** What the API last said about the key, for /v1/health. */
  health?(): MindHealth;
  available?(): boolean;
  restRemainingMs?(): number;
  keyInUse?(): "primary" | "backup";
}

type RestReason = "key_rejected" | "no_credit" | "error_rate";
/** The open breaker's reason, or whether a configured API has answered. */
export type MindHealth = "ok" | "off" | "unchecked" | RestReason;
export type MindStateEvent =
  | { kind: "opened" | "switched_to_backup"; reason: RestReason }
  | { kind: "recovered"; downForMs: number };
// GDD-GAP: reuse §9.14's 60-second observation window as the rest before a trial.
export const MIND_REST_MS = 60_000;
/** One Anthropic API error, as the server logs it: never the key, never the request body. */
export interface ApiErrorInfo { status: number; type: string; requestId: string | null; message: string }
export type ApiErrorLog = (info: ApiErrorInfo) => void;
/** The same status and type is logged at most once a minute: a dead key would otherwise log every turn. */
export const API_ERROR_LOG_INTERVAL_MS = 60_000;

/** GDD-GAP: the boot warm-up gets the prewarm's 5 s; it runs once, in the background. */
export const WARM_TIMEOUT_MS = 5000;

/** Thrown by DisabledMindClient: no API key, so no call was made. */
export class MindUnavailableError extends Error {
  constructor(message = "ANTHROPIC_API_KEY is not set; monde-mind is running on authored fallbacks") {
    super(message);
    this.name = "MindUnavailableError";
  }
}

/** A failed or aborted stream, carrying whatever usage the API reported before it stopped (input is billed). */
export class MindStreamError extends Error {
  constructor(readonly original: unknown, readonly tokens: CallTokens) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "MindStreamError";
  }
}

export function tokensOf(usage: Partial<Anthropic.Usage> | null | undefined): CallTokens {
  if (!usage) return NO_TOKENS;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

export class AnthropicMindClient implements MindClient {
  readonly enabled = true;
  private answered = false;
  private rest?: { reason: RestReason; since: number; retryAt: number; trial: boolean };
  private outcomes: { at: number; failed: boolean }[] = [];
  // Ignore completions from before the last opening, recovery or credential switch.
  private generation = 0;
  private readonly logged = new Map<string, number>();
  private readonly clock: () => number;
  constructor(private anthropic: Anthropic, private readonly options: {
    onApiError?: ApiErrorLog;
    clock?: () => number;
    backup?: Anthropic;
    onStateChange?: (event: MindStateEvent) => void;
  } = {}) { this.clock = options.clock ?? Date.now; }

  keyInUse(): "primary" | "backup" { return this.anthropic === this.options.backup ? "backup" : "primary"; }
  health(): MindHealth { return this.rest?.reason ?? (this.answered ? "ok" : "unchecked"); }
  restRemainingMs(): number { return Math.max(0, (this.rest?.retryAt ?? 0) - this.clock()); }
  available(): boolean { return !this.rest || (!this.rest.trial && this.restRemainingMs() === 0); }

  streamMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: StreamOptions): Promise<Anthropic.Message> {
    let delivered = false;
    return this.call(async sdk => {
      const stream = sdk.messages.stream(params, { signal: options.signal });
      stream.on("text", delta => { delivered = true; options.onText(delta); });
      try { return await stream.finalMessage(); }
      catch (error) { throw new MindStreamError(error, tokensOf(stream.currentMessage?.usage)); }
    }, options.signal, () => !delivered);
  }
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: BatchOptions = {}): Promise<Anthropic.Message> {
    return this.call(sdk => sdk.messages.create(params, options), options.signal);
  }
  listBatches(options?: BatchOptions) {
    return this.iterate(sdk => sdk.messages.batches.list({}, { timeout: 30_000, ...options }), options?.signal);
  }
  createBatch(requests: BatchRequest[], options?: BatchOptions): Promise<BatchStatus> {
    return this.call(sdk => sdk.messages.batches.create({ requests }, { maxRetries: 0, timeout: 30_000, ...options }), options?.signal);
  }
  retrieveBatch(id: string, options?: BatchOptions): Promise<BatchStatus> {
    return this.call(sdk => sdk.messages.batches.retrieve(id, {}, { timeout: 30_000, ...options }), options?.signal);
  }
  batchResults(id: string, options?: BatchOptions) {
    return this.iterate(sdk => sdk.messages.batches.results(id, {}, { timeout: 30_000, ...options }), options?.signal);
  }
  retrieveModel(id: string): Promise<unknown> {
    const signal = AbortSignal.timeout(WARM_TIMEOUT_MS);
    return this.call(sdk => sdk.models.retrieve(id, {}, { signal, maxRetries: 0 }), signal);
  }
  async warm(model: string = DEFAULT_MODEL): Promise<void> {
    const signal = AbortSignal.timeout(WARM_TIMEOUT_MS);
    try { await this.call(sdk => sdk.models.retrieve(model, {}, { signal }), signal); }
    catch { /* Best effort boot probe. */ }
  }

  private iterate<T>(read: (sdk: Anthropic) => AsyncIterable<T> | PromiseLike<AsyncIterable<T>>, signal?: AbortSignal) {
    let delivered = false;
    return this.track(async function* (sdk) {
      for await (const row of await read(sdk)) {
        delivered = true;
        yield row;
      }
    }, signal, () => !delivered);
  }

  private async call<T>(run: (sdk: Anthropic) => PromiseLike<T>, signal?: AbortSignal, canRetry?: () => boolean): Promise<T> {
    // A single response completes the same operation as a paginated read, without yielding intermediate rows.
    // eslint-disable-next-line require-yield
    const operation = this.track(async function* (sdk): AsyncGenerator<never, T> { return await run(sdk); }, signal, canRetry);
    return (await operation.next()).value;
  }

  /** One admission and outcome per operation, including lazy, multi-page SDK reads. */
  private async *track<Item, Result>(run: (sdk: Anthropic) => AsyncGenerator<Item, Result>,
    signal?: AbortSignal, canRetry = () => true): AsyncGenerator<Item, Result> {
    if (!this.available()) throw new MindUnavailableError("Town mind is resting");
    const trial = this.rest;
    if (trial) trial.trial = true;
    let sdk = this.anthropic;
    let generation = this.generation;
    try {
      for (;;) {
        try {
          const result = yield* run(sdk);
          if (generation === this.generation) this.record(false);
          return result;
        } catch (error) {
          const cause = error instanceof MindStreamError ? error.original : error;
          if (signal?.aborted || cause instanceof Anthropic.APIUserAbortError || !(cause instanceof Anthropic.APIError)) throw error;
          if (typeof cause.status !== "number" && !(cause instanceof Anthropic.APIConnectionError)) throw error;
          if (typeof cause.status === "number") this.logError(cause, cause.status);
          const reason = cause.status === 401 || cause.status === 403 ? "key_rejected"
            : cause.status === 400 && /credit balance/i.test(cause.message) ? "no_credit" : undefined;
          if (reason && this.options.backup && sdk !== this.options.backup) {
            if (this.anthropic !== this.options.backup && generation === this.generation) {
              this.anthropic = this.options.backup;
              this.outcomes = [];
              this.generation++;
              this.options.onStateChange?.({ kind: "switched_to_backup", reason });
            }
            if (this.anthropic === this.options.backup && canRetry() && (!this.rest || this.rest === trial)) {
              sdk = this.options.backup;
              generation = this.generation;
              continue;
            }
          }
          if (generation === this.generation) this.record(true, reason);
          throw error;
        }
      }
    } finally {
      if (trial) trial.trial = false;
    }
  }

  private record(failed: boolean, reason?: RestReason): void {
    const now = this.clock();
    if (!failed || reason) this.answered = true;
    if (this.rest && !failed) {
      const downForMs = now - this.rest.since;
      this.rest = undefined;
      this.outcomes = [];
      this.generation++;
      this.options.onStateChange?.({ kind: "recovered", downForMs });
      return;
    }
    this.outcomes = this.outcomes.filter(o => o.at > now - 60_000);
    this.outcomes.push({ at: now, failed });
    // GDD-GAP: require five outcomes before applying §9.14's >20% threshold.
    const highRate = this.outcomes.length >= 5 && this.outcomes.filter(o => o.failed).length > this.outcomes.length * 0.2;
    const openReason = reason ?? this.rest?.reason ?? (highRate ? "error_rate" : undefined);
    if (openReason) {
      const previous = this.rest;
      this.rest = { reason: openReason, since: previous?.since ?? now, retryAt: now + MIND_REST_MS, trial: false };
      this.generation++;
      this.options.onStateChange?.({ kind: "opened", reason: openReason });
    }
  }

  private logError(error: APIError, status: number): void {
    this.answered = true;
    const body = error.error as { error?: { type?: unknown } } | undefined;
    const type = typeof body?.error?.type === "string" ? body.error.type : "unknown";
    const key = `${error.status}:${type}`;
    const now = this.clock();
    const last = this.logged.get(key);
    if (last !== undefined && now - last < API_ERROR_LOG_INTERVAL_MS) return;
    this.logged.set(key, now);
    this.options.onApiError?.({ status, type, requestId: error.requestID ?? null, message: error.message.slice(0, 200) });
  }
}

/** No key configured: every call fails fast so the endpoints answer with authored fallbacks. */
export class DisabledMindClient implements MindClient {
  readonly enabled = false;
  listBatches(): AsyncIterable<BatchStatus & { created_at: string }> { throw new MindUnavailableError(); }
  async createBatch(): Promise<BatchStatus> { throw new MindUnavailableError(); }
  async retrieveBatch(): Promise<BatchStatus> { throw new MindUnavailableError(); }
  batchResults(): AsyncIterable<BatchResult> { throw new MindUnavailableError(); }
  async streamMessage(): Promise<Anthropic.Message> { throw new MindUnavailableError(); }
  async createMessage(): Promise<Anthropic.Message> { throw new MindUnavailableError(); }
}

export function createMindClient(config: Pick<Config, "ANTHROPIC_API_KEY" | "ANTHROPIC_WORKSPACE_ID" | "ANTHROPIC_API_KEY_BACKUP">, onApiError?: ApiErrorLog, onStateChange?: (event: MindStateEvent) => void): MindClient {
  if (!config.ANTHROPIC_API_KEY) return new DisabledMindClient();
  // One SDK retry: dialogue calls are bounded by their own deadlines (dialogue.ts), so a retry can only help
  // inside that window, and a prewarm that fails twice isn't worth a third try.
  const defaultHeaders = config.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": config.ANTHROPIC_WORKSPACE_ID } : undefined;
  const sdk = (apiKey: string) => new Anthropic({ apiKey, maxRetries: 1, defaultHeaders });
  return new AnthropicMindClient(sdk(config.ANTHROPIC_API_KEY), { onApiError, onStateChange,
    backup: config.ANTHROPIC_API_KEY_BACKUP ? sdk(config.ANTHROPIC_API_KEY_BACKUP) : undefined,
  });
}
