import { describe, expect, it } from "vitest";
import { compileScene, compileScenes } from "../compile";
import { parseScene } from "../parse";
import type { CompiledScene, Op } from "../types";
import { BODY_LINE, HEADER, reg, sceneSource } from "./helpers";

const FILE = "content/scenes/t_scene.scene.md";

function compile(body: string, header = HEADER) {
  const parsed = parseScene(sceneSource(body, header), FILE);
  expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return compileScene(parsed.ast, reg);
}
const errorsOf = (body: string, header = HEADER) =>
  compile(body, header).diagnostics.filter((d) => d.severity === "error").map((d) => `${d.line}: ${d.message}`);
const warningsOf = (body: string, header = HEADER) =>
  compile(body, header).diagnostics.filter((d) => d.severity === "warning").map((d) => `${d.line}: ${d.message}`);
const ok = (body: string, header = HEADER): CompiledScene => {
  const r = compile(body, header);
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return r.scene!;
};
const L = (k: number) => BODY_LINE + k;

describe("validation", () => {
  it("accepts a clean scene with no diagnostics", () => {
    const r = compile([
      "PELL [stiff_smile]: Now.",
      ">> CHOICE",
      '- "Yes." → {regard: pell +2}; goto yes',
      '- "No." → goto no',
      ":: yes",
      "MARGO [lit_up]: Good.",
      "{goto: after}",
      ":: no",
      "BRU [worried]: Sorry, Madame.",
      ":: after",
      "{memory: margo, \"The {name} kid said yes.\", importance: 5}",
    ].join("\n"));
    expect(r.diagnostics).toEqual([]);
  });

  it("checks goto targets and suggests near misses", () => {
    expect(errorsOf('>> CHOICE\n- "a" → goto bunting_kidn\n:: bunting_kind\nN: x\n{goto: nowhere}')).toEqual([
      `${L(1)}: goto target 'bunting_kidn' is not a label in this scene (did you mean 'bunting_kind'?)`,
      `${L(4)}: goto target 'nowhere' is not a label in this scene`,
    ]);
  });

  it("reports duplicate labels", () => {
    expect(errorsOf(":: a\nN: x\n:: a")).toEqual([`${L(2)}: duplicate label 'a' (first on line ${L(0)})`]);
  });

  it("checks that expressions parse with expr.ts, allowing unknown paths", () => {
    expect(errorsOf("[[if skill.charm >= 3 && player.why == 'running']]\nN: x\n[[end]]")).toEqual([]);
    expect(errorsOf("[[if day >]]\nN: x\n[[elif flag.a; drop]]\nN: y\n[[end]]")).toEqual([
      `${L(0)}: [[if]] expression does not parse: unexpected end of: day >`,
      `${L(2)}: [[elif]] expression does not parse: unexpected ';' in: flag.a; drop`,
    ]);
  });

  it("requires every flag read or written to be declared, by list or by pattern", () => {
    expect(errorsOf("[[if flag.met_rook && flag.project_mill_done && flag.s09_done && flag.ending_e2_seen && flag.romance_2_bloomed]]\nN: x\n[[end]]")).toEqual([]);
    expect(errorsOf("{set: pz03_solvd}\n{unset: mystery}\n[[if !flag.oq1_open]]\nN: x\n[[end]]")).toEqual([
      `${L(0)}: undeclared flag 'pz03_solvd' ({set}); did you mean 'pz03_solved'?`,
      `${L(1)}: undeclared flag 'mystery' ({unset}); declare it in content/flags.yaml (§13.6)`,
      `${L(2)}: undeclared flag 'oq1_open' (read in [[if]]); did you mean 'oq1_opened'?`,
    ]);
    expect(errorsOf("[[if flag.a.b]]\nN: x\n[[end]]")).toEqual([`${L(0)}: flag paths look like flag.<name>, got flag.a.b`]);
  });

  it("checks header trigger and sets flags", () => {
    const header = HEADER.replace('trigger: "day >= 3"', 'trigger: "!flag.t_done && flag.nope"').replace("sets: []", "sets: [t_done, also_nope]");
    expect(errorsOf("{set: t_done}", header)).toEqual([
      "7: undeclared flag 'nope' (read in trigger); declare it in content/flags.yaml (§13.6)",
      "11: undeclared flag 'also_nope' (listed in header sets); declare it in content/flags.yaml (§13.6)",
    ]);
  });

  it("flags a trigger guard the scene never sets (the scene would replay)", () => {
    const header = HEADER.replace('trigger: "day >= 3"', 'trigger: "!flag.t_done && day >= 3"');
    expect(errorsOf("N: x", header)).toEqual([
      "7: trigger waits for !flag.t_done but the scene never sets it, so it would replay (add {set: t_done})",
    ]);
    expect(errorsOf("[[if day > 4]]\n{set: t_done}\n[[end]]", header)).toEqual([]);
  });

  it("checks speakers and their portrait expressions", () => {
    expect(errorsOf("PELL [ledger_stare]: x\nBRU [angry]: y\nTIB [thinking]: z")).toEqual([]);
    expect(errorsOf("PELL [gruff]: x\nBRU [ledger_stare]: y\nPEL [warm]: z\nGHOST: boo")).toEqual([
      `${L(0)}: PELL has no expression [gruff] (portrait_expressions: neutral, warm, laugh, sad, angry, surprised, worried, thinking, stiff_smile, ledger_stare)`,
      `${L(1)}: BRU has no expression [ledger_stare] (portrait_expressions: neutral, warm, laugh, sad, angry, surprised, worried, thinking)`,
      `${L(2)}: unknown speaker PEL (did you mean PELL?)`,
      `${L(3)}: unknown speaker GHOST`,
    ]);
  });

  it("accepts the ARRIVAL speaker and romance-pair aliases with the standard expressions", () => {
    expect(errorsOf("ARRIVAL [worried]: Is this the right slip?\nPAIR1_A [warm]: Mind the wick.")).toEqual([]);
  });

  it("checks regard, memory and ai targets", () => {
    expect(errorsOf("{regard: arrival +5}\n{memory: weasel, \"x\", importance: 3}")).toEqual([]);
    expect(errorsOf("{regard: margot +2}\n{memory: nobody, \"x\", importance: 3}")).toEqual([
      `${L(0)}: {regard}: unknown resident 'margot' (did you mean 'margo'?)`,
      `${L(1)}: {memory}: unknown resident 'nobody'`,
    ]);
    expect(warningsOf('{ai_open: bru, topic: "t", turns: 2}')).toEqual([
      `${L(0)}: {ai_open}: 'bru' has no persona card, so there is no agent to talk to (Quiet Mode only)`,
    ]);
  });

  it("checks puzzle and riddle ids against §14/§15", () => {
    expect(errorsOf("{puzzle: PZ-01}\n{puzzle: PZ-20}\n{riddle: OQ-5}\n{riddle: LN-1}\n{riddle: T-12}\n{riddle: MR-3}")).toEqual([]);
    expect(errorsOf("{puzzle: PZ-21}\n{puzzle: PZ-3}\n{riddle: OQ-6}\n{riddle: T-13}\n{riddle: XX-1}").map((e) => e.split(": {")[0])).toEqual(
      [L(0), L(1), L(2), L(3), L(4)].map(String),
    );
  });

  it("requires a {fallback} right after every {ai_line}", () => {
    expect(errorsOf('{ai_line: s1, speaker: nell, brief: "b"}\nN: oops\n{fallback: "late"}')).toEqual([
      `${L(0)}: {ai_line: s1} must be followed directly by its {fallback: "…"} line (Quiet Mode, §13.1)`,
      `${L(2)}: {fallback} must directly follow an {ai_line}`,
    ]);
  });

  it("warns about labels inside [[if]], unreachable lines, dead labels and unknown interpolations", () => {
    expect(warningsOf([
      "[[if day > 1]]",
      ":: inside",
      "[[end]]",
      "{goto: inside}",
      "N: never shown {nmae}",
      ":: dead",
      "N: x",
    ].join("\n"))).toEqual([
      `${L(1)}: label 'inside' sits inside an [[if]] block (§13.3 keeps labels at top level)`,
      `${L(4)}: unreachable: follows the jump on line ${L(3)} with no label in between`,
      `${L(4)}: unknown interpolation {nmae} (the runtime may not fill it)`,
    ]);
    expect(warningsOf("{goto: b}\n:: a\nN: x\n:: b")).toEqual([
      `${L(1)}: label 'a' is never jumped to and the line before it jumps away, so its block can't run`,
    ]);
  });

  it("warns about speakers missing from the cast, unknown places and outcome reads without a cue", () => {
    const header = HEADER.replace("place: old_quarter.library", "place: old_quarter.nowhere");
    expect(warningsOf("TIB [warm]: hi\nTIB [laugh]: again\n[[if puzzle.solved]]\nN: x\n[[end]]", header)).toEqual([
      "6: place 'old_quarter.nowhere' is not in content/places/places.yaml",
      `${L(0)}: TIB speaks but is not in the header's cast`,
      `${L(2)}: reads puzzle.solved with no {puzzle: …} cue before it in this scene`,
    ]);
  });
});

describe("compiled ops", () => {
  const ops = (s: CompiledScene) => s.ops.map((o) => [o.op, ...(o.op === "if" ? [o.cond, o.else] : o.op === "jump" ? [o.to] : [])]);

  it("flattens if / elif / else into conditional jumps", () => {
    const s = ok([
      "[[if flag.a_one]]",
      "N: one",
      "[[elif day > 2]]",
      "N: two",
      "[[else]]",
      "N: three",
      "[[end]]",
      "N: after",
    ].join("\n").replace("flag.a_one", "flag.oq1_opened"));
    expect(ops(s)).toEqual([
      ["if", "flag.oq1_opened", 3], ["narrate"], ["jump", 7],
      ["if", "day > 2", 6], ["narrate"], ["jump", 7],
      ["narrate"],
      ["narrate"], ["end"],
    ]);
  });

  it("an [[if]] without [[else]] skips straight past its body", () => {
    expect(ops(ok("[[if day > 2]]\nN: x\n[[end]]\nN: y"))).toEqual([["if", "day > 2", 2], ["narrate"], ["narrate"], ["end"]]);
  });

  it("resolves choice and {goto} targets to op indexes", () => {
    const s = ok('>> CHOICE\n- "a" → {coins: +5}; goto a\n- "b"\n:: a\nN: x\n{goto: a}');
    const choice = s.ops[0] as Extract<Op, { op: "choice" }>;
    expect(choice.options).toEqual([
      { line: L(1), text: "a", effects: [{ cmd: "coins", delta: 5 }], goto: "a", to: 1 },
      { line: L(2), text: "b", effects: [] },
    ]);
    expect(s.labels).toEqual({ a: 1 });
    expect(s.ops[2]).toEqual({ op: "jump", line: L(5), to: 1, label: "a" });
  });

  it("folds {fallback} into the {ai_line} op", () => {
    const s = ok('{ai_line: q1_jobs, speaker: auto:nell, brief: "Ask."}\n{fallback: "Where\'s the work?"}\nN: x');
    expect(s.ops[0]).toEqual({
      op: "cmd", line: L(0),
      cmd: { cmd: "ai_line", slot: "q1_jobs", speaker: { id: "nell", auto: true }, brief: "Ask.", fallback: "Where's the work?" },
    });
    expect(s.ops[1]).toMatchObject({ op: "narrate" });
  });

  it("ends each insert of an insert library at the next label", () => {
    const s = ok(":: ins_a\nN: a\n:: ins_b\n[[if day > 1]]\nN: b\n[[end]]", "id: inserts_t\nkind: insert_library");
    expect(s.kind).toBe("insert_library");
    expect(s.header).toBeNull();
    expect(s.labels).toEqual({ ins_a: 0, ins_b: 2 });
    expect(s.ops.map((o) => o.op)).toEqual(["narrate", "end", "if", "narrate", "end"]);
  });

  it("records refs and stats, and stays JSON-serializable", () => {
    const s = ok([
      "PELL [warm]: {name}, hello.",
      "[[if flag.return_ticket_torn]]",
      "{set: oq1_opened}",
      "[[end]]",
      ">> CHOICE",
      '- "a" → goto a',
      ":: a",
      "{goto_scene: t_other}",
    ].join("\n"));
    expect(s.refs).toEqual({
      flagsRead: ["return_ticket_torn"], flagsWritten: ["oq1_opened"], speakers: ["pell"],
      interpolations: ["name"], scenes: ["t_other"], inserts: [],
    });
    expect(s.stats).toEqual({ lines: 1, choices: 1, options: 1, commands: 2 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("compileScenes (cross-scene checks)", () => {
  const src = (id: string, body: string, extra: Record<string, string> = {}) => {
    let header = HEADER.replace("id: t_scene", `id: ${id}`);
    for (const [k, v] of Object.entries(extra)) header = header.replace(new RegExp(`^${k}:.*$`, "m"), `${k}: ${v}`);
    return sceneSource(body, header);
  };

  it("checks goto_scene, insert and scene_call targets, ids and file names", () => {
    const r = compileScenes([
      { file: "content/scenes/s_a.scene.md", source: src("s_a", "{insert: ins_one}\n{insert: ins_onee}\n[[if day > 1]]\n{goto_scene: s_b}\n[[else]]\n{goto_scene: s_c}\n[[end]]") },
      { file: "content/scenes/s_b.scene.md", source: src("s_b", "N: b", { trigger: '"scene_call:s_a && day > 1"' }) },
      { file: "content/scenes/s_d.scene.md", source: src("s_x", "N: d", { trigger: '"scene_call:s_b"' }) },
      { file: "content/scenes/s_x2.scene.md", source: src("s_x", "N: dup") },
      { file: "content/scenes/lib.scene.md", source: sceneSource(":: ins_one\nN: one", "id: lib\nkind: insert_library") },
    ], reg);
    const msgs = r.diagnostics.map((d) => `${d.file.split("/").pop()}:${d.line}: ${d.severity}: ${d.message}`);
    expect(msgs).toEqual([
      `s_a.scene.md:${L(1)}: error: {insert: ins_onee}: no insert library has a ':: ins_onee' block (did you mean 'ins_one'?)`,
      `s_a.scene.md:${L(5)}: error: {goto_scene: s_c}: no such scene (did you mean 's_a'?)`,
      "s_d.scene.md:0: warning: trigger scene_call:s_b, but s_b never does {goto_scene: s_x}",
      "s_d.scene.md:3: error: id 's_x' does not match the file name (expected s_x.scene.md)",
      "s_x2.scene.md:3: error: id 's_x' does not match the file name (expected s_x.scene.md)",
      "s_x2.scene.md:3: error: duplicate scene id 's_x' (also in content/scenes/s_d.scene.md)",
    ]);
    expect(r.scenes.map((s) => s.id)).toEqual(["s_a", "s_b", "s_x", "lib"]);
  });
});
