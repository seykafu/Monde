// Repairing a household reply before it is validated (GDD Appendix A.3.7; §9.10.2: the model proposes, the engine
// disposes). The household cards come back as text (householdJson.ts), and a staging trial (2026-10-17) failed every
// household six times on things the engine can put right without inventing anything: a summary or backstory a little
// over its cap, a tie tagged "brother" or "neighbour", a routine at "market_street", a required tie at the hand-written
// card's 70, a member tied to their own slot, likes that miss the archetype's list, two members' Big Five a few points
// apart. repairHousehold fixes those deterministically and lists each change; validateHousehold then judges what is
// left, and only that goes back to the model on a retry. Names, canon, novelty and banned language (V02, V03, V15–V19)
// stay with the validator and the retry loop. Pure: no I/O, and the input is never mutated.
import { VERBS, type Verb } from "../verbs";
import {
  APPEARANCE_SENTENCES, BIG5_APART, BIG5_KEYS, HOME_TOKEN, LENGTH_CAPS, LIKES_RANGE, PRONOUNS, RELATION_TAGS, STORY_ROLES, big5Apart,
  countSentences, countWords, likeRule, memberArchetype, memberTags, mentionsAttire, tieLimit, type Big5Key, type ValidationContext,
} from "./card";
import type { HouseholdDraw } from "./draw";
import { SeededRng } from "./rng";

export interface HouseholdRepair {
  /** The reply with the repairs made: a copy, still unvalidated (validateHousehold decides). */
  output: unknown;
  /**
   * One line per change, led by the rule it serves and naming the field, the old value and the new one, e.g.
   * `V07 members[0].backstory trimmed from 142 to 118 words` or `V01 members[0].relationships "nell".tag "sister" → "kin"`.
   */
  adjustments: string[];
}

type Rec = Record<string, unknown>;
type RelationTag = (typeof RELATION_TAGS)[number];
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const show = (x: unknown): string => JSON.stringify(x) ?? String(x);
/** An integer within ±lim (never −0). */
const bound = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, Math.round(v))) || 0;

// ── V06/V07: lengths ────────────────────────────────────────────────────────

/** Where a sentence may end for a cut: . ! ? or … (and a closing quote or bracket) before a space. */
const SENTENCE_END = /[.!?…]["'”’)\]]?(?=\s)/g;
const ENDS_SENTENCE = /[.!?…]["'”’)\]]?$/;

/**
 * `text` within `max` words, cut where fitText cuts (clamps.ts): after the last whole sentence that fits, if that keeps
 * at least half the cap; else after the last whole word that fits, with an ellipsis. Never mid-word. Text within the
 * cap that `fits` is returned as it is; `fits` can ask more of a cut (V06's two sentences).
 * GDD-GAP: A.3.7 V07 truncates text over by under 10% and fails the rest. The trial's backstories ran 17–22% over;
 * the engine trims any overrun instead of spending a retry on it.
 */
export function trimToWords(text: string, max: number, fits: (cut: string) => boolean = () => true): string {
  if (countWords(text) <= max && fits(text)) return text;
  const body = text.trim();
  let sentence: string | null = null;
  for (const end of body.matchAll(SENTENCE_END)) {
    const cut = body.slice(0, end.index + end[0].length);
    if (countWords(cut) > max) break;
    if (fits(cut)) sentence = cut;
  }
  const tokens = [...body.matchAll(/\S+/g)];
  const last = tokens[Math.min(max, tokens.length) - 1];
  let word = last ? body.slice(0, last.index + last[0].length).replace(/[\s,;:—–-]+$/u, "") : body;
  if (word && !ENDS_SENTENCE.test(word)) word = `${word}…`;
  if (sentence !== null && (countWords(sentence) >= max / 2 || !fits(word))) return sentence;
  return word;
}

// ── Enums ───────────────────────────────────────────────────────────────────

const PRONOUN_FORMS: readonly (readonly [(typeof PRONOUNS)[number], ReadonlySet<string>])[] = [
  ["she/her", new Set(["she", "her", "hers", "herself"])],
  ["he/him", new Set(["he", "him", "his", "himself"])],
  ["they/them", new Set(["they", "them", "their", "theirs", "themself", "themselves"])],
];
/** "She", "she/her/hers", "HE / HIM" → the one set every part belongs to; null for a mix (she/they) or anything else. */
export function pronounsOf(v: string): (typeof PRONOUNS)[number] | null {
  const parts = v.toLowerCase().split(/[\s/,]+/).filter(Boolean);
  return parts.length ? PRONOUN_FORMS.find(([, forms]) => parts.every(p => forms.has(p)))?.[0] ?? null : null;
}

/** "Favour-giver", "shop keeper" → the story role; anything that isn't one is "none" (no role is the safe claim). */
export function storyRoleOf(v: unknown): (typeof STORY_ROLES)[number] {
  if (!isStr(v)) return "none";
  const s = v.trim().toLowerCase().replace(/favour/g, "favor").replace(/[\s-]+/g, "_").replace(/^shop_keeper$/, "shopkeeper");
  return (STORY_ROLES as readonly string[]).includes(s) ? (s as (typeof STORY_ROLES)[number]) : "none";
}

/** A routine verb in another form ("Socialising", "napping", "reads", "playing music"); null unless exactly one fits. */
export function verbOf(v: string): Verb | null {
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/^socialis/, "socializ").replace(/^playing_/, "play_");
  const verbs = VERBS as readonly string[];
  if (verbs.includes(s)) return s as Verb;
  const stem = s.endsWith("ing") ? s.slice(0, -3) : null;
  const options = [...new Set([
    ...(stem ? [stem, `${stem}e`, stem.replace(/(.)\1$/, "$1")] : []),
    ...(s.endsWith("s") ? [s.slice(0, -1)] : []),
  ])].filter(x => verbs.includes(x));
  return options.length === 1 ? (options[0] as Verb) : null;
}

/** GDD-GAP: A.3.7 V01 fails a tag outside the six; these words name one of them plainly enough to map. */
const TAG_WORDS: Readonly<Record<RelationTag, readonly string[]>> = {
  kin: [
    "family", "relative", "relation", "kinship", "kinsman", "kinswoman", "brother", "sister", "sibling", "twin", "mother", "father", "mum", "mom",
    "mam", "dad", "parent", "son", "daughter", "child", "cousin", "aunt", "auntie", "uncle", "niece", "nephew", "grandmother", "grandfather",
    "grandparent", "grandma", "grandpa", "gran", "granny", "grandad", "granddad", "granddaughter", "grandson", "grandchild", "spouse", "husband",
    "wife", "partner", "stepmother", "stepfather", "stepbrother", "stepsister", "stepson", "stepdaughter",
  ],
  friend: [
    "neighbour", "neighbor", "colleague", "coworker", "co worker", "workmate", "pal", "mate", "chum", "friendly", "flatmate", "housemate",
    "roommate", "lodger", "crew", "crewmate", "shipmate",
  ],
  rival: ["dislike", "enemy", "rivalry", "nemesis", "grudge", "foe", "competitor"],
  wary: ["cautious", "suspicious", "distrust", "distrustful", "mistrust", "uneasy", "guarded"],
  curious: ["interested", "intrigued", "curiosity"],
  fond: ["fondness", "affection", "affectionate"],
};
const TAG_OF = new Map<string, RelationTag>([
  ...RELATION_TAGS.map(t => [t, t] as const),
  ...(Object.entries(TAG_WORDS) as [RelationTag, readonly string[]][]).flatMap(([tag, list]) => list.map(w => [w, tag] as const)),
]);
const tagWord = (w: string): RelationTag | null => TAG_OF.get(w) ?? (w.endsWith("s") ? TAG_OF.get(w.slice(0, -1)) ?? null : null);

/**
 * A relationship tag through the synonym table: the whole phrase, "… in law", then its words from the last (the head
 * noun: "older brother", "old friend", "fond of"). A negated phrase ("not friendly") maps to nothing. Null: unknown.
 */
export function relationTagOf(v: unknown): RelationTag | null {
  if (!isStr(v)) return null;
  const s = v.toLowerCase().replace(/[_\-/]+/g, " ").replace(/[^\p{L} ]+/gu, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const whole = tagWord(s);
  if (whole) return whole;
  if (/\bin law\b/.test(s)) return "kin";
  const words = s.split(" ");
  if (words.some(w => w === "not" || w === "no" || w === "never")) return null;
  for (const w of [...words].reverse()) { const t = tagWord(w); if (t) return t; }
  return null;
}

// ── V13: places ─────────────────────────────────────────────────────────────

/**
 * A place id as the registry has it: an exact id stays; a case or spacing slip is fixed; "home" is the household's
 * home; a bare local id ("market_street") takes its zone when exactly one registered place has that local id. Anything
 * else is returned as it is, for V13.
 */
function placeFixer(ctx: ValidationContext, home: string): (v: string) => string {
  const known = new Set([...ctx.places, home, HOME_TOKEN]);
  const byLocal = new Map<string, string[]>();
  for (const p of ctx.places) {
    const dot = p.indexOf(".");
    if (dot > 0) byLocal.set(p.slice(dot + 1), [...(byLocal.get(p.slice(dot + 1)) ?? []), p]);
  }
  return v => {
    if (known.has(v)) return v;
    const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (known.has(s)) return s;
    if (s === "home") return home;
    const only = s.includes(".") ? undefined : byLocal.get(s);
    return only?.length === 1 ? only[0]! : v;
  };
}

// ── V08: Big Five ───────────────────────────────────────────────────────────

type Big5 = Record<Big5Key, number>;
const vec = (b: Big5): number[] => BIG5_KEYS.map(k => b[k]);
const extreme = (b: Big5): boolean => BIG5_KEYS.some(k => b[k] >= 70 || b[k] <= 30);

function shuffled<T>(xs: readonly T[], rng: SeededRng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = rng.int(0, i); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

/**
 * The smallest move of `me`'s scores (the summed change) that sets it 15+ apart from every earlier member on two traits,
 * keeping each score in 0–100 and keeping a trait at 70+ or 30− if it had one. The candidates for a trait are its own
 * score or exactly 15 from an earlier member's; ties go by `rng` (seeded by the household). Null: no move does it.
 */
export function nudgeBig5(me: Big5, earlier: readonly Big5[], rng: SeededRng): Big5 | null {
  const passes = (b: Big5) => earlier.every(e => big5Apart(vec(b), vec(e))) && (!extreme(me) || extreme(b));
  const keys = shuffled(BIG5_KEYS, rng);
  const options = new Map(keys.map(k => {
    const alt = [...new Set(earlier.flatMap(e => [e[k] - BIG5_APART, e[k] + BIG5_APART]))].filter(v => v >= 0 && v <= 100 && v !== me[k]);
    return [k, [me[k], ...shuffled(alt, rng)]] as const;
  }));
  const pick: Big5 = { ...me };
  let best: Big5 | null = null, bestCost = Infinity;
  const walk = (i: number, cost: number): void => {
    if (cost >= bestCost) return;
    if (i === keys.length) { if (passes(pick)) { best = { ...pick }; bestCost = cost; } return; }
    const k = keys[i]!;
    for (const v of options.get(k)!) { pick[k] = v; walk(i + 1, cost + Math.abs(v - me[k])); }
    pick[k] = me[k];
  };
  walk(0, 0);
  return best;
}

// ── The repair ──────────────────────────────────────────────────────────────

/**
 * Repair a parsed household reply (anything parseJsonObject returned) against its draw, before validateHousehold:
 *  1. V06/V07 lengths over their caps are trimmed (trimToWords); an appearance keeps its attire word or is left alone.
 *  2. Enums: relationship tags through the synonym table (an unknown tag with positive affinity becomes "fond"; with
 *     none, the tie is dropped unless it is required or the member's last); pronouns, story roles and routine verbs in
 *     another spelling. A required tie takes the tag the engine requires (kin).
 *  3. V13: a bare local place id takes its zone when exactly one place has it.
 *  4. V14: ties to the member themself (slot or id) and second ties to one person are dropped; a housemate's slot
 *     becomes their id (the others' slots stay: assembly resolves them to the household tie); affinity and trust are
 *     rounded and held to tieLimit's range (±100 for the household and required ties, which keep their numbers).
 *  5. V11: too few qualifying likes → the archetype's likes are added until enough qualify; the model's last
 *     non-qualifying likes go if the list would pass five.
 *  6. V08: Big Five rounded into 0–100, and a member too close to an earlier one nudged just apart (nudgeBig5).
 * Deterministic and idempotent: a repaired reply repairs to itself, and a reply that passes comes back equal.
 */
export function repairHousehold(raw: unknown, draw: HouseholdDraw, ctx: ValidationContext): HouseholdRepair {
  const adjustments: string[] = [];
  if (!isRec(raw)) return { output: raw, adjustments };
  const out = structuredClone(raw);
  const note = (line: string) => { adjustments.push(line); };
  const native = ctx.profile === "native";
  const place = placeFixer(ctx, ctx.home ?? HOME_TOKEN);
  const housemateBySlot = new Map((draw.native?.housemates ?? []).map(h => [h.slot, h.id]));
  const pinnedBySlot = new Map(draw.members.flatMap(m => (m.native?.pinned ? [[m.slot, m.native.pinned.id] as const] : [])));
  const slots = new Set(draw.members.map(m => m.slot));
  const knownId = (id: string) => slots.has(id) || housemateBySlot.has(id) || ctx.residents.has(id);

  const trim = (holder: Rec, key: string | number, max: number, path: string, rule = "V07", fits?: (s: string) => boolean) => {
    const v = holder[key];
    if (!isStr(v)) return;
    const cut = trimToWords(v, max, fits);
    if (cut === v || (fits && !fits(cut))) return;
    holder[key] = cut;
    const sentences = rule === "V06" ? `; ${countSentences(v)} to ${countSentences(cut)} sentences` : "";
    note(`${rule} ${path} trimmed from ${countWords(v)} to ${countWords(cut)} words${sentences}`);
  };
  const trimAll = (list: unknown, max: number, path: string) => {
    if (Array.isArray(list)) list.forEach((_, k) => trim(list as unknown as Rec, k, max, `${path}[${k}]`));
  };

  if (isRec(out.household)) trim(out.household, "summary", LENGTH_CAPS.summary, "household.summary");
  const members = Array.isArray(out.members) ? out.members : [];
  members.forEach((m: unknown, i) => {
    if (!isRec(m)) return;
    const d = draw.members[i];
    const at = `members[${i}]`;
    // 1. Lengths.
    trim(m, "occupation", LENGTH_CAPS.occupation, `${at}.occupation`);
    trim(m, "backstory", LENGTH_CAPS.backstory, `${at}.backstory`);
    if (isStr(m.appearance)) {
      const tags = d ? memberTags(d) : null;
      const attire = tags !== null && mentionsAttire(m.appearance, tags);
      trim(m, "appearance", LENGTH_CAPS.appearance, `${at}.appearance`, "V06", s => countSentences(s) <= APPEARANCE_SENTENCES && (!attire || mentionsAttire(s, tags!)));
    }
    if (isRec(m.voice)) { trim(m.voice, "register", LENGTH_CAPS.register, `${at}.voice.register`); trimAll(m.voice.samples, LENGTH_CAPS.sample, `${at}.voice.samples`); }
    if (isRec(m.dream)) { trim(m.dream, "text", LENGTH_CAPS.dreamText, `${at}.dream.text`); trimAll(m.dream.stages, LENGTH_CAPS.stage, `${at}.dream.stages`); }
    if (Array.isArray(m.secrets)) m.secrets.forEach((s: unknown, k) => { if (isRec(s)) trim(s, "text", LENGTH_CAPS.secret, `${at}.secrets[${k}].text`); });

    // 2. Enums (relationship tags below, with the ties).
    if (isStr(m.pronouns) && !(PRONOUNS as readonly string[]).includes(m.pronouns)) {
      const p = pronounsOf(m.pronouns);
      if (p) { note(`V05 ${at}.pronouns ${show(m.pronouns)} → ${show(p)}`); m.pronouns = p; }
    }
    if (!(STORY_ROLES as readonly unknown[]).includes(m.story_role)) {
      const role = storyRoleOf(m.story_role);
      note(`V18 ${at}.story_role ${show(m.story_role)} → ${show(role)}`);
      m.story_role = role;
    }

    // 3. Places.
    if (isStr(m.workplace)) {
      const w = place(m.workplace);
      if (w !== m.workplace) { note(`V13 ${at}.workplace ${show(m.workplace)} → ${show(w)}`); m.workplace = w; }
    }
    if (isRec(m.routine)) for (const day of ["weekday", "weekend"] as const) {
      const list = m.routine[day];
      if (!Array.isArray(list)) continue;
      list.forEach((e: unknown, k) => {
        if (!isRec(e)) return;
        if (isStr(e.where)) {
          const w = place(e.where);
          if (w !== e.where) { note(`V13 ${at}.routine.${day}[${k}].where ${show(e.where)} → ${show(w)}`); e.where = w; }
        }
        if (isStr(e.do) && !(VERBS as readonly string[]).includes(e.do)) {
          const v = verbOf(e.do);
          if (v) { note(`V13 ${at}.routine.${day}[${k}].do ${show(e.do)} → ${show(v)}`); e.do = v; }
        }
      });
    }

    // 4. Relationships.
    if (d && Array.isArray(m.relationships)) m.relationships = repairTies(m.relationships, d.slot, d.native?.pinned?.id ?? null, `${at}.relationships`);

    // 5. Likes.
    if (d && Array.isArray(m.likes) && m.likes.every(isStr)) {
      const a = memberArchetype(d, draw);
      const rule = likeRule(a, ctx);
      const likes: string[] = [...m.likes];
      let have = likes.filter(rule.qualifies).length;
      if (have < rule.need) {
        const lower = (s: string) => s.trim().toLowerCase();
        const dislikes = new Set((Array.isArray(m.dislikes) ? m.dislikes.filter(isStr) : []).map(lower));
        const added: string[] = [];
        for (const l of a.likes) {
          if (have >= rule.need) break;
          if (likes.some(x => lower(x) === lower(l)) || dislikes.has(lower(l))) continue;
          likes.push(l); added.push(l); have++;
        }
        const dropped: string[] = [];
        for (let k = m.likes.length - 1; k >= 0 && likes.length > LIKES_RANGE[1]; k--) {
          if (rule.qualifies(likes[k]!)) continue;
          dropped.unshift(likes[k]!);
          likes.splice(k, 1);
        }
        if (added.length) {
          note(`V11 ${at}.likes: added ${added.map(show).join(", ")} from the archetype's list${dropped.length ? `; dropped ${dropped.map(show).join(", ")} to stay within ${LIKES_RANGE[1]}` : ""}`);
          m.likes = likes;
        }
      }
    }
  });

  // 6. Big Five.
  const scores: (Big5 | null)[] = members.map((m: unknown, i) => {
    const b = isRec(m) && isRec(m.personality) && isRec(m.personality.big5) ? m.personality.big5 : null;
    if (!b || !BIG5_KEYS.every(k => typeof b[k] === "number" && Number.isFinite(b[k]))) return null;
    for (const k of BIG5_KEYS) {
      const v = b[k] as number, next = Math.max(0, Math.min(100, Math.round(v))) || 0;
      if (next !== v) { note(`V08 members[${i}].personality.big5.${k} ${v} → ${next}`); b[k] = next; }
    }
    return b as Big5;
  });
  scores.forEach((me, j) => {
    if (!me || j === 0) return;
    const earlier = scores.slice(0, j).map((b, i) => [b, i] as const).filter((x): x is readonly [Big5, number] => !!x[0]);
    const close = earlier.filter(([b]) => !big5Apart(vec(me), vec(b))).map(([, i]) => `members[${i}]`);
    if (!close.length) return;
    const next = nudgeBig5(me, earlier.map(([b]) => b), SeededRng.of(draw.id, "big5", j));
    if (!next) return;
    const moved = BIG5_KEYS.filter(k => next[k] !== me[k]).map(k => `${k} ${me[k]} → ${next[k]}`);
    note(`V08 members[${j}].personality.big5 nudged apart from ${close.join(", ")}: ${moved.join(", ")}`);
    for (const k of BIG5_KEYS) me[k] = next[k];
  });
  return { output: out, adjustments };

  /** Step 4 for one member's ties (and their tags, step 2). */
  function repairTies(list: unknown[], ownSlot: string, ownId: string | null, path: string): unknown[] {
    const unique: unknown[] = [];
    const seen = new Set<string>();
    for (const r of list) {
      if (!isRec(r) || !isStr(r.id)) { unique.push(r); continue; }
      const before = r.id;
      let id = before.trim();
      if (!knownId(id) && knownId(id.toLowerCase())) id = id.toLowerCase();
      const mate = housemateBySlot.get(id);
      if (mate) id = mate;
      if (id !== before) { note(`V14 ${path} ${show(before)} → ${show(id)}${mate ? " (a housemate's slot)" : ""}`); r.id = id; }
      if (id === ownSlot || id === ownId) { note(`V14 ${path}: dropped the tie to themself (${show(before)})`); continue; }
      const who = pinnedBySlot.get(id) ?? id;
      if (seen.has(who)) { note(`V14 ${path}: dropped a second tie to ${show(id)}`); continue; }
      seen.add(who);
      unique.push(r);
    }
    const required = native ? (ctx.requiredLinks ?? []).filter(l => l.slot === ownSlot) : [];
    const kept: unknown[] = [];
    let left = unique.length;
    for (const r of unique) {
      if (!isRec(r)) { kept.push(r); continue; }
      const id = isStr(r.id) ? r.id : "";
      const tie = `${path} ${show(id)}`;
      const need = required.find(l => l.id === id);
      if (!(RELATION_TAGS as readonly unknown[]).includes(r.tag)) {
        const mapped = relationTagOf(r.tag);
        if (mapped) { note(`V01 ${tie}.tag ${show(r.tag)} → ${show(mapped)}`); r.tag = mapped; }
        else if (!need?.tag) {
          // Not a word the table knows (a required kin tie takes "kin" below): warm means fond; otherwise the tie goes,
          // unless it is required or the member's last (V01 then says why).
          if (typeof r.affinity === "number" && r.affinity > 0) { note(`V01 ${tie}.tag ${show(r.tag)} → "fond" (not a tag; positive affinity)`); r.tag = "fond"; }
          else if (!need && left > 1) { note(`V01 ${tie}: dropped (${show(r.tag)} is not a tag, affinity ${show(r.affinity)})`); left--; continue; }
        }
      }
      if (need?.tag && r.tag !== need.tag) { note(`V14 ${tie}.tag ${show(r.tag)} → ${show(need.tag)} (a required ${need.tag} tie)`); r.tag = need.tag; }
      const lim = tieLimit(id, ownSlot, draw, ctx);
      for (const key of ["affinity", "trust"] as const) {
        const v = r[key];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const next = bound(v, lim);
        if (next !== v) { note(`V14 ${tie}.${key} ${v} → ${next}${Math.abs(Math.round(v)) > lim ? ` (within ±${lim})` : ""}`); r[key] = next; }
      }
      kept.push(r);
    }
    return kept;
  }
}
