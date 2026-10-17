// content/census/pins.yaml (MVP M-03, D4): what the Day-1 skeleton holds fixed. Pure: schemas and checks.
import { z } from "zod";
import { ARCHETYPE_IDS } from "../arrivals/archetypes";
import { AGE_BANDS } from "../arrivals/library";
import { CENSUS_ZONES, HOUSEHOLD_TYPES } from "./day1Tables";

const id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const place = z.string().regex(/^[a-z_]+\.[a-z0-9_.]+$/);
const presentation = z.enum(["f", "m", "a"]);

export const PinJob = z.object({ row: z.number().int().min(1).max(24), title: z.string(), workplace: place }).strict();
export type PinJob = z.infer<typeof PinJob>;

/** Someone still to invent, with what is fixed about them. */
export const PinSlot = z.object({
  archetype: z.enum(ARCHETYPE_IDS).optional(),
  presentation: presentation.optional(),
  /** null: their own (a flatmate's); absent: the household's or the skeleton's choice. */
  surname: z.string().nullable().optional(),
  band: z.enum(AGE_BANDS).optional(),
  note: z.string(),
}).strict();
export type PinSlot = z.infer<typeof PinSlot>;

export const PinMember = z.union([
  z.object({ card: id }).strict(),
  z.object({ person: id }).strict(),
  z.object({ slot: PinSlot }).strict(),
]);
export type PinMember = z.infer<typeof PinMember>;

export const PinHousehold = z.object({
  id,
  type: z.enum(HOUSEHOLD_TYPES),
  zone: z.enum(CENSUS_ZONES),
  /** null: the skeleton picks a home in the zone. */
  home: place.nullable(),
  /** null: everyone keeps their own (flatmates). */
  surname: z.string().nullable(),
  members: z.array(PinMember).min(1),
}).strict();
export type PinHousehold = z.infer<typeof PinHousehold>;

const Lock = z.object({ while: z.string(), fact: z.string() }).strict();

/** A carded person inside the 192: the card holds the rest. */
const CardedPerson = z.object({ card: z.literal(true), archetype: z.enum(ARCHETYPE_IDS), job: PinJob.optional() }).strict();
/** A named person with no card yet. */
const NamedPerson = z.object({
  name: z.string(),
  /** A fixed age, or the range the skeleton draws it from (GDD-GAP where canon gives none). */
  age: z.union([z.number().int().min(0).max(110), z.tuple([z.number().int(), z.number().int()])]),
  presentation,
  archetype: z.enum(ARCHETYPE_IDS),
  job: PinJob.optional(),
  twin_of: id.optional(),
  source: z.string(),
  hook: z.string(),
  voice: z.string().nullable(),
  canon_locks: z.array(Lock),
}).strict();
export const PinPerson = z.union([CardedPerson, NamedPerson]);
export type PinPerson = z.infer<typeof PinPerson>;
export type NamedPinPerson = z.infer<typeof NamedPerson>;
export const isNamedPin = (p: PinPerson): p is NamedPinPerson => !("card" in p);

export const PinLink = z.object({ a: z.string(), b: z.string(), tag: z.string(), note: z.string() }).strict();
export type PinLink = z.infer<typeof PinLink>;
export const PinMirror = z.object({ from: id, to: id, tag: z.string(), affinity: z.number().int(), trust: z.number().int() }).strict();
export type PinMirror = z.infer<typeof PinMirror>;

export const PinsFile = z.object({
  version: z.literal(1),
  households: z.array(PinHousehold),
  people: z.record(id, PinPerson),
  links: z.array(PinLink),
  mirrors: z.array(PinMirror),
}).strict();
export type Pins = z.infer<typeof PinsFile>;

export const parsePins = (doc: unknown): Pins => PinsFile.parse(doc);
