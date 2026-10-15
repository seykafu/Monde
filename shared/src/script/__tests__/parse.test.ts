import { describe, expect, it } from "vitest";
import { parseCommand } from "../commands";
import { parseScene } from "../parse";
import type { ChoiceStmt, IfStmt, Stmt } from "../types";
import { BODY_LINE, HEADER, sceneSource } from "./helpers";

const FILE = "content/scenes/t_scene.scene.md";
const parse = (body: string, header = HEADER) => parseScene(sceneSource(body, header), FILE);
const errors = (r: ReturnType<typeof parse>) => r.diagnostics.filter((d) => d.severity === "error");
const body = (src: string): Stmt[] => {
  const r = parse(src);
  expect(errors(r)).toEqual([]);
  return r.ast.body;
};

describe("scene file and header", () => {
  it("reads the title and a valid header", () => {
    const r = parse("N: Hello.");
    expect(errors(r)).toEqual([]);
    expect(r.ast.title).toBe("T · Test scene");
    expect(r.ast.header).toEqual({
      kind: "scene", id: "t_scene", day: 3, time: { start: "09:00", end: "10:30" }, place: "old_quarter.library",
      trigger: "day >= 3", backdrop: "bg_library", music: "library_hush", cast: ["pell", "margo", "bru"], sets: [],
    });
    expect(r.ast.headerLines.trigger).toBe(7);
  });

  it("strips a scene_call: prefix from the trigger", () => {
    const r = parse("N: x", HEADER.replace('trigger: "day >= 3"', 'trigger: "scene_call:s23_lantern_night && vote.share >= 65"'));
    expect(r.ast.header).toMatchObject({ trigger: "vote.share >= 65", calledFrom: "s23_lantern_night" });
    const bare = parse("N: x", HEADER.replace('trigger: "day >= 3"', 'trigger: "scene_call:e1_landslide"'));
    expect(bare.ast.header).toMatchObject({ trigger: "", calledFrom: "e1_landslide" });
  });

  it("accepts windows past midnight up to 26:00 and YAML comments", () => {
    const r = parse("N: x", HEADER.replace('time: "09:00-10:30"', 'time: "09:00-26:00"   # runs past midnight'));
    expect(errors(r)).toEqual([]);
    expect(r.ast.header).toMatchObject({ time: { start: "09:00", end: "26:00" } });
  });

  it("reads an insert_library header with only id and kind", () => {
    const r = parse(":: ins_a\nN: x", "id: inserts_endings\nkind: insert_library");
    expect(errors(r)).toEqual([]);
    expect(r.ast.header).toEqual({ kind: "insert_library", id: "inserts_endings" });
  });

  it.each([
    ['time: "10:30-09:00"', 5, /time: the window must end after it starts/],
    ['time: "9am"', 5, /time: must look like "HH:MM-HH:MM"/],
    ["day: 0", 4, /day:/],
    ["place: library", 6, /place: place ids look like zone.place/],
    ["cast: [Pell]", 10, /cast\.0: must be a snake_case id/],
  ])("header error %s → line %i", (replacement, line, msg) => {
    const key = replacement.split(":")[0]!;
    const header = HEADER.split("\n").map((l) => (l.startsWith(`${key}:`) ? replacement : l)).join("\n");
    const e = errors(parse("N: x", header));
    expect(e).toHaveLength(1);
    expect(e[0]!.line).toBe(line);
    expect(e[0]!.message).toMatch(msg);
  });

  it("reports missing and unknown header keys", () => {
    const header = HEADER.replace("music: library_hush", "musik: library_hush");
    const msgs = errors(parse("N: x", header)).map((d) => `${d.line}: ${d.message}`);
    expect(msgs).toContain("3: header: missing 'music'");
    expect(msgs).toContain("9: header: unknown key 'musik'");
  });

  it("reports YAML syntax errors with the file line", () => {
    const e = errors(parse("N: x", HEADER.replace("cast: [pell, margo, bru]", "cast: [pell, margo")));
    expect(e[0]!.line).toBeGreaterThanOrEqual(10);
    expect(e[0]!.message).toMatch(/^header YAML:/);
  });

  it("needs a yaml header and a script body", () => {
    expect(errors(parseScene("# Nothing here\n", FILE))[0]).toMatchObject({ line: 1, message: expect.stringMatching(/no ```yaml header/) });
    const noScript = parseScene("```yaml\n" + HEADER + "\n```\n\nN: loose text\n", FILE);
    expect(errors(noScript)[0]).toMatchObject({ line: 13, message: expect.stringMatching(/expected a ```script body/) });
    const unclosed = parseScene("```yaml\n" + HEADER + "\n```\n```script\nN: x\n", FILE);
    expect(errors(unclosed)[0]).toMatchObject({ line: 12, message: expect.stringMatching(/never closed/) });
  });
});

describe("body lines", () => {
  it("parses narration, spoken lines with expression and business, and player lines", () => {
    const [n, s1, s2, p] = body([
      "N: The *Gannet* comes in sideways.",
      "PELL [worried]: (lowers the clipboard (twice)) You came. Heavens.",
      "MARGO: Gloves.",
      "PLAYER: Only the green ones.",
    ].join("\n"));
    expect(n).toEqual({ kind: "narration", line: BODY_LINE, text: "The *Gannet* comes in sideways." });
    expect(s1).toEqual({ kind: "say", line: BODY_LINE + 1, speaker: "pell", expr: "worried", business: "lowers the clipboard (twice)", text: "You came. Heavens." });
    expect(s2).toEqual({ kind: "say", line: BODY_LINE + 2, speaker: "margo", text: "Gloves." });
    expect(p).toEqual({ kind: "player", line: BODY_LINE + 3, text: "Only the green ones." });
  });

  it("allows a line that is only stage business", () => {
    expect(body("ODILE [warm]: (nods)")[0]).toMatchObject({ speaker: "odile", business: "nods", text: "" });
  });

  it("strips // comments and blank lines", () => {
    const r = parse("// a note for writers\n\nN: x\n   // indented note");
    expect(r.ast.body).toHaveLength(1);
    expect(r.ast.comments).toBe(2);
  });

  it("parses labels", () => {
    expect(body(":: bunting_kind")[0]).toEqual({ kind: "label", line: BODY_LINE, name: "bunting_kind" });
  });

  it("parses a choice block with effects and gotos", () => {
    const [c] = body([
      ">> CHOICE",
      '- "It\'s a lovely welcome." → {regard: pell +3}; goto bunting_kind',
      '- "How many people live here?" → {regard: pell +2}; {set: pell_told_census}; goto bunting_count',
      '- "What if..." → {load_checkpoint: campaign_season}',
      '- "Say nothing."',
    ].join("\n")) as [ChoiceStmt];
    expect(c.kind).toBe("choice");
    expect(c.options).toEqual([
      { line: BODY_LINE + 1, text: "It's a lovely welcome.", effects: [{ cmd: "regard", resident: "pell", delta: 3 }], goto: "bunting_kind" },
      {
        line: BODY_LINE + 2, text: "How many people live here?", goto: "bunting_count",
        effects: [{ cmd: "regard", resident: "pell", delta: 2 }, { cmd: "set", flag: "pell_told_census" }],
      },
      { line: BODY_LINE + 3, text: "What if...", effects: [{ cmd: "load_checkpoint", key: "campaign_season" }] },
      { line: BODY_LINE + 4, text: "Say nothing.", effects: [] },
    ]);
  });

  it("accepts -> for → and {goto: x} as an option's last effect", () => {
    const [c] = body('>> CHOICE\n- "A" -> {coins: -20}; {goto: paid}') as [ChoiceStmt];
    expect(c.options[0]).toMatchObject({ effects: [{ cmd: "coins", delta: -20 }], goto: "paid" });
  });

  it("parses nested [[if]] / [[elif]] / [[else]] / [[end]] blocks", () => {
    const [st] = body([
      "[[if flag.vanes_coin && !flag.vanes_coin_returned]]",
      "[[if vote.winner == 'player']]",
      "N: tears it",
      "[[else]]",
      "N: burns it",
      "[[end]]",
      "[[elif flag.charter_found]]",
      "N: holds",
      "[[else]]",
      ">> CHOICE",
      '- "Go" → goto a',
      "[[end]]",
    ].join("\n")) as [IfStmt];
    expect(st.kind).toBe("if");
    expect(st.line).toBe(BODY_LINE);
    expect(st.endLine).toBe(BODY_LINE + 11);
    expect(st.branches.map((b) => b.cond)).toEqual(["flag.vanes_coin && !flag.vanes_coin_returned", "flag.charter_found", null]);
    const inner = st.branches[0]!.body[0] as IfStmt;
    expect(inner.branches.map((b) => b.body.length)).toEqual([1, 1]);
    expect(st.branches[2]!.body[0]).toMatchObject({ kind: "choice", options: [{ goto: "a" }] });
  });

  it("parses cues as commands", () => {
    expect(body("{fade}\n{set: s01a_done}")).toEqual([
      { kind: "command", line: BODY_LINE, command: { cmd: "fade" } },
      { kind: "command", line: BODY_LINE + 1, command: { cmd: "set", flag: "s01a_done" } },
    ]);
  });
});

describe("cues", () => {
  it.each([
    ["set: pell_told_census", { cmd: "set", flag: "pell_told_census" }],
    ["unset: run_no", { cmd: "unset", flag: "run_no" }],
    ["regard: odile +5", { cmd: "regard", resident: "odile", delta: 5 }],
    ["regard: margo -2", { cmd: "regard", resident: "margo", delta: -2 }],
    ["pillar: spirit +10", { cmd: "pillar", pillar: "spirit", delta: 10 }],
    ["coins: -150", { cmd: "coins", delta: -150 }],
    ["item: +lantern_pinion", { cmd: "item", item: "lantern_pinion", delta: 1 }],
    ["item: -signature_book", { cmd: "item", item: "signature_book", delta: -1 }],
    ["scuffle: sc_bakery_tutorial", { cmd: "scuffle", id: "sc_bakery_tutorial" }],
    ["riddle: OQ-1", { cmd: "riddle", id: "OQ-1" }],
    ["puzzle: PZ-03", { cmd: "puzzle", id: "PZ-03" }],
    ["project: fountain", { cmd: "project", id: "fountain" }],
    ['ai_open: margo, topic: "Aurélien, the record, and \'the claim\'", turns: 4', { cmd: "ai_open", resident: "margo", topic: "Aurélien, the record, and 'the claim'", turns: 4 }],
    ['ai_line: q1_jobs, speaker: auto:nell, brief: "Ask about jobs, briefly."', { cmd: "ai_line", slot: "q1_jobs", speaker: { id: "nell", auto: true }, brief: "Ask about jobs, briefly." }],
    ['ai_line: rom1_remark, speaker: pair1_a, brief: "{romance_pair_1.a}, shy."', { cmd: "ai_line", slot: "rom1_remark", speaker: { id: "pair1_a", auto: false }, brief: "{romance_pair_1.a}, shy." }],
    ['fallback: "Mind the wick."', { cmd: "fallback", text: "Mind the wick." }],
    ['memory: pell, "The {name} kid came back. Same walk, {they} said.", importance: 9', { cmd: "memory", resident: "pell", text: "The {name} kid came back. Same walk, {they} said.", importance: 9 }],
    ["wait", { cmd: "wait" }],
    ["wait: 2", { cmd: "wait", seconds: 2 }],
    ["fade", { cmd: "fade" }],
    ["sfx: door_bang", { cmd: "sfx", id: "door_bang" }],
    ["cam: shake", { cmd: "cam", effect: "shake" }],
    ["goto: form", { cmd: "goto", label: "form" }],
    ["goto_scene: epilogue_e1", { cmd: "goto_scene", scene: "epilogue_e1" }],
    ["insert: ins_charter", { cmd: "insert", id: "ins_charter" }],
    ["backdrop: bg_wharf_night", { cmd: "backdrop", id: "bg_wharf_night" }],
    ["charcreate", { cmd: "charcreate" }],
    ["checkpoint: campaign_season", { cmd: "checkpoint", key: "campaign_season" }],
    ["load_checkpoint: campaign_season", { cmd: "load_checkpoint", key: "campaign_season" }],
    ["campaign: pledge_clinic", { cmd: "campaign", key: "pledge_clinic" }],
    ["debate_score: +2", { cmd: "debate_score", delta: 2 }],
    ["debate_score: 0", { cmd: "debate_score", delta: 0 }],
    ["pick_planks: 3", { cmd: "pick_planks", count: 3 }],
    ["tally: station_hill", { cmd: "tally", district: "station_hill" }],
  ])("{%s}", (inner, want) => expect(parseCommand(inner)).toEqual({ command: want }));

  it.each([
    ["sett: x", /unknown cue \{sett\} \(did you mean \{set\}\?\)/],
    ["regard: pell", /\{regard\} needs a change like \+3/],
    ["regard: pell three", /must be a whole number/],
    ["pillar: joy +2", /'joy' is not a pillar/],
    ["memory: pell, \"x\"", /\{memory\} needs 'importance:'/],
    ["memory: pell, \"x\", importance: 11", /importance must be 1–10/],
    ['ai_line: s1, speaker: nell, brief: "x", tone: "y"', /unknown argument 'tone:'/],
    ["ai_open: margo, turns: 3", /\{ai_open\} needs 'topic:'/],
    ["set: Pell_Flag", /must be a snake_case id/],
    ['fallback: "unterminated', /unterminated string/],
    ["fade: out", /unexpected extra argument out/],
    ["tally: harbor", /'harbor' is not a district/],
    ["set:", /has a colon but no arguments/],
  ])("{%s} is an error", (inner, msg) => {
    const r = parseCommand(inner);
    expect("error" in r && r.error).toMatch(msg);
  });
});

describe("syntax errors carry the file line", () => {
  const firstError = (src: string) => {
    const e = errors(parse(src));
    expect(e.length).toBeGreaterThan(0);
    return `${e[0]!.file}:${e[0]!.line}: ${e[0]!.message}`;
  };

  it.each([
    ["N: ok\nthis is not a line", 1, /can't parse line "this is not a line"/],
    ["pell [warm]: hi", 0, /speaker ids are upper-case \(PELL, not pell\)/],
    ["PELL [Warm Face]: hi", 0, /expression "\[Warm Face\]" must be a snake_case id/],
    ["PELL [warm]: (unclosed business", 0, /missing its closing '\)'/],
    ["PLAYER [warm]: hi", 0, /PLAYER: takes no \[expression\]/],
    ["N:", 0, /N: line has no text/],
    ['- "Orphan" → goto x', 0, /option outside a ">> CHOICE" block/],
    [">> CHOICE\n\nN: no options", 0, /">> CHOICE" has no options/],
    [">> CHOICES", 0, /expected ">> CHOICE"/],
    ['>> CHOICE\n- "a"\n- "b"\n- "c"\n- "d"\n- "e"', 5, /at most 4 options/],
    ['>> CHOICE\n- "a" → goto x; {set: y}', 1, /goto must be the option's last effect/],
    ['>> CHOICE\n- "a" → {set: y};; goto x', 1, /empty effect/],
    ['>> CHOICE\n- "a" → set y', 1, /can't read effect "set y"/],
    ['>> CHOICE\n- "a" goto x', 1, /expected "→" after the option text/],
    ['>> CHOICE\n- "a" → {ai_open: margo, topic: "t", turns: 2}', 1, /can't be a choice effect/],
    [":: Bad-Label", 0, /labels look like ":: snake_case_name"/],
    ["N: a\n[[else]]", 1, /\[\[else\]\] without an open \[\[if\]\]/],
    ["[[end]]", 0, /\[\[end\]\] without an open \[\[if\]\]/],
    ["[[if flag.a]]\n[[else]]\n[[elif flag.b]]\n[[end]]", 2, /\[\[elif\]\] after \[\[else\]\]/],
    ["[[if flag.a]]\n[[else]]\n[[else]]\n[[end]]", 2, /second \[\[else\]\] for the \[\[if\]\] on line 14/],
    ["[[if]]", 0, /\[\[if\]\] needs a condition/],
    ["N: a\n[[if flag.a]]\nN: b", 1, /\[\[if\]\] is never closed with \[\[end\]\]/],
    ["{set: x", 0, /cue is missing its closing "}"/],
    ["{sfx door_bang}", 0, /can't read cue|unknown cue/],
  ])("%j → body line %i", (src, offset, msg) => {
    const out = firstError(src);
    expect(out.startsWith(`${FILE}:${BODY_LINE + offset}: `)).toBe(true);
    expect(out).toMatch(msg);
  });
});
