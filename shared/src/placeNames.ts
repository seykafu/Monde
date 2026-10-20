// Place ids as people say them (playtest 2026-10-20: Sander told the Fellow he was "headed for
// market_row.market_street"). The dialogue prompt and the residents' lines use these names; plans keep ids, because
// their output must name a registered place. Pure: no I/O. The server adds the homes' addresses (homes.yaml).

import type { HomeRegistry } from "./census/homes";

/** The zones a place id can start with (content/places/places.yaml). */
export const PLACE_ZONES = ["old_quarter", "market_row", "wharf", "commons", "millbrook", "station_hill", "briar_woods", "offmap"] as const;

/** Places whose name isn't their id title-cased. */
export const PLACE_NAMES: Readonly<Record<string, string>> = {
  bakery: "Fournier & Fille", general_store: "Dunmore’s General Store", gull_and_anchor: "The Gull & Anchor",
  cafe_liss: "Café Liss", library: "Monde Free Library", lantern_office: "The Lantern", st_brigids: "St. Brigid’s",
  bertrand_house: "Achterberg Horlogerie", market_hall: "Covered Market Hall", mayor_office: "the Mayor’s Office",
  storefront_9: "No. 9 Market Row", lamplighter_cottage: "the Lamplighter’s Cottage", city: "the mainland",
};

const titleCase = (local: string): string => local.split("_").filter(Boolean).map((s) => s[0]!.toUpperCase() + s.slice(1)).join(" ");

/** "market_street" → "Market Street"; "bakery" → "Fournier & Fille". The client's Journal uses the same names. */
export const localPlaceName = (local: string): string => PLACE_NAMES[local] ?? titleCase(local);

/**
 * A place id as a resident would say it: a home by its address ("No. 17 High Street", or its own name, "the flat over
 * the library"), a vacant house by its number, anything else by its name.
 */
export function placeLabel(id: string, homes?: HomeRegistry): string {
  const home = homes?.get(id);
  if (home) return home.name ?? `No. ${home.number} ${home.street}`;
  const local = id.slice(id.indexOf(".") + 1);
  const vacant = /^vacant_house_(\d+)$/.exec(local);
  if (vacant) return `No. ${Number(vacant[1])}`;
  if (/^home_\d+$/.test(local)) return "a house nearby";
  return localPlaceName(local);
}

const PLACE_ID = new RegExp(`\\b(?:${PLACE_ZONES.join("|")})\\.[a-z0-9_]+\\b`, "g");

/** Every place id in `text` swapped for its name (`label`); text without one comes back unchanged. */
export const namePlaceIds = (text: string, label: (id: string) => string): string => text.replace(PLACE_ID, (id) => label(id));
