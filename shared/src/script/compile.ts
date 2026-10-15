/**
 * Scene compiler: validates a parsed scene against the registry and flattens it into ops (see types.ts).
 *
 * Checks (errors unless noted): goto targets exist; expressions parse (expr.ts; unknown paths are fine, they
 * resolve at runtime); every flag read (`flag.x`) or written (`{set}`, `{unset}`, header `sets`) is declared;
 * speakers exist and use expressions from their portrait set; regard/memory/ai targets exist; puzzle ids are
 * PZ-01..PZ-20; riddle ids match §14; each `{ai_line}` is followed by its `{fallback}`. Warnings: labels inside
 * `[[if]]`, unreachable lines after a jump, unknown `{interpolations}`, speakers missing from `cast`, unknown
 * places, header `sets` the body never sets.
 * `compileScenes` adds the cross-scene checks: unique ids, `{goto_scene}`/`scene_call:` targets, `{insert}` ids.
 */
import { evaluate } from "../expr";
import { closest } from "./commands";
import { parseScene } from "./parse";
import { flagDeclared, placeKnown, speakerExpressions, type SceneRegistry } from "./registry";
import type {
  ChoiceStmt, Command, CompiledCommand, CompiledOption, CompiledScene, Diagnostic, IfStmt, Op, SceneAst, Stmt,
} from "./types";

export const PUZZLE_ID = /^PZ-(0[1-9]|1\d|20)$/;
/** §14: district trails OQ/MR/WF/MB/CM/SH 1–5, the Lantern finale LN-1..5, Tib's riddles T-01..T-12. */
export const RIDDLE_ID = /^((OQ|MR|WF|MB|CM|SH|LN)-[1-5]|T-(0[1-9]|1[0-2]))$/;

/** `{token}` interpolations the runtime fills (§13.1, §13.3, §13.5a). */
export const INTERPOLATIONS: readonly RegExp[] = [
  /^(name|they|them|their|theyre)$/,
  /^(census|day|signatures|write_in_count|station_riders|failed_project|failed_project_cost)$/,
  /^arrival\.(name|trade|reason)$/,
  /^romance_pair_\d\.(a|b)$/,
  /^d\.(player|vane|moss)$/,
  /^run\.(player|vane|moss|total)$/,
  /^vote\.(winner|share|margin)$/,
  /^tally\.[a-z_]+$/,
];

const INTERP = /\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;

export interface CompileResult { scene: CompiledScene | null; diagnostics: Diagnostic[] }

/** Validate and compile one parsed scene. `scene` is null only when the header is unusable. */
export function compileScene(ast: SceneAst, reg: SceneRegistry): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const file = ast.file;
  const err = (line: number, message: string) => diagnostics.push({ severity: "error", file, line, message });
  const warn = (line: number, message: string) => diagnostics.push({ severity: "warning", file, line, message });
  const header = ast.header;
  const isLibrary = header?.kind === "insert_library";
  const scene = header?.kind === "scene" ? header : null;

  const flagsRead = new Set<string>();
  const flagsWritten = new Set<string>();
  const speakers = new Set<string>();
  const interpolations = new Set<string>();
  const scenesRef = new Set<string>();
  const insertsRef = new Set<string>();
  const labels = new Map<string, number>(); // name → line
  const gotos: { label: string; line: number }[] = [];
  const onlyByJump: { label: string; line: number }[] = []; // labels right after a jump: reachable only if targeted
  const firstCue = new Map<string, number>(); // puzzle/riddle/scuffle → line of the first such cue
  const outcomeReads: { root: string; line: number }[] = [];
  const stats = { lines: 0, choices: 0, options: 0, commands: 0 };

  const checkFlag = (flag: string, line: number, how: string) => {
    if (flagDeclared(reg, flag)) return;
    const near = closest(flag, reg.flags);
    err(line, `undeclared flag '${flag}' (${how})${near ? `; did you mean '${near}'?` : "; declare it in content/flags.yaml (§13.6)"}`);
  };

  const checkExpr = (src: string, line: number, where: string) => {
    const paths: string[][] = [];
    try {
      evaluate(src, { resolve: (p) => { paths.push(p); return undefined; } });
    } catch (e) {
      err(line, `${where} expression does not parse: ${(e as Error).message}`);
      return;
    }
    for (const p of paths) {
      if ((p[0] === "puzzle" || p[0] === "riddle" || p[0] === "scuffle") && p.length === 2) outcomeReads.push({ root: p[0], line });
      if (p[0] !== "flag") continue;
      if (p.length !== 2) { err(line, `flag paths look like flag.<name>, got ${p.join(".")}`); continue; }
      flagsRead.add(p[1]!);
      checkFlag(p[1]!, line, `read in ${where}`);
    }
  };

  const checkText = (text: string, line: number) => {
    for (const m of text.matchAll(INTERP)) {
      const tok = m[1]!;
      interpolations.add(tok);
      if (!INTERPOLATIONS.some((r) => r.test(tok))) warn(line, `unknown interpolation {${tok}} (the runtime may not fill it)`);
    }
  };

  /** Ids that may receive Regard or memories, or be an AI speaker. */
  const residentKnown = (id: string) => speakerExpressions(reg, id) !== null;

  const checkCommand = (c: Command, line: number) => {
    stats.commands++;
    switch (c.cmd) {
      case "set": case "unset":
        flagsWritten.add(c.flag);
        checkFlag(c.flag, line, `{${c.cmd}}`);
        break;
      case "regard": case "memory":
        if (!residentKnown(c.resident)) err(line, `{${c.cmd}}: unknown resident '${c.resident}'${hint(c.resident)}`);
        if (c.cmd === "memory") checkText(c.text, line);
        break;
      case "ai_open":
        if (!residentKnown(c.resident)) err(line, `{ai_open}: unknown resident '${c.resident}'${hint(c.resident)}`);
        else if (!reg.residents.has(c.resident) && c.resident !== "arrival") warn(line, `{ai_open}: '${c.resident}' has no persona card, so there is no agent to talk to (Quiet Mode only)`);
        checkText(c.topic, line);
        break;
      case "ai_line":
        if (!residentKnown(c.speaker.id)) err(line, `{ai_line}: unknown speaker '${c.speaker.id}'${hint(c.speaker.id)}`);
        checkText(c.brief, line);
        break;
      case "fallback":
        checkText(c.text, line);
        break;
      case "puzzle": case "riddle": case "scuffle":
        if (!firstCue.has(c.cmd)) firstCue.set(c.cmd, line);
        if (c.cmd === "puzzle" && !PUZZLE_ID.test(c.id)) err(line, `{puzzle}: '${c.id}' is not a puzzle id (PZ-01 … PZ-20, §15)`);
        if (c.cmd === "riddle" && !RIDDLE_ID.test(c.id)) err(line, `{riddle}: '${c.id}' is not a riddle id (OQ/MR/WF/MB/CM/SH/LN-1..5 or T-01..T-12, §14)`);
        break;
      case "goto":
        gotos.push({ label: c.label, line });
        break;
      case "goto_scene":
        scenesRef.add(c.scene);
        break;
      case "insert":
        insertsRef.add(c.id);
        break;
      default:
        break;
    }
  };

  const hint = (id: string) => {
    const near = closest(id, [...reg.residents.keys(), ...reg.featured]);
    return near ? ` (did you mean '${near}'?)` : "";
  };

  const castSet = new Set(scene?.cast ?? []);
  const castWarned = new Set<string>();

  // ---- validation walk
  const walk = (stmts: Stmt[], depth: number) => {
    let jumped: number | null = null; // line of a jump that makes following statements unreachable
    for (let i = 0; i < stmts.length; i++) {
      const st = stmts[i]!;
      if (jumped !== null && st.kind !== "label") {
        warn(st.line, `unreachable: follows the jump on line ${jumped} with no label in between`);
        jumped = null;
      }
      if (st.kind === "label") {
        if (jumped !== null && !isLibrary) onlyByJump.push({ label: st.name, line: st.line });
        jumped = null;
      }
      switch (st.kind) {
        case "narration":
          stats.lines++;
          checkText(st.text, st.line);
          break;
        case "player":
          stats.lines++;
          checkText(st.text, st.line);
          break;
        case "say": {
          stats.lines++;
          checkText(st.text, st.line);
          speakers.add(st.speaker);
          const exprs = speakerExpressions(reg, st.speaker);
          if (!exprs) {
            const near = closest(st.speaker, [...reg.residents.keys(), ...reg.featured]);
            err(st.line, `unknown speaker ${st.speaker.toUpperCase()}${near ? ` (did you mean ${near.toUpperCase()}?)` : ""}`);
          }
          else if (st.expr !== undefined && !exprs.includes(st.expr))
            err(st.line, `${st.speaker.toUpperCase()} has no expression [${st.expr}] (portrait_expressions: ${exprs.join(", ")})`);
          if (scene && exprs && !castSet.has(st.speaker) && !castWarned.has(st.speaker)) {
            castWarned.add(st.speaker);
            warn(st.line, `${st.speaker.toUpperCase()} speaks but is not in the header's cast`);
          }
          break;
        }
        case "choice":
          stats.choices++;
          for (const o of st.options) {
            stats.options++;
            checkText(o.text, o.line);
            for (const e of o.effects) checkCommand(e, o.line);
            if (o.goto) gotos.push({ label: o.goto, line: o.line });
          }
          // every option jumps away: what follows needs a label to be reachable
          if (st.options.length && st.options.every((o) => o.goto || o.effects.some((e) => e.cmd === "goto_scene" || e.cmd === "load_checkpoint")))
            jumped = st.line;
          break;
        case "label":
          if (labels.has(st.name)) err(st.line, `duplicate label '${st.name}' (first on line ${labels.get(st.name)})`);
          else labels.set(st.name, st.line);
          if (depth > 0) warn(st.line, `label '${st.name}' sits inside an [[if]] block (§13.3 keeps labels at top level)`);
          break;
        case "if":
          for (const b of st.branches) {
            if (b.cond !== null) checkExpr(b.cond, b.line, b === st.branches[0] ? "[[if]]" : "[[elif]]");
            walk(b.body, depth + 1);
          }
          break;
        case "command": {
          const c = st.command;
          checkCommand(c, st.line);
          if (c.cmd === "ai_line") {
            const next = stmts[i + 1];
            if (next?.kind !== "command" || next.command.cmd !== "fallback")
              err(st.line, `{ai_line: ${c.slot}} must be followed directly by its {fallback: "…"} line (Quiet Mode, §13.1)`);
          }
          if (c.cmd === "fallback") {
            const prev = stmts[i - 1];
            if (prev?.kind !== "command" || prev.command.cmd !== "ai_line") err(st.line, "{fallback} must directly follow an {ai_line}");
          }
          if (c.cmd === "goto" || c.cmd === "goto_scene" || c.cmd === "load_checkpoint") jumped = st.line;
          break;
        }
      }
    }
  };
  walk(ast.body, 0);

  for (const g of gotos) {
    if (labels.has(g.label)) continue;
    const near = closest(g.label, labels.keys());
    err(g.line, `goto target '${g.label}' is not a label in this scene${near ? ` (did you mean '${near}'?)` : ""}`);
  }
  const targeted = new Set(gotos.map((g) => g.label));
  for (const l of onlyByJump)
    if (!targeted.has(l.label)) warn(l.line, `label '${l.label}' is never jumped to and the line before it jumps away, so its block can't run`);
  for (const r of outcomeReads) {
    const cue = firstCue.get(r.root);
    if (cue === undefined || cue > r.line) warn(r.line, `reads ${r.root}.${r.root === "scuffle" ? "won" : "solved"} with no {${r.root}: …} cue before it in this scene`);
  }

  // ---- header checks
  if (scene) {
    const hl = (k: string) => ast.headerLines[k] ?? ast.headerLine;
    if (scene.trigger) checkExpr(scene.trigger, hl("trigger"), "trigger");
    for (const f of scene.sets) checkFlag(f, hl("sets"), "listed in header sets");
    for (const c of scene.cast)
      if (!residentKnown(c)) err(hl("cast"), `cast: unknown resident '${c}'${hint(c)}`);
    if (!placeKnown(reg, scene.place)) warn(hl("place"), `place '${scene.place}' is not in content/places/places.yaml`);
    // A trigger guarded by !flag.x must be able to switch itself off, or the scene replays.
    const guards = [...scene.trigger.matchAll(/!\s*flag\.([a-z0-9_]+)/g)].map((m) => m[1]!);
    if (guards.length && !guards.some((g) => flagsWritten.has(g)))
      err(hl("trigger"), `trigger waits for ${guards.map((g) => `!flag.${g}`).join(" && ")} but the scene never sets ${guards.length > 1 ? "any of them" : "it"}, so it would replay (add {set: ${guards[0]}})`);
    const neverSet = scene.sets.filter((f) => !flagsWritten.has(f));
    if (neverSet.length) warn(hl("sets"), `header sets ${neverSet.join(", ")} but the body never does ({set: …})`);
  }

  diagnostics.sort((a, b) => a.line - b.line);
  if (!header) return { scene: null, diagnostics };

  // ---- flatten
  const ops: Op[] = [];
  const labelIndex: Record<string, number> = {};
  const fixups: { label: string; patch: (to: number) => void }[] = [];

  const emitCommand = (c: Command, line: number, next: Stmt | undefined): boolean => {
    if (c.cmd === "goto") {
      const op: Extract<Op, { op: "jump" }> = { op: "jump", line, to: -1, label: c.label };
      fixups.push({ label: c.label, patch: (to) => { op.to = to; } });
      ops.push(op);
      return false;
    }
    if (c.cmd === "fallback") return false; // folded into the ai_line before it (or reported)
    if (c.cmd === "ai_line") {
      const fb = next?.kind === "command" && next.command.cmd === "fallback" ? next.command.text : "";
      ops.push({ op: "cmd", line, cmd: { cmd: "ai_line", slot: c.slot, speaker: c.speaker, brief: c.brief, fallback: fb } });
      return fb !== "";
    }
    ops.push({ op: "cmd", line, cmd: c as CompiledCommand });
    return false;
  };

  const emitChoice = (st: ChoiceStmt) => {
    const options: CompiledOption[] = st.options.map((o) => {
      const co: CompiledOption = { line: o.line, text: o.text, effects: o.effects };
      if (o.goto) {
        co.goto = o.goto;
        fixups.push({ label: o.goto, patch: (to) => { co.to = to; } });
      }
      return co;
    });
    ops.push({ op: "choice", line: st.line, options });
  };

  const emitIf = (st: IfStmt, emitBody: (b: Stmt[], top: boolean) => void) => {
    const toEnd: Extract<Op, { op: "jump" }>[] = [];
    st.branches.forEach((b, k) => {
      const last = k === st.branches.length - 1;
      let test: Extract<Op, { op: "if" }> | null = null;
      if (b.cond !== null) {
        test = { op: "if", line: b.line, cond: b.cond, else: -1 };
        ops.push(test);
      }
      emitBody(b.body, false);
      if (!last) {
        const j: Extract<Op, { op: "jump" }> = { op: "jump", line: st.branches[k + 1]!.line, to: -1 };
        ops.push(j);
        toEnd.push(j);
      }
      if (test) test.else = ops.length;
    });
    for (const j of toEnd) j.to = ops.length;
  };

  const emitBody = (stmts: Stmt[], top: boolean) => {
    for (let i = 0; i < stmts.length; i++) {
      const st = stmts[i]!;
      switch (st.kind) {
        case "narration": ops.push({ op: "narrate", line: st.line, text: st.text }); break;
        case "player":
          ops.push({ op: "player", line: st.line, ...(st.business !== undefined ? { business: st.business } : {}), text: st.text });
          break;
        case "say":
          ops.push({
            op: "say", line: st.line, speaker: st.speaker,
            ...(st.expr !== undefined ? { expr: st.expr } : {}),
            ...(st.business !== undefined ? { business: st.business } : {}),
            text: st.text,
          });
          break;
        case "choice": emitChoice(st); break;
        case "label":
          // In an insert library each top-level label starts a new insert, so the previous one ends here.
          if (isLibrary && top && ops.length > 0) ops.push({ op: "end", line: st.line });
          if (!(st.name in labelIndex)) labelIndex[st.name] = ops.length;
          break;
        case "if": emitIf(st, emitBody); break;
        case "command":
          if (emitCommand(st.command, st.line, stmts[i + 1])) i++;
          break;
      }
    }
  };
  emitBody(ast.body, true);
  const endLine = ast.body.length ? lastLine(ast.body) : ast.headerLine;
  ops.push({ op: "end", line: endLine });
  for (const f of fixups) f.patch(labelIndex[f.label] ?? -1);

  const sorted = (s: Set<string>) => [...s].sort();
  return {
    diagnostics,
    scene: {
      id: header.id,
      kind: header.kind,
      ...(ast.title !== undefined ? { title: ast.title } : {}),
      file,
      header: scene,
      ops,
      labels: labelIndex,
      refs: {
        flagsRead: sorted(flagsRead),
        flagsWritten: sorted(new Set([...flagsWritten, ...(scene?.sets ?? [])])),
        speakers: sorted(speakers),
        interpolations: sorted(interpolations),
        scenes: sorted(scenesRef),
        inserts: sorted(insertsRef),
      },
      stats,
    },
  };
}

function lastLine(stmts: Stmt[]): number {
  const st = stmts[stmts.length - 1]!;
  if (st.kind === "if") return st.endLine;
  if (st.kind === "choice") return st.options.at(-1)?.line ?? st.line;
  return st.line;
}

// ---------------------------------------------------------------- many scenes

export interface SceneSource { file: string; source: string }

export interface CompileAllResult {
  scenes: CompiledScene[];
  diagnostics: Diagnostic[];
  /** Diagnostics per file, in input order (files with none map to []). */
  byFile: Map<string, Diagnostic[]>;
}

/** Parse, validate and compile a set of scene files, including the cross-scene checks. */
export function compileScenes(sources: SceneSource[], reg: SceneRegistry): CompileAllResult {
  const byFile = new Map<string, Diagnostic[]>();
  const scenes: CompiledScene[] = [];
  const firstFile = new Map<string, string>();
  for (const { file, source } of sources) {
    const parsed = parseScene(source, file);
    const compiled = compileScene(parsed.ast, reg);
    const diags = [...parsed.diagnostics, ...compiled.diagnostics];
    byFile.set(file, diags);
    const sc = compiled.scene;
    if (!sc) continue;
    const base = file.split("/").pop()!;
    if (base.endsWith(".scene.md") && base !== `${sc.id}.scene.md`)
      diags.push({ severity: "error", file, line: parsed.ast.headerLines.id ?? parsed.ast.headerLine, message: `id '${sc.id}' does not match the file name (expected ${sc.id}.scene.md)` });
    if (firstFile.has(sc.id)) {
      diags.push({ severity: "error", file, line: parsed.ast.headerLines.id ?? parsed.ast.headerLine, message: `duplicate scene id '${sc.id}' (also in ${firstFile.get(sc.id)})` });
      continue;
    }
    firstFile.set(sc.id, file);
    scenes.push(sc);
  }

  // cross-scene references
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const insertIds = new Set(scenes.filter((s) => s.kind === "insert_library").flatMap((s) => Object.keys(s.labels)));
  for (const s of scenes) {
    const diags = byFile.get(s.file)!;
    const at = (pred: (op: Op) => boolean) => s.ops.find(pred)?.line ?? 0;
    for (const target of s.refs.scenes) {
      if (!byId.has(target)) {
        const near = closest(target, byId.keys());
        diags.push({
          severity: "error", file: s.file,
          line: at((op) => op.op === "cmd" && op.cmd.cmd === "goto_scene" && op.cmd.scene === target),
          message: `{goto_scene: ${target}}: no such scene${near ? ` (did you mean '${near}'?)` : ""}`,
        });
      }
    }
    const caller = s.header?.calledFrom;
    if (caller) {
      const from = byId.get(caller);
      if (!from) diags.push({ severity: "error", file: s.file, line: 0, message: `trigger scene_call:${caller}: no such scene` });
      else if (!from.refs.scenes.includes(s.id))
        diags.push({ severity: "warning", file: s.file, line: 0, message: `trigger scene_call:${caller}, but ${caller} never does {goto_scene: ${s.id}}` });
    }
    for (const id of s.refs.inserts) {
      if (insertIds.has(id)) continue;
      const near = closest(id, insertIds);
      diags.push({
        severity: "error", file: s.file,
        line: at((op) => op.op === "cmd" && op.cmd.cmd === "insert" && op.cmd.id === id),
        message: `{insert: ${id}}: no insert library has a ':: ${id}' block${near ? ` (did you mean '${near}'?)` : ""}`,
      });
    }
  }
  for (const d of byFile.values()) d.sort((a, b) => a.line - b.line);
  return { scenes, diagnostics: [...byFile.values()].flat(), byFile };
}
