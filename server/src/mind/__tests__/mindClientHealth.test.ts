import { NO_TOKENS } from "../pricing.js";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { API_ERROR_LOG_INTERVAL_MS, AnthropicMindClient, MIND_REST_MS, MindUnavailableError, MindStreamError, type MindStateEvent, type ApiErrorInfo } from "../mindClient.js";

// Nov 2026: the staging key was revoked and every resident fell back to written lines for days while /v1/health
// said "ok" and nothing was logged. A rejected key now shows on health and in the log (throttled).
const apiError = (status: number, type: string) => Anthropic.APIError.generate(status,
  { type: "error", error: { type, message: type === "authentication_error" ? "invalid x-api-key" : type } },
  undefined, new Headers({ "request-id": "req_test" }));

function client(create: () => Promise<unknown>, backup?: () => Promise<unknown>) {
  const logs: ApiErrorInfo[] = [];
  let now = 0;
  const anthropic = { messages: { create }, models: { retrieve: create } } as unknown as Anthropic;
  const events: MindStateEvent[] = [];
  const mind = new AnthropicMindClient(anthropic, {
    clock: () => now, onApiError: info => logs.push(info), onStateChange: e => events.push(e),
    backup: backup ? { messages: { create: backup } } as unknown as Anthropic : undefined,
  });
  return { mind, logs, events, advance: (ms: number) => { now += ms; } };
}
const params = { model: "claude-haiku-5-5", max_tokens: 16, messages: [{ role: "user" as const, content: "hi" }] };

describe("AnthropicMindClient health", () => {
  it("reports a rejected key and logs it once a minute, without the key", async () => {
    const { mind, logs, advance } = client(() => Promise.reject(apiError(401, "authentication_error")));
    expect(mind.health()).toBe("unchecked");
    await mind.warm();
    expect(mind.health()).toBe("key_rejected");
    await expect(mind.createMessage(params)).rejects.toBeInstanceOf(MindUnavailableError);
    expect(logs).toEqual([{ status: 401, type: "authentication_error", requestId: "req_test", message: expect.stringContaining("invalid x-api-key") }]);
    advance(API_ERROR_LOG_INTERVAL_MS);
    await expect(mind.createMessage(params)).rejects.toThrow();
    expect(logs).toHaveLength(2);
  });

  it("clears once a call succeeds, and ignores errors that say nothing about the key", async () => {
    let fail: unknown = apiError(401, "authentication_error");
    const { mind, logs, advance } = client(() => (fail ? Promise.reject(fail) : Promise.resolve({ stop_reason: "end_turn" })));
    await mind.warm();
    expect(mind.health()).toBe("key_rejected");
    advance(MIND_REST_MS);
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

it("ignores aborts and expires old outcomes before applying the rate threshold", async () => {
  let error: unknown;
  const { mind, advance } = client(async () => { if (error) throw error; return {}; });
  const call = () => mind.createMessage(params);
  for (let i = 0; i < 3; i++) await call();
  error = new Anthropic.APIConnectionTimeoutError();
  await expect(call()).rejects.toThrow();
  for (const abort of [new Anthropic.APIUserAbortError(), new MindStreamError(new Anthropic.APIUserAbortError(), NO_TOKENS)]) {
    error = abort;
    await expect(call()).rejects.toThrow();
  }
  expect(mind.available()).toBe(true);
  error = null;
  await call(); // exactly 20%
  expect(mind.available()).toBe(true);
  advance(60_000);
  error = new Anthropic.APIConnectionTimeoutError();
  for (let i = 0; i < 4; i++) await expect(call()).rejects.toThrow();
  expect(mind.available()).toBe(true);
  await expect(call()).rejects.toThrow();
  expect(mind.health()).toBe("error_rate");
});

it("admits one trial, rests after a failed trial, then reports the full downtime", async () => {
  let calls = 0;
  let complete!: () => void;
  const { mind, events, advance } = client(async () => {
    calls++;
    if (calls < 3) throw apiError(400, "credit balance too low");
    await new Promise<void>(resolve => { complete = resolve; });
  });
  const call = () => mind.createMessage(params);
  await expect(call()).rejects.toThrow();
  expect(mind.health()).toBe("no_credit");
  await expect(call()).rejects.toBeInstanceOf(MindUnavailableError);
  expect(calls).toBe(1);
  advance(MIND_REST_MS);
  await expect(call()).rejects.toThrow();
  expect(mind.restRemainingMs()).toBe(MIND_REST_MS);
  advance(MIND_REST_MS);
  const trial = call();
  await expect(call()).rejects.toBeInstanceOf(MindUnavailableError);
  complete();
  await trial;
  expect(mind.health()).toBe("ok");
  expect(events).toEqual([{ kind: "opened", reason: "no_credit" }, { kind: "opened", reason: "no_credit" },
    { kind: "recovered", downForMs: 2 * MIND_REST_MS }]);
});

it.each([true, false])("switches once when the primary is rejected (backup works: %s)", async works => {
  let primary = 0, backup = 0;
  const { mind, events } = client(async () => { primary++; throw apiError(401, "authentication_error"); },
    async () => { backup++; if (!works) throw apiError(401, "authentication_error"); return {}; });
  for (let i = 0; i < 2; i++) {
    const call = mind.createMessage(params);
    if (works) await call;
    else await expect(call).rejects.toThrow();
  }
  expect(primary).toBe(1);
  expect(backup).toBe(works ? 2 : 1);
  expect(mind.keyInUse()).toBe("backup");
  expect(mind.health()).toBe(works ? "ok" : "key_rejected");
  expect(events).toEqual([{ kind: "switched_to_backup", reason: "key_rejected" },
    ...(works ? [] : [{ kind: "opened", reason: "key_rejected" }])]);
});

it.each([true, false])("replays a rejected stream on backup only before text (delivered: %s)", async delivered => {
  const deltas: string[] = [];
  let backupCalls = 0;
  const sdk = (primary: boolean) => ({ messages: { stream: () => {
    if (!primary) backupCalls++;
    return {
      on: (_event: string, handler: (delta: string) => void) => {
        if (primary && delivered) handler("first");
        if (!primary) handler("backup");
      },
      finalMessage: async () => { if (primary) throw apiError(403, "permission_error"); return {}; },
    };
  } } }) as unknown as Anthropic;
  const mind = new AnthropicMindClient(sdk(true), { backup: sdk(false) });
  const stream = () => mind.streamMessage(params, { signal: new AbortController().signal, onText: text => deltas.push(text) });
  if (delivered) await expect(stream()).rejects.toBeInstanceOf(MindStreamError);
  else await stream();
  expect(backupCalls).toBe(delivered ? 0 : 1);
  expect(deltas).toEqual([delivered ? "first" : "backup"]);
  expect(mind.keyInUse()).toBe("backup");
});

it("guards batch iteration, model lookup, streams and warmup during rest", async () => {
  let calls = 0;
  const { mind } = client(async () => { calls++; throw apiError(401, "authentication_error"); });
  await mind.warm();
  const read = async (items: AsyncIterable<unknown>) => { for await (const item of items) void item; };
  for (const call of [mind.createBatch([]), mind.retrieveBatch("batch"), read(mind.batchResults("batch")),
    read(mind.listBatches()), mind.retrieveModel("model"), mind.streamMessage(params, {
      signal: new AbortController().signal, onText: () => {},
    })]) await expect(call).rejects.toBeInstanceOf(MindUnavailableError);
  await mind.warm();
  expect(calls).toBe(1);
});
