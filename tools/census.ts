/**
 * The Day-1 census skeleton (MVP M-03 step 1; GDD Appendix A.1). Two commands:
 *
 *   npm run census:skeleton [-- --reseed [--seed <seed>]]
 *       Builds content/census/day1.yaml from content/census/pins.yaml, content/places/homes.yaml, the portrait library and
 *       the persona cards (shared/src/census/skeleton.ts). The file is frozen once written: it refuses to overwrite it
 *       unless --reseed, which rebuilds with the file's own seed (or --seed's) from today's pins, homes and library.
 *   npm run census:report
 *       Recomputes every A.1 table from the frozen file and checks it against A.1 (exit 1 if one doesn't close), and says
 *       whether the file still reproduces from its seed.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  PORTRAIT_LIBRARY, PersonaCard, buildSkeleton, censusMismatches, censusProgressReset, censusTables, formatCensusReport, parseHomes, parsePins,
  stringifySkeleton, type CensusCard, type Day1Skeleton,
} from "@monde/shared";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const OUT = "content/census/day1.yaml";
const DEFAULT_SEED = "monde-spring-day1";

function inputs() {
  const pins = parsePins(YAML.parse(read("content/census/pins.yaml")));
  const homes = parseHomes(YAML.parse(read("content/places/homes.yaml")));
  // The hand-written cards only: content/residents/*.yaml, never the generated ones in content/residents/day1/ (the
  // skeleton is built before they exist, and from it they are written).
  const dir = path.join(root, "content/residents");
  const cards: CensusCard[] = fs.readdirSync(dir).filter(f => f.endsWith(".yaml")).sort().map(f => {
    const c = PersonaCard.parse(YAML.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    return { id: c.id, name: c.name, age: c.age, pronouns: c.pronouns, kind: c.kind, home: c.home, ...(c.look ? { look: c.look } : {}), relationships: c.relationships };
  });
  return { pins, homes, cards };
}

function skeleton(args: string[]): void {
  const reseed = args.includes("--reseed");
  const at = args.indexOf("--seed");
  const file = path.join(root, OUT);
  const existing = fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, "utf8")) as Day1Skeleton) : null;
  if (existing && !reseed) {
    console.error(`${OUT} is frozen (seed ${existing.seed}). Rebuild it with: npm run census:skeleton -- --reseed [--seed <seed>]`);
    process.exit(1);
  }
  // A reseed would orphan the cards M-03 step 2 has written from it (content/residents/day1/).
  const written = existing?.households.filter(h => h.generation?.source) ?? [];
  if (written.length) {
    console.error(`${OUT} has ${written.length} households with written cards (${written.slice(0, 5).map(h => h.id).join(", ")}…): a reseed would orphan them. Remove content/residents/day1/ and reset their generation records first.`);
    process.exit(1);
  }
  const seed = at >= 0 ? args[at + 1] ?? DEFAULT_SEED : existing?.seed ?? DEFAULT_SEED;
  const { pins, homes, cards } = inputs();
  const sk = buildSkeleton(seed, pins, homes, PORTRAIT_LIBRARY, cards);
  const bad = censusMismatches(censusTables(sk, homes));
  if (bad.length) { console.error(formatCensusReport(sk, homes)); process.exit(1); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifySkeleton(sk));
  console.log(formatCensusReport(sk, homes));
  console.log(`\nwrote ${OUT}`);
}

function report(): void {
  const file = path.join(root, OUT);
  if (!fs.existsSync(file)) { console.error(`no ${OUT}: run npm run census:skeleton`); process.exit(1); }
  const sk = YAML.parse(fs.readFileSync(file, "utf8")) as Day1Skeleton;
  const { pins, homes, cards } = inputs();
  console.log(formatCensusReport(sk, homes));
  let same = false;
  // M-03 step 2's progress (statuses, generation records, the written members' ids and names) isn't the seed's.
  const asBuilt = censusProgressReset(sk, new Set(pins.households.map(h => h.id)));
  try { same = JSON.stringify(buildSkeleton(sk.seed, pins, homes, PORTRAIT_LIBRARY, cards)) === JSON.stringify(asBuilt); } catch (e) { console.log(`rebuild failed: ${(e as Error).message}`); }
  console.log(same ? `Reproduces from seed ${sk.seed}.` : `Does NOT reproduce from seed ${sk.seed} (pins, homes, library or cards changed since): rebuild with --reseed.`);
  process.exit(censusMismatches(censusTables(sk, homes)).length ? 1 : 0);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "skeleton") skeleton(rest);
else if (command === "report") report();
else { console.error("usage: tsx tools/census.ts skeleton [--reseed] [--seed <seed>] | report"); process.exit(1); }
