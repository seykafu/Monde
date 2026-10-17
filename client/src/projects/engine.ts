// The Projects engine (GDD §6.3, MVP G-03). Pure: no Phaser, no DOM. Every function takes the state and returns a
// new one (inputs are never mutated), so the game, the Ledger and the tests all see the same answers.
//
// A Project moves through
//   locked → open → funded → gathering → building → puzzle → ready → opened
// and its stage is derived from its progress, never stored: `open` waits for Pell's signature (and the coins),
// `funded` has nothing handed over yet, `gathering` is short of materials, `building` is short of hours, `puzzle`
// waits for its §15 board, `ready` waits for the opening ceremony, and `opened` is done. Materials and hours can
// come in either order once it's funded (S04: "It will run when the fittings come and the hours are in").
//
// The numbers are §6.3's: the Fund cost, the materials, VH (the player's 1 per 10 Stamina, residents' 2 per day
// assigned), and the completion Pillars through the town engine's `project` source. §11.1's perks: Tinkerer VH
// count 1.5×, Organizer volunteers say yes at 10 less Regard; §11.2 Handiwork 5 cuts a home's materials by 20%.
import { wharfClosed } from '../town/optionClause';
import type { Economy, Pillar, SavedProjects } from '@monde/shared';
import { PASS_OUT } from '../sim/clock';
import { postToFund } from '../town/fund';
import { restoreHome } from '../town/occupancy';
import { TOWN_FLAGS, applyPillarDeltas, setTownFlag, type TownFlag, type TownState } from '../town/pillars';
import type { MaterialNeed, ProjectDef } from './schema';

export type ProjectsState = SavedProjects;
export type Progress = ProjectsState['projects'][string];
export type Stage = 'locked' | 'open' | 'funded' | 'gathering' | 'building' | 'puzzle' | 'ready' | 'opened';
export const STAGES: readonly Stage[] = ['locked', 'open', 'funded', 'gathering', 'building', 'puzzle', 'ready', 'opened'];

/** What the engine reads of the world: the time, the story's and town's flags, the puzzles, the player's perks. */
export interface ProjectWorld {
  wharfPaused?: boolean;
  day: number;
  minute: number;
  flags: ReadonlySet<string>;
  puzzleSolved(id: string): boolean;
  /** §11.2 Handiwork 5: homes take 20% fewer materials (economy skillPerks homeMaterialMultiplier). */
  homeMaterialMultiplier?: number;
}

/** Homes use their actual target district, not the generic homes definition's district. */
export const projectPaused = (def: ProjectDef, p: Progress | undefined, world: { wharfPaused?: boolean }): boolean =>
  !!world.wharfPaused && (p?.target ? p.target.startsWith('wharf.') : def.zone === 'wharf');

// ── Numbers ─────────────────────────────────────────────────────────────────

/** §6.3: "1 VH per 10 Stamina"; §8: 60 game minutes per VH. */
export const PLAYER_VH_STAMINA = 10;
export const PLAYER_VH_MINUTES = 60;
/** §11.1 Tinkerer: "The player's VH counts 1.5×". */
export const TINKERER_VH = 1.5;
/** §6.3: "Each volunteer gives 2 VH per day assigned." */
export const VOLUNTEER_VH_PER_DAY = 2;
/** GDD-GAP: §11.2 gives Handiwork XP from Projects with no amount; 10 a shift, as community work pays (§8). */
export const PROJECT_XP_PER_SHIFT = 10;
/**
 * GDD-GAP: §9.9 has no threshold for a resident agreeing to help. Acquaintance (Regard 20, §12.1 rule 6), 10 less
 * for an Organizer (§11.1) and 10 less again for a resident whose highest-weighted value (§9.3 `values`, standing
 * in for §9.4's server-side stances) is a Pillar the Project raises. Leads always say yes to their own Project.
 */
export const VOLUNTEER_REGARD = 20;
export const ORGANIZER_DISCOUNT = 10;
export const KEEN_DISCOUNT = 10;
/** GDD-GAP: a cap on hands per Project per day, so one site isn't swamped (four, plus its leads). */
export const MAX_VOLUNTEERS_PER_DAY = 4;
/** GDD-GAP: the Tollmen, Vane and his assistant don't sign up for the town's Projects in Spring. */
export const NEVER_VOLUNTEER: ReadonlySet<string> = new Set(['rook', 'bru', 'nettie', 'vane', 'ines']);
/** §6.3: donations from residents with Regard 40 or more, up to 5% of their savings, once per Project. */
export const DONATION_REGARD = 40;
export const DONATION_SHARE = 0.05;
/** GDD-GAP: residents have no savings model yet; 400 coins each stands in, so a donation is 20 coins. */
export const SAVINGS_STANDIN = 400;
/** GDD-GAP: no donations from the Mayor to her own Fund, nor from the Tollmen, Vane or Ines. */
export const NEVER_DONATE: ReadonlySet<string> = new Set(['pell', 'rook', 'bru', 'nettie', 'vane', 'ines']);
/** GDD-GAP: a resident gives an authored material (content `donors`) at Regard 10 or more. */
export const MATERIAL_DONOR_REGARD = 10;
/** GDD-GAP: an opening is set 90 minutes after the last thing is in (a half hour on), from 10:00 and no later than 18:00. */
export const CEREMONY_LEAD_MINUTES = 90;
export const CEREMONY_EARLIEST = 10 * 60;
export const CEREMONY_LATEST = 18 * 60;
/** GDD-GAP: the opening waits two hours for the player at the site; missed, it's set again the next morning. */
export const CEREMONY_WINDOW = 120;
/** GDD-GAP: the shift volunteers work when the content gives none (content `shift`). */
export const DEFAULT_SHIFT: readonly [string, string] = ['10:00', '13:00'];

export const HOMES = 'homes';

// ── Reading ─────────────────────────────────────────────────────────────────

/** `fountain`, or `homes:old_quarter.vacant_house_39` for one restored house. */
export const homesId = (house: string): string => `${HOMES}:${house}`;
export const defIdOf = (id: string): string => id.split(':')[0]!;
export const defOf = (defs: readonly ProjectDef[], id: string): ProjectDef | undefined => defs.find(d => d.id === defIdOf(id));

/** The materials a Project needs, with Handiwork 5's −20% for homes (GDD-GAP: rounded, at least one of each). */
export function needs(def: ProjectDef, world: Pick<ProjectWorld, 'homeMaterialMultiplier'>): MaterialNeed[] {
  const k = def.id === HOMES ? world.homeMaterialMultiplier ?? 1 : 1;
  return def.materials.map(m => ({ item: m.item, count: k === 1 ? m.count : Math.max(1, Math.round(m.count * k)) }));
}

export const materialsShort = (def: ProjectDef, p: Progress, world: Pick<ProjectWorld, 'homeMaterialMultiplier'>): MaterialNeed[] =>
  needs(def, world).map(m => ({ item: m.item, count: m.count - (p.materials[m.item] ?? 0) })).filter(m => m.count > 0);

export function stageOf(def: ProjectDef, p: Progress | undefined, world: ProjectWorld): Stage {
  if (!p) return 'locked';
  if (p.opened !== null) return 'opened';
  if (projectPaused(def, p, world)) return 'locked';
  if (p.funded === null) return 'open';
  const matShort = materialsShort(def, p, world).length > 0, vhShort = p.vh < def.vh;
  if (matShort || vhShort) {
    const started = Object.values(p.materials).some(n => n > 0) || p.vh > 0;
    return !started ? 'funded' : matShort ? 'gathering' : 'building';
  }
  if (def.puzzle && !world.puzzleSolved(def.puzzle)) return 'puzzle';
  return 'ready';
}

/** Every Project begun (opened ones too), in content order (homes by house). */
export function begun(defs: readonly ProjectDef[], state: ProjectsState): { id: string; def: ProjectDef; progress: Progress }[] {
  return defs.flatMap(def => Object.entries(state.projects).filter(([, p]) => p.def === def.id).map(([id, progress]) => ({ id, def, progress })));
}

/** The one house being restored now, if any (GDD-GAP: Kasimir leads one house at a time). */
export const activeHomes = (state: ProjectsState): string | null =>
  Object.entries(state.projects).find(([, p]) => p.def === HOMES && p.opened === null)?.[0] ?? null;

/** Completion effects (§6.3 "On completion" beyond Pillars): `night_tollmen_minus_1`, `weekly_market`… as now in force. */
export function activeEffects(defs: readonly ProjectDef[], state: ProjectsState): string[] {
  return begun(defs, state).filter(b => b.progress.opened !== null).flatMap(b => b.def.complete.effects);
}

/** §6.3 "night Tollmen −1" per opened Project that carries it, for the Tollmen level (G-08) to read. */
export const nightTollmenReduction = (defs: readonly ProjectDef[], state: ProjectsState): number =>
  activeEffects(defs, state).filter(e => e === 'night_tollmen_minus_1').length;

// ── Changing ────────────────────────────────────────────────────────────────

const fresh = (def: ProjectDef, day: number, target: string | null = null): Progress => ({
  def: def.id, target, unlocked: day, funded: null, signed_by: null, materials: {}, vh: 0, player_vh: 0, volunteer_vh: 0,
  donors: [], material_donors: [], ceremony: null, opened: null, attendees: []
});

const put = (state: ProjectsState, id: string, p: Progress): ProjectsState => ({ ...state, projects: { ...state.projects, [id]: p } });

/** A Project nobody signs for (fund 0: the clocktower) is paid the moment it opens. */
const autoFund = (def: ProjectDef, p: Progress, day: number): Progress =>
  def.signoff.by === 'none' && p.funded === null ? { ...p, funded: day, signed_by: 'none' } : p;

/** Does a day/flag opening apply now (cue-only Projects wait for their scene's cue). */
export function opensNow(def: ProjectDef, world: Pick<ProjectWorld, 'day' | 'flags'>): boolean {
  if (def.repeatable || def.opens.cue) return false;
  return world.day >= (def.opens.day ?? 1) && (!def.opens.flag || world.flags.has(def.opens.flag));
}

/** §6.3 step 1 by day or flag: every Project whose opening has come. */
export function unlockDue(defs: readonly ProjectDef[], state: ProjectsState, world: Pick<ProjectWorld, 'day' | 'flags'>): { state: ProjectsState; unlocked: string[] } {
  let s = state;
  const unlocked: string[] = [];
  for (const def of defs) {
    if (s.projects[def.id] || !opensNow(def, world)) continue;
    s = put(s, def.id, autoFund(def, fresh(def, world.day), world.day));
    unlocked.push(def.id);
  }
  return { state: s, unlocked };
}

export interface CueResult { state: ProjectsState; town: TownState; unlocked: boolean; funded: boolean; known: boolean }

/**
 * A story {project: id} cue (§13.1, "Unlocks a Project"). It opens the Project on or after its day (any cue for a
 * Project that isn't cue-only opens it early). If the scene is the one that carries Pell's signature
 * (`signoff.by: scene`, S04's "Pell signed the chit at seven"), the Fund pays now when it can; a Fund too short leaves it
 * for Pell to sign in person once the coins are raised. Standing volunteers the scene signs on (S04's Tib) start tomorrow.
 */
export function projectCue(defs: readonly ProjectDef[], state: ProjectsState, town: TownState, id: string, sceneId: string, world: Pick<ProjectWorld, 'day'>): CueResult {
  const def = defs.find(d => d.id === id && !d.repeatable);
  if (!def) return { state, town, unlocked: false, funded: false, known: false };
  let s = state, t = town, unlocked = false, funded = false;
  let p = s.projects[id];
  if (!p) { p = autoFund(def, fresh(def, world.day), world.day); unlocked = true; }
  if (!projectPaused(def, p, { wharfPaused: wharfClosed(town) }) && p.funded === null && def.signoff.by === 'scene' && def.opens.cue === sceneId && t.fund >= def.fund) {
    p = { ...p, funded: world.day, signed_by: 'scene' };
    t = postToFund(t, -def.fund);
    funded = true;
  }
  s = put(s, id, p);
  for (const st of def.standing.filter(x => x.scene === sceneId)) {
    if (!s.standing.some(x => x.project === id && x.resident === st.resident)) s = { ...s, standing: [...s.standing, { project: id, resident: st.resident, from: world.day + 1 }] };
  }
  return { state: s, town: t, unlocked, funded, known: true };
}

/** §6.4: start restoring one vacant house (`homes`). Null before Day 10, while another house is under way, or if it's begun. */
export function startHomes(def: ProjectDef, state: ProjectsState, house: string, world: Pick<ProjectWorld, 'day' | 'flags'>): ProjectsState | null {
  if (def.id !== HOMES || world.day < (def.opens.day ?? 1) || activeHomes(state) || state.projects[homesId(house)]) return null;
  if (world.flags.has(`project_${house.slice(house.indexOf('.') + 1)}_done`)) return null;
  return put(state, homesId(house), fresh(def, world.day, house));
}

export type SignResult =
  | { ok: true; state: ProjectsState; town: TownState }
  | { ok: false; reason: 'not_open' | 'short'; short: number };

/** §6.3 step 2: Pell signs, and the Fund pays the Project's cost. GDD-GAP: she won't sign a chit the Fund can't cover. */
export function signOff(def: ProjectDef, state: ProjectsState, id: string, town: TownState, world: Pick<ProjectWorld, 'day'>): SignResult {
  const p = state.projects[id];
  if (projectPaused(def, p, { wharfPaused: wharfClosed(town) }) || !p || p.funded !== null || p.opened !== null) return { ok: false, reason: 'not_open', short: 0 };
  if (town.fund < def.fund) return { ok: false, reason: 'short', short: def.fund - town.fund };
  return { ok: true, state: put(state, id, { ...p, funded: world.day, signed_by: 'pell' }), town: postToFund(town, -def.fund) };
}

/** How far the Fund is from paying for a Project that's waiting for it (0 when it can). */
export const fundShortfall = (def: ProjectDef, town: Pick<TownState, 'fund'>): number => Math.max(0, def.fund - town.fund);

export type DonationVerdict = 'given' | 'low_regard' | 'already' | 'not_needed' | 'never';
export const donationAmount = (): number => Math.floor(SAVINGS_STANDIN * DONATION_SHARE);

/** §6.3: a resident gives coins to the Fund toward a Project the Fund can't cover yet (Regard ≥ 40, once per Project). */
export function askDonation(def: ProjectDef, state: ProjectsState, id: string, resident: string, regard: number, town: TownState):
  { verdict: DonationVerdict; coins: number; state: ProjectsState; town: TownState } {
  const p = state.projects[id];
  const none = (verdict: DonationVerdict) => ({ verdict, coins: 0, state, town });
  if (NEVER_DONATE.has(resident)) return none('never');
  if (!p || p.funded !== null || p.opened !== null || fundShortfall(def, town) === 0) return none('not_needed');
  if (p.donors.includes(resident)) return none('already');
  if (regard < DONATION_REGARD) return none('low_regard');
  const coins = donationAmount();
  return { verdict: 'given', coins, state: put(state, id, { ...p, donors: [...p.donors, resident] }), town: postToFund(town, coins) };
}

/** §11.6 "Donations to the Town Fund": the player puts in their own coins, up to what's short. */
export function donateOwn(def: ProjectDef, state: ProjectsState, id: string, wallet: number, town: TownState): { coins: number; town: TownState } {
  const p = state.projects[id];
  if (!p || p.funded !== null || p.opened !== null) return { coins: 0, town };
  const coins = Math.max(0, Math.min(Math.floor(wallet), fundShortfall(def, town)));
  return { coins, town: coins ? postToFund(town, coins) : town };
}

/** Taking materials is open from funding until the opening. */
const working = (p: Progress | undefined): p is Progress => !!p && p.funded !== null && p.opened === null;

export interface Bag { slots: readonly ({ item: string; count: number } | null)[] }

/** §6.3 step 3: hand over whatever the Bag holds of what's still short. `moved` is by item. */
export function handOver<B extends Bag>(def: ProjectDef, state: ProjectsState, id: string, bag: B, world: Pick<ProjectWorld, 'homeMaterialMultiplier'>):
  { state: ProjectsState; bag: B; moved: Record<string, number> } {
  const p = state.projects[id];
  if (!working(p)) return { state, bag, moved: {} };
  const short = new Map(materialsShort(def, p, world).map(m => [m.item, m.count]));
  const moved: Record<string, number> = {};
  const slots = bag.slots.map(s => {
    if (!s) return s;
    const want = short.get(s.item) ?? 0;
    if (want <= 0) return s;
    const n = Math.min(want, s.count);
    short.set(s.item, want - n);
    moved[s.item] = (moved[s.item] ?? 0) + n;
    return s.count === n ? null : { ...s, count: s.count - n };
  });
  if (!Object.keys(moved).length) return { state, bag, moved };
  const materials = { ...p.materials };
  for (const [item, n] of Object.entries(moved)) materials[item] = (materials[item] ?? 0) + n;
  return { state: put(state, id, { ...p, materials }), bag: { ...bag, slots } as B, moved };
}

export type MaterialVerdict = 'given' | 'low_regard' | 'already' | 'not_needed' | 'none';

/** A resident's authored material donation (content `donors`): theirs to give once, while the Project still needs it. */
export function askMaterial(def: ProjectDef, state: ProjectsState, id: string, resident: string, regard: number, world: Pick<ProjectWorld, 'homeMaterialMultiplier'>):
  { verdict: MaterialVerdict; item: string | null; count: number; line: string | null; state: ProjectsState } {
  const p = state.projects[id];
  const donor = def.donors.find(d => d.resident === resident);
  const none = (verdict: MaterialVerdict) => ({ verdict, item: donor?.item ?? null, count: 0, line: donor?.line ?? null, state });
  if (!donor) return none('none');
  if (!working(p)) return none('not_needed');
  if (p.material_donors.includes(resident)) return none('already');
  const short = materialsShort(def, p, world).find(m => m.item === donor.item)?.count ?? 0;
  if (short <= 0) return none('not_needed');
  if (regard < MATERIAL_DONOR_REGARD) return none('low_regard');
  return { verdict: 'given', item: donor.item, count: Math.min(short, donor.count), line: donor.line, state: put(state, id, { ...p, material_donors: [...p.material_donors, resident] }) };
}

export type WorkRefusal = 'not_funded' | 'hours_in' | 'tired' | 'too_late' | 'opened' | 'paused';

/** The VH one shift of the player's adds (§6.3, §11.1 Tinkerer), before the cap at what's still needed. */
export const playerShiftVh = (tinkerer: boolean): number => (tinkerer ? TINKERER_VH : 1);

/**
 * §6.3 step 4, the player's share: 10 Stamina and an hour of work for 1 VH (1.5 for a Tinkerer), capped at the hours
 * still needed. `economy.day` must be today's (the Stamina is today's).
 */
export function work(def: ProjectDef, state: ProjectsState, id: string, economy: Economy, opts: { day: number; minute: number; tinkerer: boolean; wharfPaused?: boolean }):
  { ok: true; state: ProjectsState; economy: Economy; vh: number; minutes: number } | { ok: false; reason: WorkRefusal } {
  const p = state.projects[id];
  if (projectPaused(def, p, opts)) return { ok: false, reason: 'paused' };
  if (!p || p.opened !== null) return { ok: false, reason: 'opened' };
  if (p.funded === null) return { ok: false, reason: 'not_funded' };
  if (p.vh >= def.vh) return { ok: false, reason: 'hours_in' };
  if (opts.minute + PLAYER_VH_MINUTES > PASS_OUT) return { ok: false, reason: 'too_late' };
  if (economy.day !== opts.day || economy.stamina < PLAYER_VH_STAMINA) return { ok: false, reason: 'tired' };
  const vh = Math.min(def.vh - p.vh, playerShiftVh(opts.tinkerer));
  return {
    ok: true, vh, minutes: PLAYER_VH_MINUTES,
    economy: { ...economy, stamina: economy.stamina - PLAYER_VH_STAMINA },
    state: put(state, id, { ...p, vh: round(p.vh + vh), player_vh: round(p.player_vh + vh) })
  };
}

const round = (v: number): number => Math.round(v * 100) / 100;

// ── Volunteers ──────────────────────────────────────────────────────────────

export type VolunteerVerdict = 'yes' | 'no' | 'busy' | 'full' | 'not_needed' | 'asked_today' | 'never';

export interface Volunteer {
  resident: string;
  regard: number;
  /** The resident's §9.3 values (the Pillar weights). */
  values?: Readonly<Record<Pillar, number>>;
  /** Bastien and any other animal: never asked. */
  animal?: boolean;
}

/** Hours a Project will have once the volunteers already signed up have been credited. */
export function pledgedVh(state: ProjectsState, id: string): number {
  const p = state.projects[id];
  if (!p) return 0;
  return p.vh + state.volunteers.filter(v => v.project === id && !v.credited).length * VOLUNTEER_VH_PER_DAY;
}

/** The Regard a resident needs to say yes (leads need none). */
export function volunteerThreshold(def: ProjectDef, v: Volunteer, organizer: boolean): number {
  if (def.leads.includes(v.resident)) return -Infinity;
  const top = v.values ? (Object.entries(v.values) as [Pillar, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
  const keen = !!top && (def.complete.pillars[top] ?? 0) > 0;
  return VOLUNTEER_REGARD - (organizer ? ORGANIZER_DISCOUNT : 0) - (keen ? KEEN_DISCOUNT : 0);
}

/**
 * §6.3 step 4 / §9.9: "Could you lend a hand at …?" A yes books the resident for tomorrow's shift at the site (they plan
 * their day at dawn, §9.7); a no stands until tomorrow.
 */
export function askVolunteer(def: ProjectDef, state: ProjectsState, id: string, v: Volunteer, opts: { day: number; organizer: boolean }):
  { verdict: VolunteerVerdict; day: number; state: ProjectsState } {
  const p = state.projects[id];
  const day = opts.day + 1;
  const out = (verdict: VolunteerVerdict, s = state) => ({ verdict, day, state: s });
  if (v.animal || NEVER_VOLUNTEER.has(v.resident)) return out('never');
  if (!working(p) || p.vh >= def.vh || pledgedVh(state, id) >= def.vh) return out('not_needed');
  if (state.volunteers.some(a => a.resident === v.resident && a.day === day)) return out('busy');
  if (state.declined[v.resident] === opts.day) return out('asked_today');
  if (state.volunteers.filter(a => a.project === id && a.day === day).length >= MAX_VOLUNTEERS_PER_DAY) return out('full');
  if (v.regard < volunteerThreshold(def, v, opts.organizer)) return out('no', { ...state, declined: { ...state.declined, [v.resident]: opts.day } });
  return out('yes', { ...state, volunteers: [...state.volunteers, { project: id, resident: v.resident, day, source: 'ask', credited: false }] });
}

// ── The opening ─────────────────────────────────────────────────────────────

const roundUpHalfHour = (m: number): number => Math.ceil(m / 30) * 30;
const parseTime = (t: string): number => { const [h, m] = t.split(':').map(Number); return h! * 60 + m!; };
export const shiftOf = (def: ProjectDef, fallback: readonly [string, string] = DEFAULT_SHIFT): { start: number; end: number } => {
  const [a, b] = def.shift ?? fallback;
  return { start: parseTime(a), end: parseTime(b) };
};

/** When the opening is set for once everything is in (GDD-GAP, see CEREMONY_*): today if there's time, else tomorrow. */
export function ceremonyTime(def: ProjectDef, now: { day: number; minute: number }): { day: number; minute: number } {
  if (def.ceremony.at) {
    const at = parseTime(def.ceremony.at);
    return now.minute + 30 <= at ? { day: now.day, minute: at } : { day: now.day + 1, minute: at };
  }
  const t = roundUpHalfHour(Math.max(now.minute + CEREMONY_LEAD_MINUTES, CEREMONY_EARLIEST));
  return t <= CEREMONY_LATEST ? { day: now.day, minute: t } : { day: now.day + 1, minute: CEREMONY_EARLIEST };
}

/** The opening is on now, and the player can start it at the site. */
export const ceremonyOpen = (p: Progress | undefined, now: { day: number; minute: number }): boolean =>
  !!p?.ceremony && p.opened === null && now.day === p.ceremony.day && now.minute >= p.ceremony.minute && now.minute < p.ceremony.minute + CEREMONY_WINDOW;

/**
 * After any change: Projects that have just become ready get their opening set; one whose opening is a story scene
 * (the clocktower's S07a) opens as soon as it's ready (`complete`, for the caller to run through completeProject).
 */
export function settle(defs: readonly ProjectDef[], state: ProjectsState, world: ProjectWorld): { state: ProjectsState; scheduled: string[]; complete: string[] } {
  let s = state;
  const scheduled: string[] = [], complete: string[] = [];
  for (const { id, def, progress } of begun(defs, s)) {
    if (stageOf(def, progress, world) !== 'ready') continue;
    if (def.ceremony.scene) { complete.push(id); continue; }
    if (progress.ceremony) continue;
    s = put(s, id, { ...progress, ceremony: ceremonyTime(def, world) });
    scheduled.push(id);
  }
  return { state: s, scheduled, complete };
}

export interface Completion {
  state: ProjectsState;
  town: TownState;
  /** Story flags to set (`project_<id>_done`, a restored house's `project_<house>_done`). */
  flags: string[];
  /** What changed in the Pillars (as applied, after clamps). */
  pillars: Partial<Record<Pillar, number>>;
}

/**
 * §6.3 step 6: the Project opens. Its Pillars go through the town engine (`project` source, uncapped), its flags are
 * set (the town engine's own too: `project_streetlights_done` starts the 10-a-day upkeep and ElderAppeal +3), a home
 * joins the free homes, and the opening waits for the next Dawn Report. Idempotent: a second call changes nothing.
 */
export function completeProject(def: ProjectDef, state: ProjectsState, id: string, town: TownState, opts: { day: number; place: string; attendees: readonly string[] }): Completion {
  const p = state.projects[id];
  if (projectPaused(def, p, { wharfPaused: wharfClosed(town) }) || !p || p.opened !== null) return { state, town, flags: [], pillars: {} };
  let t = town;
  const pillars: Partial<Record<Pillar, number>> = {};
  if (!state.applied.includes(id)) {
    const before = { ...t.pillars };
    t = applyPillarDeltas(t, def.complete.pillars, 'project', `project:${id}`);
    for (const k of Object.keys(def.complete.pillars) as Pillar[]) pillars[k] = Math.round((t.pillars[k] - before[k]) * 1e4) / 1e4;
  }
  const flags = [...def.complete.flags];
  for (const f of flags) if ((TOWN_FLAGS as readonly string[]).includes(f)) t = setTownFlag(t, f as TownFlag);
  if (def.complete.homes > 0 && p.target) {
    t = restoreHome(t, p.target);
    flags.push(`project_${p.target.slice(p.target.indexOf('.') + 1)}_done`);
  }
  const attendees = [...new Set(opts.attendees)];
  const s: ProjectsState = {
    // The ceremony's time stays: the crowd keeps its afternoon at the site (siteShifts), nobody vanishes at the reveal.
    ...put(state, id, { ...p, opened: opts.day, attendees }),
    // Today's volunteers stay booked (they're on site); the next dawn retires them without adding hours.
    standing: state.standing.filter(v => v.project !== id),
    openings: [...state.openings, { project: id, day: opts.day, place: opts.place, attendees }],
    applied: state.applied.includes(id) ? state.applied : [...state.applied, id]
  };
  return { state: s, town: t, flags, pillars };
}

// ── Dawn ────────────────────────────────────────────────────────────────────

export interface DawnResult {
  state: ProjectsState;
  /** Volunteer-hours credited for yesterday, by Project. */
  credited: Record<string, number>;
  unlocked: string[];
  scheduled: string[];
  complete: string[];
}

/** Ferry days restock Dunmore's limited Project stock once it's sold out and still wanted (content `shop_stock`, GDD-GAP). */
export interface DawnOptions { ferryDay: boolean; stock: Readonly<Record<string, { count: number; restock: number }>> }

/**
 * The dawn pass (after the town's, before the Dawn Report): yesterday's volunteers are credited (2 VH each, "Volunteer
 * progress accrues at dawn"), day and flag openings come due, standing volunteers are booked for today, a missed
 * opening is set again, and Dunmore's restocks on ferry days.
 */
export function dawn(defs: readonly ProjectDef[], state: ProjectsState, world: ProjectWorld, opts: DawnOptions): DawnResult {
  let s = state;
  const credited: Record<string, number> = {};
  // 1. Yesterday's hands.
  const volunteers = s.volunteers.map(v => ({ ...v }));
  for (const v of volunteers) {
    if (v.credited || v.day >= world.day) continue;
    v.credited = true;
    const def = defOf(defs, v.project), p = s.projects[v.project];
    if (!def || projectPaused(def, p, world) || !working(p) || p.vh >= def.vh) continue;
    const vh = Math.min(VOLUNTEER_VH_PER_DAY, def.vh - p.vh);
    s = put(s, v.project, { ...p, vh: round(p.vh + vh), volunteer_vh: round(p.volunteer_vh + vh) });
    credited[v.project] = round((credited[v.project] ?? 0) + vh);
  }
  s = { ...s, volunteers: volunteers.filter(v => !v.credited || v.day >= world.day - 7) };
  // 2. Openings by day or flag.
  const due = unlockDue(defs, s, world);
  s = due.state;
  // 3. Standing volunteers, today, while their Project still needs hands.
  for (const st of s.standing) {
    const def = defOf(defs, st.project), p = s.projects[st.project];
    if (!def || projectPaused(def, p, world) || st.from > world.day || !working(p) || pledgedVh(s, st.project) >= def.vh) continue;
    if (s.volunteers.some(v => v.resident === st.resident && v.day === world.day)) continue;
    s = { ...s, volunteers: [...s.volunteers, { project: st.project, resident: st.resident, day: world.day, source: 'scene', credited: false }] };
  }
  s = { ...s, standing: s.standing.filter(st => { const def = defOf(defs, st.project), p = s.projects[st.project]; return !!def && !!p && p.opened === null && p.vh < def.vh; }) };
  // 4. A missed opening is set again (this morning's, or its own hour).
  for (const { id, def, progress } of begun(defs, s)) {
    const c = progress.ceremony;
    if (!c || progress.opened !== null) continue;
    if (c.day < world.day) s = put(s, id, { ...progress, ceremony: ceremonyTime(def, { day: world.day, minute: world.minute }) });
  }
  const settled = settle(defs, s, world);
  s = settled.state;
  // 5. Dunmore's restock: a sold-out item comes on the ferry while a Project under way still needs it.
  if (opts.ferryDay) {
    const restocked = { ...s.restocked };
    for (const [item, rule] of Object.entries(opts.stock)) {
      if (rule.restock <= 0 || stockLeft(s, item, opts.stock) !== 0) continue;
      const wanted = begun(defs, s).some(b => working(b.progress) && materialsShort(b.def, b.progress, world).some(m => m.item === item));
      if (wanted) restocked[item] = (restocked[item] ?? 0) + rule.restock;
    }
    s = { ...s, restocked };
  }
  s = { ...s, openings: s.openings.filter(o => o.day >= world.day - 2), declined: Object.fromEntries(Object.entries(s.declined).filter(([, d]) => d >= world.day - 1)) };
  return { state: s, credited, unlocked: due.unlocked, scheduled: settled.scheduled, complete: settled.complete };
}

/** How many of a limited item Dunmore's still has for the Projects (null: as many as you like). */
export function stockLeft(state: ProjectsState, item: string, stock: Readonly<Record<string, { count: number; restock: number }>>): number | null {
  const rule = stock[item];
  if (!rule) return null;
  return Math.max(0, rule.count + (state.restocked[item] ?? 0) - (state.sold[item] ?? 0));
}

export const recordSale = (state: ProjectsState, item: string, n = 1): ProjectsState => ({ ...state, sold: { ...state.sold, [item]: (state.sold[item] ?? 0) + n } });

// ── Who comes to the site ───────────────────────────────────────────────────

export interface SiteShift {
  resident: string;
  project: string;
  action: 'volunteer' | 'work' | 'attend';
  startMin: number;
  endMin: number;
}

/** GDD-GAP: who gathers for an opening beyond its leads: the Mayor and everyone who worked on it (at most ten). */
export const CEREMONY_GUESTS: readonly string[] = ['pell'];
export const MAX_ATTENDEES = 10;

export function ceremonyAttendees(def: ProjectDef, state: ProjectsState, id: string): string[] {
  const worked = state.volunteers.filter(v => v.project === id).map(v => v.resident);
  const standing = state.standing.filter(v => v.project === id).map(v => v.resident);
  return [...new Set([...def.leads, ...CEREMONY_GUESTS, ...worked, ...standing])].filter(r => !NEVER_VOLUNTEER.has(r)).slice(0, MAX_ATTENDEES);
}

/**
 * The day's blocks at the sites (sim/volunteers.ts splices them into residents' plans): each volunteer's shift,
 * the leads on site whenever anyone is working (GDD-GAP: they supervise, they don't add hours), and on an opening day
 * everyone gathering from a quarter hour before it until an hour and a half after.
 */
export function siteShifts(defs: readonly ProjectDef[], state: ProjectsState, day: number, fallbackShift: readonly [string, string] = DEFAULT_SHIFT): SiteShift[] {
  const out: SiteShift[] = [];
  const seen = new Set<string>();
  const attend = (def: ProjectDef, id: string, c: { minute: number }) => {
    for (const r of ceremonyAttendees(def, state, id)) out.push({ resident: r, project: id, action: 'attend', startMin: Math.max(360, c.minute - 15), endMin: Math.min(PASS_OUT, c.minute + 90) });
  };
  for (const { id, def, progress } of begun(defs, state)) {
    // A Project opened today keeps today's blocks (the crowd stays for its hour and a half, and nobody's plan changes
    // under their feet at the reveal); from tomorrow it books nobody.
    if (progress.opened !== null && progress.opened !== day) continue;
    const c = progress.ceremony;
    const { start, end } = shiftOf(def, fallbackShift);
    const today = state.volunteers.filter(v => v.project === id && v.day === day);
    for (const v of today) { out.push({ resident: v.resident, project: id, action: 'volunteer', startMin: start, endMin: end }); seen.add(`${v.resident}@${start}`); }
    if (today.length) for (const lead of def.leads) if (!seen.has(`${lead}@${start}`)) out.push({ resident: lead, project: id, action: 'work', startMin: start, endMin: end });
    if (c && c.day === day) attend(def, id, c);
  }
  return out;
}

// ── Saying what's next ──────────────────────────────────────────────────────

export interface StepContext {
  fund: number;
  /** How many of an item the player carries. */
  carried(item: string): number;
  /** "4 pipe fittings". */
  count(item: string, n: number): string;
  placeName(place: string): string;
  residentName(id: string): string;
}

/** What a flag opening waits for, in the Ledger's words. */
export const OPENING_FLAG_HINTS: Readonly<Record<string, string>> = {
  pz06_solved: 'Opens once someone works out who fed the ducks (the duck pond, the Commons).',
  pinion_found: "Opens once the lantern pinion turns up on the Old Quarter's Marks."
};

const plural = (n: number, one: string): string => (n === 1 ? one : one.endsWith('s') ? one : `${one}s`);

/** The one next thing to do, in the Ledger's words. */
export function nextStep(def: ProjectDef, p: Progress | undefined, world: ProjectWorld, ctx: StepContext): string {
  if (projectPaused(def, p, world) && p?.opened === null) return 'Paused: Port Vane survey site. The Charter can reopen the Wharf.';
  const stage = stageOf(def, p, world);
  const lead = ctx.residentName(def.leads[0]!);
  const site = ctx.placeName(def.site.place === 'house' && p?.target ? p.target : def.site.place);
  switch (stage) {
    case 'locked': {
      if (def.opens.cue) return `Opens on Day ${def.opens.day ?? 1}, when ${lead} gets started.`;
      if (def.opens.flag && !(def.opens.day && world.day < def.opens.day)) return OPENING_FLAG_HINTS[def.opens.flag] ?? 'Opens later in the story.';
      return `Opens on Day ${def.opens.day ?? 1}.`;
    }
    case 'open': {
      const short = Math.max(0, def.fund - ctx.fund);
      return short > 0
        ? `The Fund is ${short} short of ${def.fund}. Ask friends for donations (H near them), or put in your own coins with Pell.`
        : `Ask Pell to sign for ${def.fund} coins (H near her, or her office in the Town Hall).`;
    }
    case 'funded': case 'gathering': {
      const short = materialsShort(def, p!, world);
      const carried = short.filter(m => ctx.carried(m.item) > 0);
      if (carried.length) return `Hand over ${carried.map(m => ctx.count(m.item, Math.min(m.count, ctx.carried(m.item)))).join(' and ')} at ${site}.`;
      if (short.length) {
        const donors = def.donors.filter(d => short.some(m => m.item === d.item) && !p!.material_donors.includes(d.resident)).map(d => ctx.residentName(d.resident));
        const need = short.map(m => ctx.count(m.item, m.count)).join(' and ');
        return `Find ${need}: Dunmore's General Store${donors.length ? `, or ask ${donors.join(' or ')}` : ''}.`;
      }
      return `Work at ${site} (E, 10 Stamina an hour), or ask neighbours to lend a hand (H).`;
    }
    case 'building': {
      const left = Math.max(0, def.vh - p!.vh);
      return `${left} ${plural(left, 'hour')} of work to go at ${site}: work a shift (E), or ask neighbours to help (H).`;
    }
    // PZ-15 is first played in S07a (Bertrand fits the pinion at the clocktower one afternoon, from Day 6).
    case 'puzzle': return def.puzzle === 'PZ-15' && !world.flags.has('s07_done')
      ? `The pinion is found. Bertrand will fit it at ${site} one afternoon (16:00–17:45, from Day 6).`
      : `Everything's in. Solve the puzzle at ${site}.`;
    case 'ready': {
      const c = p!.ceremony;
      if (!c) return `Ready to open at ${site}.`;
      const hh = `${String(Math.floor(c.minute / 60)).padStart(2, '0')}:${String(c.minute % 60).padStart(2, '0')}`;
      return `Opening ${c.day === world.day ? 'today' : c.day === world.day + 1 ? 'tomorrow' : `on Day ${c.day}`} at ${hh}, ${site}.`;
    }
    case 'opened': return `Opened on Day ${p!.opened}.`;
  }
}

/** A Project waiting on volunteers: for the Dawn Report's notices ("Project calls for volunteers", §6.6). */
export function volunteerCalls(defs: readonly ProjectDef[], state: ProjectsState, world: ProjectWorld): { id: string; def: ProjectDef; left: number }[] {
  return begun(defs, state).filter(b => !projectPaused(b.def, b.progress, world) && working(b.progress) && b.progress.vh < b.def.vh && stageOf(b.def, b.progress, world) !== 'ready')
    .map(b => ({ id: b.id, def: b.def, left: Math.max(0, round(b.def.vh - pledgedVh(state, b.id))) }))
    .filter(c => c.left > 0);
}
