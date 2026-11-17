@AGENTS.md

## Claude-specific
- Auto-commit and push every reviewed change to `origin main` (standing instruction from Kasey).
- Workflow: Claude Opus orchestrates and reviews; heavy implementation goes to Codex (`/codex:rescue`,
  GPT-6.2 Astra preferred: `--model gpt-6.2-astra`, which needs Codex CLI 0.169 or later); writing goes to
  Sonnet subagents. Always review Codex output (diff, typecheck, tests, screenshots for visual work) before
  committing.
- Node on this Mac is x86_64 under Rosetta; fine for Vite/Phaser.
