import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { parse } from "yaml";
import { PersonaCard } from "@monde/shared";

// Source modules live in src/content; the bundle lives directly in dist.
const defaultDirectory = fileURLToPath(new URL(
  import.meta.url.includes("/src/") ? "../../../content/" : "../../content/", import.meta.url,
));
const cache = new Map<string, Promise<PersonaCard[]>>();

/** One folder's YAML cards (not recursive), in file order. */
async function readCards(folder: string, ids: Set<string>, optional: boolean): Promise<PersonaCard[]> {
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith(".yaml")).sort();
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const cards = await Promise.all(names.map(async (name) => {
    const path = join(folder, name);
    try {
      return PersonaCard.parse(parse(await readFile(path, "utf8")));
    } catch (error) {
      throw new Error(`Invalid resident card ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  for (const card of cards) {
    if (ids.has(card.id)) throw new Error(`Duplicate resident id: ${card.id} (${folder})`);
    ids.add(card.id);
  }
  return cards;
}

export interface RosterOptions {
  /**
   * "full": the hand-written cards and the Day-1 census's; "authored": the hand-written ones only. Default: "authored"
   * when MONDE_ROSTER=authored (the server's unit tests, server/vitest.config.ts), else "full".
   */
  roster?: "full" | "authored";
}

const rosterOf = (options: RosterOptions): "full" | "authored" => options.roster ?? (process.env.MONDE_ROSTER === "authored" ? "authored" : "full");

/**
 * Every persona card: the hand-written ones (content/residents/*.yaml) in file order, then the Day-1 census's
 * (content/residents/day1/*.yaml, MVP M-03) by id, the client's order (tools/compile-residents.ts). With no Day-1
 * cards it is the same 24. Read once per content directory and cached (warmed at boot, app.ts); callers get a copy.
 */
export async function loadContent(directory = process.env.MONDE_CONTENT_DIR ?? defaultDirectory, options: RosterOptions = {}): Promise<PersonaCard[]> {
  const root = resolve(directory);
  const roster = rosterOf(options);
  const key = `${roster}|${root}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const folder = join(root, "residents");
      const ids = new Set<string>();
      const hand = await readCards(folder, ids, false);
      if (!hand.length) throw new Error(`No resident YAML cards in ${folder}`);
      if (roster === "authored") return hand;
      const day1 = (await readCards(join(folder, "day1"), ids, true)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return [...hand, ...day1];
    })();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  // Never let world initialization mutate the cached template.
  return structuredClone(await pending);
}

/** The same authored catalog the client bundles. */
export async function loadItems(directory = process.env.MONDE_CONTENT_DIR ?? defaultDirectory) {
  const { ItemCatalog } = await import('@monde/shared');
  return ItemCatalog.parse(parse(await readFile(join(directory, 'items.yaml'), 'utf8')));
}
