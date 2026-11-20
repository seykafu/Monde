import type { Config } from "../config.js";
import type { MindStateEvent } from "./mindClient.js";

const reasons = {
  key_rejected: "the API key was rejected",
  no_credit: "the API credit balance is too low",
  error_rate: "too many API calls failed",
};
// GDD-GAP: operational alerts repeat at most once per kind and reason every 30 minutes.
const ALERT_INTERVAL_MS = 30 * 60_000;

export function stateAlerts(config: Pick<Config, "MONDE_ENV" | "ALERT_WEBHOOK_URL">,
  log: { info(message: string): void; error(message: string): void }, send = fetch, clock = Date.now) {
  const last = new Map<string, number>();
  return (event: MindStateEvent): void => {
    const key = event.kind === "recovered" ? event.kind : `${event.kind}:${event.reason}`;
    const now = clock();
    if (now - (last.get(key) ?? -Infinity) < ALERT_INTERVAL_MS) return;
    last.set(key, now);
    const detail = event.kind === "recovered" ? `residents are live again (down ${Math.round(event.downForMs / 60_000)} min).`
      : event.kind === "opened" ? `residents are on written lines: ${reasons[event.reason]}. Fix: docs/RUNBOOK.md`
      : `switched to the backup API key because ${reasons[event.reason]}. Replace the primary soon.`;
    const msg = `Monde (${config.MONDE_ENV}): ${detail}`;
    log[event.kind === "recovered" ? "info" : "error"](msg);
    const url = config.ALERT_WEBHOOK_URL;
    if (url) void Promise.resolve().then(() => send(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: msg, content: msg }), signal: AbortSignal.timeout(5000),
    })).catch(() => {});
  };
}
