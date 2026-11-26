# Codex task spec (template)

Opus copies this file to the session scratchpad as `<slug>.spec.md`, fills in every section, deletes these
instructions and the examples, and runs it with `tools/codex/task.sh <spec> --cwd <worktree>`.
GPT-6.2 Astra reads the spec and `AGENTS.md` and nothing else, so say everything it needs here.

---

# <Task title: what will be true when it's done>

You're working in a git worktree of Monde on branch `codex/<slug>`. Follow `AGENTS.md`. Don't commit or push.

## Goal
One or two sentences: the player-visible or developer-visible result, and why it's wanted.

## Background
What exists today and where, with file paths and line numbers. Quote the current behaviour, and any bug's
repro steps. Name the GDD / MVP_PLAN sections whose rules and numbers apply (e.g. GDD §6.2, MVP G-03).

## Change
What to build, as concrete steps. Name functions, types, events and data shapes when they matter.
Keep pure logic pure (no Phaser or DOM in `client/src/{combat,town,sim/rules}` or `shared/`).

## Files
- May change: `path/one.ts`, `path/two.ts`, and tests next to them in `__tests__/`
- May add: `path/new.ts`
- Must not touch: anything else. If the change seems to need another file, stop and say so in the report.

## Acceptance criteria
Observable and checkable, one per line:
- [ ] e.g. On Day 1 after S01c, the "Talk to Bertrand" marker points at the clocktower door while he's inside it
- [ ] e.g. A new test in `client/src/quests/__tests__/…` covers the live position and the home fallback
- [ ] `npm run typecheck` and `npm test` pass (and `npm run lint`, `npm run verify:puzzles` when relevant)

## Out of scope
What not to do, even if it looks related.

## Constraints
- No new dependencies. No numbers that aren't in the GDD: if one is missing, add a `// GDD-GAP:` comment.
- Server: no extra work on the hot path of a model call (no global locks, no unindexed scans); fail open for
  the player unless the GDD says otherwise.
- Runtime asset URLs resolve against `import.meta.env.BASE_URL`.

## Report back
End with: what you changed (file by file), what you ran and its result, anything you couldn't run (the
sandbox can't bind ports or use tsx IPC, so say so rather than guess), and any open question.
