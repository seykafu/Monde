import Phaser from 'phaser';
import type { ZoneDef } from '../../world/zoneFormat';
import { DEPTH } from '../depth';
import { TH, TW, groundMap } from './autotile';
import { mix } from './materials';
import { WINDOW, wallMap, windowPanes } from './roomArt';

// ─────────────────────────────────────────────────────────────────────────────
// A room's light (MVP W-03; GDD §16.4 "Light", indoors). The board (TownBoard) draws the floor, the walls and the
// furniture; this adds what the clock changes in a room:
//
//   windows    the back wall's panes show the sky outside: pale blue by day (greyer under cloud, rain or fog), warm at
//              dawn and dusk, deep blue at night
//   daylight   a soft patch of light on the floor under each window and inside the doorway, as strong as the day is
//              bright (none at night)
//
// No sun shadows indoors and no weather falling; ZoneScene keeps the lamps (oil lamps, lanterns, the fire, the oven)
// lit a little all day and fully after dark, and darkens the room less than the street at night (it is lamplit).
// ─────────────────────────────────────────────────────────────────────────────

/** Sky colours seen through a window. Art tuning. */
const SKY_DAY = 0xbfe2f4;
const SKY_GREY = 0xc6ccd2;
const SKY_TWILIGHT = 0xf4b47c;
const SKY_NIGHT = 0x1e2a52;
const GLINT = 0xf6fbff;

export interface RoomLight {
  /** sim/sunAngle darkness, 0..1. */
  dark: number;
  /** sim/sunAngle twilightGlow, 0..1. */
  twilight: number;
  /** How much of the sky is cloud (0 clear … 1 overcast or foggy). */
  grey: number;
}

/** A soft trapezoid of light, wider at the bottom: a window's (or the doorway's) light on the floor. Made once. */
function ensurePatch(scene: Phaser.Scene): string {
  const key = 'room:sunpatch';
  if (scene.textures.exists(key)) return key;
  const W = 64, H = 64;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const c = tex.getContext();
  const img = c.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1), half = W * (0.28 + 0.2 * t);
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - W / 2) / half;
      if (d >= 1) continue;
      const a = (1 - d * d) * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.05)) * 0.9;
      const i = (y * W + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 236; img.data[i + 2] = 196; img.data[i + 3] = Math.round(255 * Math.max(0, a));
    }
  }
  c.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

export class InteriorRoom {
  /** Everything it made (all world objects). */
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly panes: Phaser.GameObjects.Graphics;
  private readonly rects: { x: number; y: number; w: number; h: number }[];
  private readonly patches: Phaser.GameObjects.Image[] = [];
  private key = '';

  constructor(scene: Phaser.Scene, zone: ZoneDef) {
    const look = zone.interior!.room;
    const map = groundMap(zone.width, zone.height, (x, y) => zone.tiles[y * zone.width + x]!.kind!);
    const walls = wallMap(map);
    this.rects = windowPanes(map, walls, look);
    this.panes = scene.add.graphics().setDepth(DEPTH.TERRAIN_FX);
    this.objects.push(this.panes);
    const patch = ensurePatch(scene);
    // Under each window: its light on the floor in front of the back wall.
    for (const cx of look.windows) {
      const row = walls.floorRow[cx] ?? -1;
      if (row < 0) continue;
      const x = cx * TW + (WINDOW.x0 + WINDOW.x1) / 2, y = row * TH + TH * 1.05;
      const img = scene.add.image(x, y, patch).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.LIGHT - 0.1)
        .setDisplaySize(TW * 1.05, TH * 2.2).setAlpha(0);
      this.patches.push(img);
    }
    // In the doorway: the street's light, falling inward (the patch upside down).
    const door = zone.interior!.door;
    const step = scene.add.image((door[0] + 0.5) * TW, (door[1] - 0.4) * TH, patch).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.LIGHT - 0.1).setDisplaySize(TW * 1.3, TH * 1.8).setFlipY(true).setAlpha(0);
    this.patches.push(step);
    this.objects.push(...this.patches);
  }

  /** The clock's light through the windows and the door (cheap when nothing changed). */
  applyLight(light: RoomLight): void {
    const key = `${light.dark.toFixed(2)}:${light.twilight.toFixed(2)}:${light.grey.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    let sky = mix(SKY_DAY, SKY_GREY, Math.min(1, light.grey));
    sky = mix(sky, SKY_TWILIGHT, light.twilight * 0.75);
    sky = mix(sky, SKY_NIGHT, light.dark);
    const g = this.panes.clear();
    for (const r of this.rects) {
      g.fillStyle(sky, 1).fillRect(r.x, r.y, r.w, r.h);
      // A glint across the glass (by day), a dim reflection of the room's lamps (at night).
      g.fillStyle(light.dark > 0.5 ? 0xffc46b : GLINT, light.dark > 0.5 ? 0.18 : 0.55 * (1 - light.dark));
      g.fillRect(r.x + 1, r.y + 1, Math.max(1, Math.floor(r.w / 3)), 1).fillRect(r.x + 1, r.y + 2, 1, Math.max(1, Math.floor(r.h / 3)));
    }
    const day = (1 - light.dark) * (1 - 0.65 * light.grey);
    for (const p of this.patches) p.setAlpha(0.3 * day).setVisible(day > 0.02);
  }
}
