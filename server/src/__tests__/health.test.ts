import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { parseConfig } from "../config.js";

const apps: ReturnType<typeof buildApp>[] = [];
function app(env: NodeJS.ProcessEnv = {}) {
  const instance = buildApp(parseConfig({ LOG_LEVEL: "silent", ...env }));
  apps.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

describe("monde-mind", () => {
  it("uses safe defaults without optional services", () => {
    expect(parseConfig({})).toEqual({
      PORT: 8080, NODE_ENV: "development", MONDE_ENV: "dev", LOG_LEVEL: "info", GIT_SHA: "dev",
    });
    expect(parseConfig({ PORT: "9090", MONDE_ENV: "staging", MONDE_TOKEN_SECRET: "test-secret" }).PORT).toBe(9090);
    expect(() => parseConfig({ PORT: "invalid" })).toThrow();
    expect(() => parseConfig({ MONDE_ENV: "invalid" })).toThrow();
  });
  it("reports disabled services and request ids", async () => {
    const response = await app().inject({ url: "/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true, service: "monde-mind", env: "dev", version: "dev",
      checks: { db: "off", redis: "off" },
    });
    expect(response.headers["x-request-id"]).toBeTruthy();
  });
  it("returns the configured version and dev fallback", async () => {
    expect((await app({ GIT_SHA: "abc123" }).inject({ url: "/v1/version" })).json())
      .toMatchObject({ version: "abc123", prompt_version: expect.stringMatching(/^[0-9a-f]{6,}$/) });
    expect((await app().inject({ url: "/v1/version" })).json()).toMatchObject({ version: "dev" });
  });
  it("reports unreachable services as degraded with HTTP 200", async () => {
    const response = await app({
      DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
      REDIS_URL: "redis://127.0.0.1:1",
    }).inject({ url: "/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, checks: { db: "down", redis: "down" } });
  });
  it.each([
    ["https://game.itch.zone", true], ["https://itch.io", true],
    ["https://creator.itch.io", true], ["http://localhost:5173", true],
    ["https://itch.io.evil.test", false], ["http://game.itch.zone", false],
    ["app://monde", true], ["app://monde.evil", false], ["app://evil", false],
  ])("checks CORS for %s", async (origin, allowed) => {
    const response = await app().inject({ url: "/v1/health", headers: { origin } });
    expect(response.headers["access-control-allow-origin"]).toBe(allowed ? origin : undefined);
  });
});
