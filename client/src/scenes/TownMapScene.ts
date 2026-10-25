// The map of Monde (Kasey, 2026-10-24: "a teleport feature with a full map of Monde to skip to each part"). Opened
// over ZoneScene with M or the HUD's Map button (or from a task in the Tasks menu), closed with M or Esc; the clock is
// held for "map" while it's open and the zone's input is paused (§5.3: time stops in menus).
//
// Every district board, tile by tile, laid out as the town connects (world/townMap.ts layoutTown), with the roads
// between them, the named places at their doors, where the player is, and a pin at each place with tasks (how many,
// red for the one on the HUD, faded when they're all waiting on something). Pick a
// place or a district (click, the arrows, Tab for the next task) and travel there: Enter, a double click or "Go
// there". Travel closes the map and fades the zone out and in at the place, as a door or an edge does
// (ZoneScene.travel → scene.restart({ zone, arrive })). It waits for anything that stops time (world/townMap.ts
// travelBlocked). GDD-GAP: nothing says what travel costs; it is free and takes no game time (§18 note).
import Phaser from 'phaser';
import { reducedMotion, textSize } from '../accessibility/runtime';
import { playSfx } from '../audio/Sfx';
import { sitePlaceName } from '../projects/runtime';
import { districtPhrase, type Objectives } from '../quests/objective';
import { tasksNow } from '../quests/runtime';
import { OBJECTIVE_KEY, TASKS_KEY } from '../quests/state';
import { taskIdFor, type Task } from '../quests/tasks';
import type { Clock } from '../sim/clock';
import { FAMILY_BODY, FAMILY_DISPLAY, FAMILY_HEADING, FAMILY_UI, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import {
  destination, layoutTown, mapPlaces, mapTileColor, nearestInDirection, placeOnMap, playerOnMap, travelBlocked,
  type Destination, type Direction, type TownMapLayout, type TravelState
} from '../world/townMap';
import { doorLinks, interiors, zones } from '../world/zones';
import { doorLocked } from './zone/indoors';

export const TOWN_MAP_SCENE = 'TownMap';

/** What the map asks of the zone underneath (ZoneScene). */
export interface TravelHost {
  /** The board the player is on (a district or a room). */
  boardId(): string;
  playerPosition(): { x: number; y: number };
  travelState(): TravelState;
  /** Fade out and arrive at `dest`; `name` is where, for the toast. */
  travel(dest: Destination, name: string): void;
}

export interface TownMapOpen {
  host: string;
  clock: Clock;
  /** A place (`zone.place`) or district to have chosen when the map opens. */
  focus?: string | null;
}

/** The overlays the map won't open over. */
const BUSY = ['TownMap', 'Tasks', 'People', 'TownLedger', 'Dialogue', 'Story', 'Fellowship', 'Bag', 'DawnReport', 'SaveMenu', 'Scuffle', 'SpringPuzzle', 'WorkPuzzle', 'ProjectBeat'];

/** Open the map over `host` (no-op while another menu, a scene or a conversation is up). */
export function openTownMap(host: Phaser.Scene, clock: Clock, opts: { focus?: string | null } = {}): void {
  if (BUSY.some(key => host.scene.isActive(key)) || !claimMenuFrame(host)) return;
  if (!host.scene.get(TOWN_MAP_SCENE)) host.scene.add(TOWN_MAP_SCENE, TownMapScene, false);
  host.scene.launch(TOWN_MAP_SCENE, { host: host.scene.key, clock, focus: opts.focus ?? null } satisfies TownMapOpen);
}

let launchedOn = -1;
/**
 * One menu a frame: Phaser queues a launch, so a menu opened this frame isn't active yet and the others' BUSY checks
 * would let a second one open over it (T and M together, or a key and a button click).
 */
export function claimMenuFrame(host: Phaser.Scene): boolean {
  const frame = host.game.loop.frame;
  if (frame === launchedOn) return false;
  launchedOn = frame;
  return true;
}

// Layout (design px, 1280×720): the Journal's cloth and paper, the map on the left, the notes on the right.
const BX = 30, BY = 24, BW = GAME_WIDTH - 60, BH = GAME_HEIGHT - 48;
const MAP_X = BX + 22, MAP_Y = BY + 20, MAP_W = 846, MAP_H = BH - 40;
const SIDE_X = MAP_X + MAP_W + 26, SIDE_W = BX + BW - SIDE_X - 22;
const CLOTH = 0x2c4a44, CLOTH_EDGE = 0x1d332e, CLOTH_STITCH = 0x6f8f7f, PAPER = 0xf2e8d0, PAPER_EDGE = 0xe3d4b0;
const INK = 0x2b2219, INK_CSS = '#2b2219', MUTED = '#6f6150', BRASS = 0xa67c2e, BRASS_CSS = '#8a6a24', GOLD = 0xe4c77f, RED = 0xb8403a;
/** The texture of the boards' tiles, painted once a game session (the ground doesn't change). */
const GROUND_KEY = 'monde-town-map';

/** "The Lamplighter’s Cottage": a place's name standing alone. */
const named = (place: string): string => { const n = sitePlaceName(place); return n.charAt(0).toUpperCase() + n.slice(1); };

/** Something on the map to choose: a place or a district. */
interface Pick { id: string; name: string; zone: string; x: number; y: number; kind: 'place' | 'district'; minor: boolean }

export class TownMapScene extends Phaser.Scene {
  private open!: TownMapOpen;
  private layout!: TownMapLayout;
  private cell = 5;
  private ox = 0;
  private oy = 0;
  private picks: Pick[] = [];
  private tasks: Task[] = [];
  /** One pin per place with tasks: the pick it stands on and the tasks there. */
  private pins: { pick: Pick; tasks: Task[] }[] = [];
  private hudTask = '';
  private selected: Pick | null = null;
  private hovered: Pick | null = null;
  private ring!: Phaser.GameObjects.Graphics;
  private hoverRing!: Phaser.GameObjects.Graphics;
  private tip!: Phaser.GameObjects.Text;
  private side!: Phaser.GameObjects.Container;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private message = '';
  /** Why travel was refused when the notes were drawn ('' when it wasn't): they're redrawn when that changes. */
  private shownBlock = '';
  private openedAt = 0;
  private lastClick = { id: '', at: 0 };
  private closing = false;
  private seenKeys = new WeakSet<KeyboardEvent>();

  constructor() { super(TOWN_MAP_SCENE); }

  init(data: TownMapOpen): void {
    this.open = data;
    this.pins = [];
    this.closing = false;
    this.selected = null;
    this.hovered = null;
    this.message = '';
    this.labels = new Map();
  }

  private get host(): (Phaser.Scene & Partial<TravelHost>) | null { return this.scene.get(this.open.host) as (Phaser.Scene & Partial<TravelHost>) | null; }

  create(): void {
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.openedAt = performance.now();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x10140f, 0.6).setOrigin(0).setInteractive();
    this.drawBook();

    this.layout = layoutTown(zones);
    this.cell = Math.min(MAP_W / this.layout.width, MAP_H / this.layout.height);
    this.ox = MAP_X + (MAP_W - this.layout.width * this.cell) / 2;
    this.oy = MAP_Y + (MAP_H - this.layout.height * this.cell) / 2;
    this.drawGround();
    this.drawRoads();

    const objectives = this.registry.get(OBJECTIVE_KEY) as Objectives | undefined;
    this.tasks = (this.registry.get(TASKS_KEY) as Task[] | undefined) ?? tasksNow(this.registry, objectives);
    const places = mapPlaces(this.layout, zones, doorLinks, named);
    const targets = new Set(this.tasks.flatMap(t => t.place ? [t.place] : []));
    this.picks = [
      ...this.layout.boards.map(b => ({ id: b.id, name: b.name, zone: b.id, x: b.x + b.w / 2, y: b.y + 1.6, kind: 'district' as const, minor: false })),
      ...places.filter(p => !p.minor || targets.has(p.id)).map(p => ({ id: p.id, name: p.name, zone: p.zone, x: p.x, y: p.y, kind: 'place' as const, minor: p.minor }))
    ];
    this.drawPlaces(places);
    this.drawTaskPins(objectives);
    this.drawLegend();
    this.drawPlayer();
    this.ring = this.add.graphics();
    this.hoverRing = this.add.graphics();
    this.tip = this.add.text(0, 0, '', { fontFamily: FAMILY_BODY, fontSize: '13px', color: '#fff0ce', backgroundColor: '#28372dee', padding: { x: 6, y: 3 }, resolution: RENDER_SCALE })
      .setOrigin(0.5, 1).setVisible(false).setDepth(10);
    this.side = this.add.container(0, 0);

    // What's chosen first: the place asked for, else the HUD's task's place, else where the player is.
    const hudTask = this.tasks.find(t => t.id === this.hudTask);
    const board = this.host?.boardId?.() ?? 'old_quarter';
    const district = zones[board] ? board : interiors[board]?.interior?.district ?? 'old_quarter';
    this.select(this.pickFor(this.open.focus ?? null) ?? this.pickFor(hudTask?.place ?? null) ?? this.pickFor(district), false);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { const at = this.cameras.main.getWorldPoint(p.x, p.y); this.hover(this.pickAt(at.x, at.y)); });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.click(p));
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    // A hold that lifts (or starts) while the map is open changes the button.
    this.time.addEvent({ delay: 400, loop: true, callback: () => {
      const sel = this.selected;
      if (sel && !this.closing && this.blocked(sel, this.destinationOf(sel)) !== this.shownBlock) this.drawSide();
    } });
    playSfx('page_turn');
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  // ── Map coordinates ──────────────────────────────────────────────────────

  private sx(x: number): number { return this.ox + x * this.cell; }
  private sy(y: number): number { return this.oy + y * this.cell; }

  /** The pick for a place or a district id (a room's place or a flat upstairs: its building on the street). */
  private pickFor(id: string | null): Pick | null {
    if (!id) return null;
    const exact = this.picks.find(p => p.id === id);
    if (exact) return exact;
    const at = id.includes('.') ? placeOnMap(this.layout, zones, interiors, id) : null;
    return at ? this.picks.find(p => p.kind === 'place' && Math.abs(p.x - at[0]) < 0.01 && Math.abs(p.y - at[1]) < 0.01) ?? null : null;
  }

  /** The pick under the pointer (design px): the nearest within reach, places before districts. */
  private pickAt(px: number, py: number): Pick | null {
    let best: Pick | null = null, bestD = 13;
    for (const p of this.picks) {
      const d = Math.hypot(this.sx(p.x) - px, this.sy(p.y) - py) + (p.kind === 'district' ? 6 : 0);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (best) return best;
    // Anywhere else on a board: that district.
    const tx = (px - this.ox) / this.cell, ty = (py - this.oy) / this.cell;
    const b = this.layout.boards.find(q => tx >= q.x && tx < q.x + q.w && ty >= q.y && ty < q.y + q.h);
    return b ? this.picks.find(p => p.id === b.id) ?? null : null;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private drawBook(): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(BX + 8, BY + 10, BW, BH, 16);
    g.fillStyle(CLOTH, 1).fillRoundedRect(BX - 14, BY - 12, BW + 28, BH + 24, 16);
    g.lineStyle(2, CLOTH_EDGE, 1).strokeRoundedRect(BX - 14, BY - 12, BW + 28, BH + 24, 16);
    g.lineStyle(1, CLOTH_STITCH, 0.7);
    for (let x = BX - 4; x < BX + BW + 4; x += 14) { g.lineBetween(x, BY - 6, x + 7, BY - 6); g.lineBetween(x, BY + BH + 6, x + 7, BY + BH + 6); }
    g.fillGradientStyle(PAPER, PAPER_EDGE, PAPER, PAPER_EDGE, 1).fillRect(BX, BY, BW, BH);
    g.fillStyle(INK, 0.1).fillRect(SIDE_X - 15, BY, 3, BH);
    this.add.text(SIDE_X, BY + 18, 'Monde', { fontFamily: FAMILY_DISPLAY, fontSize: '38px', color: INK_CSS, resolution: RENDER_SCALE });
    this.add.text(SIDE_X + 2, BY + 62, 'A map of the town', { fontFamily: FAMILY_BODY, fontSize: '15px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE });
    g.fillStyle(INK, 1).fillRect(SIDE_X, BY + 88, SIDE_W, 2).fillRect(SIDE_X, BY + 92, SIDE_W, 1);
    this.add.text(SIDE_X + SIDE_W, BY + BH - 16, 'Arrows: move  ·  Tab: places with tasks  ·  Enter: go  ·  M or Esc: close', {
      fontFamily: FAMILY_UI, fontSize: '12px', color: MUTED, resolution: RENDER_SCALE, wordWrap: { width: SIDE_W }, align: 'right'
    }).setOrigin(1, 1);
  }

  /** Every board's tiles, one small square each, on a texture painted once. */
  private drawGround(): void {
    const { width, height } = this.layout, s = RENDER_SCALE * 2;
    if (!this.textures.exists(GROUND_KEY)) {
      const tex = this.textures.createCanvas(GROUND_KEY, width * s, height * s);
      if (tex) {
        const ctx = tex.getContext();
        for (const b of this.layout.boards) {
          const z = zones[b.id]!;
          for (let y = 0; y < z.height; y++) for (let x = 0; x < z.width; x++) {
            ctx.fillStyle = `#${mapTileColor(z.tiles[y * z.width + x]!).toString(16).padStart(6, '0')}`;
            ctx.fillRect((b.x + x) * s, (b.y + y) * s, s, s);
          }
        }
        tex.refresh();
      }
    }
    this.add.image(this.ox, this.oy, GROUND_KEY).setOrigin(0).setScale(this.cell / s);
    const g = this.add.graphics();
    for (const b of this.layout.boards) {
      g.lineStyle(2, INK, 0.55).strokeRect(this.sx(b.x), this.sy(b.y), b.w * this.cell, b.h * this.cell);
    }
  }

  /** The roads between the boards, as wide as their openings. */
  private drawRoads(): void {
    const g = this.add.graphics();
    for (const l of this.layout.links) {
      const ax = this.sx(l.a[0]), ay = this.sy(l.a[1]), bx = this.sx(l.b[0]), by = this.sy(l.b[1]);
      g.lineStyle(this.cell * 3, 0xd2bb8e, 1).lineBetween(ax, ay, bx, by);
      g.lineStyle(1, INK, 0.35);
      const nx = ay === by ? 0 : this.cell * 1.5, ny = ay === by ? this.cell * 1.5 : 0;
      g.lineBetween(ax - nx, ay - ny, bx - nx, by - ny).lineBetween(ax + nx, ay + ny, bx + nx, by + ny);
    }
  }

  private drawPlaces(places: ReturnType<typeof mapPlaces>): void {
    const g = this.add.graphics();
    for (const p of places) {
      const x = this.sx(p.x), y = this.sy(p.y);
      if (p.minor) g.fillStyle(INK, 0.35).fillCircle(x, y, 2);
      else g.fillStyle(0xfff6e0, 1).fillCircle(x, y, 4.5).fillStyle(p.room ? INK : 0x5a4a38, 1).fillCircle(x, y, 3);
    }
    // District names, then place labels where they fit (the rest show on hover or when chosen).
    const taken: Phaser.Geom.Rectangle[] = [];
    for (const b of this.layout.boards) {
      const t = this.add.text(this.sx(b.x + b.w / 2), this.sy(b.y) + 6, b.name.toUpperCase(), {
        fontFamily: FAMILY_HEADING, fontSize: '17px', fontStyle: 'bold', color: '#fbf3df', backgroundColor: '#2c4a44dd', padding: { x: 7, y: 2 }, resolution: RENDER_SCALE
      }).setOrigin(0.5, 0);
      taken.push(t.getBounds());
    }
    const order = [...places].filter(p => !p.minor).sort((a, b) => Number(b.room) - Number(a.room) || a.name.length - b.name.length);
    for (const p of order) {
      const t = this.add.text(0, 0, p.name, { fontFamily: FAMILY_UI, fontSize: '11px', color: INK_CSS, backgroundColor: '#f2e8d0cc', padding: { x: 2, y: 0 }, resolution: RENDER_SCALE });
      const x = this.sx(p.x), y = this.sy(p.y);
      const spots: [number, number, number, number][] = [[x, y + 5, 0.5, 0], [x, y - 5, 0.5, 1], [x + 6, y, 0, 0.5], [x - 6, y, 1, 0.5]];
      const fit = spots.find(([sx, sy, ox, oy]) => {
        t.setPosition(sx, sy).setOrigin(ox, oy);
        const r = t.getBounds();
        return r.left >= MAP_X && r.right <= MAP_X + MAP_W && !taken.some(o => Phaser.Geom.Rectangle.Overlaps(o, r));
      });
      if (fit) taken.push(t.getBounds()); else t.setVisible(false);
      this.labels.set(p.id, t);
    }
  }

  private drawTaskPins(objectives: Objectives | undefined): void {
    this.hudTask = objectives ? taskIdFor(objectives.hud) : '';
    for (const task of this.tasks) {
      const pick = task.place ? this.pickFor(task.place) : null;
      if (!pick) continue;
      const pin = this.pins.find(p => p.pick === pick);
      if (pin) pin.tasks.push(task); else this.pins.push({ pick, tasks: [task] });
    }
    const g = this.add.graphics();
    for (const { pick, tasks } of this.pins) {
      const on = tasks.some(t => t.id === this.hudTask), live = on || tasks.some(t => t.actionable || t.kind === 'main');
      const x = this.sx(pick.x), y = this.sy(pick.y) - 5, a = live ? 1 : 0.6;
      g.fillStyle(0x000000, 0.25 * a).fillEllipse(x, y + 6, 10, 4);
      g.fillStyle(INK, a).fillTriangle(x - 5, y - 9, x + 5, y - 9, x, y + 5).fillCircle(x, y - 12, 8.5);
      g.fillStyle(on ? RED : GOLD, a).fillTriangle(x - 3.5, y - 9, x + 3.5, y - 9, x, y + 2).fillCircle(x, y - 12, 6.8);
      this.add.text(x, y - 12, String(tasks.length), { fontFamily: FAMILY_UI, fontSize: '10px', fontStyle: 'bold', color: on ? '#fff6e0' : INK_CSS, resolution: RENDER_SCALE })
        .setOrigin(0.5).setAlpha(a);
    }
  }

  /** What the marks mean, in the corner the map leaves empty. */
  private drawLegend(): void {
    const x = MAP_X + 6, y = MAP_Y + MAP_H - 96, g = this.add.graphics();
    g.fillStyle(PAPER, 0.92).fillRoundedRect(x, y, 196, 92, 8).lineStyle(1, INK, 0.3).strokeRoundedRect(x, y, 196, 92, 8);
    g.fillStyle(0x2f6fb0, 1).fillCircle(x + 18, y + 18, 5.5).lineStyle(2, 0xffffff, 1).strokeCircle(x + 18, y + 18, 5.5);
    g.fillStyle(INK, 1).fillCircle(x + 18, y + 38, 9).fillStyle(RED, 1).fillCircle(x + 18, y + 38, 7);
    g.fillStyle(INK, 1).fillCircle(x + 18, y + 58, 9).fillStyle(GOLD, 1).fillCircle(x + 18, y + 58, 7);
    g.fillStyle(0xfff6e0, 1).fillCircle(x + 18, y + 78, 4.5).fillStyle(INK, 1).fillCircle(x + 18, y + 78, 3);
    const line = (dy: number, s: string) => this.add.text(x + 34, y + dy, s, { fontFamily: FAMILY_UI, fontSize: '12px', color: INK_CSS, resolution: RENDER_SCALE }).setOrigin(0, 0.5);
    line(18, 'You'); line(38, 'Your objective (on the HUD)'); line(58, 'Tasks here (how many)'); line(78, 'A place: pick it to go there');
  }

  private drawPlayer(): void {
    const host = this.host, board = host?.boardId?.(), pos = host?.playerPosition?.();
    const at = board && pos ? playerOnMap(this.layout, doorLinks, board, pos) : null;
    if (!at) return;
    const x = this.sx(at[0]), y = this.sy(at[1]);
    const halo = this.add.circle(x, y, 9, 0x2f6fb0, 0.3);
    this.add.circle(x, y, 5.5, 0x2f6fb0, 1).setStrokeStyle(2, 0xffffff, 1);
    this.add.text(x, y - 10, 'You', { fontFamily: FAMILY_UI, fontSize: '12px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#2f6fb0', padding: { x: 4, y: 1 }, resolution: RENDER_SCALE }).setOrigin(0.5, 1);
    if (!reducedMotion()) this.tweens.add({ targets: halo, scale: 1.8, alpha: 0, duration: 1100, repeat: -1 });
  }

  // ── Choosing ─────────────────────────────────────────────────────────────

  private hover(p: Pick | null): void {
    if (p === this.hovered) return;
    this.hovered = p;
    this.hoverRing.clear();
    this.tip.setVisible(false);
    if (!p || p === this.selected) return;
    if (p.kind === 'place') this.hoverRing.lineStyle(2, BRASS, 0.9).strokeCircle(this.sx(p.x), this.sy(p.y), 8);
    if (p.kind === 'place' && !this.labels.get(p.id)?.visible) this.tip.setText(p.name).setPosition(this.sx(p.x), this.sy(p.y) - 9).setVisible(true);
  }

  private click(pointer: Phaser.Input.Pointer): void {
    if (this.closing) return;
    // The pointer is in the canvas's pixels; the map is drawn in design pixels (util/renderScale).
    const at = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const p = this.pickAt(at.x, at.y);
    if (!p) return;
    const now = performance.now(), again = this.lastClick.id === p.id && now - this.lastClick.at < 400;
    this.lastClick = { id: p.id, at: now };
    if (again) { this.travel(); return; }
    this.select(p);
  }

  private select(p: Pick | null, sound = true): void {
    if (!p) return;
    if (sound && p !== this.selected) playSfx('click');
    this.selected = p;
    this.message = '';
    this.ring.clear();
    if (p.kind === 'place') this.ring.lineStyle(3, RED, 1).strokeCircle(this.sx(p.x), this.sy(p.y), 9);
    else {
      const b = this.layout.boards.find(q => q.id === p.id)!;
      this.ring.lineStyle(3, RED, 0.9).strokeRect(this.sx(b.x) - 2, this.sy(b.y) - 2, b.w * this.cell + 4, b.h * this.cell + 4);
    }
    this.hover(this.hovered === p ? null : this.hovered);
    this.drawSide();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.closing || this.seenKeys.has(e)) return;
    this.seenKeys.add(e);
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') { this.close(); return; }
    if ((key === 'm' || e.code === 'KeyM') && !e.repeat && performance.now() - this.openedAt > 150) { this.close(); return; }
    const dir: Direction | null = e.key === 'ArrowLeft' || key === 'a' ? 'left' : e.key === 'ArrowRight' || key === 'd' ? 'right'
      : e.key === 'ArrowUp' || key === 'w' ? 'up' : e.key === 'ArrowDown' || key === 's' ? 'down' : null;
    if (dir && this.selected) {
      this.select(nearestInDirection(this.picks.filter(p => p.kind === 'place'), this.selected, dir));
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!this.pins.length) return;
      const i = this.pins.findIndex(p => p.pick === this.selected);
      this.select(this.pins[(i + (e.shiftKey ? this.pins.length - 1 : 1) + this.pins.length) % this.pins.length]!.pick);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') this.travel();
  }

  // ── The notes on the right ───────────────────────────────────────────────

  private text(x: number, y: number, s: string, size: number, opts: { color?: string; family?: string; italic?: boolean; bold?: boolean; wrap?: number } = {}): Phaser.GameObjects.Text {
    const family = opts.family ?? FAMILY_BODY;
    const t = this.add.text(x, y, s, {
      fontFamily: family, fontSize: `${family === FAMILY_BODY || family === FAMILY_HEADING ? textSize(size) : size}px`, color: opts.color ?? INK_CSS,
      fontStyle: [opts.italic ? 'italic' : '', opts.bold ? 'bold' : ''].join(' ').trim() || 'normal',
      resolution: RENDER_SCALE, wordWrap: { width: opts.wrap ?? SIDE_W }
    });
    this.side.add(t);
    return t;
  }

  /** Where the player is, what's chosen and whether they can go, and the tasks' places. Redrawn on every change. */
  private drawSide(): void {
    this.side.removeAll(true);
    const host = this.host, sel = this.selected;
    let y = BY + 104;
    const board = host?.boardId?.() ?? '';
    const room = interiors[board]?.interior;
    const here = room ? `${sitePlaceName(`${room.district}.${room.building}`)}, ${districtPhrase(zones[room.district]?.name ?? room.district)}` : districtPhrase(zones[board]?.name ?? '');
    y += this.text(SIDE_X, y, `You are in ${here}.`, 15, { color: MUTED, italic: true }).height + 14;
    if (sel) {
      y += this.text(SIDE_X, y, sel.name, 24, { family: FAMILY_HEADING }).height + 2;
      y += this.text(SIDE_X, y, sel.kind === 'district' ? 'A district' : zones[sel.zone]?.name ?? sel.zone, 14, { family: FAMILY_UI, color: BRASS_CSS, bold: true }).height + 8;
      for (const t of this.pins.find(p => p.pick === sel)?.tasks ?? []) {
        y += this.text(SIDE_X, y, `${t.id === this.hudTask ? '◆ ' : ''}${t.title}: ${t.next}`, 14, { color: t.actionable || t.kind === 'main' ? INK_CSS : MUTED }).height + 4;
      }
      const dest = this.destinationOf(sel);
      if (dest?.note) y += this.text(SIDE_X, y, `${dest.note} You’d wait on the doorstep.`, 13, { italic: true, color: MUTED }).height + 4;
      y += 8;
      const blocked = this.blocked(sel, dest);
      this.shownBlock = blocked;
      const bw = SIDE_W, bh = 40;
      const btn = this.add.graphics();
      btn.fillStyle(blocked ? 0xcabfa4 : CLOTH, 1).fillRoundedRect(SIDE_X, y, bw, bh, 8);
      btn.lineStyle(2, blocked ? 0xa99d82 : GOLD, 1).strokeRoundedRect(SIDE_X, y, bw, bh, 8);
      const label = this.add.text(SIDE_X + bw / 2, y + bh / 2, blocked ? 'Can’t go just now' : `Go there  (Enter)`, {
        fontFamily: FAMILY_UI, fontSize: '17px', fontStyle: 'bold', color: blocked ? '#7d735f' : '#fff0ce', resolution: RENDER_SCALE
      }).setOrigin(0.5);
      const hit = this.add.zone(SIDE_X, y, bw, bh).setOrigin(0).setInteractive({ useHandCursor: !blocked }).on('pointerdown', () => this.travel());
      this.side.add([btn, label, hit]);
      y += bh + 6;
      const why = this.message || blocked || 'Travel is free and takes no time.';
      y += this.text(SIDE_X, y, why, 13, { italic: true, color: this.message || blocked ? '#9c2f3a' : MUTED }).height + 16;
    }
    // The places with tasks, as their pins.
    if (this.pins.length) {
      y += this.text(SIDE_X, y, 'PLACES WITH TASKS', 13, { family: FAMILY_UI, color: BRASS_CSS, bold: true }).height + 6;
      for (const [i, pin] of this.pins.entries()) {
        if (y > BY + BH - 96) { this.text(SIDE_X, y, `and ${this.pins.length - i} more (Tab goes through them)`, 13, { italic: true, color: MUTED }); break; }
        const chosen = pin.pick === sel, on = pin.tasks.some(t => t.id === this.hudTask);
        const first = pin.tasks[0]!, more = pin.tasks.length > 1 ? ` and ${pin.tasks.length - 1} more` : '';
        const row = this.text(SIDE_X + 22, y, `${pin.pick.name}: ${first.title}${more}`, 14, { color: chosen ? INK_CSS : MUTED, wrap: SIDE_W - 22, bold: chosen });
        const dot = this.add.graphics().fillStyle(INK, 1).fillCircle(SIDE_X + 8, y + 9, 7.5).fillStyle(on ? RED : GOLD, 1).fillCircle(SIDE_X + 8, y + 9, 6);
        row.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.select(pin.pick));
        this.side.add(dot);
        y += row.height + 5;
      }
    } else this.text(SIDE_X, y, 'No task needs you anywhere in particular. The Tasks menu (T) has the rest.', 14, { italic: true, color: MUTED });
  }

  // ── Travel ───────────────────────────────────────────────────────────────

  /** Where travel to `p` arrives: a task's own place when a pin stands there (the HUD's first), else the pick. */
  private destinationOf(p: Pick): Destination | null {
    const tasks = this.pins.find(q => q.pick === p)?.tasks ?? [];
    const target = (tasks.find(t => t.id === this.hudTask) ?? tasks[0])?.place ?? p.id;
    return destination(target, { zones, interiors, links: doorLinks, locked: l => doorLocked(this.registry, l) });
  }

  /** Why the player can't go to `p` now, or ''. */
  private blocked(p: Pick, dest: Destination | null): string {
    const host = this.host;
    if (!host?.travel || !host.travelState || !dest) return 'The map can’t take you there.';
    const why = travelBlocked(host.travelState());
    if (why) return why;
    const me = host.playerPosition?.(), board = host.boardId?.();
    if (p.kind === 'place' && me && board === dest.zone && Math.hypot(me.x - dest.arrive[0] - 0.5, me.y - dest.arrive[1] - 0.5) < 1.5) return 'You’re here already.';
    if (p.kind === 'district' && board === p.id) return 'You’re in this district already.';
    return '';
  }

  private travel(): void {
    const p = this.selected, host = this.host;
    if (!p || this.closing || !host?.travel) return;
    const dest = this.destinationOf(p);
    const why = this.blocked(p, dest);
    if (why || !dest) { this.message = why; this.drawSide(); return; }
    playSfx('page_turn');
    this.closing = true;
    this.scene.stop();
    host.travel(dest, p.kind === 'district' ? districtPhrase(p.name) : p.name);
  }

  // ── Open and close ───────────────────────────────────────────────────────

  private pauseWorld(paused: boolean): void {
    const host = this.scene.get(this.open.host);
    if (host?.input) {
      host.input.enabled = !paused;
      const keys = host.input.keyboard;
      if (keys) { keys.enabled = !paused; keys.resetKeys(); }
    }
    if (paused) this.open.clock.pause('map'); else this.open.clock.resume('map');
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 120, onComplete: () => this.scene.stop() });
  }

  private teardown(): void {
    this.closing = true;
    this.input.keyboard?.removeAllListeners('keydown');
    this.input.removeAllListeners('pointermove');
    this.input.removeAllListeners('pointerdown');
    this.pins = [];
    this.picks = [];
    this.pauseWorld(false);
  }
}
