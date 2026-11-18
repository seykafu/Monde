/**
 * The seam between monde-mind and the Claude API. Everything that talks to Anthropic goes through a MindClient,
 * so tests inject a fake and a server with no API key runs on authored fallbacks (like Quiet Mode, GDD §9.14).
 */
import Anthropic from "@anthropic-ai/sdk";
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
}

/**
 * `key_rejected`: the API answered 401/403 and nothing has succeeded since, so every resident is on written lines
 * (Nov 2026: a revoked key looked like "ok" on /v1/health for days). `unchecked`: no call has answered yet.
 */
export type MindHealth = "ok" | "off" | "key_rejected" | "unchecked";
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
  private keyRejected = false;
  private readonly logged = new Map<string, number>();
  constructor(private readonly anthropic: Anthropic, private readonly onApiError?: ApiErrorLog, private readonly clock: () => number = Date.now) {}

  health(): MindHealth { return this.keyRejected ? "key_rejected" : this.answered ? "ok" : "unchecked"; }

  async streamMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: StreamOptions): Promise<Anthropic.Message> {
    const stream = this.anthropic.messages.stream(params, { signal: options.signal });
    stream.on("text", (delta) => options.onText(delta));
    try {
      return this.succeeded(await stream.finalMessage());
    } catch (error) {
      this.failed(error);
      throw new MindStreamError(error, tokensOf(stream.currentMessage?.usage));
    }
  }

  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: { signal?: AbortSignal } = {}): Promise<Anthropic.Message> {
    return this.track(this.anthropic.messages.create(params, { signal: options.signal }));
  }

  async *listBatches(options?: BatchOptions): AsyncIterable<BatchStatus & { created_at: string }> {
    try {
      yield* this.anthropic.messages.batches.list({}, { timeout: 30_000, signal: options?.signal });
    } catch (error) { this.failed(error); throw error; }
  }
  createBatch(requests: BatchRequest[], options?: BatchOptions): Promise<BatchStatus> {
    return this.track(this.anthropic.messages.batches.create({ requests }, { maxRetries: 0, timeout: 30_000, signal: options?.signal }));
  }
  retrieveBatch(id: string, options?: BatchOptions): Promise<BatchStatus> {
    return this.track(this.anthropic.messages.batches.retrieve(id, {}, { timeout: 30_000, signal: options?.signal }));
  }
  async *batchResults(id: string, options?: BatchOptions): AsyncIterable<BatchResult> {
    try {
      yield* await this.anthropic.messages.batches.results(id, {}, { timeout: 30_000, signal: options?.signal });
    } catch (error) { this.failed(error); throw error; }
  }

  /** A Models API lookup: free, and it leaves a warm connection behind for the first turn. */
  retrieveModel(id: string): Promise<unknown> {
    return this.track(this.anthropic.models.retrieve(id, {}, { signal: AbortSignal.timeout(WARM_TIMEOUT_MS), maxRetries: 0 }));
  }

  /** Also the boot-time key check: a rejected key shows on /v1/health and in the log before anyone talks. */
  async warm(model: string = DEFAULT_MODEL): Promise<void> {
    try {
      await this.track(this.anthropic.models.retrieve(model, {}, { signal: AbortSignal.timeout(WARM_TIMEOUT_MS) }));
    } catch {
      // Nothing to do: the first turn will just open its own connection.
    }
  }

  private async track<T>(call: PromiseLike<T>): Promise<T> {
    try {
      return this.succeeded(await call);
    } catch (error) {
      this.failed(error);
      throw error;
    }
  }
  private succeeded<T>(value: T): T {
    this.answered = true;
    this.keyRejected = false;
    return value;
  }
  /** Only answers from the API count: a timeout, an abort or a dropped connection says nothing about the key. */
  private failed(error: unknown): void {
    if (!(error instanceof Anthropic.APIError) || typeof error.status !== "number") return;
    this.answered = true;
    if (error.status === 401 || error.status === 403) this.keyRejected = true;
    const body = error.error as { error?: { type?: unknown } } | undefined;
    const type = typeof body?.error?.type === "string" ? body.error.type : "unknown";
    const key = `${error.status}:${type}`;
    const now = this.clock();
    const last = this.logged.get(key);
    if (last !== undefined && now - last < API_ERROR_LOG_INTERVAL_MS) return;
    this.logged.set(key, now);
    this.onApiError?.({ status: error.status, type, requestId: error.requestID ?? null, message: error.message.slice(0, 200) });
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

export function createMindClient(config: Pick<Config, "ANTHROPIC_API_KEY" | "ANTHROPIC_WORKSPACE_ID">, onApiError?: ApiErrorLog): MindClient {
  if (!config.ANTHROPIC_API_KEY) return new DisabledMindClient();
  // One SDK retry: dialogue calls are bounded by their own deadlines (dialogue.ts), so a retry can only help
  // inside that window, and a prewarm that fails twice isn't worth a third try.
  const defaultHeaders = config.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": config.ANTHROPIC_WORKSPACE_ID } : undefined;
  return new AnthropicMindClient(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1, defaultHeaders }), onApiError);
}
