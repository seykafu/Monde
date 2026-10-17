import { defineConfig } from "vitest/config";
// PGlite integration tests include durable budget admission transactions; allow CPU contention in the full workspace run.
// Model and endpoint deadlines retain their explicit assertions.
export default defineConfig({ test: { name: "server", testTimeout: 15_000, include: ["src/**/*.test.ts"], passWithNoTests: true, environment: "node" } });
