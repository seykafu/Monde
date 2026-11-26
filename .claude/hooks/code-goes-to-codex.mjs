#!/usr/bin/env node
// Monde: GPT-6.2 Astra writes all code; Opus writes specs, checks, reviews and commits (.claude/skills/build).
//
// As a Claude Code PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit), it blocks edits to code files in
// this repo, its .claude/worktrees and its Codex worktrees (<repo>-codex/<slug>), and says how to hand the
// change to Codex instead. Kasey can let Opus edit code for a session by starting Claude with MONDE_OPUS_CODE=1.
//
// With --list-code it reads repo-relative paths on stdin and prints the ones that are code; the commit-msg
// hook (.githooks/commit-msg) uses it, so both guards share this one definition of "code".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CODE_DIRS = /^(client|server|shared|tools|scripts|desktop)\//;
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|css|html)$/;
const ROOT_CONFIG = /^[^/]+\.(ts|mts|cts|js|mjs|cjs)$/;

/** A repo-relative path is code when it's source under a code directory, or a root-level config script. */
export function isCode(rel) {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/(^|\/)node_modules\//.test(p)) return false;
  return (CODE_DIRS.test(p) && CODE_EXT.test(p)) || ROOT_CONFIG.test(p);
}

/** The path relative to the Monde checkout it sits in (main, a .claude worktree or a Codex worktree), or null. */
export function repoRelative(abs, projectDir) {
  const main = projectDir.split(`${path.sep}.claude${path.sep}worktrees${path.sep}`)[0];
  const strip = (rel) => {
    const m = rel.split(path.sep);
    return m[0] === '.claude' && m[1] === 'worktrees' && m.length > 3 ? m.slice(3).join('/') : m.join('/');
  };
  const inMain = path.relative(main, abs);
  if (!inMain.startsWith('..') && !path.isAbsolute(inMain)) return strip(inMain);
  const inCodex = path.relative(`${main}-codex`, abs);
  if (!inCodex.startsWith('..') && !path.isAbsolute(inCodex)) return inCodex.split(path.sep).slice(1).join('/');
  return null;
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

if (process.argv.includes('--list-code')) {
  const code = readStdin().split('\n').map((s) => s.trim()).filter(Boolean).filter(isCode);
  if (code.length) process.stdout.write(code.join('\n') + '\n');
  process.exit(0);
}

let input;
try { input = JSON.parse(readStdin()); } catch { process.exit(0); }
if (process.env.MONDE_OPUS_CODE === '1') process.exit(0);

const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (typeof file !== 'string' || !file) process.exit(0);
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const abs = path.resolve(input.cwd || projectDir, file);
const rel = repoRelative(abs, projectDir);
if (rel === null || !isCode(rel)) process.exit(0);

process.stderr.write([
  `Blocked: ${rel} is code, and in Monde GPT-6.2 Astra writes all code.`,
  'Hand it to Codex with the /build skill: make a worktree (tools/codex/worktree.sh <slug>), write a spec from',
  'tools/codex/SPEC_TEMPLATE.md, run tools/codex/task.sh <spec> --cwd <worktree>, then check, review, and send',
  'findings back with --resume. Docs, content, specs and config outside the code directories stay editable.',
  'Kasey can allow Opus code edits for a session by starting Claude with MONDE_OPUS_CODE=1.'
].join('\n') + '\n');
process.exit(2);
