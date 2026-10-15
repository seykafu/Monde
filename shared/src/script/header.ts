/** Scene header (the ```yaml block, GDD §13.1): parsed with `yaml`, validated with zod, errors carry file lines. */
import { LineCounter, isMap, isScalar, parseDocument } from "yaml";
import { z } from "zod";
import { PlaceId } from "../ids";
import type { Diagnostic, Header } from "./types";

const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, "must be a snake_case id");

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "HH:MM-HH:MM", end after start, at most 26:00 (times past midnight run to 26:00, §5.3). */
const TimeWindow = z
  .string()
  .regex(/^\d{2}:[0-5]\d-\d{2}:[0-5]\d$/, 'must look like "HH:MM-HH:MM"')
  .transform((s) => ({ start: s.slice(0, 5), end: s.slice(6, 11) }))
  .refine((t) => toMinutes(t.end) <= 26 * 60 && toMinutes(t.start) < 24 * 60, "hours run 00:00–26:00 (the start before 24:00)")
  .refine((t) => toMinutes(t.start) < toMinutes(t.end), "the window must end after it starts");

const SceneHeaderSchema = z
  .object({
    id: Id,
    kind: z.literal("scene").optional(),
    day: z.number().int().min(1).max(100),
    time: TimeWindow,
    place: PlaceId,
    trigger: z.string(),
    backdrop: Id,
    music: Id,
    cast: z.array(Id),
    sets: z.array(Id),
  })
  .strict();

const InsertLibrarySchema = z.object({ id: Id, kind: z.literal("insert_library") }).strict();

const SCENE_CALL = /^\s*scene_call:([a-z][a-z0-9_]*)\s*(?:&&([\s\S]*))?$/;

/**
 * Parse and validate a header. `firstLine` is the file line of the first YAML line, so diagnostics point at
 * the file, not the block. Returns null if the header is unusable.
 */
export function parseHeader(
  yamlText: string,
  firstLine: number,
  file: string,
  diags: Diagnostic[],
): { header: Header | null; keyLines: Record<string, number> } {
  const err = (line: number, message: string) => diags.push({ severity: "error", file, line, message });
  const lc = new LineCounter();
  const doc = parseDocument(yamlText, { lineCounter: lc, prettyErrors: false });
  if (doc.errors.length) {
    for (const e of doc.errors) err(firstLine + (lc.linePos(e.pos[0]).line - 1), `header YAML: ${e.message.split("\n")[0]}`);
    return { header: null, keyLines: {} };
  }
  const keyLine = new Map<string, number>();
  if (isMap(doc.contents))
    for (const pair of doc.contents.items)
      if (isScalar(pair.key) && pair.key.range) keyLine.set(String(pair.key.value), firstLine + lc.linePos(pair.key.range[0]).line - 1);

  const keyLines = Object.fromEntries(keyLine);
  const raw = doc.toJS() as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { err(firstLine, "header must be a YAML mapping"); return { header: null, keyLines }; }
  const obj = raw as Record<string, unknown>;
  const isLibrary = obj.kind === "insert_library";
  const parsed = (isLibrary ? InsertLibrarySchema : SceneHeaderSchema).safeParse(obj);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const k of issue.keys) err(keyLine.get(k) ?? firstLine, `header: unknown key '${k}'${isLibrary ? " (an insert_library header has only id and kind)" : ""}`);
        continue;
      }
      const key = String(issue.path[0] ?? "");
      const where = issue.path.join(".");
      if (key && !(key in obj)) err(firstLine, `header: missing '${key}'`);
      else err(keyLine.get(key) ?? firstLine, `header: ${where ? `${where}: ` : ""}${issue.message}`);
    }
    return { header: null, keyLines };
  }
  if (parsed.data.kind === "insert_library") return { header: { kind: "insert_library", id: parsed.data.id }, keyLines };

  const h = parsed.data;
  let trigger = h.trigger.trim();
  let calledFrom: string | undefined;
  const call = SCENE_CALL.exec(trigger);
  if (call) {
    calledFrom = call[1]!;
    trigger = (call[2] ?? "").trim();
    if (call[2] !== undefined && trigger === "") err(keyLine.get("trigger") ?? firstLine, "header: trigger ends with '&&'");
  } else if (trigger.includes("scene_call:")) {
    err(keyLine.get("trigger") ?? firstLine, "header: trigger: scene_call:<id> must come first (\"scene_call:<id> && …\")");
  }
  const header: Header = {
    kind: "scene",
    id: h.id,
    day: h.day,
    time: h.time,
    place: h.place,
    trigger,
    ...(calledFrom ? { calledFrom } : {}),
    backdrop: h.backdrop,
    music: h.music,
    cast: h.cast,
    sets: h.sets,
  };
  return { header, keyLines };
}
