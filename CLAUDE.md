@AGENTS.md

## Claude-specific
- Auto-commit and push every reviewed change to `origin main` (standing instruction from Kasey).
- Workflow: **GPT-6.2 Astra writes all code**; Claude Opus scopes, specs, checks, reviews and commits; writing
  (content, copy) goes to Sonnet subagents. Monde runs on Kasey's `astra-build` plugin (`~/Code/claude-build`):
  every code change goes through `/astra-build:build` (worktree → spec → Codex → `checks.sh` → diff review →
  findings back with `--resume` → `land.sh`, which commits with a `Codex-Job: <threadId>` trailer and pushes).
  `.claude/build.json` says what counts as code, the checks (typecheck, tests, lint) and the worktree setup.
  Opus never edits code itself, not even a one-liner: the plugin's edit guard blocks it and its commit hook (in
  `.git/hooks`, installed at session start) refuses code commits without the trailer. Kasey alone can lift the
  guard (start Claude with `ASTRA_BUILD_ALLOW_OPUS=1`; the commit then says `Codex-Job: none (<reason>)`). The
  model and Codex CLI minimum (0.169) are in `.claude/build.json`.
- Reviewing Astra's work in Monde, beyond the plugin's checklist: add `npm run verify:puzzles`,
  `npm run lint:content`, `npm run scenes` or `npm run residents` when the change touches those; look for numbers
  not in the GDD without a `// GDD-GAP:` comment, Phaser or DOM imports in pure modules
  (`client/src/{combat,town,sim/rules}`, `shared/`), asset URLs not built on `import.meta.env.BASE_URL`, and the
  Claude API rules in AGENTS.md; for anything visible, run the worktree's client on its own port and screenshot it.
- Node on this Mac is x86_64 under Rosetta; fine for Vite/Phaser.
