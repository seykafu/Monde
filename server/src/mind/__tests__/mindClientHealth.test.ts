import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { API_ERROR_LOG_INTERVAL_MS, AnthropicMindClient, type ApiErrorInfo } from "../mindClient.js";

// Nov 2026: the staging key was revoked and every resident fell back to written lines for days while /v1/health
// said "ok" and nothing was logged. A rejected key now shows on health and in the log (throttled).
const apiError = (status: number, type: string) => Anthropic.APIError.generate(status,
  { type: "error", error: { type, message: type === "authentication_error" ? "invalid x-api-key" : type } },
  undefined, new Headers({ "request-id": "req_test" }));

function client(create: () => Promise<unknown>) {
  const logs: ApiErrorInfo[] = [];
  let now = 0;
  const anthropic = { messages: { create }, models: { retrieve: create } } as unknown as Anthropic;
  const mind = new AnthropicMindClient(anthropic, (info) => logs.push(info), () => now);
  return { mind, logs, advance: (ms: number) => { now += ms; } };
}
const params = { model: "claude-haiku-5-5", max_tokens: 16, messages: [{ role: "user" as const, content: "hi" }] };

describe("AnthropicMindClient health", () => {
  it("reports a rejected key and logs it once a minute, without the key", async () => {
    const { mind, logs, advance } = client(() => Promise.reject(apiError(401, "authentication_error")));
    expect(mind.health()).toBe("unchecked");
    await mind.warm();
    expect(mind.health()).toBe("key_rejected");
    await expect(mind.createMessage(params)).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
    expect(logs).toEqual([{ status: 401, type: "authentication_error", requestId: "req_test", message: expect.stringContaining("invalid x-api-key") }]);
    advance(API_ERROR_LOG_INTERVAL_MS);
    await expect(mind.createMessage(params)).rejects.toThrow();
    expect(logs).toHaveLength(2);
  });

  it("clears once a call succeeds, and ignores errors that say nothing about the key", async () => {
    let fail: unknown = apiError(401, "authentication_error");
    const { mind, logs } = client(() => (fail ? Promise.reject(fail) : Promise.resolve({ stop_reason: "end_turn" })));
    await mind.warm();
    expect(mind.health()).toBe("key_rejected");
    fail = null;
    await mind.createMessage(params);
    expect(mind.health()).toBe("ok");
    fail = new Anthropic.APIConnectionTimeoutError();
    await expect(mind.createMessage(params)).rejects.toThrow();
    fail = apiError(529, "overloaded_error");
    await expect(mind.createMessage(params)).rejects.toThrow();
    expect(mind.health()).toBe("ok");
    expect(logs.map((l) => l.status)).toEqual([401, 529]);
  });
});
