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
// Placeholder billboards for now: a coloured figure per resident (distinct hues), three facings, a name
// tag near the player or under the pointer, and a small emote bubble for what they're doing.

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
import type { Position } from '../../world/player';
import type { ZoneDef } from '../../world/zoneFormat';
import { zones } from '../../world/zones';
import { placeRegistry } from '../../world/places';
import { personaCards } from '../../world/residents';

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
    sim = new ResidentSim(personaCards, { zones, graph: new ZoneGraph(zones), registry: placeRegistry }, Math.max(0, wanted - personaCards.length));
    scene.registry.set(SIM_KEY, sim);
  }
  return sim;
}

type Facing = 'down' | 'up' | 'side';

interface Actor {
  profile: ResidentProfile;
  animal: boolean;
  colour: number;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Image;
  facing: Facing;
  flip: boolean;
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
  phase: number;
  /** Textures currently on the sprite and bubble (set only when they change). */
  figureKey: string;
  emoteKey: string;
}

// ── Placeholder art ─────────────────────────────────────────────────────────

const SKIN = [0xf2d5b3, 0xe3b48c, 0xc68e64, 0x8d5a3b, 0xf6e1cb, 0xa86f48];
const HAIR = [0x3b2a20, 0x6b4a2b, 0xb7b2a8, 0x1f1a17, 0x9c4a26, 0xd9c28a, 0x50392b];

/** A distinct hue per roster index (golden-angle spacing), muted to sit in the cozy palette. */
const residentColour = (index: number): number =>
  Phaser.Display.Color.HSLToColor(((index * 137.508) % 360) / 360, 0.52, 0.56).color;
const darker = (c: number, f: number): number =>
  (Math.round(((c >> 16) & 0xff) * f) << 16) | (Math.round(((c >> 8) & 0xff) * f) << 8) | Math.round((c & 0xff) * f);

function ensureFigure(scene: Phaser.Scene, actor: Pick<Actor, 'profile' | 'animal' | 'colour'>, facing: Facing): string {
  const key = `res-${actor.profile.id}-${facing}`;
  if (scene.textures.exists(key)) return key;
  const h = hashString(actor.profile.id), g = scene.make.graphics({ x: 0, y: 0 }, false);
  const body = actor.colour, trim = darker(body, 0.62);
  if (actor.animal) {
    // A cat, sitting low: body, head, ears, tail.
    const fur = 0x4a4038, ear = 0x2f2924;
    g.fillStyle(fur).fillEllipse(16, 41, 20, 11);
    if (facing === 'side') {
      g.fillStyle(fur).fillCircle(23, 33, 6.5).fillTriangle(18, 30, 20, 24, 23, 28).fillTriangle(24, 28, 27, 24, 28, 30);
      g.lineStyle(3, fur).lineBetween(7, 41, 4, 33);
      g.fillStyle(0xd8e070).fillCircle(26, 33, 1.3);
    } else {
      g.fillStyle(fur).fillCircle(16, 33, 7).fillTriangle(10, 31, 11, 24, 15, 28).fillTriangle(17, 28, 21, 24, 22, 31);
      g.fillStyle(ear).fillTriangle(11, 29, 12, 26, 14, 28).fillTriangle(18, 28, 20, 26, 21, 29);
      if (facing === 'down') g.fillStyle(0xd8e070).fillCircle(13.5, 33, 1.3).fillCircle(18.5, 33, 1.3);
      else g.lineStyle(3, fur).lineBetween(16, 44, 25, 38);
    }
    g.fillStyle(body).fillRect(11, 38, 10, 2); // a collar in his roster colour
  } else {
    const skin = SKIN[h % SKIN.length]!, hair = HAIR[(h >> 4) % HAIR.length]!;
    const side = facing === 'side';
    g.fillStyle(trim).fillRect(side ? 11 : 8, 40, side ? 5 : 6, 8).fillRect(side ? 16 : 18, 40, side ? 5 : 6, 8);
    g.fillStyle(body).fillRoundedRect(side ? 9 : 6, 15, side ? 14 : 20, 27, 4);
    g.fillStyle(trim).fillRect(side ? 9 : 6, 34, side ? 14 : 20, 3);
    g.fillStyle(skin).fillCircle(16, 9, 8);
    g.fillStyle(hair);
    if (facing === 'up') g.fillCircle(16, 9, 8.2);
    else if (side) g.fillRoundedRect(8, 1, 12, 9, 4).fillRect(8, 4, 5, 9);
    else g.fillRoundedRect(8, 1, 16, 6, 3);
    g.fillStyle(0x2a2420);
    if (facing === 'down') g.fillCircle(13, 10, 1.1).fillCircle(19, 10, 1.1);
    else if (side) g.fillCircle(20.5, 10, 1.1);
  }
  g.generateTexture(key, 32, 48);
  g.destroy();
  return key;
}

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
  private readonly actors: Actor[];
  private readonly byId: Map<string, Actor>;
  private roster = new Set<string>();
  private tickMs = Infinity;
  private lastMinute = NaN;
  private lastDay = NaN;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private overlayOn = false;
  private readout?: Phaser.GameObjects.Text;
  private warned = 0;

  /** Create every actor up front (hidden), so they all belong to the world camera. */
  constructor(private readonly scene: Phaser.Scene, private readonly zone: ZoneDef, private readonly projection: ObliqueProjection,
    private readonly clock: Clock, private readonly dev: boolean) {
    this.sim = sharedResidentSim(scene);
    this.actors = this.sim.profiles.map(profile => {
      const animal = profile.kind === 'animal', colour = residentColour(profile.index);
      const actor = { profile, animal, colour } as Actor;
      for (const f of ['down', 'up', 'side'] as const) ensureFigure(scene, actor, f);
      return Object.assign(actor, {
        sprite: scene.add.image(0, 0, `res-${profile.id}-down`).setOrigin(0.5, 1).setVisible(false),
        shadow: scene.add.ellipse(0, 0, animal ? 18 : 22, 7, 0x000000, 0.22).setDepth(DEPTH.SHADOW).setVisible(false),
        label: scene.add.text(0, 0, profile.name, { fontFamily: FAMILY_BODY, fontSize: '11px', color: '#fff0ce', backgroundColor: '#28372dcc', padding: { x: 3, y: 1 }, resolution: RENDER_SCALE })
          .setOrigin(0.5, 1).setDepth(DEPTH.OVER_DARK).setVisible(false),
        bubble: scene.add.image(0, 0, '__DEFAULT').setOrigin(0.2, 1).setDepth(DEPTH.OVER_DARK - 0.01).setVisible(false),
        facing: 'down' as Facing, flip: false, delay: 0, blockedMs: 0, passing: false, talking: false,
        offset: { x: 0, y: 0 }, base: null, pos: null, state: null, alpha: 0, phase: hashString(profile.id) % 7,
        figureKey: `res-${profile.id}-down`, emoteKey: ''
      });
    });
    this.byId = new Map(this.actors.map(a => [a.profile.id, a]));
    this.overlay = scene.add.graphics().setDepth(DEPTH.DARKNESS + 0.5).setVisible(false);
    const off = this.sim.events.on('talk-requested', e =>
      console.info(`[residents] talk-requested: ${e.residentId} (${this.sim.profile(e.residentId)?.name}) on Day ${e.day} at ${Math.floor(e.minute / 60)}:${String(Math.floor(e.minute % 60)).padStart(2, '0')}`));
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
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
    return best ? { id: best.profile.id, name: best.profile.name } : null;
  }

  /** E pressed beside a resident: emit `talk-requested` and hold them, facing the player, till the player leaves. */
  requestTalk(id: string): void {
    const actor = this.byId.get(id);
    if (!actor) return;
    actor.talking = true;
    this.sim.events.emit('talk-requested', { residentId: id, zone: this.zone.id, day: this.clock.day, minute: this.clock.exactMinute });
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
      if (!this.roster.has(a.profile.id) && a.delay === 0 && !a.talking) { this.hide(a); continue; }
      this.advance(a, day, minute, dMin, dtMs, player);
      if (a.base) live.push(a);
      else this.hide(a);
    }
    // Pass 2: offsets (keep right, sidestep the player, personal space), then draw.
    const sec = dtMs / 1000;
    for (const a of live) this.place(a, live, player, sec);
    const pointer = this.pointerWorld();
    for (const a of live) this.draw(a, player, pointer, dtMs);
    if (this.overlayOn) this.drawOverlay(live);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** The 1 Hz off-screen tick: everyone's state, this board's roster, the dev readout. */
  private tick(day: number): void {
    this.tickMs = 0;
    const minute = this.clock.minute;
    const states = this.sim.tick(day, minute);
    this.roster = this.sim.boardRoster(this.zone.id, day, minute, LOOKAHEAD_MIN);
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
    if (a.talking) {
      a.delay += dMin; // frozen at the moment they were asked
      if (a.pos && Math.hypot(a.pos.x - player.x, a.pos.y - player.y) > TALK_RELEASE) a.talking = false;
    } else {
      // Behind schedule: hurry (up to 4× pace), faster the further behind.
      const catchUp = a.delay > 0 ? Math.min(a.delay, dMin * Math.min(3, Math.max(0.6, a.delay / 6))) : 0;
      const delay = a.delay - catchUp;
      const next = this.sim.sample(a.profile.id, day, minute - delay);
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
    const s = this.sim.sample(a.profile.id, day, minute - a.delay);
    a.state = s;
    a.base = s && s.zone === this.zone.id && s.position ? s.position : null;
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

  private place(a: Actor, live: readonly Actor[], player: Position, sec: number): void {
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
    // Facing: toward the player while talking, else the way they walk.
    const dir = a.talking ? { x: player.x - pos.x, y: player.y - pos.y } : s.moving ? s.facing : null;
    if (dir && (dir.x !== 0 || dir.y !== 0)) {
      if (Math.abs(dir.y) > Math.abs(dir.x)) a.facing = dir.y > 0 ? 'down' : 'up';
      else { a.facing = 'side'; a.flip = dir.x < 0; }
    }
    const moved = a.pos ? Math.hypot(pos.x - a.pos.x, pos.y - a.pos.y) : 0;
    a.phase += moved * 7;
    a.pos = pos;
  }

  private draw(a: Actor, player: Position, pointer: Vec | null, dtMs: number): void {
    const s = a.state!, pos = a.pos!;
    const shown = s.visible;
    // Fade through doors and off the map's edge rather than popping.
    a.alpha = Phaser.Math.Clamp(a.alpha + (shown ? 1 : -1) * dtMs / 220, 0, 1);
    if (a.alpha <= 0) { this.hide(a, false); return; }
    const x = this.projection.originX + pos.x * DIORAMA_TILE_W;
    const foot = this.projection.originY + pos.y * DIORAMA_TILE_H - this.projection.elevationAt(Math.floor(pos.x), Math.floor(pos.y)) * DIORAMA_ELEV_STEP + DIORAMA_FOOT_DY;
    const bob = s.moving && !a.talking ? -Math.abs(Math.sin(a.phase)) * 2.5 : 0;
    // Squeezing past the player reads as a courtesy, not a collision: a little see-through while it lasts.
    const ghost = a.passing && Math.hypot(pos.x - player.x, pos.y - player.y) < BLOCK_RADIUS + 0.2 ? 0.6 : 1;
    const figure = `res-${a.profile.id}-${a.facing}`;
    if (figure !== a.figureKey) { a.figureKey = figure; a.sprite.setTexture(figure); }
    a.sprite.setFlipX(a.facing === 'side' && a.flip).setPosition(x, foot + bob).setDepth(actorDepth(foot)).setAlpha(a.alpha * ghost).setVisible(true);
    a.shadow.setPosition(x, foot - 1).setAlpha(a.alpha).setVisible(true);
    const top = foot - (a.animal ? 26 : 50);
    const hovered = pointer !== null && Math.abs(pointer.x - x) < 15 && pointer.y > foot - (a.animal ? 26 : 48) && pointer.y < foot;
    const near = Math.hypot(pos.x - player.x, pos.y - player.y) <= NAME_RANGE;
    // The emote bubble sits just over the head; the name tag (when shown) above it.
    const emote = shown && (a.talking ? 'talk' : !s.moving ? s.activity : null);
    const key = emote ? ensureEmote(this.scene, emote) : null;
    if (key) {
      if (key !== a.emoteKey) { a.emoteKey = key; a.bubble.setTexture(key); }
      a.bubble.setPosition(x + 4, top + 2).setAlpha(a.alpha).setVisible(true);
    } else a.bubble.setVisible(false);
    a.label.setPosition(x, key ? top - 17 : top - 2).setAlpha(a.alpha).setVisible(shown && a.alpha > 0.5 && (near || hovered || a.talking));
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
