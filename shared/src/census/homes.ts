// The town's homes, door by door (GDD Appendix A.1.3, A.3.4 rule 1; content/places/homes.yaml): every one of the 184,
// lived in or vacant, with its address, its A.3.4 attributes and where it stands. Pure.
//
// Where a home stands (its `host`):
//   { building: x }  inside a building drawn on its zone's board: the one whose id is x, or whose `home:` list names x
//                    (several homes can share one building: flats in a townhouse, a flat over a shop). The resident
//                    walks to that building's door.
//   { lane: [x, y] } on an undrawn stretch of a street off its zone's board: the resident walks to that edge cell of the
//                    board and steps off it (sim/routineExecutor.ts `lane`).
//   offboard         in a zone that isn't built (Millbrook, Station Hill): the executor's off-board road, as before.
import { z } from "zod";

const ident = /^[a-z][a-z0-9_]*$/;
const cell = z.number().int().min(0);

export const HomeHost = z.union([
  z.object({ building: z.string().regex(ident) }).strict(),
  z.object({ lane: z.tuple([cell, cell]) }).strict(),
  z.literal("offboard"),
]);
export type HomeHost = z.infer<typeof HomeHost>;

export const HomeEntry = z.object({
  street: z.string().min(2),
  /** The door number; a letter suffix marks a house squeezed in later between two older numbers (No. 52A). */
  number: z.union([z.number().int().positive(), z.string().regex(/^\d+[A-Z]$/)]),
  /** Which flat, when one building holds several homes (A, B, C from the ground up). */
  flat: z.string().regex(/^[A-Z]$/).optional(),
  /** What the paper calls it when it has a name of its own ("the flat over the bakery"). */
  name: z.string().optional(),
  /** A.3.4 rule 1: a household needs beds >= ceil(size / 2). */
  beds: z.number().int().min(1).max(6),
  /** A.3.4: some Requires read `home.ground_floor` (retired couples, widowed elders). */
  ground_floor: z.boolean(),
  /** A.3.4: `home.bench`, room for a workbench (the radio tinkerer's Requires). */
  bench: z.boolean(),
  host: HomeHost,
}).strict();
export type HomeEntry = z.infer<typeof HomeEntry>;

export const HomesFile = z.object({
  version: z.literal(1),
  homes: z.record(z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/), HomeEntry),
}).strict();

/** Home id (`zone.home`) → entry, in file order. */
export type HomeRegistry = ReadonlyMap<string, HomeEntry>;

/** Parse content/places/homes.yaml (already YAML-parsed). Throws naming the field on a bad entry. */
export function parseHomes(doc: unknown): HomeRegistry {
  const file = HomesFile.parse(doc);
  return new Map(Object.entries(file.homes));
}

export const VACANT_HOME = /^[a-z_]+\.vacant_house_\d+$/;
export const isVacantHome = (id: string): boolean => VACANT_HOME.test(id);
export const homeZone = (id: string): string => id.slice(0, id.indexOf("."));
export const homeLocal = (id: string): string => id.slice(id.indexOf(".") + 1);
/** A.3.4 rule 1. */
export const bedsNeeded = (size: number): number => Math.max(1, Math.ceil(size / 2));

/** "No. 47 Lamplighter Lane", "Flat B, No. 37 Heron Lane", or the home's own name. */
export function homeLabel(entry: HomeEntry): string {
  if (entry.name) return entry.name;
  const door = `No. ${entry.number} ${entry.street}`;
  return entry.flat ? `Flat ${entry.flat}, ${door}` : door;
}
