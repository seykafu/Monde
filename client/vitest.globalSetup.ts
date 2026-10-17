// The client tests read the compiled roster (src/world/residents.gen.json, tools/compile-residents.ts) the way the
// game does. Compile it first, so the tests always see content/residents as it is now (with or without the Day-1
// cards), never a file left over from an earlier run. Writes nothing when the cards haven't changed.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default function setup(): void {
  const root = resolve(import.meta.dirname, "..");
  execFileSync(process.execPath, ["--import", "tsx", "tools/compile-residents.ts"], { cwd: root, stdio: "pipe" });
}
