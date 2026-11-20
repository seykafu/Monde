import { expect, it, vi } from "vitest";
import { stateAlerts } from "../alerts.js";

it("throttles by event and reason and keeps secrets and delivery failures out of alerts", async () => {
  let now = 0;
  const log = { info: vi.fn(), error: vi.fn() };
  const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("sk-ant-test"));
  const notify = stateAlerts({ MONDE_ENV: "staging", ALERT_WEBHOOK_URL: "https://example.test/sk-ant-secret" }, log, send, () => now);
  const opened = { kind: "opened", reason: "key_rejected" } as const;
  notify(opened);
  notify(opened);
  notify({ kind: "switched_to_backup", reason: "key_rejected" });
  notify({ kind: "opened", reason: "no_credit" });
  notify({ kind: "recovered", downForMs: 840_000 });
  now += 30 * 60_000;
  notify(opened);
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(5);
  expect(log.error).toHaveBeenCalledTimes(4);
  expect(log.info).toHaveBeenCalledWith(expect.stringContaining("down 14 min"));
  for (const [, init] of send.mock.calls) {
    const body = JSON.parse(String(init?.body));
    expect(body.content).toBe(body.text);
    expect(body.text).toContain("Monde (staging)");
    expect(body.text).not.toContain("sk-ant");
  }
});
