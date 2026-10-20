/**
 * Place names for the dialogue prompt and the residents' lines (shared placeNames.ts; playtest 2026-10-20: Sander told
 * the Fellow he was "headed for market_row.market_street"). The homes' addresses come from content/places/homes.yaml,
 * read once at startup (loadPlaceNames) so the persona block's bytes are the same on every call; before that, or in
 * tests, a home falls back to "a house nearby" and other places to their own names.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { namePlaceIds, parseHomes, placeLabel, type HomeRegistry } from "@monde/shared";

let homes: HomeRegistry | undefined;

// Same resolution as places.ts and content/loadContent.ts: source modules sit two folders under server/, the bundle one.
const defaultDirectory = fileURLToPath(new URL(import.meta.url.includes("/src/") ? "../../../content/" : "../../content/", import.meta.url));

/** Read the homes' addresses (idempotent). A missing or broken file leaves the fallbacks: names never block a turn. */
export async function loadPlaceNames(directory = process.env.MONDE_CONTENT_DIR ?? defaultDirectory): Promise<void> {
  try {
    homes = parseHomes(YAML.parse(await readFile(path.join(directory, "places", "homes.yaml"), "utf8")));
  } catch {
    homes = undefined;
  }
}

/** "No. 17 High Street", "Fournier & Fille", "Market Street". */
export const placeName = (id: string): string => placeLabel(id, homes);

/** Every place id in `text` named. */
export const namePlaces = (text: string): string => namePlaceIds(text, placeName);
