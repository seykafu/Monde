import { findMark, marks } from '../riddles';
// The story in the world (MVP G-10): ZoneScene calls attachStory() in create() and update(position) every frame.
//
// - One StorySession per game, kept in the registry beside the clock (a new clock means a new or loaded game).
//   It is restored from `monde.story.flags`, the registry entry the save system writes as SaveGame.story_flags,
//   and written back after every story step (story/host.ts encodeStory).
// - Triggers: zone entry, place entry (story/host.ts placeAt) and every in-game minute run the director's
//   refresh; when a scene is ready and nothing else holds the world (dialogue, ledger, menu, an edge fade),
//   StoryScene opens over the zone. Summoned scenes (S10a/b, S11) ask first and then move the player.
// - A New Game opens 09:50 on the ferry slip (§13.2, Day 1: "New game opens 09:50 aboard the Gannet"), so S01a
//   plays at once, with the Fellowship form at its {charcreate} cue (§11.1); `?skiptitle=1`, `?day=`, `?time=` and
//   `?scene=` keep their old starting point.
// - Cues that change the world beyond the client go to the event log (scenes/events.ts, M-06): memories, Regard and
//   Scuffles as ClientEvents. The story reads Regard from the friendship mirror (scenes/friendship.ts regardFor).
// - The Next hint (story/hint.ts): the scene the player can still catch today, for the HUD and the Ledger.
// - Dev: `?scene=<id>` plays a scene immediately; `window.__story` lists, plays and inspects (dev builds or ?dev).
import type Phaser from 'phaser';
import { DAY_START, type Clock } from '../../sim/clock';
import type { WeatherNow } from '../../sim/weather';
import { getMind, uuid } from '../../mind/api';
import { talkContext } from '../../mind/context';
import { requestCheckpoint } from '../../save/runtime';
import { decodeStory, metInScenes, placeAt, syncTownFlags, type FellowProfile, type StoryWorld } from '../../story/host';
import { HINT_KEY, storyHint, zoneRoute, type StoryHint } from '../../story/hint';
import { liveLine } from '../../story/live';
import { ALL_SCENES, SPRING_SCENES, StorySession } from '../../story/session';
import { eligibleScenes, minutes } from '../../story/triggers';
import { placeName, type Position } from '../../world/player';
import { personaCards } from '../../world/residents';
import { findCard, resolveAlias } from '../../world/roster';
import { firstArrival } from '@monde/shared';
import { districtOf, type Point, type ZoneDef } from '../../world/zoneFormat';
import { doorLinks, interiors, zones } from '../../world/zones';
import { placeArrival } from '../../world/interiors';
import { doorLocked } from '../zone/indoors';
import { DIALOGUE_SCENE } from '../DialogueScene';
import { STORY_SCENE, FELLOWSHIP_SCENE, type StoryOpen } from '../StoryScene';
import { TOWN_KEY, TOWN_LEDGER_SCENE, getTown } from '../TownLedgerScene';
import { appendEvent, getEventLog } from '../events';
import { getFriendship, meetResident, regardFor } from '../friendship';
import { projectCue } from '../../projects/runtime';
import { COINS_KEY, coinsOf } from '../../economy/runtime';
import type { ResidentLayer } from '../zone/residents';

const SESSION_KEY = 'monde.story.session';
const CARD_IDS = new Set(personaCards.map(c => c.id));
/** save/runtime.ts saves this as SaveGame.story_flags and restores it on load. */
const FLAGS_KEY = 'monde.story.flags';
/** fellow/state.ts FELLOW_KEY (W-07): the signed Fellowship application for this game. */
const FELLOW_KEY = 'monde.fellow';
/** Scenes that hold the world while open: a story scene waits for them. */
const HOLDING_SCENES = [STORY_SCENE, DIALOGUE_SCENE, TOWN_LEDGER_SCENE, 'SaveMenu', FELLOWSHIP_SCENE];

const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const DEV = import.meta.env.DEV || query.has('dev');
/** `?scene=` plays once per page load, not again on every zone change. */
let devScenePending = query.get('scene');

interface Held { clock: Clock; session: StorySession; opened: boolean }

export interface StoryAttachOptions {
  zone: ZoneDef;
  clock: Clock;
  residents: ResidentLayer;
  position(): Position;
  weather(): WeatherNow;
  /** ZoneScene's create data: a New Game arrives with none of these. */
  entry: { zone?: string; arrive?: Point; savedPlayer?: unknown };
  /** True while the zone can't take a scene (an edge fade under way). */
  busy(): boolean;
}

export interface StoryAttachment {
  /** Every frame, with the player's position: place entry triggers. */
  update(position: Position): void;
  /** The Next hint now (recomputed when the minute, the place, the flags or the scene change; null: nothing today). */
  hint(): StoryHint | null;
  /** The `zone.place` the player is at now ('' between places). */
  place(): string;
}

const HINT_PLACES = {
  placeName,
  zoneName: (id: string) => zones[id]?.name ?? id,
  route: (from: string, to: string) => zoneRoute(zones, from, to)
};

/** The game's session: kept while the clock is the same clock, rebuilt from the save's story record otherwise. */
function heldFor(scene: Phaser.Scene, clock: Clock): Held {
  const held = scene.registry.get(SESSION_KEY) as Held | undefined;
  if (held?.clock === clock) return held;
  const saved = scene.registry.get(FLAGS_KEY) as Parameters<typeof decodeStory>[0] | undefined;
  const session = new StorySession({ world: null, saved, scenes: query.get('story') === 'all' ? ALL_SCENES : SPRING_SCENES });
  const next: Held = { clock, session, opened: !!saved && Object.keys(saved).length > 0 };
  scene.registry.set(SESSION_KEY, next);
  return next;
}

const fellowProfile = (registry: Phaser.Data.DataManager): FellowProfile | null =>
  (registry.get(FELLOW_KEY) as { profile?: FellowProfile | null } | undefined)?.profile ?? null;

export function attachStory(scene: Phaser.Scene, opts: StoryAttachOptions): StoryAttachment {
  const { zone, clock, residents } = opts;
  const registry = scene.registry;
  // A room's places, triggers and hints are its district's (W-03): inside the bakery is market_row. A building with a
  // room is entered for its scenes: its doorstep outside is the street.
  const district = districtOf(zone);
  // A locked door (the cottage before S01c's keys) is still a doorstep: its scene plays there.
  const links = doorLinks.filter(l => l.district === zone.id);
  const placeHere = (p: Position) => placeAt(zone, p, new Set(links.filter(l => !doorLocked(registry, l)).map(l => l.building)));
  const held = heldFor(scene, clock);
  const session = held.session;

  // A New Game: straight to the ferry slip at S01a's hour.
  const opening = session.header('s01a_ferry');
  const freshGame = !held.opened && !opts.entry.zone && !opts.entry.arrive && !opts.entry.savedPlayer
    && clock.day === 1 && clock.minute === DAY_START && session.flags.serialize().length === 0;
  held.opened = true;
  if (freshGame && opening && !['skiptitle', 'day', 'time', 'scene', 'puzzle'].some(k => query.has(k))) {
    const [zoneId = ''] = opening.place.split('.');
    const target = zones[zoneId];
    if (target) {
      clock.setTime(1, minutes(opening.time.start));
      scene.scene.restart({ zone: zoneId, arrive: target.spawn });
      return { update: () => undefined, hint: () => null, place: () => '' };
    }
  }

  const world: StoryWorld = {
    readRiddle: id => { findMark(registry, clock, id); return marks(registry).entries[id]?.status === 'solved'; },
    now: () => ({
      day: clock.day, minute: clock.minute, zone: district, place: placeHere(opts.position()), town: getTown(registry), profile: fellowProfile(registry),
      regard: Object.fromEntries(personaCards.map(c => [c.id, regardFor(registry, c.id)])),
      ...storyArrival(registry, clock.day)
    }),
    setTown: state => registry.set(TOWN_KEY, state),
    events: () => getEventLog(registry).outbox,
    appendEvent: event => { appendEvent(registry, event); },
    newId: uuid,
    persist: () => {
      registry.set(FLAGS_KEY, session.snapshot());
      // A resident met in a scene has a page in the Journal's People (the dialogue panel's meetResident).
      const known = getFriendship(registry).residents;
      for (const id of metInScenes(session.flags.snapshot(), id => CARD_IDS.has(id))) if (!known[id]) meetResident(registry, id, clock.day);
      const town = getTown(registry);
      if (!town) return;
      const synced = syncTownFlags(town, session.flags.snapshot());
      if (synced !== town) registry.set(TOWN_KEY, synced);
    },
    checkpoint: key => requestCheckpoint(key),
    travel: place => {
      // Into the place's room when it has one (W-03), else to its door.
      const to = placeArrival(zones, interiors, place);
      if (!to) { console.warn(`[story] can't travel to ${place}`); return; }
      scene.scene.restart({ zone: to.zone, arrive: to.arrive });
    },
    zoneName: id => zones[id]?.name ?? id,
    projectCue: (id, sceneId) => projectCue(registry, { day: clock.day, minute: clock.minute }, id, sceneId),
    // {coins}: the purse the HUD, the shop and the Projects use (economy/runtime.ts), never below empty.
    coins: delta => { registry.set(COINS_KEY, { balance: Math.max(0, coinsOf(registry) + delta) }); },
    // S05's `arrival` speaks as the first real arrival (G-02, world/roster.ts).
    aiLine: (speaker, brief) => liveLine(getMind(), {
      residentId: resolveAlias(speaker), brief,
      context: talkContext({ day: clock.day, minute: clock.minute, state: residents.stateOf(resolveAlias(speaker)), zone, weather: opts.weather() })
    }, { conversationId: uuid() })
  };
  session.world = world;

  const dialogueFor: StoryOpen['dialogueFor'] = residentId => ({ clock, zone, state: residents.stateOf(resolveAlias(residentId)), weather: opts.weather() });
  const tryStart = (): void => {
    const manager = scene.scene;
    if (!scene.sys.isActive() || opts.busy() || clock.paused || HOLDING_SCENES.some(key => manager.isActive(key))) return;
    if (!session.ready()) return;
    manager.launch(STORY_SCENE, { host: scene.scene.key, clock, session, dialogueFor } satisfies StoryOpen);
  };
  // Debounced to the next frame: a dev jump of an hour fires sixty minute events at once.
  let pending = false;
  const check = (): void => {
    if (pending) return;
    pending = true;
    scene.time.delayedCall(0, () => { pending = false; tryStart(); });
  };

  const offMinute = clock.onMinute(() => check());
  scene.events.once('shutdown', offMinute);

  // A summoned scene moved the player here mid-scene: keep this zone still under it.
  if (scene.scene.isActive(STORY_SCENE)) {
    scene.input.enabled = false;
    if (scene.input.keyboard) scene.input.keyboard.enabled = false;
  }

  if (devScenePending) {
    const id = devScenePending;
    devScenePending = null;
    if (!session.play(id)) console.warn(`[story] ?scene=${id}: no such scene. Try one of: ${session.scenes.filter(s => s.header).map(s => s.id).join(', ')}`);
  }
  if (DEV) installDevTools(session, check);
  check(); // zone entry

  let lastPlace = placeHere(opts.position());
  let hintKey = '';
  let hint: StoryHint | null = null;
  return {
    update(position) {
      const place = placeHere(position);
      if (place === lastPlace) return;
      lastPlace = place;
      check(); // place entry
    },
    hint() {
      const done = session.director.serialize().completed;
      const key = `${clock.day}:${clock.minute}:${district}:${session.active ?? ''}:${session.flags.serialize().join(',')}:${done.length}`;
      if (key === hintKey) return hint;
      hintKey = key;
      const context = { ...session.context(), zone: district, place: lastPlace };
      hint = storyHint(session.scenes, context, session.flags, HINT_PLACES, new Set(done), session.active);
      registry.set(HINT_KEY, hint);
      return hint;
    },
    place: () => lastPlace
  };
}

/** S05's `{arrival.name}`, `{arrival.trade}`, `{arrival.reason}` from the first real arrival (G-02); none before. */
function storyArrival(registry: Phaser.Data.DataManager, day: number): { arrival?: NonNullable<ReturnType<StoryWorld['now']>['arrival']> } {
  const town = getTown(registry);
  const first = firstArrival(town?.people, day);
  const card = first ? findCard(first.card.id) ?? first.card : null;
  if (!first || !card) return {};
  const household = [...(town?.people?.households ?? []), ...(town?.people?.pending ?? [])].find(h => h.id === first.household);
  const trade = card.occupation.split(/[;,]/)[0]!.trim();
  return { arrival: { id: card.id, name: card.name, trade: trade.charAt(0).toUpperCase() + trade.slice(1), reason: household?.summary ?? 'Wanted a fresh start.' } };
}

/** `window.__story`: list, play and inspect scenes from the console (dev builds or ?dev). */
function installDevTools(session: StorySession, check: () => void): void {
  const tools = {
    session,
    /** Every scene with its window and where it stands now. */
    list() {
      const context = session.context();
      const eligible = new Set(eligibleScenes(session.scenes, context, session.flags).map(s => s.id));
      const done = new Set(session.director.serialize().completed);
      const rows = session.scenes.filter(s => s.header).map(s => ({
        id: s.id, title: s.title, day: s.header!.day, time: `${s.header!.time.start}-${s.header!.time.end}`, place: s.header!.place,
        status: session.active === s.id ? 'playing' : done.has(s.id) ? 'done' : eligible.has(s.id) ? 'eligible now' : 'waiting'
      }));
      console.table(rows);
      return rows;
    },
    /** Play a scene now, whatever its window, place or trigger. */
    play(id: string) { const ok = session.play(id); if (ok) check(); else console.warn(`[story] can't play ${id} (unknown, or a scene is playing)`); return ok; },
    flags() { const flags = session.flags.serialize(); console.info(`[story] ${flags.length} flags:`, flags.join(' ')); return flags; },
    set(flag: string) { session.flags.set(flag); session.world?.persist(); check(); },
    unset(flag: string) { session.flags.unset(flag); session.world?.persist(); check(); },
    context: () => session.context(),
    ledger: () => session.ledger,
    save: () => session.director.serialize(),
    /** Run the triggers now. */
    check
  };
  Object.assign(window as unknown as Record<string, unknown>, { __story: tools });
}
