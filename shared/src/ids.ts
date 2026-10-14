import { z } from "zod";

/** Zones (GDD §2.3, §9.5). `offmap` covers the mainland (Carrow) for non-residents like Vane. */
export const ZONES = [
  "old_quarter",
  "market_row",
  "wharf",
  "commons",
  "millbrook",
  "station_hill",
  "briar_woods",
  "offmap",
] as const;
export const Zone = z.enum(ZONES);
export type Zone = z.infer<typeof Zone>;

/** A registered place id: `zone.place` (GDD §9.5). The registry itself lives in content/places. */
export const PlaceId = z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/, "place ids look like zone.place");
export type PlaceId = z.infer<typeof PlaceId>;

export const ResidentId = z.string().regex(/^[a-z][a-z0-9_]*$/, "resident ids are snake_case");
export type ResidentId = z.infer<typeof ResidentId>;

export function zoneOf(place: string): string {
  return place.slice(0, place.indexOf("."));
}
