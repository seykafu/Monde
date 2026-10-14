/**
 * A scripted MindClient for tests. Each streamMessage call takes the next script; every request body is recorded
 * (also in `allBodies`, shared across a test file) so tests can assert what would have gone to the API.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { MindClient, StreamOptions } from "../mindClient.js";

export type Script =
  | {
    /** An object is JSON-encoded; a string is sent as-is (for malformed output). */
    output: unknown;
    stopReason?: Anthropic.StopReason;
    usage?: Partial<Anthropic.Usage>;
    /** Characters per text delta. */
    chunk?: number;
    /** Delay before each delta. */
    delayMs?: number;
    /** Extra delay before the first delta (to trip the thinking beat). */
    firstDelayMs?: number;
  }
  | { hang: true }
  | { error: unknown };

export const allBodies: Anthropic.MessageCreateParamsNonStreaming[] = [];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function message(text: string, stopReason: Anthropic.StopReason, usage: Partial<Anthropic.Usage> = {}): Anthropic.Message {
  return {
    id: "msg_fake", type: "message", role: "assistant", model: "claude-haiku-5-5",
    content: text ? [{ type: "text", text, citations: null }] : [],
    stop_reason: stopReason, stop_sequence: null,
    usage: {
      input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 3800, cache_creation_input_tokens: 0,
      cache_creation: null, inference_geo: null, server_tool_use: null, service_tier: "standard", output_tokens_details: null,
      ...usage,
    },
  } as unknown as Anthropic.Message;
}

export class FakeMind implements MindClient {
  readonly enabled = true;
  readonly streams: Anthropic.MessageCreateParamsNonStreaming[] = [];
  readonly creates: Anthropic.MessageCreateParamsNonStreaming[] = [];
  /** What createMessage does: resolve like a max_tokens: 0 prewarm, or throw. */
  createBehavior: { error?: unknown } = {};

  constructor(private readonly scripts: Script[] = []) {}

  enqueue(...scripts: Script[]): this {
    this.scripts.push(...scripts);
    return this;
  }

  async streamMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: StreamOptions): Promise<Anthropic.Message> {
    const body = structuredClone(params);
    this.streams.push(body);
    allBodies.push(body);
    const script = this.scripts.shift();
    if (!script) throw new Error("FakeMind: no script left");
    if ("error" in script) throw script.error;
    if ("hang" in script) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted by signal")), { once: true });
      });
    }
    const text = typeof script.output === "string" ? script.output : JSON.stringify(script.output);
    const size = script.chunk ?? 12;
    if (script.firstDelayMs) await sleep(script.firstDelayMs);
    for (let i = 0; i < text.length; i += size) {
      await sleep(script.delayMs ?? 1);
      if (options.signal.aborted) throw new Error("aborted by signal");
      options.onText(text.slice(i, i + size));
    }
    return message(text, script.stopReason ?? "end_turn", script.usage);
  }

  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    const body = structuredClone(params);
    this.creates.push(body);
    allBodies.push(body);
    if (this.createBehavior.error) throw this.createBehavior.error;
    return message("", "max_tokens", { input_tokens: 4, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 3800 });
  }
}
