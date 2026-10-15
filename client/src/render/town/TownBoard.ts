import Phaser from 'phaser';
import type { ZoneDef, TownBuilding, TownProp, Point } from '../../world/zoneFormat';
import { TOWN_MANIFEST, isLived, metaOf, resolveState, spriteFile, type Restorable, type SpriteState, type TownLook } from '../../world/townSprites';
import { TERRAIN_INFO } from '../../world/townTerrain';
import { KIND_ID, TH, TW, groundMap } from './autotile';
import { bakeChunk, bakeContext, type BakeContext } from './terrainBake';
import { RIPPLE_H, RIPPLE_W, flowVelocity, ripplePattern, swell, waterStyle, type WaterStyle } from './water';
import { detectWindows } from './windows';
import { DEPTH, actorDepth, terrainDepth } from '../depth';
import { DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH } from '../dioramaConfig';
import { addTorchGlow } from '../diorama/Lighting';
import { ensureDotTexture } from '../diorama/Atmosphere';
import { castFrom, torchShadow, type Sun } from '../sun';
import type { ObliqueProjection } from '../ObliqueProjection';

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
//   shadows    a soft contact shadow under everything; the sun's shadow from the clock: props lean their
//              silhouette (render/sun castFrom), buildings shear theirs along the ground (a box's shadow,
//              not a toppled one), redrawn when the sun has moved a few degrees; lamps throw shadows at night
//   night      lamp posts are lights (a pool on the ground, a halo at the head, a steady flicker); lived-in
//              buildings get their windows lit (found in the art, windows.ts) and a pool at the door
//   state      faded or restored art per townSprites.resolveState, swapped in place when the town changes
//
// Everything is created in the constructor (ZoneScene snapshots the world's objects for its UI camera
// straight after), and only re-textured, moved or shown afterwards.
// ─────────────────────────────────────────────────────────────────────────────

export const townTexture = (file: string): string => `town:${file}`;

/** Queue every town sprite (cheap after the first time: textures persist across scene restarts). */
export function preloadTownSprites(scene: Phaser.Scene): void {
  const base = `${import.meta.env.BASE_URL}assets/town/`;
  for (const [id, entry] of Object.entries(TOWN_MANIFEST)) for (const state of entry.states) {
    const file = spriteFile(id, state);
    if (!scene.textures.exists(townTexture(file))) scene.load.image(townTexture(file), `${base}${file}.png`);
  }
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
  shadow: Phaser.GameObjects.Image | null;
  shear: boolean;
  lampShadow: { img: Phaser.GameObjects.Image; alpha: number } | null;
  windows: Phaser.GameObjects.Image | null;
  contact: Phaser.GameObjects.Image | null;
  sway: number;
  phase: number;
  /** Buildings: the place it is (for door pools). */
  door?: Point;
  /** Chimney tops, world px (lived-in buildings smoke from them). */
  chimneys: [number, number][];
}

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
  private readonly ctx: BakeContext;
  private readonly zoneKey: string;
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
      { seed: opts.seed, elevStep: DIORAMA_ELEV_STEP, slab: DIORAMA_SLAB_DEPTH });
    // The board's own shadow on the world.
    const b = projection.bounds();
    scene.add.image(b.x + b.w / 2, b.y + b.h + 6, ensureDotTexture(scene)).setTint(0x000000).setAlpha(0.7)
      .setDisplaySize(b.w * 1.22, Math.max(70, b.h * 0.26)).setDepth(DEPTH.BOARD_SHADOW);
    this.buildGround();
    this.buildWater();
    const town = zone.town!;
    for (const building of town.buildings) this.addBuilding(building);
    for (const prop of town.props) this.addProp(prop);
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
    this.addBillboard({ sprite: b.sprite, kind: 'building', x, baseY, flip: b.flip, restorable: { ...(b.id ? { id: b.id } : {}), sprite: b.sprite, state: b.state, ...(b.project ? { project: b.project } : {}) }, door: b.door, fade: true });
  }

  private addProp(p: TownProp): void {
    const meta = metaOf(p.sprite);
    const x = (p.at[0] + 0.5) * TW + p.dx;
    const baseY = this.groundY(p.at[0], p.at[1]) + TH / 2 + p.dy;
    this.addBillboard({ sprite: p.sprite, kind: 'prop', x, baseY, lift: p.lift, flip: p.flip, restorable: { sprite: p.sprite, state: p.state, ...(p.project ? { project: p.project } : {}) }, fade: !!meta.fade });
  }

  private addBillboard(o: { sprite: string; kind: 'building' | 'prop'; x: number; baseY: number; lift?: number; flip: boolean; restorable: Restorable; door?: Point; fade: boolean }): void {
    const scene = this.scene, meta = metaOf(o.sprite), art = TOWN_MANIFEST[o.sprite]!;
    const lift = (meta.overhead ?? 0) + (o.lift ?? 0);
    const img = scene.add.image(o.x, o.baseY - lift, crisp(scene, townTexture(o.sprite))).setOrigin(0.5, 1).setFlipX(o.flip);
    // Overhead things (bunting) hang over the people; the footbridge and lilies lie under them.
    img.setDepth(meta.overhead ? DEPTH.UNIT_HUD - 0.5 : meta.under ? DEPTH.TERRAIN_FX + (meta.water ? 0 : 0.01) : actorDepth(o.baseY) - 1e-6);
    const bounds = { x0: o.x - art.w / 2, x1: o.x + art.w / 2, y0: o.baseY - lift - art.h, y1: o.baseY - lift + 4 };
    const isLamp = !!meta.light;
    // The ground it stands on darkens a little round its foot.
    let contact: Phaser.GameObjects.Image | null = null;
    if (!meta.flat && !meta.water && !meta.under) {
      const [bw] = meta.block ?? [1, 1];
      const w = o.kind === 'building' ? art.w * 0.92 : Math.min(art.w, Math.max(1, bw) * TW) * 0.8;
      contact = scene.add.image(o.x, o.baseY - 1, ensureDotTexture(scene)).setTint(0x000000)
        .setAlpha(o.kind === 'building' ? 0.42 : 0.3).setDisplaySize(w, o.kind === 'building' ? 16 : 8).setDepth(DEPTH.SHADOW - 0.05);
    }
    const shear = o.kind === 'building';
    const shadow = meta.flat || meta.water || isLamp || meta.overhead || o.lift ? null
      : scene.add.image(o.x, o.baseY, img.texture.key).setOrigin(0.5, 1).setTintFill(0x000000).setAlpha(0).setDepth(DEPTH.SHADOW - 0.1);
    const bill: Billboard = {
      img, sprite: o.sprite, kind: o.kind, x: o.x, baseY: o.baseY, bounds, fade: o.fade, alpha: 1,
      restorable: o.restorable, state: 'restored', lived: false, flip: o.flip, shadow, shear, lampShadow: null,
      windows: null, contact, sway: meta.sway ?? 0, phase: (o.x * 0.013 + o.baseY * 0.007) % (Math.PI * 2),
      ...(o.door ? { door: o.door } : {}), chimneys: []
    };
    this.billboards.push(bill);
    if (meta.light) this.addLamp(bill, meta.light);
  }

  private addLamp(bill: Billboard, light: { dx: number; dy: number; radius: number }): void {
    const scene = this.scene;
    const pool = addTorchGlow(scene, bill.x, bill.baseY - 2, { depth: DEPTH.LIGHT, scaleX: 2.3, scaleY: 2.3 * (TH / TW) });
    const head = addTorchGlow(scene, bill.x + light.dx, bill.baseY + light.dy, { depth: OVER_NIGHT, scaleX: 0.75, scaleY: 0.75 });
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
      if (!bill.shadow || bill.shear || bill.lampShadow) continue;
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
    const key = states.join(',');
    if (!force && key === this.lookKey) return;
    this.lookKey = key;
    this.billboards.forEach((bill, i) => {
      const state = states[i]!;
      const changed = force || state !== bill.state;
      bill.state = state;
      bill.lived = bill.kind === 'building' && isLived(bill.restorable, state);
      if (!changed) return;
      const tex = crisp(this.scene, townTexture(spriteFile(bill.sprite, state)));
      bill.img.setTexture(tex);
      if (bill.shadow && !bill.shear) bill.shadow.setTexture(tex);
      bill.lampShadow?.img.setTexture(tex);
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

  /** The clock's light: sun shadows (re-sheared for buildings when the sun has moved), lamps and windows. */
  applyLight(env: LightEnv): void {
    this.lampLevel = env.lampLevel;
    this.sunAlpha = env.sun.alpha;
    const angle = Math.round(env.sun.angle / 3) * 3, squash = Math.round(env.sun.squash / 0.05) * 0.05;
    const sunKey = `${angle}:${squash.toFixed(2)}`;
    for (const bill of this.billboards) {
      if (!bill.shadow) continue;
      if (!bill.shear) castFrom(bill.shadow, bill.img, env.sun);
      bill.shadow.setAlpha(env.sun.alpha);
      if (bill.lampShadow) bill.lampShadow.img.setAlpha(bill.lampShadow.alpha * env.lampLevel);
    }
    if (sunKey !== this.lastSun && env.sun.alpha > 0.004) {
      this.lastSun = sunKey;
      const rad = (angle * Math.PI) / 180;
      const k1 = squash * Math.sin(rad), k2 = squash * Math.cos(rad);
      const made = new Map<string, { ox: number; oy: number }>();
      for (const bill of this.billboards) {
        if (!bill.shadow || !bill.shear) continue;
        const file = spriteFile(bill.sprite, bill.state);
        const key = `townshadow:${file}:${bill.flip ? 1 : 0}`;
        let origin = made.get(key);
        if (!origin) { origin = this.shearShadow(file, key, bill.flip, k1, k2); made.set(key, origin); }
        bill.shadow.setTexture(key).setOrigin(origin.ox, origin.oy).setScale(1).setAngle(0).setFlipX(false).clearTint().setTintFill(0x000000);
      }
    }
  }

  /** A building's silhouette laid on the ground: sheared away from the sun, its foot fixed. */
  private shearShadow(file: string, key: string, flip: boolean, k1: number, k2: number): { ox: number; oy: number } {
    const src = this.scene.textures.get(townTexture(file)).getSourceImage() as HTMLImageElement;
    const w = src.width, h = src.height;
    const xs = [0, w, k1 * h, w + k1 * h], ys = [0, -k2 * h];
    const minX = Math.floor(Math.min(...xs)), maxX = Math.ceil(Math.max(...xs));
    const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
    const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY + 1);
    let tex = this.scene.textures.exists(key) ? this.scene.textures.get(key) as Phaser.Textures.CanvasTexture : null;
    if (tex && (tex.width !== cw || tex.height !== ch)) { tex.setSize(cw, ch); }
    if (!tex) tex = this.scene.textures.createCanvas(key, cw, ch);
    if (!tex) return { ox: 0.5, oy: 1 };
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
    return { ox: (w / 2 - minX) / cw, oy: -minY / ch };
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

    const night = this.lampLevel > 0.005, sunOn = this.sunAlpha > 0.004;
    const body: Rect = { x0: player.x - 12, x1: player.x + 12, y0: player.y - 52, y1: player.y };
    for (const bill of this.billboards) {
      const on = overlaps(bill.bounds, view) || (!!bill.shadow && sunOn && Math.abs(bill.x - (view.x0 + view.x1) / 2) < (view.x1 - view.x0) / 2 + 320 && bill.baseY > view.y0 && bill.baseY - 400 < view.y1);
      bill.img.setVisible(on);
      bill.shadow?.setVisible(on && sunOn);
      bill.contact?.setVisible(on);
      bill.lampShadow?.img.setVisible(on && night);
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
