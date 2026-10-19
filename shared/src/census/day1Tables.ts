// The Day-1 census (GDD Appendix A.1, 210 homed residents in 123 households) as data, so the skeleton generator
// (skeleton.ts) can build to it and the report (report.ts) can check a frozen skeleton against it. Pure data.
//
// Every number here is A.1's. Where a table leaves something to arithmetic (how the eight people of type M split, which
// minors live in which household type), the derivation is written next to it.
import type { ArchetypeId } from "../arrivals/archetypes";
import type { AgeBand } from "../arrivals/library";

/** The zones with homes (A.1.3; Briar Woods has none). */
export const CENSUS_ZONES = ["millbrook", "old_quarter", "market_row", "wharf", "station_hill", "commons"] as const;
export type CensusZone = (typeof CENSUS_ZONES)[number];
/** The four Spring boards (§16.4.1): the zones the player can walk on Day 1. */
export const OPEN_BOARDS: readonly CensusZone[] = ["old_quarter", "market_row", "wharf", "commons"];

export const CENSUS_BANDS: readonly AgeBand[] = ["child", "teen", "young_adult", "adult", "elder"];
/** The adult bands (A.1.4's columns). */
export const ADULT_BANDS = ["young_adult", "adult", "elder"] as const;
export type AdultBand = (typeof ADULT_BANDS)[number];

// ── A.1.1 Age bands ─────────────────────────────────────────────────────────

/** Core and generated residents per band (A.1.1). */
export const BAND_TABLE: Readonly<Record<AgeBand, { core: number; generated: number }>> = {
  child: { core: 1, generated: 13 },
  teen: { core: 0, generated: 9 },
  young_adult: { core: 6, generated: 21 },
  adult: { core: 6, generated: 68 },
  elder: { core: 5, generated: 81 },
};
export const HOMED = 210;
export const GENERATED = 192;

/** "The nine pupils are aged 5, 7, 7, 8, 9, 10, 10, 11 (tib) and 12." */
export const PUPIL_AGES: readonly number[] = [5, 7, 7, 8, 9, 10, 10, 11, 12];
export const UNDER_FIVE_AGES: readonly [number, number] = [0, 4];
export const PUPIL_RANGE: readonly [number, number] = [5, 12];
export const TEEN_RANGE: readonly [number, number] = [13, 17];

export type MinorKind = "under_five" | "pupil" | "teen";
/** A.1.1 "Where the minors live". */
export const MINORS_BY_ZONE: Readonly<Record<CensusZone, Readonly<Record<MinorKind, number>>>> = {
  millbrook: { under_five: 2, pupil: 4, teen: 6 },
  old_quarter: { under_five: 0, pupil: 1, teen: 0 },
  market_row: { under_five: 2, pupil: 0, teen: 0 },
  wharf: { under_five: 1, pupil: 4, teen: 1 },
  station_hill: { under_five: 0, pupil: 0, teen: 2 },
  commons: { under_five: 0, pupil: 0, teen: 0 },
};
/** A.1.4: "Teens in lessons (four have Saturday jobs)". */
export const TEEN_SATURDAY_JOBS = 4;

// ── A.1.2 Households ────────────────────────────────────────────────────────

export const HOUSEHOLD_TYPES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"] as const;
export type HouseholdType = (typeof HOUSEHOLD_TYPES)[number];

export type CensusRole = "adult" | "partner" | "sibling" | "flatmate" | "child" | "grandparent" | "parent";
/** A member slot of a household type: its role and band, or the kind of minor (pupil or teen is decided later). */
export interface RoleSlot {
  role: CensusRole;
  band: AgeBand | "minor";
  /** Minors only: an under-five is fixed by the type; any other minor is a pupil or a teen. */
  minor?: "under_five" | "school_age";
}

const slot = (role: CensusRole, band: AgeBand): RoleSlot => ({ role, band });
const u5: RoleSlot = { role: "child", band: "minor", minor: "under_five" };
const minor: RoleSlot = { role: "child", band: "minor", minor: "school_age" };

/**
 * A.1.2's types as member slots. The first slot is the household's head (A.3.6 slot m1). M's minors depend on the zone:
 * A.1.2 gives type M 3 households and 8 people (so 5 minors), and A.1.1's minors table then fixes them. The Old Quarter's
 * is Ada and Tib. In Millbrook and on the Wharf the J/K/L/N rows already place the other minors, so the remainder falls
 * to M: Millbrook's 12 minors less J's 2 under-fives, L's 2 and N's 6 leaves 2; the Wharf's 6 less L's 2 and N's 2
 * leaves 2, and one is the Wharf's under-five (J and K are on Market Row and in Millbrook; school_family children are
 * 5–17, A.3.3, so it isn't in L or N).
 */
export const HOUSEHOLD_SHAPES: Readonly<Record<HouseholdType, { label: string; slots: readonly RoleSlot[] }>> = {
  A: { label: "Elder living alone", slots: [slot("adult", "elder")] },
  B: { label: "Elder couple", slots: [slot("adult", "elder"), slot("partner", "elder")] },
  C: { label: "Adult + elder partner", slots: [slot("adult", "adult"), slot("partner", "elder")] },
  D: { label: "Adult living alone", slots: [slot("adult", "adult")] },
  E: { label: "Adult couple, no children at home", slots: [slot("adult", "adult"), slot("partner", "adult")] },
  F: { label: "Adult siblings sharing", slots: [slot("adult", "adult"), slot("sibling", "adult")] },
  G: { label: "Young adult living alone", slots: [slot("adult", "young_adult")] },
  H: { label: "Young adults sharing (3 each)", slots: [slot("adult", "young_adult"), slot("flatmate", "young_adult"), slot("flatmate", "young_adult")] },
  I: { label: "Young couple, no children", slots: [slot("adult", "young_adult"), slot("partner", "young_adult")] },
  J: { label: "Young family (couple + child under 5)", slots: [slot("adult", "young_adult"), slot("partner", "young_adult"), u5] },
  K: { label: "Young single parent + child under 5", slots: [slot("adult", "young_adult"), u5] },
  L: { label: "Couple + two children or teens", slots: [slot("adult", "adult"), slot("partner", "adult"), minor, minor] },
  M: { label: "Single parent + children", slots: [slot("adult", "adult"), minor, minor] },
  N: { label: "Three generations (elder + 2 adults + 2 minors)", slots: [slot("adult", "adult"), slot("partner", "adult"), slot("grandparent", "elder"), minor, minor] },
  O: { label: "Young adult carer + elder parent or grandparent", slots: [slot("adult", "young_adult"), slot("parent", "elder")] },
  P: { label: "Adult + elder parent", slots: [slot("adult", "adult"), slot("parent", "elder")] },
};
/** M's minors by zone (the derivation is on HOUSEHOLD_SHAPES). */
export const M_MINORS: Readonly<Partial<Record<CensusZone, readonly RoleSlot[]>>> = {
  millbrook: [minor, minor],
  old_quarter: [minor],
  wharf: [u5, minor],
};

/** A.1.2: households of each type by zone. */
export const TYPES_BY_ZONE: Readonly<Record<HouseholdType, Readonly<Partial<Record<CensusZone, number>>>>> = {
  A: { millbrook: 12, old_quarter: 10, market_row: 4, wharf: 5, station_hill: 4, commons: 1 },
  B: { millbrook: 7, old_quarter: 5, market_row: 2, wharf: 2, station_hill: 1, commons: 1 },
  C: { millbrook: 2, old_quarter: 2, market_row: 1, wharf: 1 },
  D: { millbrook: 6, old_quarter: 5, market_row: 5, wharf: 3, station_hill: 1 },
  E: { millbrook: 5, old_quarter: 2, market_row: 2, wharf: 3, station_hill: 1 },
  F: { old_quarter: 1, market_row: 1 },
  G: { millbrook: 1, old_quarter: 1, market_row: 1, wharf: 1, commons: 1 },
  H: { market_row: 1, wharf: 1 },
  I: { millbrook: 2, old_quarter: 1 },
  J: { millbrook: 2, market_row: 1 },
  K: { market_row: 1 },
  L: { millbrook: 1, wharf: 1, station_hill: 1 },
  M: { millbrook: 1, old_quarter: 1, wharf: 1 },
  N: { millbrook: 3, wharf: 1 },
  O: { millbrook: 3 },
  P: { old_quarter: 1 },
};
export const HOUSEHOLDS = 123;

/** The slots of one household of a type in a zone. */
export const shapeOf = (type: HouseholdType, zone: CensusZone): readonly RoleSlot[] =>
  type === "M" ? [HOUSEHOLD_SHAPES.M.slots[0]!, ...(M_MINORS[zone] ?? [])] : HOUSEHOLD_SHAPES[type].slots;

// ── A.1.3 Where they live ───────────────────────────────────────────────────

export const HOMES_BY_ZONE: Readonly<Record<CensusZone, { households: number; residents: number; vacant: number; total: number }>> = {
  millbrook: { households: 45, residents: 85, vacant: 38, total: 83 },
  old_quarter: { households: 29, residents: 42, vacant: 9, total: 38 },
  wharf: { households: 19, residents: 36, vacant: 8, total: 27 },
  market_row: { households: 19, residents: 30, vacant: 0, total: 19 },
  station_hill: { households: 8, residents: 13, vacant: 6, total: 14 },
  commons: { households: 3, residents: 4, vacant: 0, total: 3 },
};
export const HOMES_TOTAL = 184;

// ── A.1.4 Occupations ───────────────────────────────────────────────────────

export interface JobRow {
  row: number;
  workplace: string;
  /**
   * Where the job is done (§9.5 ids; `home.own` works from home): one per title when the lengths match, else in turn
   * by job (row 20's two watchmen: the mill, then the cannery).
   */
  places: readonly string[];
  /** Young adults, adults, elders. */
  bands: readonly [number, number, number];
  /** What the jobs are called, in A.1.4's words, in turn by job (row 1 lists all six). */
  titles: readonly string[];
  /**
   * Engine addition: the archetypes the skeleton prefers for the row's jobs (A.2's "Work" lines). Anyone of the band
   * can still take one.
   */
  prefer: readonly ArchetypeId[];
}

/** A.1.4's 24 rows: 90 jobs, 20 / 49 / 21 by band. */
export const JOB_ROWS: readonly JobRow[] = [
  { row: 1, workplace: "Town Hall, constabulary, St. Brigid's", places: ["old_quarter.mayor_office", "old_quarter.town_hall", "old_quarter.town_hall", "old_quarter.town_hall", "old_quarter.constabulary", "old_quarter.st_brigids"], bands: [0, 2, 4], titles: ["mayor", "clerk", "clerk", "caretaker", "constable", "sexton"], prefer: ["retired_organizer", "widowed_elder", "school_family", "mill_hand"] },
  { row: 2, workplace: "Library and The Lantern", places: ["old_quarter.library", "old_quarter.lantern_office"], bands: [1, 1, 0], titles: ["librarian", "editor"], prefer: [] },
  { row: 3, workplace: "Millbrook School", places: ["millbrook.school"], bands: [0, 2, 0], titles: ["teacher", "cook-caretaker"], prefer: ["cook_baker", "school_family", "single_parent"] },
  { row: 4, workplace: "Fournier & Fille", places: ["market_row.bakery"], bands: [0, 1, 1], titles: ["baker"], prefer: ["cook_baker"] },
  { row: 5, workplace: "Dunmore's General Store", places: ["market_row.general_store"], bands: [1, 1, 0], titles: ["counter hand"], prefer: ["shop_founder", "young_family", "young_creative"] },
  { row: 6, workplace: "The Gull & Anchor", places: ["market_row.gull_and_anchor"], bands: [1, 2, 0], titles: ["bar and kitchen hand"], prefer: ["cook_baker", "young_creative", "single_parent", "drifter"] },
  { row: 7, workplace: "Café Liss", places: ["market_row.cafe_liss"], bands: [1, 2, 0], titles: ["café hand"], prefer: ["cook_baker", "single_parent", "young_creative", "shop_founder"] },
  { row: 8, workplace: "Fish market", places: ["wharf.fish_market"], bands: [1, 2, 1], titles: ["fish-market hand"], prefer: ["fisher"] },
  { row: 9, workplace: "Fishing boats (nine boats, thirteen crew)", places: ["wharf.harbor_steps"], bands: [2, 7, 4], titles: ["fishing-boat crew"], prefer: ["fisher", "retired_keeper"] },
  { row: 10, workplace: "Ferry Gannet and ticket booth", places: ["wharf.ferry_slip", "wharf.ticket_booth"], bands: [1, 1, 1], titles: ["ferry deckhand"], prefer: ["fisher", "young_family", "drifter"] },
  { row: 11, workplace: "Boathouse and boat repair", places: ["wharf.boathouse"], bands: [0, 1, 1], titles: ["boat repairer"], prefer: ["builder", "fisher", "mill_hand"] },
  { row: 12, workplace: "Wolanski carpentry", places: ["millbrook.kasimir_workshop"], bands: [0, 1, 0], titles: ["carpenter"], prefer: [] },
  { row: 13, workplace: "Delphine's alterations, from home", places: ["millbrook.mercer_house"], bands: [0, 0, 1], titles: ["seamstress"], prefer: [] },
  { row: 14, workplace: "Glasshouse and Commons grounds", places: ["commons.glasshouse"], bands: [1, 0, 1], titles: ["groundskeeper"], prefer: ["market_gardener", "retired_couple", "widowed_elder"] },
  // The post round meets each sailing and sorts the sacks on the slip; the booth is Ada's (census review 2026-10-19).
  { row: 15, workplace: "Post round and haulage", places: ["wharf.ferry_slip", "wharf.crane_yard"], bands: [0, 4, 0], titles: ["post round", "haulier"], prefer: ["school_family", "mill_hand", "single_parent", "shop_founder"] },
  { row: 16, workplace: "Building trades", places: ["home.own"], bands: [0, 4, 1], titles: ["plumber", "electrician", "roofer", "mason", "mason"], prefer: ["builder"] },
  { row: 17, workplace: "Home-based makers", places: ["home.own"], bands: [0, 2, 2], titles: ["potter", "weaver", "model-boat builder", "binder"], prefer: ["remote_craftsperson"] },
  { row: 18, workplace: "Market-day stallholders (Saturdays)", places: ["market_row.market_hall", "market_row.market_street"], bands: [0, 2, 2], titles: ["stallholder"], prefer: ["market_gardener", "cartographer", "cook_baker", "remote_craftsperson", "retired_couple"] },
  { row: 19, workplace: "Casual labour (odd jobs, net mending, harvest)", places: ["home.own", "wharf.harbor_steps", "commons.community_garden"], bands: [0, 5, 0], titles: ["odd jobs", "net mending", "harvest hand"], prefer: ["mill_hand", "fisher", "drifter"] },
  { row: 20, workplace: "Night watch at the mill and cannery", places: ["millbrook.mill", "wharf.cannery"], bands: [0, 0, 2], titles: ["night watchman"], prefer: ["mill_hand", "retired_keeper"] },
  { row: 21, workplace: "Home nursing, unpaid house calls", places: ["millbrook.clinic"], bands: [1, 0, 0], titles: ["home nurse"], prefer: [] },
  { row: 22, workplace: "Vane Consolidated Field Office", places: ["wharf.vane_office"], bands: [1, 0, 0], titles: ["office assistant"], prefer: [] },
  { row: 23, workplace: "Tollmen, paid off the books by Greyline", places: ["briar_woods.tollmen_hideout"], bands: [6, 0, 0], titles: ["Tollman"], prefer: [] },
  { row: 24, workplace: "Weekly commuters, away Tue–Fri", places: ["offmap.city"], bands: [3, 9, 0], titles: ["works in Carrow", "works in Hessle Cross"], prefer: ["school_family", "young_family", "shop_founder", "young_creative", "mill_hand"] },
];
export const JOB_ROW_BY_NUMBER: ReadonlyMap<number, JobRow> = new Map(JOB_ROWS.map(r => [r.row, r]));
/** Row 24's people are away Tue–Fri (A.6 open question 4). */
export const COMMUTER_ROW = 24;
export const TOLLMEN_ROW = 23;
/**
 * D1 (Kasey, M-03): the public-facing workplaces on the open boards (shops, pub, café, fish market, ferry and ticket
 * booth, boathouse, harbour boats, library, Town Hall, chapel, market stall).
 */
export const PUBLIC_ROWS: ReadonlySet<number> = new Set([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 18]);

export const EMPLOYMENT = ["employed", "out_of_work", "carer", "retired", "unable", "pupil", "lessons", "under_five"] as const;
export type Employment = (typeof EMPLOYMENT)[number];
/** A.1.4's status table for the 187 aged 18+: young adults, adults, elders. */
export const STATUS_TABLE: Readonly<Record<"employed" | "out_of_work" | "carer" | "retired" | "unable", readonly [number, number, number]>> = {
  employed: [20, 49, 21],
  out_of_work: [4, 9, 0],
  carer: [3, 5, 0],
  retired: [0, 0, 65],
  unable: [0, 11, 0],
};
/** "Mill hands (18) … nine of them are the unemployed adults in A.1.4" (A.1.5). */
export const OUT_OF_WORK_MILL_HANDS = 9;

/**
 * The core cast's places in A.1.4 (their cards' workplaces; rows 21–23 name them). Hollis and Bertrand are the two
 * retired core elders (A.1.4 counts 21 employed elders, and rows 1, 4, 13 hold Pell, Odile and Delphine); Tib is a pupil.
 */
export const CORE_JOBS: Readonly<Record<string, { row: number; title: string; workplace: string } | "retired" | "pupil">> = {
  pell: { row: 1, title: "mayor", workplace: "old_quarter.mayor_office" },
  augusta: { row: 1, title: "constable", workplace: "old_quarter.constabulary" },
  margo: { row: 2, title: "librarian", workplace: "old_quarter.library" },
  sable: { row: 2, title: "editor", workplace: "old_quarter.lantern_office" },
  felix: { row: 3, title: "teacher", workplace: "millbrook.school" },
  odile: { row: 4, title: "baker", workplace: "market_row.bakery" },
  rosalind: { row: 6, title: "landlady", workplace: "market_row.gull_and_anchor" },
  june: { row: 7, title: "barista", workplace: "market_row.cafe_liss" },
  nell: { row: 8, title: "fish-market owner", workplace: "wharf.fish_market" },
  kasimir: { row: 12, title: "carpenter", workplace: "millbrook.kasimir_workshop" },
  delphine: { row: 13, title: "seamstress", workplace: "millbrook.mercer_house" },
  teo: { row: 14, title: "groundskeeper", workplace: "commons.glasshouse" },
  priya: { row: 21, title: "home nurse", workplace: "millbrook.clinic" },
  ines: { row: 22, title: "office assistant", workplace: "wharf.vane_office" },
  rook: { row: 23, title: "Tollman", workplace: "briar_woods.tollmen_hideout" },
  hollis: "retired",
  bertrand: "retired",
  tib: "pupil",
};
/** The core cast with a bed in Monde (A.1: 20 core less vane and bastien). */
export const CORE_HOMED: readonly string[] = Object.keys(CORE_JOBS);

// ── A.1.5 How the 192 were generated ────────────────────────────────────────

/** People per archetype by band among the 192: children, teens, young adults, adults, elders. */
export const ARCHETYPE_QUOTAS: Readonly<Record<ArchetypeId, readonly [number, number, number, number, number]>> = {
  young_family: [3, 0, 6, 0, 0],
  school_family: [6, 5, 0, 14, 4],
  single_parent: [4, 1, 1, 3, 0],
  young_creative: [0, 0, 3, 0, 0],
  apprentice: [0, 3, 1, 0, 0],
  drifter: [0, 0, 5, 0, 0],
  remote_craftsperson: [0, 0, 1, 3, 2],
  shop_founder: [0, 0, 1, 5, 0],
  cook_baker: [0, 0, 1, 4, 0],
  builder: [0, 0, 0, 4, 1],
  fisher: [0, 0, 2, 9, 4],
  market_gardener: [0, 0, 0, 3, 0],
  mill_hand: [0, 0, 0, 13, 5],
  clinician: [0, 0, 0, 0, 0],
  schoolteacher: [0, 0, 0, 0, 0],
  retired_couple: [0, 0, 0, 4, 30],
  widowed_elder: [0, 0, 0, 0, 22],
  retired_keeper: [0, 0, 0, 0, 3],
  retired_organizer: [0, 0, 0, 2, 5],
  returnee: [0, 0, 0, 0, 0],
  birdwatcher: [0, 0, 0, 1, 1],
  retired_magician: [0, 0, 0, 0, 1],
  cartographer: [0, 0, 0, 1, 1],
  radio_tinkerer: [0, 0, 0, 2, 2],
};
export const bandIndex = (band: AgeBand): number => CENSUS_BANDS.indexOf(band);

/**
 * Archetype identities by household type: A.1.5's quotas close only this way. young_family is the three J households
 * (6 young adults, 3 under-fives); single_parent is K and the three M (Ada's included); school_family is L and N (14
 * adults, 4 grandparents, 11 children and teens), the other three minors there being the teen apprentices.
 */
export const TYPE_IDENTITY: Readonly<Partial<Record<HouseholdType, ArchetypeId>>> = {
  J: "young_family", K: "single_parent", M: "single_parent", L: "school_family", N: "school_family",
};

/** A row's jobs, one by one: title and place (JobRow.titles and .places in turn). */
export function rowJobs(row: JobRow): { title: string; place: string }[] {
  const n = row.bands[0] + row.bands[1] + row.bands[2];
  const aligned = row.places.length === row.titles.length;
  return Array.from({ length: n }, (_, i) => {
    const t = i % row.titles.length;
    return { title: row.titles[t]!, place: aligned ? row.places[t]! : row.places[i % row.places.length]! };
  });
}
