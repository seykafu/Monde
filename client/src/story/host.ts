import type { Outcome as ScuffleOutcome } from '../combat/scuffle/engine';
// The story host's pure parts (MVP G-10 part 2). No Phaser, no DOM: everything here runs under vitest.
//
// - buildStoryContext: the StoryContext the director reads, from the live game (clock, zone, the place the
//   player is at, the town engine's Pillars/Appeal/census, the Fellowship profile) plus the story ledger.
// - createStoryHandlers: one handler per host cue. Durable effects (Regard, Pillars, coins, items, memories)
//   are idempotent per `scene|cue key`, so a scene restarted from a save doesn't apply them twice (README).
//   Presentation and interactive cues go to the StoryPresenter (StoryScene); world effects go to the
//   StoryWorld (scenes/story/attach.ts). Anything without somewhere to go warns in development and continues.
// - encodeStory/decodeStory: the director and ledger inside the save's existing `story_flags` record.
// - placeAt: which `zone.place` the player is at, for place triggers.
import type { ClientEvent, SaveGame, SceneHeader } from '@monde/shared';
import { scriptedMemory, scriptedRegard, townEvent } from '../mind/events';
import { weekdayOf } from '../sim/clock';
import { computeAppeal } from '../town/appeal';
import { isFerryDay } from '../town/migration';
import { TOWN_FLAGS, applyPillarDelta, createTownState, setTownFlag, type TownState } from '../town/pillars';
import { nearbyPlace, placeName, type Position } from '../world/player';
import type { ZoneDef } from '../world/zoneFormat';
import type { StorySave } from './director';
import type { CueContext, HostCue, StoryHandlers, StoryLine } from './runtime';
import type { StoryContext } from './triggers';

// ── The player ──────────────────────────────────────────────────────────────

/** The Fellowship application as the story reads it (§11.1; `player.why`, `player.background`, `{name}`). */
export interface FellowProfile {
  name: string;
  pronouns: string;
  background: string;
  why: string;
  loves?: string;
}

/** Before the form is signed: residents say "Fellow" (mind/api DEFAULT_PLAYER_NAME), they/them. */
export const DEFAULT_FELLOW: Readonly<FellowProfile> = { name: 'Fellow', pronouns: 'they/them', background: 'tinkerer', why: 'curious', loves: 'tea' };

/**
 * The Fellowship application is signed (GDD §11.1: Pell hands the form over on the ferry slip in S01a, at its
 * {charcreate} cue). A New Game reaches the cue unsigned (no profile); so does `?skiptitle=1`'s default "Fellow"
 * (fellow/state.ts ensureFellow), and a save made before the cue, which plays S01a again from its start.
 */
export const fellowSigned = (profile: FellowProfile | null | undefined): boolean =>
  !!profile && (['name', 'pronouns', 'background', 'why'] as const).some(k => profile[k] !== DEFAULT_FELLOW[k]);

/** Profiles written before the ids matched §13.3 said "running_from_something"; scripts test `running`. */
export const normalizeWhy = (why: string): string => (why === 'running_from_something' ? 'running' : why);

export interface PronounWords { they: string; them: string; their: string; theyre: string }

/** `{they}` / `{them}` / `{their}` / `{theyre}` (§13.1) for a preset or custom "subject/object/possessive" set. */
export function pronounWords(pronouns: string): PronounWords {
  const p = pronouns.trim().toLowerCase();
  if (p === 'she/her') return { they: 'she', them: 'her', their: 'her', theyre: "she's" };
  if (p === 'he/him') return { they: 'he', them: 'him', their: 'his', theyre: "he's" };
  const [they, them, their] = p.split('/');
  if (p !== 'they/them' && they && them && their) return { they, them, their, theyre: `${they}'s` };
  return { they: 'they', them: 'them', their: 'their', theyre: "they're" };
}

// ── The ledger ──────────────────────────────────────────────────────────────

/**
 * Story-side state for effects whose real owners don't exist on the client yet, saved with the story.
 * - regard: scripted Regard deltas as the story applied them. The server owns Regard (§9.4): each delta is queued as a
 *   `scripted_regard` ClientEvent (M-06), and in the game the context reads the friendship mirror instead
 *   (WorldNow.regard: the server's snapshot plus what's still queued). The ledger's values stand in for residents the
 *   game doesn't mirror (the S05 `arrival`) and when no world supplies Regard (tests).
 * - coins / items / riddles: typed placeholders until the inventory and Marks systems land. projects: the ids the
 *   story's {project} cues opened (the Projects themselves live in projects/runtime.ts, G-03).
 * - applied: `scene|cue key` of every durable effect already applied (idempotent restarts).
 */
export interface StoryLedger {
  regard: Record<string, number>;
  coins: number;
  items: Record<string, number>;
  projects: string[];
  riddles: string[];
  applied: string[];
}

/**
 * GDD-GAP: the client doesn't know the server's Regard, so the mirror starts every resident at 0 (Stranger)
 * except `arrival` at +5 (§13.3 "Regard"); Homecomer starts (§11.1) and tier clamps (§9.4) are server-side.
 * GDD-GAP: §11 gives the Fellow no starting purse, so the placeholder wallet starts empty.
 */
export const emptyLedger = (): StoryLedger => ({ regard: { arrival: 5 }, coins: 0, items: {}, projects: [], riddles: [], applied: [] });

/**
 * GDD-GAP: the arrival generator (§6.4, Appendix A) isn't built, so S05's `{arrival.*}` tokens read this
 * stand-in until the first generated arrival's card exists.
 */
export const ARRIVAL_STANDIN = { id: 'arrival', name: 'Robin', trade: 'Baker', reason: 'Wanted a fresh start.' } as const;

// ── Context ─────────────────────────────────────────────────────────────────

export interface WorldNow {
  day: number;
  /** Minutes since the start of the game day, 360–1560 (the clock's own range). */
  minute: number;
  zone: string;
  /** `zone.place` the player is at, or '' between places. */
  place: string;
  town?: TownState;
  profile?: FellowProfile | null;
  asleep?: boolean;
  inScuffle?: boolean;
  /** Regard toward the player by resident, as the game mirrors it (scenes/friendship.ts regardFor); over the ledger's. */
  regard?: Readonly<Record<string, number>>;
  /** G-02: S05's `{arrival.*}` from the first real arrival's card, once there is one (else ARRIVAL_STANDIN). */
  arrival?: { id: string; name: string; trade: string; reason: string };
}

/** The StoryContext for the director: the live world, the ledger, and any puzzle/riddle/scuffle outcomes. */
export function buildStoryContext(world: WorldNow, ledger: StoryLedger, outcomes: Readonly<Record<string, unknown>> = {}): StoryContext {
  const profile = { ...DEFAULT_FELLOW, ...(world.profile ?? {}) };
  const town = world.town ?? createTownState({ day: world.day });
  return {
    day: world.day,
    minute: world.minute,
    weekday: weekdayOf(world.day).toLowerCase(),
    zone: world.zone,
    place: world.place,
    pillar: { ...town.pillars },
    regard: { ...ledger.regard, ...(world.regard ?? {}) },
    values: {
      name: profile.name,
      ...pronounWords(profile.pronouns),
      player: { name: profile.name, pronouns: profile.pronouns, background: profile.background, why: normalizeWhy(profile.why), loves: profile.loves ?? '' },
      census: town.census,
      appeal: computeAppeal(town).appeal,
      ferry_day: isFerryDay(world.day, town.flags),
      coins: ledger.coins,
      arrival: { ...(world.arrival ?? ARRIVAL_STANDIN) },
      ...outcomes
    },
    ...(world.asleep ? { asleep: true } : {}),
    ...(world.inScuffle ? { inScuffle: true } : {})
  };
}

/**
 * The place the player is at: a doorstep within a tile (world/player nearbyPlace, as the E prompt uses), else
 * the smallest place whose rect holds the player's tile (open ground: the ferry slip, Fountain Square).
 */
export function placeAt(zone: Pick<ZoneDef, 'id' | 'places'>, p: Position): string {
  const door = nearbyPlace(zone as ZoneDef, p);
  if (door) return `${zone.id}.${door.id}`;
  const tx = Math.floor(p.x), ty = Math.floor(p.y);
  const inside = zone.places.filter(({ rect: [x, y, w, h] }) => tx >= x && tx < x + w && ty >= y && ty < y + h)
    .sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3]);
  return inside[0] ? `${zone.id}.${inside[0].id}` : '';
}

/**
 * A line as the panel shows it. Scripts italicise names with markdown (`The *Gannet*`); Phaser text can't style
 * a span, so the markers go and the words stay.
 */
export const plainText = (text: string): string => text.replace(/\*{1,2}([^*\n]+?)\*{1,2}/g, '$1');

/** "Bloom Fair (opening)" from "S10a · Bloom Fair (opening)". */
export const sceneName = (title: string | undefined, id: string): string => (title ?? id).replace(/^[A-Z]+\d+[a-z]?\s*·\s*/, '');

/** One-line summons for an appointment scene (§13.3 "Summoned scenes"). */
export function summonText(header: Pick<SceneHeader, 'place'>, title: string | undefined, zoneName: string): string {
  const [, placeId = ''] = header.place.split('.');
  return `${sceneName(title, header.place)} is starting: ${placeName(placeId)}, ${zoneName}.`;
}

/**
 * The scene's brief or topic as the talk API's `current_activity` (≤ 120 characters, server routes.ts), cut at
 * a word. GDD-GAP: /talk has no topic or brief field yet, so this is how an {ai_open}/{ai_line} seed reaches
 * the resident's prompt (block 4's "doing", memory retrieval and topic cards).
 */
export function clipActivity(text: string, max = 120): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.(-]+$/, '')}…`;
}

// ── Cues ────────────────────────────────────────────────────────────────────

type Cue<K extends HostCue['cmd']> = Extract<HostCue, { cmd: K }>;

/** The StoryScene: presentation and the interactive handoffs. */
export interface StoryPresenter {
  backdrop(id: string): void;
  music(id: string): void;
  fade(): Promise<void>;
  wait(seconds: number): Promise<void>;
  /** False for an effect it doesn't know. */
  cam(effect: string): boolean;
  /** False for a sound it doesn't have. */
  sfx(id: string): boolean;
  /** An {ai_line} is being fetched for this speaker. */
  thinking(speaker: string): void;
  confirm(text: string, yes: string, no: string): Promise<boolean>;
  /** A stand-in for a system that isn't built yet: true for the success branch. */
  placeholder(kind: 'puzzle' | 'scuffle', id: string): Promise<boolean>;
  scuffle?(id: string, key: string): Promise<ScuffleOutcome>;
  puzzle?(id: string): Promise<boolean>;
  /** The Fellowship form (§11.1); false when there's none to open. */
  charcreate(): Promise<boolean>;
  /** {ai_open}: a live exchange in the dialogue panel; resolves when it closes. */
  aiOpen(cue: Cue<'ai_open'>, place: string): Promise<readonly StoryLine[]>;
}

/** The game around the story (scenes/story/attach.ts). */
export interface StoryWorld {
  readRiddle?(id: string): boolean;
  now(): WorldNow;
  setTown(state: TownState): void;
  /** The event log's queued ClientEvents (mind/events.ts; sent to monde-mind online, saved meanwhile). */
  events(): readonly ClientEvent[];
  /** Queue a ClientEvent (scenes/events.ts appendEvent checks it against the contract). */
  appendEvent(event: ClientEvent): void;
  /** A fresh event id (a UUID), given once when the event is queued. */
  newId(): string;
  /** Save the director and ledger into the registry the save system reads. */
  persist(): void;
  checkpoint(key: string): Promise<void>;
  /** Move the player to a summoned scene's place. */
  travel(place: string): void;
  zoneName(zone: string): string;
  /** One live line for {ai_line}; [] means use the authored fallback. */
  aiLine(residentId: string, brief: string): Promise<readonly StoryLine[]>;
  /** {project: id} for the Projects engine (G-03); false for a Project it doesn't know. */
  projectCue?(id: string, sceneId: string): boolean;
}

export interface HandlerDeps {
  dev: boolean;
  warn(message: string): void;
  ledger(): StoryLedger;
  world(): StoryWorld | null;
  presenter(): StoryPresenter | null;
  setOutcome(name: 'puzzle' | 'riddle' | 'scuffle', value: Record<string, boolean>): void;
  /** The `zone.place` a scene is set in (memories are written there). */
  scenePlace(sceneId: string): string;
}

/** GDD-GAP: §13.1 doesn't time a bare {wait}; one second reads as a beat. */
export const DEFAULT_WAIT_SECONDS = 1;

/** Ids the durable effects are keyed by: one per cue position, stable across a restarted scene. */
export const effectKey = (ctx: Pick<CueContext, 'scene' | 'key'>): string => `${ctx.scene}|${ctx.key}`;

export function createStoryHandlers(deps: HandlerDeps): StoryHandlers {
  const note = (message: string) => { if (deps.dev) deps.warn(`[story] ${message}`); };
  /** Apply a durable effect once per cue position. */
  const once = (ctx: CueContext, apply: () => void): void => {
    const ledger = deps.ledger(), key = effectKey(ctx);
    if (ledger.applied.includes(key)) return;
    apply();
    ledger.applied.push(key);
  };
  /** Queue a cue's ClientEvent once (a restarted scene's cue is already in the log, or already applied). */
  const cueEvent = (ctx: CueContext, kind: 'scripted_memory' | 'scripted_regard', build: (world: StoryWorld) => ClientEvent): void => {
    const world = deps.world();
    if (!world) { note(`no world to log ${kind}`); return; }
    if (world.events().some(e => e.kind === kind && e.scene_id === ctx.scene && e.cue_key === ctx.key)) return;
    world.appendEvent(build(world));
  };
  const stamp = (world: StoryWorld, ctx: CueContext) => ({ id: world.newId(), day: ctx.game.day, minute: ctx.game.minute });
  const cue = (ctx: CueContext) => ({ scene_id: ctx.scene, cue_key: ctx.key });
  const where = (ctx: CueContext): string => deps.scenePlace(ctx.scene) || ctx.game.place;
  const stage = (what: string): StoryPresenter | null => {
    const p = deps.presenter();
    if (!p) note(`no presenter for {${what}}`);
    return p;
  };

  return {
    // Presentation.
    backdrop: cue => { stage('backdrop')?.backdrop(cue.id); },
    music: cue => { stage('music')?.music(cue.id); },
    fade: async () => { await stage('fade')?.fade(); },
    wait: async cue => { await stage('wait')?.wait(cue.seconds ?? DEFAULT_WAIT_SECONDS); },
    cam: cue => { const p = stage('cam'); if (p && !p.cam(cue.effect)) note(`unknown camera effect ${cue.effect}`); },
    sfx: cue => { const p = stage('sfx'); if (p && !p.sfx(cue.id)) note(`unknown sound ${cue.id}`); },

    // Durable world effects.
    regard: (r, ctx) => once(ctx, () => {
      const ledger = deps.ledger();
      ledger.regard[r.resident] = (ledger.regard[r.resident] ?? 0) + r.delta;
      cueEvent(ctx, 'scripted_regard', w => scriptedRegard(stamp(w, ctx), cue(ctx), { resident: r.resident, delta: r.delta }));
    }),
    pillar: (cue, ctx) => once(ctx, () => {
      const world = deps.world(), town = world?.now().town;
      if (!world || !town) { note(`no town engine for {pillar: ${cue.pillar}}`); return; }
      world.setTown(applyPillarDelta(town, cue.pillar, cue.delta, 'story', ctx.scene));
    }),
    coins: (cue, ctx) => once(ctx, () => { deps.ledger().coins += cue.delta; }),
    item: (cue, ctx) => once(ctx, () => {
      const items = deps.ledger().items;
      items[cue.item] = Math.max(0, (items[cue.item] ?? 0) + cue.delta);
    }),
    // {project: id} (§13.1 "Unlocks a Project"): the Projects engine opens it (G-03, projects/runtime.ts projectCue), and
    // S04's carries Pell's signature ("Pell signed the chit at seven"). The ledger keeps the id too. Unlocking isn't
    // §9.6's `project_open` (that's the opening ceremony's town event), so nothing is sent here.
    project: (cue, ctx) => once(ctx, () => {
      const projects = deps.ledger().projects;
      if (!projects.includes(cue.id)) projects.push(cue.id);
      const known = deps.world()?.projectCue?.(cue.id, ctx.scene) ?? false;
      if (!known) note(`{project: ${cue.id}} is not one of content/projects.yaml's Projects; kept in the ledger only`);
    }),
    // A `scripted_memory` ClientEvent (M-06): the server writes it with the player and the resident as `who` (valence
    // is unauthored: the server's GDD-GAP keeps it neutral). The S05 `arrival` alias waits in the log until the arrival
    // generator gives it a real resident id (mind/events.ts HELD_RESIDENTS).
    memory: (m, ctx) => once(ctx, () => cueEvent(ctx, 'scripted_memory', w => scriptedMemory(stamp(w, ctx), cue(ctx),
      { resident: m.resident, place: where(ctx), text: m.text, importance: m.importance }))),
    checkpoint: async cue => {
      const world = deps.world();
      if (!world) { note(`no world for {checkpoint: ${cue.key}}`); return; }
      world.persist();
      try { await world.checkpoint(cue.key); } catch (error) { deps.warn(`[story] checkpoint ${cue.key} failed: ${String(error)}`); }
    },

    // Systems still to come: typed placeholders.
    puzzle: async cue => {
      const solved = (await deps.presenter()?.puzzle?.(cue.id)) ?? false;
      deps.setOutcome('puzzle', { solved });
    },
    scuffle: async (sc, ctx) => {
      const presenter = deps.presenter();
      const outcome = (await presenter?.scuffle?.(sc.id, effectKey(ctx))) ?? 'loss';
      const won = outcome === 'win' || outcome === 'talk_down';
      deps.setOutcome('scuffle', { won, lost: outcome === 'loss', fled: outcome === 'flee', talked_down: outcome === 'talk_down' });
      // A Scuffle is a §9.6 town event (importance 7): everyone in sight remembers it (server witnessing).
      once(ctx, () => {
        // G-08's real presenter owns its event alongside the consequence transaction.
        if (presenter?.scuffle) return;
        const world = deps.world();
        if (!world) { note(`no world to log {scuffle: ${sc.id}}`); return; }
        world.appendEvent(scuffleEvent(stamp(world, ctx), sc.id, where(ctx), won, ctx.game));
      });
    },
    riddle: (cue, ctx) => {
      once(ctx, () => { const r = deps.ledger().riddles; if (!r.includes(cue.id)) r.push(cue.id); });
      const solved = deps.world()?.readRiddle?.(cue.id) ?? false;
      deps.setOutcome('riddle', { solved });
    },

    // Handoffs.
    charcreate: async () => {
      if (fellowSigned(deps.world()?.now().profile)) { note('{charcreate}: the application is already signed; skipping the form'); return; }
      const p = stage('charcreate');
      if (p && !(await p.charcreate())) note('{charcreate}: no Fellowship form registered; keeping the current profile');
    },
    ai_line: async cue => {
      const world = deps.world();
      if (!world) return [];
      deps.presenter()?.thinking(cue.speaker.id);
      // GDD-GAP: `auto:` speakers should be the resident with the strongest open concern (§13.1); the client
      // can't see concerns, so the default speaker is used online as well as in Quiet Mode.
      return world.aiLine(cue.speaker.id, cue.brief);
    },
    ai_open: async (cue, ctx) => {
      const p = stage('ai_open');
      return p ? p.aiOpen(cue, deps.scenePlace(ctx.scene) || ctx.game.place) : [];
    }
  };
}

/**
 * The residents a Scuffle is fought against (§7.9's Enemies column), by resident id; enemies without a persona card
 * (Dex, Dom, hired hands, animals) aren't residents the server knows, so they're left out.
 */
export const SCUFFLE_ENEMIES: Readonly<Record<string, readonly string[]>> = {
  sc_bakery_tutorial: ['bru', 'nettie'],
  sc_quarry_first: ['bru', 'nettie'],
  sc_quarry_rook_1: ['rook'], sc_quarry_rook_2: ['rook'], sc_quarry_rook_3: ['rook'],
  sc_quarry_final: ['rook'],
  sc_vane_office_guard: ['bru']
};

const titleCase = (id: string): string => id.split('_').map(w => (w[0] ?? '').toUpperCase() + w.slice(1)).join(' ');
const listNames = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** A story Scuffle as a `town_event` (§9.6 type `scuffle`): the player and the enemies take part, at the scene's place. */
export function scuffleEvent(s: { id: string; day: number; minute: number }, scuffleId: string, place: string, won: boolean, game: Pick<CueContext['game'], 'values'>): ClientEvent {
  const enemies = SCUFFLE_ENEMIES[scuffleId] ?? [];
  const name = typeof game.values?.name === 'string' ? game.values.name : DEFAULT_FELLOW.name;
  const against = enemies.length ? ` against ${listNames(enemies.map(titleCase))}` : '';
  const [, placeId = ''] = place.split('.');
  return townEvent(s, {
    type: 'scuffle', place, participants: ['player', ...enemies],
    summary: `${name} ${won ? 'won' : 'lost'} a Scuffle${against} at ${placeName(placeId)}.`
  }) as ClientEvent;
}

/** Story flags the town engine reads (§6.2, §6.5) follow the story: set in one, set in the other. */
export function syncTownFlags(town: TownState, flags: ReadonlySet<string>): TownState {
  let next = town;
  for (const flag of TOWN_FLAGS) if (flags.has(flag) && !next.flags[flag]) next = setTownFlag(next, flag);
  return next;
}

// ── The save ────────────────────────────────────────────────────────────────

/** The reserved `story_flags` key holding the director's queue/completions and the ledger (flags can't contain `$`). */
export const STORY_META_KEY = '$story';
type StoryFlagsRecord = SaveGame['story_flags'];

/** Flags as `{flag: true}` (readable by anything that only wants flags) plus one JSON entry for the rest. */
export function encodeStory(save: StorySave, ledger: StoryLedger): StoryFlagsRecord {
  const record: StoryFlagsRecord = {};
  for (const flag of save.flags) record[flag] = true;
  const { flags: _flags, ...rest } = save;
  record[STORY_META_KEY] = JSON.stringify({ ...rest, ledger });
  return record;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
const numbers = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {})
  .filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));

/** Read a `story_flags` record back; anything malformed falls back to an empty part, never an error. */
export function decodeStory(record: StoryFlagsRecord | undefined | null): { save: StorySave; ledger: StoryLedger } {
  const entries = Object.entries(record ?? {});
  const flags = entries.filter(([k, v]) => v === true && !k.startsWith('$')).map(([k]) => k).sort();
  let meta: Record<string, unknown> = {};
  const raw = record?.[STORY_META_KEY];
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw) as unknown; if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>; } catch { /* keep the flags */ }
  }
  const queue = (Array.isArray(meta.queue) ? meta.queue : []).flatMap(q => {
    const e = q as Record<string, unknown>;
    if (!e || typeof e.id !== 'string') return [];
    return [{ id: e.id, ...(typeof e.from === 'string' ? { from: e.from } : {}), ...(e.restart === true ? { restart: true } : {}) }];
  });
  const a = meta.active as Record<string, unknown> | undefined;
  const active = a && typeof a.id === 'string' ? { id: a.id, initialFlags: strings(a.initialFlags) } : undefined;
  const l = (meta.ledger ?? {}) as Record<string, unknown>;
  const base = emptyLedger();
  const ledger: StoryLedger = {
    regard: { ...base.regard, ...numbers(l.regard) },
    coins: typeof l.coins === 'number' && Number.isFinite(l.coins) ? l.coins : base.coins,
    items: numbers(l.items), projects: strings(l.projects), riddles: strings(l.riddles), applied: strings(l.applied)
  };
  return { save: { version: 1, flags, completed: strings(meta.completed), queue, ...(active ? { active } : {}) }, ledger };
}
