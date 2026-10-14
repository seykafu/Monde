/**
 * The seam between monde-mind and the Claude API. Everything that talks to Anthropic goes through a MindClient,
 * so tests inject a fake and a server with no API key runs on authored fallbacks (like Quiet Mode, GDD §9.14).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { NO_TOKENS, type CallTokens } from "./pricing.js";

export interface StreamOptions {
  /** Aborts the call (deadline or client gone). The returned promise then rejects. */
  signal: AbortSignal;
  /** Called with each text delta as it arrives. */
  onText: (delta: string) => void;
}

export interface MindClient {
  /** False when no model is configured; callers skip straight to the authored fallback. */
  readonly enabled: boolean;
  /** `client.messages.stream(params)` → the final message. Never retried past the signal. */
  streamMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: StreamOptions): Promise<Anthropic.Message>;
  /** A plain `client.messages.create(params)` (used for `max_tokens: 0` prewarms, which reject `stream: true`). */
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
}

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
  constructor(private readonly anthropic: Anthropic) {}

  async streamMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: StreamOptions): Promise<Anthropic.Message> {
    const stream = this.anthropic.messages.stream(params, { signal: options.signal });
    stream.on("text", (delta) => options.onText(delta));
    try {
      return await stream.finalMessage();
    } catch (error) {
      throw new MindStreamError(error, tokensOf(stream.currentMessage?.usage));
    }
  }

  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: { signal?: AbortSignal } = {}): Promise<Anthropic.Message> {
    return this.anthropic.messages.create(params, { signal: options.signal });
  }
}

/** No key configured: every call fails fast so the endpoints answer with authored fallbacks. */
export class DisabledMindClient implements MindClient {
  readonly enabled = false;
  async streamMessage(): Promise<Anthropic.Message> { throw new MindUnavailableError(); }
  async createMessage(): Promise<Anthropic.Message> { throw new MindUnavailableError(); }
}

export function createMindClient(config: Pick<Config, "ANTHROPIC_API_KEY">): MindClient {
  if (!config.ANTHROPIC_API_KEY) return new DisabledMindClient();
  // One SDK retry: dialogue calls are bounded by their own deadlines (dialogue.ts), so a retry can only help
  // inside that window, and a prewarm that fails twice isn't worth a third try.
  return new AnthropicMindClient(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 }));
}
