/**
 * Scene-script types (GDD §13.1). Three layers:
 *   1. `SceneAst`      what the parser reads from a `.scene.md` file (header + nested body statements)
 *   2. `Command`       a `{cue: args}` with its arguments parsed and typed
 *   3. `CompiledScene` a flat, JSON-serializable op list with resolved jumps, for the runtime
 * Everything here is plain data so it can cross the client/server boundary and be written to JSON.
 */

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  file: string;
  /** 1-based line in the scene file (0 when the problem is not tied to a line). */
  line: number;
  message: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}${d.line ? `:${d.line}` : ""}: ${d.severity}: ${d.message}`;
}

// ---------------------------------------------------------------- commands

export const PILLARS = ["prosperity", "safety", "spirit", "charm"] as const;
export type Pillar = (typeof PILLARS)[number];

/** Districts `{tally: …}` accepts (§13.5a), plus `final` for the closing total. */
export const TALLY_DISTRICTS = ["old_quarter", "market_row", "wharf", "commons", "millbrook", "station_hill", "final"] as const;
export type TallyDistrict = (typeof TALLY_DISTRICTS)[number];

/** `{ai_line}` speaker: a fixed id, or `auto:<default>` (engine picks; Quiet Mode uses the default). */
export interface AiSpeaker { id: string; auto: boolean }

export type Command =
  | { cmd: "set"; flag: string }
  | { cmd: "unset"; flag: string }
  | { cmd: "regard"; resident: string; delta: number }
  | { cmd: "pillar"; pillar: Pillar; delta: number }
  | { cmd: "coins"; delta: number }
  | { cmd: "item"; item: string; delta: number }
  | { cmd: "scuffle"; id: string }
  | { cmd: "riddle"; id: string }
  | { cmd: "puzzle"; id: string }
  | { cmd: "project"; id: string }
  | { cmd: "ai_open"; resident: string; topic: string; turns: number }
  | { cmd: "ai_line"; slot: string; speaker: AiSpeaker; brief: string }
  | { cmd: "fallback"; text: string }
  | { cmd: "memory"; resident: string; text: string; importance: number }
  | { cmd: "wait"; seconds?: number }
  | { cmd: "fade" }
  | { cmd: "sfx"; id: string }
  | { cmd: "cam"; effect: string }
  | { cmd: "goto"; label: string }
  | { cmd: "goto_scene"; scene: string }
  | { cmd: "insert"; id: string }
  | { cmd: "backdrop"; id: string }
  | { cmd: "charcreate" }
  | { cmd: "checkpoint"; key: string }
  | { cmd: "load_checkpoint"; key: string }
  | { cmd: "campaign"; key: string }
  | { cmd: "debate_score"; delta: number }
  | { cmd: "pick_planks"; count: number }
  | { cmd: "tally"; district: TallyDistrict };

export type CommandName = Command["cmd"];

// ---------------------------------------------------------------- header

export interface TimeWindow { start: string; end: string }

export interface SceneHeader {
  kind: "scene";
  id: string;
  day: number;
  /** "HH:MM-HH:MM"; the end may run past midnight up to 26:00 (GDD §5.3). */
  time: TimeWindow;
  place: string;
  /** The trigger expression with any `scene_call:<id>` prefix removed ("" = always true). */
  trigger: string;
  /** `scene_call:<id>`: the scene only starts when that scene hands over to it (`{goto_scene}`), §13.5a. */
  calledFrom?: string;
  backdrop: string;
  music: string;
  cast: string[];
  sets: string[];
}

/** `kind: insert_library` (§13.5): a bag of `:: label` blocks other scenes splice in with `{insert: label}`. */
export interface InsertLibraryHeader { kind: "insert_library"; id: string }

export type Header = SceneHeader | InsertLibraryHeader;

// ---------------------------------------------------------------- AST

export interface NarrationStmt { kind: "narration"; line: number; text: string }
export interface SayStmt {
  kind: "say";
  line: number;
  /** Lower-case speaker id (`PELL` → `pell`, `PAIR1_A` → `pair1_a`). */
  speaker: string;
  /** Portrait expression; absent = keep the speaker's previous one. */
  expr?: string;
  /** Leading `(…)` stage business, without the parentheses. */
  business?: string;
  text: string;
}
export interface PlayerStmt { kind: "player"; line: number; business?: string; text: string }
export interface ChoiceOption {
  line: number;
  text: string;
  effects: Command[];
  /** Label named by a trailing `goto label`; absent = continue after the choice. */
  goto?: string;
}
export interface ChoiceStmt { kind: "choice"; line: number; options: ChoiceOption[] }
export interface LabelStmt { kind: "label"; line: number; name: string }
export interface IfBranch { line: number; /** null for `[[else]]` */ cond: string | null; body: Stmt[] }
export interface IfStmt { kind: "if"; line: number; endLine: number; branches: IfBranch[] }
export interface CommandStmt { kind: "command"; line: number; command: Command }

export type Stmt = NarrationStmt | SayStmt | PlayerStmt | ChoiceStmt | LabelStmt | IfStmt | CommandStmt;

export interface SceneAst {
  file: string;
  /** Text of the markdown heading above the header, e.g. "S01a · The Ferry". */
  title?: string;
  /** null when the header failed validation (the body is still parsed and checked). */
  header: Header | null;
  /** File line of the first header line, and of each header key, for diagnostics. */
  headerLine: number;
  headerLines: Record<string, number>;
  body: Stmt[];
  /** Number of `//` comment lines stripped from the body. */
  comments: number;
}

// ---------------------------------------------------------------- compiled form

export interface CompiledOption {
  line: number;
  text: string;
  effects: Command[];
  goto?: string;
  /** Op index to continue at; absent = the op after the choice. */
  to?: number;
}

/** `ai_line` with its `{fallback}` folded in. */
export type CompiledCommand =
  | Exclude<Command, { cmd: "ai_line" } | { cmd: "fallback" } | { cmd: "goto" }>
  | { cmd: "ai_line"; slot: string; speaker: AiSpeaker; brief: string; fallback: string };

export type Op =
  | { op: "narrate"; line: number; text: string }
  | { op: "say"; line: number; speaker: string; expr?: string; business?: string; text: string }
  | { op: "player"; line: number; business?: string; text: string }
  | { op: "choice"; line: number; options: CompiledOption[] }
  /** Evaluate `cond` (expr.ts); when false continue at `else`, otherwise at the next op. */
  | { op: "if"; line: number; cond: string; else: number }
  /** Unconditional jump: a `{goto: label}` cue, or the end of an `[[if]]` branch. */
  | { op: "jump"; line: number; to: number; label?: string }
  | { op: "cmd"; line: number; cmd: CompiledCommand }
  /** End of the scene (or of one insert, in an insert library). */
  | { op: "end"; line: number };

export interface SceneStats {
  /** Rendered lines: narration, spoken and player lines. */
  lines: number;
  choices: number;
  options: number;
  commands: number;
}

export interface CompiledScene {
  id: string;
  kind: "scene" | "insert_library";
  title?: string;
  file: string;
  header: SceneHeader | null;
  ops: Op[];
  /** `:: label` → op index. In an insert library these are the insert entry points. */
  labels: Record<string, number>;
  /** What the scene touches, for tooling and the runtime's preloading. */
  refs: {
    flagsRead: string[];
    flagsWritten: string[];
    speakers: string[];
    interpolations: string[];
    scenes: string[];
    inserts: string[];
  };
  stats: SceneStats;
}
