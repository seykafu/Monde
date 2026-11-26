#!/usr/bin/env bash
# A git worktree for one Codex task: <repo>-codex/<slug> on branch codex/<slug>, cut from origin/main.
#
# Usage: tools/codex/worktree.sh <slug> [--base <ref>] [--no-install]
#   <slug>        short kebab-case task name (it names the branch and the folder)
#   --base        what to branch from (default: origin/main, fetched first)
#   --no-install  skip `npm ci` (the worktree then can't typecheck or test until you install)
#
# Checks out the LFS art (fresh worktrees get pointer files) and installs dependencies, then prints the
# worktree's path on the last line. Running it again for an existing slug just prints the path.
# Clean up after the task lands: git worktree remove <path> && git branch -D codex/<slug>
set -euo pipefail

die() { echo "codex/worktree: $*" >&2; exit 2; }

slug="" base="origin/main" install=1
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2:-}"; shift 2 ;;
    --no-install) install=0; shift ;;
    -h|--help) awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$slug" ] || die "one slug only"; slug="$1"; shift ;;
  esac
done
[ -n "$slug" ] || die "usage: tools/codex/worktree.sh <slug> [--base <ref>] [--no-install]"
[[ "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "slug must be kebab-case (a-z, 0-9, -)"

# The main checkout, even when this runs from inside another worktree.
main="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
path="$(dirname "$main")/$(basename "$main")-codex/$slug"

if [ -d "$path" ]; then
  echo "$path"
  exit 0
fi

git -C "$main" fetch origin --quiet
mkdir -p "$(dirname "$path")"
git -C "$main" worktree add --quiet -b "codex/$slug" "$path" "$base" >&2
(cd "$path" && git lfs checkout client/public >/dev/null 2>&1) || echo "codex/worktree: git lfs checkout skipped" >&2
if [ "$install" = 1 ]; then
  (cd "$path" && npm ci --prefer-offline --no-audit --no-fund --loglevel=error >&2)
fi
echo "$path"
