import Phaser from 'phaser';
import type { ZoneDef, TownBuilding, TownProp, Point } from '../../world/zoneFormat';
import { TOWN_MANIFEST, metaOf, resolveState, spriteFile, type Restorable, type SpriteState, type TownLook } from '../../world/townSprites';
import { buildingHomes, isLit } from '../../town/occupancy';
import { homeDirectory } from '../../world/homes';
import { LINE_GEOMETRY, LINE_SPRITES, lineMasks, paintLine, type LineKind } from './lineArt';
import { letter, type LetterStyle } from './lettering';
import { BEAM_HALF_ANGLE, beamHeading, beamHit, beamOnScreen, headingTo } from './beam';
import { TERRAIN_INFO } from '../../world/townTerrain';
import { KIND_ID, TH, TW, groundMap } from './autotile';
import { bakeChunk, bakeContext, type BakeContext } from './terrainBake';
import { RIPPLE_H, RIPPLE_W, flowVelocity, ripplePattern, swell, waterStyle, type WaterStyle } from './water';
import { detectWindows } from './windows';
import { DEPTH, actorDepth, terrainDepth } from '../depth';
import { DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH } from '../dioramaConfig';
import { addTorchGlow } from '../diorama/Lighting';
import { ensureDotTexture } from '../diorama/Atmosphere';
import { SUN, castFrom, shadeTint, torchShadow, type Sun } from '../sun';
import type { ObliqueProjection } from '../ObliqueProjection';
import { boxShadow, buildingHeight, insidePolygon, lineRects, sunShear, type GroundRect, type Pt, type Shear } from './castShadow';
import { boardSpriteFiles, prefetchOrder } from '../../world/boardAssets';
import { preloadTexture, textureFetch, type TextureSpec } from '../../boot/textureFetch';

// ─────────────────────────────────────────────────────────────────────────────
// The town board (GDD §16.4): a v2 zone drawn as a lived-in place on the ¾ diorama.
//
//   ground     baked once per zone and session into chunk textures (terrainBake.ts: materials, autotiled
//              edges, banks, faces, the slab), the chunks round the camera first and the rest a chunk a frame
//   water      under the ground: the baked floor, a per-tile layer of moving crests (four small textures
//              per style, redrawn ten times a second, scrolling downstream or with the swell), foam that laps
//   sprites    every building and prop a billboard on its anchor (bottom-centre on the footprint's front
//              edge, or the base tile's middle), depth-sorted with the people by that ground line, culled
//              to the camera; buildings and tall props fade to 35% while the player is behind them
//   shadows    a soft contact shadow under every prop and the footprint's under every building (ambient light, so
//              day and night), the walls darkening toward the ground; the sun's shadow from the clock, all of it on
//              one layer so two shadows that overlap are no darker (castShadow.ts: props shear their silhouette
//              about the foot, buildings, hedges and walls throw a box's), redrawn when the sun has moved a few
//              degrees; inShade() tells the people who stands in it (and small props in a building's shadow take the
//              shade); a building's corner toward the sun catches it, the far one turns into shade; lamps throw
//              shadows at night
//   night      lamp posts are lights (a pool on the ground, a halo at the head, a steady flicker); lived-in
//              buildings get their windows lit (found in the art, windows.ts) and a pool at the door
//   state      faded or restored art per townSprites.resolveState, swapped in place when the town changes;
//              who is home per town/occupancy.ts (lights and smoke only where someone lives)
//   lines      hedges, low walls and fences drawn as autotiled runs (lineArt.ts), a billboard per cell
//   lettering  datestones, signs, door numbers and boats' names set in a pixel font over the art (lettering.ts)
//   marks      Monde's Marks (§14.1) are props with `mark:`; setMarkVisible() shows or hides each plaque
//   beam       a relit lighthouse sweeps a slow beam over the sea at night (beam.ts); a steady glow if reduced
//
// Everything is created in the constructor (ZoneScene snapshots the world's objects for its UI camera
// straight after), and only re-textured, moved or shown afterwards.
// ─────────────────────────────────────────────────────────────────────────────

export const townTexture = (file: string): string => `town:${file}`;

/** A town sprite file's texture and where it lives. */
export const townSprite = (file: string): TextureSpec => ({ key: townTexture(file), url: `${import.meta.env.BASE_URL}assets/town/${file}.png` });

/**
 * Queue the sprites this board draws (world/boardAssets.ts), not the whole town's: cheap after the first time, since
 * textures persist across scene restarts, and the rest arrive in idle time (prefetchTownSprites). Idle fetches wait
 * while the board loads.
 */
export function preloadTownSprites(scene: Phaser.Scene, zone: ZoneDef): void {
  const fetcher = textureFetch(scene);
  const specs = boardSpriteFiles(zone).map(townSprite);
  const flying = fetcher.claim(specs.map(spec => spec.key));
  for (const spec of specs) preloadTexture(scene, spec, flying);
  const release = fetcher.hold();
  scene.load.once(Phaser.Loader.Events.COMPLETE, release);
  scene.events.once(Phaser.Scenes.Events.CREATE, release);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, release);
}

/** Fetch these boards' sprites in idle time, these boards first and then the rest nearest first, in place of any earlier list. */
export function prefetchTownSprites(scene: Phaser.Scene, boards: Readonly<Record<string, ZoneDef>>, links: ReadonlyMap<string, readonly string[]>, ...first: string[]): void {
  const ids = [...new Set([...first, ...prefetchOrder(first[0]!, boards, links)])];
  textureFetch(scene).prefetch(ids.flatMap(id => (boards[id] ? boardSpriteFiles(boards[id]) : [])).map(townSprite));
}

const NEAREST = Phaser.Textures.FilterMode.NEAREST;
const crisp = (scene: Phaser.Scene, key: string): string => {
  if (scene.textures.exists(key)) scene.textures.get(key).setFilter(NEAREST);
  return key;
};

/** Chunk size, tiles. */
const CHUNK_W = 8;
const CHUNK_H = 6;
/** Seen-through alpha for whatever stands between the camera and the player (§16.4). */
const FADED_ALPHA = 0.35;
/** Depths inside the terrain band: the water's layers under every land chunk. */
const WATER_DEPTH = DEPTH.TERRAIN - 0.003;
const RIPPLE_DEPTH = DEPTH.TERRAIN - 0.002;
const FOAM_DEPTH = DEPTH.TERRAIN - 0.001;
/** Lights that must shine through the night layer (window panes, lamp heads). */
const OVER_NIGHT = DEPTH.DARKNESS + 0.3;
const RIPPLE_FPS = 12;
/** The lighthouse's lantern room, px from its sprite's top-left (read off the art). */
const LANTERN: readonly [number, number] = [61, 62];
/** How far the beam reaches across the board, world px (art tuning: the harbour and the quay). */
const BEAM_LENGTH = 1100;
const BEAM_TEX_W = 512;
const BEAM_TEX_H = 192;
/** Ambient occlusion round a building's footprint: how far it spreads (px) and how dark it is at the wall. Art tuning. */
const FOOT_AO_SPREAD = 14;
const FOOT_AO_ALPHA = 0.36;
/** The walls darken toward the ground over this many px, to this alpha at the foot. Art tuning. */
const WALL_AO_PX = 14;
const WALL_AO_ALPHA = 0.3;
/** A prop's depth north to south for its shadow, as a share of its width (a tree's crown is about as deep as wide). */
const PROP_DEPTH = 0.6;
/**
 * The sun along a building's side edges: the corner toward the sun catches it (warm light added), the far corner
 * turns into shade, most strongly with the sun low in the east or west and not at all at noon. Art tuning.
 */
const RIM_LIT = 0.34;
const RIM_DARK = 0.22;
const RIM_TINT = 0xffe2b0;

/**
 * A footprint's ambient occlusion: black under the footprint, fading out FOOT_AO_SPREAD px past its edges (less
 * across the foreshortened ground north and south). Made once per size.
 */
function ensureFootTexture(scene: Phaser.Scene, w: number, d: number): string {
  const key = `town:footao:${w}x${d}`;
  if (scene.textures.exists(key)) return key;
  const pad = FOOT_AO_SPREAD, tw = w + pad * 2, th = d + pad * 2, tex = scene.textures.createCanvas(key, tw, th)!;
  const img = new ImageData(tw, th), aspect = TW / TH;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const dx = Math.max(0, pad - x - 0.5, x + 0.5 - (pad + w)), dy = Math.max(0, pad - y - 0.5, y + 0.5 - (pad + d)) * aspect;
    const t = Math.max(0, 1 - Math.hypot(dx, dy) / pad);
    img.data[(y * tw + x) * 4 + 3] = Math.round(255 * t * t);
  }
  tex.getContext().putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

/** A long soft wedge of light, brightest at its root: the beam's texture (made once). */
function ensureBeamTexture(scene: Phaser.Scene): string {
  const key = 'town:beam';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, BEAM_TEX_W, BEAM_TEX_H)!;
  const c = tex.getContext();
  const img = c.createImageData(BEAM_TEX_W, BEAM_TEX_H);
  for (let x = 0; x < BEAM_TEX_W; x++) {
    const t = x / BEAM_TEX_W;
    const half = 5 + t * (BEAM_TEX_H / 2 - 7);
    const along = Math.pow(1 - t, 1.15) * (t < 0.03 ? t / 0.03 : 1);
    for (let y = 0; y < BEAM_TEX_H; y++) {
      const d = Math.abs(y - BEAM_TEX_H / 2) / half;
      if (d >= 1) continue;
      // A bright core in a soft cone.
      const a = along * (0.6 * Math.pow(1 - d, 0.9) + 0.4 * Math.pow(Math.max(0, 1 - d * 2.2), 2));
      const i = (y * BEAM_TEX_W + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 236; img.data[i + 2] = 176; img.data[i + 3] = Math.round(255 * a);
    }
  }
  c.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * The world rectangle a camera shows. Not `camera.worldView`: util/renderScale zooms every camera about its
 * top-left, and worldView assumes Phaser's centre pivot.
 */
export function cameraView(cam: Phaser.Cameras.Scene2D.Camera): Rect {
  const w = cam.width / cam.zoom, h = cam.height / cam.zoom;
  return { x0: cam.scrollX, y0: cam.scrollY, x1: cam.scrollX + w, y1: cam.scrollY + h };
}
const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** One sprite on the board. */
export interface Billboard {
  img: Phaser.GameObjects.Image;
  sprite: string;
  kind: 'building' | 'prop';
  /** The ground point it stands on (world px). */
  x: number;
  baseY: number;
  bounds: Rect;
  fade: boolean;
  alpha: number;
  restorable: Restorable;
  state: SpriteState;
  lived: boolean;
  flip: boolean;
  /** Throws a sun shadow on the board's shadow layer: a building or a hedge a box's, a prop its sheared silhouette. */
  casts: boolean;
  /** Buildings: the ground under the box that throws the shadow (world px), and its height. */
  foot?: GroundRect;
  height?: number;
  /** Buildings: the walls darkening toward the ground (rides with the billboard's fade). */
  ao: Phaser.GameObjects.Image | null;
  /** Buildings: the sunlit and the shaded side edge (render/town: RIM_LIT, RIM_DARK). */
  rim: { lit: Phaser.GameObjects.Image; dark: Phaser.GameObjects.Image } | null;
  /** A small prop standing in a building's shadow (it takes the shade, as the people do). */
  shaded: boolean;
  lampShadow: { img: Phaser.GameObjects.Image; alpha: number } | null;
  windows: Phaser.GameObjects.Image | null;
  contact: Phaser.GameObjects.Image | null;
  sway: number;
  phase: number;
  /** Buildings: the place it is (for door pools). */
  door?: Point;
  /** Chimney tops, world px (lived-in buildings smoke from them). */
  chimneys: [number, number][];
  /** Buildings: the homes inside, `zone.home` (town/occupancy.ts). */
  homes: string[];
  /** Lettering, datestones and the like riding on this billboard (they follow its fade and visibility). */
  extras: Phaser.GameObjects.Image[];
  /** The Monde's Mark this plaque is. */
  mark?: string;
  /** Hidden by the riddle system (a Mark not yet revealed). */
  hidden: boolean;
  /** Drawn this many px above where it stands (a lantern hung on a room's back wall). */
  lift: number;
}

/** A cell of a hedge, wall or fence run. */
interface LineCell { img: Phaser.GameObjects.Image; rect: Rect; kind: LineKind; ground: GroundRect[] }
/** A silhouette sheared along the ground: texture key, the foot's position in it and its size (px). */
interface Sheared { key: string; ox: number; oy: number; w: number; h: number }
/** A shadow just cast, for inShade(): a building's polygon (and how tall the building is), or a prop's sheared silhouette. */
interface Shade { box: Rect; poly?: Pt[]; height?: number; prop?: { bill: Billboard; sweep: number } }

interface Chunk { tx0: number; ty0: number; tx1: number; ty1: number; images: Phaser.GameObjects.Image[]; foam: Phaser.GameObjects.Image[]; done: boolean; rect: Rect }
interface ChunkMeta { x: number; y: number; w: number; h: number; water: boolean; foam: boolean }
/** Sprite pixels and their window glow, per texture file, read once a session. */
const spritePixels = new Map<string, ImageData | null>();
const windowGlow = new Map<string, Uint8ClampedArray>();
/** Baked chunk geometry per zone (the textures themselves live in the texture manager). */
const bakedMeta = new Map<string, (ChunkMeta | null)[]>();

interface RippleStyle { key: string; ctx: CanvasRenderingContext2D; tex: Phaser.Textures.CanvasTexture; layers: HTMLCanvasElement[]; images: Phaser.GameObjects.Image[] }

export interface LightEnv {
  sun: Sun;
  /** 0..1 how far the lamps are on. */
  lampLevel: number;
  /** 0..1 night. */
  dark: number;
}

export interface TownBoardOptions {
  zone: ZoneDef;
  projection: ObliqueProjection;
  seed: number;
  look: TownLook;
  /** Where the camera starts (world px): the chunks round it bake first. */
  focus: { x: number; y: number };
  /** Reduced motion: nothing sways, the water moves slowly. */
  reduced?: boolean;
}

export class TownBoard {
  readonly billboards: Billboard[] = [];
  /** Lamp posts: positions for the night layer and the player's lamp shadow. */
  readonly lights: { x: number; y: number; radius: number }[] = [];
  /** Lamp pools and heads, switched by ZoneScene at dusk. */
  readonly lampGlows: Phaser.GameObjects.Image[] = [];
  /** Lit doorways of lived-in buildings, switched with the lamps. */
  readonly doorGlows: Phaser.GameObjects.Image[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly ripples = new Map<WaterStyle, RippleStyle>();
  private readonly waterImages: { img: Phaser.GameObjects.Image; rect: Rect }[] = [];
  private readonly lampHeads: { img: Phaser.GameObjects.Image; phase: number; base: number }[] = [];
  private readonly lamps: { bill: Billboard; head: Phaser.GameObjects.Image }[] = [];
  private readonly lineCells: LineCell[] = [];
  /** The lighthouse's beam, its lantern glow and the stones that answer it (WF-5). */
  private beam: { bill: Billboard; ray: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; x: number; y: number;
    stones: { flash: Phaser.GameObjects.Image; heading: number }[] } | null = null;
  private readonly ctx: BakeContext;
  private readonly zoneKey: string;
  /** Every sun shadow on one layer at the sun's alpha, so where two overlap the ground is no darker. */
  private readonly sunLayer: Phaser.GameObjects.RenderTexture;
  private readonly sunPen: Phaser.GameObjects.Graphics;
  private readonly layerAt: { x: number; y: number };
  private shades: Shade[] = [];
  private sunShape: { angle: number; squash: number } | null = null;
  /** Which screen side the sun lights the buildings from (−1 left, 1 right, 0 not yet), and how strongly (0..1). */
  private rimSide = 0;
  private rimLevel = 0;
  private time = 0;
  private rippleClock = 0;
  private lastSun = '';
  private lampLevel = 0;
  private sunAlpha = 0;
  private wind = 0;
  /** Recomputed when the town changes: the art each restorable sprite shows. */
  private lookKey = '';

  constructor(private readonly scene: Phaser.Scene, private readonly opts: TownBoardOptions) {
    const { zone, projection } = opts;
    this.zoneKey = `${zone.id}:${opts.seed}`;
    const tile = (x: number, y: number) => zone.tiles[y * zone.width + x]!;
    this.ctx = bakeContext(groundMap(zone.width, zone.height, (x, y) => tile(x, y).kind!, (x, y) => projection.elevationAt(x, y)),
      { seed: opts.seed, elevStep: DIORAMA_ELEV_STEP, slab: DIORAMA_SLAB_DEPTH, ...(zone.interior ? { room: zone.interior.room } : {}) });
    // The board's own shadow on the world.
    const b = projection.bounds();
    scene.add.image(b.x + b.w / 2, b.y + b.h + 6, ensureDotTexture(scene)).setTint(0x000000).setAlpha(0.7)
      .setDisplaySize(b.w * 1.22, Math.max(70, b.h * 0.26)).setDepth(DEPTH.BOARD_SHADOW);
    // The sun's shadows, clipped to the board: off its edge there is no ground to fall on.
    this.layerAt = { x: Math.floor(b.x), y: Math.floor(b.y) };
    this.sunLayer = scene.add.renderTexture(this.layerAt.x, this.layerAt.y, Math.ceil(b.w) + 1, Math.ceil(b.h) + 1)
      .setOrigin(0, 0).setDepth(DEPTH.SHADOW - 0.1).setVisible(false);
    this.sunPen = scene.make.graphics({}, false);
    this.buildGround();
    this.buildWater();
    const town = zone.town!;
    for (const building of town.buildings) this.addBuilding(building);
    const lines: { prop: TownProp; kind: LineKind }[] = [];
    for (const prop of town.props) {
      const kind = LINE_SPRITES[prop.sprite];
      if (kind) lines.push({ prop, kind }); else this.addProp(prop);
    }
    this.addLines(lines);
    this.buildBeam();
    this.refresh(opts.look, true);
    this.hideCoveredLamps();
  }

  // ── Ground ────────────────────────────────────────────────────────────────

  private buildGround(): void {
    const { zone } = this.opts;
    const meta = bakedMeta.get(this.zoneKey) ?? [];
    bakedMeta.set(this.zoneKey, meta);
    let n = 0;
    for (let ty = 0; ty < zone.height; ty += CHUNK_H) for (let tx = 0; tx < zone.width; tx += CHUNK_W) {
      const tx1 = Math.min(zone.width, tx + CHUNK_W), ty1 = Math.min(zone.height, ty + CHUNK_H);
      const rect = { x0: tx * TW, x1: tx1 * TW, y0: ty * TH - 3 * DIORAMA_ELEV_STEP, y1: ty1 * TH + 3 * DIORAMA_ELEV_STEP + DIORAMA_SLAB_DEPTH };
      const chunk: Chunk = { tx0: tx, ty0: ty, tx1, ty1, images: [], foam: [], done: false, rect };
      this.chunks.push(chunk);
      if (meta[n]) this.showChunk(n, meta[n]!);
      n++;
    }
    // The chunks the camera starts on, now; the rest while the browser is idle, nearest the player first.
    const view = this.view(this.opts.focus.x, this.opts.focus.y);
    this.chunks.forEach((c, i) => { if (!c.done && overlaps(c.rect, view)) this.bake(i); });
    this.player = { ...this.opts.focus };
    this.scheduleIdleBake();
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.alive = false; });
  }

  private alive = true;
  private player = { x: 0, y: 0 };

  private view(cx: number, cy: number): Rect {
    const cam = this.scene.cameras.main;
    const w = (cam.width / cam.zoom) / 2 + 100, h = (cam.height / cam.zoom) / 2 + 100;
    return { x0: cx - w, x1: cx + w, y0: cy - h, y1: cy + h };
  }

  /** The unbaked chunk nearest the player, or -1. */
  private nextChunk(): number {
    let next = -1, best = Infinity;
    this.chunks.forEach((c, i) => {
      if (c.done) return;
      const d = Math.hypot((c.rect.x0 + c.rect.x1) / 2 - this.player.x, (c.rect.y0 + c.rect.y1) / 2 - this.player.y);
      if (d < best) { best = d; next = i; }
    });
    return next;
  }

  /** Bake the rest of the ground between frames, a chunk at a time, while the browser has nothing else to do. */
  private scheduleIdleBake(): void {
    if (!this.alive || this.nextChunk() < 0) return;
    const idle = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number; didTimeout: boolean }) => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const run = (deadline?: { timeRemaining(): number; didTimeout: boolean }) => {
      if (!this.alive) return;
      do {
        const next = this.nextChunk();
        if (next < 0) return;
        this.bake(next);
      } while (deadline && deadline.timeRemaining() > 14);
      this.scheduleIdleBake();
    };
    if (idle) idle(run, { timeout: 250 }); else setTimeout(run, 16);
  }

  /** Dev numbers: how long the ground took to bake (ms), chunk by chunk. */
  static readonly bakeLog: { zone: string; chunk: number; ms: number }[] = [];

  private bake(i: number): void {
    const c = this.chunks[i]!;
    const t0 = performance.now();
    const baked = bakeChunk(this.ctx, c.tx0, c.ty0, c.tx1, c.ty1);
    const key = (layer: string) => `townground:${this.zoneKey}:${i}:${layer}`;
    const upload = (k: string, buf: Uint8ClampedArray) => {
      if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
      const tex = this.scene.textures.createCanvas(k, baked.w, baked.h);
      if (!tex) return;
      tex.getContext().putImageData(new ImageData(buf as Uint8ClampedArray<ArrayBuffer>, baked.w, baked.h), 0, 0);
      tex.refresh();
      tex.setFilter(NEAREST);
    };
    upload(key('land'), baked.land);
    if (baked.water) upload(key('water'), baked.water);
    if (baked.foam) { upload(key('foamA'), baked.foam[0]); upload(key('foamB'), baked.foam[1]); }
    const meta: ChunkMeta = { x: baked.x, y: baked.y, w: baked.w, h: baked.h, water: !!baked.water, foam: !!baked.foam };
    bakedMeta.get(this.zoneKey)![i] = meta;
    this.showChunk(i, meta);
    TownBoard.bakeLog.push({ zone: this.zoneKey, chunk: i, ms: Math.round(performance.now() - t0) });
  }

  /**
   * Objects made after ZoneScene's create (ground baked in idle time, windows lit later) belong to the world
   * camera only: the scene's UI camera ignores the world's objects by a snapshot taken at create.
   */
  private worldOnly<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    for (const cam of this.scene.cameras.cameras) if (cam !== this.scene.cameras.main) cam.ignore(obj);
    return obj;
  }

  private showChunk(i: number, meta: ChunkMeta): void {
    const c = this.chunks[i]!;
    const key = (layer: string) => `townground:${this.zoneKey}:${i}:${layer}`;
    const add = (layer: string, depth: number) => this.worldOnly(this.scene.add.image(meta.x, meta.y, key(layer)).setOrigin(0, 0).setDepth(depth));
    c.images.push(add('land', terrainDepth(c.ty0)));
    if (meta.water) c.images.push(add('water', WATER_DEPTH));
    if (meta.foam) c.foam.push(add('foamA', FOAM_DEPTH).setAlpha(0.6), add('foamB', FOAM_DEPTH + 1e-5).setAlpha(0.4));
    c.rect = { x0: meta.x, x1: meta.x + meta.w, y0: meta.y, y1: meta.y + meta.h };
    c.done = true;
  }

  // ── Water ─────────────────────────────────────────────────────────────────

  private buildWater(): void {
    const { zone, projection } = this.opts;
    for (let y = 0; y < zone.height; y++) for (let x = 0; x < zone.width; x++) {
      const t = zone.tiles[y * zone.width + x]!;
      const style = waterStyle(t.kind!, t.flow);
      if (!style) continue;
      const r = this.rippleStyle(style);
      const top = projection.topFace({ x, y });
      const img = this.scene.add.image(top.x, top.y, r.key, `${x & 3},${y & 3}`).setOrigin(0, 0).setDepth(RIPPLE_DEPTH);
      r.images.push(img);
      this.waterImages.push({ img, rect: { x0: top.x, x1: top.x + TW, y0: top.y, y1: top.y + TH } });
    }
    this.drawRipples();
  }

  private rippleStyle(style: WaterStyle): RippleStyle {
    let r = this.ripples.get(style);
    if (r) return r;
    const key = `townripple:${style}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, RIPPLE_W, RIPPLE_H)!;
    tex.setFilter(NEAREST);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) tex.add(`${fx},${fy}`, 0, fx * TW, fy * TH, TW, TH);
    const layers = (style === 'sea' || style === 'shallows' ? [0, 1] : [0]).map(layer => {
      const canvas = document.createElement('canvas');
      canvas.width = RIPPLE_W; canvas.height = RIPPLE_H;
      canvas.getContext('2d')!.putImageData(new ImageData(ripplePattern(style, this.opts.seed, layer) as Uint8ClampedArray<ArrayBuffer>, RIPPLE_W, RIPPLE_H), 0, 0);
      return canvas;
    });
    r = { key, ctx: tex.getContext(), tex, layers, images: [] };
    this.ripples.set(style, r);
    return r;
  }

  /** Redraw each style's crests at this moment's offset (wrapping the seamless pattern). */
  private drawRipples(): void {
    // Reduced motion: the water drifts at a third of the pace.
    const t = this.time * (this.opts.reduced ? 0.35 : 1);
    for (const [style, r] of this.ripples) {
      if (!r.images.some(img => img.visible)) continue;
      const ctx = r.ctx;
      ctx.clearRect(0, 0, RIPPLE_W, RIPPLE_H);
      const sw = style === 'sea' || style === 'shallows' ? swell(t) : { dy: 0, light: 1 };
      r.layers.forEach((layer, i) => {
        const [vx, vy] = flowVelocity(style, i);
        const ox = ((Math.round(vx * t) % RIPPLE_W) + RIPPLE_W) % RIPPLE_W;
        const oy = ((Math.round(vy * t + sw.dy * (i ? -1 : 1)) % RIPPLE_H) + RIPPLE_H) % RIPPLE_H;
        ctx.globalAlpha = sw.light * (i ? 0.8 : 1);
        for (const dx of [ox - RIPPLE_W, ox]) for (const dy of [oy - RIPPLE_H, oy]) ctx.drawImage(layer, dx, dy);
      });
      ctx.globalAlpha = 1;
      r.tex.refresh();
    }
  }

  // ── Sprites ───────────────────────────────────────────────────────────────

  private groundY(x: number, y: number): number {
    return y * TH - this.opts.projection.elevationAt(x, Math.min(y, this.opts.zone.height - 1)) * DIORAMA_ELEV_STEP;
  }

  private addBuilding(b: TownBuilding): void {
    const x = (b.at[0] + b.foot[0] / 2) * TW;
    const baseY = this.groundY(b.at[0], b.at[1] + b.foot[1] - 1) + TH;
    const homes = buildingHomes(this.opts.zone.id, b, homeDirectory);
    // Scenery has no door in the zone file; its drawn door (the meta's column) still gets a light when lived in.
    const meta = metaOf(b.sprite);
    const col = meta.door ?? Math.floor(b.foot[0] / 2);
    const door: Point = b.door ?? [b.at[0] + (b.flip ? b.foot[0] - 1 - col : col), b.at[1] + b.foot[1]];
    // The box that throws its shadow: as wide as the walls are drawn, as deep as the footprint (render/town/castShadow).
    const art = TOWN_MANIFEST[b.sprite]!, depth = b.foot[1] * TH, half = (art.w * 0.94) / 2;
    const foot = { x0: x - half, y0: baseY - depth, x1: x + half, y1: baseY };
    const bill = this.addBillboard({ sprite: b.sprite, kind: 'building', x, baseY, flip: b.flip, foot, height: buildingHeight(art.h, depth),
      restorable: { ...(b.id ? { id: b.id } : {}), sprite: b.sprite, state: b.state, ...(b.project ? { project: b.project } : {}), homes }, door, fade: true, homes });
    if (b.datestone !== undefined && meta.lintel) {
      if (!meta.lintel.plain) {
        this.extraAt(bill, townTexture('datestone'), meta.lintel.x, meta.lintel.y, 1e-7);
        const panel = metaOf('datestone').letter!, art = TOWN_MANIFEST.datestone!;
        this.letterAt(bill, String(b.datestone), panel.style, meta.lintel.x - art.w / 2 + panel.x, meta.lintel.y - art.h / 2 + panel.y, 2e-7);
      } else this.letterAt(bill, String(b.datestone), 'carved', meta.lintel.x, meta.lintel.y, 2e-7);
    }
    if (b.sign !== undefined && meta.sign) this.letterAt(bill, b.sign, meta.sign.style, meta.sign.x, meta.sign.y, 2e-7);
    if (b.number !== undefined && meta.plate) this.letterAt(bill, String(b.number), 'plate', meta.plate[0], meta.plate[1], 2e-7);
  }

  private addProp(p: TownProp): void {
    const meta = metaOf(p.sprite);
    const x = (p.at[0] + 0.5) * TW + p.dx;
    const baseY = this.groundY(p.at[0], p.at[1]) + TH / 2 + p.dy;
    const bill = this.addBillboard({ sprite: p.sprite, kind: 'prop', x, baseY, lift: p.lift, flip: p.flip, restorable: { sprite: p.sprite, state: p.state, ...(p.project ? { project: p.project } : {}) }, fade: !!meta.fade });
    if (p.mark) bill.mark = p.mark;
    if (p.text !== undefined && meta.letter) {
      this.letterAt(bill, p.text, meta.letter.style, meta.letter.x, meta.letter.y, 2e-7);
    }
  }

  /** A sprite riding on a billboard, centred on (sx, sy) in the billboard's own art px (flips with it). */
  private extraAt(bill: Billboard, key: string, sx: number, sy: number, depth: number): Phaser.GameObjects.Image {
    const art = TOWN_MANIFEST[bill.sprite]!;
    const left = bill.img.x - art.w / 2, top = bill.img.y - art.h;
    const x = left + (bill.flip ? art.w - sx : sx);
    const img = this.scene.add.image(Math.round(x), Math.round(top + sy), crisp(this.scene, key)).setDepth(bill.img.depth + depth);
    bill.extras.push(img);
    return img;
  }

  /** Words set in the pixel font on a billboard's panel (lettering.ts), crisp and exact. */
  private letterAt(bill: Billboard, text: string, style: LetterStyle, sx: number, sy: number, depth: number): void {
    const key = `townletter:${style}:${text}`;
    if (!this.scene.textures.exists(key)) {
      const l = letter(text, style);
      const tex = this.scene.textures.createCanvas(key, l.w, l.h);
      if (!tex) return;
      tex.getContext().putImageData(new ImageData(l.rgba as Uint8ClampedArray<ArrayBuffer>, l.w, l.h), 0, 0);
      tex.refresh();
    }
    // Text never mirrors: a flipped sign keeps its words readable.
    const art = TOWN_MANIFEST[bill.sprite]!;
    const img = this.scene.add.image(0, 0, crisp(this.scene, key)).setDepth(bill.img.depth + depth);
    const left = bill.img.x - art.w / 2, top = bill.img.y - art.h;
    const w = img.width, h = img.height, x = bill.flip ? art.w - sx : sx;
    img.setPosition(Math.round(left + x - w / 2) + w / 2, Math.round(top + sy - h / 2) + h / 2);
    bill.extras.push(img);
  }

  /** Hedges, low walls and fences: autotiled runs, one billboard per cell (lineArt.ts). */
  private addLines(lines: readonly { prop: TownProp; kind: LineKind }[]): void {
    const groups = new Map<string, { prop: TownProp; kind: LineKind }[]>();
    for (const l of lines) {
      const key = `${l.kind}:${l.prop.dx}:${l.prop.dy}`;
      groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    for (const group of groups.values()) {
      const masks = lineMasks(group.map(l => l.prop.at));
      group.forEach(({ prop, kind }, i) => {
        const [cx, cy] = prop.at;
        const key = `townline:${this.opts.zone.id}:${kind}:${masks[i]}:${cx},${cy}:${prop.dx},${prop.dy}`;
        const piece = paintLine(kind, masks[i]!, cx, cy, this.opts.seed);
        if (!this.scene.textures.exists(key)) {
          const tex = this.scene.textures.createCanvas(key, piece.w, piece.h);
          if (!tex) return;
          tex.getContext().putImageData(new ImageData(piece.rgba as Uint8ClampedArray<ArrayBuffer>, piece.w, piece.h), 0, 0);
          tex.refresh();
        }
        const gx = cx * TW + prop.dx + piece.ox, gy = this.groundY(cx, cy) + prop.dy + piece.oy;
        const img = this.scene.add.image(gx, gy, crisp(this.scene, key)).setOrigin(0, 0)
          .setDepth(actorDepth(this.groundY(cx, cy) + prop.dy + piece.foot) - 1e-6);
        const left = cx * TW + prop.dx, top = this.groundY(cx, cy) + prop.dy;
        const ground = lineRects(kind, masks[i]!).map(r => ({ x0: left + r.x0, y0: top + r.y0, x1: left + r.x1, y1: top + r.y1 }));
        this.lineCells.push({ img, rect: { x0: gx, x1: gx + piece.w, y0: gy, y1: gy + piece.h }, kind, ground });
      });
    }
  }

  private addBillboard(o: { sprite: string; kind: 'building' | 'prop'; x: number; baseY: number; lift?: number; flip: boolean; restorable: Restorable; door?: Point; fade: boolean; homes?: string[]; foot?: GroundRect; height?: number }): Billboard {
    const scene = this.scene, meta = metaOf(o.sprite), art = TOWN_MANIFEST[o.sprite]!;
    const lift = (meta.overhead ?? 0) + (o.lift ?? 0);
    const img = scene.add.image(o.x, o.baseY - lift, crisp(scene, townTexture(o.sprite))).setOrigin(0.5, 1).setFlipX(o.flip);
    // Overhead things (bunting) hang over the people; the footbridge and lilies lie under them.
    img.setDepth(meta.overhead ? DEPTH.UNIT_HUD - 0.5 : meta.under ? DEPTH.TERRAIN_FX + (meta.water ? 0 : 0.01) : actorDepth(o.baseY) - 1e-6);
    const bounds = { x0: o.x - art.w / 2, x1: o.x + art.w / 2, y0: o.baseY - lift - art.h, y1: o.baseY - lift + 4 };
    // The ground it stands on darkens a little round its foot; a building's all round its footprint, which shows past
    // its walls on either side how deep it runs.
    let contact: Phaser.GameObjects.Image | null = null;
    if (o.foot) {
      const w = Math.round(o.foot.x1 - o.foot.x0), d = Math.round(o.foot.y1 - o.foot.y0);
      contact = scene.add.image(o.foot.x0 - FOOT_AO_SPREAD, o.foot.y0 - FOOT_AO_SPREAD, ensureFootTexture(scene, w, d))
        .setOrigin(0, 0).setAlpha(FOOT_AO_ALPHA).setDepth(DEPTH.SHADOW - 0.05);
    } else if (!meta.flat && !meta.water && !meta.under) {
      const [bw] = meta.block ?? [1, 1];
      contact = scene.add.image(o.x, o.baseY - 1, ensureDotTexture(scene)).setTint(0x000000)
        .setAlpha(0.3).setDisplaySize(Math.min(art.w, Math.max(1, bw) * TW) * 0.8, 8).setDepth(DEPTH.SHADOW - 0.05);
    }
    const ao = o.foot ? scene.add.image(img.x, img.y, this.wallShade(o.sprite, 'restored')).setOrigin(0.5, 1).setFlipX(o.flip).setDepth(img.depth + 5e-8) : null;
    const edge = (depth: number) => scene.add.image(img.x, img.y, this.rimEdge(o.sprite, 'restored', 1)).setOrigin(0.5, 1).setDepth(img.depth + depth).setVisible(false);
    const rim = o.foot ? { lit: edge(6e-8).setBlendMode(Phaser.BlendModes.ADD).setTint(RIM_TINT), dark: edge(7e-8).setTintFill(0x000000) } : null;
    const bill: Billboard = {
      img, sprite: o.sprite, kind: o.kind, x: o.x, baseY: o.baseY, bounds, fade: o.fade, alpha: 1,
      restorable: o.restorable, state: 'restored', lived: false, flip: o.flip, lampShadow: null, ao, rim, shaded: false,
      casts: !(meta.flat || meta.water || meta.overhead || meta.under || o.lift), ...(o.foot ? { foot: o.foot, height: o.height } : {}),
      windows: null, contact, sway: meta.sway ?? 0, phase: (o.x * 0.013 + o.baseY * 0.007) % (Math.PI * 2),
      ...(o.door ? { door: o.door } : {}), chimneys: [], homes: o.homes ?? [], extras: ao ? [ao] : [], hidden: false, lift: o.lift ?? 0
    };
    this.billboards.push(bill);
    if (meta.light) this.addLamp(bill, meta.light);
    return bill;
  }

  /** The riddle system shows a Mark's plaque once it is revealed (§14.1), and hides those still to find. */
  setMarkVisible(id: string, visible: boolean): void {
    let changed = false;
    for (const bill of this.billboards) if (bill.mark === id && bill.hidden !== !visible) { bill.hidden = !visible; changed = true; }
    if (changed && this.sunShape) this.castShadows(this.sunShape);
  }

  /** The Marks on this board and their plaques' world positions. */
  marks(): { id: string; x: number; y: number; visible: boolean }[] {
    return this.billboards.filter(b => b.mark).map(b => ({ id: b.mark!, x: b.img.x, y: b.img.y - b.img.height / 2, visible: !b.hidden }));
  }

  private addLamp(bill: Billboard, light: { dx: number; dy: number; radius: number }): void {
    const scene = this.scene;
    const pool = addTorchGlow(scene, bill.x, bill.baseY - 2, { depth: DEPTH.LIGHT, scaleX: 2.3, scaleY: 2.3 * (TH / TW) });
    // A hung lantern's flame is up on the wall with it; its pool still falls on the floor below.
    const head = addTorchGlow(scene, bill.x + light.dx, bill.baseY - bill.lift + light.dy, { depth: OVER_NIGHT, scaleX: 0.75, scaleY: 0.75 });
    // Gas lamps burn steady: a slow flicker of our own instead of the torch's dance.
    scene.tweens.killTweensOf(pool);
    scene.tweens.killTweensOf(head);
    this.lampGlows.push(pool.setAlpha(0.9), head.setAlpha(0.95));
    this.lamps.push({ bill, head });
    this.lampHeads.push({ img: head, phase: bill.x * 0.37, base: 0.95 }, { img: pool, phase: bill.x * 0.37 + 0.5, base: 0.9 });
    this.lights.push({ x: bill.x, y: bill.baseY, radius: light.radius });
  }

  /** Lamp shadows: every prop near a lamp gets one, faded in with the lamps (as ZoneScene did for the greybox). */
  private buildLampShadows(): void {
    for (const bill of this.billboards) {
      if (!bill.casts || bill.foot || bill.lampShadow) continue;
      const lit = torchShadow(bill.x, bill.baseY, this.lights);
      if (!lit) continue;
      const img = this.worldOnly(this.scene.add.image(bill.x, bill.baseY, bill.img.texture.key).setOrigin(0.5, 1).setFlipX(bill.flip)
        .setTintFill(0x000000).setAlpha(0).setDepth(DEPTH.TORCH_SHADOW - 0.01));
      castFrom(img, bill.img, lit);
      bill.lampShadow = { img, alpha: lit.alpha };
    }
  }

  // ── The town's state ──────────────────────────────────────────────────────

  /** Faded or restored art for each sprite, from what the town knows now. Cheap when nothing changed. */
  refresh(look: TownLook, force = false): void {
    const states = this.billboards.map(b => resolveState(b.restorable, look));
    // Who is home (town/occupancy.ts): lights and smoke follow the people, not the paint.
    const lived = this.billboards.map((b, i) => b.kind === 'building' && isLit({ ...(b.restorable.id ? { id: b.restorable.id } : {}), homes: b.homes,
      faded: states[i] === 'faded', unlit: !!metaOf(b.sprite).unlit }, homeDirectory, look));
    const key = states.map((st, i) => `${st}${lived[i] ? '+' : ''}`).join(',');
    if (!force && key === this.lookKey) return;
    this.lookKey = key;
    this.billboards.forEach((bill, i) => {
      const state = states[i]!;
      const changed = force || state !== bill.state;
      const relit = changed || lived[i] !== bill.lived;
      bill.state = state;
      bill.lived = lived[i]!;
      if (changed) {
        const tex = crisp(this.scene, townTexture(spriteFile(bill.sprite, state)));
        bill.img.setTexture(tex);
        bill.ao?.setTexture(this.wallShade(bill.sprite, state));
        this.setRim(bill);
        bill.lampShadow?.img.setTexture(tex);
      }
      if (!relit) return;
      this.lightWindows(bill);
      // Chimney tops in world px (only lived-in buildings smoke).
      const art = TOWN_MANIFEST[bill.sprite]!;
      bill.chimneys = bill.lived ? (metaOf(bill.sprite).chimneys ?? []).map(([cx, cy]) =>
        [bill.x + (bill.flip ? art.w / 2 - cx : cx - art.w / 2), bill.baseY - art.h + cy] as [number, number]) : [];
    });
    if (force) this.buildLampShadows();
    this.lastSun = '';
  }

  /** A sprite's pixels (cached per texture), to find its windows and to see what it hides. */
  private pixels(file: string): ImageData | null {
    let px = spritePixels.get(file);
    if (px !== undefined) return px;
    px = null;
    try {
      const src = this.scene.textures.get(townTexture(file)).getSourceImage() as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = src.width; canvas.height = src.height;
      const c2d = canvas.getContext('2d', { willReadFrequently: true });
      if (c2d) { c2d.drawImage(src, 0, 0); px = c2d.getImageData(0, 0, src.width, src.height); }
    } catch {
      // A tainted canvas can't be read back: no lit windows, nothing hidden.
    }
    spritePixels.set(file, px);
    return px;
  }

  /** Is world point (x, y) under an opaque pixel of this billboard's art? */
  private covers(bill: Billboard, x: number, y: number): boolean {
    const art = TOWN_MANIFEST[bill.sprite]!, px = this.pixels(spriteFile(bill.sprite, bill.state));
    if (!px) return false;
    const ly = Math.floor(y - (bill.img.y - art.h));
    let lx = Math.floor(x - (bill.img.x - art.w / 2));
    if (lx < 0 || ly < 0 || lx >= px.width || ly >= px.height) return false;
    if (bill.flip) lx = px.width - 1 - lx;
    return px.data[(ly * px.width + lx) * 4 + 3]! > 0;
  }

  /** What stands in front of a billboard (nearer the camera) and overlaps its art. */
  private inFront(bill: Billboard): Billboard[] {
    return this.billboards.filter(o => o !== bill && o.baseY > bill.baseY && !metaOf(o.sprite).under && !metaOf(o.sprite).flat && overlaps(o.bounds, bill.bounds));
  }

  /**
   * Lit windows: the panes found in the art (windows.ts), as warm light. They shine over the night layer,
   * so anything standing in front of them (a house across the lane, a tree) is cut out of them here, once:
   * the town's buildings and props don't move.
   */
  private lightWindows(bill: Billboard): void {
    if (!bill.lived) { bill.windows?.setVisible(false); return; }
    const file = spriteFile(bill.sprite, bill.state);
    const px = this.pixels(file);
    if (!px) return;
    let glow = windowGlow.get(file);
    if (!glow) { glow = detectWindows(px.data, px.width, px.height).rgba; windowGlow.set(file, glow); }
    const front = this.inFront(bill);
    const key = front.length ? `townwin:${this.zoneKey}:${this.billboards.indexOf(bill)}:${file}` : `townwin:${file}`;
    if (!this.scene.textures.exists(key)) {
      const tex = this.scene.textures.createCanvas(key, px.width, px.height);
      if (!tex) return;
      const c = tex.getContext();
      c.putImageData(new ImageData(new Uint8ClampedArray(glow), px.width, px.height), 0, 0);
      if (bill.flip) { c.save(); c.translate(px.width, 0); c.scale(-1, 1); }
      // Cut out whatever stands in front, in this sprite's own (unflipped) pixel space.
      c.globalCompositeOperation = 'destination-out';
      const art = TOWN_MANIFEST[bill.sprite]!;
      for (const o of front) {
        const oart = TOWN_MANIFEST[o.sprite]!;
        const src = this.scene.textures.get(townTexture(spriteFile(o.sprite, o.state))).getSourceImage() as HTMLImageElement;
        const ox = (o.img.x - oart.w / 2) - (bill.img.x - art.w / 2), oy = (o.img.y - oart.h) - (bill.img.y - art.h);
        c.save();
        if (o.flip) { c.translate(ox + oart.w, oy); c.scale(-1, 1); c.drawImage(src, 0, 0); } else c.drawImage(src, ox, oy);
        c.restore();
      }
      c.globalCompositeOperation = 'source-over';
      if (bill.flip) c.restore();
      tex.refresh();
      tex.setFilter(NEAREST);
    }
    if (!bill.windows) {
      bill.windows = this.worldOnly(this.scene.add.image(bill.img.x, bill.img.y, key).setOrigin(0.5, 1).setFlipX(bill.flip)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(OVER_NIGHT - 0.01).setVisible(false));
    } else bill.windows.setTexture(key);
  }

  /** A lamp's head shines over the night layer: put out any whose head is behind something nearer. */
  private hideCoveredLamps(): void {
    for (const lamp of this.lamps) {
      const hidden = this.billboards.some(o => o.baseY > lamp.bill.baseY && !metaOf(o.sprite).under && this.covers(o, lamp.head.x, lamp.head.y));
      if (!hidden) continue;
      const i = this.lampGlows.indexOf(lamp.head);
      if (i >= 0) this.lampGlows.splice(i, 1);
      const j = this.lampHeads.findIndex(h => h.img === lamp.head);
      if (j >= 0) this.lampHeads.splice(j, 1);
      lamp.head.destroy();
    }
  }

  /** Doorways of lived-in buildings: a pool of light on the step (also cut out of the night layer). */
  doorPools(): { x: number; y: number; w: number; h: number }[] {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const bill of this.billboards) {
      if (!bill.lived || !bill.door) continue;
      const x = (bill.door[0] + 0.5) * TW, y = this.groundY(bill.door[0], bill.door[1]) + 6;
      out.push({ x, y, w: 110, h: 64 });
      if (this.doorGlows.length < out.length) {
        const glow = this.worldOnly(addTorchGlow(this.scene, x, y, { depth: DEPTH.LIGHT, scaleX: 1.5, scaleY: 0.9 }));
        this.scene.tweens.killTweensOf(glow);
        this.doorGlows.push(glow.setAlpha(0.8));
      }
    }
    return out;
  }

  // ── Light ─────────────────────────────────────────────────────────────────

  /** The clock's light: the sun's shadow layer (recast when the sun has moved a few degrees), lamps and windows. */
  applyLight(env: LightEnv): void {
    this.lampLevel = env.lampLevel;
    this.sunAlpha = env.sun.alpha;
    for (const bill of this.billboards) if (bill.lampShadow) bill.lampShadow.img.setAlpha(bill.lampShadow.alpha * env.lampLevel);
    const on = env.sun.alpha > 0.004;
    this.sunLayer.setAlpha(env.sun.alpha).setVisible(on);
    // Shadows lean away from the sun: a lean to the left (morning) means the sun lights the buildings' right corners.
    const lean = Math.sin(env.sun.angle * Math.PI / 180), side = lean < 0 ? 1 : -1;
    this.rimLevel = on ? Math.min(1, Math.abs(lean)) * Math.min(1, env.sun.alpha / SUN.alpha) : 0;
    if (side !== this.rimSide) { this.rimSide = side; for (const bill of this.billboards) this.setRim(bill); }
    const angle = Math.round(env.sun.angle / 3) * 3, squash = Math.round(env.sun.squash / 0.05) * 0.05;
    const sunKey = `${angle}:${squash.toFixed(2)}`;
    if (on && sunKey !== this.lastSun) {
      this.lastSun = sunKey;
      this.castShadows({ angle, squash });
    }
    const tint = shadeTint(env.sun.alpha);
    for (const bill of this.billboards) if (bill.kind === 'prop') bill.img.setTint(on && bill.shaded ? tint : 0xffffff);
  }

  /**
   * Every sun shadow, drawn afresh in black on the one layer (which shows at the sun's alpha): buildings and the
   * hedge, wall and fence runs as boxes, the props as their silhouettes sheared along the ground.
   */
  private castShadows(sun: { angle: number; squash: number }): void {
    this.sunShape = sun;
    const s = sunShear(sun), pen = this.sunPen, at = this.layerAt, shades: Shade[] = [];
    const box = (poly: Pt[]): Rect => ({ x0: Math.min(...poly.map(p => p.x)), x1: Math.max(...poly.map(p => p.x)), y0: Math.min(...poly.map(p => p.y)), y1: Math.max(...poly.map(p => p.y)) });
    pen.clear().fillStyle(0x000000, 1);
    for (const bill of this.billboards) {
      if (!bill.casts || !bill.foot || bill.hidden) continue;
      const poly = boxShadow(bill.foot, bill.height!, s);
      pen.fillPoints(poly, true);
      shades.push({ box: box(poly), poly, height: bill.height! });
    }
    for (const cell of this.lineCells) for (const r of cell.ground) pen.fillPoints(boxShadow(r, LINE_GEOMETRY[cell.kind].h, s), true);
    const rt = this.sunLayer.clear();
    rt.beginDraw();
    rt.batchDraw(pen, -at.x, -at.y);
    const made = new Map<string, Sheared>();
    for (const bill of this.billboards) {
      if (!bill.casts || bill.foot || bill.hidden) continue;
      const file = spriteFile(bill.sprite, bill.state), key = `townshadow:${file}:${bill.flip ? 1 : 0}`;
      let cast = made.get(key);
      if (!cast) { cast = this.shearShadow(file, key, bill.flip, s); made.set(key, cast); }
      const x = Math.round(bill.x - cast.ox), y = Math.round(bill.baseY - cast.oy);
      // Swept a little north and south for the depth a tree's crown has: a flat cut-out seen edge-on throws no shadow.
      const sweep = Math.round(Math.min(TOWN_MANIFEST[bill.sprite]!.w, 64) * PROP_DEPTH * (TH / TW) / 2);
      for (let dy = -sweep; dy <= sweep; dy += 2) rt.batchDrawFrame(key, undefined, x - at.x, y + dy - at.y);
      shades.push({ box: { x0: x, y0: y - sweep, x1: x + cast.w, y1: y + cast.h + sweep }, prop: { bill, sweep } });
    }
    rt.endDraw();
    this.shades = shades;
    // A small prop in a building's shadow (one taller than it) takes the shade; a tree that tops the roof doesn't.
    for (const bill of this.billboards) {
      if (bill.kind !== 'prop') continue;
      const h = TOWN_MANIFEST[bill.sprite]!.h;
      bill.shaded = shades.some(sh => !!sh.poly && sh.height! >= h && bill.x >= sh.box.x0 && bill.x < sh.box.x1 && bill.baseY >= sh.box.y0 && bill.baseY < sh.box.y1
        && insidePolygon({ x: bill.x, y: bill.baseY - 1 }, sh.poly));
    }
  }

  /**
   * Is ground point (x, y) in the sun's shadow of a building or a prop (the low runs don't count)? The people
   * standing there lose their own sun shadow and take the shade (ZoneScene, scenes/zone/residents).
   */
  inShade(x: number, y: number): boolean {
    if (this.sunAlpha <= 0.004) return false;
    for (const sh of this.shades) {
      if (x < sh.box.x0 || x >= sh.box.x1 || y < sh.box.y0 || y >= sh.box.y1) continue;
      if (sh.poly ? insidePolygon({ x, y }, sh.poly) : this.underProp(sh.prop!.bill, sh.prop!.sweep, x, y)) return true;
    }
    return false;
  }

  /** Is (x, y) in this prop's sheared silhouette? Undo the shear back into the art (render/town/castShadow). */
  private underProp(bill: Billboard, sweep: number, x: number, y: number): boolean {
    const shape = this.sunShape, px = this.pixels(spriteFile(bill.sprite, bill.state));
    if (!shape || !px) return false;
    const { k1, k2 } = sunShear(shape);
    // Nearly sideways, the shear can't be undone row by row (and the sun is low enough that the shadow is faint).
    if (Math.abs(k2) < 0.05) return false;
    const w = px.width, h = px.height, dx = x - bill.x;
    for (let dy = -sweep; dy <= sweep; dy += 2) {
      const up = -(y - bill.baseY - dy) / k2;
      if (up < 0 || up > h) continue;
      let u = Math.floor(dx - k1 * up + w / 2);
      const v = Math.floor(h - up);
      if (bill.flip) u = w - 1 - u;
      if (u >= 0 && u < w && v >= 0 && v < h && px.data[(v * w + u) * 4 + 3]! > 127) return true;
    }
    return false;
  }

  /** A prop's silhouette sheared along the ground about its foot, away from the sun (render/town/castShadow). */
  private shearShadow(file: string, key: string, flip: boolean, s: Shear): Sheared {
    const src = this.scene.textures.get(townTexture(file)).getSourceImage() as HTMLImageElement;
    const w = src.width, h = src.height, { k1, k2 } = s;
    const xs = [0, w, k1 * h, w + k1 * h], ys = [0, -k2 * h];
    const minX = Math.floor(Math.min(...xs)), maxX = Math.ceil(Math.max(...xs));
    const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
    const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY + 1);
    let tex = this.scene.textures.exists(key) ? this.scene.textures.get(key) as Phaser.Textures.CanvasTexture : null;
    if (tex && (tex.width !== cw || tex.height !== ch)) tex.setSize(cw, ch);
    if (!tex) tex = this.scene.textures.createCanvas(key, cw, ch)!;
    const c = tex.getContext();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, ch);
    c.globalCompositeOperation = 'source-over';
    // (u, v) → (u + k1·(h − v), −k2·(h − v)) relative to the foot, shifted into the canvas.
    if (flip) c.setTransform(-1, 0, -k1, k2, w + k1 * h - minX, -k2 * h - minY);
    else c.setTransform(1, 0, -k1, k2, k1 * h - minX, -k2 * h - minY);
    c.drawImage(src, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = '#000';
    c.fillRect(0, 0, cw, ch);
    c.globalCompositeOperation = 'source-over';
    tex.refresh();
    return { key, ox: w / 2 - minX, oy: -minY, w: cw, h: ch };
  }

  /** A building's walls darkening toward the ground: its silhouette, black at the foot, clear WALL_AO_PX up. */
  private wallShade(sprite: string, state: SpriteState): string {
    const file = spriteFile(sprite, state), key = `townwallao:${file}`;
    if (this.scene.textures.exists(key)) return key;
    const src = this.scene.textures.get(townTexture(file)).getSourceImage() as HTMLImageElement;
    const tex = this.scene.textures.createCanvas(key, src.width, src.height)!;
    const c = tex.getContext(), h = src.height;
    c.drawImage(src, 0, 0);
    c.globalCompositeOperation = 'source-in';
    const g = c.createLinearGradient(0, h, 0, h - WALL_AO_PX);
    g.addColorStop(0, `rgba(0,0,0,${WALL_AO_ALPHA})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, src.width, h);
    tex.refresh();
    tex.setFilter(NEAREST);
    return key;
  }

  /** The edge texture on the sunlit side and the other on the shaded side, for the art this building shows now. */
  private setRim(bill: Billboard): void {
    if (!bill.rim || !this.rimSide) return;
    // The edges are found in the unflipped art: a flipped building's right edge is its art's left.
    const lit = (bill.flip ? -this.rimSide : this.rimSide) as 1 | -1;
    bill.rim.lit.setTexture(this.rimEdge(bill.sprite, bill.state, lit)).setFlipX(bill.flip);
    bill.rim.dark.setTexture(this.rimEdge(bill.sprite, bill.state, -lit as 1 | -1)).setFlipX(bill.flip);
  }

  /** The last two px of the art's silhouette on one side of each row (1 right, −1 left), white: a building's corner. */
  private rimEdge(sprite: string, state: SpriteState, side: 1 | -1): string {
    const file = spriteFile(sprite, state), key = `townrim:${file}:${side}`;
    if (this.scene.textures.exists(key)) return key;
    const px = this.pixels(file);
    const w = px?.width ?? 1, h = px?.height ?? 1, tex = this.scene.textures.createCanvas(key, w, h)!;
    if (px) {
      const out = new ImageData(w, h), solid = (x: number, y: number) => x >= 0 && x < w && px.data[(y * w + x) * 4 + 3]! > 127;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!solid(x, y)) continue;
        const a = !solid(x + side, y) ? 255 : !solid(x + 2 * side, y) ? 110 : 0;
        if (!a) continue;
        const i = (y * w + x) * 4;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = 255; out.data[i + 3] = a;
      }
      tex.getContext().putImageData(out, 0, 0);
    }
    tex.refresh();
    tex.setFilter(NEAREST);
    return key;
  }

  // ── Every frame ───────────────────────────────────────────────────────────

  /**
   * Bake another chunk if any are left, cull to the camera, fade what hides the player, sway what the wind
   * moves, animate the water and the lamps.
   */
  update(dtMs: number, player: { x: number; y: number }, wind: number): void {
    const dt = dtMs / 1000;
    this.time += dt;
    this.wind = wind;
    const v = cameraView(this.scene.cameras.main);
    // The keystone pass shows a little more at the top of the screen than the camera's rectangle.
    const view: Rect = { x0: v.x0 - 90, x1: v.x1 + 90, y0: v.y0 - 60, y1: v.y1 + 40 };
    this.player.x = player.x; this.player.y = player.y;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i]!;
      // Never show a hole: a chunk coming into view that the idle baker hasn't reached yet bakes now.
      if (!c.done && overlaps(c.rect, view)) this.bake(i);
      const on = overlaps(c.rect, view);
      for (const img of c.images) img.setVisible(on);
      for (const img of c.foam) img.setVisible(on);
    }
    for (const w of this.waterImages) w.img.setVisible(overlaps(w.rect, view));
    // Foam laps: the two phases cross-fade.
    const lap = 0.5 + 0.5 * Math.sin(this.time * (this.opts.reduced ? 0.4 : 1.25));
    for (const c of this.chunks) if (c.foam.length === 2) { c.foam[0]!.setAlpha(0.25 + 0.65 * lap); c.foam[1]!.setAlpha(0.25 + 0.65 * (1 - lap)); }
    this.rippleClock += dt;
    if (this.rippleClock >= (this.opts.reduced ? 3 : 1) / RIPPLE_FPS) { this.rippleClock = 0; this.drawRipples(); }

    const night = this.lampLevel > 0.005;
    const body: Rect = { x0: player.x - 12, x1: player.x + 12, y0: player.y - 52, y1: player.y };
    for (const cell of this.lineCells) cell.img.setVisible(overlaps(cell.rect, view));
    for (const bill of this.billboards) {
      const on = !bill.hidden && overlaps(bill.bounds, view);
      bill.img.setVisible(on);
      bill.contact?.setVisible(on);
      bill.lampShadow?.img.setVisible(on && night);
      for (const e of bill.extras) e.setVisible(on).setAlpha(bill.alpha);
      if (bill.rim) {
        const lit = on && this.rimLevel > 0.01;
        bill.rim.lit.setVisible(lit).setAlpha(bill.alpha * this.rimLevel * RIM_LIT);
        bill.rim.dark.setVisible(lit).setAlpha(bill.alpha * this.rimLevel * RIM_DARK);
      }
      if (!on) { bill.windows?.setVisible(false); continue; }
      if (bill.fade) {
        const behind = player.y < bill.baseY - 2 && overlaps(body, { x0: bill.bounds.x0 + 6, x1: bill.bounds.x1 - 6, y0: bill.bounds.y0 + 6, y1: bill.baseY });
        const target = behind ? FADED_ALPHA : 1;
        if (bill.alpha !== target) {
          bill.alpha += (target - bill.alpha) * Math.min(1, dt * 9);
          if (Math.abs(bill.alpha - target) < 0.01) bill.alpha = target;
          bill.img.setAlpha(bill.alpha);
        }
      }
      if (bill.windows) bill.windows.setVisible(night && bill.lived).setAlpha(this.lampLevel * 0.85 * bill.alpha);
      if (bill.sway && wind > 0.05 && !this.opts.reduced) {
        const gust = 0.6 + 0.4 * Math.sin(this.time * 0.7 + bill.phase * 0.3);
        bill.img.setAngle(Math.sin(this.time * (1.6 + bill.sway * 0.08) + bill.phase) * bill.sway * wind * gust);
      } else if (bill.img.angle !== 0) bill.img.setAngle(0);
    }
    if (night) for (const l of this.lampHeads) {
      const n = Math.sin(this.time * 7.3 + l.phase) * 0.5 + Math.sin(this.time * 12.1 + l.phase * 2) * 0.3;
      l.img.setAlpha(l.base * (0.93 + 0.05 * n));
    }
    this.sweepBeam();
  }

  // ── The lighthouse beam ───────────────────────────────────────────────────

  /** Point Lumière's lantern, its beam and the stones on the breakwater that flash as it passes (WF-5). */
  private buildBeam(): void {
    const bill = this.billboards.find(b => b.sprite === 'lighthouse');
    if (!bill) return;
    const art = TOWN_MANIFEST.lighthouse!;
    // The lantern room's middle, read off the art (px from its top-left).
    const x = bill.x - art.w / 2 + (bill.flip ? art.w - LANTERN[0] : LANTERN[0]), y = bill.baseY - art.h + LANTERN[1];
    const ray = this.scene.add.image(x, y, ensureBeamTexture(this.scene)).setOrigin(0, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(OVER_NIGHT - 0.02).setVisible(false);
    const glow = addTorchGlow(this.scene, x, y, { depth: OVER_NIGHT - 0.015, scaleX: 1.6, scaleY: 1.6 });
    this.scene.tweens.killTweensOf(glow);
    glow.setVisible(false);
    // A stone answers when the beam's heading is within its half-width of the stone's own heading.
    const stones = this.billboards.filter(b => b.sprite === 'brass_stone').map(stone => {
      const sart = TOWN_MANIFEST.brass_stone!;
      const flash = addTorchGlow(this.scene, stone.x, stone.baseY - sart.h * 0.45, { depth: OVER_NIGHT - 0.01, scaleX: 0.5, scaleY: 0.5 });
      this.scene.tweens.killTweensOf(flash);
      return { flash: flash.setVisible(false), heading: headingTo(stone.x - x, stone.baseY - sart.h * 0.45 - y) };
    });
    this.beam = { bill, ray, glow, x, y, stones };
  }

  /** At night, once the lighthouse is relit: the beam turns (a steady glow under reduced motion). */
  private sweepBeam(): void {
    const b = this.beam;
    if (!b) return;
    const lit = b.bill.state === 'restored' && this.lampLevel > 0.02;
    b.glow.setVisible(lit).setAlpha(this.lampLevel * (this.opts.reduced ? 1 : 0.85));
    const turning = lit && !this.opts.reduced;
    b.ray.setVisible(turning);
    if (!turning) { for (const s of b.stones) s.flash.setVisible(false); return; }
    const heading = beamHeading(this.time);
    const { rotation, length } = beamOnScreen(heading);
    b.ray.setRotation(rotation).setScale(length * BEAM_LENGTH / BEAM_TEX_W, 1).setAlpha(this.lampLevel * 0.75);
    for (const s of b.stones) {
      const hit = beamHit(heading, s.heading, BEAM_HALF_ANGLE * 0.6);
      s.flash.setVisible(hit > 0).setAlpha(hit * this.lampLevel);
    }
  }

  /** World positions the life layer wants. */
  tilesOf(kinds: readonly string[]): Point[] {
    const { zone } = this.opts, out: Point[] = [];
    const want = new Set(kinds.map(k => KIND_ID[k as keyof typeof KIND_ID]));
    for (let y = 0; y < zone.height; y++) for (let x = 0; x < zone.width; x++) if (want.has(KIND_ID[zone.tiles[y * zone.width + x]!.kind!])) out.push([x, y]);
    return out;
  }

  isWater(x: number, y: number): boolean {
    const { zone } = this.opts;
    if (x < 0 || y < 0 || x >= zone.width || y >= zone.height) return false;
    return TERRAIN_INFO[zone.tiles[y * zone.width + x]!.kind!].water;
  }
}
