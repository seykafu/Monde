/**
 * The Day-1 census's inputs from content/ (MVP M-03), loaded once for tools/gen-residents.ts and for the tests that need
 * the whole town: the frozen skeleton, the pins, the homes, the place registry, the gift tags, the hand-written cards and
 * the Day-1 cards already written. Node only (it reads files); the engine is shared/src/census/generate.ts.
 *
 * templateRoster() is the development roster (M-03 step 3): every household's A.3.8 template card, built in memory with
 * no model call, from the skeleton as it was seeded. Tests that need the full 212 use it (or write it to a temp folder);
 * nothing here writes into content/.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  ItemCatalog, PersonaCard, censusProgressReset, parseHomes, parsePins, runCensus, stringifyGeneratedCard, type CensusInput,
  type Day1Skeleton,
} from "@monde/shared";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const SKELETON_FILE = "content/census/day1.yaml";
export const DAY1_CARDS_DIR = "content/residents/day1";

/** The YAML persona cards in one folder (not recursive), in file order; a bad card throws naming its file. */
export function loadCardDir(dir: string): PersonaCard[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".yaml")).sort().map(f => {
    const parsed = PersonaCard.safeParse(YAML.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    if (!parsed.success) throw new Error(`${path.join(dir, f)}: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    return parsed.data;
  });
}

export interface LoadOptions {
  root?: string;
  /** Where the written Day-1 cards are read from (content/residents/day1). */
  cardsDir?: string;
  /** Start from the skeleton as seeded (no household drafted): a roster written somewhere other than content/. */
  resetProgress?: boolean;
}

/** The census's inputs as tools/gen-residents.ts runs them. */
export function loadCensusInput(opts: LoadOptions = {}): CensusInput {
  const root = opts.root ?? REPO_ROOT;
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  const pins = parsePins(YAML.parse(read("content/census/pins.yaml")));
  const raw = YAML.parse(read(SKELETON_FILE)) as Day1Skeleton;
  const skeleton = opts.resetProgress ? censusProgressReset(raw, new Set(pins.households.map(h => h.id))) : raw;
  const homes = parseHomes(YAML.parse(read("content/places/homes.yaml")));
  const placesDoc = YAML.parse(read("content/places/places.yaml")) as Record<string, string[]>;
  const places = new Set(Object.entries(placesDoc).flatMap(([zone, ids]) => ids.map(id => `${zone}.${id}`)));
  const items = ItemCatalog.parse(YAML.parse(read("content/items.yaml")));
  const giftTags = [...new Set(items.flatMap(i => i.tags))];
  // The hand-written cards only (content/residents/*.yaml); the generated ones live a folder down.
  const cards = loadCardDir(path.join(root, "content/residents"));
  const written = new Map(loadCardDir(opts.cardsDir ?? path.join(root, DAY1_CARDS_DIR)).map(c => [c.id, c]));
  return { skeleton, pins, homes, places, cards, written, giftTags };
}

const rosters = new Map<string, Promise<PersonaCard[]>>();

/** Every file a template roster depends on: the census inputs, the hand-written cards, and the shared engine's source. */
function rosterSources(root: string): string[] {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
    return e.name.endsWith(".ts") || e.name.endsWith(".json") ? [p] : [];
  });
  const content = ["content/census/day1.yaml", "content/census/pins.yaml", "content/places/homes.yaml", "content/places/places.yaml", "content/items.yaml"]
    .map(p => path.join(root, p));
  const hand = fs.readdirSync(path.join(root, "content/residents")).filter(f => f.endsWith(".yaml")).map(f => path.join(root, "content/residents", f));
  return [...content, ...hand, ...walk(path.join(root, "shared/src"))].sort();
}

/** A hash of everything the roster is built from: the cache key. */
function rosterKey(root: string): string {
  const h = createHash("sha256");
  for (const f of rosterSources(root)) h.update(path.relative(root, f)).update("\0").update(fs.readFileSync(f)).update("\0");
  return h.digest("hex").slice(0, 24);
}

async function buildTemplateRoster(root: string): Promise<PersonaCard[]> {
  const input = loadCensusInput({ root, cardsDir: path.join(root, "__no_cards__"), resetProgress: true });
  const result = await runCensus(input, {
    templateOnly: true, concurrency: 1,
    store: { householdsWithCards: () => new Set(), writeCards: () => {}, removeCards: () => {}, saveSkeleton: () => {}, log: () => {} },
    now: () => new Date("2026-03-20T00:00:00Z"),
  });
  if (result.failed.length) throw new Error(`template roster: ${result.failed.map(f => `${f.id}: ${f.reason}`).join("; ")}`);
  return [...input.written.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Every Day-1 household's template card (188 of them), in memory, from the skeleton as seeded: what
 * `npm run census:write -- --template-only --out <dir>` writes, in id order. Building it takes a few seconds, so it is
 * cached on disk (node_modules/.cache/monde/, keyed by a hash of the inputs and the shared engine) and per process;
 * callers get their own copies.
 */
export async function templateRoster(root: string = REPO_ROOT): Promise<PersonaCard[]> {
  let pending = rosters.get(root);
  if (!pending) {
    pending = (async () => {
      const file = path.join(root, "node_modules/.cache/monde", `template-roster-${rosterKey(root)}.json`);
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as PersonaCard[];
      } catch {
        const cards = await buildTemplateRoster(root);
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(cards));
          fs.renameSync(tmp, file);
        } catch { /* a read-only checkout builds it each time */ }
        return cards;
      }
    })();
    rosters.set(root, pending);
  }
  return structuredClone(await pending);
}

/** Write cards as content/residents/day1/ holds them (one <id>.yaml each) into `dir`. */
export function writeCardDir(dir: string, cards: readonly PersonaCard[]): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const c of cards) fs.writeFileSync(path.join(dir, `${c.id}.yaml`), stringifyGeneratedCard(c));
}
