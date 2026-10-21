// The itch.io browser build as one zip (MVP L-02): `npm run package:itch` builds client/dist-itch (build:itch), drops the
// source maps, refuses art that is still a Git LFS pointer (run `git lfs pull` first), checks itch's HTML5 limits
// (https://itch.io/docs/creators/html5: at most 1,000 files, 500 MB extracted, 200 MB a file, 240-character paths) and
// writes release/monde-web-<commit>.zip, ready for butler or the upload page.
/* global console, process */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "client", "dist-itch");
execFileSync("npm", ["run", "build:itch"], { cwd: root, stdio: "inherit" });

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(dist);
for (const file of files.filter((f) => f.endsWith(".map"))) fs.rmSync(file);
const shipped = files.filter((f) => !f.endsWith(".map"));

const problems = [];
const pointers = shipped.filter((f) => /\.(png|webp|jpe?g|mp3)$/.test(f) && fs.statSync(f).size < 200
  && fs.readFileSync(f, "utf8").startsWith("version https://git-lfs"));
if (pointers.length) problems.push(`${pointers.length} assets are Git LFS pointers (run \`git lfs pull\`), e.g. ${path.relative(dist, pointers[0])}`);
const sizes = shipped.map((f) => fs.statSync(f).size);
const total = sizes.reduce((a, b) => a + b, 0);
if (shipped.length > 1000) problems.push(`${shipped.length} files (itch allows 1,000)`);
if (total > 500 * 1024 * 1024) problems.push(`${(total / 1048576).toFixed(0)} MB extracted (itch allows 500)`);
const largest = Math.max(...sizes);
if (largest > 200 * 1024 * 1024) problems.push(`a ${(largest / 1048576).toFixed(0)} MB file (itch allows 200 MB a file)`);
const long = shipped.map((f) => path.relative(dist, f)).filter((p) => p.length > 240);
if (long.length) problems.push(`${long.length} paths over 240 characters, e.g. ${long[0]}`);
if (problems.length) {
  console.error(`Not packaged:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const outDir = path.join(root, "release");
fs.mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, `monde-web-${commit}.zip`);
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", zip, "."], { cwd: dist });
console.log(`${path.relative(root, zip)}: ${shipped.length} files, ${(total / 1048576).toFixed(0)} MB extracted, ${(fs.statSync(zip).size / 1048576).toFixed(0)} MB zipped`);
