import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/db/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  noExternal: ["@monde/shared"],
  // Prompt templates are read at runtime from ./prompts next to the bundle (promptBuilder.promptsDirectory).
  onSuccess: "rm -rf dist/prompts && cp -R src/mind/prompts dist/prompts"
});
