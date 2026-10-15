/**
 * Scene-file parser (GDD §13.1). A `.scene.md` file is an optional markdown heading (the title) and prose, then a
 * ```yaml header block, then a ```script body block. Text outside the two fences is ignored.
 *
 * Body lines (one statement per line; blank lines are ignored, `//` lines are comments):
 *   N: text                                  narration
 *   SPEAKER [expr]: (business) text          spoken line; `[expr]` and `(business)` optional
 *   PLAYER: text                             the player character speaks
 *   >> CHOICE                                starts a choice; followed by up to 4 options:
 *   - "Option text" → {cue}; {cue}; goto label
 *   :: label                                 jump target
 *   [[if expr]] / [[elif expr]] / [[else]] / [[end]]
 *   {cue: args}                              a command (see commands.ts)
 */
import { parseCommand, splitTopLevel } from "./commands";
import { parseHeader } from "./header";
import type { ChoiceOption, ChoiceStmt, Command, Diagnostic, IfStmt, SceneAst, Stmt } from "./types";

export interface ParseResult { ast: SceneAst; diagnostics: Diagnostic[] }

const FENCE_YAML = /^```ya?ml\s*$/;
const FENCE_SCRIPT = /^```script\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const HEADING = /^#{1,6}\s+(.+?)\s*$/;
const ID = /^[a-z][a-z0-9_]*$/;

const SYNTAX_HINT = 'expected N:, SPEAKER [expr]:, PLAYER:, >> CHOICE, - "option", :: label, [[if …]], {cue} or // comment';

export function parseScene(source: string, file: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const err = (line: number, message: string) => diagnostics.push({ severity: "error", file, line, message });
  const warn = (line: number, message: string) => diagnostics.push({ severity: "warning", file, line, message });
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const ast: SceneAst = { file, header: null, headerLine: 1, headerLines: {}, body: [], comments: 0 };

  // ---- fences
  let y = 0;
  for (; y < lines.length && !FENCE_YAML.test(lines[y]!); y++) {
    const h = HEADING.exec(lines[y]!);
    if (h && ast.title === undefined) ast.title = h[1]!.replace(/\s*#+$/, "");
    if (lines[y]!.startsWith("```")) { err(y + 1, "expected the ```yaml header before any other fenced block"); return { ast, diagnostics }; }
  }
  if (y >= lines.length) { err(1, "no ```yaml header block (a scene file is a ```yaml header followed by a ```script body)"); return { ast, diagnostics }; }
  let yEnd = y + 1;
  while (yEnd < lines.length && !FENCE_CLOSE.test(lines[yEnd]!)) yEnd++;
  if (yEnd >= lines.length) { err(y + 1, "the ```yaml header block is never closed"); return { ast, diagnostics }; }

  ast.headerLine = y + 2;
  const { header, keyLines } = parseHeader(lines.slice(y + 1, yEnd).join("\n"), y + 2, file, diagnostics);
  ast.header = header;
  ast.headerLines = keyLines;

  let s = yEnd + 1;
  while (s < lines.length && lines[s]!.trim() === "") s++;
  if (s >= lines.length || !FENCE_SCRIPT.test(lines[s]!)) {
    err(Math.min(s, lines.length - 1) + 1, "expected a ```script body block right after the header");
    return { ast, diagnostics };
  }
  let sEnd = s + 1;
  while (sEnd < lines.length && !FENCE_CLOSE.test(lines[sEnd]!)) sEnd++;
  if (sEnd >= lines.length) err(s + 1, "the ```script block is never closed");
  for (let i = sEnd + 1; i < lines.length; i++)
    if (lines[i]!.startsWith("```")) { warn(i + 1, "fenced block after the script body is ignored"); break; }

  // ---- body
  const root: Stmt[] = [];
  const stack: { stmt: IfStmt; hasElse: boolean }[] = [];
  const body = () => (stack.length ? stack[stack.length - 1]!.stmt.branches.at(-1)!.body : root);
  let choice: ChoiceStmt | null = null;

  for (let i = s + 1; i < sEnd; i++) {
    const ln = i + 1;
    const t = lines[i]!.trim();
    if (t === "") continue;
    if (t.startsWith("//")) { ast.comments++; continue; }

    // option lines attach to the open choice (blank lines and comments between options are fine)
    if (t === "-" || t.startsWith("- ")) {
      const opt = parseOption(t, ln, err);
      if (!choice) { err(ln, 'option outside a ">> CHOICE" block'); continue; }
      if (choice.options.length === 4) err(ln, "a choice has at most 4 options (§13.1)");
      if (opt) choice.options.push(opt);
      continue;
    }
    choice = null;

    if (t.startsWith(">>")) {
      if (!/^>>\s*CHOICE$/.test(t)) { err(ln, `expected ">> CHOICE", got "${t}"`); continue; }
      choice = { kind: "choice", line: ln, options: [] };
      body().push(choice);
      continue;
    }

    if (t.startsWith("::")) {
      const m = /^::\s*(\S+)$/.exec(t);
      if (!m || !ID.test(m[1]!)) { err(ln, `labels look like ":: snake_case_name", got "${t}"`); continue; }
      body().push({ kind: "label", line: ln, name: m[1]! });
      continue;
    }

    if (t.startsWith("[[")) {
      const cond = /^\[\[\s*(if|elif)\s+(.+?)\s*\]\]$/.exec(t);
      const bare = /^\[\[\s*(if|elif|else|end)\s*\]\]$/.exec(t);
      const top = stack[stack.length - 1];
      if (cond && cond[1] === "if") {
        const stmt: IfStmt = { kind: "if", line: ln, endLine: ln, branches: [{ line: ln, cond: cond[2]!, body: [] }] };
        body().push(stmt);
        stack.push({ stmt, hasElse: false });
      } else if (cond) {
        if (!top) err(ln, "[[elif]] without an open [[if]]");
        else if (top.hasElse) err(ln, "[[elif]] after [[else]]");
        else top.stmt.branches.push({ line: ln, cond: cond[2]!, body: [] });
      } else if (bare?.[1] === "else") {
        if (!top) err(ln, "[[else]] without an open [[if]]");
        else if (top.hasElse) err(ln, `second [[else]] for the [[if]] on line ${top.stmt.line}`);
        else { top.stmt.branches.push({ line: ln, cond: null, body: [] }); top.hasElse = true; }
      } else if (bare?.[1] === "end") {
        if (!top) err(ln, "[[end]] without an open [[if]]");
        else { top.stmt.endLine = ln; stack.pop(); }
      } else if (bare) {
        err(ln, `[[${bare[1]}]] needs a condition`);
      } else {
        err(ln, `can't read "${t}" (expected [[if expr]], [[elif expr]], [[else]] or [[end]])`);
      }
      continue;
    }

    if (t.startsWith("{")) {
      if (!t.endsWith("}")) { err(ln, `cue is missing its closing "}": ${clip(t)}`); continue; }
      const r = parseCommand(t.slice(1, -1));
      if ("error" in r) { err(ln, r.error); continue; }
      body().push({ kind: "command", line: ln, command: r.command });
      continue;
    }

    const sp = /^([A-Za-z][A-Za-z0-9_]*)\s*(?:\[([^\]]*)\])?\s*:(?!:)\s*(.*)$/.exec(t);
    if (sp) {
      const who = sp[1]!, expr = sp[2], rest = sp[3]!.trim();
      if (who !== who.toUpperCase()) { err(ln, `speaker ids are upper-case (${who.toUpperCase()}, not ${who})`); continue; }
      if (expr !== undefined && !ID.test(expr.trim())) { err(ln, `expression "[${expr}]" must be a snake_case id like [warm]`); continue; }
      if (who === "N") {
        if (expr !== undefined) err(ln, "narration (N:) takes no [expression]");
        if (rest === "") err(ln, "N: line has no text");
        else body().push({ kind: "narration", line: ln, text: rest });
        continue;
      }
      const split = splitBusiness(rest);
      if ("error" in split) { err(ln, split.error); continue; }
      if (split.text === "" && split.business === undefined) { err(ln, `${who}: line has no text`); continue; }
      if (who === "PLAYER") {
        if (expr !== undefined) err(ln, "the player has no portrait, so PLAYER: takes no [expression]");
        body().push({ kind: "player", line: ln, ...(split.business !== undefined ? { business: split.business } : {}), text: split.text });
      } else {
        body().push({
          kind: "say",
          line: ln,
          speaker: who.toLowerCase(),
          ...(expr !== undefined ? { expr: expr.trim() } : {}),
          ...(split.business !== undefined ? { business: split.business } : {}),
          text: split.text,
        });
      }
      continue;
    }

    err(ln, `can't parse line "${clip(t)}": ${SYNTAX_HINT}`);
  }

  for (const open of stack) err(open.stmt.line, "[[if]] is never closed with [[end]]");
  const checkChoices = (stmts: Stmt[]) => {
    for (const st of stmts) {
      if (st.kind === "choice" && st.options.length === 0) err(st.line, '">> CHOICE" has no options');
      if (st.kind === "if") for (const b of st.branches) checkChoices(b.body);
    }
  };
  checkChoices(root);
  ast.body = root;
  return { ast, diagnostics };
}

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/** Split a leading `(stage business)` off a spoken line. Parentheses may nest. */
function splitBusiness(rest: string): { business?: string; text: string } | { error: string } {
  const r = rest.trim();
  if (!r.startsWith("(")) return { text: r };
  let depth = 0;
  for (let i = 0; i < r.length; i++) {
    if (r[i] === "(") depth++;
    else if (r[i] === ")" && --depth === 0) return { business: r.slice(1, i).trim(), text: r.slice(i + 1).trim() };
  }
  return { error: "stage business is missing its closing ')'" };
}

/** `- "Text" → {cue}; {cue}; goto label`. `->` is accepted for `→`. */
function parseOption(t: string, ln: number, err: (line: number, msg: string) => void): ChoiceOption | null {
  const rest = t.replace(/^-\s*/, "");
  if (!rest.startsWith('"')) { err(ln, 'options look like - "Text the player says" → {cue}; goto label'); return null; }
  let close = -1;
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === "\\") { i++; continue; }
    if (rest[i] === '"') { close = i; break; }
  }
  if (close < 0) { err(ln, "option text is missing its closing quote"); return null; }
  const text = rest.slice(1, close).replace(/\\(.)/g, "$1");
  if (text.trim() === "") err(ln, "option text is empty");
  const after = rest.slice(close + 1).trim();
  const opt: ChoiceOption = { line: ln, text, effects: [] };
  if (after === "") return opt;
  const arrow = /^(→|->)\s*/.exec(after);
  if (!arrow) { err(ln, `expected "→" after the option text, got "${clip(after)}"`); return null; }
  const src = after.slice(arrow[0].length);
  if (src.trim() === "") { err(ln, 'nothing after "→" (drop the arrow, or add effects)'); return null; }

  let parts: string[];
  try { parts = splitTopLevel(src, (c) => c === ";"); } catch (e) { err(ln, (e as Error).message); return null; }
  let ok = true;
  parts.forEach((raw, k) => {
    const p = raw.trim();
    const last = k === parts.length - 1;
    if (p === "") { err(ln, "empty effect (stray ';')"); ok = false; return; }
    const g = /^goto\s+(\S+)$/.exec(p);
    let cmd: Command | undefined;
    if (g) {
      if (!ID.test(g[1]!)) { err(ln, `goto target "${g[1]}" must be a snake_case label`); ok = false; return; }
      cmd = { cmd: "goto", label: g[1]! };
    } else if (p.startsWith("{") && p.endsWith("}")) {
      const r = parseCommand(p.slice(1, -1));
      if ("error" in r) { err(ln, r.error); ok = false; return; }
      cmd = r.command;
    } else {
      err(ln, `can't read effect "${clip(p)}" (expected {cue: args} or goto label)`);
      ok = false;
      return;
    }
    if (cmd.cmd === "goto") {
      if (!last) { err(ln, "goto must be the option's last effect"); ok = false; return; }
      opt.goto = cmd.label;
    } else if (cmd.cmd === "ai_line" || cmd.cmd === "fallback" || cmd.cmd === "ai_open") {
      err(ln, `{${cmd.cmd}} can't be a choice effect; put it on its own line after the label the option jumps to`);
      ok = false;
    } else {
      opt.effects.push(cmd);
    }
  });
  return ok ? opt : null;
}
