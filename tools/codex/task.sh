#!/usr/bin/env bash
# One Codex task, written by GPT-6.2 Astra. In Monde all code is written by Astra; Opus writes the spec,
# checks and reviews the result, and commits (see .claude/skills/build/SKILL.md).
#
# Usage: tools/codex/task.sh <spec.md> --cwd <worktree> [--resume] [--effort low|medium|high|xhigh]
#   <spec.md>   the task (tools/codex/SPEC_TEMPLATE.md), or with --resume the review findings to fix
#   --cwd       the task's worktree (tools/codex/worktree.sh makes one); Codex works and writes only there
#   --resume    continue the last Codex thread in that worktree, so Astra fixes with its context intact
#   --effort    reasoning effort; Codex's default when omitted
#
# Writes <spec>.result.json (status, threadId, touchedFiles, rawOutput), appends a line to the shared
# log <git-common-dir>/codex-tasks.log, and lists the worktree's changes from `git status` in the summary.
# The summary's `Codex-Job:` line goes in the commit.
# Exits with Codex's status. A task takes minutes: run it as a background command.
set -euo pipefail

MODEL="gpt-6.2-astra"
MIN_CLI="0.169.0"

die() { echo "codex/task: $*" >&2; exit 2; }

spec="" cwd="" resume=0 effort=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cwd) cwd="${2:-}"; shift 2 ;;
    --resume) resume=1; shift ;;
    --effort) effort="${2:-}"; shift 2 ;;
    -h|--help) awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$spec" ] || die "one spec file only"; spec="$1"; shift ;;
  esac
done
[ -n "$spec" ] || die "usage: tools/codex/task.sh <spec.md> --cwd <worktree> [--resume] [--effort <level>]"
[ -f "$spec" ] || die "no spec file at $spec"
[ -n "$cwd" ] || die "--cwd <worktree> is required (tools/codex/worktree.sh <slug> makes one)"
[ -d "$cwd" ] || die "no directory at $cwd"
spec="$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")"
cwd="$(cd "$cwd" && pwd)"

# The model needs Codex CLI 0.169+ (older CLIs reject gpt-6.2-* with a 400).
cli="$(codex --version 2>/dev/null | awk '{print $NF}')" || true
[ -n "$cli" ] || die "codex CLI not found (npm install -g @openai/codex)"
if [ "$(printf '%s\n%s\n' "$MIN_CLI" "$cli" | sort -V | head -1)" != "$MIN_CLI" ]; then
  die "codex CLI $cli is older than $MIN_CLI, which $MODEL needs (npm install -g @openai/codex@latest)"
fi

# A task gets its own worktree, so parallel tasks never share files and the main checkout stays clean.
git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$cwd is not a git checkout"
common="$(cd "$cwd" && cd "$(git rev-parse --git-common-dir)" && pwd)"
if [ "$(git -C "$cwd" rev-parse --absolute-git-dir)" = "$common" ]; then
  echo "codex/task: warning: $cwd is the main checkout, not a task worktree" >&2
fi

companion="${CODEX_COMPANION:-}"
if [ -z "$companion" ]; then
  companion="$(ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1)"
fi
[ -n "$companion" ] && [ -f "$companion" ] || die "codex-companion.mjs not found (install the openai-codex plugin, or set CODEX_COMPANION)"

args=(task --write --json --model "$MODEL" --cwd "$cwd" --prompt-file "$spec")
[ "$resume" = 1 ] && args+=(--resume)
[ -n "$effort" ] && args+=(--effort "$effort")

out="${spec%.md}.result.json"
status=0
node "$companion" "${args[@]}" > "$out" || status=$?

log="$common/codex-tasks.log"
node - "$out" "$status" "$cwd" "$spec" "$resume" "$MODEL" "$log" <<'NODE' || true
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const [out, status, cwd, spec, resume, model, log] = process.argv.slice(2);
let r = {};
try { r = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { r = { rawOutput: fs.readFileSync(out, 'utf8') }; }
const files = Array.isArray(r.touchedFiles) ? r.touchedFiles : [];
const line = [new Date().toISOString(), model, resume === '1' ? 'resume' : 'new', `exit=${status}`, `thread=${r.threadId ?? '-'}`, cwd, spec].join('\t');
try { fs.appendFileSync(log, line + '\n'); } catch {}
console.log(`Codex task ${status === '0' ? 'finished' : `failed (exit ${status})`} · ${model} · ${resume === '1' ? 'resumed thread' : 'new thread'}`);
console.log(`Worktree: ${cwd}`);
let changedPaths;
try {
  const output = execFileSync('git', ['-C', cwd, 'status', '--porcelain=v1', '--untracked-files=all'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const changes = output.split('\n').filter(Boolean).map(line => ({
    status: line.slice(0, 2),
    path: line.slice(3),
  }));
  changedPaths = new Set(changes.map(change => change.path));
  console.log(`Changed in the worktree (${changes.length}):${changes.length ? '' : ' nothing'}`);
  for (const change of changes) console.log(`  ${change.status} ${change.path}`);
} catch (error) {
  const message = error.stderr?.trim() || error.message;
  console.log(`Changed in the worktree: unknown (git status failed: ${message})`);
}
const reportedPaths = new Set(files);
if (files.length && (!changedPaths || changedPaths.size !== reportedPaths.size || files.some(path => !changedPaths.has(path)))) {
  console.log(`Codex reported (${files.length}):\n  ${files.join('\n  ')}`);
}
console.log(`Full result: ${out}`);
if (r.threadId) console.log(`Codex-Job: ${r.threadId}`);
console.log('\n--- Astra\'s report ---\n' + String(r.rawOutput ?? '').trim());
NODE
exit "$status"
