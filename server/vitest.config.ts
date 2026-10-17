import { defineConfig } from "vitest/config";
// PGlite integration tests include durable budget admission transactions; allow CPU contention in the full workspace run.
// Model and endpoint deadlines retain their explicit assertions.
// MONDE_ROSTER=authored: the unit tests run on the 24 hand-written cards whether or not content/residents/day1/ has
// the census's cards (loadContent.ts); the full-roster tests ask for it ({ roster: "full" }) explicitly.
export default defineConfig({ test: { name: "server", testTimeout: 15_000, include: ["src/**/*.test.ts"], passWithNoTests: true, environment: "node", env: { MONDE_ROSTER: "authored" } } });
