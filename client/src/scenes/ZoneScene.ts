import { attachScuffles, attachScuffleClock, scuffleInteraction, recoverScuffle } from '../scuffles/interaction';
import { attachPuzzles, puzzleInteraction } from '../puzzles/interaction';
import { attachProjects, attachProjectsClock, type ProjectsAttachment } from '../projects/attach';
import { favorInteraction } from "../friendship/favors";
import { openPaper, PAPER_PENDING } from "./DawnReportScene";
import type { Press } from "@monde/shared";
import { markInteraction } from './markInteraction';
import { attachEconomy, attachEconomyClock, type EconomyAttachment } from '../economy/attach';
import type { SaveGame } from '@monde/shared';
import { attachSaves } from '../save/runtime';
import Phaser from 'phaser';
import { Grid } from '../combat/Grid';
import { buildDiorama, type DioramaResult } from '../render/diorama/Diorama';
import { TownBoard, preloadTownSprites } from '../render/town/TownBoard';
import { TownLife, reducedMotion } from '../render/town/TownLife';
import type { TownLook } from '../world/townSprites';
import type { TownFlag } from '../town/pillars';
import { addTorchGlow } from '../render/diorama/Lighting';
import { ensureDotTexture } from '../render/diorama/Atmosphere';
import { ObliqueProjection } from '../render/ObliqueProjection';
import { elevationFor } from '../render/elevation';
import { DIORAMA_TILE_W, DIORAMA_TILE_H, DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH, DIORAMA_FOOT_DY, DIORAMA_PERSPECTIVE_K } from '../render/dioramaConfig';
import { BloomPipeline, BLOOM_PIPELINE } from '../render/BloomPipeline';
import { PerspectivePipeline, PERSPECTIVE_PIPELINE } from '../render/PerspectivePipeline';
import { attachPostPipeline } from '../render/postPipelines';
import { SUN, castFrom, torchShadow, type Sun } from '../render/sun';
import { sunShadow } from '../render/sunClock';
import { DEPTH, actorDepth } from '../render/depth';
import { CharacterSprite, PLAYER_LOOK_KEY, playerLook, preloadCharacterSheets } from '../render/characterSprite';
import { ensureFellow } from '../fellow/state';
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE, FAMILY_BODY } from '../util/constants';
import { zones } from '../world/zones';
import type { Point, ZoneDef } from '../world/zoneFormat';
import { movePlayer, resolveEdge, nearbyPlace, placeName, standable, type Position } from '../world/player';
import { Clock, DAY_START, SOLAR_NOON, formatClock, formatDate, formatGameTime, parseClock } from '../sim/clock';
import { WEATHER_KINDS, dailyWeather, describeWeather, weatherAt, windToward, type DailyWeather, type WeatherKind, type WeatherNow } from '../sim/weather';
import { darkness, sunPosition, twilightGlow } from '../sim/sunAngle';
import { ResidentLayer } from './zone/residents';
import { attachDialogue } from './DialogueScene';
import { PillarStrip, attachTown, getTown, openTownLedger } from './TownLedgerScene';
import { MindStatusDot } from '../ui/mindStatus';
import { getMusic, musicHeld } from '../audio/Music';
import { ambientTrack } from '../audio/musicDirector';
import { applyServerRegard, attachDawnSync } from './friendship';
import { attachEventSync } from './events';
import { openPeople } from './PeopleScene';
import { attachStory, type StoryAttachment } from './story/attach';
import { attachMigration } from './migration';
import { attachArrivals } from './zone/arrivals';
import { closingToast, type StoryHint } from '../story/hint';
import { DIALOGUE_SCENE } from './DialogueScene';
import { STORY_SCENE, FELLOWSHIP_SCENE } from './StoryScene';

// ── Time, light and weather (W-04) ───────────────────────────────────────────
// One Clock for the whole game lives in the registry, so it keeps running across
// zone changes. The scene turns it into light: sun shadows that follow the sun
// (render/sunClock), a night layer that fades in at dusk with every lamp and lit
// window cut out of it, a colour grade for weather and twilight, and cheap
// screen-space weather (pooled particles for rain, snow and gusts; two drifting
// tiled layers for fog). Everything is built once in create() and only re-tinted
// after that, a few times per in-game minute.

const CLOCK_KEY = 'monde.clock';
const WEATHER_OVERRIDE_KEY = 'monde.weatherOverride';
const query = new URLSearchParams(window.location.search);
// The client has no world record yet (worlds and their seeds live on the server,
// M-01). Until it loads one, the weather uses this seed; `?seed=` picks another.
const WORLD_SEED = Number(query.get('seed')) || 1;
/** `[` / `]` move the clock an hour, `\` cycles the weather. Dev builds, or `?dev`. */
const DEV_KEYS = import.meta.env.DEV || query.has('dev');
/**
 * Into the town without the title (`?skiptitle=1`, the demo): sign a default Fellowship application. A New Game
 * arrives unsigned and signs at S01a's {charcreate} on the ferry slip (§11.1).
 */
const SIGN_DEFAULT_FELLOW = query.get('skiptitle') === '1' || query.get('demo') === '1';
/** Scene windows already warned about (story/hint.ts closingToast), per game: `sceneId@day`. */
const WARNED_KEY = 'monde.story.warned';
/** Overlays that hide the Next hint (it's for walking about). */
const HINT_HIDDEN_UNDER = [STORY_SCENE, DIALOGUE_SCENE, FELLOWSHIP_SCENE, 'TownLedger', 'People', 'SaveMenu'];
/** render/diorama/Lighting's glow texture: how the board's lamp glows are found to switch them by night. */
const TORCH_GLOW_KEY = 'torch_glow';

// Art tuning (not game rules).
/** How much direct sun each weather lets through: the sun shadows' strength. */
const SUN_SHADE: Readonly<Record<WeatherKind, number>> = { sun: 1, wind: 1, cloud: 0.3, rain: 0.12, fog: 0.08, snow: 0.2 };
/** Multiply grade per weather at full intensity. */
const WEATHER_GRADE: Readonly<Record<WeatherKind, number>> = {
  sun: 0xffffff, wind: 0xf6f8fa, cloud: 0xd9dde4, rain: 0xb3bccb, fog: 0xccd3d8, snow: 0xdde4ee
};
const DAWN_GRADE = 0xffc8b4;
const DUSK_GRADE = 0xffb47e;
/** The night layer's colour at full dark: a cool blue multiply, readable rather than black. */
const NIGHT_TINT = 0x4a5893;
const WINDOW_LIGHT = 0xffc46b;
const DEG = Math.PI / 180;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const channel = (c: number, shift: number): number => (c >> shift) & 0xff;
const mixColor = (a: number, b: number, t: number): number => {
  const m = (s: number) => Math.round(channel(a, s) + (channel(b, s) - channel(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
};
const mulColor = (a: number, b: number): number => {
  const m = (s: number) => Math.round((channel(a, s) * channel(b, s)) / 255) << s;
  return m(16) | m(8) | m(0);
};

/** A falling streak, bright at its leading end. */
const ensureRainTexture = (scene: Phaser.Scene): string => {
  const key = 'wx-rain';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 4, 28);
  if (!tex) return key;
  const ctx = tex.getContext();
  const g = ctx.createLinearGradient(0, 0, 0, 28);
  g.addColorStop(0, 'rgba(220,234,255,0)');
  g.addColorStop(1, 'rgba(236,246,255,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(1, 0, 2, 28);
  tex.refresh();
  return key;
};

/** Soft blobs of mist on a seamless 256² tile. */
const ensureFogTexture = (scene: Phaser.Scene): string => {
  const key = 'wx-fog';
  if (scene.textures.exists(key)) return key;
  const S = 256;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return key;
  const ctx = tex.getContext();
  let seed = 9001;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  for (let i = 0; i < 34; i++) {
    const x = rnd() * S, y = rnd() * S, r = 28 + rnd() * 70, a = 0.06 + rnd() * 0.12;
    // Drawn at every wrapped offset so the tile repeats without seams.
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  tex.refresh();
  return key;
};

/** The brush that cuts a light's reach out of the night (Ravage's CampScene brush). */
const ensureNightBrush = (scene: Phaser.Scene): string => {
  const key = 'night-light-brush';
  if (scene.textures.exists(key)) return key;
  const S = 256;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return key;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.refresh();
  return key;
};

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;
type EmitterConfig = Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;
/** Screen direction the wind blows toward, and how hard (0..1). */
interface Wind { x: number; y: number; strength: number }
const CALM: Wind = { x: 0, y: 0, strength: 0 };
// Emitter configs are rebuilt whole when the wind changes: Phaser's per-op setters only take numbers.
const rainConfig = (w: Wind): EmitterConfig => {
  const push = 60 + 260 * w.strength, vx = w.x * push, vy = 690 + w.y * push * 0.4;
  return {
    // Spawn upwind, so slanted rain still reaches the far side of the screen.
    x: { min: -40 - Math.max(0, vx) * 1.2, max: GAME_WIDTH + 40 - Math.min(0, vx) * 1.2 }, y: -30, lifespan: 1150,
    speedX: { min: vx * 0.9, max: vx * 1.1 }, speedY: { min: vy * 0.93, max: vy * 1.07 },
    rotate: -Math.atan2(vx, vy) / DEG, scaleY: { min: 0.8, max: 1.3 }, alpha: { min: 0.3, max: 0.55 },
    frequency: 10, quantity: 1, maxParticles: 450, emitting: false
  };
};
const snowConfig = (w: Wind): EmitterConfig => {
  const sx = w.x * (14 + 50 * w.strength);
  return {
    x: { min: -40 - Math.max(0, sx) * 12, max: GAME_WIDTH + 40 - Math.min(0, sx) * 12 }, y: -12, lifespan: 14000,
    speedX: { min: sx - 14, max: sx + 14 }, speedY: { min: 50 + w.y * 18, max: 85 + w.y * 18 },
    scale: { min: 0.22, max: 0.5 }, alpha: { min: 0.7, max: 0.95 }, tint: 0xf4f8ff,
    frequency: 50, quantity: 1, maxParticles: 900, emitting: false
  };
};
const gustConfig = (w: Wind): EmitterConfig => {
  const speed = 280 + 240 * w.strength;
  // A calm day still needs a direction for the streaks: default to the prevailing westerly.
  const x = w.x || w.y ? w.x : 1, y = w.x || w.y ? w.y : 0;
  return {
    x: { min: 0, max: GAME_WIDTH }, y: { min: 0, max: GAME_HEIGHT }, lifespan: 900,
    speedX: { min: x * speed * 0.8, max: x * speed * 1.2 }, speedY: { min: y * speed * 0.8, max: y * speed * 1.2 },
    rotate: Math.atan2(y, x) / DEG, scaleX: { min: 1.8, max: 3 }, scaleY: 0.24, alpha: { start: 0.4, end: 0 },
    tint: 0xf2f6ef, frequency: 60, quantity: 1, maxParticles: 120, emitting: false
  };
};
interface Cast { cast: Phaser.GameObjects.Image; src: Phaser.GameObjects.Image }
/** The Next hint under the HUD (story/hint.ts): a small card with when, where and why. */
interface HintCard {
  bg: Phaser.GameObjects.Graphics;
  when: Phaser.GameObjects.Text;
  where: Phaser.GameObjects.Text;
  why: Phaser.GameObjects.Text;
  x: number;
  w: number;
  shown: string;
}

interface Hud {
  date: Phaser.GameObjects.Text;
  time: Phaser.GameObjects.Text;
  weather: Phaser.GameObjects.Text;
  wind: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Graphics;
  arrow: Phaser.GameObjects.Graphics;
}

export class ZoneScene extends Phaser.Scene {
  /** The game clock (shared through the registry; also reachable from window.__game). */
  clock!: Clock;
  private zone!: ZoneDef;
  private position!: Position;
  private projection!: ObliqueProjection;
  private figure!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Image;
  /** The player's sheet and walk/idle animation (render/characterSprite); shown on both figure and shadow. */
  private avatar!: CharacterSprite;
  private prompt!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private transitioning = false;
  // Light. The scene object is reused by scene.restart(), so create() resets all of these.
  private readonly sun: Sun = { ...SUN };
  private lamps: { x: number; y: number; radius: number }[] = [];
  private sunCasts: Cast[] = [];
  private lampCasts: (Cast & { alpha: number })[] = [];
  private lampGlows: Phaser.GameObjects.Image[] = [];
  private windowGlows: Phaser.GameObjects.Image[] = [];
  private windowPanes!: Phaser.GameObjects.Graphics;
  private nightLayer!: Phaser.GameObjects.RenderTexture;
  private gradeLayer!: Phaser.GameObjects.RenderTexture;
  private lampLevel = 0;
  /** The light and sky the town's life reads (smoke, birds, butterflies). */
  private lightKind = { dark: 0, sunny: true, wet: false };
  private lightKey = NaN;
  private shadowDirty = true;
  // Weather.
  private daily!: DailyWeather;
  private now: WeatherNow = { kind: 'sun', intensity: 1 };
  private rain!: Emitter;
  private snow!: Emitter;
  private gusts!: Emitter;
  private fog: Phaser.GameObjects.TileSprite[] = [];
  private fogTime = 0;
  private fogWind = { x: 0, y: 0 };
  private aimedFor?: DailyWeather;
  private hud!: Hud;
  private hudIcon = '';
  /** Online/Offline: whether residents speak for themselves or from written lines (§9.14). */
  private mindDot?: MindStatusDot;
  /** The town's residents on this board (W-05); off-screen ones tick at 1 Hz inside it. */
  private residents!: ResidentLayer;
  /** What E does right now (set every frame along with the prompt). */
  private interact?: () => void;
  /** The small Pillar strip under the clock (G-01); P hides it. */
  private pillarStrip!: PillarStrip;
  /** Scripted scenes (G-10): zone, place and minute triggers; StoryScene plays them over this scene. */
  private story!: StoryAttachment;
  /** G-03: the Projects at their sites (E), the asks beside residents (H), volunteers at work, openings. */
  private projects!: ProjectsAttachment;
  /** H beside a resident: ask about the Projects. */
  private askAction: { label: string; run(): void } | null = null;
  private projectCache = { at: 0, key: '', project: null as { label: string; run(): void } | null, ask: null as { label: string; run(): void } | null };
  private hintCard!: HintCard;
  private toast!: Phaser.GameObjects.Text;
  private hintAt = 0;
  /** v2 zones: the town drawn from its sprites (render/town), and its small life. */
  private town?: TownBoard;
  private life?: TownLife;
  /** Where the wind blows (screen unit vector) and how hard, for smoke, leaves and swaying grass. */
  private windVec = { x: 0, y: 0, strength: 0 };
  /** Place names on a v2 board fade in near their door (the greybox showed them all, always). */
  private placeLabels: { text: Phaser.GameObjects.Text; x: number; y: number }[] = [];
  private lookAt = 0;
  constructor() { super('Zone'); }

  /** Drawn character sheets listed in assets/sprites/manifest.json, and the town's sprites. */
  preload(): void { preloadCharacterSheets(this); preloadTownSprites(this); }

  create(data: { zone?: string; arrive?: Point; savedPlayer?: SaveGame['player'] } = {}): void {
    this.zone = zones[data.zone ?? 'old_quarter']!;
    this.transitioning = false;
    this.resetLight();
    this.clock = this.sharedClock();
    const savedWeather = this.registry.get('monde.save.weather') as SaveGame['weather'] | undefined;
    this.daily = savedWeather?.daily.day === this.clock.day ? savedWeather.daily : dailyWeather(this.saveWeatherSeed(), this.clock.day);
    const [x, y] = data.arrive ?? this.zone.spawn;
    this.position = data.savedPlayer ? standable(this.zone, { x: data.savedPlayer.x, y: data.savedPlayer.y }) : { x: x + 0.5, y: y + 0.5 };
    this.registry.remove('monde.save.wakePlayer');
    let facing = data.savedPlayer?.facing ?? 0;
    let lastPosition = { ...this.position };
    attachEconomyClock(this, this.clock);
    attachPuzzles(this, this.clock);
    attachScuffles(this, this.clock);
    attachSaves(this, this.clock, () => {
      const waking = this.registry.get('monde.save.wakePlayer') as SaveGame['player'] | undefined;
      if (waking) return waking;
      const dx = this.position.x - lastPosition.x, dy = this.position.y - lastPosition.y;
      if (dx || dy) facing = Math.atan2(dy, dx);
      lastPosition = { ...this.position };
      // A dawn during an edge fade belongs to the destination doorstep.
      const edge = resolveEdge(this.zone, this.position);
      return edge ? { zone: edge.zone, x: edge.arrive[0] + 0.5, y: edge.arrive[1] + 0.5, facing }
        : { zone: this.zone.id, ...this.position, facing };
    }, this.saveWeatherSeed(), () => !this.transitioning);
    const grid = new Grid(this.zone);
    const elevation = elevationFor(this.zone);
    this.projection = new ObliqueProjection({ originX: 0, originY: 0,
      gridWidth: this.zone.width, gridHeight: this.zone.height,
      tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H, elevStep: DIORAMA_ELEV_STEP,
      slabDepth: DIORAMA_SLAB_DEPTH, elevationAt: (x, y) => elevation(Math.floor(x), Math.floor(y)) });
    if (this.zone.town) {
      // The town (zone format v2): baked ground, animated water, the buildings and props from their sprites.
      const start = this.projection.tileToWorld({ x: this.position.x - 0.5, y: this.position.y - 0.5 });
      const reduced = reducedMotion();
      this.town = new TownBoard(this, { zone: this.zone, projection: this.projection, seed: 42, look: this.townLook(), focus: start, reduced });
      this.lampGlows = [...this.town.lampGlows];
      this.lamps = this.town.lights.map(({ x, y, radius }) => ({ x, y, radius }));
      this.life = new TownLife(this, this.town, { reduced, seaside: this.zone.tiles.some(t => t.kind === 'sea') });
      // Place names fade in as you near the door, readable over the night.
      this.placeLabels = this.zone.places.map(place => {
        const p = this.projection.tileToWorld({ x: place.door[0], y: place.door[1] });
        const text = this.add.text(p.x, p.y - 30, placeName(place.id), { fontFamily: FAMILY_BODY, fontSize: '11px', color: '#fff0ce', backgroundColor: '#343d34cc', padding: { x: 4, y: 1 }, resolution: RENDER_SCALE })
          .setOrigin(0.5, 1).setDepth(DEPTH.OVER_DARK).setAlpha(0);
        return { text, x: place.door[0] + 0.5, y: place.door[1] + 0.5 };
      });
    } else {
      const firstBoardObject = this.children.list.length;
      // No `sun` here: the board's static shadows are replaced by clock-driven ones (buildShadows).
      const board = buildDiorama(this, { width: this.zone.width, height: this.zone.height,
        tileAt: p => ({ ...grid.tileAt(p), blocksMovement: !this.zone.walkability[p.y]?.[p.x] }) }, this.projection,
      { footDY: DIORAMA_FOOT_DY, seed: 42, elevationAt: elevation, elevStep: DIORAMA_ELEV_STEP, rotation: 0, gridOf: (x, y) => ({ x, y }) });
      this.lampGlows = this.children.list.slice(firstBoardObject).filter((o): o is Phaser.GameObjects.Image =>
        o instanceof Phaser.GameObjects.Image && o.texture.key === TORCH_GLOW_KEY);
      this.lamps = board.lights.map(({ x, y, radius }) => ({ x, y, radius }));
      this.buildShadows(board);
      // Greybox doorstep markers and short labels keep the town navigable (labels stay readable over the night).
      for (const place of this.zone.places) {
        const p = this.projection.tileToWorld({ x: place.door[0], y: place.door[1] });
        this.add.rectangle(p.x, p.y, 18, 7, 0xe4c77f).setDepth(DEPTH.GROUND_MARK);
        this.add.text(p.x, p.y - 22, placeName(place.id), { fontFamily: FAMILY_BODY, fontSize: '11px', color: '#fff0ce', backgroundColor: '#343d34' })
          .setOrigin(0.5, 1).setDepth(DEPTH.OVER_DARK);
      }
    }
    // The player: a drawn sheet if the manifest lists one, else the procedural rig. The shadow shows the same frame.
    // Arriving without a signed Fellowship form: ?skiptitle=1 and the demo sign a default one ("Fellow", the default
    // look); a New Game stays unsigned until Pell hands the form over in S01a.
    ensureFellow(this.registry, { signDefault: SIGN_DEFAULT_FELLOW });
    this.avatar = new CharacterSprite(this, 'player', playerLook(this.registry));
    this.figure = this.add.image(0, 0, this.avatar.sheet.key);
    this.shadow = this.add.image(0, 0, this.avatar.sheet.key).setTintFill(0).setAlpha(0).setDepth(DEPTH.SHADOW);
    this.avatar.apply(this.figure);
    this.avatar.apply(this.shadow, false);
    // A form signed while the town waits (the story's {charcreate}) re-dresses the player.
    const relook = (_parent: unknown, key: string) => {
      if (key !== PLAYER_LOOK_KEY) return;
      this.avatar = new CharacterSprite(this, 'player', playerLook(this.registry), this.avatar.anim.facing);
      this.avatar.apply(this.figure);
      this.avatar.apply(this.shadow, false);
    };
    this.registry.events.on(Phaser.Data.Events.SET_DATA, relook).on(Phaser.Data.Events.CHANGE_DATA, relook);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off(Phaser.Data.Events.SET_DATA, relook).off(Phaser.Data.Events.CHANGE_DATA, relook));
    this.buildNight();
    this.buildWeather();
    this.syncFigure();
    // Before the world snapshot below, so every resident sprite belongs to the world camera.
    this.residents = new ResidentLayer(this, this.zone, this.projection, this.clock, DEV_KEYS);
    // E beside a resident opens the dialogue panel over this scene; walking near one prewarms it (M-05).
    attachDialogue(this, { residents: this.residents, zone: this.zone, clock: this.clock, weather: () => this.now, playerPosition: () => this.position });
    this.story = attachStory(this, { zone: this.zone, clock: this.clock, residents: this.residents, position: () => this.position,
      weather: () => this.now, entry: data, busy: () => this.transitioning });
    const world = this.children.list.slice();
    const camera = this.cameras.main;
    camera.setOrigin(0, 0).setZoom(RENDER_SCALE);
    const bounds = this.projection.bounds();
    camera.setBounds(bounds.x, bounds.y, bounds.w, bounds.h);
    this.followPlayer();
    const perspective = attachPostPipeline(camera, this.game, PERSPECTIVE_PIPELINE, PerspectivePipeline);
    if (perspective) perspective.k = DIORAMA_PERSPECTIVE_K;
    attachPostPipeline(camera, this.game, BLOOM_PIPELINE, BloomPipeline);
    const ui = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ui.ignore(world);
    const title = this.add.text(24, 18, this.zone.name, { fontFamily: FAMILY_BODY, fontSize: '28px', color: '#fff0ce', backgroundColor: '#28372d' });
    const controls = this.add.text(24, 56, 'WASD / arrows: walk  ·  E: interact  ·  I: bag  ·  L: ledger  ·  J: journal', { fontFamily: FAMILY_BODY, fontSize: '17px', color: '#fff0ce', backgroundColor: '#28372d' });
    const devHelp = this.add.text(24, 82, DEV_KEYS ? 'Dev  ·  [ / ]: hour back / forward  ·  \\: cycle weather  ·  N: resident paths' : '', { fontFamily: FAMILY_BODY, fontSize: '14px', color: '#d9cfb4', backgroundColor: '#28372d' })
      .setVisible(DEV_KEYS);
    this.prompt = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 50, '', { fontFamily: FAMILY_BODY, fontSize: '22px', color: '#fff0ce', backgroundColor: '#28372d', padding: { x: 12, y: 6 } }).setOrigin(0.5);
    // Above the E prompt: the gentle toasts (a scene's window about to close).
    this.toast = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 84, '', { fontFamily: FAMILY_BODY, fontSize: '17px', fontStyle: 'italic', color: '#fff0ce', backgroundColor: '#28372dee', padding: { x: 14, y: 7 }, resolution: RENDER_SCALE })
      .setOrigin(0.5, 1).setAlpha(0);
    camera.ignore([title, controls, devHelp, this.prompt, this.toast, ...this.buildHud(), ...this.residents.buildUi()]);
    this.economy = attachEconomy(this, this.clock, text => this.showToast(text), () => {
      const cottage = zones.old_quarter?.places.find(p => p.id === 'lamplighter_cottage');
      if (cottage) this.registry.set('monde.save.wakePlayer', { zone: 'old_quarter', x: cottage.door[0] + 0.5, y: cottage.door[1] + 0.5, facing: 0 });
      this.scene.restart({ zone: 'old_quarter', arrive: cottage?.door });
    });
    camera.ignore(this.economy.objects);
    this.projects = attachProjects(this, { zone: this.zone, clock: this.clock, residents: this.residents, projection: this.projection,
      position: () => this.position, weather: () => this.now, toast: text => this.showToast(text),
      refreshBoard: () => this.town?.refresh(this.townLook()), busy: () => this.transitioning });
    // G-02: newcomers off the ferry, leavers to the slip, and the Gannet's timetable on the Wharf.
    attachArrivals(this, { zone: this.zone, clock: this.clock, residents: this.residents, board: this.town,
      refreshBoard: () => this.town?.refresh(this.townLook()), toast: text => this.showToast(text) });
    this.askAction = null;
    this.projectCache = { at: 0, key: '', project: null, ask: null };
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E') as Record<string, Phaser.Input.Keyboard.Key>;
    // On the key's own down event, so even a tap shorter than a frame counts (keys are destroyed on restart).
    this.interact = undefined;
    this.keys.E!.on('down', () => { if (!this.transitioning) this.interact?.(); });
    this.installTownKeys();
    // Forced, so weather already under way is prefilled: arriving mid-shower, the sky is full.
    this.applyLight(true);
    this.installClockHooks();
    camera.fadeIn(400); // GDD §16.4.
  }

  private economy!: EconomyAttachment;

  private sharedClock(): Clock {
    let clock = this.registry.get(CLOCK_KEY) as Clock | undefined;
    if (!clock) {
      // `?day=` and `?time=` start the clock elsewhere for testing (e.g. ?day=80&time=21:30).
      clock = new Clock({ day: Number(query.get('day')) || 1, minute: parseClock(query.get('time') ?? '') ?? DAY_START });
      this.registry.set(CLOCK_KEY, clock);
    }
    // The town's numbers live beside the clock, with Day-1 values, and its dawn pass runs on the clock's dawn (G-01).
    attachScuffleClock(this, clock);
    attachTown(this.registry, clock);
    // G-02: arrivals and departures, right after the town's dawn (it reads the arrival roll).
    attachMigration(this.registry, clock);
    // The Projects' dawn (G-03): after the town's, before the Dawn Report, so the paper has last night's hours in.
    attachProjectsClock(this.registry, clock);
    // Friendship and the dawn package: the night's plans, ties and letters from the server at each dawn (G-13).
    this.events.on('update', () => {
      const paper = this.registry.get(PAPER_PENDING) as Press | undefined;
      if (paper && !this.scene.isActive('Dialogue') && !this.scene.isActive('DawnReport')) {
        this.registry.remove(PAPER_PENDING); openPaper(this, { paper, clock, seed: this.saveWeatherSeed() });
      }
    });
    attachDawnSync(this.registry, clock, { weatherSeed: () => this.saveWeatherSeed(), town: () => getTown(this.registry) });
    // The event log (M-06): story cues, flags and town events to monde-mind; each answer's Regard replaces the mirror.
    attachEventSync(this.registry, clock, { onRegard: regard => applyServerRegard(this.registry, regard) });
    return clock;
  }

  /** L opens the Town Ledger and J the People page (each holds the clock while open); P shows or hides the HUD Pillar strip. */
  private installTownKeys(): void {
    const seen = new WeakSet<KeyboardEvent>();
    const onKey = (event: KeyboardEvent) => {
      if (seen.has(event) || event.repeat || this.transitioning) return;
      seen.add(event);
      if (event.code === 'KeyL' || event.key === 'l' || event.key === 'L') openTownLedger(this, this.clock);
      else if (event.code === 'KeyJ' || event.key === 'j' || event.key === 'J') openPeople(this, this.clock);
      else if (event.code === 'KeyP' || event.key === 'p' || event.key === 'P') this.pillarStrip.toggle();
      else if ((event.code === 'KeyH' || event.key === 'h' || event.key === 'H') && !this.clock.paused) this.askAction?.run();
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', onKey));
  }

  private saveWeatherSeed(): number {
    return (this.registry.get('monde.save.weather') as SaveGame['weather'] | undefined)?.seed ?? WORLD_SEED;
  }

  /** What decides each restorable sprite's art: the story's flags (the save's record) and the town engine's. */
  private townLook(): TownLook {
    const story = (this.registry.get('monde.story.flags') ?? {}) as Record<string, unknown>;
    const town = getTown(this.registry);
    return { flag: f => story[f] === true || town?.flags[f as TownFlag] === true };
  }

  private resetLight(): void {
    this.town = undefined; this.life = undefined; this.placeLabels = []; this.lookAt = 0;
    this.lamps = []; this.sunCasts = []; this.lampCasts = []; this.lampGlows = []; this.windowGlows = []; this.fog = [];
    this.lampLevel = 0; this.lightKey = NaN; this.shadowDirty = true; this.aimedFor = undefined; this.hudIcon = '';
  }

  private installClockHooks(): void {
    const offs: (() => void)[] = [];
    if (import.meta.env.DEV) {
      offs.push(
        this.clock.onDawn(t => console.info(`[clock] dawn · ${formatGameTime(t)}`)),
        this.clock.onDusk(t => console.info(`[clock] dusk · ${formatGameTime(t)}`)),
        this.clock.on26(t => console.info(`[clock] 2:00 · passed out on Day ${t.day}`)));
    }
    // By character or by physical key, whichever the layout (or a test driver) reports.
    const pressed = (event: KeyboardEvent, key: string, code: string) => event.key === key || event.code === code;
    // Phaser can re-emit a native event when several keydowns land in one frame; act on each once.
    const seen = new WeakSet<KeyboardEvent>();
    const onKey = (event: KeyboardEvent) => {
      if (seen.has(event)) return;
      seen.add(event);
      if (pressed(event, 'n', 'KeyN') || event.key === 'N') { this.residents.toggleOverlay(); return; }
      if (pressed(event, ']', 'BracketRight')) this.clock.advanceMinutes(60);
      else if (pressed(event, '[', 'BracketLeft')) this.clock.setTime(this.clock.day, this.clock.minute - 60);
      else if (pressed(event, '\\', 'Backslash')) {
        const order: (WeatherKind | 'auto')[] = ['auto', ...WEATHER_KINDS];
        const current = (this.registry.get(WEATHER_OVERRIDE_KEY) as WeatherKind | 'auto' | undefined) ?? 'auto';
        this.registry.set(WEATHER_OVERRIDE_KEY, order[(order.indexOf(current) + 1) % order.length]);
      } else return;
      this.applyLight(true);
    };
    if (DEV_KEYS) this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offs.forEach(off => off());
      this.input.keyboard?.off('keydown', onKey);
    });
  }

  // ── Shadows ────────────────────────────────────────────────────────────────

  /** Every prop gets a sun shadow (rotated by the clock) and, near a lamp, a lamp shadow for the night. */
  private buildShadows(board: DioramaResult): void {
    const lampProps = new Set(board.lights.map(l => l.img));
    for (const { img } of board.props) {
      // A lamp is a light: it throws no shadow of its own (as the diorama does for torches).
      if (lampProps.has(img)) continue;
      const silhouette = (depth: number) => this.add.image(img.x, img.y, img.texture.key)
        .setOrigin(img.originX, img.originY).setTintFill(0x000000).setAlpha(0).setDepth(depth);
      this.sunCasts.push({ cast: silhouette(DEPTH.SHADOW - 0.1), src: img });
      const lit = torchShadow(img.x, img.y, this.lamps);
      if (lit) {
        const cast = silhouette(DEPTH.TORCH_SHADOW - 0.01);
        castFrom(cast, img, lit);
        this.lampCasts.push({ cast, src: img, alpha: lit.alpha });
      }
    }
  }

  /** The player's shadow: from the sun, or from the nearest lit lamp once that is the stronger light. */
  private castPlayerShadow(): void {
    let light: Sun = this.sun, alpha = this.sun.alpha;
    if (this.lampLevel > 0) {
      const lit = torchShadow(this.figure.x, this.figure.y, this.lamps);
      if (lit && lit.alpha * this.lampLevel > alpha) { light = lit; alpha = lit.alpha * this.lampLevel; }
    }
    castFrom(this.shadow, this.figure, light);
    // A lamp's shadow lies over its own light pool; the sun's lies under any pool (render/depth).
    this.shadow.setAlpha(alpha).setVisible(alpha > 0.004).setDepth(light === this.sun ? DEPTH.SHADOW : DEPTH.TORCH_SHADOW);
  }

  // ── Night ──────────────────────────────────────────────────────────────────

  /**
   * GDD §16.4: night has lamp pools and glowing windows. The lamps are the board's
   * own torch glows (render/diorama/Lighting), switched on at dusk; windows are warm
   * panes on each lived-in building's front wall with a pool of light at its door.
   * The night itself is one MULTIPLY render texture (Ravage's darkness layer): white,
   * with every light's reach erased, tinted night-blue and faded in by darkness().
   */
  private buildNight(): void {
    const panes = this.add.graphics().setDepth(DEPTH.TERRAIN_FX).setBlendMode(Phaser.BlendModes.ADD);
    const pools: { x: number; y: number; w: number; h: number }[] = [];
    const buildings = new Set(this.zone.tiles.map(t => t.building));
    if (this.town) {
      // v2: lit windows ride on the buildings themselves (render/town); here, the pool at each lived-in door.
      pools.push(...this.town.doorPools());
      this.windowGlows.push(...this.town.doorGlows);
    }
    for (const place of this.town ? [] : this.zone.places) {
      // GDD-GAP: §16.4 lights occupied homes only, and nothing tracks occupancy or restoration
      // yet. Until it does, every building is lit from dusk except the Day-1 empties: the
      // vacant houses (§2.4) and the nine empty storefronts (A.1.4). Open ground
      // (market_street, back_alley) has no windows.
      if (!buildings.has(place.id) || /^(vacant_house|storefront)_/.test(place.id)) continue;
      const [rx, ry, rw, rh] = place.rect, row = ry + rh - 1;
      for (let x = rx; x < rx + rw; x++) {
        const face = this.projection.frontFace({ x, y: row });
        if (face.h < 8 || x === place.door[0]) continue;
        panes.fillStyle(WINDOW_LIGHT, 0.95).fillRect(face.x + face.w / 2 - 6, face.y + face.h / 2 - 4, 12, 8);
      }
      const door = this.projection.tileToWorld({ x: place.door[0], y: place.door[1] });
      const glow = addTorchGlow(this, door.x, door.y - 8, { depth: DEPTH.LIGHT, scaleX: 1.5, scaleY: 1.1 });
      // Lamplight, not firelight: steady.
      this.tweens.killTweensOf(glow);
      this.windowGlows.push(glow.setAlpha(0.85));
      const front = this.projection.frontFace({ x: rx, y: row });
      pools.push({ x: front.x + (rw * DIORAMA_TILE_W) / 2, y: front.y + front.h, w: rw * DIORAMA_TILE_W * 1.1, h: 96 });
    }
    this.windowPanes = panes;
    const b = this.projection.bounds(), pad = 96;
    const night = this.add.renderTexture(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2).setOrigin(0, 0);
    night.fill(0xffffff, 1);
    const brush = this.make.image({ key: ensureNightBrush(this), add: false });
    const cut = (x: number, y: number, w: number, h: number) => {
      brush.setPosition(x - night.x, y - night.y).setScale(w / 256, h / 256);
      night.erase(brush);
    };
    for (const l of this.lamps) cut(l.x, l.y - 16, l.radius * 2, l.radius * 1.6);
    for (const p of pools) cut(p.x, p.y, p.w, p.h);
    brush.destroy();
    this.nightLayer = night.setBlendMode(Phaser.BlendModes.MULTIPLY).setTint(NIGHT_TINT).setDepth(DEPTH.DARKNESS + 0.1);
    // Weather and twilight grade: a plain multiply over the whole board.
    // A white RenderTexture tinted per light update, like the night layer; hidden while the grade is white.
    this.gradeLayer = this.add.renderTexture(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
      .fill(0xffffff).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(DEPTH.DARKNESS);
  }

  /** Re-light the scene for the clock: a few times per in-game minute, or at once after a dev jump. */
  private applyLight(force = false): void {
    const day = this.clock.day, minute = this.clock.exactMinute;
    const key = day * 10000 + Math.floor(minute * 4);
    if (!force && key === this.lightKey) return;
    this.lightKey = key;
    if (this.daily.day !== day) this.daily = dailyWeather(this.saveWeatherSeed(), day);
    const override = this.registry.get(WEATHER_OVERRIDE_KEY) as WeatherKind | 'auto' | undefined;
    this.now = override && override !== 'auto' ? { kind: override, intensity: 1 } : weatherAt(this.daily, minute);
    const { kind, intensity } = this.now;
    const dark = darkness(day, minute);
    sunShadow(sunPosition(day, minute), 1 + (SUN_SHADE[kind] - 1) * intensity, this.sun);
    for (const { cast, src } of this.sunCasts) {
      castFrom(cast, src, this.sun);
      cast.setAlpha(this.sun.alpha).setVisible(this.sun.alpha > 0.004);
    }
    // Lamps come on as the light goes.
    this.lampLevel = clamp01((dark - 0.12) / 0.3);
    const on = this.lampLevel > 0.005, grey = Math.round(this.lampLevel * 255) * 0x010101;
    for (const glow of this.lampGlows) glow.setVisible(on).setTint(grey);
    for (const glow of this.windowGlows) glow.setVisible(on).setTint(grey);
    this.windowPanes.setVisible(on).setAlpha(this.lampLevel);
    for (const { cast, alpha } of this.lampCasts) cast.setVisible(on).setAlpha(alpha * this.lampLevel);
    this.town?.applyLight({ sun: this.sun, lampLevel: this.lampLevel, dark });
    this.lightKind = { dark, sunny: (kind === 'sun' || kind === 'wind') && intensity > 0.3, wet: kind === 'rain' || kind === 'snow' || kind === 'fog' };
    this.nightLayer.setVisible(dark > 0.004).setAlpha(dark);
    const weather = mixColor(0xffffff, WEATHER_GRADE[kind], intensity * (1 - 0.5 * dark));
    const warm = mixColor(0xffffff, minute < SOLAR_NOON ? DAWN_GRADE : DUSK_GRADE, 0.6 * twilightGlow(day, minute));
    const grade = mulColor(weather, warm);
    this.gradeLayer.setTint(grade).setVisible(grade !== 0xffffff);
    this.applyWeather(force);
    this.updateHud(dark, override !== undefined && override !== 'auto');
    this.shadowDirty = true;
  }

  // ── Weather ────────────────────────────────────────────────────────────────

  /** Screen-space weather on the world camera (so the night and the grade fall on it too). */
  private buildWeather(): void {
    const dot = ensureDotTexture(this);
    const layer = (e: Emitter) => e.setScrollFactor(0).setDepth(DEPTH.ATMOSPHERE);
    this.rain = layer(this.add.particles(0, 0, ensureRainTexture(this), rainConfig(CALM)));
    this.snow = layer(this.add.particles(0, 0, dot, snowConfig(CALM)));
    this.gusts = layer(this.add.particles(0, 0, dot, gustConfig(CALM)));
    const fogKey = ensureFogTexture(this);
    for (let i = 0; i < 2; i++) {
      this.fog.push(this.add.tileSprite(-32, -32, GAME_WIDTH + 64, GAME_HEIGHT + 64, fogKey)
        .setOrigin(0, 0).setScrollFactor(0).setTileScale(2 + i).setTint(0xdfe6ea)
        .setDepth(DEPTH.ATMOSPHERE + 0.01 * (i + 1)).setVisible(false));
    }
  }

  /** Point the rain, snow, gusts and fog drift down the day's wind (once a day; emitters restart stopped). */
  private aimWeather(daily: DailyWeather): void {
    const toward = windToward(daily.wind) * DEG;
    const wind = { x: Math.sin(toward), y: -Math.cos(toward), strength: daily.windStrength };
    this.windVec = wind;
    this.rain.setConfig(rainConfig(wind));
    this.snow.setConfig(snowConfig(wind));
    this.gusts.setConfig(gustConfig(wind));
    this.fogWind.x = wind.x * (5 + 18 * wind.strength);
    this.fogWind.y = wind.y * (5 + 18 * wind.strength);
  }

  private applyWeather(prefill: boolean): void {
    if (this.aimedFor !== this.daily) { this.aimedFor = this.daily; this.aimWeather(this.daily); }
    const { kind, intensity } = this.now;
    const rate = (emitter: Emitter, level: number, perSecond: number, perSecondAtFull: number, prefillMs: number) => {
      if (level <= 0.01) { if (emitter.emitting) emitter.stop(); return; }
      emitter.frequency = 1000 / (perSecond + (perSecondAtFull - perSecond) * level);
      if (!emitter.emitting) { emitter.start(); if (prefill) emitter.fastForward(prefillMs); }
    };
    rate(this.rain, kind === 'rain' ? intensity : 0, 50, 300, 1200);
    rate(this.snow, kind === 'snow' ? intensity : 0, 12, 50, 12000);
    rate(this.gusts, kind === 'wind' ? intensity : 0, 6, 26, 900);
    const fog = kind === 'fog' ? intensity : 0;
    this.fog.forEach((layer, i) => layer.setVisible(fog > 0.01).setAlpha(fog * (i === 0 ? 0.62 : 0.45)));
  }

  /** Fog drifts with the wind and stays put on the ground as the camera moves. No allocation. */
  private driftFog(dtMs: number): void {
    if (!this.fog[0]?.visible) return;
    this.fogTime += dtMs / 1000;
    const cam = this.cameras.main;
    for (let i = 0; i < this.fog.length; i++) {
      const layer = this.fog[i]!, parallax = 1 + 0.2 * i, scale = layer.tileScaleX;
      layer.tilePositionX = (cam.scrollX * parallax - this.fogTime * this.fogWind.x * (1 + i)) / scale;
      layer.tilePositionY = (cam.scrollY * parallax - this.fogTime * this.fogWind.y * (1 + i)) / scale;
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  /** Top-right: weekday, season and day, the time, the weather and a wind arrow (pointing downwind). */
  private buildHud(): Phaser.GameObjects.GameObject[] {
    const W = 248, H = 102, x0 = GAME_WIDTH - 20 - W, y0 = 16;
    const style = (size: number, color = '#fff0ce'): Phaser.Types.GameObjects.Text.TextStyle =>
      ({ fontFamily: FAMILY_BODY, fontSize: `${size}px`, color, resolution: RENDER_SCALE });
    const bg = this.add.graphics();
    bg.fillStyle(0x28372d, 0.92).fillRoundedRect(x0, y0, W, H, 10);
    bg.lineStyle(2, 0xe4c77f, 0.55).strokeRoundedRect(x0, y0, W, H, 10);
    const arrow = this.add.graphics({ x: x0 + W - 80, y: y0 + 84 });
    arrow.lineStyle(2.5, 0xfff0ce, 1).lineBetween(0, 8, 0, -5);
    arrow.fillStyle(0xfff0ce, 1).fillTriangle(0, -10, -5, -3, 5, -3);
    this.hud = {
      date: this.add.text(x0 + 16, y0 + 10, '', style(17)),
      time: this.add.text(x0 + 16, y0 + 31, '', style(32)),
      weather: this.add.text(x0 + 16, y0 + 75, '', style(15, '#e9dfc4')),
      wind: this.add.text(x0 + W - 16, y0 + 75, '', style(15, '#e9dfc4')).setOrigin(1, 0),
      icon: this.add.graphics({ x: x0 + W - 42, y: y0 + 42 }),
      arrow
    };
    this.pillarStrip = new PillarStrip(this, x0, y0 + H + 6, W).onClick(() => openTownLedger(this, this.clock));
    this.mindDot = new MindStatusDot(this, x0 + W - 14, y0 + 14, y0 + H + 4);
    return [bg, ...Object.values(this.hud), ...this.pillarStrip.objects, ...this.mindDot.objects, ...this.buildHintCard(x0, W)];
  }

  // ── The Next hint (story/hint.ts) ──────────────────────────────────────────

  private buildHintCard(x: number, w: number): Phaser.GameObjects.GameObject[] {
    const style = (size: number, color: string, italic = false): Phaser.Types.GameObjects.Text.TextStyle =>
      ({ fontFamily: FAMILY_BODY, fontSize: `${size}px`, color, fontStyle: italic ? 'italic' : 'normal', resolution: RENDER_SCALE, wordWrap: { width: w - 28 } });
    this.hintCard = {
      bg: this.add.graphics(),
      when: this.add.text(x + 14, 0, '', style(13, '#e4c77f')),
      where: this.add.text(x + 14, 0, '', style(16, '#fff0ce')),
      why: this.add.text(x + 14, 0, '', style(14, '#d9cfb4', true)),
      x, w, shown: ''
    };
    const card = this.hintCard;
    for (const o of [card.bg, card.when, card.where, card.why]) o.setVisible(false);
    return [card.bg, card.when, card.where, card.why];
  }

  /** Lay the card out for a hint (only when its text changed) and show or hide it. */
  private showHint(hint: StoryHint | null, visible: boolean): void {
    const card = this.hintCard;
    if (!card) return;
    const on = visible && !!hint;
    // Under the Pillar strip, or where it would be when P has hidden it.
    const top = this.pillarStrip.visible ? 16 + 102 + 6 + 32 + 6 : 16 + 102 + 6;
    const key = on ? `${hint!.text}|${top}` : '';
    if (key !== card.shown) {
      card.shown = key;
      if (on) {
        card.when.setText(`NEXT · ${hint!.when}`).setY(top + 9);
        card.where.setText(hint!.where).setY(card.when.y + card.when.height + 2);
        card.why.setText(hint!.reason).setY(card.where.y + card.where.height + 2);
        const h = card.why.y + card.why.height + 9 - top;
        card.bg.clear().fillStyle(0x28372d, 0.86).fillRoundedRect(card.x, top, card.w, h, 8)
          .lineStyle(1.5, 0xe4c77f, 0.4).strokeRoundedRect(card.x, top, card.w, h, 8);
      }
    }
    for (const o of [card.bg, card.when, card.where, card.why]) o.setVisible(on);
  }

  /** A few times a second: the hint for now, hidden under scenes, dialogue and menus; a toast as a window closes. */
  private refreshHint(): void {
    const covered = HINT_HIDDEN_UNDER.some(key => this.scene.isActive(key));
    const hint = this.story.hint() ?? this.projects.hint();
    // Standing there with the window open: the scene is about to start, nothing to point at.
    const arrived = !!hint && hint.open && this.story.place() === hint.place;
    this.showHint(hint, !covered && !this.transitioning && !arrived);
    if (covered || this.transitioning) return;
    let warned = this.registry.get(WARNED_KEY) as Set<string> | undefined;
    if (!warned) { warned = new Set(); this.registry.set(WARNED_KEY, warned); }
    const toast = closingToast(hint, { day: this.clock.day, minute: this.clock.minute, place: this.story.place() }, warned);
    if (toast) this.showToast(toast);
  }

  private showToast(text: string): void {
    this.tweens.killTweensOf(this.toast);
    this.toast.setText(text).setAlpha(0);
    this.tweens.add({ targets: this.toast, alpha: 1, duration: 300, yoyo: true, hold: 4200, ease: 'Sine.easeInOut' });
  }

  private updateHud(dark: number, overridden: boolean): void {
    const hud = this.hud;
    if (!hud) return;
    hud.date.setText(formatDate(this.clock.time));
    hud.time.setText(formatClock(this.clock.minute));
    hud.weather.setText(`${describeWeather(this.now)}${overridden ? ' (dev)' : ''}`);
    hud.wind.setText(`${this.daily.wind} wind`);
    hud.arrow.setAngle(windToward(this.daily.wind)).setX(hud.wind.x - hud.wind.width - 12);
    this.mindDot?.update(this.time.now);
    const icon = `${this.now.kind}:${dark > 0.5 ? 'night' : 'day'}`;
    if (icon !== this.hudIcon) { this.hudIcon = icon; this.drawWeatherIcon(hud.icon, this.now.kind, dark > 0.5); }
  }

  private drawWeatherIcon(g: Phaser.GameObjects.Graphics, kind: WeatherKind, night: boolean): void {
    g.clear();
    const cloud = (dy: number, color: number) => {
      g.fillStyle(color, 1);
      g.fillCircle(-8, dy + 2, 7).fillCircle(0, dy - 3, 9).fillCircle(9, dy + 2, 7).fillRect(-8, dy + 2, 17, 7);
    };
    switch (kind) {
      case 'sun':
        if (night) {
          g.fillStyle(0xf3e6b0, 1).fillCircle(0, 0, 11);
          g.fillStyle(0x28372d, 1).fillCircle(6, -4, 10);
        } else {
          g.fillStyle(0xffd257, 1).fillCircle(0, 0, 8);
          g.lineStyle(2.5, 0xffd257, 1);
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            g.lineBetween(Math.cos(a) * 11, Math.sin(a) * 11, Math.cos(a) * 15, Math.sin(a) * 15);
          }
        }
        break;
      case 'cloud':
        cloud(0, 0xd8dde4);
        break;
      case 'rain':
        cloud(-5, 0xc3cad4);
        g.lineStyle(2, 0x8cc3ff, 1);
        for (const x of [-7, 0, 7]) g.lineBetween(x + 2, 10, x - 1, 17);
        break;
      case 'fog':
        g.lineStyle(3, 0xd8dde4, 0.95);
        g.lineBetween(-14, -7, 10, -7).lineBetween(-10, 0, 14, 0).lineBetween(-14, 7, 8, 7);
        break;
      case 'wind':
        g.lineStyle(2.5, 0xd8eef0, 1);
        g.lineBetween(-15, -6, 6, -6).lineBetween(-15, 1, 12, 1).lineBetween(-15, 8, 3, 8);
        g.strokeCircle(8, -9, 3).strokeCircle(14, -2, 3);
        break;
      case 'snow':
        cloud(-5, 0xe6ebf2);
        g.fillStyle(0xffffff, 1);
        for (const [x, y] of [[-7, 12], [0, 16], [7, 12]] as const) g.fillCircle(x, y, 2.2);
        break;
    }
  }

  // ── Player ─────────────────────────────────────────────────────────────────

  private syncFigure(): void {
    const p = this.projection.tileToWorld({ x: this.position.x - 0.5, y: this.position.y - 0.5 });
    // Continuous position uses its containing tile's elevation (not the shifted centre coordinate).
    p.y = this.position.y * DIORAMA_TILE_H - this.projection.elevationAt(Math.floor(this.position.x), Math.floor(this.position.y)) * DIORAMA_ELEV_STEP;
    const footY = p.y + DIORAMA_FOOT_DY;
    const moved = p.x !== this.figure.x || footY !== this.figure.y;
    this.figure.setPosition(p.x, footY).setDepth(actorDepth(footY));
    this.shadow.setPosition(p.x, footY);
    if (moved || this.shadowDirty) { this.shadowDirty = false; this.castPlayerShadow(); }
  }
  private followPlayer(): void {
    // Explicit follow uses the patch's top-left zoom pivot and bounds clamp.
    const camera = this.cameras.main;
    // On the town's pixel art, scroll in whole device pixels so no art pixel ever shimmers between widths.
    const snap = this.town ? (v: number) => Math.round(v * RENDER_SCALE) / RENDER_SCALE : (v: number) => v;
    camera.setScroll(snap(camera.clampX(this.figure.x - camera.displayWidth / 2)), snap(camera.clampY(this.figure.y - camera.displayHeight / 2)));
  }
  /** When the town last chose its music (ms of scene time); checked about once a second. */
  private musicCheckedAt = -Infinity;

  /** The town's background music: district by day, morning for the first hour, night after dark. */
  private updateMusic(time: number): void {
    if (time - this.musicCheckedAt < 1000) return;
    this.musicCheckedAt = time;
    if (musicHeld(this)) return;
    const { day, minute } = this.clock;
    getMusic(this).play(ambientTrack({ zone: this.zone.id, day, minute, darkness: darkness(day, minute) }));
  }

  update(time: number, delta: number): void {
    if (recoverScuffle(this, this.clock)) return;
    this.updateMusic(time);
    // Time runs while walking (GDD §5.3); a long frame (a backgrounded tab) doesn't skip the evening.
    const dt = Math.min(delta, 250);
    this.clock.advance(dt);
    this.applyLight();
    this.driftFog(dt);
    this.residents.update(dt, this.position);
    this.projects.update(dt);
    if (this.town) {
      this.town.update(dt, { x: this.figure.x, y: this.figure.y }, this.windVec.strength);
      this.life?.update(dt, { wind: this.windVec, ...this.lightKind });
      if (time - this.lookAt > 1000) { this.lookAt = time; this.town.refresh(this.townLook()); }
      for (const l of this.placeLabels) {
        const d = Math.hypot(this.position.x - l.x, this.position.y - l.y);
        l.text.setAlpha(Math.max(0, Math.min(1, (3.2 - d) / 1.2)));
      }
    }
    if (time - this.hintAt > 250) { this.hintAt = time; this.refreshHint(); }
    if (this.transitioning || !this.keys || this.clock.paused) return;
    const down = (...names: string[]) => names.some(name => this.keys[name]!.isDown) ? 1 : 0;
    const input = { x: down('D', 'RIGHT') - down('A', 'LEFT'), y: down('S', 'DOWN') - down('W', 'UP') };
    const from = this.position;
    const result = movePlayer(this.zone, this.position, input, delta / 1000);
    this.position = result.position;
    // Facing from the keys; walk frames from the distance actually covered (none while pushing a wall).
    this.avatar.step({ intent: input, moved: { x: this.position.x - from.x, y: this.position.y - from.y }, dtMs: dt });
    this.avatar.apply(this.figure);
    this.avatar.apply(this.shadow, false);
    this.syncFigure(); this.followPlayer();
    this.story.update(this.position);
    // Residents take precedence over doors.
    const talk = this.residents.talkTarget(this.position);
    const mark = talk ? undefined : markInteraction(this, this.clock, this.zone, this.position, { weather: this.now.kind, wind: this.daily.wind });
    const place = talk || mark ? undefined : nearbyPlace(this.zone, this.position);
    const economy = place ? (favorInteraction(this.registry, this.clock, `${this.zone.id}.${place.id}`) ?? this.economy.interaction(`${this.zone.id}.${place.id}`)) : null;
    // G-03: a Project's next thing at its site (with the place's own job as a choice), and H's asks beside a resident.
    // Recomputed a few times a second (they read the Projects, the Bag and the flags).
    const cacheKey = `${place?.id ?? ''}|${talk?.id ?? ''}|${economy?.label ?? ''}`;
    if (time - this.projectCache.at > 200 || cacheKey !== this.projectCache.key) {
      this.projectCache = { at: time, key: cacheKey,
        project: place ? this.projects.interaction(`${this.zone.id}.${place.id}`, economy) : null,
        ask: talk ? this.projects.ask(talk.id) : null };
    }
    const project = place ? this.projectCache.project : null;
    this.askAction = talk ? this.projectCache.ask : null;
    const puzzle = place ? puzzleInteraction(this, this.clock, `${this.zone.id}.${place.id}`, project) : null;
    const scuffle = !talk && !mark ? scuffleInteraction(this, this.clock, this.zone, this.position) : null;
    this.prompt.setText(scuffle ? `E: ${scuffle.label}` : talk ? `E: Talk to ${talk.name}${this.askAction ? '  ·  H: Ask about the Projects' : ''}` : mark ? 'E: Read the plaque' : place ? `E: ${puzzle?.label ?? project?.label ?? placeName(place.id)}` : '').setVisible(!!scuffle || !!talk || !!mark || !!place);
    this.interact = scuffle?.run ?? (talk ? () => this.residents.requestTalk(talk.id) : mark ?? (place ? puzzle?.run ?? project?.run ?? (() => console.log(`${this.zone.id}.${place.id}`)) : undefined));
    if (result.edge) {
      this.transitioning = true;
      const edge = result.edge;
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ zone: edge.zone, arrive: edge.arrive }));
      this.cameras.main.fadeOut(400);
    }
  }
}
