// The 2026-11-05 trim (Kasey: "Monde should feel like a town with people but not overcrowdedness"). Pure.
//
// The Day-1 census was generated at 210 (A.1 as first written) and its cards written from that skeleton. Twenty
// residents were then taken out: retired elders with no portrait of their own (procedural looks), ten living alone and
// three couples in Millbrook, two living alone and one couple on Station Hill, the two zones the player can't walk in
// Spring. Nobody with a job, a child, a card of their own, a library portrait, a tie or a line in any scene. Their 16
// homes stand empty now, under new vacant numbers (62–77), and the census reads 190.
//
// The generator still builds the town as it first did (its seed reproduces the 188 cards' skeleton), so the trim is a
// last step after it rather than a change to its inputs:
//   - homesAsGenerated(homes) gives back each trimmed home its old id, in place, so the generator sees homes.yaml as it was;
//   - GENERATION_TARGETS are A.1's tables (day1Tables.ts, now the 190) with the trimmed households added back;
//   - trimSkeleton(sk) takes the 16 households out (and checks each is the household the trim meant).
// day1Skeleton() is the three together: what content/census/day1.yaml holds.
import type { ArchetypeId } from "../arrivals/archetypes";
import type { AgeBand } from "../arrivals/library";
import {
  ARCHETYPE_QUOTAS, BAND_TABLE, CENSUS_BANDS, HOMES_BY_ZONE, HOUSEHOLDS, STATUS_TABLE, TYPES_BY_ZONE, bandIndex,
  type CensusZone, type HouseholdType,
} from "./day1Tables";
import type { HomeEntry, HomeRegistry } from "./homes";
import type { Day1Skeleton } from "./skeleton";

export interface TrimEntry {
  /** The household's skeleton id. */
  household: string;
  type: Extract<HouseholdType, "A" | "B">;
  zone: CensusZone;
  archetype: ArchetypeId;
  /** Its members, every one a retired elder. */
  people: 1 | 2;
  /** The home it had (its id in the generated skeleton). */
  home: string;
  /** The home's id now it stands empty (homes.yaml, places.yaml). */
  vacant: string;
}

export const CENSUS_TRIM: readonly TrimEntry[] = [
  { household: "mb_a01", type: "A", zone: "millbrook", archetype: "radio_tinkerer", people: 1, home: "millbrook.home_40", vacant: "millbrook.vacant_house_62" },
  { household: "mb_a02", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_03", vacant: "millbrook.vacant_house_63" },
  { household: "mb_a05", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_17", vacant: "millbrook.vacant_house_64" },
  { household: "mb_a06", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_30", vacant: "millbrook.vacant_house_65" },
  { household: "mb_a07", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_12", vacant: "millbrook.vacant_house_66" },
  { household: "mb_a08", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_20", vacant: "millbrook.vacant_house_67" },
  { household: "mb_a09", type: "A", zone: "millbrook", archetype: "retired_organizer", people: 1, home: "millbrook.home_15", vacant: "millbrook.vacant_house_68" },
  { household: "mb_a10", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_04", vacant: "millbrook.vacant_house_69" },
  { household: "mb_a11", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_31", vacant: "millbrook.vacant_house_70" },
  { household: "mb_a12", type: "A", zone: "millbrook", archetype: "widowed_elder", people: 1, home: "millbrook.home_18", vacant: "millbrook.vacant_house_71" },
  { household: "mb_b02", type: "B", zone: "millbrook", archetype: "retired_couple", people: 2, home: "millbrook.home_14", vacant: "millbrook.vacant_house_72" },
  { household: "mb_b06", type: "B", zone: "millbrook", archetype: "retired_couple", people: 2, home: "millbrook.home_11", vacant: "millbrook.vacant_house_73" },
  { household: "mb_b07", type: "B", zone: "millbrook", archetype: "retired_couple", people: 2, home: "millbrook.home_22", vacant: "millbrook.vacant_house_74" },
  { household: "sh_a01", type: "A", zone: "station_hill", archetype: "widowed_elder", people: 1, home: "station_hill.home_01", vacant: "station_hill.vacant_house_75" },
  { household: "sh_a02", type: "A", zone: "station_hill", archetype: "widowed_elder", people: 1, home: "station_hill.home_04", vacant: "station_hill.vacant_house_76" },
  { household: "sh_b01", type: "B", zone: "station_hill", archetype: "retired_couple", people: 2, home: "station_hill.home_02", vacant: "station_hill.vacant_house_77" },
];

/** The residents the trim took out. */
export const TRIMMED_RESIDENTS = CENSUS_TRIM.reduce((n, t) => n + t.people, 0);

// ── The targets ─────────────────────────────────────────────────────────────

type Triple = readonly [number, number, number];
type Quota = readonly [number, number, number, number, number];

/** What a skeleton is checked against (report.ts censusMismatches): A.1's tables, or the generator's. */
export interface CensusTargets {
  households: number;
  bands: Readonly<Record<AgeBand, { core: number; generated: number }>>;
  types: Readonly<Record<HouseholdType, Readonly<Partial<Record<CensusZone, number>>>>>;
  homes: Readonly<Record<CensusZone, { households: number; residents: number; vacant: number; total: number }>>;
  statuses: Readonly<Record<keyof typeof STATUS_TABLE, Triple>>;
  archetypes: Readonly<Record<ArchetypeId, Quota>>;
}

/** A.1 as it stands: the Day-1 town of 190 (content/census/day1.yaml). */
export const DAY1_TARGETS: CensusTargets = {
  households: HOUSEHOLDS, bands: BAND_TABLE, types: TYPES_BY_ZONE, homes: HOMES_BY_ZONE, statuses: STATUS_TABLE, archetypes: ARCHETYPE_QUOTAS,
};

/** A.1 with the trimmed households added back: what buildSkeleton generates (210 in 123 households). */
export const GENERATION_TARGETS: CensusTargets = (() => {
  const elder = bandIndex("elder");
  const bands = Object.fromEntries(CENSUS_BANDS.map(b => [b, { ...BAND_TABLE[b] }])) as Record<AgeBand, { core: number; generated: number }>;
  const types = Object.fromEntries(Object.entries(TYPES_BY_ZONE).map(([k, v]) => [k, { ...v }])) as Record<HouseholdType, Partial<Record<CensusZone, number>>>;
  const homes = Object.fromEntries(Object.entries(HOMES_BY_ZONE).map(([z, v]) => [z, { ...v }])) as Record<CensusZone, { households: number; residents: number; vacant: number; total: number }>;
  const retired: [number, number, number] = [...STATUS_TABLE.retired];
  const archetypes = Object.fromEntries(Object.entries(ARCHETYPE_QUOTAS).map(([a, q]) => [a, [...q]])) as Record<ArchetypeId, [number, number, number, number, number]>;
  for (const t of CENSUS_TRIM) {
    bands.elder.generated += t.people;
    types[t.type][t.zone] = (types[t.type][t.zone] ?? 0) + 1;
    homes[t.zone].households += 1;
    homes[t.zone].residents += t.people;
    homes[t.zone].vacant -= 1;
    retired[2] += t.people;
    archetypes[t.archetype][elder] += t.people;
  }
  return { households: HOUSEHOLDS + CENSUS_TRIM.length, bands, types, homes, statuses: { ...STATUS_TABLE, retired }, archetypes };
})();

// ── The homes and the skeleton ──────────────────────────────────────────────

/** homes.yaml as the generator first saw it: every trimmed home under its old id, in its place in the file. */
export function homesAsGenerated(homes: HomeRegistry): HomeRegistry {
  const back = new Map(CENSUS_TRIM.map(t => [t.vacant, t.home]));
  return new Map<string, HomeEntry>([...homes].map(([id, entry]) => [back.get(id) ?? id, entry]));
}

/** The generated skeleton less the trimmed households (and any link to their members). Throws if one isn't as listed. */
export function trimSkeleton(sk: Day1Skeleton): Day1Skeleton {
  const byId = new Map(sk.households.map(h => [h.id, h]));
  const gone = new Set<string>();
  for (const t of CENSUS_TRIM) {
    const h = byId.get(t.household);
    const ok = h && h.type === t.type && h.zone === t.zone && h.home === t.home && h.archetype === t.archetype && h.members.length === t.people
      && h.members.every(m => m.band === "elder" && m.employment === "retired" && m.portrait.source === "procedural");
    if (!ok) throw new Error(`census trim: ${t.household} isn't the ${t.type} household of ${t.people} retired ${t.archetype} elder(s) at ${t.home}`);
    // Before the cards are written an anonymous member has no id yet, and no link can name them.
    for (const m of h.members) if (m.id) gone.add(m.id);
  }
  const drop = new Set(CENSUS_TRIM.map(t => t.household));
  return {
    ...sk,
    households: sk.households.filter(h => !drop.has(h.id)),
    links: sk.links.filter(l => !gone.has(l.a) && !gone.has(l.b)),
  };
}
