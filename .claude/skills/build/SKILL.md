---
name: build
description: Make any change to Monde's code the house way. Opus scopes and specs it, GPT-6.2 Astra writes the code through Codex in its own worktree, Opus checks and reviews it and sends findings back to the same Codex thread, then commits with a Codex-Job trailer and pushes to main. Use for every code change (client, server, shared, tools, desktop, scripts), however small; Opus never edits code itself.
---

# /build: Opus specs and reviews, GPT-6.2 Astra writes the code

Code is written by GPT-6.2 Astra through Codex. Opus (you) scopes the work, writes the spec, checks and
reviews what comes back, sends findings back, and commits. Two guards hold the line:
`.claude/hooks/code-goes-to-codex.mjs` blocks Edit/Write on code files, and `.githooks/commit-msg` refuses a
code commit without a `Codex-Job:` trailer. Docs, content (`content/`, which Sonnet writes), specs and config
stay editable. Kasey alone can lift the edit guard for a session (`MONDE_OPUS_CODE=1`).

## 1. Scope
- One task = one coherent change a reviewer can hold in their head (a few hundred lines at most). Split
  bigger work into tasks that land one after another.
- Read the code first, so the spec names the real files, functions and line numbers.
- Pick a kebab-case slug, e.g. `marker-live-position`.

## 2. Worktree
```bash
tools/codex/worktree.sh <slug>
```
It prints the path (`<repo>-codex/<slug>`, branch `codex/<slug>` from origin/main) after `npm ci` and the LFS
checkout. Tasks that run in parallel each get their own worktree, and only when their file lists don't overlap.

## 3. Spec
Copy `tools/codex/SPEC_TEMPLATE.md` to the session scratchpad as `<slug>.spec.md` and fill in every section:
goal, background with paths and line numbers, the change, the files it may touch, checkable acceptance
criteria, out of scope, constraints, and what to report. Astra reads the spec and AGENTS.md and nothing else.

## 4. Run it (background)
```bash
tools/codex/task.sh <scratchpad>/<slug>.spec.md --cwd <worktree>
```
Run it as a background Bash command and wait for the exit notification; don't poll. The summary lists the
files Codex touched, Astra's report and a `Codex-Job: <threadId>` line; the full JSON is `<slug>.spec.result.json`.

## 5. Check (you, in the worktree, gated on exit codes)
```bash
cd <worktree> && npm run typecheck; echo "rc=$?"
npm test; echo "rc=$?"
npm run lint; echo "rc=$?"
```
Add `npm run verify:puzzles`, `npm run lint:content`, `npm run scenes` or `npm run residents` when the change
touches those. Branch on each exit code; never pipe a check through `grep` and treat that as the result.
Astra's own claims about tests don't count: its sandbox can't bind ports or use tsx IPC.

## 6. Review
Read `git -C <worktree> diff origin/main` against the spec. Look for:
- files outside the spec's list, or changes nobody asked for
- numbers not in the GDD without a `// GDD-GAP:` comment; rules that contradict the cited GDD sections
- Phaser or DOM imports in pure modules (`client/src/{combat,town,sim/rules}`, `shared/`)
- new dependencies; asset URLs not built on `import.meta.env.BASE_URL`
- server: work added to a model call's hot path (locks, unindexed scans), fail-closed defaults that hurt the
  player, the Claude API rules in AGENTS.md (no sampling params, no prefill, `stop_reason` checked)
- tests that assert the implementation rather than the behaviour
For anything visible in the game, run the worktree's client on its own port and screenshot it. For a larger
diff, `/code-review` on the worktree is a good second read.

## 7. Send findings back (same thread)
Write the findings to `<slug>.fix-1.md`, each with file:line, what's wrong and what right looks like, then:
```bash
tools/codex/task.sh <scratchpad>/<slug>.fix-1.md --cwd <worktree> --resume
```
Repeat steps 5–7. Never patch the code yourself, even a one-liner. After three rounds without a clean result,
stop: shrink the spec, recreate the worktree and start a fresh thread.

## 8. Commit and push
In the worktree, once every check passes and the review is clean:
```bash
git -C <worktree> add -A && git -C <worktree> commit -F <message-file>
```
The message follows the repo's style: a plain-English title of what's now true, a body that says why and
what was checked, then the trailers:
```
Codex-Job: <threadId>
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Then land it on main (trunk-based; Kasey's standing instruction is to push every reviewed change):
```bash
git -C <worktree> fetch origin && git -C <worktree> rebase origin/main
# if the rebase brought in new commits, rerun step 5 before pushing
git -C <worktree> push origin HEAD:main
```
Update the main checkout with `git pull --ff-only` when it's clean, then clean up:
`git worktree remove <worktree> && git branch -D codex/<slug>`.

## When Codex can't do it
If the companion or the model is down, stop and tell Kasey; don't fall back to writing the code yourself.
If Kasey asks you to write code directly, they start Claude with `MONDE_OPUS_CODE=1`, and the commit says
`Codex-Job: none (<reason>)`.
