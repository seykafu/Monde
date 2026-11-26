@AGENTS.md

## Claude-specific
- Auto-commit and push every reviewed change to `origin main` (standing instruction from Kasey).
- Workflow: **GPT-6.2 Astra writes all code**; Claude Opus scopes, specs, checks, reviews and commits; writing
  (content, copy) goes to Sonnet subagents. Every code change goes through the `/build` skill
  (`.claude/skills/build/SKILL.md`): `tools/codex/worktree.sh` → a spec from `tools/codex/SPEC_TEMPLATE.md` →
  `tools/codex/task.sh` → typecheck, tests, lint and a diff review (screenshots for visual work) → findings back
  with `--resume` → commit with a `Codex-Job: <threadId>` trailer and push. Opus never edits code itself, not
  even a one-liner: `.claude/hooks/code-goes-to-codex.mjs` blocks it and `.githooks/commit-msg` refuses code
  commits without the trailer. Kasey alone can lift the edit guard (start Claude with `MONDE_OPUS_CODE=1`; the
  commit then says `Codex-Job: none (<reason>)`). The model is pinned in `tools/codex/task.sh` and
  `~/.codex/config.toml`, and needs Codex CLI 0.169 or later.
- Node on this Mac is x86_64 under Rosetta; fine for Vite/Phaser.
