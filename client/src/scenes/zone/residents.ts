import { PROJECT_BEAT } from '../../projects/BeatScene';
import { Chatter, type ChatterActor } from './chatter';
import { Greetings } from './greetings';
import { spotAt } from './chatterRules';
import { installChatterDev, type ChatterDevHost } from './chatterDev';
import { callName } from '@monde/shared';
import { cameraView } from '../../render/town/TownBoard';
// On-screen residents for ZoneScene (MVP W-05; GDD §16.5, §19.2).
//
// The town's residents live in one ResidentSim (sim/residentSim.ts), shared through the registry like the
// clock, so it survives zone changes. Every second the layer ticks it for everyone (the 1 Hz off-screen
// abstraction) and learns who is on this board or about to step onto it. Those residents are sampled
// from the executor every frame at the clock's fractional minute, so they walk their paths smoothly at
// 60 fps; nothing else is simulated for them.
//
// On top of the executor's answer, each actor keeps a little presentation state of its own:
//   • a delay (game minutes behind the executor): while the player blocks a narrow way, or while it's
//     been asked to talk, the actor holds that executor moment; afterwards it hurries to catch up;
//   • a lateral offset: walkers keep slightly to the right, step around the player where there's room,
//     and anyone standing too close to another resident eases apart, so two never overlap exactly.
// Each is drawn as a walking character sprite (four facings, idle and walk cycle; see "Figures" below),
// with a name tag near the player or under the pointer and a small emote bubble for what they're doing.
// Residents with a tie who meet in view float its emote now and then (§9.11.3), and the player learns the tie.

import Phaser from 'phaser';
import type { ObliqueProjection } from '../../render/ObliqueProjection';
import { DEPTH, actorDepth } from '../../render/depth';
import { DIORAMA_ELEV_STEP, DIORAMA_FOOT_DY, DIORAMA_PERSPECTIVE_K, DIORAMA_TILE_H, DIORAMA_TILE_W } from '../../render/dioramaConfig';
import { screenToSource } from '../../render/keystone';
import { FAMILY_BODY, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../../util/constants';
import type { Clock } from '../../sim/clock';
import { ResidentSim, type ResidentProfile } from '../../sim/residentSim';
import { hashString } from '../../sim/plans';
import type { ResidentState } from '../../sim/routineExecutor';
import { fits, ZoneGraph, type Vec } from '../../world/nav';
import { IndoorView } from '../../world/indoorResidents';
import type { Position } from '../../world/player';
import type { ZoneDef } from '../../world/zoneFormat';
import { zones } from '../../world/zones';
import { placeRegistry } from '../../world/places';
import { personaCards } from '../../world/residents';
import { findCard } from '../../world/roster';
import { PREWARM_RANGE } from '../../mind/prewarm';
import { CharacterSprite } from '../../render/characterSprite';
import { BASTIEN_LOOK, lookFromCard, residentLook, type Look } from '../../render/character/look';
import { PAIR_EMOTE_RULES, PairEmoteThrottle, inSight, nearPairs, type Spot } from '../../friendship/emotes';
import { pairEmote } from '../../friendship/knownTies';
import type { EmoteIcon } from '../../friendship/icons';
import { emoteTexture } from '../../ui/hearts';
import { learnSeen, livePlansFor, tieMap } from '../friendship';

const SIM_KEY = 'monde.residents';
/** Off-screen tick: one executor sample per resident per real second (§19.2). */
const TICK_MS = 1000;
/** Residents due on this board within this many game minutes join the per-frame roster early. */
const LOOKAHEAD_MIN = 2;
// Interaction (task W-05).
/** "E: Talk to …" within this many tiles of a visible resident. */
const TALK_RANGE = 1.5;
/** A resident asked to talk waits, facing the player, until the player is this far away. */
const TALK_RELEASE = 2.5;
/** Name tags show within this many tiles of the player. */
const NAME_RANGE = 3;
// Movement feel (art tuning, not game rules).
/** Closer than this to the player (centre to centre, tiles), a walker stops rather than walk through. */
const BLOCK_RADIUS = 0.5;
/** How long a walker waits on the player before squeezing past. */
const MAX_WAIT_MS = 2500;
/** Walkers keep this far right of their path, so two passing don't meet head-on. */
const KEEP_RIGHT = 0.16;
/** Within this distance of the player, a walker sidesteps (if there's room). */
const AVOID_RADIUS = 1;
/** Standing residents closer than this ease apart. */
const PERSONAL_SPACE = 0.42;
/** Bodies kept this clear of walls when offset from the path. */
const BODY_CLEARANCE = 0.12;

const query = new URLSearchParams(window.location.search);

/** The registry-shared simulation (built once per game). `?npcs=30` adds jittered copies for crowd tests. */
export function sharedResidentSim(scene: Phaser.Scene): ResidentSim {
  let sim = scene.registry.get(SIM_KEY) as ResidentSim | undefined;
  if (!sim) {
    const wanted = Number(query.get('npcs')) || 0;
    // The dawn package's model plans replace templates for their day (G-13 client, scenes/friendship.ts).
    const registry = scene.registry;
    sim = new ResidentSim(personaCards, { zones, graph: new ZoneGraph(zones), registry: placeRegistry }, Math.max(0, wanted - personaCards.length),
      day => livePlansFor(registry, day));
    scene.registry.set(SIM_KEY, sim);
  }
  return sim;
}

interface Actor {
  profile: ResidentProfile;
  animal: boolean;
  colour: number;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Image;
  /** Sheet and walk/idle animation (facing, frames by distance walked). */
  avatar: CharacterSprite;
  /** Game minutes behind the executor. */
  delay: number;
  blockedMs: number;
  passing: boolean;
  talking: boolean;
  /** Smoothed lateral/separation offset, tiles. */
  offset: Vec;
  /** The executor's position this frame (before offsets), and where the actor is drawn. */
  base: Vec | null;
  pos: Vec | null;
  state: ResidentState | null;
  alpha: number;
  /** Texture currently on the bubble (set only when it changes). */
  emoteKey: string;
}

// ── Figures ─────────────────────────────────────────────────────────────────
// Each resident is a CharacterSprite (render/characterSprite): their drawn sheet once one is listed in
// assets/sprites/manifest.json (by resident id, which is also the card's `sprite`), else the procedural
// rig wearing their card's `look` (the same look the dialogue bust draws; Bastien's cat collar, unless the
// card names one, in his roster colour). A card without a look (and the dev `?npcs=` copies) wears the hash
// look with the roster colour on top.

/** A distinct hue per roster index (golden-angle spacing), muted to sit in the cozy palette. */
const residentColour = (index: number): number =>
  Phaser.Display.Color.HSLToColor(((index * 137.508) % 360) / 360, 0.52, 0.56).color;

const cardLooks = new Map(personaCards.flatMap(c => (c.look ? [[c.id, c.look] as const] : [])));
const cardNames = new Map(personaCards.map(c => [c.id, c.name]));
/** Residents who speak in narrated actions (Bastien): their bubbles say what they do. */
const NARRATED: ReadonlySet<string> = new Set(personaCards.filter(c => c.voice.mode === 'narrated_action').map(c => c.id));
/** What a bubble and `{name}` call them, as the dialogue does ("Old Moss", "June", "Captain Reyes"). */
const firstNameOf = (p: ResidentProfile): string => callName(cardNames.get(p.id) ?? p.name);

const lookFor = (profile: ResidentProfile, colour: number): Look => {
  // G-02: a generated resident wears their card's look (their library portrait's, shared/src/arrivals/library.ts).
  const look = cardLooks.get(profile.id) ?? findCard(profile.id)?.look;
  if (look) return lookFromCard(look, colour);
  return profile.kind === 'animal' ? { ...BASTIEN_LOOK, collar: colour } : residentLook(profile.id, colour);
};

/** The emote bubble for a verb (GDD §16.5 emotes); null for verbs that show nothing. */
function ensureEmote(scene: Phaser.Scene, verb: string): string | null {
  const draw = EMOTES[verb];
  if (!draw) return null;
  const key = `emote-${verb}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xfff8e6).fillRoundedRect(0, 0, 20, 15, 5).fillTriangle(5, 14, 10, 14, 4, 19);
  g.lineStyle(1, 0x6b5a45, 0.7).strokeRoundedRect(0.5, 0.5, 19, 14, 5);
  g.translateCanvas(1, 1);
  draw(g);
  g.generateTexture(key, 20, 20);
  g.destroy();
  return key;
}

type Draw = (g: Phaser.GameObjects.Graphics) => void;
const INK = 0x4a3b2c;
const zzz: Draw = g => { g.lineStyle(1.6, 0x5a6aa8).beginPath().moveTo(4, 4).lineTo(9, 4).lineTo(4, 10).lineTo(9, 10).strokePath().beginPath().moveTo(11, 2).lineTo(15, 2).lineTo(11, 6).lineTo(15, 6).strokePath(); };
const EMOTES: Readonly<Record<string, Draw>> = {
  work: g => { g.fillStyle(INK).fillRect(8, 2, 8, 4); g.lineStyle(2, 0x8a6a45).lineBetween(11, 5, 5, 11); },
  eat: g => { g.fillStyle(0x8a6a45).fillCircle(9, 6, 5); g.fillStyle(0xfff8e6).fillRect(3, 1, 13, 5); g.lineStyle(1.2, 0x9aa3ad).lineBetween(7, 4, 8, 1).lineBetween(11, 4, 12, 1); },
  cook: g => { g.fillStyle(INK).fillRect(4, 5, 11, 6); g.lineStyle(1.5, INK).lineBetween(2, 5, 17, 5); g.lineStyle(1.2, 0x9aa3ad).lineBetween(8, 3, 9, 0).lineBetween(12, 3, 13, 0); },
  read: g => { g.fillStyle(0x7b4b2a).fillRect(3, 3, 6, 8).fillRect(10, 3, 6, 8); g.fillStyle(0xfff8e6).fillRect(4, 4, 4, 6).fillRect(11, 4, 4, 6); },
  write: g => { g.lineStyle(2.5, 0xd9a93a).lineBetween(4, 10, 13, 2); g.fillStyle(INK).fillTriangle(3, 12, 4, 9, 6, 11); },
  sit: g => { g.fillStyle(0x8a6a45).fillRect(5, 1, 2, 9).fillRect(5, 7, 9, 2).fillRect(12, 7, 2, 5).fillRect(5, 9, 2, 3); },
  socialize: g => { g.fillStyle(INK).fillCircle(5, 6, 1.6).fillCircle(9, 6, 1.6).fillCircle(13, 6, 1.6); },
  shop: g => { g.fillStyle(0xb5563c).fillRect(4, 5, 10, 7); g.lineStyle(1.4, INK).strokeCircle(9, 5, 2.6); },
  garden: g => { g.lineStyle(1.6, 0x4f8a3a).lineBetween(9, 12, 9, 5); g.fillStyle(0x5fa344).fillEllipse(6, 5, 6, 3).fillEllipse(12, 4, 6, 3); },
  fish: g => { g.fillStyle(0x4f7fb0).fillEllipse(8, 6, 10, 5).fillTriangle(12, 6, 17, 2, 17, 10); },
  play_music: g => { g.fillStyle(INK).fillCircle(7, 9, 2.4); g.lineStyle(1.5, INK).lineBetween(9, 9, 9, 2).lineBetween(9, 2, 14, 4); },
  clean: g => { g.lineStyle(1.6, 0x8a6a45).lineBetween(5, 1, 11, 8); g.fillStyle(0xd9b45a).fillTriangle(9, 7, 15, 9, 11, 12); },
  tinker: g => { g.fillStyle(INK).fillCircle(9, 6, 4.5).fillRect(8, 0, 2, 12).fillRect(3, 5, 12, 2); g.fillStyle(0xfff8e6).fillCircle(9, 6, 1.8); },
  pray: g => { g.lineStyle(1.6, 0xc9a24a).lineBetween(9, 1, 9, 11).lineBetween(5, 4, 13, 4); },
  attend: g => { g.lineStyle(1.6, 0xc9a24a).lineBetween(9, 1, 9, 11).lineBetween(5, 4, 13, 4); },
  volunteer: g => { g.fillStyle(0xc0504d).fillCircle(7, 5, 2.6).fillCircle(11, 5, 2.6).fillTriangle(4.6, 6, 13.4, 6, 9, 11); },
  beg: g => { g.fillStyle(0xc0504d).fillCircle(7, 5, 2.6).fillCircle(11, 5, 2.6).fillTriangle(4.6, 6, 13.4, 6, 9, 11); },
  sleep: zzz,
  nap: zzz,
  talk: g => { g.fillStyle(INK).fillCircle(5, 6, 1.6).fillCircle(9, 6, 1.6).fillCircle(13, 6, 1.6); }
};

// ── The layer ───────────────────────────────────────────────────────────────

export class ResidentLayer {
  readonly sim: ResidentSim;
  readonly chatter: Chatter;
  /** Passing greetings (greetings.ts). */
  readonly greetings: Greetings;
  /** Dev: residents stood where the dev hook put them (chatterDev.ts), routines held, until their exchange ends. */
  private readonly staged = new Map<string, Vec>();
  private stagedMs = 0;
  private lastPlayer: Position | null = null;
  /** This frame: the social spot each standing on-board resident is at (zone `social:`), or null. */
  private readonly spots = new Map<Actor, string | null>();
  private readonly actors: Actor[];
  private readonly byId: Map<string, Actor>;
  /** Objects made after the zone was built (G-02 newcomers): the UI camera must not draw them. */
  private readonly camerasToSkip: () => Phaser.Cameras.Scene2D.Camera[];
  private roster = new Set<string>();
  private tickMs = Infinity;
  private lastMinute = NaN;
  private lastDay = NaN;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private overlayOn = false;
  private readout?: Phaser.GameObjects.Text;
  private warned = 0;
  /** Called when a visible resident comes within PREWARM_RANGE (6 tiles, §9.10 step 1) of the player (M-05). */
  onApproach?: (residentId: string) => void;
  private near = new Set<string>();
  /** Tie emotes over residents who meet (§9.11.3): a pool made up front (so it belongs to the world camera). */
  private readonly emotePool: Phaser.GameObjects.Image[];
  private floating: { img: Phaser.GameObjects.Image; pair: Actor[]; ms: number }[] = [];
  private readonly emoteThrottle = new PairEmoteThrottle();
  private emoteClock = 0;
  private emoteCheck = 0;
  /** In a room (W-03): who the routines have inside its building, at their spots (world/indoorResidents.ts). */
  private readonly indoor: IndoorView | null;

  /** Create every actor up front (hidden), so they all belong to the world camera. */
  constructor(private readonly scene: Phaser.Scene, private readonly zone: ZoneDef, private readonly projection: ObliqueProjection,
    private readonly clock: Clock, private readonly dev: boolean) {
    this.sim = sharedResidentSim(scene);
    this.indoor = zone.interior ? new IndoorView(zone, this.sim.executor, (id, day, minute) => this.sim.sample(id, day, minute)) : null;
    this.chatter = new Chatter(scene, clock);
    this.greetings = new Greetings(scene, clock);
    this.greetings.weather = () => this.chatter.weather();
    this.chatter.onStart = (a, b) => this.greetings.note(a, b);
    this.actors = this.sim.profiles.map(profile => this.makeActor(profile));
    this.byId = new Map(this.actors.map(a => [a.profile.id, a]));
    this.camerasToSkip = () => scene.cameras.cameras.filter(c => c !== scene.cameras.main);
    this.overlay = scene.add.graphics().setDepth(DEPTH.DARKNESS + 0.5).setVisible(false);
    this.emotePool = Array.from({ length: 8 }, () => scene.add.image(0, 0, emoteTexture(scene, 'heart')).setOrigin(0.5, 1).setDepth(DEPTH.OVER_DARK + 0.01).setVisible(false));
    const off = this.sim.events.on('talk-requested', e =>
      console.info(`[residents] talk-requested: ${e.residentId} (${this.sim.profile(e.residentId)?.name}) on Day ${e.day} at ${Math.floor(e.minute / 60)}:${String(Math.floor(e.minute % 60)).padStart(2, '0')}`));
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    if (import.meta.env.DEV) scene.events.once(Phaser.Scenes.Events.SHUTDOWN, installChatterDev(this.devHost(), query));
  }

  private makeActor(profile: ResidentProfile): Actor {
    const scene = this.scene;
    const animal = profile.kind === 'animal', colour = residentColour(profile.index);
    const actor = { profile, animal, colour } as Actor;
    const avatar = new CharacterSprite(scene, profile.id, lookFor(profile, colour));
    const sprite = scene.add.image(0, 0, avatar.sheet.key).setVisible(false);
    avatar.apply(sprite);
    return Object.assign(actor, {
      avatar, sprite,
      shadow: scene.add.ellipse(0, 0, animal ? 18 : 22, 7, 0x000000, 0.22).setDepth(DEPTH.SHADOW).setVisible(false),
      label: scene.add.text(0, 0, profile.name, { fontFamily: FAMILY_BODY, fontSize: '11px', color: '#fff0ce', backgroundColor: '#28372dcc', padding: { x: 3, y: 1 }, resolution: RENDER_SCALE })
        .setOrigin(0.5, 1).setDepth(DEPTH.OVER_DARK).setVisible(false),
      bubble: scene.add.image(0, 0, '__DEFAULT').setOrigin(0.2, 1).setDepth(DEPTH.OVER_DARK - 0.01).setVisible(false),
      delay: 0, blockedMs: 0, passing: false, talking: false,
      offset: { x: 0, y: 0 }, base: null, pos: null, state: null, alpha: 0, emoteKey: ''
    });
  }

  /**
   * G-02: residents who joined the sim after this board was built (a household off this morning's ferry) get their
   * actors now; the UI camera is told to skip them, as it skips the world built in create().
   */
  syncActors(): void {
    for (const profile of this.sim.profiles) {
      if (this.byId.has(profile.id)) continue;
      const actor = this.makeActor(profile);
      this.actors.push(actor);
      this.byId.set(profile.id, actor);
      for (const cam of this.camerasToSkip()) cam.ignore([actor.sprite, actor.shadow, actor.label, actor.bubble]);
    }
  }

  /** Screen-space dev readout (for the UI camera); empty outside dev builds. */
  buildUi(): Phaser.GameObjects.GameObject[] {
    if (!this.dev) return [];
    this.readout = this.scene.add.text(24, 108, '', { fontFamily: FAMILY_BODY, fontSize: '14px', color: '#d9cfb4', backgroundColor: '#28372d', resolution: RENDER_SCALE });
    return [this.readout];
  }

  toggleOverlay(): void {
    this.overlayOn = !this.overlayOn;
    this.overlay.setVisible(this.overlayOn);
    if (!this.overlayOn) this.overlay.clear();
  }

  /** The nearest visible resident within talking range of the player. */
  talkTarget(player: Position): { id: string; name: string } | null {
    let best: Actor | null = null, bestD = TALK_RANGE;
    for (const a of this.actors) {
      if (!a.pos || a.alpha < 0.5 || !a.state?.visible || a.state.zone !== this.zone.id) continue;
      const d = Math.hypot(a.pos.x - player.x, a.pos.y - player.y);
      if (d <= bestD) { best = a; bestD = d; }
    }
    const other = best ? this.byId.get(this.chatter.partner(best.profile.id) ?? '') : null;
    return best ? { id: best.profile.id, name: other ? `${best.profile.name} & ${other.profile.name} (join)` : best.profile.name } : null;
  }

  /** E pressed beside a resident: emit `talk-requested` and hold them, facing the player, till the player leaves. */
  requestTalk(id: string): void {
    const actor = this.byId.get(id);
    if (!actor) return;
    actor.talking = !this.chatter.partner(id);
    this.sim.events.emit('talk-requested', { residentId: id, zone: this.zone.id, day: this.clock.day, minute: this.clock.exactMinute });
  }

  /** A resident's routine state as drawn this frame (held while they're talking), or null off this board. */
  stateOf(id: string): ResidentState | null {
    return this.byId.get(id)?.state ?? null;
  }

  update(dtMs: number, player: Position): void {
    const day = this.clock.day, minute = this.clock.exactMinute;
    const dMin = day === this.lastDay && Number.isFinite(this.lastMinute) ? minute - this.lastMinute : 0;
    // A dev jump of the clock (or a new day) snaps everybody to where the executor has them.
    const jump = day !== this.lastDay || dMin < 0 || dMin > 5;
    this.lastMinute = minute; this.lastDay = day;
    this.tickMs += dtMs;
    if (this.tickMs >= TICK_MS || jump) this.tick(day);

    // Pass 1: where the executor has each on-board actor this frame (with waiting and catching up).
    const live: Actor[] = [];
    for (const a of this.actors) {
      if (jump) { a.delay = 0; a.talking = false; a.passing = false; a.blockedMs = 0; }
      if (!this.roster.has(a.profile.id) && a.delay === 0 && !a.talking && !this.staged.has(a.profile.id)) { this.hide(a); continue; }
      this.advance(a, day, minute, dMin, dtMs, player);
      if (a.base) live.push(a);
      else this.hide(a);
    }
    // Pass 2: offsets (keep right, sidestep the player, personal space), then draw.
    const sec = dtMs / 1000;
    this.spots.clear();
    if (this.zone.social.length) for (const a of live) if (a.base && !a.state?.moving) this.spots.set(a, spotAt(this.zone.social, a.base));
    for (const a of live) this.place(a, live, player, sec, dtMs);
    const pointer = this.pointerWorld();
    for (const a of live) this.draw(a, player, pointer, dtMs);
    if (this.overlayOn) this.drawOverlay(live);
    if (this.onApproach) this.approach(live, player);
    this.pairEmotes(live, player, dtMs);
    // Residents talking to each other (chatter.ts) and nodding as they pass (greetings.ts).
    const view = this.viewRect();
    const talkers = this.talkers(live, view);
    this.chatter.update(dtMs, talkers, player, view);
    this.greetings.update(dtMs, talkers, player, view, id => this.chatter.partner(id) !== null || this.chatter.speaking(id));
    this.lastPlayer = player;
    if (this.staged.size) this.unstageWhenDone(dtMs);
  }

  /**
   * The world rectangle on screen. Not `camera.worldView`, which assumes Phaser's centre zoom pivot: this camera zooms
   * about its top-left (util/renderScale), so worldView sits half a screen down and right of the real view (that hid
   * everyone up or left of the player from the old chatter, and stopped any exchange there at once).
   */
  private viewRect(): Phaser.Geom.Rectangle {
    const v = cameraView(this.scene.cameras.main);
    return new Phaser.Geom.Rectangle(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  }

  /** Whether a speech bubble is up over a resident (their name tag and activity emote step aside for it). */
  private speaking(id: string): boolean { return this.chatter.speaking(id) || this.greetings.speaking(id); }

  /** The on-board residents as the chatter sees them: where, at which social spot, whether on screen, head and feet. */
  private talkers(live: readonly Actor[], view: Phaser.Geom.Rectangle): ChatterActor[] {
    // A running exchange carries on while its pair is within a quarter-screen margin of the view.
    const mx = view.width / 4, my = view.height / 4;
    const out: ChatterActor[] = [];
    for (const a of live) {
      if (!a.pos || !a.state) continue;
      const shown = a.alpha > 0.5 && a.state.visible, sx = a.sprite.x, sy = a.sprite.y;
      out.push({
        id: a.profile.id, x: a.pos.x, y: a.pos.y, place: a.state.place, spot: spotAt(this.zone.social, a.pos),
        idle: !a.state.moving, moving: a.state.moving, talking: a.talking,
        visible: shown && view.contains(sx, sy),
        near: shown && sx > view.x - mx && sx < view.right + mx && sy > view.y - my && sy < view.bottom + my,
        name: firstNameOf(a.profile), animal: a.animal || NARRATED.has(a.profile.id),
        headX: sx, headY: sy - (a.animal ? 26 : 50), footY: sy,
      });
    }
    return out;
  }

  // ── Dev: stand two residents together and start them talking (chatterDev.ts) ──

  private devHost(): ChatterDevHost {
    const host: ChatterDevHost = {
      zoneId: this.zone.id,
      walkability: this.zone.walkability,
      player: () => this.lastPlayer,
      residents: () => this.actors.map(a => ({ id: a.profile.id, name: a.profile.name, x: a.pos?.x ?? null, y: a.pos?.y ?? null,
        place: a.state?.place ?? null, spot: a.pos ? spotAt(this.zone.social, a.pos) : null, visible: !!a.state?.visible && a.alpha > 0.5 })),
      stage: (id, at) => { if (at) { this.staged.set(id, at); this.stagedMs = 0; } else this.staged.delete(id); },
      staged: () => [...this.staged.keys()],
      startChatter: (a, b, mode) => this.chatter.force(a, b, this.talkers(this.actors.filter(x => x.base), this.viewRect()), this.lastPlayer ?? { x: 0, y: 0 }, mode),
      greet: (a, b) => this.greetings.force(a, b, this.talkers(this.actors.filter(x => x.base), this.viewRect())),
      readout: () => ({ chatter: this.chatter.state(), bubbles: [...this.chatter.bubbleState(), ...this.greetings.state()].filter(b => b.owner),
        counts: { ...this.chatter.count, greetings: this.greetings.count }, staged: host.staged() }),
    };
    return host;
  }

  /** Staged residents go back to their day once nothing holds them: no exchange, no bubble, a moment after. */
  private unstageWhenDone(dtMs: number): void {
    const held = [...this.staged.keys()].some(id => this.chatter.partner(id) || this.speaking(id));
    this.stagedMs = held ? 0 : this.stagedMs + dtMs;
    if (this.stagedMs > 2500) this.staged.clear();
  }

  // ── Tie emotes (§9.11.3, §16.5) ──────────────────────────────────────────

  /**
   * Residents with a tie who meet in view: the player learns the tie ("seen"), and now and then (PairEmoteThrottle)
   * the pair floats its emote over the two of them: ♪ Friends, ♥ Close friends or sweethearts, … Rivals, 💢 Enemies.
   */
  private pairEmotes(live: readonly Actor[], player: Position, dtMs: number): void {
    this.emoteClock += dtMs;
    this.emoteCheck += dtMs;
    this.driftEmotes(dtMs);
    if (this.emoteCheck < PAIR_EMOTE_RULES.checkMs) return;
    this.emoteCheck = 0;
    const spots: Spot[] = [];
    for (const a of live) if (a.pos && a.state?.visible && a.alpha > 0.5 && !a.talking && !this.speaking(a.profile.id)) spots.push({ id: a.profile.id, x: a.pos.x, y: a.pos.y });
    if (spots.length < 2) return;
    const ties = tieMap(this.scene.registry);
    const at = new Map(spots.map(s => [s.id, s]));
    const meeting = nearPairs(spots).filter(p => ties.has(p.key) && inSight(p, at, player));
    if (!meeting.length) return;
    learnSeen(this.scene.registry, meeting.map(p => [p.a, p.b] as const), this.clock.day);
    const key = this.emoteThrottle.pick(meeting.filter(p => pairEmote(ties.get(p.key)!)), this.emoteClock);
    const emote = key ? pairEmote(ties.get(key)!) : null;
    if (!key || !emote) return;
    const pair = key.split('+').map(id => this.byId.get(id)).filter((a): a is Actor => !!a);
    if (pair.length === 2) this.floatEmote(pair, emote.id);
  }

  private floatEmote(pair: Actor[], id: EmoteIcon): void {
    const img = this.emotePool.find(i => !i.visible && !this.floating.some(f => f.img === i));
    if (!img) return;
    img.setTexture(emoteTexture(this.scene, id)).setAlpha(0).setScale(0.4).setVisible(true);
    this.floating.push({ img, pair, ms: 0 });
  }

  /** The top of what's drawn over a resident's head: the name tag, else the activity bubble, else the head. */
  private headTop(a: Actor): number {
    if (a.label.visible) return a.label.y - a.label.height;
    if (a.bubble.visible) return a.bubble.y - a.bubble.displayHeight;
    return a.sprite.y - (a.animal ? 26 : 50);
  }

  /** A floating emote stays over its pair (between them, above the taller), pops in, rises a little and fades. */
  private driftEmotes(dtMs: number): void {
    const show = PAIR_EMOTE_RULES.showMs;
    this.floating = this.floating.filter(f => {
      f.ms += dtMs;
      if (f.ms >= show || f.pair.some(a => !a.sprite.visible || this.speaking(a.profile.id))) { f.img.setVisible(false); return false; }
      const t = f.ms / show, pop = Math.min(1, f.ms / 160);
      const x = f.pair.reduce((s, a) => s + a.sprite.x, 0) / f.pair.length;
      const top = Math.min(...f.pair.map(a => this.headTop(a))) - 3;
      f.img.setPosition(x, top - 10 * Math.sin((t * Math.PI) / 2))
        .setScale(0.4 + 0.6 * (1 - (1 - pop) ** 3) + (pop < 1 ? 0.15 * Math.sin(pop * Math.PI) : 0))
        .setAlpha(Math.min(...f.pair.map(a => a.alpha)) * Math.min(1, f.ms / 120, (show - f.ms) / 420));
      return true;
    });
  }

  /** Report residents as they come into prewarm range (once per approach; the caller rate-limits). */
  private approach(live: readonly Actor[], player: Position): void {
    const near = new Set<string>();
    for (const a of live) {
      if (!a.pos || !a.state?.visible || Math.hypot(a.pos.x - player.x, a.pos.y - player.y) > PREWARM_RANGE) continue;
      near.add(a.profile.id);
      if (!this.near.has(a.profile.id)) this.onApproach?.(a.profile.id);
    }
    this.near = near;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** The 1 Hz off-screen tick: everyone's state, this board's roster, the dev readout. */
  private tick(day: number): void {
    this.tickMs = 0;
    if (this.sim.profiles.length !== this.actors.length) this.syncActors();
    const minute = this.clock.minute;
    const states = this.sim.tick(day, minute);
    this.roster = this.indoor
      ? this.indoor.roster(m => (m === minute ? states : this.sim.executor.statesAt(this.sim.plansFor(day), m)), minute, LOOKAHEAD_MIN)
      : this.sim.boardRoster(this.zone.id, day, minute, LOOKAHEAD_MIN);
    const warnings = this.sim.executor.warnings;
    if (warnings.size > this.warned) {
      this.warned = warnings.size;
      console.warn(`[residents] places no built zone can place (treated as off-board): ${[...warnings].join(', ')}`);
    }
    if (this.readout) {
      const c = this.sim.counts(this.zone.id, states);
      this.readout.setText(`Residents (${states.length}) · this board ${c.here} (${c.inside} indoors) · traveling ${c.traveling} · off-board ${c.offboard} · other board ${c.elsewhere} · unresolved places ${c.unresolved}`);
    }
  }

  private advance(a: Actor, day: number, minute: number, dMin: number, dtMs: number, player: Position): void {
    const staged = this.staged.get(a.profile.id);
    if (staged) {
      // Dev (chatterDev.ts): stood here, routine held, standing still on this board.
      a.delay += dMin;
      const s = this.sampleAt(a.profile.id, day, minute - a.delay);
      a.state = s && { ...s, zone: this.zone.id, position: { ...staged }, tile: [Math.floor(staged.x), Math.floor(staged.y)], visible: true,
        moving: false, facing: null, traveling: null, path: null };
      a.base = a.state ? staged : null;
      return;
    }
    if (this.chatter.partner(a.profile.id)) {
      a.delay += dMin;
    } else if (a.talking) {
      a.delay += dMin; // frozen at the moment they were asked
      if (a.pos && Math.hypot(a.pos.x - player.x, a.pos.y - player.y) > TALK_RELEASE) a.talking = false;
    } else {
      // Behind schedule: hurry (up to 4× pace), faster the further behind.
      const catchUp = a.delay > 0 ? Math.min(a.delay, dMin * Math.min(3, Math.max(0.6, a.delay / 6))) : 0;
      const delay = a.delay - catchUp;
      const next = this.sampleAt(a.profile.id, day, minute - delay);
      let blocked = false;
      if (next?.moving && next.visible && next.zone === this.zone.id && next.position && a.base && !a.passing && dMin > 0) {
        const ahead = this.withOffset(next.position, next, a, player);
        const dNext = Math.hypot(ahead.x - player.x, ahead.y - player.y);
        const dNow = a.pos ? Math.hypot(a.pos.x - player.x, a.pos.y - player.y) : Infinity;
        blocked = dNext < BLOCK_RADIUS && dNext < dNow;
      }
      if (blocked) {
        a.delay += dMin;
        a.blockedMs += dtMs;
        if (a.blockedMs > MAX_WAIT_MS) a.passing = true; // waited long enough: squeeze past
      } else {
        a.delay = delay;
        a.blockedMs = 0;
      }
      if (a.passing && a.pos && Math.hypot(a.pos.x - player.x, a.pos.y - player.y) > BLOCK_RADIUS + 0.4) a.passing = false;
    }
    if (a.delay < 1e-6) a.delay = 0;
    const s = this.sampleAt(a.profile.id, day, minute - a.delay);
    a.state = s;
    a.base = s && s.zone === this.zone.id && s.position ? s.position : null;
  }

  /** A resident's routine state at a minute, as this board shows it (in a room: inside its building, at their spot). */
  private sampleAt(id: string, day: number, minute: number): ResidentState | null {
    return this.indoor ? this.indoor.stateAt(id, day, minute) : this.sim.sample(id, day, minute);
  }

  /** Where a body at `p` would stand with its lateral offsets, or `p` itself if that's against a wall. */
  private withOffset(p: Vec, s: ResidentState, a: Actor, player: Position): Vec {
    const off = this.desiredOffset(p, s, a, player, null);
    const q = { x: p.x + off.x, y: p.y + off.y };
    return fits(this.zone.walkability, q.x, q.y, BODY_CLEARANCE) ? q : p;
  }

  private desiredOffset(p: Vec, s: ResidentState, a: Actor, player: Position, others: readonly Actor[] | null): Vec {
    const off = { x: 0, y: 0 };
    if (s.moving && s.facing && !a.talking) {
      const right = { x: -s.facing.y, y: s.facing.x };
      off.x += right.x * KEEP_RIGHT; off.y += right.y * KEEP_RIGHT;
      // Step around the player, to whichever side they aren't on.
      const dx = player.x - p.x, dy = player.y - p.y, d = Math.hypot(dx, dy);
      if (d < AVOID_RADIUS) {
        const side = dx * right.x + dy * right.y > 0 ? -1 : 1, push = Math.min(0.55, (AVOID_RADIUS - d) * 0.9);
        off.x += right.x * side * push; off.y += right.y * side * push;
      }
    }
    if (others) for (const o of others) {
      if (o === a || !o.base || !o.state?.visible) continue;
      const dx = p.x - o.base.x, dy = p.y - o.base.y, d = Math.hypot(dx, dy);
      if (d >= PERSONAL_SPACE) continue;
      // Exactly on top of each other: split along a direction fixed by the pair's ids.
      const angle = d > 1e-4 ? Math.atan2(dy, dx) : ((hashString(a.profile.id) - hashString(o.profile.id)) % 628) / 100;
      const push = (PERSONAL_SPACE - d) / 2;
      off.x += Math.cos(angle) * push; off.y += Math.sin(angle) * push;
    }
    return off;
  }

  private place(a: Actor, live: readonly Actor[], player: Position, sec: number, dtMs: number): void {
    const s = a.state!, base = a.base!;
    const want = s.visible ? this.desiredOffset(base, s, a, player, live) : { x: 0, y: 0 };
    const k = Math.min(1, sec * 8);
    a.offset.x += (want.x - a.offset.x) * k;
    a.offset.y += (want.y - a.offset.y) * k;
    const walk = this.zone.walkability;
    let pos = { x: base.x + a.offset.x, y: base.y + a.offset.y };
    if (!fits(walk, pos.x, pos.y, BODY_CLEARANCE)) {
      pos = { x: base.x + a.offset.x / 2, y: base.y + a.offset.y / 2 };
      if (!fits(walk, pos.x, pos.y, BODY_CLEARANCE)) { pos = { ...base }; a.offset.x = a.offset.y = 0; }
    }
    // Facing: toward the player while talking (standing: talkers idle), else the way they walk.
    // Walk frames follow the distance actually drawn, so a held or hurrying walker's feet keep pace.
    // Standing at a gathering spot, they turn to the nearest company there (or the spot itself) instead of the street.
    const partner = this.byId.get(this.chatter.partner(a.profile.id) ?? '')?.pos ?? (!s.moving && !a.talking ? this.company(a, live) : null);
    const intent = partner ? { x: partner.x - pos.x, y: partner.y - pos.y } : a.talking ? { x: player.x - pos.x, y: player.y - pos.y } : s.moving ? s.facing : null;
    const moved = a.pos && !a.talking && !partner ? { x: pos.x - a.pos.x, y: pos.y - a.pos.y } : { x: 0, y: 0 };
    a.avatar.step({ intent, moved, dtMs });
    a.pos = pos;
  }

  /** At a social spot: the nearest other resident standing at the same one, else the spot itself; null elsewhere. */
  private company(a: Actor, live: readonly Actor[]): Vec | null {
    const spot = this.spots.get(a);
    if (!a.base || !spot) return null;
    let best: Vec | null = null, bestD = 3;
    for (const o of live) {
      if (o === a || !o.base || !o.state?.visible || this.spots.get(o) !== spot) continue;
      const d = Math.hypot(o.base.x - a.base.x, o.base.y - a.base.y);
      if (d < bestD) { best = o.pos ?? o.base; bestD = d; }
    }
    if (best) return best;
    const s = this.zone.social.find(x => x.id === spot)!;
    const at = { x: s.at[0] + 0.5, y: s.at[1] + 0.5 };
    return Math.hypot(at.x - a.base.x, at.y - a.base.y) > 0.3 ? at : null;
  }

  private draw(a: Actor, player: Position, pointer: Vec | null, dtMs: number): void {
    const s = a.state!, pos = a.pos!;
    const shown = s.visible;
    // Fade through doors and off the map's edge rather than popping.
    a.alpha = Phaser.Math.Clamp(a.alpha + (shown ? 1 : -1) * dtMs / 220, 0, 1);
    if (a.alpha <= 0) { this.hide(a, false); return; }
    const x = this.projection.originX + pos.x * DIORAMA_TILE_W;
    const foot = this.projection.originY + pos.y * DIORAMA_TILE_H - this.projection.elevationAt(Math.floor(pos.x), Math.floor(pos.y)) * DIORAMA_ELEV_STEP + DIORAMA_FOOT_DY;
    // Squeezing past the player reads as a courtesy, not a collision: a little see-through while it lasts.
    const ghost = a.passing && Math.hypot(pos.x - player.x, pos.y - player.y) < BLOCK_RADIUS + 0.2 ? 0.6 : 1;
    a.avatar.apply(a.sprite);
    a.sprite.setPosition(x, foot).setDepth(actorDepth(foot)).setAlpha(a.alpha * ghost).setVisible(true);
    a.shadow.setPosition(x, foot - 1).setAlpha(a.alpha).setVisible(true);
    const top = foot - (a.animal ? 26 : 50);
    const hovered = pointer !== null && Math.abs(pointer.x - x) < 15 && pointer.y > foot - (a.animal ? 26 : 48) && pointer.y < foot;
    const near = Math.hypot(pos.x - player.x, pos.y - player.y) <= NAME_RANGE;
    // The emote bubble sits just over the head; the name tag (when shown) above it.
    // A speech bubble (chatter, greetings) takes the place of the emote and the name tag: it carries the name. Both of a
    // talking pair drop theirs, so the listener's tag doesn't sit under the speaker's bubble.
    const speaking = this.scene.scene.isActive(PROJECT_BEAT) || this.speaking(a.profile.id) || this.chatter.partner(a.profile.id) !== null;
    const emote = shown && !speaking && (a.talking ? 'talk' : !s.moving ? s.activity : null);
    const key = emote ? ensureEmote(this.scene, emote) : null;
    if (key) {
      if (key !== a.emoteKey) { a.emoteKey = key; a.bubble.setTexture(key); }
      a.bubble.setPosition(x + 4, top + 2).setAlpha(a.alpha).setVisible(true);
    } else a.bubble.setVisible(false);
    a.label.setPosition(x, key ? top - 17 : top - 2).setAlpha(a.alpha).setVisible(shown && !speaking && a.alpha > 0.5 && (near || hovered || a.talking));
  }

  private hide(a: Actor, resetFade = true): void {
    a.sprite.setVisible(false); a.shadow.setVisible(false); a.label.setVisible(false); a.bubble.setVisible(false);
    if (resetFade) { a.alpha = 0; a.base = null; a.pos = null; a.state = null; a.offset.x = a.offset.y = 0; }
  }

  /** The pointer in world coordinates, undoing the camera's keystone perspective (render/keystone.ts). */
  private pointerWorld(): Vec | null {
    const p = this.scene.input.activePointer, cam = this.scene.cameras.main;
    if (!p || (p.x === 0 && p.y === 0)) return null;
    const src = screenToSource(p.x, p.y, GAME_WIDTH * RENDER_SCALE, GAME_HEIGHT * RENDER_SCALE, { k: DIORAMA_PERSPECTIVE_K, centerX: 0.5 });
    return src ? { x: cam.scrollX + src.x / cam.zoom, y: cam.scrollY + src.y / cam.zoom } : null;
  }

  private toWorld(p: Vec): Vec {
    return {
      x: this.projection.originX + p.x * DIORAMA_TILE_W,
      y: this.projection.originY + p.y * DIORAMA_TILE_H - this.projection.elevationAt(Math.floor(p.x), Math.floor(p.y)) * DIORAMA_ELEV_STEP + DIORAMA_FOOT_DY
    };
  }

  /** Dev (N): each walker's remaining path and the place they're bound for; a ring where each stands. */
  private drawOverlay(live: readonly Actor[]): void {
    const g = this.overlay.clear();
    for (const a of live) {
      const s = a.state;
      if (!s || !a.pos) continue;
      const here = this.toWorld(a.pos);
      if (s.path) {
        const pts = s.path.points;
        let walked = 0, i = 1;
        for (; i < pts.length; i++) {
          const seg = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
          if (walked + seg > s.path.distance) break;
          walked += seg;
        }
        g.lineStyle(2, a.colour, 0.9).beginPath().moveTo(here.x, here.y);
        for (; i < pts.length; i++) { const w = this.toWorld(pts[i]!); g.lineTo(w.x, w.y); }
        g.strokePath();
        const end = this.toWorld(pts[pts.length - 1]!);
        if (!s.target || s.target.zone !== this.zone.id) g.lineStyle(2, a.colour, 0.9).lineBetween(end.x - 6, end.y - 6, end.x + 6, end.y + 6).lineBetween(end.x - 6, end.y + 6, end.x + 6, end.y - 6);
      }
      if (s.target && s.target.zone === this.zone.id) {
        const t = this.toWorld(s.target.at);
        g.lineStyle(2, a.colour, 0.95).strokeCircle(t.x, t.y, s.traveling ? 9 : 6);
        if (!s.visible) g.fillStyle(a.colour, 0.5).fillCircle(t.x, t.y, 4); // inside
      }
    }
  }
}
