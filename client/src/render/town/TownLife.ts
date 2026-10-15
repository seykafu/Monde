import Phaser from 'phaser';
import { DEPTH, actorDepth } from '../depth';
import { TOWN_MANIFEST } from '../../world/townSprites';
import type { Point } from '../../world/zoneFormat';
import { TH, TW, hash01 } from './autotile';
import { cameraView, type Billboard, type TownBoard } from './TownBoard';
import { BIRD, BUTTERFLY_COLOURS, DROP, DUCK, GULL, LEAF_COLOURS, SMOKE, SPARKLE, butterfly, leaf, type LifeSprite } from './lifeArt';

// ─────────────────────────────────────────────────────────────────────────────
// The town's small life (GDD §16.4; the town lift): smoke from the chimneys of lived-in houses, birds (and
// gulls by the sea) crossing now and then, butterflies over the flowers in sunshine, ducks drifting on the
// pond, leaves shaken from the trees in a wind, the restored fountain running, glints on the water.
//
// Cheap and subtle by design: every sprite comes from a small pool made up front (ZoneScene snapshots the
// world's objects for its UI camera right after create), only what the camera sees is animated, and the
// counts are capped. With reduced motion (the OS setting, or `?motion=0`) only the smoke, the ducks and the
// fountain stay, slower.
// ─────────────────────────────────────────────────────────────────────────────

export interface LifeEnv {
  /** Unit vector the wind blows toward (screen), and its strength 0..1. */
  wind: { x: number; y: number; strength: number };
  /** 0 day … 1 night. */
  dark: number;
  /** Rain, snow or fog keeps the birds and butterflies in. */
  wet: boolean;
  /** Bright sun: butterflies and glints on the water. */
  sunny: boolean;
}

/** `prefers-reduced-motion`, or `?motion=0` to try it. */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('motion') === '0') return true;
  if (q.get('motion') === '1') return false;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const S = 2; // life sprites are drawn at 2 world px per art pixel: small, but chunky like the rest
const TREES = new Set(['oak', 'birch', 'pine', 'willow', 'apple_tree', 'old_elm']);
const FLOWERS = new Set(['flowerbed', 'bush_flowering', 'planter', 'flower_pots', 'veg_bed']);

function lifeTexture(scene: Phaser.Scene, key: string, art: LifeSprite): string {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, art.w * art.frames.length, art.h);
  if (!tex) return key;
  const ctx = tex.getContext();
  art.frames.forEach((f, i) => {
    ctx.putImageData(new ImageData(f as Uint8ClampedArray<ArrayBuffer>, art.w, art.h), i * art.w, 0);
    tex.add(i, 0, i * art.w, 0, art.w, art.h);
  });
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

interface Mote { img: Phaser.GameObjects.Image; on: boolean; age: number; life: number; x: number; y: number; vx: number; vy: number; a: number; b: number; ground: number }

export class TownLife {
  private readonly puffs: Mote[];
  private readonly birds: Mote[];
  private readonly butterflies: Mote[];
  private readonly ducks: Mote[];
  private readonly leaves: Mote[];
  private readonly drops: Mote[];
  private readonly sparkles: Mote[];
  private readonly chimneyClock = new Map<string, number>();
  private readonly flowerSpots: Point[];
  private readonly calm: Set<string>;
  private readonly waterTiles: Point[];
  private readonly trees: Billboard[];
  private readonly fountains: Billboard[];
  private time = 0;
  private nextFlock: number;
  private flockGulls = false;
  private seq = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly board: TownBoard, private readonly opts: { reduced: boolean; seaside: boolean }) {
    const pool = (n: number, key: string, scale = S) => Array.from({ length: n }, () => ({
      img: scene.add.image(0, 0, key, 0).setScale(scale).setVisible(false), on: false, age: 0, life: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, b: 0, ground: 0
    }));
    this.puffs = pool(48, lifeTexture(scene, 'life:smoke', SMOKE), 1);
    this.birds = pool(8, lifeTexture(scene, 'life:bird', BIRD));
    lifeTexture(scene, 'life:gull', GULL);
    BUTTERFLY_COLOURS.forEach((c, i) => lifeTexture(scene, `life:butterfly${i}`, butterfly(c)));
    this.butterflies = pool(opts.reduced ? 0 : 6, 'life:butterfly0');
    this.ducks = pool(4, lifeTexture(scene, 'life:duck', DUCK));
    LEAF_COLOURS.forEach((c, i) => lifeTexture(scene, `life:leaf${i}`, leaf(c)));
    this.leaves = pool(opts.reduced ? 0 : 24, 'life:leaf0');
    this.drops = pool(26, lifeTexture(scene, 'life:drop', DROP));
    this.sparkles = pool(14, lifeTexture(scene, 'life:sparkle', SPARKLE));
    this.trees = board.billboards.filter(b => TREES.has(b.sprite));
    this.fountains = board.billboards.filter(b => b.sprite === 'fountain');
    // Where butterflies go: meadow, and every flowerbed, flowering bush and planter.
    this.flowerSpots = [...board.tilesOf(['meadow']).map(([x, y]) => [(x + 0.5) * TW, (y + 0.5) * TH] as Point),
      ...board.billboards.filter(b => FLOWERS.has(b.sprite)).map(b => [b.x, b.baseY] as Point)];
    // Ducks keep to calm water (a pond, else a river), away from the banks.
    const calm = board.tilesOf(['pond']);
    const pond = (calm.length ? calm : board.tilesOf(['river'])).filter(([x, y]) => [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) => board.isWater(x + dx!, y + dy!)));
    this.calm = new Set(pond.map(p => p.join(',')));
    this.waterTiles = board.tilesOf(['sea', 'river', 'pond', 'shallows']);
    const count = Math.min(this.ducks.length, Math.floor(pond.length / 5));
    for (let i = 0; i < count; i++) {
      const [x, y] = pond[Math.floor(hash01(i, 3, pond.length) * pond.length)]!;
      const d = this.ducks[i]!;
      Object.assign(d, { on: true, x: (x + 0.5) * TW, y: (y + 0.5) * TH, a: hash01(i, 4, 9) * Math.PI * 2, b: hash01(i, 5, 9) * 6, age: 0 });
      d.img.setVisible(true);
    }
    this.nextFlock = 4 + Math.random() * 8;
  }

  update(dtMs: number, env: LifeEnv): void {
    const dt = Math.min(0.1, dtMs / 1000);
    this.time += dt;
    const v = cameraView(this.scene.cameras.main);
    const view = { x0: v.x0 - 60, x1: v.x1 + 60, y0: v.y0 - 80, y1: v.y1 + 40 };
    const inView = (x: number, y: number) => x > view.x0 && x < view.x1 && y > view.y0 && y < view.y1;
    const day = env.dark < 0.55;
    this.smoke(dt, env, inView);
    this.fountain(dt, inView);
    this.swimDucks(dt, inView);
    this.glints(dt, env, inView);
    if (this.opts.reduced) return;
    this.flock(dt, env, view, day && !env.wet);
    this.flutter(dt, env, inView, day && env.sunny && !env.wet);
    this.fall(dt, env, inView);
  }

  private take(pool: Mote[]): Mote | null {
    for (const m of pool) if (!m.on) return m;
    return null;
  }

  private retire(m: Mote): void { m.on = false; m.img.setVisible(false); }

  // Chimney smoke: a puff every second or so from each chimney in view, rising and leaning downwind.
  private smoke(dt: number, env: LifeEnv, inView: (x: number, y: number) => boolean): void {
    const every = this.opts.reduced ? 2.2 : 1.1;
    for (const bill of this.board.billboards) {
      if (!bill.chimneys.length || !bill.img.visible) continue;
      bill.chimneys.forEach(([cx, cy], i) => {
        if (!inView(cx, cy)) return;
        const id = `${bill.x},${bill.baseY},${i}`;
        const t = (this.chimneyClock.get(id) ?? hash01(cx, cy, 1) * every) + dt;
        if (t < every) { this.chimneyClock.set(id, t); return; }
        this.chimneyClock.set(id, t - every * (0.8 + Math.random() * 0.4));
        const m = this.take(this.puffs);
        if (!m) return;
        const lean = env.wind.x * (6 + 22 * env.wind.strength);
        Object.assign(m, { on: true, age: 0, life: 3.4 + Math.random() * 1.2, x: cx + (Math.random() - 0.5) * 3, y: cy - 2, vx: lean + (Math.random() - 0.5) * 3, vy: -(8 + Math.random() * 4) * (this.opts.reduced ? 0.6 : 1), a: 0.45 + Math.random() * 0.2, b: 0 });
        m.img.setDepth(bill.img.depth + 1e-6).setFrame(0).setVisible(true);
      });
    }
    for (const m of this.puffs) {
      if (!m.on) continue;
      m.age += dt;
      if (m.age >= m.life) { this.retire(m); continue; }
      const t = m.age / m.life;
      m.x += m.vx * dt; m.y += m.vy * dt;
      m.vy *= 1 - 0.15 * dt;
      m.img.setPosition(m.x, m.y).setScale(0.7 + t * 1.6).setAlpha(m.a * Math.min(1, m.age / 0.4) * (1 - t) ** 1.3);
    }
  }

  // The restored fountain: drops falling down the heron's jet and over the bowl's three lips.
  private fountain(dt: number, inView: (x: number, y: number) => boolean): void {
    for (const f of this.fountains) {
      if (f.state !== 'restored' || !f.img.visible || !inView(f.x, f.baseY - 60)) continue;
      const art = TOWN_MANIFEST.fountain!;
      const ox = f.x - art.w / 2, oy = f.baseY - art.h;
      // Sprite-space spouts (read off the art): the beak, then the upper bowl's three cascades.
      const spouts: [number, number, number][] = [[91, 11, 62], [43, 80, 100], [70, 82, 104], [95, 80, 100]];
      if (Math.random() < dt * 22) {
        const m = this.take(this.drops);
        const [sx, sy, ey] = spouts[this.seq++ % spouts.length]!;
        if (m) {
          Object.assign(m, { on: true, age: 0, x: ox + sx + (Math.random() - 0.5) * 3, y: oy + sy, vx: (Math.random() - 0.5) * 6, vy: 30 + Math.random() * 20, ground: oy + ey, life: 2 });
          m.img.setDepth(f.img.depth + 2e-6).setFrame(0).setVisible(true).setAlpha(0.9);
        }
      }
    }
    for (const m of this.drops) {
      if (!m.on) continue;
      m.age += dt;
      m.vy += 160 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.y >= m.ground || m.age > m.life) { this.retire(m); continue; }
      m.img.setPosition(m.x, m.y);
    }
  }

  // Ducks paddle about, turning back before a bank, bobbing.
  private swimDucks(dt: number, inView: (x: number, y: number) => boolean): void {
    for (const d of this.ducks) {
      if (!d.on) continue;
      d.b -= dt;
      if (d.b <= 0) { d.a += (Math.random() - 0.5) * 2.2; d.b = 3 + Math.random() * 5; }
      const speed = 7;
      const ax = d.x + Math.cos(d.a) * 16, ay = d.y + Math.sin(d.a) * 12;
      const tx = Math.floor(ax / TW), ty = Math.floor(ay / TH);
      if (!this.calm.has(`${tx},${ty}`)) d.a += Math.PI * (0.7 + Math.random() * 0.6);
      else { d.x += Math.cos(d.a) * speed * dt; d.y += Math.sin(d.a) * speed * dt * 0.75; }
      const show = inView(d.x, d.y);
      d.img.setVisible(show);
      if (!show) continue;
      d.age += dt;
      d.img.setPosition(Math.round(d.x), Math.round(d.y + Math.sin(d.age * 2.4) * 0.6)).setFlipX(Math.cos(d.a) < 0)
        .setFrame(Math.floor(d.age * 1.6) % 2).setDepth(actorDepth(d.y + 6));
    }
  }

  // Glints on the water in the sun.
  private glints(dt: number, env: LifeEnv, inView: (x: number, y: number) => boolean): void {
    if (env.sunny && env.dark < 0.4 && this.waterTiles.length && Math.random() < dt * (this.opts.reduced ? 3 : 9)) {
      const [x, y] = this.waterTiles[Math.floor(Math.random() * this.waterTiles.length)]!;
      const px = (x + 0.15 + Math.random() * 0.7) * TW, py = (y + 0.25 + Math.random() * 0.6) * TH;
      const m = inView(px, py) ? this.take(this.sparkles) : null;
      if (m) { Object.assign(m, { on: true, age: 0, life: 0.5 + Math.random() * 0.5, x: px, y: py }); m.img.setPosition(px, py).setDepth(DEPTH.TERRAIN_FX + 0.01).setVisible(true); }
    }
    for (const m of this.sparkles) {
      if (!m.on) continue;
      m.age += dt;
      if (m.age >= m.life) { this.retire(m); continue; }
      const t = m.age / m.life;
      m.img.setFrame(t < 0.25 || t > 0.75 ? 1 : 0).setAlpha(Math.sin(t * Math.PI));
    }
  }

  // Now and then a few birds cross the sky (gulls by the sea), never at night or in the wet.
  private flock(dt: number, env: LifeEnv, view: { x0: number; x1: number; y0: number; y1: number }, flying: boolean): void {
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = 9 + Math.random() * 18;
      if (flying && !this.birds.some(b => b.on)) {
        const gulls = this.opts.seaside ? Math.random() < 0.8 : Math.random() < 0.15;
        this.flockGulls = gulls;
        const n = 1 + Math.floor(Math.random() * (gulls ? 3 : 4));
        const ltr = Math.random() < 0.5 + env.wind.x * 0.3;
        const speed = (gulls ? 48 : 78) * (ltr ? 1 : -1) + env.wind.x * 18 * env.wind.strength;
        const y0 = view.y0 + (view.y1 - view.y0) * (0.12 + Math.random() * 0.4);
        for (let i = 0; i < n; i++) {
          const m = this.take(this.birds);
          if (!m) break;
          Object.assign(m, { on: true, age: Math.random(), x: (ltr ? view.x0 - 20 : view.x1 + 20) - i * 16 * Math.sign(speed), y: y0 + (i % 2 ? 9 : -6) * Math.ceil(i / 2), vx: speed * (0.95 + Math.random() * 0.1), vy: (Math.random() - 0.5) * 6, a: Math.random() * 6 });
          m.img.setTexture(gulls ? 'life:gull' : 'life:bird', 0).setFlipX(speed < 0).setDepth(DEPTH.ATMOSPHERE - 0.5).setVisible(true);
        }
      }
    }
    for (const m of this.birds) {
      if (!m.on) continue;
      m.age += dt;
      m.x += m.vx * dt; m.y += (m.vy + Math.sin(m.age * 2 + m.a) * 4) * dt;
      if ((m.vx > 0 && m.x > view.x1 + 40) || (m.vx < 0 && m.x < view.x0 - 40)) { this.retire(m); continue; }
      // Small birds beat steadily; gulls glide, with a few beats every few seconds.
      const beat = this.flockGulls ? (m.age % 3.2 < 0.9 ? Math.floor(m.age * 5) % 2 : 0) : Math.floor(m.age * 8) % 2;
      m.img.setPosition(m.x, m.y).setFrame(beat);
    }
  }

  // Butterflies over the flowers, in sunshine.
  private flutter(dt: number, env: LifeEnv, inView: (x: number, y: number) => boolean, out: boolean): void {
    for (const m of this.butterflies) {
      if (m.on) {
        m.age += dt;
        const fade = Math.min(1, m.age / 0.6, (m.life - m.age) / 0.6);
        if (m.age >= m.life || !out && fade <= 0.05) { this.retire(m); continue; }
        const t = m.age;
        const x = m.x + Math.sin(t * 0.9 + m.a) * 22 + Math.sin(t * 2.3 + m.b) * 6 + env.wind.x * env.wind.strength * t * 3;
        const ground = m.y + Math.cos(t * 0.7 + m.b) * 12;
        const lift = 16 + Math.sin(t * 3.1 + m.a) * 5;
        m.img.setPosition(Math.round(x), Math.round(ground - lift)).setFrame(Math.floor(t * 9 + m.a) % 2)
          .setAlpha(out ? fade : Math.min(fade, 0.5)).setDepth(actorDepth(ground)).setVisible(inView(x, ground));
        continue;
      }
      if (!out || !this.flowerSpots.length || Math.random() > dt * 0.8) continue;
      const near = this.flowerSpots.filter(([x, y]) => inView(x, y));
      if (!near.length) continue;
      const [x, y] = near[Math.floor(Math.random() * near.length)]!;
      Object.assign(m, { on: true, age: 0, life: 10 + Math.random() * 14, x, y, a: Math.random() * 6, b: Math.random() * 6 });
      m.img.setTexture(`life:butterfly${Math.floor(Math.random() * BUTTERFLY_COLOURS.length)}`, 0).setAlpha(0).setVisible(true);
    }
  }

  // Leaves shaken loose in a wind: from the canopy of a tree in view, down and downwind to the grass.
  private fall(dt: number, env: LifeEnv, inView: (x: number, y: number) => boolean): void {
    const s = env.wind.strength;
    if (s > 0.25) {
      for (const tree of this.trees) {
        if (!tree.img.visible || Math.random() > dt * s * 1.3) continue;
        const art = TOWN_MANIFEST[tree.sprite]!;
        const x = tree.x + (Math.random() - 0.5) * art.w * 0.6, y = tree.baseY - art.h * (0.45 + Math.random() * 0.4);
        if (!inView(x, y)) continue;
        const m = this.take(this.leaves);
        if (!m) break;
        Object.assign(m, { on: true, age: 0, life: 1.4, x, y, vx: env.wind.x * (18 + 30 * s), vy: 16 + Math.random() * 10, a: (Math.random() - 0.5) * 400, b: Math.random() * 6, ground: tree.baseY + (Math.random() - 0.4) * 30 });
        m.img.setTexture(`life:leaf${Math.floor(Math.random() * LEAF_COLOURS.length)}`, 0).setAlpha(1).setVisible(true).setDepth(actorDepth(m.ground));
      }
    }
    for (const m of this.leaves) {
      if (!m.on) continue;
      if (m.y < m.ground) {
        m.x += (m.vx + Math.sin(this.time * 3 + m.b) * 10) * dt; m.y += m.vy * dt;
        m.img.setPosition(m.x, m.y).setAngle(m.img.angle + m.a * dt);
      } else {
        m.age += dt;
        if (m.age >= m.life) { this.retire(m); continue; }
        m.img.setAlpha(1 - m.age / m.life);
      }
    }
  }
}
