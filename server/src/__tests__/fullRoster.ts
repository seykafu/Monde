// The full Day-1 roster for the server's integration tests (MVP M-03 step 3): a content directory holding the
// hand-written cards and, a folder down, every census household's template card (tools/census-inputs.ts, built in
// memory and cached), whether or not content/residents/day1/ has the real ones. The unit tests run on the 24
// hand-written cards (MONDE_ROSTER=authored, vitest.config.ts); these ask for the full roster explicitly.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, templateRoster, writeCardDir } from "../../../tools/census-inputs.js";

export const FULL = { roster: "full" } as const;

/** A temp content root with residents/*.yaml (the hand-written cards) and residents/day1/ (the template roster). */
export async function fullRosterContent(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "monde-roster-"));
  const residents = join(dir, "residents");
  mkdirSync(residents, { recursive: true });
  const hand = join(REPO_ROOT, "content/residents");
  for (const f of readdirSync(hand).filter((name) => name.endsWith(".yaml"))) copyFileSync(join(hand, f), join(residents, f));
  writeCardDir(join(residents, "day1"), await templateRoster());
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
