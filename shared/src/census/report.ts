// Every Appendix A.1 table, recomputed from a frozen skeleton (content/census/day1.yaml), and checked against A.1's own
// numbers (day1Tables.ts). tools/census.ts prints it; census.test.ts asserts it closes. Pure.
import { ARCHETYPE_IDS, type ArchetypeId } from "../arrivals/archetypes";
import type { AgeBand } from "../arrivals/library";
import {
  ARCHETYPE_QUOTAS, CENSUS_BANDS, BAND_TABLE, CENSUS_ZONES, COMMUTER_ROW, HOMES_BY_ZONE, HOUSEHOLDS, HOUSEHOLD_TYPES, JOB_ROWS, MINORS_BY_ZONE,
  PUPIL_AGES, STATUS_TABLE, TEEN_SATURDAY_JOBS, TYPES_BY_ZONE, bandIndex, type CensusZone, type HouseholdType, type MinorKind,
} from "./day1Tables";
import { homeZone, isVacantHome, type HomeRegistry } from "./homes";
import type { Day1Skeleton } from "./skeleton";

type Triple = [number, number, number];
const ADULT: Readonly<Partial<Record<AgeBand, number>>> = { young_adult: 0, adult: 1, elder: 2 };

export interface CensusTables {
  bands: Record<AgeBand, { core: number; generated: number }>;
  minors: Record<CensusZone, Record<MinorKind, number>>;
  pupilAges: number[];
  types: Record<HouseholdType, Partial<Record<CensusZone, number>>>;
  homes: Record<CensusZone, { households: number; residents: number; vacant: number; total: number }>;
  jobs: Record<number, Triple>;
  statuses: Record<keyof typeof STATUS_TABLE, Triple>;
  saturdayJobs: number;
  archetypes: Record<ArchetypeId, [number, number, number, number, number]>;
  households: number;
  homed: number;
}

export function censusTables(sk: Day1Skeleton, homes: HomeRegistry): CensusTables {
  const t: CensusTables = {
    bands: Object.fromEntries(CENSUS_BANDS.map(b => [b, { core: 0, generated: 0 }])) as CensusTables["bands"],
    minors: Object.fromEntries(CENSUS_ZONES.map(z => [z, { under_five: 0, pupil: 0, teen: 0 }])) as CensusTables["minors"],
    pupilAges: [],
    types: Object.fromEntries(HOUSEHOLD_TYPES.map(k => [k, {}])) as CensusTables["types"],
    homes: Object.fromEntries(CENSUS_ZONES.map(z => [z, { households: 0, residents: 0, vacant: 0, total: 0 }])) as CensusTables["homes"],
    jobs: Object.fromEntries(JOB_ROWS.map(r => [r.row, [0, 0, 0]])),
    statuses: { employed: [0, 0, 0], out_of_work: [0, 0, 0], carer: [0, 0, 0], retired: [0, 0, 0], unable: [0, 0, 0] },
    saturdayJobs: 0,
    archetypes: Object.fromEntries(ARCHETYPE_IDS.map(a => [a, [0, 0, 0, 0, 0]])) as CensusTables["archetypes"],
    households: sk.households.length,
    homed: 0,
  };
  for (const h of sk.households) {
    t.types[h.type][h.zone] = (t.types[h.type][h.zone] ?? 0) + 1;
    t.homes[h.zone].households++;
    for (const m of h.members) {
      t.homed++;
      t.homes[h.zone].residents++;
      t.bands[m.band][m.kind === "core" ? "core" : "generated"]++;
      if (m.minor) t.minors[h.zone][m.minor]++;
      if (m.minor === "pupil") t.pupilAges.push(m.age);
      if (m.saturday_job) t.saturdayJobs++;
      if (m.kind !== "core" && m.archetype) t.archetypes[m.archetype][bandIndex(m.band)]++;
      const bi = ADULT[m.band];
      if (bi === undefined) continue;
      if (m.job) t.jobs[m.job.row]![bi]++;
      if (m.employment in t.statuses) t.statuses[m.employment as keyof CensusTables["statuses"]][bi]++;
    }
  }
  t.pupilAges.sort((a, b) => a - b);
  for (const id of homes.keys()) {
    const z = homeZone(id) as CensusZone;
    if (!t.homes[z]) continue;
    t.homes[z].total++;
    if (isVacantHome(id)) t.homes[z].vacant++;
  }
  return t;
}

/** Everything that doesn't match A.1 (empty when every table closes). */
export function censusMismatches(t: CensusTables): string[] {
  const out: string[] = [];
  const eq = (what: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${what}: ${JSON.stringify(got)}, A.1 says ${JSON.stringify(want)}`); };
  eq("households", t.households, HOUSEHOLDS);
  for (const b of CENSUS_BANDS) eq(`A.1.1 ${b}`, t.bands[b], BAND_TABLE[b]);
  for (const z of CENSUS_ZONES) eq(`A.1.1 minors in ${z}`, t.minors[z], MINORS_BY_ZONE[z]);
  eq("A.1.1 pupil ages", t.pupilAges, PUPIL_AGES);
  for (const k of HOUSEHOLD_TYPES) for (const z of CENSUS_ZONES) eq(`A.1.2 type ${k} in ${z}`, t.types[k][z] ?? 0, TYPES_BY_ZONE[k][z] ?? 0);
  for (const z of CENSUS_ZONES) eq(`A.1.3 ${z}`, t.homes[z], HOMES_BY_ZONE[z]);
  for (const r of JOB_ROWS) eq(`A.1.4 row ${r.row} (${r.workplace})`, t.jobs[r.row], r.bands);
  for (const [k, v] of Object.entries(STATUS_TABLE)) eq(`A.1.4 ${k}`, t.statuses[k as keyof CensusTables["statuses"]], v);
  eq("A.1.4 teens with Saturday jobs", t.saturdayJobs, TEEN_SATURDAY_JOBS);
  for (const a of ARCHETYPE_IDS) eq(`A.1.5 ${a}`, t.archetypes[a], ARCHETYPE_QUOTAS[a]);
  return out;
}

// ── Printing ────────────────────────────────────────────────────────────────

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const ZONE_HEAD: Readonly<Record<CensusZone, string>> = { millbrook: "MB", old_quarter: "OQ", market_row: "MR", wharf: "WF", station_hill: "SH", commons: "CM" };

/** The report tools/census.ts prints: each A.1 table as recomputed, with ✓ or the mismatch. */
export function formatCensusReport(sk: Day1Skeleton, homes: HomeRegistry): string {
  const t = censusTables(sk, homes);
  const bad = censusMismatches(t);
  const lines: string[] = [];
  const mark = (prefix: string) => (bad.some(b => b.startsWith(prefix)) ? "✗" : "✓");
  lines.push(`Day-1 census skeleton · seed ${sk.seed} · ${t.households} households · ${t.homed} homed residents`);
  lines.push("", `A.1.1 Age bands ${mark("A.1.1 ")}`, `  ${pad("band", 12)}${lpad("core", 6)}${lpad("gen", 6)}${lpad("total", 7)}`);
  for (const b of CENSUS_BANDS) lines.push(`  ${pad(b, 12)}${lpad(t.bands[b].core, 6)}${lpad(t.bands[b].generated, 6)}${lpad(t.bands[b].core + t.bands[b].generated, 7)}`);
  lines.push(`  minors (u5/pupil/teen): ${CENSUS_ZONES.map(z => `${ZONE_HEAD[z]} ${t.minors[z].under_five}/${t.minors[z].pupil}/${t.minors[z].teen}`).join(" · ")}`);
  lines.push(`  pupil ages: ${t.pupilAges.join(", ")}`);
  lines.push("", `A.1.2 Households by type and zone ${mark("A.1.2 ")}`, `  ${pad("", 4)}${CENSUS_ZONES.map(z => lpad(ZONE_HEAD[z], 4)).join("")}${lpad("all", 5)}`);
  for (const k of HOUSEHOLD_TYPES) lines.push(`  ${pad(k, 4)}${CENSUS_ZONES.map(z => lpad(t.types[k][z] ?? 0, 4)).join("")}${lpad(Object.values(t.types[k]).reduce((a, b) => a + (b ?? 0), 0), 5)}`);
  lines.push("", `A.1.3 Where they live ${mark("A.1.3 ")}`, `  ${pad("zone", 14)}${lpad("hh", 4)}${lpad("people", 8)}${lpad("vacant", 8)}${lpad("homes", 7)}`);
  for (const z of CENSUS_ZONES) lines.push(`  ${pad(z, 14)}${lpad(t.homes[z].households, 4)}${lpad(t.homes[z].residents, 8)}${lpad(t.homes[z].vacant, 8)}${lpad(t.homes[z].total, 7)}`);
  lines.push("", `A.1.4 Jobs by row (young adults / adults / elders) ${mark("A.1.4 row")}`);
  for (const r of JOB_ROWS) lines.push(`  ${lpad(r.row, 2)} ${pad(r.workplace.slice(0, 46), 47)}${t.jobs[r.row]!.join(" / ")}`);
  lines.push(`  statuses ${mark("A.1.4 ")}: ${Object.entries(t.statuses).map(([k, v]) => `${k} ${v.join("/")} (${v[0] + v[1] + v[2]})`).join(" · ")}`);
  lines.push(`  commuters ${t.jobs[COMMUTER_ROW]!.reduce((a, b) => a + b, 0)} · teens with Saturday jobs ${t.saturdayJobs}`);
  lines.push("", `A.1.5 Archetypes (children / teens / young adults / adults / elders) ${mark("A.1.5 ")}`);
  for (const a of ARCHETYPE_IDS) if (t.archetypes[a].some(Boolean) || ARCHETYPE_QUOTAS[a].some(Boolean)) lines.push(`  ${pad(a, 20)}${t.archetypes[a].map(n => lpad(n, 3)).join(" ")}`);
  // D1: the portrait split.
  lines.push("", `D1 portraits · library rows ${sk.library.rows}, assigned ${sk.library.assigned}, held for arrivals ${Object.entries(sk.library.reserve).map(([b, n]) => `${b} ${n}`).join(", ")}`);
  lines.push(`  ${pad("band", 12)}${lpad("library", 8)}${lpad("proc.", 7)}${lpad("card", 6)}   library by zone`);
  for (const b of CENSUS_BANDS) {
    const ms = sk.households.flatMap(h => h.members.filter(m => m.band === b).map(m => ({ h, m })));
    const lib = ms.filter(x => x.m.portrait.source === "library");
    const byZone = CENSUS_ZONES.map(z => `${ZONE_HEAD[z]} ${lib.filter(x => x.h.zone === z).length}/${ms.filter(x => x.h.zone === z && x.m.portrait.source !== "card").length}`).join(" ");
    lines.push(`  ${pad(b, 12)}${lpad(lib.length, 8)}${lpad(ms.filter(x => x.m.portrait.source === "procedural").length, 7)}${lpad(ms.filter(x => x.m.portrait.source === "card").length, 6)}   ${byZone}`);
  }
  lines.push("", bad.length ? `${bad.length} table(s) don't close:\n${bad.map(b => `  ✗ ${b}`).join("\n")}` : "Every A.1 table closes.");
  return lines.join("\n");
}
