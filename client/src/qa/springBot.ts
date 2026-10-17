import { createTownState, setTownFlag } from '../town/pillars';
import { runDawnsThrough } from '../town/townEngine';
// The Spring soak bot (MVP_PLAN Q-02, first version): a headless player that plays "Spring in Monde" from New Game to
// the End-of-Spring report on the real game modules, in Quiet Mode (no server: the mind is offline, so the residents
// speak from the line library and the scripted exchanges, and the dawn is the template paper).
//
// What is real here: the story director and host (story/session.ts, story/host.ts) with the compiled Spring scenes; the
// town engine, migration, the Projects, the puzzles' rewards, the Marks, the Scuffle engine and its consequences, the
// economy rules, the friendship mirror and the dawn sync (offline), the finale, the save system (attachSaves' dawn
// autosave, loadGame) and the clock with every dawn listener in ZoneScene's order. The once-per-clock attach functions
// are the game's own (scenes/*, projects/attach.ts), run against a registry and scene stand-in.
//
// What stands in for Phaser: BotRegistry (Phaser's DataManager: get/set/has/remove and its setdata/changedata events),
// BotScene (events, input, time, scene manager calls the attach functions make), the StoryPresenter (StoryScene: it
// plays puzzles with known solutions, Scuffles with a scripted player, the written {ai_open} exchanges, the Fellowship
// form, the Straw Poll) and a handful of ZoneScene/attach glue that only exists inside Phaser code: walking (a route on
// the zone graph at the player's speed), the E-prompt jobs (community work, the shop, the bed), the Projects' site
// actions and Pell's sign-off, reading a Mark and answering it in the Journal. Each mirror names the code it mirrors.
//
// The modules it imports pull Phaser in at runtime (TownLedgerScene, ScuffleScene…): run it under vitest with
// `vi.mock('phaser', phaserStub)` (qa/__tests__/springRun.test.ts).
import type Phaser from 'phaser';
import {
  COMMUNITY_TASKS, SPRING_RIDDLES, baseSkills, firstArrival, instantiateFavor, type CommunityTask, type Item, type PlayerProfile, type SaveGame, type StrawPollRecord
} from '@monde/shared';
import { SCUFFLES, type ScuffleId } from '../combat/scuffle/catalog';
import { distance, talkOdds, triangle, type Action, type Fighter, type Outcome } from '../combat/scuffle/engine';
import { itemById, items } from '../economy/content';
import { addItem } from '../economy/inventory';
import { attachEconomyClock } from '../economy/attach';
import { BAG_KEY, COINS_KEY, ECONOMY_KEY, bagOf, coinsOf, consume, economyOf, giveGift } from '../economy/runtime';
import { completeWork, sleep } from '../economy/rules';
import { ensureFellow, getFellow, setFellow, signedFellow } from '../fellow/state';
import { ensureStrawPoll } from '../finale/take';
import { finaleOf, reportDue, updateFinale, REPORT_DAY } from '../finale/state';
import { springReport, type SpringReport } from '../finale/report';
import { voteOutcome } from '../finale/poll';
import { worldSeedOf } from '../finale/attach';
import { chooseFavor, favorBook, favorInteraction, favorProof, finishFavor } from '../friendship/favors';
import { uuid } from '../mind/api';
import { scriptedTurn } from '../mind/scripted';
import { scriptedLibrary } from '../mind/scriptedLibrary';
import type { TalkInput } from '../mind/types';
import { PROJECTS } from '../projects/catalog';
import * as E from '../projects/engine';
import { attachProjectsClock, installShifts } from '../projects/attach';
import {
  askForHelp, askForMaterial, donateOwnCoins, flagsOf, handOverAt, openProject, projectsOf, recordSale, signWithPell, siteFor,
  startHouse, stockLeft, syncProjects, workAt, worldOf
} from '../projects/runtime';
import { puzzles } from '../puzzles/catalog';
import { PUZZLE_SITES, attachPuzzles, puzzleAt } from '../puzzles/interaction';
import { completePuzzle, puzzleSave } from '../puzzles/runtime';
import { solution as PZ01_SOLUTION } from '../puzzles/PZ-01';
import { codes as PZ03_CODES, words as PZ03_WORDS } from '../puzzles/PZ-03';
import { constraints as PZ04_CONSTRAINTS } from '../puzzles/PZ-04';
import { attachSaves, finishSaving, loadGame, saveGame, saveStorage } from '../save/runtime';
import { getEventLog, appendEvent } from '../scenes/events';
import { attachDawnSync, getFriendship, livePlansFor, meetResident, regardFor, townNames, updateFriendship } from '../scenes/friendship';
import { attachMigration, installMigration } from '../scenes/migration';
import { findMark, marks, submitMark } from '../scenes/riddles';
import { TOWN_KEY, attachTown, getTown } from '../scenes/TownLedgerScene';
import { prepare, scufflesOf, settle } from '../scuffles/runtime';
import { attachScuffleClock, attachScuffles } from '../scuffles/interaction';
import { Clock, DAY_START, MS_PER_GAME_MINUTE, PASS_OUT, weekdayOf } from '../sim/clock';
import { ResidentSim } from '../sim/residentSim';
import { storyHint, zoneRoute, type StoryHint } from '../story/hint';
import { decodeStory, metInScenes, placeAt, syncTownFlags, type FellowProfile, type StoryPresenter, type StoryWorld } from '../story/host';
import { SPRING_SCENES, StorySession } from '../story/session';
import { minutes } from '../story/triggers';
import { doorLocked } from '../scenes/zone/indoors';
import { placeArrival, roomOf, standingPlace } from '../world/interiors';
import { ZoneGraph } from '../world/nav';
import { homeRegistry, placeRegistry } from '../world/places';
import { PLAYER_SPEED, placeName } from '../world/player';
import { personaCards } from '../world/residents';
import { allCards, findCard, resetRoster } from '../world/roster';
import { districtOf, type Point, type ZoneDef } from '../world/zoneFormat';
import { boards, doorLinks, interiors, zones } from '../world/zones';
import { DEFAULT_PLAYER_LOOK } from '../render/character/look';
import type { TownState } from '../town/pillars';
import { computeAppeal } from '../town/appeal';

// ── Phaser stand-ins ────────────────────────────────────────────────────────

type Listener = (...args: unknown[]) => void;

/** Phaser's EventEmitter, as far as the attach functions use it (on/once/off chain, emit). */
export class Emitter {
  private readonly map = new Map<string, { fn: Listener; once: boolean }[]>();
  on(event: string, fn: Listener): this { this.list(event).push({ fn, once: false }); return this; }
  once(event: string, fn: Listener): this { this.list(event).push({ fn, once: true }); return this; }
  off(event: string, fn?: Listener): this {
    if (!fn) this.map.delete(event);
    else this.map.set(event, this.list(event).filter(l => l.fn !== fn));
    return this;
  }
  emit(event: string, ...args: unknown[]): boolean {
    const ls = [...this.list(event)];
    if (!ls.length) return false;
    this.map.set(event, this.list(event).filter(l => !l.once));
    for (const l of ls) l.fn(...args);
    return true;
  }
  private list(event: string): { fn: Listener; once: boolean }[] {
    let l = this.map.get(event);
    if (!l) this.map.set(event, l = []);
    return l;
  }
}

/** Phaser's DataManager: get/set/has/remove, `setdata` on a first set, `changedata` and `changedata-<key>` after. */
export class BotRegistry {
  private readonly data = new Map<string, unknown>();
  readonly events = new Emitter();
  get(key: string): unknown { return this.data.get(key); }
  has(key: string): boolean { return this.data.has(key); }
  set(key: string, value: unknown): this {
    const had = this.data.has(key), previous = this.data.get(key);
    this.data.set(key, value);
    if (had) { this.events.emit('changedata', this, key, value, previous); this.events.emit(`changedata-${key}`, this, value, previous); }
    else this.events.emit('setdata', this, key, value);
    return this;
  }
  remove(key: string): this { if (this.data.delete(key)) this.events.emit('removedata', this, key); return this; }
  keys(): string[] { return [...this.data.keys()]; }
}

/** The bits of Phaser.Scene the attach functions touch. `start`/`restart` of the Zone call back into the bot. */
export class BotScene {
  readonly events = new Emitter();
  readonly later: (() => void)[] = [];
  onStart: ((data: { zone?: string; arrive?: Point; savedPlayer?: SaveGame['player'] }) => void) | null = null;
  readonly input = { enabled: true, keyboard: { enabled: true, on: () => this.input.keyboard, off: () => this.input.keyboard, resetKeys: () => undefined } };
  readonly time = { delayedCall: (_ms: number, fn: () => void) => { this.later.push(fn); return { remove: () => undefined }; } };
  readonly scene = {
    key: 'Zone',
    isActive: (_key?: string) => false,
    stop: (key?: string) => { if (!key || key === 'Zone') this.shutdown(); },
    start: (_key: string, data: Parameters<NonNullable<BotScene['onStart']>>[0]) => { this.onStart?.(data ?? {}); },
    restart: (data: Parameters<NonNullable<BotScene['onStart']>>[0]) => { this.onStart?.(data ?? {}); },
    launch: () => undefined, pause: () => undefined, bringToTop: () => undefined, add: () => undefined, get: () => undefined
  };
  readonly sys = { isActive: () => true };
  readonly game = { scene: { keys: {} as Record<string, unknown> }, events: new Emitter() };
  constructor(readonly registry: BotRegistry) {}
  /** Run what the attach functions put on `time.delayedCall`. */
  pump(): void { for (let n = 0; this.later.length && n < 1000; n++) this.later.shift()!(); }
  shutdown(): void { this.events.emit('shutdown'); }
}

const asScene = (s: BotScene): Phaser.Scene => s as unknown as Phaser.Scene;
const asRegistry = (r: BotRegistry): Phaser.Data.DataManager => r as unknown as Phaser.Data.DataManager;

// ── Scripts ─────────────────────────────────────────────────────────────────

export type Script = 'strong' | 'lazy' | 'social';
export const SCRIPTS: readonly Script[] = ['strong', 'lazy', 'social'];

interface Style {
  profile: PlayerProfile;
  /** Which option a story choice takes. */
  choice: 'first' | 'last' | 'second';
  /** Solves puzzles when a scene or a site offers one (else leaves the board, the deferred branch). */
  puzzles: boolean;
  /** How the player fights: through it, by talking, or not at all. */
  scuffle: 'fight' | 'talk' | 'idle';
  /** Reads the Marks and answers them in the Journal. */
  marks: 'all' | 'some' | 'none';
  /** Community jobs a day (most useful first). */
  work: number;
  /** Funds, gathers for, works on and opens the Projects. */
  builds: boolean;
  /** Gives a liked gift and talks to residents. */
  social: boolean;
  /** Accepts the favors on offer. */
  favors: boolean;
  /** Turns in at (minutes). */
  bedtime: number;
  /** Says "Not yet" to the first summons (the cooldown path). */
  declinesFirstSummons: boolean;
}

export const STYLES: Readonly<Record<Script, Style>> = {
  strong: { profile: { name: 'Wren', pronouns: 'she/her', background: 'tinkerer', why: 'to_help', loves: 'old clocks' }, choice: 'first', puzzles: true, scuffle: 'fight',
    marks: 'all', work: 3, builds: true, social: false, favors: true, bedtime: 22 * 60, declinesFirstSummons: false },
  lazy: { profile: { name: 'Sam', pronouns: 'they/them', background: 'homecomer', why: 'curious', loves: 'rain' }, choice: 'last', puzzles: false, scuffle: 'idle',
    marks: 'none', work: 0, builds: false, social: false, favors: false, bedtime: 20 * 60, declinesFirstSummons: true },
  social: { profile: { name: 'Alex', pronouns: 'he/him', background: 'organizer', why: 'fresh_start', loves: 'music' }, choice: 'second', puzzles: true, scuffle: 'talk',
    marks: 'some', work: 1, builds: false, social: true, favors: true, bedtime: 23 * 60, declinesFirstSummons: false }
};

// ── The report ──────────────────────────────────────────────────────────────

export interface DayLine { day: number; weekday: string; appeal: number; census: number; coins: number; fund: number; stamina: number; did: string[] }

export interface BotResult {
  script: Script;
  /** Scenes in the order they started. */
  played: string[];
  flags: string[];
  /** Project id → the day it opened (null: begun, not open) and its stage. */
  projects: Record<string, { opened: number | null; stage: string }>;
  marks: string[];
  puzzles: string[];
  scuffles: { key: string; outcome: string }[];
  favors: { id: string; status: string }[];
  arrivals: number;
  departures: number;
  saves: number;
  reloads: number;
  poll: StrawPollRecord | null;
  report: SpringReport | null;
  /** Things the bot found wrong: each is a bug or a dead end. */
  issues: string[];
  days: DayLine[];
  log: string[];
}

// ── Known puzzle solutions (the verifier's searches, puzzles/__tests__/verifier.test.ts) ──

const indices = (n: number) => Array.from({ length: n }, (_, i) => i);
const assignments = (n: number, radix: number): number[][] => indices(radix ** n).map(mask => indices(n).map(i => Math.floor(mask / radix ** i) % radix));
function permutations(a: number[]): number[][] { return a.length ? a.flatMap((v, i) => permutations(a.filter((_, j) => i !== j)).map(p => [v, ...p])) : [[]]; }
const winsWith = (id: string, cells: number[]) => puzzles[id]!.win({ ...puzzles[id]!.reset(), cells });
let solved: Record<string, number[]> | null = null;
export function puzzleSolutions(): Record<string, number[]> {
  if (solved) return solved;
  const out: Record<string, number[]> = { 'PZ-01': PZ01_SOLUTION, 'PZ-15': [10, 30, 8, 32], 'PZ-18': [0, 2, 2, 1, 0, 1, 2] };
  // PZ-02: the board is the dampers; presses flip them. Search the 512 press sets for one that opens all nine.
  const p2 = puzzles['PZ-02']!;
  for (const bits of assignments(9, 2)) {
    const state = indices(9).filter(i => bits[i]).reduce((s, m) => p2.move(s, m), p2.reset());
    if (p2.win(state)) { out['PZ-02'] = state.cells; break; }
  }
  out['PZ-03'] = PZ03_CODES.map(([r, c]) => PZ03_WORDS.findIndex(w => w.line === r && w.column === c));
  const perms = permutations(indices(5));
  search: for (const v of perms.filter(v => v[0] === 0 && v[1] === 1)) for (const a of perms) for (const g of perms) {
    if (PZ04_CONSTRAINTS([...v, ...a, ...g])) { out['PZ-04'] = [...v, ...a, ...g]; break search; }
  }
  out['PZ-05'] = assignments(5, 2).find(c => winsWith('PZ-05', c))!;
  out['PZ-06'] = indices(4).map(i => [i]).find(c => winsWith('PZ-06', c))!;
  out['PZ-13'] = assignments(6, 2).find(c => winsWith('PZ-13', c))!;
  for (const [id, cells] of Object.entries(out)) if (!cells || !winsWith(id, cells)) throw new Error(`no known solution for ${id}`);
  return solved = out;
}

// ── The bot ─────────────────────────────────────────────────────────────────

const STORY_KEY = 'monde.story.session', FLAGS_KEY = 'monde.story.flags';
const graph = new ZoneGraph(zones);
const HOME = 'old_quarter.lamplighter_cottage';
/** Real seconds per tile walked (world/player.ts PLAYER_SPEED), in game minutes (§5.3: 0.75 s a minute). */
const MINUTES_PER_TILE = 1 / PLAYER_SPEED / (MS_PER_GAME_MINUTE / 1000);
/** A door's 0.4 s fade in or out (§16.4), rounded up to a game minute. */
const DOOR_MINUTES = 1;

interface Loc { board: string; tile: Point }

export interface BotOptions {
  seed?: number;
  /** Save at every dawn (attachSaves' autosave), load it, and play on from the loaded game. */
  reloadEveryDawn?: boolean;
  /** Stop after this day (default: the morning of Day 26, when the End-of-Spring report is due). */
  lastDay?: number;
  /** Echo the log to the console. */
  verbose?: boolean;
}

export class SpringBot {
  readonly style: Style;
  readonly r = new BotRegistry();
  readonly scene = new BotScene(this.r);
  clock!: Clock;
  session!: StorySession;
  sim!: ResidentSim;
  loc: Loc = { board: 'old_quarter', tile: zones.old_quarter!.spawn };
  readonly result: BotResult;
  private today: string[] = [];
  private declined = false;
  private worked = new Map<string, number>();
  private readonly seed: number;

  constructor(readonly script: Script, readonly opts: BotOptions = {}) {
    this.style = STYLES[script];
    this.seed = opts.seed ?? 1;
    this.result = { script, played: [], flags: [], projects: {}, marks: [], puzzles: [], scuffles: [], favors: [], arrivals: 0, departures: 0,
      saves: 0, reloads: 0, poll: null, report: null, issues: [], days: [], log: [] };
    this.scene.onStart = data => this.boot(data);
  }

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  log(text: string): void {
    const line = `D${this.clock?.day ?? 1} ${this.hhmm()} ${text}`;
    this.result.log.push(line);
    this.today.push(text);
    if (this.opts.verbose) console.info(`[bot:${this.script}] ${line}`);
  }
  issue(text: string): void {
    const line = `D${this.clock?.day ?? 1} ${this.hhmm()} ${text}`;
    if (!this.result.issues.includes(line)) this.result.issues.push(line);
    this.log(`ISSUE ${text}`);
  }
  hhmm(): string {
    const m = this.clock?.minute ?? DAY_START;
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  get board(): ZoneDef { return boards[this.loc.board]!; }
  get district(): string { return districtOf(this.board); }
  town(): TownState { return getTown(asRegistry(this.r))!; }
  flags(): Set<string> { return flagsOf(this.r); }
  regard(id: string): number { return regardFor(asRegistry(this.r), id); }

  // ── The game: ZoneScene.create / sharedClock, in their order ──────────────

  /** A New Game: the registry empty, the clock at 06:00 on Day 1, then the ferry slip at S01a's hour. */
  newGame(): void {
    resetRoster();
    this.boot({});
  }

  /**
   * ZoneScene.create for a board (data as the scene manager passes it). The per-clock attachments run once per clock
   * (sharedClock), the per-zone ones every time (they unhook on the scene's shutdown).
   */
  boot(data: { zone?: string; arrive?: Point; savedPlayer?: SaveGame['player'] }): void {
    this.scene.shutdown();
    let clock = this.r.get('monde.clock') as Clock | undefined;
    if (!clock) { clock = new Clock({ day: 1, minute: DAY_START }); this.r.set('monde.clock', clock); }
    const fresh = this.clock !== clock;
    this.clock = clock;
    const r = asRegistry(this.r), s = asScene(this.scene);
    // sharedClock(): the Scuffles' Tollmen, the town's dawn, arrivals, the Projects, the dawn sync (offline: the paper).
    attachScuffleClock(s, clock);
    attachTown(r, clock);
    attachMigration(r, clock);
    attachProjectsClock(r, clock);
    attachDawnSync(r, clock, { weatherSeed: () => this.seed, town: () => getTown(r) });
    // create(): the economy's clock, the puzzles' dawn, the Scuffles, the dawn autosave.
    attachEconomyClock(s, clock);
    attachPuzzles(s, clock);
    attachScuffles(s, clock);
    attachSaves(s, clock, () => this.playerSave(), this.seed, () => true);
    // After the game's own dawn listeners (the paper is out, the autosave written): a new day's log.
    if (fresh) clock.onDawn(() => { this.today = []; });
    // The shared resident simulation (scenes/zone/residents.ts sharedResidentSim), with the Projects' shifts and arrivals.
    let sim = this.r.get('monde.residents') as ResidentSim | undefined;
    if (!sim) {
      sim = new ResidentSim(personaCards, { zones, graph, registry: placeRegistry, homes: homeRegistry }, 0, day => livePlansFor(r, day));
      this.r.set('monde.residents', sim);
    }
    this.sim = sim;
    installShifts(sim, r);
    installMigration(r, sim);
    // A New Game stays unsigned until S01a's {charcreate} (ZoneScene: ensureFellow with signDefault off).
    ensureFellow(this.r, { signDefault: false });
    // attachEconomy: the first stipend, the first time there's no purse.
    if (!this.r.has(COINS_KEY)) this.payStipend();
    // The story (scenes/story/attach.ts heldFor): one session per clock, from the saved story record.
    const held = this.r.get(STORY_KEY) as { clock: Clock; session: StorySession; opened: boolean } | undefined;
    if (held?.clock === clock) this.session = held.session;
    else {
      const saved = this.r.get(FLAGS_KEY) as Parameters<typeof decodeStory>[0] | undefined;
      this.session = new StorySession({ world: null, saved, scenes: SPRING_SCENES, dev: true, warn: m => this.issue(`story warning: ${m}`) });
      this.r.set(STORY_KEY, { clock, session: this.session, opened: !!saved && Object.keys(saved).length > 0 });
    }
    this.session.world = this.world();
    this.session.presenter = this.presenter();
    // Where the scene put the player.
    const zone = data.zone ?? 'old_quarter';
    if (data.savedPlayer) this.loc = { board: data.savedPlayer.zone, tile: [Math.floor(data.savedPlayer.x), Math.floor(data.savedPlayer.y)] };
    else this.loc = { board: zone, tile: data.arrive ?? boards[zone]!.spawn };
    this.scene.pump();
    // attachStory: a New Game opens at 09:50 on the ferry slip (S01a), at the zone's spawn.
    const opening = this.session.header('s01a_ferry');
    if (!data.zone && !data.savedPlayer && clock.day === 1 && clock.minute === DAY_START && this.session.flags.serialize().length === 0 && opening) {
      clock.setTime(1, minutes(opening.time.start));
      const [z = ''] = opening.place.split('.');
      this.loc = { board: z, tile: zones[z]!.spawn };
      if (this.place() !== opening.place) this.issue(`a New Game opens at the ${z} spawn, which is ${this.place() || 'no place'}, not ${opening.place}: S01a can't start`);
    }
  }

  /** ZoneScene's attachSaves `player()`: where the save puts the player (the bed after sleeping). */
  private playerSave(): SaveGame['player'] {
    const waking = this.r.get('monde.save.wakePlayer') as SaveGame['player'] | undefined;
    return waking ?? { zone: this.loc.board, x: this.loc.tile[0] + 0.5, y: this.loc.tile[1] + 0.5, facing: 0 };
  }

  /** economy/attach.ts payStipend: 20 coins from the Town Fund. */
  private payStipend(): void {
    const town = getTown(asRegistry(this.r));
    if (!town) return;
    this.r.set(TOWN_KEY, { ...town, fund: town.fund - 20 });
    this.r.set(COINS_KEY, { balance: coinsOf(asRegistry(this.r)) + 20 });
  }

  /** The place the player is at (story/host.ts placeAt, with the rooms behind unlocked doors counted as indoors). */
  place(loc: Loc = this.loc): string {
    const board = boards[loc.board]!;
    const indoors = new Set(doorLinks.filter(l => l.district === board.id && !doorLocked(this.r, l)).map(l => l.building));
    return placeAt(board, { x: loc.tile[0] + 0.5, y: loc.tile[1] + 0.5 }, indoors);
  }

  // ── The story's world and presenter (scenes/story/attach.ts, scenes/StoryScene.ts) ──

  private world(): StoryWorld {
    const r = this.r, reg = asRegistry(r);
    return {
      readRiddle: id => { findMark(r, this.clock, id); return marks(r).entries[id]?.status === 'solved'; },
      now: () => ({
        day: this.clock.day, minute: this.clock.minute, zone: this.district, place: this.place(), town: getTown(reg),
        profile: (getFellow(r)?.profile ?? null) as FellowProfile | null,
        regard: Object.fromEntries(personaCards.map(c => [c.id, regardFor(reg, c.id)])),
        ...this.storyArrival()
      }),
      setTown: state => { r.set(TOWN_KEY, state); },
      events: () => getEventLog(reg).outbox,
      appendEvent: event => { appendEvent(reg, event); },
      newId: uuid,
      persist: () => {
        r.set(FLAGS_KEY, this.session.snapshot());
        const known = getFriendship(reg).residents;
        for (const id of metInScenes(this.session.flags.snapshot(), id => personaCards.some(c => c.id === id))) if (!known[id]) meetResident(reg, id, this.clock.day);
        const town = getTown(reg);
        if (!town) return;
        const synced = syncTownFlags(town, this.session.flags.snapshot());
        if (synced !== town) r.set(TOWN_KEY, synced);
      },
      checkpoint: async key => { this.log(`checkpoint ${key}`); },
      travel: place => { this.moveTo(place, { summoned: true }); },
      zoneName: id => zones[id]?.name ?? id,
      projectCue: (id, sceneId) => {
        const known = (() => {
          const town = getTown(reg);
          if (!town) return false;
          const result = E.projectCue(PROJECTS, projectsOf(r), town, id, sceneId, { day: this.clock.day });
          if (!result.known) return false;
          r.set('monde.projects', result.state);
          if (result.town !== town) r.set(TOWN_KEY, result.town);
          syncProjects(r, { day: this.clock.day, minute: this.clock.minute });
          return true;
        })();
        this.log(`{project: ${id}} from ${sceneId}${known ? '' : ' (unknown)'}`);
        return known;
      },
      // scenes/story/attach.ts: {coins} into the purse.
      coins: delta => { r.set(COINS_KEY, { balance: Math.max(0, coinsOf(reg) + delta) }); this.log(`{coins: ${delta > 0 ? '+' : ''}${delta}} (purse ${coinsOf(reg)})`); },
      // Quiet Mode: no live line, the authored fallback.
      aiLine: async () => []
    };
  }

  /** scenes/story/attach.ts storyArrival: S05's `{arrival.*}` from the first real arrival. */
  private storyArrival(): { arrival?: { id: string; name: string; trade: string; reason: string } } {
    const town = getTown(asRegistry(this.r));
    const first = firstArrival(town?.people, this.clock.day);
    const card = first ? findCard(first.card.id) ?? first.card : null;
    if (!first || !card) return {};
    const household = [...(town?.people?.households ?? []), ...(town?.people?.pending ?? [])].find(h => h.id === first.household);
    const trade = card.occupation.split(/[;,]/)[0]!.trim();
    return { arrival: { id: card.id, name: card.name, trade: trade.charAt(0).toUpperCase() + trade.slice(1), reason: household?.summary ?? 'Wanted a fresh start.' } };
  }

  private presenter(): StoryPresenter {
    return {
      backdrop: () => undefined, music: () => undefined, fade: async () => undefined, wait: async () => undefined,
      cam: () => true, sfx: () => true, thinking: () => undefined,
      confirm: async text => {
        if (this.style.declinesFirstSummons && !this.declined) { this.declined = true; this.log(`summons: "${text}" → Not yet`); return false; }
        this.log(`summons: "${text}" → Go now`);
        return true;
      },
      placeholder: async kind => { this.issue(`a ${kind} placeholder was used`); return true; },
      puzzle: async id => this.storyPuzzle(id),
      scuffle: async (id, key) => this.fight(id as ScuffleId, key, { story: true }),
      charcreate: async () => {
        setFellow(this.r, signedFellow(this.style.profile, DEFAULT_PLAYER_LOOK));
        this.log(`signed the Fellowship form as ${this.style.profile.name} (${this.style.profile.background}, ${this.style.profile.why})`);
        return true;
      },
      aiOpen: async (cue, place) => { this.aiOpen(cue, place); return []; },
      strawPoll: async () => {
        const finale = ensureStrawPoll(this.r, id => this.regard(id), worldSeedOf(this.r));
        if (!finale?.poll) { this.issue('the Straw Poll could not be counted'); return null; }
        const v = voteOutcome(finale.poll);
        this.log(`Straw Poll: ${finale.poll.ballots} ballots, ${v.winner} (Fellow ${v.share}%, Vane ${v.vane}%, Moss ${v.moss}%)`);
        return v;
      }
    };
  }

  /** StoryScene.aiOpen with no server: the written exchange (content/lines/scripted.yaml), walked to its close. */
  private aiOpen(cue: { resident: string; topic: string; turns: number }, place: string): void {
    const sceneId = this.session.active ?? '';
    const exchange = scriptedLibrary.find(sceneId, cue.resident);
    if (!exchange) { this.issue(`{ai_open: ${cue.resident}} in ${sceneId} has no written exchange: Quiet Mode plays small talk`); return; }
    if (exchange.turns !== cue.turns) this.issue(`${exchange.key}: the exchange has ${exchange.turns} turns, the cue ${cue.turns}`);
    if (findCard(cue.resident)) meetResident(asRegistry(this.r), cue.resident, this.clock.day);
    let at: string | null = null, input: TalkInput = { kind: 'open' }, said = 0;
    for (let turnIndex = 0; turnIndex < 20; turnIndex++) {
      const step = scriptedTurn(exchange, at, input, { conversationId: `bot:${exchange.key}`, residentId: cue.resident, turnIndex, vars: { name: cue.resident, player: this.style.profile.name } });
      if (!step) return;
      at = step.at;
      said += step.turn.lines.length;
      if (!step.turn.lines.length) this.issue(`${exchange.key}: a turn with no lines`);
      const replies = step.turn.choices.filter(c => c.intent !== 'leave');
      if (step.turn.wrap_up || !replies.length) { if (!said) this.issue(`${exchange.key}: closed without a word`); return; }
      const picked = replies[this.pick(replies.length)]!;
      input = { kind: 'choice', choice_id: picked.id, text: picked.text, intent: picked.intent };
    }
    this.issue(`${exchange.key} (${place}): the written exchange never closes`);
  }

  private pick(n: number): number {
    return this.style.choice === 'first' ? 0 : this.style.choice === 'last' ? n - 1 : Math.min(1, n - 1);
  }

  /** Play every scene that can start now, to its end (StoryScene drives the director the same way). */
  async story(): Promise<boolean> {
    let any = false;
    for (let scenes = 0; scenes < 6; scenes++) {
      if (!this.session.ready()) break;
      let id = '';
      for (let n = 0; n < 4000; n++) {
        const step = await this.session.director.next();
        if (!step) break;
        if (this.session.active && this.session.active !== id) {
          id = this.session.active;
          this.result.played.push(id);
          this.log(`▶ ${id} at ${this.place() || this.district}`);
          any = true;
        }
        if (step.kind === 'line') {
          if (/\{[\w.]+\}/.test(step.line.text)) this.issue(`${id}: an unfilled token in "${step.line.text}"`);
          (this.lines[id] ??= []).push(step.line.text);
        }
        if (step.kind === 'choice') {
          if (!step.options.length) { this.issue(`${id}: a choice with no options`); break; }
          await this.session.director.choose(this.pick(step.options.length));
        }
        if (n === 3999) this.issue(`${id}: the scene never ended`);
      }
      this.session.settle();
      this.session.world?.persist();
      if (id === 's05_first_arrival') {
        // S05's newcomer is the town's first real arrival (G-02), not the stand-in.
        const first = this.storyArrival().arrival;
        const said = (this.lines[id] ?? []).join(' ');
        if (!first) this.issue('S05 played with no arrival in town: the newcomer is the stand-in');
        else if (!said.includes(first.name.split(' ')[0]!)) this.issue(`S05's newcomer isn't ${first.name}, the first arrival`);
      }
    }
    return any;
  }
  /** Every line each scene said (the last time it played). */
  readonly lines: Record<string, string[]> = {};

  // ── Walking ───────────────────────────────────────────────────────────────

  /** Where a place is entered: into its room (unless the door is locked: its doorstep), else its door. */
  arrival(place: string): Loc | null {
    const room = roomOf(interiors, place);
    const link = room ? doorLinks.find(l => l.interior === room.id) : undefined;
    if (link && doorLocked(this.r, link)) return { board: link.district, tile: link.outside };
    const to = placeArrival(zones, interiors, place);
    return to ? { board: to.zone, tile: to.arrive } : null;
  }

  /** The district cell for a location (a room's is its building's door). */
  private outdoors(loc: Loc): { zone: string; tile: Point; doors: number } {
    const link = doorLinks.find(l => l.interior === loc.board);
    return link ? { zone: link.district, tile: link.outside, doors: DOOR_MINUTES } : { zone: loc.board, tile: loc.tile, doors: 0 };
  }

  /** Game minutes to walk between two locations, or null when there's no way. */
  walkMinutes(from: Loc, to: Loc): number | null {
    if (from.board === to.board && from.tile[0] === to.tile[0] && from.tile[1] === to.tile[1]) return 0;
    const a = this.outdoors(from), b = this.outdoors(to);
    if (a.zone === b.zone && a.tile[0] === b.tile[0] && a.tile[1] === b.tile[1]) return a.doors + b.doors + 1;
    const route = graph.route({ zone: a.zone, tile: a.tile }, { zone: b.zone, tile: b.tile });
    if (!route) return null;
    return Math.ceil(route.length * MINUTES_PER_TILE) + a.doors + b.doors;
  }

  /** Walk to a place (or a summons moves the player there at once). False when it can't be reached. */
  moveTo(place: string, opts: { summoned?: boolean } = {}): boolean {
    const to = this.arrival(place);
    if (!to) { this.issue(`no way to ${place}: no board knows it`); return false; }
    return this.walk(to, place, opts);
  }

  walk(to: Loc, label: string, opts: { summoned?: boolean } = {}): boolean {
    const mins = opts.summoned ? 0 : this.walkMinutes(this.loc, to);
    if (mins === null) { this.issue(`no route from ${this.loc.board} to ${label}`); return false; }
    if (this.clock.minute + mins >= PASS_OUT - 5) return false;
    if (mins > 0) this.advance(mins);
    // Another board: the Zone restarts there (ZoneScene's edges and doors are scene.restart), re-running create().
    if (to.board !== this.loc.board) this.scene.scene.restart({ zone: to.board, arrive: to.tile });
    this.loc = to;
    const at = this.place();
    if (label.includes('.') && !label.startsWith('mark:') && !label.startsWith('resident:') && at !== label) this.issue(`walking to ${label} arrives at ${at || 'no place'} (${to.board} ${to.tile.join(',')})`);
    this.r.remove('monde.save.wakePlayer');
    return true;
  }

  /** Let game minutes pass, firing the clock's minute events (the boat lands, the Tollmen sync, Stamina after midnight). */
  advance(mins: number): void {
    if (mins <= 0) return;
    const before = this.clock.day;
    this.clock.advanceMinutes(mins);
    this.scene.pump();
    if (this.clock.day !== before) this.issue('the clock rolled into a new day while walking or working');
  }

  /** Stand where you are for a while, checking the story each few minutes (a window opening, a summons). */
  async wait(mins: number, step = 5): Promise<void> {
    for (let left = mins; left > 0 && this.clock.minute < PASS_OUT - 10; left -= step) {
      this.advance(Math.min(step, left));
      if (await this.story()) return;
    }
  }

  // ── The day ───────────────────────────────────────────────────────────────

  /** The morning: read the paper (DawnReportScene's close resumes the clock), take a save and reload it. */
  async morning(): Promise<void> {
    this.scene.pump();
    const paper = this.r.get('monde.press.pending') as { headline?: string; notices?: string[]; movements?: string[] } | undefined;
    if (paper) {
      this.r.remove('monde.press.pending');
      this.clock.resume('paper');
      this.log(`paper: ${paper.headline ?? '(no headline)'}${paper.movements?.length ? ` · ${paper.movements.join(' ')}` : ''}`);
    } else if (this.clock.day > 1) this.issue('no Dawn Report this morning');
    if (this.clock.paused) this.issue(`the clock is held at dawn (${this.clock.pauseReasons.join(', ')})`);
    await finishSaving();
    const autosave = (await saveStorage.list()).filter(e => e.save.kind === 'autosave').sort((a, b) => b.save.saved_at.localeCompare(a.save.saved_at))[0];
    if (this.clock.day > 1) {
      if (!autosave || autosave.save.clock.day !== this.clock.day || autosave.save.clock.minute !== DAY_START) this.issue('no dawn autosave for today');
      else this.result.saves++;
    }
    if (this.opts.reloadEveryDawn && autosave && autosave.save.clock.day === this.clock.day) {
      await this.reload(autosave.save);
      // Continue from the dawn save: the morning's paper comes again (it was printed, not yet read, when the save was made).
      if (this.r.get('monde.press.pending')) { this.r.remove('monde.press.pending'); this.clock.resume('paper'); }
      else this.issue('loading the dawn save skips the morning paper');
    }
    if (this.clock.paused) this.issue(`the clock is held after the morning (${this.clock.pauseReasons.join(', ')})`);
  }

  /** Save → JSON → load (save/runtime.ts loadGame) → the Zone starts again from the save. */
  async reload(save: SaveGame): Promise<void> {
    const before = this.fingerprint();
    const copy = JSON.parse(JSON.stringify(save)) as SaveGame;
    await loadGame(asScene(this.scene), copy);
    this.result.reloads++;
    const after = this.fingerprint();
    for (const [k, v] of Object.entries(before)) if (JSON.stringify(after[k]) !== JSON.stringify(v)) this.issue(`reloading the dawn save changed ${k}: ${JSON.stringify(v).slice(0, 160)} → ${JSON.stringify(after[k]).slice(0, 160)}`);
  }

  /** What a reload must keep. */
  private fingerprint(): Record<string, unknown> {
    const r = asRegistry(this.r);
    const town = getTown(r)!;
    return {
      day: this.clock.day, minute: this.clock.minute, coins: coinsOf(r), stamina: economyOf(r).stamina, bag: bagOf(r).slots.filter(Boolean),
      flags: this.session.flags.serialize(), completed: [...this.session.director.serialize().completed].sort(),
      fund: town.fund, pillars: town.pillars, census: town.census, people: town.people?.households.length ?? 0,
      projects: Object.fromEntries(Object.entries(projectsOf(this.r).projects).map(([id, p]) => [id, [p.funded, p.vh, p.materials, p.opened, p.ceremony]])),
      marks: Object.entries(marks(this.r).entries).map(([id, e]) => `${id}:${e.status}`).sort(),
      puzzles: puzzleSave(this.r).rewarded, scuffles: Object.keys(scufflesOf(this.r).results).sort(),
      regard: Object.fromEntries(['pell', 'odile', 'kasimir', 'bertrand', 'margo', 'tib', 'nell', 'augusta'].map(id => [id, this.regard(id)])),
      favors: getFriendship(r).favor_book.map(f => `${f.id}:${f.status}`), papers: getFriendship(r).papers.length,
      fellow: getFellow(this.r)?.profile?.name ?? null, finale: finaleOf(this.r)
    };
  }

  /** Days a script saves by hand in the afternoon (the SaveMenu's slot), then loads it back (wherever it stands). */
  static readonly MANUAL_SAVES: Readonly<Record<Script, readonly number[]>> = { strong: [4, 12, 19], lazy: [], social: [6, 15] };

  private async manualSave(): Promise<void> {
    const before = this.fingerprint(), at = { ...this.loc };
    await saveGame('slot_1', 'manual', `Bot · Day ${this.clock.day}`);
    const entry = (await saveStorage.list()).find(e => e.slot === 'slot_1');
    if (!entry) { this.issue('a manual save wrote nothing'); return; }
    await loadGame(asScene(this.scene), JSON.parse(JSON.stringify(entry.save)) as SaveGame);
    this.result.reloads++;
    const after = this.fingerprint();
    for (const [k, v] of Object.entries(before)) if (JSON.stringify(after[k]) !== JSON.stringify(v)) this.issue(`a manual save at ${this.hhmm()} (${at.board} ${at.tile.join(',')}) loads with ${k} changed: ${JSON.stringify(v).slice(0, 160)} → ${JSON.stringify(after[k]).slice(0, 160)}`);
    if (this.loc.board !== at.board || this.loc.tile[0] !== at.tile[0] || this.loc.tile[1] !== at.tile[1]) this.issue(`a manual save on ${at.board} ${at.tile.join(',')} loads on ${this.loc.board} ${this.loc.tile.join(',')}`);
    this.log(`saved by hand at ${this.place() || this.loc.board} and loaded it`);
  }

  /** One day from the morning paper to bed. */
  async day(): Promise<void> {
    await this.morning();
    this.worked.clear();
    let saved = !SpringBot.MANUAL_SAVES[this.script].includes(this.clock.day);
    for (let guard = 0; guard < 400 && this.clock.minute < this.style.bedtime; guard++) {
      if (!saved && this.clock.minute >= 14 * 60 && !this.session.active) { saved = true; await this.manualSave(); }
      if (await this.story()) continue;
      if (await this.followHint()) continue;
      if (await this.act()) continue;
      await this.wait(15);
    }
    await this.bed();
  }

  /** The HUD's Next hint (story/hint.ts, as scenes/story/attach.ts computes it): go where it says, in time. */
  hint(): StoryHint | null {
    const done = this.session.director.serialize().completed;
    const context = { ...this.session.context(), zone: this.district, place: this.place() };
    return storyHint(this.session.scenes, context, this.session.flags, {
      placeName, zoneName: id => zones[id]?.name ?? id, route: (from, to) => zoneRoute(zones, from, to)
    }, new Set(done), this.session.active);
  }

  private async followHint(): Promise<boolean> {
    const hint = this.hint();
    if (!hint || hint.summoned) return false;
    const to = this.arrival(hint.place);
    if (!to) { this.issue(`the Next hint names ${hint.place}, which no board has`); return false; }
    const walk = this.walkMinutes(this.loc, to);
    if (walk === null) { this.issue(`the Next hint names ${hint.place}, which can't be walked to`); return false; }
    const now = this.clock.minute;
    // Leave in time for the window (with a quarter hour to spare).
    if (!hint.open && hint.start - now > walk + 30) return false;
    if (this.place() !== hint.place) {
      if (now + walk >= hint.end) return false;
      this.log(`Next hint: ${hint.text}`);
      this.walk(to, hint.place);
    }
    if (await this.story()) return true;
    // At the place: wait for the window (or a trigger the hint believed in).
    const waitFor = Math.max(5, Math.min(hint.end - this.clock.minute, Math.max(5, hint.start - this.clock.minute + 5)));
    if (hint.open && this.clock.minute >= hint.start) {
      // Open and here, and nothing started: the hint promised a scene the director won't play.
      if (!this.session.ready()) { this.issue(`the Next hint (${hint.sceneId} at ${hint.place}, ${hint.when}) is open and the player is there, but the scene doesn't start`); await this.wait(15); return true; }
    }
    await this.wait(waitFor);
    return true;
  }

  /** Home to bed (the cottage's bed: economy/attach.ts finishDay), or the pass-out at 26:00. */
  async bed(): Promise<void> {
    const r = asRegistry(this.r);
    await this.story();
    if (!this.moveTo(HOME) || this.place() !== HOME) this.issue('could not get home to bed');
    const day = this.clock.day;
    this.dayLine();
    r.set(ECONOMY_KEY, sleep(economyOf(r), this.clock.day, this.clock.minute));
    this.payStipend();
    const home = placeArrival(zones, interiors, HOME) ?? { zone: 'old_quarter', arrive: zones.old_quarter!.spawn };
    this.r.set('monde.save.wakePlayer', { zone: home.zone, x: home.arrive[0] + 0.5, y: home.arrive[1] + 0.5, facing: 0 });
    this.loc = { board: home.zone, tile: home.arrive };
    this.clock.startNextDay();
    this.scene.pump();
    if (this.clock.day !== day + 1) this.issue('sleeping did not start the next day');
  }

  private dayLine(): void {
    const r = asRegistry(this.r), town = getTown(r)!;
    const a = Math.round(computeAppealSafe(town) * 10) / 10;
    this.result.days.push({ day: this.clock.day, weekday: weekdayOf(this.clock.day), appeal: a, census: town.census, coins: coinsOf(r), fund: town.fund, stamina: Math.round(economyOf(r).stamina), did: [...this.today] });
  }

  // ── What the player chooses to do ─────────────────────────────────────────

  /** One thing worth doing now, done (true), or nothing (false). Ordered by what the script cares about. */
  private async act(): Promise<boolean> {
    const s = this.style;
    if (await this.ceremony()) return true;
    if (await this.eat()) return true;
    if (s.favors && await this.favors()) return true;
    if (s.puzzles && await this.sitePuzzle()) return true;
    if (s.builds && await this.build()) return true;
    if (s.marks !== 'none' && await this.readMarks()) return true;
    if (s.social && await this.socialise()) return true;
    if (s.scuffle === 'fight' && await this.streetScuffle()) return true;
    if (await this.communityWork()) return true;
    return false;
  }

  /** Eat when Stamina is low and there's food (the Bag), buying it at the general store if need be. */
  private async eat(): Promise<boolean> {
    const r = asRegistry(this.r);
    if (economyOf(r).stamina >= 25) return false;
    const bag = bagOf(r);
    const slot = bag.slots.findIndex(sl => sl && (itemById(sl.item)?.stamina ?? 0) > 0);
    if (slot >= 0) { const item = itemById(bag.slots[slot]!.item)!; if (consume(r, slot, item)) { this.log(`ate ${item.name}`); return true; } }
    if (coinsOf(r) >= 30 && this.clock.minute < 20 * 60 && (this.worked.get('shop') ?? 0) < 2) {
      this.worked.set('shop', (this.worked.get('shop') ?? 0) + 1);
      if (!this.moveTo('market_row.general_store')) return false;
      for (const id of ['supper', 'lunch']) this.buy(id);
      return true;
    }
    return false;
  }

  /** BagScene.buy at Dunmore's: coins, a free slot, the Project stock. */
  buy(id: string, n = 1): number {
    const r = asRegistry(this.r);
    if (this.place() !== 'market_row.general_store') { this.issue(`buying ${id} away from the general store (${this.place()})`); return 0; }
    const item = items.find(i => i.id === id);
    if (!item) { this.issue(`the general store has no ${id}`); return 0; }
    let bought = 0;
    for (let k = 0; k < n; k++) {
      const coins = coinsOf(r), bag = addItem(bagOf(r), item);
      if (coins < item.price || !bag || stockLeft(this.r, item.id) === 0) break;
      r.set(COINS_KEY, { balance: coins - item.price }); r.set(BAG_KEY, bag); recordSale(this.r, item.id);
      bought++;
    }
    if (bought) this.log(`bought ${bought} ${item.name} (${coinsOf(r)} coins left)`);
    return bought;
  }

  /** economy/attach.ts work(): a community job at its place. */
  private async communityWork(): Promise<boolean> {
    const s = this.style, r = asRegistry(this.r);
    if (!s.work) return false;
    const done = [...this.worked.entries()].filter(([k]) => k.startsWith('work:')).reduce((n, [, v]) => n + v, 0);
    if (done >= s.work || economyOf(r).stamina < 20) return false;
    const order: string[] = s.social ? ['mail', 'library', 'sweep'] : ['nets', 'mail', 'sweep', 'weeding', 'library', 'litter'];
    for (const id of order) {
      const task = COMMUNITY_TASKS.find(t => t.id === id)!;
      if (this.clock.day < task.opens || (this.worked.get(`work:${id}`) ?? 0) >= 1) continue;
      if (!this.moveTo(task.place)) continue;
      this.worked.set(`work:${id}`, 1);
      if (this.work(task)) return true;
    }
    return false;
  }

  private work(task: CommunityTask): boolean {
    const r = asRegistry(this.r), fellow = getFellow(this.r), town = getTown(r)!;
    if (this.place() !== task.place) { this.issue(`${task.name}: the job's place ${task.place} isn't where the player stands (${this.place()})`); return false; }
    const done = completeWork({ state: economyOf(r), coins: coinsOf(r), town, skills: fellow?.skills ?? baseSkills(), organizer: fellow?.profile?.background === 'organizer',
      day: this.clock.day, minute: this.clock.minute, task, id: uuid() });
    if (!done) { this.log(`${task.name}: refused (Stamina ${economyOf(r).stamina}, day ${economyOf(r).day})`); return false; }
    r.set(ECONOMY_KEY, done.state); r.set(COINS_KEY, { balance: done.coins }); r.set(TOWN_KEY, done.town);
    if (fellow) setFellow(this.r, { ...fellow, skills: done.skills });
    appendEvent(r, done.event);
    this.advance(done.minutes);
    this.log(`${task.name}: +${task.pay} coins`);
    return true;
  }

  // ── Puzzles ───────────────────────────────────────────────────────────────

  /** StoryScene.puzzle: the board opens; a player who solves it leaves it solved (completePuzzle checks the board). */
  private async storyPuzzle(id: string): Promise<boolean> {
    if (!puzzles[id]) { this.issue(`{puzzle: ${id}} has no board`); return false; }
    if (!this.style.puzzles) { this.log(`${id}: left the board unsolved`); return false; }
    return this.solve(id);
  }

  private solve(id: string): boolean {
    const cells = puzzleSolutions()[id]!;
    const ok = completePuzzle(this.r, this.clock, id, { ...puzzles[id]!.reset(), cells, solved: false });
    if (!ok) { this.issue(`${id}: the known solution was refused`); return false; }
    if (!this.result.puzzles.includes(id)) this.result.puzzles.push(id);
    this.log(`${id} solved`);
    return true;
  }

  /** puzzles/interaction.ts puzzleAt: the place prompt offers its puzzle now. */
  private puzzleHere(place: string): boolean {
    const save = puzzleSave(this.r);
    return !!puzzleAt(place, this.clock.day, this.flags(), id => !!save.entries[id]?.solved);
  }

  /** puzzleInteraction: a puzzle at its place, from its day (and after what it requires), until it's solved. */
  private async sitePuzzle(): Promise<boolean> {
    for (const [place, site] of Object.entries(PUZZLE_SITES)) {
      if (!this.puzzleHere(place)) continue;
      // The lighthouse lens waits for its Project; the market board for the Hall; the others any time.
      if (site.id === 'PZ-05' && !projectsOf(this.r).projects.lighthouse) continue;
      if (this.style.marks === 'some' && !['PZ-03', 'PZ-06', 'PZ-02'].includes(site.id)) continue;
      if (!this.moveTo(place)) continue;
      if (this.place() !== place) { this.issue(`${site.id}'s place ${place} can't be stood at`); continue; }
      return this.solve(site.id);
    }
    return false;
  }

  // ── Marks ─────────────────────────────────────────────────────────────────

  /** scenes/markInteraction.ts: read a Mark at its plaque, then name it in the Journal (submitMark). */
  private async readMarks(): Promise<boolean> {
    const state = marks(this.r);
    const chains = this.style.marks === 'all' ? ['OQ', 'MR', 'WF', 'CM'] : ['OQ'];
    for (const r of SPRING_RIDDLES) {
      if (r.chain === 'T' || !chains.includes(r.chain)) continue;
      const entry = state.entries[r.id];
      if (entry?.status === 'solved') continue;
      if (!entry) {
        // Can it be read yet? (riddles/engine.ts available: day, district, prerequisites, the previous Mark solved.)
        const spot = Object.values(boards).flatMap(b => b.marks).find(m => m.id === r.id);
        if (!spot) { this.issue(`${r.id} has no plaque on any board`); continue; }
        if (this.clock.day < r.startDay || (r.previous && state.entries[r.previous]?.status !== 'solved') || r.prerequisites.some(f => !this.flags().has(f))) continue;
        if (r.district === 'commons' && this.clock.day < 6) continue;
        const loc = { board: spot.zone, tile: spot.stand };
        if (!this.walk(loc, `mark:${r.id}`)) continue;
        if (!findMark(this.r, this.clock, r.id)) { this.issue(`${r.id}: standing at its plaque, it can't be read`); continue; }
        this.log(`read ${r.id} (${r.title})`);
      }
      const result = submitMark(this.r, this.clock, r.id, r.accepted[0]!);
      if (result !== 'solved') { this.issue(`${r.id}: answering "${r.accepted[0]}" gives ${result}`); continue; }
      this.result.marks.push(r.id);
      this.log(`solved ${r.id}: "${r.accepted[0]}"`);
      return true;
    }
    // Tib's duels (DialogueScene 'A riddle duel?': the next one is read, then answered in the Journal).
    const duel = this.style.marks === 'all' ? SPRING_RIDDLES.find(r => r.chain === 'T' && state.entries[r.id]?.status !== 'solved') : undefined;
    if (duel && (this.worked.get('duel') ?? 0) < 2) {
      this.worked.set('duel', (this.worked.get('duel') ?? 0) + 1);
      if (!(await this.goTo('tib'))) return false;
      if (!findMark(this.r, this.clock, duel.id)) { this.issue(`Tib's ${duel.id} can't be read in a duel`); return false; }
      const result = submitMark(this.r, this.clock, duel.id, duel.accepted[0]!);
      if (result !== 'solved') { this.issue(`${duel.id}: answering "${duel.accepted[0]}" gives ${result}`); return false; }
      this.result.marks.push(duel.id);
      this.log(`won Tib's duel ${duel.id}: "${duel.accepted[0]}"`);
      return true;
    }
    return false;
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  /** An opening due today: be at the site in its window and open it (projects/attach.ts startCeremony). */
  private async ceremony(): Promise<boolean> {
    for (const b of E.begun(PROJECTS, projectsOf(this.r))) {
      const c = b.progress.ceremony;
      if (!c || b.progress.opened !== null || c.day !== this.clock.day) continue;
      const site = siteFor(b.def, b.progress);
      if (!site) { this.issue(`${b.id}: an opening with no site`); continue; }
      if (this.clock.minute >= c.minute + E.CEREMONY_WINDOW) continue;
      const to = this.arrival(site.place);
      const walk = to ? this.walkMinutes(this.loc, to) : null;
      if (!to || walk === null) { this.issue(`${b.id}: its site ${site.place} can't be reached`); continue; }
      if (c.minute - this.clock.minute > walk + 30) continue;
      if (!this.walk(to, site.place)) continue;
      if (this.clock.minute < c.minute) await this.wait(c.minute - this.clock.minute);
      if (!E.ceremonyOpen(projectsOf(this.r).projects[b.id], { day: this.clock.day, minute: this.clock.minute })) { this.issue(`${b.id}: at the site in the window, the opening isn't open`); continue; }
      const present = this.presentAt(site.place);
      const opened = openProject(this.r, { day: this.clock.day, minute: this.clock.minute }, b.id, present);
      if (!opened.opened) { this.issue(`${b.id}: the opening didn't open it`); continue; }
      this.log(`opened ${b.id} (${Object.entries(opened.pillars).map(([k, v]) => `${k} +${v}`).join(', ')})`);
      return true;
    }
    return false;
  }

  private presentAt(place: string): string[] {
    return this.sim.tick(this.clock.day, this.clock.minute).filter(s => s.place === place && !s.traveling).map(s => s.id);
  }

  /** The next useful thing on the next Project (§6.3: sign, gather, work, puzzle); homes once the town's are done. */
  private async build(): Promise<boolean> {
    const r = asRegistry(this.r);
    syncProjects(this.r, { day: this.clock.day, minute: this.clock.minute });
    // Start a house when no other is under way (projects/attach.ts homesAt) and the Fund can spare it.
    if (this.clock.day >= 10 && !E.activeHomes(projectsOf(this.r)) && getTown(r)!.fund >= 900 && (this.worked.get('house') ?? 0) < 1) {
      this.worked.set('house', 1);
      const house = this.freeHouse();
      if (house && this.moveTo(house) && startHouse(this.r, { day: this.clock.day, minute: this.clock.minute }, house)) { this.log(`started restoring ${house}`); return true; }
    }
    const order = ['bakery_ovens', 'fountain', 'streetlights', 'community_garden', 'clocktower', 'homes', 'market_hall', 'lighthouse'];
    const begun = E.begun(PROJECTS, projectsOf(this.r)).filter(b => b.progress.opened === null)
      .sort((a, b) => order.indexOf(a.def.id) - order.indexOf(b.def.id));
    for (const b of begun) {
      const w = worldOf(this.r, { day: this.clock.day, minute: this.clock.minute });
      const stage = E.stageOf(b.def, b.progress, w);
      const site = siteFor(b.def, b.progress);
      if (!site) { this.issue(`${b.id}: no site on the boards`); continue; }
      if (stage === 'open') { if (await this.sign(b.id, b.def)) return true; continue; }
      if (stage === 'funded' || stage === 'gathering' || stage === 'building') {
        if (await this.gather(b.id, b.def, site.place)) return true;
        if (b.progress.vh < b.def.vh && await this.shift(b.id, site.place)) return true;
        await this.volunteers(b.id, b.def);
        continue;
      }
      if (stage === 'puzzle') {
        const place = Object.entries(PUZZLE_SITES).find(([, s]) => s.id === b.def.puzzle)?.[0];
        if (!place) { this.issue(`${b.id}: its puzzle ${b.def.puzzle} has no place to play it`); continue; }
        if (!this.puzzleHere(place)) continue;
        if (this.moveTo(place) && this.solve(b.def.puzzle!)) return true;
      }
    }
    return false;
  }

  private freeHouse(): string | null {
    const flags = this.flags();
    for (const z of Object.values(zones)) for (const p of z.places) {
      const key = `${z.id}.${p.id}`;
      if (!/^vacant_house_\d+$/.test(p.id) || flags.has(`project_${p.id}_done`) || projectsOf(this.r).projects[E.homesId(key)]) continue;
      const town = this.town();
      if (town.people?.households.some(h => h.home === key) || town.people?.pending.some(h => h.home === key)) continue;
      return key;
    }
    return null;
  }

  /** Pell signs (§6.3 step 2): at the Town Hall when she's in, else beside her (H). Short: the player's coins first. */
  private async sign(id: string, def: (typeof PROJECTS)[number]): Promise<boolean> {
    const r = asRegistry(this.r), now = () => ({ day: this.clock.day, minute: this.clock.minute });
    if (def.signoff.by === 'scene') return false;
    const short = E.fundShortfall(def, getTown(r)!);
    if (short > 0 && coinsOf(r) < short) return false;
    if (!(await this.goTo('pell'))) return false;
    if (short > 0) this.log(`put ${donateOwnCoins(this.r, id)} own coins into the Fund for ${id}`);
    const result = signWithPell(this.r, now(), id);
    if (!result.ok) { this.log(`Pell won't sign ${id} yet: ${result.line}`); return false; }
    this.log(`Pell signed ${id} (${def.fund} coins; Fund ${getTown(r)!.fund})`);
    return true;
  }

  /**
   * Walk to a resident where they are now (H beside them): in the open where they stand, or into the room they're in
   * (W-03: residents stand at their posts indoors). Not now when they're walking, off the boards, upstairs or behind a
   * door with no room (then the caller tries again later).
   */
  async goTo(resident: string): Promise<boolean> {
    const s = this.sim.sample(resident, this.clock.day, this.clock.minute);
    if (!s || s.traveling || !s.zone) return false;
    let target: Loc | null = null;
    if (s.visible && s.tile) target = { board: s.zone, tile: s.tile };
    else {
      const room = roomOf(interiors, s.place), local = s.place.slice(s.place.indexOf('.') + 1);
      if (room && room.places.some(p => p.id === local)) target = this.arrival(s.place);
    }
    if (!target || !this.walk(target, `resident:${resident}`)) return false;
    const again = this.sim.sample(resident, this.clock.day, this.clock.minute);
    return !!again && !again.traveling && (again.place === s.place || (again.visible && !!again.tile && Math.abs(again.tile[0] - this.loc.tile[0]) + Math.abs(again.tile[1] - this.loc.tile[1]) <= 3));
  }

  /** Materials: hand over what the Bag has; buy what Dunmore's sells; ask the authored donors. */
  private async gather(id: string, def: (typeof PROJECTS)[number], place: string): Promise<boolean> {
    const r = asRegistry(this.r), now = { day: this.clock.day, minute: this.clock.minute };
    const p = projectsOf(this.r).projects[id]!;
    const short = E.materialsShort(def, p, worldOf(this.r, now));
    if (!short.length) return false;
    const carried = (item: string) => bagOf(r).slots.reduce((n, sl) => n + (sl?.item === item ? sl.count : 0), 0);
    if (short.some(m => carried(m.item) > 0)) {
      if (!this.moveTo(place)) return false;
      const moved = handOverAt(this.r, { day: this.clock.day, minute: this.clock.minute }, id);
      if (!Object.keys(moved).length) { this.issue(`${id}: at its site with ${short.map(m => m.item).join(', ')} in the Bag, nothing could be handed over`); return false; }
      this.log(`handed over ${Object.entries(moved).map(([k, v]) => `${v} ${k}`).join(', ')} for ${id}`);
      return true;
    }
    // The authored donors (content donors: Regard ≥ 10).
    for (const d of def.donors) {
      if (p.material_donors.includes(d.resident) || !short.some(m => m.item === d.item) || this.regard(d.resident) < E.MATERIAL_DONOR_REGARD) continue;
      if ((this.worked.get(`donor:${d.resident}`) ?? 0) > 0) continue;
      this.worked.set(`donor:${d.resident}`, 1);
      if (!(await this.goTo(d.resident))) continue;
      const got = askForMaterial(this.r, { day: this.clock.day, minute: this.clock.minute }, id, d.resident, this.regard(d.resident));
      this.log(`asked ${d.resident} for ${d.item}: ${got.verdict}`);
      if (got.verdict === 'given') return true;
    }
    // Buy the rest at Dunmore's.
    if ((this.worked.get(`shop:${id}`) ?? 0) >= 1) return false;
    this.worked.set(`shop:${id}`, 1);
    const cost = short.reduce((n, m) => n + m.count * (itemById(m.item)?.price ?? 0), 0);
    if (coinsOf(r) < Math.min(cost, 30)) return false;
    if (!this.moveTo('market_row.general_store')) return false;
    let bought = 0;
    for (const m of short) bought += this.buy(m.item, m.count);
    if (!bought) this.log(`${id}: couldn't buy ${short.map(m => `${m.count} ${m.item}`).join(', ')} (coins ${coinsOf(r)}, stock ${short.map(m => stockLeft(this.r, m.item)).join('/')})`);
    return bought > 0;
  }

  private async shift(id: string, place: string): Promise<boolean> {
    const r = asRegistry(this.r);
    if (economyOf(r).stamina < 15 || this.clock.minute > 20 * 60 || (this.worked.get(`shift:${id}`) ?? 0) >= 2) return false;
    if (!this.moveTo(place)) return false;
    this.worked.set(`shift:${id}`, (this.worked.get(`shift:${id}`) ?? 0) + 1);
    const co = this.presentAt(place).filter(x => { const s = this.sim.sample(x, this.clock.day, this.clock.minute); return s?.activity === 'volunteer' || s?.activity === 'work'; });
    const out = workAt(this.r, { day: this.clock.day, minute: this.clock.minute }, id, co);
    if (!out.ok) { this.log(`work on ${id}: ${out.reason}`); return false; }
    this.advance(out.minutes);
    this.log(`worked on ${id}: +${out.vh} VH (${projectsOf(this.r).projects[id]!.vh}/${E.defOf(PROJECTS, id)!.vh})${out.regard.length ? `, beside ${out.regard.join(', ')}` : ''}`);
    return true;
  }

  /** Ask the leads (always yes for their own) to lend a hand tomorrow, when they can be found. */
  private async volunteers(id: string, def: (typeof PROJECTS)[number]): Promise<void> {
    const state = projectsOf(this.r);
    if (E.pledgedVh(state, id) >= def.vh) return;
    for (const lead of def.leads) {
      if (state.volunteers.some(v => v.resident === lead && v.day === this.clock.day + 1) || (this.worked.get(`ask:${id}:${lead}`) ?? 0) > 0) continue;
      if (!(await this.goTo(lead))) continue;
      this.worked.set(`ask:${id}:${lead}`, 1);
      const answer = askForHelp(this.r, { day: this.clock.day, minute: this.clock.minute }, id, lead, this.regard(lead));
      this.log(`asked ${lead} to help with ${id} tomorrow: ${answer.verdict}`);
    }
  }

  // ── Scuffles ──────────────────────────────────────────────────────────────

  /**
   * ScuffleScene: openScuffle's preparation (offers, prepare, witnesses), the board played by the script, and finish()'s
   * settle and the minutes it costs. A replayed key returns its stored result.
   */
  async fight(id: ScuffleId, key: string, opts: { story?: boolean; zone?: string; centre?: { x: number; y: number } } = {}): Promise<Outcome> {
    const previous = scufflesOf(this.r).results[key];
    if (previous) return previous.outcome as Outcome;
    const offers = (['augusta', 'kasimir', 'nell'] as const).map(a => ({ id: a, regard: this.regard(a), willScuffle: personaCards.find(c => c.id === a)?.will_scuffle !== false, willing: false }));
    const encounter = prepare(this.r, id, this.clock, { key, ...(opts.story ? { story: true } : {}), ...(opts.zone ? { zone: opts.zone } : {}), ...(opts.centre ? { centre: opts.centre } : {}), offers, regard: a => this.regard(a) });
    const b = encounter.battle;
    for (let n = 0; n < 600 && !b.outcome; n++) {
      const u = b.current;
      if (!u) { this.issue(`${id}: no one's turn`); break; }
      let action: Action;
      if (u.faction === 'enemy') action = b.intent(u).action;
      else action = this.scufflePlay(b, u as Fighter);
      if (!b.act(action) && !b.act({ kind: 'end' })) { this.issue(`${id}: stuck on ${u.id}'s turn`); break; }
      if (!b.outcome && b.current === u && u.state.apRemaining === 0) b.act({ kind: 'end' });
    }
    if (!b.outcome) { this.issue(`${id}: no outcome after 600 actions`); return 'loss'; }
    const consequence = settle(this.r, encounter, b.outcome, this.presentAt(encounter.place));
    this.advance(consequence.minutes);
    this.result.scuffles.push({ key, outcome: b.outcome });
    this.log(`Scuffle ${SCUFFLES[id].name}: ${b.outcome} (${b.log.slice(-1)[0] ?? ''})`);
    return b.outcome;
  }

  /** The scripted player's move: fight (the board's own intent: close in and swing), talk them down, or idle. */
  private scufflePlay(b: ReturnType<typeof prepare>['battle'], u: Fighter): Action {
    const style = this.style.scuffle;
    if (style === 'idle') return { kind: 'end' };
    const foes = b.opponents(u).sort((x, y) => distance(u.state.position, x.state.position) - distance(u.state.position, y.state.position));
    const near = foes[0];
    const odds = (t: Fighter) => talkOdds(b.setup.heart ?? 1, t.nerve, b.setup.scrapper, t.quit);
    if (u.id === 'player' && u.state.apRemaining >= 2) {
      // Words first where they're likely to land (or always, for a talker).
      const adjacent = foes.filter(t => distance(t.state.position, u.state.position) === 1).sort((x, y) => odds(y) - odds(x))[0];
      if (adjacent && (style === 'talk' || odds(adjacent) >= 0.6)) return { kind: 'talk', target: adjacent.id };
      // The tool that beats the nearest foe's (Odile's lesson: umbrella against Bru's pan), once, at the turn's start.
      if (near && u.state.apRemaining === u.stats.ap) {
        const best = b.tools.filter(t => t !== 'slingshot').sort((x, y) => triangle(y, near.tool) - triangle(x, near.tool))[0];
        if (best && best !== u.tool && triangle(best, near.tool) > triangle(u.tool, near.tool)) return { kind: 'tool', tool: best };
      }
    }
    const intent = b.intent(u).action;
    // Keep the last AP to Brace rather than walking into a swing.
    if (intent.kind === 'move' && u.state.apRemaining === 1 && near && distance(intent.to, near.state.position) <= 1) return { kind: 'brace' };
    return intent;
  }

  /** Saturday's Tollmen on Market Row (scuffles/interaction.ts scuffleInteraction: level ≥ 2 by the market). */
  private async streetScuffle(): Promise<boolean> {
    if (weekdayOf(this.clock.day) !== 'Sat' || this.clock.day < 6) return false;
    const key = `world:market_row:sc_market_saturday:${this.clock.day}`;
    if (scufflesOf(this.r).results[key] || (this.worked.get('scuffle') ?? 0) > 0) return false;
    this.worked.set('scuffle', 1);
    const { pressure } = await import('../scuffles/runtime');
    if (pressure(this.r, 'market_row', this.clock) < 2) return false;
    if (!this.moveTo('market_row.market_street')) return false;
    await this.fight('sc_market_saturday', key, { zone: 'market_row', centre: { x: this.loc.tile[0], y: this.loc.tile[1] } });
    return true;
  }

  // ── Friends and favors ────────────────────────────────────────────────────

  /** A liked gift a day to someone the player is getting to know (economy/runtime.ts giveGift), meeting them first. */
  private async socialise(): Promise<boolean> {
    if ((this.worked.get('gift') ?? 0) > 0) return false;
    this.worked.set('gift', 1);
    const round = ['odile', 'margo', 'kasimir', 'nell', 'june', 'teo', 'bertrand', 'augusta', 'tib', 'pell'];
    const who = round[this.clock.day % round.length]!;
    const card = personaCards.find(c => c.id === who)!;
    const r = asRegistry(this.r);
    // Something they like, from the store.
    const liked = items.find(i => i.price > 0 && i.tags.some(t => card.likes?.some(l => l.toLowerCase().includes(t)))) ?? items.find(i => i.id === 'flowers')!;
    if (!bagOf(r).slots.some(sl => sl?.item === liked.id)) {
      if (!this.moveTo('market_row.general_store') || !this.buy(liked.id)) return true;
    }
    if (!(await this.goTo(who))) return true;
    meetResident(r, who, this.clock.day);
    const slot = bagOf(r).slots.findIndex(sl => sl?.item === liked.id);
    const given = giveGift(r, this.clock, card, slot, liked as Item);
    this.log(given ? `gave ${who} ${liked.name}: ${given.reaction} (Regard ${given.regard.after})` : `couldn't give ${who} a gift`);
    return true;
  }

  /**
   * Additional fixture Favors, supplied as a server would: a
   * dialogue turn's `favors`, through shared instantiateFavor, into the favor book (DialogueScene.onTurn).
   */
  static readonly FAVOR_ASKS: Readonly<Record<Script, readonly { day: number; template: 'help_chore' | 'fetch' | 'find'; resident: string; target: string; text: string }[]>> = {
    strong: [{ day: 9, template: 'help_chore', resident: 'bertrand', target: 'bertrand', text: 'Could you help me with the shutters?' }],
    lazy: [],
    social: [
      { day: 4, template: 'help_chore', resident: 'odile', target: 'odile', text: 'Could you give me a hand upstairs?' },
      { day: 6, template: 'fetch', resident: 'margo', target: 'book', text: 'Could you find me a storybook for the children?' },
      { day: 11, template: 'find', resident: 'nell', target: 'shell', text: 'I lost a shell I keep for luck. Have a look round mine?' }
    ]
  };

  private offerFavors(): void {
    const r = asRegistry(this.r), day = this.clock.day;
    for (const ask of SpringBot.FAVOR_ASKS[this.script]) {
      if (favorBook(r).filter(f => ['proposed', 'accepted'].includes(f.status) && f.expires_day >= day).length >= 6) break;
      if (day < ask.day || favorBook(r).some(f => f.resident_id === ask.resident && ['proposed', 'accepted'].includes(f.status) && f.expires_day >= day)) continue;
      const id = `bot_${ask.template}_${ask.resident}_${ask.day}`;
      if (favorBook(r).some(f => f.id === id)) continue;
      const f = instantiateFavor({ template: ask.template, target: ask.target, text: ask.text }, id, ask.resident, {
        day, reachablePlace: place => !!placeArrival(zones, interiors, place), items: new Set(items.map(i => i.id)), places: new Set(allCards().map(c => c.home)),
        residents: new Map(allCards().map(c => [c.id, { home: c.home, reachable: true }])), met: () => false
      });
      if (!f) { this.issue(`a ${ask.template} Favor from ${ask.resident} could not be made`); continue; }
      updateFriendship(r, st => ({ ...st, favor_book: [...st.favor_book, f] }));
      this.log(`${ask.resident} asks a Favor: ${ask.text} (${f.task.kind} at ${f.task.place})`);
    }
  }

  /** Favors on offer: accept, then do the task (a chore or a search at its place, a handover beside the resident). */
  private async favors(): Promise<boolean> {
    const r = asRegistry(this.r);
    this.offerFavors();
    for (const f of favorBook(r)) {
      if (f.status === 'proposed' && f.expires_day >= this.clock.day) {
        const ok = chooseFavor(r, f.id, this.clock.day, true, this.clock.minute);
        this.log(`favor ${f.id} (${f.template}, ${f.task.kind} at ${f.task.place}): ${ok ? 'accepted' : 'could not accept'}`);
        if (!ok) this.issue(`favor ${f.id} could not be accepted`);
        return true;
      }
    }
    for (const f of favorBook(r)) {
      if (f.status !== 'accepted' || f.expires_day < this.clock.day || (this.worked.get(`favor:${f.id}`) ?? 0) > 1) continue;
      this.worked.set(`favor:${f.id}`, (this.worked.get(`favor:${f.id}`) ?? 0) + 1);
      if (f.task.kind === 'chore' || (f.task.kind === 'find' && !f.found)) {
        // ZoneScene: E at the place runs friendship/favors.ts favorInteraction (the chore, or the search).
        if (!zones[f.task.place.split('.')[0]!]) { this.issue(`favor ${f.id} (${f.resident_id}): its ${f.task.kind} is at ${f.task.place}, a district a Spring player can't enter`); continue; }
        if (!this.moveTo(standingPlace(interiors, f.task.place))) continue;
        const here = `${this.district}.${this.place().slice(this.place().indexOf('.') + 1)}`;
        const prompt = favorInteraction(r, this.clock, here);
        if (!prompt) { this.issue(`favor ${f.id} (${f.resident_id}): at its ${f.task.kind} place ${f.task.place} the player stands at ${here || 'no place'}, and no E prompt appears, so it can't be done`); continue; }
        prompt.run();
        const after = favorBook(r).find(x => x.id === f.id);
        this.log(`${prompt.label} for ${f.resident_id}: ${after?.status}${after?.found ? ' (found)' : ''}`);
        if (f.task.kind === 'chore' && after?.status !== 'completed') this.issue(`favor ${f.id}: the chore ran but the Favor isn't completed`);
        return true;
      }
      if (f.task.kind === 'handover' || f.task.kind === 'find') {
        const item = f.task.item!;
        if (!bagOf(r).slots.some(sl => sl?.item === item)) {
          if (f.task.kind === 'find' || !this.moveTo('market_row.general_store') || !this.buy(item)) continue;
        }
        if (!(await this.goTo(f.resident_id))) continue;
        const slot = bagOf(r).slots.findIndex(sl => sl?.item === item);
        const card = findCard(f.resident_id)!;
        // DialogueScene.openGift: giving the asked-for item completes the Favor.
        const ok = finishFavor(r, this.clock, f, favorProof(r, this.clock, f, card.id, card.home), slot);
        this.log(`gave ${f.resident_id} the ${item} for favor ${f.id}: ${ok ? 'completed' : 'refused'}`);
        if (!ok) this.issue(`favor ${f.id}: handing ${f.resident_id} the ${item} didn't complete it`);
        return true;
      }
    }
    return false;
  }

  // ── Playing it through ────────────────────────────────────────────────────

  async play(): Promise<BotResult> {
    this.newGame();
    await this.story();
    const last = this.opts.lastDay ?? 25;
    while (this.clock.day <= last) await this.day();
    // Day 26: the paper prints the poll, then the End-of-Spring report (finale/attach.ts, once the paper is read).
    await this.morning();
    await this.story();
    if (this.clock.day >= REPORT_DAY) this.finish();
    this.summarise();
    return this.result;
  }

  /** The report the game opens on Day 26 (SpringReportScene.report), from the final state. */
  private finish(): void {
    const r = asRegistry(this.r);
    if (!reportDue(this.r, this.clock.day)) this.issue('the End-of-Spring report is not due on Day 26');
    if (this.r.get('monde.press.pending')) this.issue('the paper is still pending when the report is due');
    ensureStrawPoll(this.r, id => this.regard(id), worldSeedOf(this.r));
    const town = getTown(r)!, first = firstArrival(town.people);
    const name = (id: string) => townNames()[id] ?? findCard(id)?.name ?? id;
    this.result.report = springReport({
      day: this.clock.day, town, projects: projectsOf(this.r), scuffles: scufflesOf(this.r), friendship: getFriendship(r),
      riddles: marks(this.r), regard: id => this.regard(id), name, flags: flagsOf(this.r), poll: finaleOf(this.r).poll,
      firstArrival: first ? { name: name(first.card.id), day: first.arrived_day } : null
    });
    updateFinale(this.r, s => ({ ...s, reportDay: Math.max(REPORT_DAY, this.clock.day) }));
  }

  private summarise(): void {
    const res = this.result, w = worldOf(this.r, { day: this.clock.day, minute: this.clock.minute });
    res.flags = this.session.flags.serialize();
    for (const b of E.begun(PROJECTS, projectsOf(this.r))) res.projects[b.id] = { opened: b.progress.opened, stage: E.stageOf(b.def, b.progress, w) };
    res.favors = favorBook(asRegistry(this.r)).map(f => ({ id: f.id, status: f.status }));
    const town = this.town();
    res.arrivals = town.people?.households.reduce((n, h) => n + h.residents.length, 0) ?? 0;
    res.departures = town.people?.departed?.length ?? 0;
    res.poll = finaleOf(this.r).poll;
  }
}

const computeAppealSafe = (town: TownState): number => computeAppeal(town).appeal;

// ── A static audit: every place the Spring sends the player can be stood at ─────────────────────

/**
 * Every place a Spring system names (scene headers, Project sites and work areas, community jobs, puzzle sites, the
 * residents' homes a Favor's chore is done at, the Mark plaques, the general store's stock): walking to it lands the
 * player where the game's place test (story/host.ts placeAt, the E prompt) says they're at it, by a route from home.
 */
export function auditSpring(): string[] {
  const bot = new SpringBot('strong');
  bot.newGame();
  const out: string[] = [];
  const setback = runDawnsThrough({ ...createTownState(), census: 199 }, 8).state;
  const clauseRegistry = { set: () => {}, remove: () => {}, get: (key: string): unknown => key === 'monde.town' ? setback : undefined };
  for (const building of ['fish_market', 'boathouse']) {
    if (!doorLocked(clauseRegistry, { district: 'wharf', building })) out.push(`Option Clause: ${building} did not close`);
    const reopened = { set: () => {}, remove: () => {}, get: (key: string): unknown => key === 'monde.town' ? setTownFlag(setback, 'charter_found') : undefined };
    if (doorLocked(reopened, { district: 'wharf', building })) out.push(`Option Clause: ${building} did not reopen`);
  }
  const home = bot.arrival(HOME)!;
  const check = (what: string, place: string, opts: { keys?: boolean } = {}) => {
    if (opts.keys) bot.session.flags.set('cottage_keys_given');
    const to = bot.arrival(place);
    if (!to) { out.push(`${what}: ${place} is on no board`); return; }
    if (bot.walkMinutes(home, to) === null) out.push(`${what}: ${place} can't be walked to from the cottage`);
    const at = bot.place(to);
    if (at !== place) out.push(`${what}: arriving at ${place} (${to.board} ${to.tile.join(',')}) stands at ${at || 'no place'}`);
  };
  for (const sc of SPRING_SCENES) if (sc.header && !sc.header.calledFrom) check(`scene ${sc.id}`, sc.header.place);
  for (const def of PROJECTS) {
    if (def.site.place === 'house') continue;
    check(`project ${def.id} site`, def.site.place, { keys: true });
    check(`project ${def.id} work`, def.site.work.place, { keys: true });
  }
  for (const t of COMMUNITY_TASKS) check(`job ${t.id}`, t.place, { keys: true });
  for (const place of Object.keys(PUZZLE_SITES)) check(`puzzle ${PUZZLE_SITES[place]!.id}`, place, { keys: true });
  const favorWorld = {
    day: 2, items: new Set(items.map(i => i.id)),
    places: new Set(personaCards.flatMap(c => [c.home, c.workplace, ...c.routine.weekday.map(b => b.where), ...c.routine.weekend.map(b => b.where)])),
    residents: new Map(personaCards.map(c => [c.id, { home: c.home, workplace: c.workplace, places: [...c.routine.weekday, ...c.routine.weekend].map(b => b.where), reachable: true }])),
    reachablePlace: (place: string) => !!placeArrival(zones, interiors, place), met: () => false,
  };
  for (const c of personaCards.filter(c => c.kind !== 'animal')) {
    const f = instantiateFavor({ template: 'help_chore', target: c.id, text: 'Help?' }, `audit_${c.id}`, c.id, favorWorld);
    if (!f) { out.push(`${c.id} has no reachable Favor location`); continue; }
    check(`${c.id}'s Favor`, standingPlace(interiors, f.task.place), { keys: true });
  }
  for (const m of Object.values(boards).flatMap(b => b.marks)) {
    const to = { board: m.zone, tile: m.stand };
    if (bot.walkMinutes(home, to) === null) out.push(`Mark ${m.id}: its plaque on ${m.zone} can't be walked to`);
  }
  for (const def of PROJECTS) for (const m of def.materials) {
    const item = itemById(m.item);
    if (!item) out.push(`project ${def.id}: material ${m.item} is no item`);
    else if (!item.price && !def.donors.some(d => d.item === m.item)) out.push(`project ${def.id}: ${m.item} can't be bought or given`);
  }
  return out;
}

/** Play one script through Spring. */
export async function playSpring(script: Script, opts: BotOptions = {}): Promise<BotResult> {
  return new SpringBot(script, opts).play();
}

export const PROJECT_IDS = PROJECTS.map(p => p.id);
