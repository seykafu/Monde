// The Projects in the running game (GDD §6.3, MVP G-03): the engine's state in the registry (`monde.projects`, saved as
// SaveGame.projects) and every action with its side effects on the rest of the game: the Town Fund and the Pillars
// (`monde.town`), the Bag, coins and Stamina (economy), skills (fellow), the story's flags (so the board swaps art and
// scripts see `project_<id>_done`) and the event log (Regard, memories and the `project_open` town event, M-06).
//
// No Phaser at runtime: the registry is anything with get/set/remove (as puzzles/runtime.ts), so this runs under vitest.
// Regard comes in from the caller (scenes/friendship.ts regardFor in the game), which keeps the friendship mirror's
// Phaser-side glue out of this file.
import { wharfClosed } from '../town/optionClause';
import { roomOf } from '../world/interiors';
import { Economy, Inventory, baseSkills, emptyProjects, gainXp, skillPerks, type ClientEvent, type HeadlineTemplate, type Pillar, type Press } from '@monde/shared';
import { addItem } from '../economy/inventory';
import { itemById } from '../economy/content';
import { getFellow, setFellow, type RegistryLike } from '../fellow/state';
import { scriptedMemory, scriptedRegard, townEvent } from '../mind/events';
import { legacyProjectReward, puzzleSave, storySession } from '../puzzles/runtime';
import { appendEvent } from '../scenes/events';
import { isFerryDay } from '../town/migration';
import type { TownState } from '../town/pillars';
import { placeName } from '../world/player';
import { personaCards } from '../world/residents';
import { zones, interiors } from '../world/zones';
import { shiftsKey, type Shift } from '../sim/volunteers';
import { PROJECTS, PROJECT_CONTENT } from './catalog';
import * as E from './engine';
import { withProjects } from './press';
import { fillLine, type ProjectDef } from './schema';
import { siteOf, type Site } from './site';

export const PROJECTS_KEY = 'monde.projects';
const TOWN_KEY = 'monde.town', BAG_KEY = 'monde.inventory', COINS_KEY = 'monde.coins', ECONOMY_KEY = 'monde.economy';
const FLAGS_KEY = 'monde.story.flags';

export interface Now { day: number; minute: number }

export const projectsOf = (r: RegistryLike): E.ProjectsState => (r.get(PROJECTS_KEY) as E.ProjectsState | undefined) ?? emptyProjects();
const store = (r: RegistryLike, s: E.ProjectsState): void => { r.set(PROJECTS_KEY, s); };
const townOf = (r: RegistryLike): TownState | undefined => r.get(TOWN_KEY) as TownState | undefined;
const bagOf = (r: RegistryLike) => Inventory.parse(r.get(BAG_KEY) ?? {});
const coinsOf = (r: RegistryLike): number => ((r.get(COINS_KEY) as { balance?: number } | undefined)?.balance ?? 0);
const economyOf = (r: RegistryLike) => Economy.parse(r.get(ECONOMY_KEY) ?? {});
/** Queue a ClientEvent through the game's event log (scenes/events.ts; its registry type is Phaser's, its use get/set). */
const queue = (r: RegistryLike, event: unknown): ClientEvent | null => appendEvent(r as unknown as Parameters<typeof appendEvent>[0], event);

// ── The world as the engine reads it ────────────────────────────────────────

/** The story's flags (the live session's, else the saved record) and the town engine's. */
export function flagsOf(r: RegistryLike): Set<string> {
  const session = storySession(r);
  const story = session ? [...session.flags.snapshot()]
    : Object.entries((r.get(FLAGS_KEY) ?? {}) as Record<string, unknown>).filter(([k, v]) => v === true && !k.startsWith('$')).map(([k]) => k);
  const town = Object.entries(townOf(r)?.flags ?? {}).filter(([, v]) => v).map(([k]) => k);
  return new Set([...story, ...town]);
}

export function worldOf(r: RegistryLike, now: Now): E.ProjectWorld {
  const solved = puzzleSave(r).entries;
  // Read, never create: a New Game's Fellow stays unsigned until S01a's {charcreate} (fellow/state.ts ensureFellow).
  const skills = getFellow(r)?.skills ?? baseSkills();
  return {
    day: now.day, minute: now.minute, flags: flagsOf(r), wharfPaused: !!townOf(r) && wharfClosed(townOf(r)!),
    puzzleSolved: id => !!solved[id]?.solved,
    homeMaterialMultiplier: skillPerks(skills).homeMaterialMultiplier
  };
}

/** Set a story flag (and keep the saved record in step), as the puzzles do. */
function setFlag(r: RegistryLike, name: string): void {
  const session = storySession(r);
  if (session) {
    try { session.flags.set(name); } catch { /* an undeclared flag: the town flag below still carries it */ }
    r.set(FLAGS_KEY, session.snapshot());
  } else r.set(FLAGS_KEY, { ...((r.get(FLAGS_KEY) ?? {}) as object), [name]: true });
}

const background = (r: RegistryLike): string | null => getFellow(r)?.profile?.background ?? null;
export const isTinkerer = (r: RegistryLike): boolean => background(r) === 'tinkerer';
export const isOrganizer = (r: RegistryLike): boolean => background(r) === 'organizer';

// ── Names ───────────────────────────────────────────────────────────────────

const CARDS = new Map(personaCards.map(c => [c.id, c]));
/** "Kasimir", "Teo", "Odile": the first name, or the quoted nickname. */
export function residentName(id: string): string {
  const card = CARDS.get(id);
  if (!card) return id.charAt(0).toUpperCase() + id.slice(1);
  const nick = /"([^"]+)"/.exec(card.name)?.[1];
  if (nick) return nick;
  const parts = card.name.split(' ');
  return parts[0] === 'Captain' ? card.name.split(' ').filter((_, i) => i !== 1).join(' ') : id === 'pell' ? 'Pell' : parts[0]!;
}
/** "No. 39" for `old_quarter.vacant_house_39`. */
export const houseName = (key: string): string => {
  const n = /vacant_house_(\d+)$/.exec(key)?.[1];
  return n ? `No. ${Number(n)}` : placeName(key.slice(key.indexOf('.') + 1));
};
export const sitePlaceName = (place: string): string =>
  /vacant_house_\d+$/.test(place) ? houseName(place) : placeName(place.slice(place.indexOf('.') + 1));
export const itemName = (id: string): string => itemById(id)?.name ?? id;
/** Materials as people count them (§6.3's table: "pipe fittings ×4", "seed packets ×10"): [one, many]. */
const MATERIAL_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  pipe_fitting: ['pipe fitting', 'pipe fittings'], firebrick: ['firebrick', 'firebricks'], lamp_glass: ['lamp glass', 'lamp glasses'],
  lens_oil: ['tin of lens oil', 'tins of lens oil'], brass: ['brass fitting', 'brass fittings'], seeds: ['seed packet', 'seed packets'],
  timber: ['plank of timber', 'planks of timber'], paint: ['tin of paint', 'tins of paint'], glass: ['pane of glass', 'panes of glass']
};
/** "4 pipe fittings", "1 tin of paint". */
export const materialCount = (id: string, n: number): string => `${n} ${MATERIAL_NOUNS[id]?.[n === 1 ? 0 : 1] ?? itemName(id).toLowerCase()}`;
/** The plural noun alone ("pipe fittings"), for the Ledger's columns. */
export const materialNoun = (id: string): string => MATERIAL_NOUNS[id]?.[1] ?? itemName(id).toLowerCase();

/** A Project's own name in a sentence ("the fountain"; a house: "No. 39"). */
export const projectName = (def: ProjectDef, p?: E.Progress): string => (def.id === E.HOMES && p?.target ? houseName(p.target) : def.name);
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const siteFor = (def: ProjectDef, p?: E.Progress): Site | null => siteOf(def, p, zones);

/** Placeholders the content's lines use. */
export function lineVars(def: ProjectDef, p: E.Progress | undefined, town?: Pick<TownState, 'fund'>): Record<string, string | number> {
  const site = siteFor(def, p);
  return {
    project: projectName(def, p), house: p?.target ? houseName(p.target) : 'the house', cost: def.fund,
    fund: town?.fund ?? 0, short: town ? Math.max(0, def.fund - town.fund) : 0, lead: residentName(def.leads[0]!),
    place: site ? sitePlaceName(site.place) : def.zone
  };
}

// ── The flow ────────────────────────────────────────────────────────────────

export interface Synced { scheduled: string[]; opened: string[]; unlocked: string[] }

/**
 * Bring the state up to now: day and flag openings, ceremonies for Projects that have just become ready, and any
 * Project whose opening is its story scene (the clocktower after PZ-15) completed on the spot. Cheap; call it freely.
 */
export function syncProjects(r: RegistryLike, now: Now): Synced {
  const world = worldOf(r, now);
  const due = E.unlockDue(PROJECTS, projectsOf(r), world);
  const settled = E.settle(PROJECTS, due.state, world);
  if (settled.state !== projectsOf(r)) store(r, settled.state);
  const opened: string[] = [];
  for (const id of settled.complete) if (openProject(r, now, id, []).opened) opened.push(id);
  return { scheduled: settled.scheduled, opened, unlocked: due.unlocked };
}

/** The story's {project: id} cue (story/host.ts). False for a Project this file doesn't know (S11's station). */
export function projectCue(r: RegistryLike, now: Now, id: string, sceneId: string): boolean {
  const town = townOf(r);
  if (!town) return false;
  const result = E.projectCue(PROJECTS, projectsOf(r), town, id, sceneId, now);
  if (!result.known) return false;
  store(r, result.state);
  if (result.town !== town) r.set(TOWN_KEY, result.town);
  syncProjects(r, now);
  return true;
}

/** Pell signs (§6.3 step 2): her line, and whether the Fund paid. */
export function signWithPell(r: RegistryLike, now: Now, id: string): { ok: boolean; short: number; line: string } {
  const def = E.defOf(PROJECTS, id), town = townOf(r), p = projectsOf(r).projects[id];
  if (!def || !town) return { ok: false, short: 0, line: '' };
  const result = E.signOff(def, projectsOf(r), id, town, now);
  if (!result.ok) return { ok: false, short: result.short, line: fillLine(result.reason === 'short' ? PROJECT_CONTENT.pell.short : PROJECT_CONTENT.pell.wait, lineVars(def, p, town)) };
  store(r, result.state);
  r.set(TOWN_KEY, result.town);
  syncProjects(r, now);
  return { ok: true, short: 0, line: fillLine(PROJECT_CONTENT.pell.signed, lineVars(def, p, result.town)) };
}

/** The player puts their own coins into the Fund toward a Project that's short (§11.6). */
export function donateOwnCoins(r: RegistryLike, id: string): number {
  const def = E.defOf(PROJECTS, id), town = townOf(r);
  if (!def || !town) return 0;
  if (E.projectPaused(def, projectsOf(r).projects[id], { wharfPaused: wharfClosed(town) })) return 0;
  const { coins, town: next } = E.donateOwn(def, projectsOf(r), id, coinsOf(r), town);
  if (!coins) return 0;
  r.set(COINS_KEY, { balance: coinsOf(r) - coins });
  r.set(TOWN_KEY, next);
  return coins;
}

/** A resident asked for coins toward a Project the Fund can't cover (§6.3). */
export function askForDonation(r: RegistryLike, id: string, resident: string, regard: number): { verdict: E.DonationVerdict; coins: number; line: string } {
  const def = E.defOf(PROJECTS, id), town = townOf(r);
  if (!def || !town) return { verdict: 'not_needed', coins: 0, line: '' };
  if (E.projectPaused(def, projectsOf(r).projects[id], { wharfPaused: wharfClosed(town) })) return { verdict: 'not_needed', coins: 0, line: 'The Wharf Projects are paused.' };
  const result = E.askDonation(def, projectsOf(r), id, resident, regard, town);
  const asks = PROJECT_CONTENT.asks;
  const vars = { ...lineVars(def, projectsOf(r).projects[id], town), coins: result.coins };
  if (result.verdict === 'given') { store(r, result.state); r.set(TOWN_KEY, result.town); }
  const line = result.verdict === 'given' ? asks.donateYes[resident] ?? asks.donateYes.default!
    : result.verdict === 'already' ? asks.donated : asks.donateNo[resident] ?? asks.donateNo.default!;
  return { verdict: result.verdict, coins: result.coins, line: fillLine(line, vars) };
}

/** Hand over what the Bag holds of what's short (§6.3 step 3). */
export function handOverAt(r: RegistryLike, now: Now, id: string): Record<string, number> {
  const def = E.defOf(PROJECTS, id);
  if (!def) return {};
  if (E.projectPaused(def, projectsOf(r).projects[id], worldOf(r, now))) return {};
  const result = E.handOver(def, projectsOf(r), id, bagOf(r), worldOf(r, now));
  if (!Object.keys(result.moved).length) return {};
  store(r, result.state);
  r.set(BAG_KEY, result.bag);
  syncProjects(r, now);
  return result.moved;
}

/** A resident's authored material donation: into the Bag (straight onto the pile when the Bag is full). */
export function askForMaterial(r: RegistryLike, now: Now, id: string, resident: string, regard: number): { verdict: E.MaterialVerdict; item: string | null; count: number; line: string } {
  const def = E.defOf(PROJECTS, id);
  if (!def) return { verdict: 'none', item: null, count: 0, line: '' };
  if (E.projectPaused(def, projectsOf(r).projects[id], worldOf(r, now))) return { verdict: 'none', item: null, count: 0, line: 'The Wharf Projects are paused.' };
  const result = E.askMaterial(def, projectsOf(r), id, resident, regard, worldOf(r, now));
  if (result.verdict !== 'given' || !result.item) return { verdict: result.verdict, item: result.item, count: 0, line: result.line ?? '' };
  let state = result.state;
  const item = itemById(result.item);
  const bag = item ? addItem(bagOf(r), item, result.count) : null;
  if (bag) r.set(BAG_KEY, bag);
  else {
    const p = state.projects[id]!;
    state = { ...state, projects: { ...state.projects, [id]: { ...p, materials: { ...p.materials, [result.item]: (p.materials[result.item] ?? 0) + result.count } } } };
  }
  store(r, state);
  syncProjects(r, now);
  return { verdict: 'given', item: result.item, count: result.count, line: result.line ?? '' };
}

export type WorkOutcome = { ok: true; vh: number; minutes: number; regard: string[] } | { ok: false; reason: E.WorkRefusal };

/**
 * One shift of the player's at the site (§6.3 step 4): Stamina, an hour, Handiwork XP, and +1 Regard with each
 * resident working beside them (§8 "Volunteer on a Project", once a day each). `present`: who's on site now.
 */
export function workAt(r: RegistryLike, now: Now, id: string, present: readonly string[] = []): WorkOutcome {
  const def = E.defOf(PROJECTS, id);
  if (!def) return { ok: false, reason: 'opened' };
  const result = E.work(def, projectsOf(r), id, economyOf(r), { day: now.day, minute: now.minute, tinkerer: isTinkerer(r), wharfPaused: worldOf(r, now).wharfPaused });
  if (!result.ok) return result;
  let state = result.state;
  r.set(ECONOMY_KEY, result.economy);
  const fellow = getFellow(r);
  if (fellow) setFellow(r, { ...fellow, skills: gainXp(fellow.skills, 'handiwork', E.PROJECT_XP_PER_SHIFT) });
  const regard: string[] = [];
  for (const resident of [...new Set(present)]) {
    if (state.coworked[resident] === now.day) continue;
    const event = scriptedRegard({ id: `project:cowork:${resident}:${now.day}`, day: now.day, minute: now.minute }, { scene_id: 'projects', cue_key: `cowork:${resident}:${now.day}` }, { resident, delta: 1 });
    if (queue(r, event)) { regard.push(resident); state = { ...state, coworked: { ...state.coworked, [resident]: now.day } }; }
  }
  store(r, state);
  syncProjects(r, { day: now.day, minute: now.minute + result.minutes });
  return { ok: true, vh: result.vh, minutes: result.minutes, regard };
}

/** Ask a resident to lend a hand tomorrow (§6.3 step 4, §9.9). Their answer, in their words. */
export function askForHelp(r: RegistryLike, now: Now, id: string, resident: string, regard: number): { verdict: E.VolunteerVerdict; line: string } {
  const def = E.defOf(PROJECTS, id);
  if (!def) return { verdict: 'not_needed', line: '' };
  if (E.projectPaused(def, projectsOf(r).projects[id], worldOf(r, now))) return { verdict: 'not_needed', line: 'The Wharf Projects are paused.' };
  const card = CARDS.get(resident);
  const result = E.askVolunteer(def, projectsOf(r), id, { resident, regard, ...(card ? { values: card.values, animal: card.kind === 'animal' } : {}) }, { day: now.day, organizer: isOrganizer(r) });
  if (result.state !== projectsOf(r)) store(r, result.state);
  const asks = PROJECT_CONTENT.asks, vars = lineVars(def, projectsOf(r).projects[id]);
  const line = result.verdict === 'yes' ? asks.yes[resident] ?? asks.yes.default!
    : result.verdict === 'busy' ? asks.busy : asks.no[resident] ?? asks.no.default!;
  return { verdict: result.verdict, line: fillLine(line, vars) };
}

/** Start restoring a vacant house (§6.4); Pell signs for it next. */
export function startHouse(r: RegistryLike, now: Now, house: string): string | null {
  const def = E.defOf(PROJECTS, E.HOMES);
  if (!def) return null;
  const next = E.startHomes(def, projectsOf(r), house, worldOf(r, now));
  if (!next) return null;
  store(r, next);
  return E.homesId(house);
}

/** The dawn pass (registered once per clock, after the town's, before the Dawn Report). */
export function projectsDawn(r: RegistryLike, now: Now): E.DawnResult {
  const town = townOf(r);
  const result = E.dawn(PROJECTS, projectsOf(r), worldOf(r, now), { ferryDay: isFerryDay(now.day, town?.flags), stock: PROJECT_CONTENT.shopStock });
  store(r, result.state);
  for (const id of result.complete) openProject(r, now, id, []);
  return result;
}

// ── The opening ─────────────────────────────────────────────────────────────

export interface Opening {
  opened: boolean;
  pillars: Partial<Record<Pillar, number>>;
  flags: string[];
}

/**
 * §6.3 step 6: the Project opens. Its completion goes through the engine (Pillars, flags, homes), the flags are set in
 * the story (the board swaps the art within a second), and the event log gets one `project_open` town event with
 * everyone present (the server writes their memories, EVENTS.md) and the leads' authored memories.
 */
export function openProject(r: RegistryLike, now: Now, id: string, present: readonly string[]): Opening {
  const def = E.defOf(PROJECTS, id), town = townOf(r), p = projectsOf(r).projects[id];
  if (!def || !town || !p || E.projectPaused(def, p, worldOf(r, now)) || p.opened !== null) return { opened: false, pillars: {}, flags: [] };
  const site = siteFor(def, p);
  let state = projectsOf(r);
  // A pre-G-03 save whose puzzle runtime already gave this Project's Pillars keeps them, once.
  if (legacyProjectReward(r, id) && !state.applied.includes(id)) state = { ...state, applied: [...state.applied, id] };
  const attendees = [...new Set([...present, ...E.ceremonyAttendees(def, state, id)])];
  const done = E.completeProject(def, state, id, town, { day: now.day, place: site?.place ?? def.site.place, attendees });
  store(r, done.state);
  r.set(TOWN_KEY, done.town);
  for (const f of done.flags) setFlag(r, f);
  if (site) {
    const vars = lineVars(def, p);
    const stamp = (suffix: string) => ({ id: `project:${id}:${suffix}`, day: now.day, minute: now.minute });
    const summary = fillLine(def.ceremony.summary, vars).slice(0, 200);
    queue(r, townEvent(stamp('open'), { type: 'project_open', place: site.place, participants: ["player", ...attendees], summary }));
    for (const m of def.ceremony.memories) {
      queue(r, scriptedMemory(stamp(`memory:${m.resident}`), { scene_id: 'projects', cue_key: `open:${id}:${m.resident}` },
        { resident: m.resident, place: site.place, text: fillLine(m.text, vars), importance: m.importance }));
    }
  }
  return { opened: true, pillars: done.pillars, flags: done.flags };
}

// ── Dunmore's Project stock ─────────────────────────────────────────────────

export const stockLeft = (r: RegistryLike, item: string): number | null => E.stockLeft(projectsOf(r), item, PROJECT_CONTENT.shopStock);
export function recordSale(r: RegistryLike, item: string): void {
  if (PROJECT_CONTENT.shopStock[item]) store(r, E.recordSale(projectsOf(r), item));
}

// ── Shifts for the residents' plans ─────────────────────────────────────────

let shiftMemo: { state: E.ProjectsState; day: number; paused: boolean; shifts: Shift[]; key: string } | null = null;

/** The day's site shifts as plan blocks (sim/volunteers.ts), memoised on the state object and the day. */
export function shiftsFor(r: RegistryLike, day: number): { shifts: Shift[]; key: string } {
  const state = projectsOf(r);
  const paused = !!townOf(r) && wharfClosed(townOf(r)!);
  if (shiftMemo && shiftMemo.state === state && shiftMemo.day === day && shiftMemo.paused === paused) return shiftMemo;
  const shifts: Shift[] = [];
  for (const s of E.siteShifts(PROJECTS, state, day, PROJECT_CONTENT.shift)) {
    const def = E.defOf(PROJECTS, s.project);
    if (def && E.projectPaused(def, state.projects[s.project], worldOf(r, { day, minute: 360 }))) continue;
    const site = def && siteFor(def, state.projects[s.project]);
    if (!def || !site) continue;
    const name = projectName(def, state.projects[s.project]);
    const note = s.action === 'attend' ? `The opening of ${name}` : s.action === 'work' ? `Minding the work on ${name}` : `Lending a hand with ${name}`;
    shifts.push({ resident: s.resident, action: s.action, place: site.work.place, ...(roomOf(interiors, site.work.place) ? {} : { area: site.work.area }), startMin: s.startMin, endMin: s.endMin, note });
  }
  shiftMemo = { state, day, paused, shifts, key: shiftsKey(shifts) };
  return shiftMemo;
}

// ── The Dawn Report ─────────────────────────────────────────────────────────

/**
 * The morning's paper with the Projects in it (§6.6): yesterday's opening on the front (a template edition), today's
 * openings and the calls for volunteers in the notices. scenes/friendship.ts publish() runs it on every edition.
 */
export function projectPaper(r: RegistryLike, day: number, edition: Press, templates: readonly HeadlineTemplate[]): Press {
  const state = projectsOf(r), world = worldOf(r, { day, minute: 360 });
  const o = state.openings.find(x => x.day === day - 1);
  const def = o && E.defOf(PROJECTS, o.project), p = o && state.projects[o.project];
  const opening = def && p ? {
    name: def.id === E.HOMES && p.target ? `the house at ${houseName(p.target)}` : def.name,
    place: sitePlaceName(o.place), summary: fillLine(def.ceremony.summary, lineVars(def, p)).slice(0, 200), eventId: `project:${o.project}:open`
  } : null;
  const calls = E.volunteerCalls(PROJECTS, state, world).map(c => {
    const site = siteFor(c.def, state.projects[c.id]);
    return { name: projectName(c.def, state.projects[c.id]), left: Math.ceil(c.left), place: site ? sitePlaceName(site.place) : c.def.zone, lead: residentName(c.def.leads[0]!) };
  });
  const openingsToday = E.begun(PROJECTS, state).flatMap(b => {
    const c = b.progress.ceremony, site = siteFor(b.def, b.progress);
    return c && c.day === day && site && b.progress.opened === null
      ? [{ name: projectName(b.def, b.progress), time: `${String(Math.floor(c.minute / 60)).padStart(2, '0')}:${String(c.minute % 60).padStart(2, '0')}`, place: sitePlaceName(site.place) }] : [];
  });
  return withProjects(edition, opening, { calls, openingsToday }, templates);
}
