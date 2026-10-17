/**
 * The place registry (GDD §9.5) and, until real ones are authored, opening hours. Residents may only plan at
 * registered places; plans and favors are checked against this set. The registry is `content/places/places.yaml`
 * (`zone: [place, …]`), read once per content directory and cached, like the resident cards (content/loadContent.ts).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { PlaceId, type PersonaCard } from "@monde/shared";

// Same resolution as content/loadContent.ts: source modules live two folders under server/, the bundle one.
const defaultDirectory = fileURLToPath(new URL(
  import.meta.url.includes("/src/") ? "../../../content/" : "../../content/", import.meta.url,
));

export interface PlaceRegistry {
  /** Every registered `zone.place` id. */
  readonly ids: ReadonlySet<string>;
  /** The same ids in file order (stable, for prompts). */
  readonly list: readonly string[];
}

const RegistryFile = z.record(z.string().regex(/^[a-z_]+$/), z.array(z.string().regex(/^[a-z0-9_]+$/)));

/** Parse places.yaml text. Throws on a malformed file or a duplicate id. */
export function parsePlaceRegistry(text: string): PlaceRegistry {
  const file = RegistryFile.parse(parse(text));
  const list: string[] = [];
  const ids = new Set<string>();
  for (const [zone, places] of Object.entries(file)) {
    for (const place of places) {
      const id = PlaceId.parse(`${zone}.${place}`);
      if (ids.has(id)) throw new Error(`Duplicate place id: ${id}`);
      ids.add(id);
      list.push(id);
    }
  }
  return { ids, list };
}

const cache = new Map<string, Promise<PlaceRegistry>>();
export function loadPlaceRegistry(directory = process.env.MONDE_CONTENT_DIR ?? defaultDirectory): Promise<PlaceRegistry> {
  const root = resolve(directory);
  let pending = cache.get(root);
  if (!pending) {
    const path = join(root, "places", "places.yaml");
    pending = readFile(path, "utf8").then(parsePlaceRegistry).catch((error: unknown) => {
      throw new Error(`Invalid place registry ${path}: ${error instanceof Error ? error.message : String(error)}`);
    });
    cache.set(root, pending);
    pending.catch(() => cache.delete(root));
  }
  return pending;
}

// ---------------------------------------------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------------------------------------------

/** Clock minutes, open..close. */
export interface Hours { open: number; close: number }

/**
 * GDD-GAP: §9.5 says the engine owns opening hours, but none are authored yet (places.yaml has ids only). Until
 * W-03's maps carry them: every place is open 06:00-26:00, the shops 07:00-19:00 and the pub 11:00-24:00. "Shops"
 * are the places people go to `shop` (the general store, the market hall, the storefronts); the bakery and the
 * café are workplaces whose owners keep their own hours, so they stay on the default.
 */
export const DEFAULT_HOURS: Hours = { open: 6 * 60, close: 26 * 60 };
export const SHOP_HOURS: Hours = { open: 7 * 60, close: 19 * 60 };
export const PUB_HOURS: Hours = { open: 11 * 60, close: 24 * 60 };
const SHOPS = /^market_row\.(?:general_store|market_hall|storefront_\d+)$/;
const PUB = "market_row.gull_and_anchor";

export function placeHours(id: string): Hours {
  if (id === PUB) return PUB_HOURS;
  if (SHOPS.test(id)) return SHOP_HOURS;
  return DEFAULT_HOURS;
}

const hhmm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const hoursText = (hours: Hours): string => `open ${hhmm(hours.open)}-${hhmm(hours.close)}`;

const VACANT = /\.vacant_house_\d+$/;
/** The census households' homes (A.1.3 `<zone>.home_NN`, content/places/homes.yaml): private, like the vacant houses. */
const CENSUS_HOME = /\.home_\d{2,3}$/;

/**
 * The open-places list for one resident's plan prompt (§9.17 "Places open tomorrow: {place ids with hours}").
 * Every registered place except the vacant houses, other households' homes and the mainland, which nobody plans a day
 * at unless their own routine already goes there. Hours are written only where they differ from the all-day default, and never on the
 * resident's own home or workplace (an owner isn't held to the shop's hours), which keeps the list short.
 */
export function openPlacesFor(
  registry: PlaceRegistry,
  card: Pick<PersonaCard, "home" | "workplace" | "routine">,
): { id: string; hours: string | null }[] {
  const own = new Set<string>([card.home, card.workplace, ...card.routine.weekday.map((b) => b.where),
    ...card.routine.weekend.map((b) => b.where)]);
  return registry.list
    .filter((id) => own.has(id) || (!VACANT.test(id) && !CENSUS_HOME.test(id) && !id.startsWith("offmap.")))
    .map((id) => {
      const hours = placeHours(id);
      const custom = hours !== DEFAULT_HOURS && id !== card.home && id !== card.workplace;
      return { id, hours: custom ? hoursText(hours) : null };
    });
}
