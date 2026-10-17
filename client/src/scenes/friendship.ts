import { optionCalendar } from '../story/optionCalendar';
import { isMarketDay } from "../town/fund";
import { isFerryDay } from "../town/migration";
import { expireFavor } from "@monde/shared";
import { computeAppeal } from "../town/appeal";
import { getTown } from "./TownLedgerScene";
import { leavingFavors, localLastChances, localTemplateFavors } from "../friendship/favors";
import { adoptDawnArrivals, nightArrivals, paperMovements } from "./migration";
import { generatedCards } from "../world/roster";
import { projectPaper } from "../projects/runtime";
import { ensureStrawPoll, withStrawPoll } from "../finale/take";
import { REPORT_DAY } from "../finale/state";
import YAML from "yaml";
import headlineText from "../../../content/lines/headlines.yaml?raw";
import { fallbackPress, type Press, type PressEvent, type HeadlineTemplate } from "@monde/shared";
import { stampGenerated } from "../press/report";
// Friendship's Phaser side (GDD §9.11; MVP G-13 client): the registry's FriendshipState and the dawn package.
//
// The pure rules live in src/friendship (hearts, state, known ties, milestones, emotes) and src/mind/dawn.ts (the
// night and the dawn package). This file keeps one FriendshipState in the game registry (`monde.friendship`, saved
// with the game) and runs the dawn sync on every dawn of the clock:
//   online   hold the clock ("dawn"), POST the night of yesterday, GET today's package (polling briefly while the
//            night is still working), then fold it in: the model plans replace templates (ResidentSim reads them
//            from here), the ties, milestones, letters and Favors are kept, and this morning's friendship lines go
//            to `monde.dawnTies` for the Ledger's dawn line and the Dawn Report (M-10);
//   offline  template routines and Favors, and the ties the client last knew.
// A game loaded mid-day whose save has no plans for that day asks for the day's package again (no night).
import type Phaser from 'phaser';
import type { PlanOutput, RegardSnapshot, TieData, TieMilestoneData, TurnRegard } from '@monde/shared';
import { getMind } from '../mind/api';
import { DAWN_SYNC, modelPlans, syncDawn, type NightRequest } from '../mind/dawn';
import { acknowledge, pendingRegard, sendable } from '../mind/events';
import { applyDawn, applyRegardSnapshot, cardTies, emptyFriendship, meet, recordTurn, regardOf, seedRegard, type FriendshipState } from '../friendship/state';
import { EVENTS_KEY, eventSyncFor, getEventLog } from './events';
import { heardPairs, learnTies, nameIndex, tieIndex, townName } from '../friendship/knownTies';
import type { RomanceNews } from '../friendship/milestones';
import { personaCards } from '../world/residents';
import { DAY_START, type Clock } from '../sim/clock';
import { dailyWeather, describeWeather } from '../sim/weather';
import type { Pillars } from '../town/pillars';

/** The FriendshipState in the game registry. */
export const FRIENDSHIP_KEY = 'monde.friendship';
/** This morning's friendship news: `DawnTiesNews`, for the Ledger and the Dawn Report (M-10). */
export const DAWN_TIES_KEY = 'monde.dawnTies';
/** Same key save/runtime.ts uses. */
const CLOCK_KEY = 'monde.clock';

export interface DawnTiesNews {
  day: number;
  /** Lines in print order (romance, then milestones). */
  lines: string[];
  milestones: TieMilestoneData[];
  romance: RomanceNews[];
  /** How the package came: complete, partial (the night was still working when the client stopped waiting). */
  status: 'complete' | 'partial';
}

type Registry = Phaser.Data.DataManager;

export const getFriendship = (registry: Registry): FriendshipState =>
  (registry.get(FRIENDSHIP_KEY) as FriendshipState | undefined) ?? emptyFriendship();

/** Apply `fn`; the registry is written (and `changedata` fires) only when the state actually changed. */
export function updateFriendship(registry: Registry, fn: (state: FriendshipState) => FriendshipState): FriendshipState {
  const before = getFriendship(registry);
  const after = fn(before);
  if (after !== before || !registry.has(FRIENDSHIP_KEY)) registry.set(FRIENDSHIP_KEY, after);
  return after;
}

/** What the town calls each resident in lines ("Pell", "June", "Captain Reyes"). */
export const TOWN_NAMES: Readonly<Record<string, string>> = Object.fromEntries(personaCards.map(c => [c.id, townName(c)]));
/** TOWN_NAMES with the generated residents (G-02) who live here now. */
export const townNames = (): Readonly<Record<string, string>> => ({ ...TOWN_NAMES, ...Object.fromEntries(generatedCards().map(c => [c.id, townName(c)])) });
const NAMES = nameIndex(personaCards);
/** Day 1's ties from the cards: what the client knows before its first online dawn (and always in Quiet Mode). */
const CARD_TIES = cardTies(personaCards);

let tiesMemo: { pairs: readonly TieData[]; index: Map<string, TieData> } | null = null;
/** The ties as the client knows them now (the last dawn's, else Day 1's), by pair key (memoised per list). */
export function tieMap(registry: Registry): Map<string, TieData> {
  const pairs = getFriendship(registry).ties?.pairs ?? CARD_TIES;
  if (tiesMemo?.pairs !== pairs) tiesMemo = { pairs, index: tieIndex(pairs) };
  return tiesMemo.index;
}

/** The Regard a resident starts at before the server says (the signed Background's start, §11.1). */
export const seedFor = (id: string): number => seedRegard(getMind().player?.background, id);

/**
 * The mirrored Regard toward the player: the server's last word (or the seed), plus scripted Regard still waiting in
 * the event log (M-06), so a story's {regard} shows at once and in Quiet Mode, and never twice once acknowledged.
 */
export const regardFor = (registry: Registry, id: string): number =>
  Math.max(-100, Math.min(100, regardOf(getFriendship(registry), id, seedFor(id)) + pendingRegard(getEventLog(registry), id)
    + getEventLog(registry).outbox.reduce((sum, event) => sum + (event.kind === 'favor_done' && event.resident === id
      ? getFriendship(registry).favor_book.find(f => f.id === event.favor)?.reward.regard ?? 0 : 0), 0)));

/**
 * regardFor for many residents at once: one read of the mirror and one pass over the event log, the same numbers. The
 * story's context asks for every card's on each refresh (MVP M-03: 212 of them once the census is written).
 */
export function regardMap(registry: Registry, ids: readonly string[]): Record<string, number> {
  const friendship = getFriendship(registry), background = getMind().player?.background;
  const queued = new Map<string, number>();
  for (const event of getEventLog(registry).outbox) {
    if (event.kind === 'scripted_regard') queued.set(event.resident, (queued.get(event.resident) ?? 0) + event.delta);
    else if (event.kind === 'favor_done') {
      queued.set(event.resident, (queued.get(event.resident) ?? 0) + (friendship.favor_book.find(f => f.id === event.favor)?.reward.regard ?? 0));
    }
  }
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = Math.max(-100, Math.min(100, regardOf(friendship, id, seedRegard(background, id)) + (queued.get(id) ?? 0)));
  return out;
}

/** The server's Regard for the whole town (an events reply, the night's ingestion, the dawn): replace the mirror. */
export const applyServerRegard = (registry: Registry, regard: RegardSnapshot): FriendshipState =>
  updateFriendship(registry, s => applyRegardSnapshot(s, regard));

/** The dialogue opened: the player has met them. */
export const meetResident = (registry: Registry, id: string, day: number): FriendshipState =>
  updateFriendship(registry, s => meet(s, id, day, seedFor(id)));

/**
 * One dialogue turn. A server turn's applied Regard replaces the mirror (Quiet Mode turns have none and change
 * nothing). A live line that names another resident teaches the player that tie ("heard"); Quiet Mode's authored
 * lines name residents at random, so they don't.
 */
export function recordDialogueTurn(registry: Registry, id: string, day: number, turn: { regard?: TurnRegard | null; lines: readonly { text: string }[] }, live: boolean): void {
  updateFriendship(registry, s => {
    let next = recordTurn(s, id, day, turn.regard ?? null, seedFor(id));
    if (live) next = learnTies(next, heardPairs(turn.lines.map(l => l.text), id, NAMES), day, 'heard', tieMap(registry));
    return next;
  });
}

/** Pairs the player saw together on screen. */
export const learnSeen = (registry: Registry, pairs: readonly (readonly [string, string])[], day: number): void => {
  if (pairs.length) updateFriendship(registry, s => learnTies(s, pairs, day, 'seen', tieMap(registry)));
};

/** The day's live plans for ResidentSim: the model plans the dawn applied, if they're for `day`. */
export function livePlansFor(registry: Registry, day: number): Readonly<Record<string, PlanOutput>> | null {
  const plans = getFriendship(registry).plans; // read every frame per resident: no allocation here
  return plans && plans.day === day ? plans.plans : null;
}

/** This morning's friendship lines for `day` (the latest dawn's news, or the saved report after a load). */
export function friendshipLines(registry: Registry, day: number): string[] {
  const news = registry.get(DAWN_TIES_KEY) as DawnTiesNews | undefined;
  if (news?.day === day) return news.lines;
  const report = getFriendship(registry).report;
  return report?.day === day ? report.lines : [];
}

// ── The dawn ────────────────────────────────────────────────────────────────

export interface DawnSyncOptions {
  /** The world's weather seed (tomorrow's forecast goes to the night's plans). */
  weatherSeed: () => number;
  /** The town's Pillars and census, for the night's reflections. */
  town: () => { pillars: Pillars; census: number; fund?: number } | undefined;
}

const clampPillar = (v: number): number => Math.max(0, Math.min(100, Math.round(v * 10) / 10));

/**
 * The night of `day`: the event log's unsent ClientEvents up to that night (§9.14: logged offline, uploaded with the
 * night pass; ingested before reflections run), and the town's facts with the next day's weather.
 */
function nightRequest(registry: Registry, day: number, opts: DawnSyncOptions): NightRequest {
  const town = opts.town();
  const tomorrow = dailyWeather(opts.weatherSeed(), day + 1);
  const events = sendable(getEventLog(registry), day);
  return {
    day, leaving: leavingFavors(registry,day+1), ...nightArrivals(registry, day + 1),
    ...(events.length ? { client_events: events } : {}),
    town: {
      ...(town ? {
        pillars: { prosperity: clampPillar(town.pillars.prosperity), safety: clampPillar(town.pillars.safety), spirit: clampPillar(town.pillars.spirit), charm: clampPillar(town.pillars.charm) },
        census: Math.max(0, Math.round(town.census)), fund: town.fund
      } : {}),
      weather_tomorrow: describeWeather({ kind: tomorrow.kind, intensity: 0.6 }).toLowerCase()
    }
  };
}

/** The night's ingestion: through this game's EventSync when it runs, else straight into the registry. */
function acknowledgeNight(registry: Registry, ingestion: Parameters<typeof acknowledge>[1]): void {
  const sync = eventSyncFor(registry);
  if (sync) { sync.apply(ingestion); return; }
  registry.set(EVENTS_KEY, acknowledge(getEventLog(registry), ingestion).log);
  applyServerRegard(registry, ingestion.regard);
}

const attached = new WeakSet<Clock>();
let syncSeq = 0;

/** Run the dawn sync on every dawn of this clock (once per clock; it outlives zone changes). */
export function attachDawnSync(registry: Registry, clock: Clock, opts: DawnSyncOptions): void {
  if (attached.has(clock)) return;
  attached.add(clock);
  if (!registry.has(FRIENDSHIP_KEY)) registry.set(FRIENDSHIP_KEY, emptyFriendship());

  const publish = (day: number, paper?: Press | null): void => {
    if (getFriendship(registry).papers.some(p => p.day === day)) return;
    const events: PressEvent[] = [...getFriendship(registry).news_log, ...getEventLog(registry).outbox.flatMap(e => e.kind === 'town_event' ? [{ id: e.id, day: e.day, minute: e.minute, type: e.type, summary: e.summary, importance: e.importance, who: e.participants }] : [])];
    const templates = YAML.parse(headlineText) as { headlines: HeadlineTemplate[] };
    // G-03: yesterday's Project opening leads a template edition; today's openings and the calls for hands are notices.
    let edition = projectPaper(registry, day, paper ?? fallbackPress(day,events,templates.headlines,opts.town()?.fund === undefined ? {} : { coins: opts.town()!.fund! }), templates.headlines);
    edition = optionCalendar(registry, day, edition);
    // G-11: the morning after the Bloom Fair the Lantern prints the Straw Poll (counted now if the player missed the trestle).
    if (day === REPORT_DAY) {
      const finale = ensureStrawPoll(registry, id => regardFor(registry, id), opts.weatherSeed());
      if (finale) edition = withStrawPoll(edition, finale, day, id => townNames()[id] ?? id);
    }
    const town = getTown(registry);
    edition.notices = [...new Set([...edition.notices, ...(isMarketDay(day) ? ['Saturday market on Market Row.'] : []), ...(isFerryDay(day,town?.flags) ? ['The ferry sails today from the Wharf.'] : []), 'Meals and gifts at the general store.'])];
    if (!paper) edition.letters = getFriendship(registry).letters.filter(l => l.to === 'lantern' && l.day === day).slice(0,2).map(l => ({ from:l.from,text:l.text,id:l.id }));
    // G-02 (§6.6): comings and goings from the town's own roster: this morning's boat in, and anyone leaving on it.
    const moves = paperMovements(registry, day);
    if (moves.lines.length) { edition.movements = moves.lines; edition.movement_residents = moves.residents; }
    if (town) edition.ledger = { pillars:{ ...town.pillars },dayStart:{ ...town.dayStart },census:town.census,appeal:computeAppeal(town).appeal,fund:town.fund };
    // §9.13: what's still Sable's model copy after the client's own changes is reportable (press/report.ts).
    edition = stampGenerated(edition, paper);
    updateFriendship(registry,s => ({ ...s, favor_book: s.favor_book.map(f => expireFavor(f,day)), papers: [...s.papers.filter(p => p.day !== day),edition] }));
    registry.set('monde.press.seed',opts.weatherSeed()); registry.set('monde.press.pending',edition); clock.pause('paper');
  };
  const run = async (day: number, withNight: boolean): Promise<void> => {
    const mind = getMind();
    if (!mind.enabled) { localLastChances(registry,day); localTemplateFavors(registry,day); publish(day); return; }
    const seq = ++syncSeq;
    // §9.8: the residents' day starts on the night's plans, so time waits for them (a few seconds at most).
    clock.pause('dawn');
    const safety = setTimeout(() => clock.resume('dawn'), DAWN_SYNC.budgetMs + 10_000);
    try {
      const result = await syncDawn({
        postNight: async body => {
          const posted = await mind.postNight(body);
          // The night took the log's events first: acknowledge them as /events would (and take its Regard).
          if (posted?.ingestion && registry.get(CLOCK_KEY) === clock) acknowledgeNight(registry, posted.ingestion);
          return posted?.status ?? null;
        },
        getDawn: d => mind.getDawn(d),
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), now: () => performance.now()
      }, day, withNight ? nightRequest(registry, day - 1, opts) : null);
      // A newer dawn, or a load that replaced the game meanwhile, owns the state now.
      if (seq !== syncSeq || registry.get(CLOCK_KEY) !== clock) return;
      if (!result.pkg) { console.info(`[dawn] Day ${day}: ${result.reason}; templates and the last known ties`); return; }
      const plans = modelPlans(result.pkg.plans);
      // G-02: the server's households for today replace the local templates before they land.
      adoptDawnArrivals(registry, result.pkg);
      const applied = applyDawn(getFriendship(registry), result.pkg, { names: townNames(), plans });
      registry.set(FRIENDSHIP_KEY, { ...applied.state, papers: getFriendship(registry).papers });
      publish(day,result.pkg.press);
      registry.set(DAWN_TIES_KEY, {
        day, lines: applied.lines, milestones: applied.printed, romance: applied.romance, status: result.status
      } satisfies DawnTiesNews);
      console.info(`[dawn] Day ${day}: ${result.status} after ${result.polls} read${result.polls === 1 ? '' : 's'} · ${Object.keys(plans).length} model plans · ${result.pkg.ties.pairs.length} ties · ${applied.lines.length} lines · ${result.pkg.letters.length} letters · ${result.pkg.favors.length} favors`);
    } catch (error) {
      console.warn('[dawn] sync failed; keeping templates', error);
    } finally {
      clearTimeout(safety);
      if (seq === syncSeq && registry.get(CLOCK_KEY) === clock) { if (!getFriendship(registry).papers.some(p => p.day === day)) { localLastChances(registry,day); localTemplateFavors(registry,day); } publish(day); }
      clock.resume('dawn');
    }
  };

  clock.onDawn(t => { void run(t.day, true); });
  // A save from mid-day (or the dawn autosave, written before the package came) has no plans for today yet.
  const today = getFriendship(registry).papers.find(p => p.day === clock.day);
  if (clock.day > 1 && !today) void run(clock.day, false);
  // The dawn autosave (what Continue loads) is written after the morning's paper was printed but before it was read:
  // loaded at 06:00, the paper comes again.
  else if (today && clock.minute === DAY_START && !registry.get('monde.press.pending')) {
    registry.set('monde.press.seed', opts.weatherSeed()); registry.set('monde.press.pending', today); clock.pause('paper');
  }
}
