/**
 * Copies every scripted scene out of the GDD (§13.3 Acts I–II, §13.4 Acts III–IV, §13.5 endings, inserts and
 * epilogues) into content/scenes/<scene-id>.scene.md, so scenes become editable content. The GDD stays the
 * design record; after extraction, content/scenes is what the compiler (tools/compile-scenes.ts) reads.
 *
 * One file per `#### …` heading that carries a ```yaml header and a ```script body. Each file holds the heading,
 * any prose between the heading and the header, the header and the body, byte for byte as authored.
 *
 * Run:  npx tsx tools/extract-scenes.ts            (skips files that already exist with different content)
 *       npx tsx tools/extract-scenes.ts --force    (overwrites them: edits made in content/scenes are lost)
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const gddPath = path.join(root, "docs/MONDE_GDD.md");
const outDir = path.join(root, "content/scenes");
const force = process.argv.includes("--force");

/** `###` sections whose `####` headings are scenes. §13.3a / §13.5a (flag tables) are excluded. */
const SCENE_SECTIONS = [/^### 13\.3 /, /^### 13\.4 /, /^### 13\.5 /];

const lines = fs.readFileSync(gddPath, "utf8").split("\n");

interface Chunk { heading: string; start: number; end: number } // [start, end) line indexes
const chunks: Chunk[] = [];
let inSection = false;
let open: Chunk | null = null;
const close = (i: number) => { if (open) { open.end = i; chunks.push(open); open = null; } };
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]!;
  if (/^#{1,3} /.test(l)) { close(i); inSection = SCENE_SECTIONS.some((r) => r.test(l)); continue; }
  if (inSection && l.startsWith("#### ")) { close(i); open = { heading: l.slice(5).trim(), start: i, end: lines.length }; }
}
close(lines.length);

const isFence = (l: string | undefined, info: string) => l !== undefined && new RegExp(`^\`\`\`${info}\\s*$`).test(l);

fs.mkdirSync(outDir, { recursive: true });
const seen = new Map<string, string>();
let written = 0, unchanged = 0, skipped = 0;
const notes: string[] = [];

for (const c of chunks) {
  let y = c.start + 1;
  while (y < c.end && !isFence(lines[y], "yaml")) y++;
  if (y >= c.end) { notes.push(`no scene under "#### ${c.heading}" (GDD line ${c.start + 1}); skipped`); continue; }
  let yEnd = y + 1;
  while (yEnd < c.end && !isFence(lines[yEnd], "")) yEnd++;
  let s = yEnd + 1;
  while (s < c.end && lines[s]!.trim() === "") s++;
  if (!isFence(lines[s], "script")) throw new Error(`GDD line ${s + 1}: "#### ${c.heading}" has a yaml header but no \`\`\`script body`);
  let sEnd = s + 1;
  while (sEnd < c.end && !isFence(lines[sEnd], "")) sEnd++;
  if (sEnd >= c.end) throw new Error(`GDD line ${s + 1}: unclosed \`\`\`script fence under "#### ${c.heading}"`);

  const header = YAML.parse(lines.slice(y + 1, yEnd).join("\n")) as { id?: unknown };
  const id = typeof header?.id === "string" ? header.id : null;
  if (!id || !/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`GDD line ${y + 2}: scene under "#### ${c.heading}" has no valid id`);
  if (seen.has(id)) throw new Error(`duplicate scene id ${id} ("${seen.get(id)}" and "${c.heading}")`);
  seen.set(id, c.heading);

  const text = lines.slice(c.start, sEnd + 1).join("\n") + "\n";
  const file = path.join(outDir, `${id}.scene.md`);
  const rel = path.relative(root, file);
  if (fs.existsSync(file)) {
    const cur = fs.readFileSync(file, "utf8");
    if (cur === text) { unchanged++; continue; }
    if (!force) { skipped++; notes.push(`${rel} differs from the GDD; kept (pass --force to overwrite)`); continue; }
  }
  fs.writeFileSync(file, text);
  written++;
}

for (const n of notes) console.log(`note  ${n}`);
console.log(`scenes: ${seen.size} found in GDD §13.3–§13.5 · ${written} written, ${unchanged} unchanged, ${skipped} kept → ${path.relative(root, outDir)}/`);
