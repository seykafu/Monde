// MVP M-03 step 1: the frozen Day-1 census skeleton (content/census/day1.yaml) against GDD Appendix A.1, the pins
// (content/census/pins.yaml), the homes (content/places/homes.yaml), the portrait library and the cards.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  ARCHETYPE_QUOTAS, BAND_TABLE, CENSUS_ZONES, CORE_HOMED, FIRST_NAMES, FAMILY_NAMES, FAMOUS_NAMES, HOUSEHOLDS, JOB_ROWS, MINORS_BY_ZONE,
  PORTRAIT_LIBRARY, PUPIL_AGES, PersonaCard, RESERVED_FAMILY_NAMES, RESERVED_FIRST_NAMES, STATUS_TABLE, TYPES_BY_ZONE, bandAllowance, bandOf,
  bedsNeeded, buildSkeleton, cardLookProblems, censusMismatches, censusTables, foldName, formatCensusReport, homeZone, isNamedPin, isVacantHome,
  masterOf, parseHomes, parsePins, tagsFromLook, type CensusCard, type Day1Skeleton, type SkeletonMember,
} from "../index";

const root = resolve(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const sk = YAML.parse(read("content/census/day1.yaml")) as Day1Skeleton;
const pins = parsePins(YAML.parse(read("content/census/pins.yaml")));
const homes = parseHomes(YAML.parse(read("content/places/homes.yaml")));
const cardFiles = readdirSync(resolve(root, "content/residents")).filter(f => f.endsWith(".yaml")).sort();
const fullCards = cardFiles.map(f => PersonaCard.parse(YAML.parse(read(`content/residents/${f}`))));
const cards: CensusCard[] = fullCards.map(c => ({ id: c.id, name: c.name, age: c.age, pronouns: c.pronouns, kind: c.kind, home: c.home, ...(c.look ? { look: c.look } : {}), relationships: c.relationships }));
const tables = censusTables(sk, homes);
const people = sk.households.flatMap(h => h.members.map(m => ({ h, m })));
const generated = people.filter(p => p.m.kind !== "core");
const libraryById = new Map(PORTRAIT_LIBRARY.map(e => [e.id, e]));
const key = (h: { id: string }, m: SkeletonMember) => m.id ?? `${h.id}/${m.slot}`;

describe("the Day-1 census skeleton closes Appendix A.1", () => {
  it("has 123 households and 210 homed residents: 18 core cast and the 192", () => {
    expect(sk.households).toHaveLength(HOUSEHOLDS);
    expect(people).toHaveLength(210);
    expect(people.filter(p => p.m.kind === "core").map(p => p.m.id).sort()).toEqual([...CORE_HOMED].sort());
    expect(generated).toHaveLength(192);
    expect(generated.filter(p => p.m.kind === "carded").map(p => p.m.id).sort()).toEqual(["ada", "bru", "moss", "nettie"]);
    expect(generated.filter(p => p.m.kind === "named")).toHaveLength(14);
  });

  it("reproduces every A.1 table", () => {
    expect(censusMismatches(tables)).toEqual([]);
    expect(formatCensusReport(sk, homes)).toContain("Every A.1 table closes.");
  });

  it("A.1.1: the bands, the minors by zone and the nine pupils' ages", () => {
    expect(tables.bands).toEqual(BAND_TABLE);
    expect(tables.minors).toEqual(MINORS_BY_ZONE);
    expect(tables.pupilAges).toEqual(PUPIL_AGES);
    expect(people.find(p => p.m.id === "tib")!.m).toMatchObject({ age: 11, minor: "pupil" });
    expect(people.find(p => p.m.id === "maud")!.m).toMatchObject({ age: 9, minor: "pupil" });
  });

  it("A.1.2 and A.1.3: households of each type by zone, and the homes", () => {
    for (const [type, zones] of Object.entries(TYPES_BY_ZONE)) for (const z of CENSUS_ZONES) expect(tables.types[type as keyof typeof tables.types][z] ?? 0, `${type} ${z}`).toBe(zones[z] ?? 0);
    expect(Object.values(tables.homes).reduce((s, z) => s + z.total, 0)).toBe(184);
    expect(Object.values(tables.homes).reduce((s, z) => s + z.vacant, 0)).toBe(61);
  });

  it("A.1.4: every job row by band, the statuses, twelve commuters and four Saturday jobs", () => {
    for (const r of JOB_ROWS) expect(tables.jobs[r.row], `row ${r.row}`).toEqual(r.bands);
    expect(tables.statuses).toEqual(STATUS_TABLE);
    expect(people.filter(p => p.m.employment === "employed")).toHaveLength(90);
    expect(people.filter(p => p.m.job?.row === 24)).toHaveLength(12);
    const outOfWork = people.filter(p => p.m.employment === "out_of_work");
    expect(outOfWork).toHaveLength(13);
    expect(outOfWork.filter(p => p.m.band === "adult").every(p => p.m.archetype === "mill_hand")).toBe(true);
    expect(people.filter(p => p.m.employment === "carer")).toHaveLength(8);
    expect(people.filter(p => p.m.employment === "unable")).toHaveLength(11);
    expect(people.filter(p => p.m.saturday_job)).toHaveLength(4);
    expect(people.filter(p => p.m.saturday_job).every(p => p.m.minor === "teen")).toBe(true);
    // Six Tollmen (row 23): Rook and the five inside the 192 (A.1.5).
    expect(people.filter(p => p.m.job?.row === 23).map(p => p.m.id).sort()).toEqual(["bru", "dex", "dom", "nettie", "rook", "weasel"]);
  });

  it("A.1.5: archetypes by band among the 192, with A.1.5's identities by household type", () => {
    for (const [a, row] of Object.entries(ARCHETYPE_QUOTAS)) expect(tables.archetypes[a as keyof typeof tables.archetypes], a).toEqual(row);
    const of = (type: string) => sk.households.filter(h => h.type === type).flatMap(h => h.members.filter(m => m.kind !== "core"));
    expect(of("J").every(m => m.archetype === "young_family")).toBe(true);
    expect([...of("K"), ...of("M")].every(m => m.archetype === "single_parent")).toBe(true);
    expect([...of("L"), ...of("N")].every(m => m.archetype === "school_family" || (m.archetype === "apprentice" && m.minor === "teen"))).toBe(true);
    expect(people.filter(p => p.m.archetype === "retired_couple").every(p => p.h.type === "B" || p.h.type === "C")).toBe(true);
    expect(people.filter(p => p.m.archetype === "widowed_elder").every(p => ["A", "O", "P"].includes(p.h.type))).toBe(true);
  });
});

describe("the people in it", () => {
  it("keeps every age in its band and range, couples within 25 years, parents 18 older than their children", () => {
    for (const { h, m } of people) {
      expect(bandOf(m.age), key(h, m)).toBe(m.band);
      expect(m.age, key(h, m)).toBeGreaterThanOrEqual(m.age_range[0]);
      expect(m.age, key(h, m)).toBeLessThanOrEqual(m.age_range[1]);
    }
    for (const h of sk.households) {
      const head = h.members[0]!;
      for (const m of h.members.slice(1)) {
        if (m.role === "partner") expect(Math.abs(m.age - head.age), `${h.id} couple`).toBeLessThanOrEqual(25);
        if (m.role === "parent" || m.role === "grandparent") expect(m.age - head.age, `${h.id} parent`).toBeGreaterThanOrEqual(18);
        if (m.minor) for (const p of h.members.filter(o => o.role === "adult" || o.role === "partner")) expect(p.age - m.age, `${h.id} child`).toBeGreaterThanOrEqual(18);
      }
      const kids = h.members.filter(m => m.minor).map(m => m.age);
      expect(new Set(kids).size, `${h.id}: no generated twins`).toBe(kids.length);
    }
  });

  it("gives the presentation's pronouns, and each person their employment by age", () => {
    for (const { h, m } of generated) {
      if (m.kind === "carded") continue;
      expect(m.pronoun_default, key(h, m)).toBe({ f: "she/her", m: "he/him", a: "they/them" }[m.presentation]);
    }
    for (const { h, m } of people) {
      const want = m.minor === "under_five" ? "under_five" : m.minor === "pupil" ? "pupil" : m.minor === "teen" ? "lessons" : null;
      if (want) expect(m.employment, key(h, m)).toBe(want);
      expect(m.employment === "employed", key(h, m)).toBe(m.job !== null);
    }
  });

  it("gives every household its own surname (kin links aside), and six clean first names to everyone unnamed", () => {
    const reservedFirst = new Set([...RESERVED_FIRST_NAMES, ...cards.map(c => c.name.replace(/^(Rev\.|Captain|Dr\.)\s+/, "").replace(/"[^"]*"\s*/g, "").split(" ")[0]!)].map(foldName));
    const reservedFamily = new Set(RESERVED_FAMILY_NAMES.map(foldName));
    const surnames = new Map<string, string[]>();
    for (const h of sk.households) for (const s of new Set(h.members.map(m => m.surname!).filter(Boolean))) surnames.set(s, [...(surnames.get(s) ?? []), h.id]);
    // Shared only where a kin link says so: the Dunmores (Nell and Barney), the Szabos (Ilona and Nettie, Maud's house).
    expect([...surnames].filter(([, hs]) => hs.length > 1).map(([s, hs]) => `${s}: ${hs.sort().join(", ")}`).sort()).toEqual(["Dunmore: dunmore_barney, dunmore_nell", "Szabo: szabo_ilona, szabo_maud"]);
    const firsts = new Map<string, number>();
    for (const { h, m } of people) {
      if (m.kind !== "anonymous") { expect(m.first_names, key(h, m)).toEqual([]); continue; }
      expect(m.first_names, key(h, m)).toHaveLength(6);
      expect(new Set(m.first_names).size, key(h, m)).toBe(6);
      expect(m.first_names.every(n => (FIRST_NAMES[m.presentation] as readonly string[]).includes(n)), key(h, m)).toBe(true);
      for (const n of m.first_names) {
        expect(reservedFirst.has(foldName(n)), `${key(h, m)}: ${n}`).toBe(false);
        expect(FAMOUS_NAMES.map(foldName)).not.toContain(foldName(`${n} ${m.surname}`));
      }
      if (!reservedFamily.has(foldName(m.surname!)) && !["Szabo", "Quill", "Calloway"].includes(m.surname!)) expect(FAMILY_NAMES as readonly string[], key(h, m)).toContain(m.surname);
      firsts.set(m.first_names[0]!, (firsts.get(m.first_names[0]!) ?? 0) + 1);
      for (const o of h.members) if (o !== m) expect(o.first_names.filter(n => m.first_names.includes(n)), `${key(h, m)} and ${o.slot}`).toEqual([]);
    }
    // V03: taking everyone's first option, no first name is worn by more than two.
    expect(Math.max(...firsts.values())).toBeLessThanOrEqual(2);
  });

  it("gives the 192 a birthday each on the 100-day calendar, at most two a day, every day one, twins together", () => {
    const days = new Map<number, number>();
    for (const { h, m } of people) {
      if (m.kind === "core") { expect(m.birthday).toBeNull(); continue; }
      expect(m.birthday, key(h, m)).toBeGreaterThanOrEqual(1);
      expect(m.birthday, key(h, m)).toBeLessThanOrEqual(100);
      days.set(m.birthday!, (days.get(m.birthday!) ?? 0) + 1);
    }
    expect(days.size).toBe(100);
    expect(Math.max(...days.values())).toBeLessThanOrEqual(2);
    const twin = (id: string) => people.find(p => p.m.id === id)!.m.birthday;
    expect(twin("dex")).toBe(twin("dom"));
  });
});

describe("the pins (content/census/pins.yaml)", () => {
  it("keeps every pinned household as pinned: type, zone, home, surname, members in order", () => {
    for (const p of pins.households) {
      const h = sk.households.find(x => x.id === p.id)!;
      expect(h, p.id).toBeDefined();
      expect(h, p.id).toMatchObject({ type: p.type, zone: p.zone, status: "pinned", ...(p.home ? { home: p.home } : {}), surname: p.surname });
      expect(homeZone(h.home)).toBe(p.zone);
      p.members.forEach((pm, i) => {
        const m = h.members[i]!;
        if ("card" in pm) expect(m.id, p.id).toBe(pm.card);
        else if ("person" in pm) expect(m.id, p.id).toBe(pm.person);
        else {
          expect(m.id, p.id).toBeNull();
          if (pm.slot.archetype) expect(m.archetype).toBe(pm.slot.archetype);
          if (pm.slot.presentation) expect(m.presentation).toBe(pm.slot.presentation);
          if (typeof pm.slot.surname === "string") expect(m.surname).toBe(pm.slot.surname);
        }
      });
    }
    expect(sk.households.filter(h => h.status === "pinned")).toHaveLength(pins.households.length);
  });

  it("puts every card's resident at their card's home, of their card's age, and the named people as canon has them", () => {
    for (const c of cards) {
      if (c.kind === "animal" || c.home.startsWith("offmap.")) continue;
      const p = people.find(x => x.m.id === c.id)!;
      expect(p, c.id).toBeDefined();
      expect(p.h.home, c.id).toBe(c.home);
      expect(p.m.age, c.id).toBe(c.age);
      expect(p.m.name, c.id).toBe(c.name);
    }
    for (const [id, pin] of Object.entries(pins.people)) {
      const { m } = people.find(x => x.m.id === id)!;
      expect(m.archetype, id).toBe(pin.archetype);
      if (pin.job) expect(m.job, id).toEqual(pin.job);
      if (!isNamedPin(pin)) continue;
      expect(m, id).toMatchObject({ kind: "named", name: pin.name, presentation: pin.presentation });
      if (Array.isArray(pin.age)) { expect(m.age).toBeGreaterThanOrEqual(pin.age[0]); expect(m.age).toBeLessThanOrEqual(pin.age[1]); } else expect(m.age, id).toBe(pin.age);
    }
    // §12.4 / D4: who lives with whom, and where.
    const homeOf = (id: string) => people.find(p => p.m.id === id)!.h;
    expect(homeOf("hester").home).toBe("old_quarter.home_03");
    expect(homes.get(homeOf("frye").home)).toMatchObject({ street: "Lamplighter Lane", host: { building: "home_03" } });
    expect(homeOf("weasel").home).toMatch(/^market_row\.home_/);
    expect(homes.get(homeOf("weasel").home)!.host).toEqual({ building: "storefront_6" });
    expect(homeOf("cobb").home).toBe("old_quarter.st_brigids");
    expect(people.find(p => p.m.id === "cobb")!.m.job).toMatchObject({ row: 1, title: "sexton" });
    expect([homeOf("bru"), homeOf("nettie"), homeOf("maud")].map(h => homes.get(h.home)!.street)).toEqual(["Terrace Row", "Terrace Row", "Terrace Row"]);
    expect(homeOf("ilona").id).toBe(homeOf("nettie").id);
    expect(homeOf("raman").id).toBe(homeOf("priya").id);
    expect(homeOf("dex").id).toBe(homeOf("dom").id);
  });

  it("lists every link the cards make to someone without a card as a mirror the new card must return", () => {
    const named = new Set(Object.entries(pins.people).filter(([, p]) => isNamedPin(p)).map(([id]) => id));
    const fromCards = fullCards.flatMap(c => c.relationships.filter(r => named.has(r.id)).map(r => `${c.id}>${r.id}:${r.tag}:${r.affinity}/${r.trust}`)).sort();
    expect(pins.mirrors.map(m => `${m.from}>${m.to}:${m.tag}:${m.affinity}/${m.trust}`).sort()).toEqual(fromCards);
    for (const m of pins.mirrors) expect(sk.links.some(l => l.source === "mirror" && l.a === m.to && l.b === m.from), `${m.from} → ${m.to}`).toBe(true);
    for (const l of pins.links) expect(sk.links.some(x => x.source === "pin" && x.a === l.a && x.b === l.b)).toBe(true);
  });
});

describe("the homes", () => {
  it("houses every household in a home of its zone that fits it (beds >= ceil(size / 2)), one household a home", () => {
    const used = new Set<string>();
    for (const h of sk.households) {
      const home = homes.get(h.home)!;
      expect(home, h.id).toBeDefined();
      expect(homeZone(h.home), h.id).toBe(h.zone);
      expect(isVacantHome(h.home), h.id).toBe(false);
      expect(home.beds, h.id).toBeGreaterThanOrEqual(bedsNeeded(h.members.length));
      expect(used.has(h.home), h.home).toBe(false);
      used.add(h.home);
    }
    expect([...homes.keys()].filter(id => !isVacantHome(id) && !used.has(id))).toEqual([]);
    // A.2's Requires as preferences: the radio tinkerer has a bench.
    expect(homes.get(people.find(p => p.m.id === "frane")!.h.home)!.bench).toBe(true);
  });
});

describe("the portraits (D1)", () => {
  const library = people.filter(p => p.m.portrait.source === "library");
  const entry = (p: { m: SkeletonMember }) => libraryById.get((p.m.portrait as { id: string }).id)!;

  it("keeps the cards' own portraits for the core cast and the four carded people", () => {
    for (const { m } of people) if (m.kind === "core" || m.kind === "carded") expect(m.portrait).toEqual({ source: "card", id: m.id });
    for (const { m } of people) if (m.kind === "named" || m.kind === "anonymous") expect(["library", "procedural"]).toContain(m.portrait.source);
  });

  it("never assigns a library identity twice, nor a master's colours to two unrelated people in one zone or workplace", () => {
    const ids = library.map(p => (p.m.portrait as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of library) {
      const e = entry(p);
      expect(e, p.m.id ?? p.m.slot).toBeDefined();
      expect(e.band, key(p.h, p.m)).toBe(p.m.band);
      expect(e.presentation === p.m.presentation || e.presentation === "a" || p.m.presentation === "a", key(p.h, p.m)).toBe(true);
    }
    const twins = new Set(["dex|dom", "dom|dex"]);
    for (const a of library) for (const b of library) {
      const together = a.h.zone === b.h.zone || (!!a.m.job && a.m.job.workplace === b.m.job?.workplace);
      if (a === b || !together || masterOf(entry(a)) !== masterOf(entry(b))) continue;
      expect(twins.has(`${a.m.id}|${b.m.id}`), `${key(a.h, a.m)} and ${key(b.h, b.m)} share ${masterOf(entry(a))}`).toBe(true);
    }
  });

  it("keeps each band's reserve for Spring's arrivals (20% of its rows, at least two)", () => {
    const { reserve } = bandAllowance(PORTRAIT_LIBRARY);
    expect(sk.library.reserve).toEqual(reserve);
    for (const band of Object.keys(reserve) as (keyof typeof reserve)[]) {
      const rows = PORTRAIT_LIBRARY.filter(e => e.band === band).length;
      const assigned = library.filter(p => p.m.band === band).length;
      expect(rows - assigned, band).toBeGreaterThanOrEqual(reserve[band]);
    }
    // The named people are seen most: each has a library bust.
    for (const p of people.filter(x => x.m.kind === "named")) expect(p.m.portrait.source, p.m.id!).toBe("library");
  });

  it("gives everyone else a look the rig can draw, tagged as a library bust would be", () => {
    for (const { h, m } of people) {
      if (m.portrait.source !== "procedural") continue;
      expect(cardLookProblems({ kind: "resident", look: m.portrait.look }), key(h, m)).toEqual([]);
      expect(m.portrait.tags, key(h, m)).toEqual(tagsFromLook(m.portrait.look, { band: m.band, presentation: m.presentation, age: m.age }));
    }
  });
});

describe("the generator", () => {
  it("reproduces the committed skeleton from its seed", () => {
    const again = buildSkeleton(sk.seed, pins, homes, PORTRAIT_LIBRARY, cards);
    expect(JSON.parse(JSON.stringify(again))).toEqual(sk);
  });

  it("closes every table for other seeds too", () => {
    for (const seed of ["census-a", "census-b", "census-c"]) {
      const other = buildSkeleton(seed, pins, homes, PORTRAIT_LIBRARY, cards);
      expect(censusMismatches(censusTables(other, homes)), seed).toEqual([]);
    }
  });
});
