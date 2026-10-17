// What a Day-1 census household carries into the card-writing prompt (MVP M-03 step 2; GDD Appendix A.1.5: "the same
// prompt as arrivals (A.3.6) with MODE: native"). Pure: types and their zod schemas. The schemas are what the server's
// census endpoint accepts (server/src/mind/census.ts), so a request can only ever describe a household, never carry a
// prompt of its own.
import { z } from "zod";
import { CENSUS_ZONES, EMPLOYMENT, HOUSEHOLD_TYPES, type CensusZone, type Employment, type HouseholdType } from "../census/day1Tables";
import { PlaceId, ResidentId } from "../ids";
import { CardHumanLook, HAIR_STYLES } from "../look";
import { ARCHETYPE_IDS } from "./archetypes";
import { AGE_BANDS } from "./library";

/** A.3.5's record for one bust, library or procedural (shared/src/census/portraitPlan.ts PortraitTags). */
export const PortraitTagsSchema = z.object({
  band: z.enum(AGE_BANDS),
  presentation: z.enum(["f", "m", "a"]),
  skin: z.number().int().min(1).max(6),
  skin_word: z.string().max(60),
  hair_word: z.string().max(60),
  hair_style: z.enum(HAIR_STYLES),
  attire: z.array(z.string().max(30)).min(1).max(8),
  build: z.enum(["slight", "average", "broad"]),
  caption: z.string().max(400),
}).strict();

const Short = (n: number) => z.string().max(n);
const Place = z.union([PlaceId, z.literal("home.own")]);

/** A native member's fixed facts from the skeleton (content/census/day1.yaml). */
export interface NativeMemberFacts {
  kind: "named" | "anonymous";
  /** Named canon people (A.1.5, §12.4): their id and name are fixed. */
  pinned: { id: string; name: string } | null;
  employment: Employment;
  /** A.1.4's row, the job's title and where it is (`home.own` works from home, `offmap.city` commutes). */
  job: { row: number; title: string; workplace: string } | null;
  /** Teens only: a Saturday job's place (A.1.4). */
  saturday_job: string | null;
  minor: "under_five" | "pupil" | "teen" | null;
  /** Years lived in Monde; equal to the age: born here. */
  years_in_monde: number;
  /** Six first names to choose from (anonymous people), and the surname the skeleton gave them. */
  first_names: string[];
  surname: string;
  birthday: number | null;
  /** What the pins say about them: a §12.4 hook and voice, or a slot's note. */
  seed: string | null;
}

/** Someone in the household whose card already exists (the core cast and the carded people): not written, but there. */
export interface NativeHousemate {
  slot: string;
  id: string;
  name: string;
  role: string;
  pronouns: string;
  age: number;
  line: string;
}

export interface NativeHouseholdFacts {
  type: HouseholdType;
  zone: CensusZone;
  /** The real home (A.1.3, content/places/homes.yaml): its id, its address line and its beds. */
  home: { id: string; line: string; beds: number };
  surname: string | null;
  housemates: NativeHousemate[];
  /** Kin words the pins give for ties inside the household (twins, cousins), by slot. */
  ties: { a: string; b: string; word: string }[];
}

export const NativeMemberFactsSchema = z.object({
  kind: z.enum(["named", "anonymous"]),
  pinned: z.object({ id: ResidentId, name: Short(60) }).strict().nullable(),
  employment: z.enum(EMPLOYMENT),
  job: z.object({ row: z.number().int().min(1).max(24), title: Short(60), workplace: Place }).strict().nullable(),
  saturday_job: PlaceId.nullable(),
  minor: z.enum(["under_five", "pupil", "teen"]).nullable(),
  years_in_monde: z.number().int().min(0).max(110),
  first_names: z.array(Short(30)).max(8),
  surname: Short(40),
  birthday: z.number().int().min(1).max(100).nullable(),
  seed: Short(600).nullable(),
}).strict();

export const NativeHouseholdFactsSchema = z.object({
  type: z.enum(HOUSEHOLD_TYPES),
  zone: z.enum(CENSUS_ZONES),
  home: z.object({ id: PlaceId, line: Short(120), beds: z.number().int().min(1).max(6) }).strict(),
  surname: Short(40).nullable(),
  housemates: z.array(z.object({
    slot: Short(4), id: ResidentId, name: Short(60), role: Short(20), pronouns: Short(20), age: z.number().int().min(0).max(110), line: Short(160),
  }).strict()).max(5),
  ties: z.array(z.object({ a: z.string().regex(/^m\d$/), b: z.string().regex(/^m\d$/), word: z.string().regex(/^[a-z_]{2,20}$/) }).strict()).max(10),
}).strict();

export const MEMBER_ROLES = ["adult", "partner", "child", "grandparent", "adult_child", "sibling", "flatmate", "parent"] as const;

/** A native household as the census endpoint accepts it: A.3.1's draw plus the skeleton's facts. */
export const NativeDrawSchema = z.object({
  id: ResidentId,
  archetype: z.enum(ARCHETYPE_IDS),
  day: z.literal(1),
  slot: z.number().int().min(0).max(1000),
  youth: z.boolean(),
  beds: z.number().int().min(1).max(6),
  prob: z.number().min(0).max(1),
  members: z.array(z.object({
    slot: z.string().regex(/^m\d$/),
    role: z.enum(MEMBER_ROLES),
    age_min: z.number().int().min(0).max(110),
    age_max: z.number().int().min(0).max(110),
    age: z.number().int().min(0).max(110),
    band: z.enum(AGE_BANDS),
    presentation: z.enum(["f", "m", "a"]),
    pronoun_default: z.enum(["she/her", "he/him", "they/them"]),
    portrait: z.string().regex(/^[a-z][a-z0-9_]*$/).max(40),
    tags: PortraitTagsSchema,
    look: CardHumanLook.optional(),
    archetype: z.enum(ARCHETYPE_IDS),
    native: NativeMemberFactsSchema,
  }).strict()).min(1).max(6),
  native: NativeHouseholdFactsSchema,
}).strict();
