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
export async function loadContent(directory = process.env.MONDE_CONTENT_DIR ?? defaultDirectory): Promise<PersonaCard[]> {
  const root = resolve(directory);
  let pending = cache.get(root);
  if (!pending) {
    pending = (async () => {
      const folder = join(root, "residents");
      const files = (await readdir(folder)).filter((name) => name.endsWith(".yaml")).sort();
      if (!files.length) throw new Error(`No resident YAML cards in ${folder}`);
      const ids = new Set<string>();
      return Promise.all(files.map(async (name) => {
        const path = join(folder, name);
        try {
          const card = PersonaCard.parse(parse(await readFile(path, "utf8")));
          if (ids.has(card.id)) throw new Error(`Duplicate resident id: ${card.id}`);
          ids.add(card.id);
          return card;
        } catch (error) {
          throw new Error(`Invalid resident card ${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }));
    })();
    cache.set(root, pending);
    pending.catch(() => cache.delete(root));
  }
  // Never let world initialization mutate the cached template.
  return structuredClone(await pending);
}

/** The same authored catalog the client bundles. */
export async function loadItems(directory = process.env.MONDE_CONTENT_DIR ?? defaultDirectory) {
  const { ItemCatalog } = await import('@monde/shared');
  return ItemCatalog.parse(parse(await readFile(join(directory, 'items.yaml'), 'utf8')));
}
