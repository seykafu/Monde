/** Compiles every authored scene in content/scenes against the real flags, persona cards and places. */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileScenes } from "../compile";
import { parseScene } from "../parse";
import { registryFromContent } from "../registry";
import { formatDiagnostic } from "../types";

const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const residentFiles = readdirSync(resolve(root, "content/residents")).filter((f) => f.endsWith(".yaml")).sort();
const reg = registryFromContent({
  flagsYaml: read("content/flags.yaml"),
  residentYamls: residentFiles.map((f) => read(`content/residents/${f}`)),
  placesYaml: read("content/places/places.yaml"),
});
const files = readdirSync(resolve(root, "content/scenes")).filter((f) => f.endsWith(".scene.md")).sort();
const sources = files.map((f) => ({ file: `content/scenes/${f}`, source: read(`content/scenes/${f}`) }));
const result = compileScenes(sources, reg);
const errorsIn = (file: string) => (result.byFile.get(file) ?? []).filter((d) => d.severity === "error").map(formatDiagnostic);

/** The MVP scenes ("Spring in Monde", Days 1–25): S01a … S10b. */
const MVP = /^s(0\d|10)[a-z]?_/;
/** MVP scene files with known content bugs (see the compile report); empty when S01–S10 are clean. */
const KNOWN_BROKEN = new Set<string>([]);

describe("content/scenes", () => {
  it("has the scenes extracted from GDD §13.3–§13.5", () => {
    expect(files.length).toBeGreaterThanOrEqual(37);
    expect(files.filter((f) => MVP.test(f))).toHaveLength(15);
  });

  for (const { file, source } of sources) {
    it(`${file} parses without syntax errors`, () => {
      expect(parseScene(source, file).diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic)).toEqual([]);
    });
  }

  for (const f of files.filter((x) => MVP.test(x))) {
    const file = `content/scenes/${f}`;
    (KNOWN_BROKEN.has(f) ? it.fails : it)(`${file} (MVP) compiles with zero errors`, () => {
      expect(errorsIn(file)).toEqual([]);
    });
  }

  it("compiles to JSON-serializable scenes", () => {
    for (const s of result.scenes) expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(result.scenes.every((s) => s.ops.at(-1)?.op === "end")).toBe(true);
  });
});
