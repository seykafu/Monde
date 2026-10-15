import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import type { PlanOutput } from "@monde/shared";
import { hhmmToMinutes } from "./templatePlan.js";

/** GDD-GAP: §9.6 names a sight radius but gives no distance. Use 6 tiles between place doors,
 * within one zone. Plans provide places, not live positions; doors approximate presence.
 * Unmapped places only witness at the exact same place. No cross-zone or offmap sight. */
export const WITNESS_RADIUS = 6;
export type PlacePositions = ReadonlyMap<string, readonly [number, number]>;
const Door = z.tuple([z.number(), z.number()]);
/** Zone files (client/src/world/zoneFormat.ts): open places under `places:`; in format v2, buildings with an id are places too. */
const Zone = z.object({
  id: z.string(),
  places: z.array(z.object({ id: z.string(), door: Door })).default([]),
  buildings: z.array(z.object({ id: z.string().optional(), door: Door.optional() })).default([])
});
const root = fileURLToPath(new URL(import.meta.url.includes("/src/") ? "../../../content/" : "../../content/", import.meta.url));
export async function loadPlacePositions(directory = process.env.MONDE_CONTENT_DIR ?? root): Promise<PlacePositions> {
  const positions = new Map<string, readonly [number, number]>();
  let files: string[];
  try { files = await readdir(join(directory, "zones")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return positions; throw error; }
  for (const file of files.filter(f => f.endsWith(".zone.yaml")).sort()) {
    const zone = Zone.parse(parse(await readFile(join(directory, "zones", file), "utf8")));
    for (const place of zone.places) positions.set(`${zone.id}.${place.id}`, place.door);
    for (const building of zone.buildings) if (building.id && building.door) positions.set(`${zone.id}.${building.id}`, building.door);
  }
  return positions;
}
export function withinSight(a: string, b: string, positions: PlacePositions): boolean {
  if (a.startsWith("offmap.") || a.split(".")[0] !== b.split(".")[0]) return false;
  if (a === b) return true;
  const x = positions.get(a), y = positions.get(b);
  return !!x && !!y && Math.hypot(x[0] - y[0], x[1] - y[1]) <= WITNESS_RADIUS;
}
/** Same block/time conventions as encounters.ts: start inclusive, end exclusive, asleep excluded. */
export function witnesses(blocks: PlanOutput["blocks"], place: string, minute: number, positions: PlacePositions): boolean {
  return blocks.some(b => b.action !== "sleep" && b.action !== "nap"
    && hhmmToMinutes(b.start) <= minute && minute < hhmmToMinutes(b.end) && withinSight(b.place, place, positions));
}
