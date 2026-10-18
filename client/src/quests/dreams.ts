// Dreams as side quests (GDD §9.3 `dream`, §9.9, Appendix A.2; Kasey's playtest 2026-10-18: "we need side quests if
// there aren't any"). Pure: no Phaser, no DOM. quests/runtime.ts runs it against the registry.
//
// - Rules: each card's stages, parsed by shared/src/dreams.ts, become a StageRule: gates that must hold (a Regard, a
//   story flag, a Project, Rook's fair Scuffles, a kind of newcomer), and the deed that completes it:
//     favor   the stage's Favor done (an explicit "(Favor…)", or a stage with nothing to check: shared `fallback`);
//     signal  a flag the story sets ("(sets flag.clock_running)": S07a or PZ-15 does it, the dream waits for it), even
//             when the stage names a Favor too (the story's choices aren't a chore's to make);
//     gates   the gates alone ("(Regard ≥ 30)": she admits it once she trusts you that much).
//   "(sets flag.x)" for a flag nothing else in the game writes (barney_confessed, bastien_in_pub…) is the dream's own:
//   doing the stage sets it, so the canon locks that read it (§9.3) move on with the dream.
// - Learning (§9.9 doesn't say how the player finds out): a dream becomes a known side quest when the resident, met,
//   trusts the player as far as its first stage asks ("(Regard ≥ 40)": Barney talks about the books then), else at
//   Neighbor (LEARN_REGARD); when the story has already done one of its stages; and a "(hidden)" dream only when its
//   first stage is done (the resident finally says it). GDD-GAP: the client gets no topic from a conversation (the
//   dialogue turn carries lines, choices and Regard, not effects.topic), so a talk teaches a dream through the Regard it
//   earns, checked after every conversation.
// - Advancing: stages go in order. A later stage whose story flag is already set carries the dream there at once (the
//   clock runs: Bertrand's dream is done, whatever was left of its errands).
// - Rewards (§9.9: "Regard +5 to +15 … or dream-stage progress"): a stage done by its Favor is paid by the Favor (+10,
//   the engine's reward); any other stage earns STAGE_REGARD; finishing the dream earns FINAL_REGARD in all.
import { ARCHETYPE_IDS, dreamRewardTag, dreamStages, dreamWords, isHiddenDream, type DreamProgress, type Favor, type PersonaCard } from '@monde/shared';

export type Gate =
  /** The player's Regard with `who` (the dreamer, unless the stage names someone). */
  | { kind: 'regard'; min: number; who: string }
  | { kind: 'flag'; flag: string }
  /** `done`: open; otherwise under way (begun or open). */
  | { kind: 'project'; project: string; done: boolean }
  /** Fair Scuffles won on Rook's quarry track (§7: `sc_quarry_rook_1/2/3`, "a fair fight"). */
  | { kind: 'scuffles'; won: number }
  /** A newcomer of one of these archetypes lives in Monde (G-02). */
  | { kind: 'arrival'; archetypes: string[] };

export type Deed = 'favor' | 'signal' | 'gates';

export interface StageRule {
  index: number;
  /** The stage's words (the Journal's line, the prompt's dream stage). */
  words: string;
  gates: Gate[];
  deed: Deed;
  /** A story flag that, once set, means this stage is done (even if its gates or Favor never were). */
  signal: string | null;
  /** The dream's own flags, set when the stage is done. */
  sets: string[];
  /** What the stage's Favor clause asks ("be there at eleven"), for the Journal; null for a bare Favor. */
  ask: string | null;
  /** Nothing in the stage the engine could check: worked as a Favor. */
  fallback: boolean;
  /** Parenthetical notes the engine doesn't read ("he answers only while counting"). */
  notes: string[];
}

export interface DreamRules {
  resident: string;
  /** The dream in the resident's words. */
  text: string;
  hidden: boolean;
  stages: StageRule[];
}

export interface RuleContext {
  /** A name as a stage writes it ("Kasimir", "Hollis") → a resident id; null when it names nobody in particular. */
  resolve(name: string): string | null;
  /** Who sets a flag: the story (a scene, a Project, a puzzle, a Mark, the town engine), only a dream, or nothing declared. */
  owner(flag: string): 'story' | 'dream' | 'unknown';
}

/** GDD-GAP: §9.9 doesn't say when the player learns a dream. Neighbor (§9.11.1: Regard 20–39), unless its first stage asks for more. */
export const LEARN_REGARD = 20;
/** GDD-GAP: a stage done without a Favor earns the bottom of §9.9's Favor range. */
export const STAGE_REGARD = 5;
/** GDD-GAP: the dream's last stage earns the top of §9.9's range, a Favor's own Regard included. */
export const FINAL_REGARD = 15;

/**
 * A.2 #9 `cook_baker` "carries the tags baker and cook; dream stages elsewhere that ask for 'a baker or a cook' match
 * this archetype". GDD-GAP: no other archetype declares tags, so 'constable', 'publican', 'writer'… match an archetype
 * only by its id, and no Spring arrival is one.
 */
export const ARCHETYPE_TAGS: Readonly<Record<string, readonly string[]>> = { baker: ['cook_baker'], cook: ['cook_baker'] };
const archetypesFor = (tags: readonly string[]): string[] =>
  [...new Set(tags.flatMap(t => ARCHETYPE_TAGS[t] ?? ((ARCHETYPE_IDS as readonly string[]).includes(t) ? [t] : [])))];

/** One card's dream as rules. */
export function dreamRules(card: Pick<PersonaCard, 'id' | 'dream'>, ctx: RuleContext): DreamRules {
  const stages = dreamStages(card).map((parsed, index): StageRule => {
    const gates: Gate[] = [], sets: string[] = [], notes: string[] = [];
    let favor = false, ask: string | null = null, signal: string | null = null;
    for (const c of parsed.clauses) {
      switch (c.kind) {
        case 'regard': gates.push({ kind: 'regard', min: c.min, who: (c.with && ctx.resolve(c.with)) || card.id }); break;
        case 'needs': gates.push({ kind: 'flag', flag: c.flag }); break;
        case 'project': gates.push({ kind: 'project', project: c.project, done: c.done }); break;
        case 'scuffles': gates.push({ kind: 'scuffles', won: c.won }); break;
        case 'arrival': gates.push({ kind: 'arrival', archetypes: archetypesFor(c.tags) }); break;
        case 'favor': favor = true; ask ??= c.ask; break;
        case 'signal': if (ctx.owner(c.flag) === 'dream') sets.push(c.flag); else signal ??= c.flag; break;
        case 'note': notes.push(c.text); break;
      }
    }
    // "(Favor: put him on the bandstand rebuild; Project bandstand)": with a Favor, a Project is the work under way;
    // "(Project bandstand; sets flag.bandstand_rebuilt)": alone, the Project is the deed, done when it opens.
    // "(Project ferry done)" says so itself.
    if (!favor) for (const g of gates) if (g.kind === 'project') g.done = true;
    // A flag the story sets is the story's to give: "(Favor: sign Delacroix's letter; sets flag.vanes_coin)" is S06's
    // choice, so no chore stands in for it.
    const deed: Deed = signal ? 'signal' : favor || parsed.fallback ? 'favor' : gates.length ? 'gates' : 'favor';
    return { index, words: parsed.words, gates, deed, signal, sets, ask, fallback: parsed.fallback, notes };
  });
  return { resident: card.id, text: dreamWords(card.dream.text), hidden: isHiddenDream(card.dream.text), stages };
}

// ── The world a check reads ─────────────────────────────────────────────────────────────────────────────────────

export interface DreamWorld {
  day: number;
  /** The player's Regard with a resident (the mirror: scenes/friendship.ts regardFor). */
  regard(id: string): number;
  /** The player has met them (the Journal's People). */
  met(id: string): boolean;
  /** The story's flags and the town engine's. */
  flags: ReadonlySet<string>;
  /** A Town Project: begun and not open, open, or neither (a Project the Spring doesn't have). */
  project(id: string): 'none' | 'begun' | 'open';
  /** Fair Scuffles won on Rook's quarry track. */
  fairWins: number;
  /** The archetypes of the newcomers living in Monde. */
  arrivals: ReadonlySet<string>;
  /** The favor book. */
  favors: readonly Pick<Favor, 'id' | 'resident_id' | 'status' | 'expires_day' | 'reward'>[];
  /** Residents with a Leaving Notice (§6.4): their one open Favor is kept for the Last Chance. */
  leaving?: ReadonlySet<string>;
}

export function gateHolds(g: Gate, w: DreamWorld): boolean {
  switch (g.kind) {
    case 'regard': return w.regard(g.who) >= g.min;
    case 'flag': return w.flags.has(g.flag);
    case 'project': { const s = w.project(g.project); return g.done ? s === 'open' : s !== 'none'; }
    case 'scuffles': return w.fairWins >= g.won;
    case 'arrival': return g.archetypes.some(a => w.arrivals.has(a));
  }
}

/** The completed Favor that did this stage, if any. */
export const stageFavor = (rules: DreamRules, stage: number, w: Pick<DreamWorld, 'favors'>) =>
  w.favors.find(f => f.status === 'completed' && f.reward.dream === dreamRewardTag(rules.resident, stage));

/** What completes the stage now ('favor', 'regard', 'gates', 'story'), or null. */
export function stageMet(rules: DreamRules, stage: number, w: DreamWorld): DreamProgress['done'][number]['by'] | null {
  const rule = rules.stages[stage];
  if (!rule) return null;
  if (rule.signal && w.flags.has(rule.signal)) return 'story';
  if (!rule.gates.every(g => gateHolds(g, w))) return null;
  if (rule.deed === 'favor') return stageFavor(rules, stage, w) ? 'favor' : null;
  if (rule.deed === 'signal') return null;
  return rule.gates.every(g => g.kind === 'regard') ? 'regard' : 'gates';
}

export type LearnedBy = DreamProgress['how'];

/** How the player comes to know the dream now, or null (not yet, or it waits for its first stage). */
export function learnHow(rules: DreamRules, w: DreamWorld): LearnedBy | null {
  if (rules.hidden) return null;
  if (rules.stages.some(s => s.signal && w.flags.has(s.signal))) return 'story';
  if (!w.met(rules.resident)) return null;
  const first = rules.stages[0]?.gates.find((g): g is Extract<Gate, { kind: 'regard' }> => g.kind === 'regard' && g.who === rules.resident);
  return w.regard(rules.resident) >= (first?.min ?? LEARN_REGARD) ? 'regard' : null;
}

export interface StageDone {
  resident: string;
  /** The stage's index (0-based). */
  stage: number;
  words: string;
  by: DreamProgress['done'][number]['by'];
  /** Regard to add for it (a Favor's own reward is paid by the Favor). */
  regard: number;
  /** The dream's own flags to set. */
  sets: string[];
  /** The dream's last stage. */
  final: boolean;
  /** Passed over because the story reached a later stage first: done, unpaid. */
  skipped: boolean;
}

export interface DreamCheck {
  dreams: Record<string, DreamProgress>;
  learned: { resident: string; how: LearnedBy }[];
  done: StageDone[];
}

function reward(rules: DreamRules, stage: number, by: StageDone['by'], w: DreamWorld): number {
  const final = stage === rules.stages.length - 1;
  if (by !== 'favor') return final ? FINAL_REGARD : STAGE_REGARD;
  return final ? Math.max(0, FINAL_REGARD - (stageFavor(rules, stage, w)?.reward.regard ?? 0)) : 0;
}

/**
 * Learn and advance every dream against the world now. Returns the new progress (the same object when nothing
 * changed), what was learned and every stage done, in order.
 */
export function checkDreams(dreams: Readonly<Record<string, DreamProgress>>, all: readonly DreamRules[], w: DreamWorld): DreamCheck {
  let out: Record<string, DreamProgress> | null = null;
  const learned: DreamCheck['learned'] = [], done: StageDone[] = [];
  for (const rules of all) {
    const total = rules.stages.length;
    let p = dreams[rules.resident];
    if (!p) {
      const how = learnHow(rules, w) ?? (rules.hidden && w.met(rules.resident) && stageMet(rules, 0, w) ? 'stage' : null);
      if (!how) continue;
      p = { learned: w.day, how, stage: 0, done: [] };
      learned.push({ resident: rules.resident, how });
    }
    const before = p;
    while (p.stage < total) {
      // The story got further first: everything up to its stage is done.
      let ahead = -1;
      for (let j = total - 1; j > p.stage; j--) if (rules.stages[j]!.signal && w.flags.has(rules.stages[j]!.signal!)) { ahead = j; break; }
      const by = ahead > p.stage ? 'story' : stageMet(rules, p.stage, w);
      if (!by) break;
      const upTo = ahead > p.stage ? ahead : p.stage;
      const entries = [...p.done];
      for (let s = p.stage; s <= upTo; s++) {
        const rule = rules.stages[s]!, skipped = s < upTo;
        const sBy = skipped ? 'story' : by;
        entries.push({ stage: s, day: w.day, by: sBy, printed: null });
        done.push({ resident: rules.resident, stage: s, words: rule.words, by: sBy, regard: skipped ? 0 : reward(rules, s, sBy, w),
          sets: rule.sets, final: s === total - 1, skipped });
      }
      p = { ...p, stage: upTo + 1, done: entries };
    }
    if (p !== before || !dreams[rules.resident]) (out ??= { ...dreams })[rules.resident] = p;
  }
  return { dreams: out ?? (dreams as Record<string, DreamProgress>), learned, done };
}

// ── Favors to offer (§9.9: "each stage can spawn a Favor") ───────────────────────────────────────────────────────

/** The open Favors limit (§9.9: "at most 6 open across the town"). */
export const OPEN_FAVORS_MAX = 6;
/**
 * GDD-GAP: §9.9 doesn't share the six between kinds of Favor. The dreams take at most half, so the residents' own asks,
 * Quiet Mode's chores and a Last Chance (§6.4) keep room.
 */
export const DREAM_FAVORS_MAX = 3;

const open = (f: Pick<Favor, 'status' | 'expires_day'>, day: number): boolean => ['proposed', 'accepted'].includes(f.status) && f.expires_day >= day;

/**
 * Known dreams whose current stage is a Favor, its gates holding, with no Favor for it on the book, from residents
 * with no other open Favor (§9.9: one each) and no stage done today, up to DREAM_FAVORS_MAX and the town's limit. `offered(resident, stage)`: the book already has
 * this window's Favor for it (declined or expired: it's asked again in the next window).
 */
export function dueDreamFavors(dreams: Readonly<Record<string, DreamProgress>>, all: readonly DreamRules[], w: DreamWorld,
  offered: (resident: string, stage: number) => boolean): { resident: string; stage: number }[] {
  let openCount = w.favors.filter(f => open(f, w.day)).length;
  let dreamCount = w.favors.filter(f => open(f, w.day) && f.reward.dream).length;
  const out: { resident: string; stage: number }[] = [];
  for (const rules of all) {
    const p = dreams[rules.resident];
    const rule = p && rules.stages[p.stage];
    if (!p || !rule || rule.deed !== 'favor' || openCount >= OPEN_FAVORS_MAX || dreamCount >= DREAM_FAVORS_MAX || w.leaving?.has(rules.resident)) continue;
    if (!rule.gates.every(g => gateHolds(g, w))) continue;
    // GDD-GAP: §9.9 sets no pace. A dream's next Favor is asked the day after its last stage was done, so a dream takes
    // days rather than one morning of chores.
    if (p.done.at(-1)?.day === w.day) continue;
    const tag = dreamRewardTag(rules.resident, p.stage);
    if (w.favors.some(f => f.reward.dream === tag && (open(f, w.day) || f.status === 'completed'))) continue;
    if (w.favors.some(f => f.resident_id === rules.resident && open(f, w.day)) || offered(rules.resident, p.stage)) continue;
    out.push({ resident: rules.resident, stage: p.stage });
    openCount++; dreamCount++;
  }
  return out;
}

/** The Favor on the book for a dream's current stage (proposed or accepted, not expired), if any. */
export const currentStageFavor = <F extends Pick<Favor, 'status' | 'expires_day' | 'reward'>>(rules: DreamRules, stage: number, favors: readonly F[], day: number): F | undefined =>
  favors.find(f => f.reward.dream === dreamRewardTag(rules.resident, stage) && open(f, day));
