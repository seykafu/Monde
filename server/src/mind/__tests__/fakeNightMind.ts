/**
 * A MindClient for night-pass tests. Night calls run concurrently, so instead of a script queue (fakeMind.ts) a
 * responder function answers each createMessage by kind ("plan" | "reflect") and resident id. Every request body
 * is recorded, and the fake tracks how many calls are in flight at once.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { MindClient } from "../mindClient.js";
import { message } from "./fakeMind.js";

export type NightReply =
  | { output: unknown; stopReason?: Anthropic.StopReason; usage?: Partial<Anthropic.Usage> }
  | { error: unknown }
  | { hang: true };

export interface NightCall {
  kind: "plan" | "reflect";
  resident: string;
  body: Anthropic.MessageCreateParamsNonStreaming;
}

export type Responder = (call: NightCall) => NightReply | Promise<NightReply>;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new Error("aborted by signal")); return; }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted by signal")); }, { once: true });
});

function userText(body: Anthropic.MessageCreateParamsNonStreaming): string {
  const last = body.messages.at(-1)!;
  return typeof last.content === "string" ? last.content : last.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

export function describeCall(body: Anthropic.MessageCreateParamsNonStreaming): Omit<NightCall, "body"> {
  const text = userText(body);
  const kind = text.includes("<plan_request>") ? "plan" : text.includes("<reflect_request>") ? "reflect" : null;
  if (!kind) throw new Error("FakeNightMind: not a plan or reflection request");
  const system = Array.isArray(body.system) ? body.system.map((b) => b.text).join("\n") : String(body.system);
  const resident = /<persona id="([a-z0-9_]+)">/.exec(system)?.[1];
  if (!resident) throw new Error("FakeNightMind: no persona block");
  return { kind, resident };
}

export class FakeNightMind implements MindClient {
  readonly enabled = true;
  readonly calls: NightCall[] = [];
  inFlight = 0;
  maxInFlight = 0;

  constructor(private readonly respond: Responder, private readonly delayMs = 0) {}

  async streamMessage(): Promise<Anthropic.Message> {
    throw new Error("FakeNightMind: night jobs never stream");
  }

  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options: { signal?: AbortSignal } = {}): Promise<Anthropic.Message> {
    const body = structuredClone(params);
    const call = { ...describeCall(body), body };
    this.calls.push(call);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs) await sleep(this.delayMs, options.signal);
      const reply = await this.respond(call);
      if ("error" in reply) throw reply.error;
      if ("hang" in reply) {
        await new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted by signal")), { once: true });
        });
      }
      if (!("output" in reply)) throw new Error("unreachable");
      const text = typeof reply.output === "string" ? reply.output : JSON.stringify(reply.output);
      return message(text, reply.stopReason ?? "end_turn", { input_tokens: 1000, output_tokens: 450, ...reply.usage });
    } finally {
      this.inFlight--;
    }
  }

  callsFor(kind: NightCall["kind"], resident?: string): NightCall[] {
    return this.calls.filter((c) => c.kind === kind && (resident === undefined || c.resident === resident));
  }
}
