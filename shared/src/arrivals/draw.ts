// Who arrives (GDD Appendix A.3.1–A.3.5): archetype weighting, household shapes, ages and portraits. Pure.
//
// One household per arrival slot, seeded with hash(world_seed, day, slot) (A.3.1), so the same night draws the same
// people. The Haiku call (A.3.6) or the template card (A.3.8) then writes them.
import type { PortraitTags } from "../census/portraitPlan";
import type { CardHumanLook } from "../look";
import { PILLARS } from "../script/types";
import { ARCHETYPES, ARCHETYPE_BY_ID, type Archetype, type ArchetypeId, type ArrivalFacts, type Presentation } from "./archetypes";
import { AGE_BANDS, BAND_AGES, assignPortrait, tagsOfEntry, type AgeBand, type PortraitEntry } from "./library";
import type { NativeHouseholdFacts, NativeMemberFacts } from "./nativeDraw";
import { SeededRng, hashParts } from "./rng";

/** A.3.2: lift(a) = exp(8 · (score(a) − mean(π))). */
export const LIFT_GAMMA = 8;
/** A.3.2: fatigue(a) = 0.5^n over the last 10 days, n capped at 3. */
export const FATIGUE_DAYS = 10;
/** A.3.2 clamp: no archetype above 35%, every eligible one at least 0.5%. */
export const PROB_MAX = 0.35;
export const PROB_MIN = 0.005;
/** A.3.4 rule 6: at most 2 households of one archetype per day. */
export const MAX_SAME_ARCHETYPE_PER_DAY = 2;
/** A.3.3: household size is capped at 6. */
export const MAX_HOUSEHOLD = 6;

export interface RecentHousehold {
  archetype: string;
  day: number;
  ages: readonly number[];
}

export interface DrawContext {
  /** The world's seed (A.3.1). */
  seed: number | string;
  /** The day they arrive. */
  day: number;
  /** The slot within the day (0, 1, …), or a buffer slot. */
  slot: number;
  facts: ArrivalFacts;
  /** §6.2: the chance a household is youth-leaning, YouthAppeal / (YouthAppeal + ElderAppeal). */
  youthShare: number;
  /** Households that arrived recently, newest last (fatigue: 10 days; balance: the last 20 people). */
  recent: readonly RecentHousehold[];
  /** Living generated residents per archetype (the oddball cap). */
  alive: ReadonlyMap<string, number>;
  /** Living residents wearing each library portrait. */
  portraitUses: ReadonlyMap<string, number>;
  /** Archetypes already drawn today (A.3.4 rule 6). */
  today?: readonly string[];
  /** Force the archetype (dev tools, tests). */
  archetype?: ArchetypeId;
}

export interface ArchetypeWeight {
  id: ArchetypeId;
  score: number;
  lift: number;
  gate: 0 | 1;
  fatigue: number;
  need: number;
  balance: number;
  w: number;
  prob: number;
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** The need multipliers of A.3.2's table that the MVP engine can see (the rest are ×1, GDD-GAP below). */
function needOf(a: Archetype, f: ArrivalFacts, alive: ReadonlyMap<string, number>): number {
  const flag = (x: string) => f.flags.has(x);
  const begun = (p: string) => flag(`project_${p}_started`) && !flag(`project_${p}_done`);
  let need = 1;
  switch (a.id) {
    case "school_family": if (f.pupils < 20) need *= 1.5; break;
    case "schoolteacher": if (f.pupils >= 15 && !flag("school_second_teacher")) need *= 2; break;
    case "builder": if ((flag("project_homes_started") || begun("homes")) && f.unrestoredHomes >= 10) need *= 1.25; break;
    case "retired_keeper": if (begun("lighthouse")) need *= 2; break;
    case "market_gardener": if ((flag("project_community_garden_done") || flag("project_glasshouse_done")) && !alive.get("market_gardener")) need *= 1.5; break;
    case "mill_hand": if (begun("mill")) need *= 1.5; break;
    case "shop_founder": if (f.storefrontsFree >= 1) need *= 1.5; break;
    // GDD-GAP: kitchen vacancies, idle fish-market stalls and masters' open apprentice stages aren't tracked yet.
    default: break;
  }
  return Math.min(3, need);
}

/** Households (A.3.4 rule 1): the smallest home this archetype's smallest household fits. */
const minBeds = (a: Archetype): number =>
  a.shape.kind === "family" ? Math.ceil((2 + a.shape.children[0]) / 2) : a.shape.kind === "single_parent" ? 1 : a.shape.kind === "couple" ? 1 : 1;

/** A.3.2's weights for every archetype, normalised and clamped. */
export function archetypeWeights(ctx: Pick<DrawContext, "facts" | "recent" | "alive" | "today" | "day">): ArchetypeWeight[] {
  const { facts } = ctx;
  const pi = Object.fromEntries(PILLARS.map(p => [p, facts.pillars[p] / 100])) as Record<(typeof PILLARS)[number], number>;
  const piMean = mean(PILLARS.map(p => pi[p]));
  const recentDays = ctx.recent.filter(h => h.day > ctx.day - FATIGUE_DAYS);
  // Balance: the last 20 arriving people.
  const people = ctx.recent.flatMap(h => h.ages).slice(-20);
  const under40 = people.length ? people.filter(a => a < 40).length / people.length : 0;
  const over60 = people.length ? people.filter(a => a >= 60).length / people.length : 0;
  const rows = ARCHETYPES.map(a => {
    const score = PILLARS.reduce((s, p) => s + a.pull[p] * pi[p], 0);
    const lift = Math.exp(LIFT_GAMMA * (score - piMean));
    const sameToday = (ctx.today ?? []).filter(t => t === a.id).length;
    const oddCap = a.oddball && (ctx.alive.get(a.id) ?? 0) >= a.dayOne + 2;
    const homeFits = facts.freeHomes.some(h => h.beds >= minBeds(a));
    const gate: 0 | 1 = a.requires(facts) && homeFits && !oddCap && sameToday < MAX_SAME_ARCHETYPE_PER_DAY ? 1 : 0;
    const n = Math.min(3, recentDays.filter(h => h.archetype === a.id).length);
    const fatigue = 0.5 ** n;
    const need = needOf(a, facts, ctx.alive);
    let balance = 1;
    if (a.lean === "Y" && under40 < 0.4) balance *= 1.25;
    if (a.lean === "O" && over60 < 0.25) balance *= 1.25;
    const w = a.base * lift * gate * fatigue * need * balance;
    return { id: a.id, score, lift, gate, fatigue, need, balance, w, prob: 0 };
  });
  const total = rows.reduce((s, r) => s + r.w, 0);
  if (total <= 0) return rows;
  for (const r of rows) r.prob = r.w / total;
  clampProbabilities(rows);
  return rows;
}

/** A.3.2's clamp: excess above 35% goes to the others pro rata; eligible ones keep at least 0.5%. */
function clampProbabilities(rows: ArchetypeWeight[]): void {
  const eligible = rows.filter(r => r.gate === 1 && r.w > 0);
  for (let pass = 0; pass < 8; pass++) {
    const over = eligible.filter(r => r.prob > PROB_MAX + 1e-12);
    if (!over.length) break;
    let excess = 0;
    for (const r of over) { excess += r.prob - PROB_MAX; r.prob = PROB_MAX; }
    const rest = eligible.filter(r => r.prob < PROB_MAX);
    const restTotal = rest.reduce((s, r) => s + r.prob, 0);
    if (restTotal <= 0) break;
    for (const r of rest) r.prob += excess * (r.prob / restTotal);
  }
  for (const r of eligible) if (r.prob < PROB_MIN) r.prob = PROB_MIN;
  const sum = eligible.reduce((s, r) => s + r.prob, 0);
  for (const r of eligible) r.prob /= sum;
}

// ── Households ──────────────────────────────────────────────────────────────

/** A.3.3's roles; the Day-1 census adds A.1.2's siblings, flatmates and elder parents (shared/src/census/day1Tables.ts). */
export type MemberRole = "adult" | "partner" | "child" | "grandparent" | "adult_child" | "sibling" | "flatmate" | "parent";

export interface MemberDraw {
  /** m1, m2, … (A.3.6 HOUSEHOLD slots). */
  slot: string;
  role: MemberRole;
  /** The age range the card's age must fall in: the archetype's range ∩ the portrait band (A.2). */
  age_min: number;
  age_max: number;
  /** The engine's own draw inside the range (the template card's age). */
  age: number;
  band: AgeBand;
  presentation: Presentation;
  pronoun_default: "she/her" | "he/him" | "they/them";
  /** A library bust's id, or (a Day-1 resident with a procedural look) the resident's own id once written. */
  portrait: string;
  /** The bust's A.3.5 tags and caption: what the prompt shows and the validator checks (V04, V06). */
  tags: PortraitTags;
  /** A procedural look (the Day-1 census, D1): the card wears it. Library busts carry their own. */
  look?: CardHumanLook;
  /** The member's own archetype when it isn't the household's (a Day-1 adult living with an elder parent). */
  archetype?: ArchetypeId;
  /** Day-1 census members only (MODE: native). */
  native?: NativeMemberFacts;
}

export interface HouseholdDraw {
  /** Stable per world, day and slot. */
  id: string;
  archetype: ArchetypeId;
  /** The arrival day this was drawn for (the buffer's draw day). */
  day: number;
  slot: number;
  youth: boolean;
  members: MemberDraw[];
  /** A.3.4 rule 1: beds >= ceil(size / 2). */
  beds: number;
  /** The weights it was drawn from (for the soak and the dev log). */
  prob: number;
  /** Day-1 census households only (MODE: native): the skeleton's facts. */
  native?: NativeHouseholdFacts;
}

const PRONOUN: Readonly<Record<Presentation, MemberDraw["pronoun_default"]>> = { f: "she/her", m: "he/him", a: "they/them" };
/** GDD-GAP: A.2 gives presentation weights for each archetype's adults, not for the children: an even split. */
const CHILD_PRESENTATION: Readonly<Record<Presentation, number>> = { f: 48, m: 48, a: 4 };

/** A.2: the band is picked first, weighted by the years of the range it covers. */
function pickBand(rng: SeededRng, lo: number, hi: number): { band: AgeBand; lo: number; hi: number } {
  const options = AGE_BANDS.map(b => {
    const [bl, bh] = BAND_AGES[b];
    const l = Math.max(lo, bl), h = Math.min(hi, bh);
    return { band: b, lo: l, hi: h, years: h >= l ? h - l + 1 : 0 };
  }).filter(o => o.years > 0);
  const band = rng.weighted(options.map(o => [o.band, o.years] as const)) ?? options[0]!.band;
  return options.find(o => o.band === band)!;
}

function presentationOf(rng: SeededRng, weights: Readonly<Record<Presentation, number>>): Presentation {
  return rng.weighted([["f", weights.f], ["m", weights.m], ["a", weights.a]] as const) ?? "f";
}

interface Plan { role: MemberRole; lo: number; hi: number }

/** A.3.3: the household's members as roles and age ranges. */
function shapeHousehold(a: Archetype, rng: SeededRng): Plan[] {
  const s = a.shape;
  const adult = (lo = a.age[0], hi = a.age[1]): Plan => ({ role: "adult", lo, hi });
  switch (s.kind) {
    case "family": {
      const out: Plan[] = [adult(s.adults[0], s.adults[1]), { role: "partner", lo: s.adults[0], hi: s.adults[1] }];
      const n = rng.int(s.children[0], s.children[1]);
      for (let i = 0; i < n; i++) {
        // school_family: at least one child aged 5–12.
        const [lo, hi] = i === 0 && s.childAge[0] >= 5 ? [5, 12] : s.childAge;
        out.push({ role: "child", lo, hi });
      }
      if (s.grandparent && rng.chance(s.grandparent)) out.push({ role: "grandparent", lo: 60, hi: 78 });
      return out;
    }
    case "single_parent": {
      const out: Plan[] = [adult(s.adult[0], s.adult[1])];
      const n = rng.int(s.children[0], s.children[1]);
      for (let i = 0; i < n; i++) out.push({ role: "child", lo: s.childAge[0], hi: s.childAge[1] });
      return out;
    }
    case "one_or_two": return rng.chance(s.two) ? [adult(), { role: "partner", lo: a.age[0], hi: a.age[1] }] : [adult()];
    case "fisher": {
      const r = rng.next();
      if (r < 0.55) return [adult()];
      if (r < 0.8) return [adult(), { role: "partner", lo: a.age[0], hi: a.age[1] }];
      // A family of 3–4; any children follow school_family's rules (5–17, at least one 5–12).
      const kids = rng.int(1, 2);
      return [adult(30, 50), { role: "partner", lo: 30, hi: 50 }, ...Array.from({ length: kids }, (_, i) => ({ role: "child" as const, lo: i === 0 ? 5 : 5, hi: i === 0 ? 12 : 17 }))];
    }
    case "couple": return [adult(s.age[0], s.age[1]), { role: "partner", lo: s.age[0], hi: s.age[1] }];
    case "widowed": return rng.chance(0.1) ? [adult(), { role: "adult_child", lo: 40, hi: 55 }] : [adult()];
    case "one": return [adult()];
  }
}

/** Draw the archetype for a slot: the lean first (§6.2's youth share), then A.3.2's weights within it. */
export function drawArchetype(ctx: DrawContext, rng: SeededRng): { id: ArchetypeId; youth: boolean; prob: number } | null {
  const weights = archetypeWeights(ctx);
  const eligible = weights.filter(w => w.gate === 1 && w.prob > 0);
  if (ctx.archetype) {
    const forced = weights.find(w => w.id === ctx.archetype);
    return { id: ctx.archetype, youth: ARCHETYPE_BY_ID.get(ctx.archetype)!.lean === "Y", prob: forced?.prob ?? 0 };
  }
  if (!eligible.length) return null;
  // GDD-GAP: §6.2 sets the chance a household is youth-leaning and A.3.2 sets the weights, without saying how they
  // combine. The roll picks the lean (Y archetypes for youth; O and M otherwise) and A.3.2 picks within it; if the
  // lean has nobody eligible, the whole field is drawn from.
  const youth = rng.chance(Math.max(0, Math.min(1, ctx.youthShare)));
  const lean = eligible.filter(w => (ARCHETYPE_BY_ID.get(w.id)!.lean === "Y") === youth);
  const pool = lean.length ? lean : eligible;
  const id = rng.weighted(pool.map(w => [w.id, w.prob] as const));
  if (!id) return null;
  return { id, youth, prob: pool.find(w => w.id === id)!.prob / pool.reduce((s, w) => s + w.prob, 0) };
}

/** One household for one slot (A.3.1 steps 1–4: gate, weigh and draw, shape, portraits). Null: nobody eligible. */
export function drawHousehold(ctx: DrawContext): HouseholdDraw | null {
  const rng = SeededRng.of(ctx.seed, ctx.day, ctx.slot, "household");
  const drawn = drawArchetype(ctx, rng);
  if (!drawn) return null;
  const archetype = ARCHETYPE_BY_ID.get(drawn.id)!;
  let plans = shapeHousehold(archetype, rng).slice(0, MAX_HOUSEHOLD);
  const maxBeds = Math.max(0, ...ctx.facts.freeHomes.map(h => h.beds));
  // A household that won't fit the biggest free home loses its youngest (A.3.4 rule 1); a lone adult always fits.
  while (plans.length > 1 && Math.ceil(plans.length / 2) > maxBeds) plans = plans.slice(0, -1);
  const uses = new Map(ctx.portraitUses);
  const members: MemberDraw[] = [];
  let first: { age: number; skin: number } | null = null;
  plans.forEach((plan, i) => {
    let lo = plan.lo, hi = plan.hi;
    // V04: parents are at least 18 years older than their children; couples within 25 years of each other.
    if (plan.role === "child" && first) hi = Math.min(hi, first.age - 18);
    if (plan.role === "partner" && first) { lo = Math.max(lo, first.age - 25); hi = Math.min(hi, first.age + 25); }
    if (plan.role === "adult_child" && first) hi = Math.min(hi, first.age - 18);
    if (hi < lo) hi = lo;
    const band = pickBand(rng, lo, hi);
    const age = rng.int(band.lo, band.hi);
    const presentation = presentationOf(rng, plan.role === "child" ? CHILD_PRESENTATION : archetype.presentation);
    const attire = plan.role === "child" ? ["jumper", "school_jumper", "satchel", "boots"] : archetype.attire;
    const portrait: PortraitEntry = assignPortrait({ band: band.band, presentation, attire, nearSkin: plan.role === "child" ? first?.skin : undefined, age }, rng, uses);
    uses.set(portrait.id, (uses.get(portrait.id) ?? 0) + 1);
    if (!first) first = { age, skin: portrait.skin };
    // A.2: "Pronouns default to the portrait (f she/her, m he/him, a they/them)": the bust decides when the picker
    // had to relax the presentation.
    const shown: Presentation = portrait.presentation;
    // A relaxed band (the library has no bust in it) keeps the person's age inside the bust's band.
    const [pl, ph] = BAND_AGES[portrait.band];
    const ageMin = Math.max(band.lo, pl) <= Math.min(band.hi, ph) ? Math.max(band.lo, pl) : pl;
    const ageMax = Math.max(band.lo, pl) <= Math.min(band.hi, ph) ? Math.min(band.hi, ph) : Math.min(ph, pl + 10);
    members.push({
      slot: `m${i + 1}`, role: plan.role, age_min: ageMin, age_max: ageMax, age: Math.min(ageMax, Math.max(ageMin, age)), band: portrait.band,
      presentation: shown, pronoun_default: PRONOUN[shown], portrait: portrait.id, tags: tagsOfEntry(portrait),
    });
  });
  return {
    id: `hh_${ctx.day}_${ctx.slot}_${hashParts(ctx.seed, ctx.day, ctx.slot).toString(36)}`,
    archetype: drawn.id, day: ctx.day, slot: ctx.slot, youth: drawn.youth, members,
    beds: Math.max(1, Math.ceil(members.length / 2)), prob: drawn.prob,
  };
}
