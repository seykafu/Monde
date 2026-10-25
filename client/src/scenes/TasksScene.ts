// The Tasks menu (Kasey, 2026-10-24: "a Tasks menu showing what to do whenever new side quests or main tasks
// arrive"). Opened over ZoneScene with T or the HUD's Tasks button, closed with T or Esc; the clock is held for
// "tasks" while it's open and the zone's input is paused, as the Journal does (§5.3: time stops in menus).
//
// One row per task (quests/tasks.ts, from the same Quest Log as the Journal's Quests page): the kind, the title, what
// to do next, and where (place · district) and when. The one the HUD's objective line shows is marked. ↑↓ (or W/S, the
// wheel) choose; Enter or a click on the chosen row opens the map on its place (scenes/TownMapScene.ts), where the
// player can travel there; J goes to the Journal's Quests page for the whole story.
import Phaser from 'phaser';
import { textSize } from '../accessibility/runtime';
import { playSfx } from '../audio/Sfx';
import type { Objectives } from '../quests/objective';
import { tasksNow } from '../quests/runtime';
import { OBJECTIVE_KEY } from '../quests/state';
import { taskIdFor, type Task, type TaskKind } from '../quests/tasks';
import type { Clock } from '../sim/clock';
import { FAMILY_BODY, FAMILY_DISPLAY, FAMILY_HEADING, FAMILY_UI, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { openPeople } from './PeopleScene';
import { claimMenuFrame, openTownMap } from './TownMapScene';

export const TASKS_SCENE = 'Tasks';

export interface TasksOpen {
  /** The scene underneath: its input is paused while the menu is open. */
  host: string;
  clock: Clock;
}

/** The overlays the menu won't open over (each holds the clock and the zone's keys itself). */
const BUSY = ['Tasks', 'TownMap', 'People', 'TownLedger', 'Dialogue', 'Story', 'Fellowship', 'Bag', 'DawnReport', 'SaveMenu', 'Scuffle', 'SpringPuzzle', 'WorkPuzzle', 'ProjectBeat'];

/** Open the Tasks menu over `host` (no-op while another menu, a scene or a conversation is up). */
export function openTasks(host: Phaser.Scene, clock: Clock): void {
  if (BUSY.some(key => host.scene.isActive(key)) || !claimMenuFrame(host)) return;
  if (!host.scene.get(TASKS_SCENE)) host.scene.add(TASKS_SCENE, TasksScene, false);
  host.scene.launch(TASKS_SCENE, { host: host.scene.key, clock } satisfies TasksOpen);
}

// Layout (design px, 1280×720): a card of the Journal's cloth and paper in the middle of the screen.
const PW = 800, PH = 640, PX = (GAME_WIDTH - PW) / 2, PY = (GAME_HEIGHT - PH) / 2;
const LIST_X = PX + 34, LIST_W = PW - 68, LIST_TOP = PY + 104, LIST_BOTTOM = PY + PH - 50;
const TEXT_X = LIST_X + 100, TEXT_W = LIST_W - 100 - 96;
const CLOTH = 0x2c4a44, CLOTH_EDGE = 0x1d332e, CLOTH_STITCH = 0x6f8f7f, PAPER = 0xf2e8d0, PAPER_EDGE = 0xe3d4b0;
const INK = 0x2b2219, INK_CSS = '#2b2219', MUTED = '#6f6150', BRASS_CSS = '#8a6a24', PICKED = 0xe6d6ae;
/** Each kind's badge: its word and colour. */
const BADGE: Readonly<Record<TaskKind, { word: string; color: number }>> = {
  main: { word: 'STORY', color: 0x9a6f22 }, favor: { word: 'FAVOR', color: 0x4f7d55 }, offer: { word: 'ASK', color: 0x3f7a86 },
  project: { word: 'PROJECT', color: 0x46648c }, dream: { word: 'DREAM', color: 0x8a5a86 }, mark: { word: 'MARK', color: 0x7a5a3a }
};

interface Row { task: Task; y: number; h: number; bg: Phaser.GameObjects.Graphics; map: Phaser.GameObjects.Text | null; hit: Phaser.GameObjects.Zone }

export class TasksScene extends Phaser.Scene {
  private open!: TasksOpen;
  private tasks: Task[] = [];
  private rows: Row[] = [];
  private picked = 0;
  private scroll = 0;
  private limit = 0;
  private content!: Phaser.GameObjects.Container;
  private openedAt = 0;
  private closed = false;
  private seenKeys = new WeakSet<KeyboardEvent>();

  constructor() { super(TASKS_SCENE); }

  init(data: TasksOpen): void {
    this.open = data;
    this.closed = false;
    this.rows = [];
    this.picked = 0;
    this.scroll = 0;
  }

  create(): void {
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.openedAt = performance.now();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    // A click outside the card closes the menu; the card itself swallows clicks.
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x10140f, 0.55).setOrigin(0).setInteractive().on('pointerdown', () => this.close());
    this.add.zone(PX - 14, PY - 12, PW + 28, PH + 24).setOrigin(0).setInteractive();
    this.drawCard();
    this.content = this.add.container(0, 0);
    const mask = this.make.graphics({}, false).fillRect(LIST_X - 6, LIST_TOP - 4, LIST_W + 12, LIST_BOTTOM - LIST_TOP + 8).createGeometryMask();
    this.content.setMask(mask);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => mask.destroy());

    this.tasks = tasksNow(this.registry, this.registry.get(OBJECTIVE_KEY) as Objectives | undefined);
    const hud = this.registry.get(OBJECTIVE_KEY) as Objectives | undefined;
    // From the top, the main story first; the HUD's task is marked wherever it is.
    this.drawRows(hud ? taskIdFor(hud.hud) : '');
    this.setScroll(0);
    this.pick(0, true);

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.move(Math.sign(dy) * 60));
    playSfx('page_turn');
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.closed || this.seenKeys.has(e)) return;
    this.seenKeys.add(e);
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') { this.close(); return; }
    // The T that opened the menu mustn't close it again.
    if ((key === 't' || e.code === 'KeyT') && !e.repeat && performance.now() - this.openedAt > 150) { this.close(); return; }
    if (e.key === 'ArrowDown' || key === 's') this.pick(this.picked + 1);
    else if (e.key === 'ArrowUp' || key === 'w') this.pick(this.picked - 1);
    else if (e.key === 'PageDown') this.move(300);
    else if (e.key === 'PageUp') this.move(-300);
    else if (e.key === 'Enter' || e.key === ' ' || key === 'm') this.showOnMap(this.tasks[this.picked]);
    else if (key === 'j') this.toJournal();
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  private showOnMap(task: Task | undefined): void {
    if (this.closed) return;
    const host = this.scene.get(this.open.host), clock = this.open.clock;
    if (task?.kind === 'mark') { this.toJournal('Marks'); return; }
    this.closeNow();
    // Next frame, once this menu is gone (each menu won't open over another).
    host.time.delayedCall(0, () => openTownMap(host, clock, { focus: task?.place ?? null }));
  }

  private toJournal(tab: 'Quests' | 'Marks' = 'Quests'): void {
    if (this.closed) return;
    const host = this.scene.get(this.open.host), clock = this.open.clock;
    this.closeNow();
    host.time.delayedCall(0, () => openPeople(host, clock, tab));
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /** The card: cloth boards with a stitched edge, a paper page, the title and the keys. Drawn once. */
  private drawCard(): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(PX + 8, PY + 10, PW, PH, 16);
    g.fillStyle(CLOTH, 1).fillRoundedRect(PX - 14, PY - 12, PW + 28, PH + 24, 16);
    g.lineStyle(2, CLOTH_EDGE, 1).strokeRoundedRect(PX - 14, PY - 12, PW + 28, PH + 24, 16);
    g.lineStyle(1, CLOTH_STITCH, 0.7);
    for (let x = PX - 4; x < PX + PW + 4; x += 14) { g.lineBetween(x, PY - 6, x + 7, PY - 6); g.lineBetween(x, PY + PH + 6, x + 7, PY + PH + 6); }
    g.fillGradientStyle(PAPER, PAPER, PAPER_EDGE, PAPER_EDGE, 1).fillRect(PX, PY, PW, PH);
    // A ribbon marker hanging from the top edge.
    g.fillStyle(0x9c2f3a, 1).fillRect(PX + PW - 70, PY - 12, 12, 58).fillTriangle(PX + PW - 70, PY + 46, PX + PW - 58, PY + 46, PX + PW - 64, PY + 38);
    this.add.text(LIST_X, PY + 22, 'Tasks', { fontFamily: FAMILY_DISPLAY, fontSize: '38px', color: INK_CSS, resolution: RENDER_SCALE });
    this.add.text(LIST_X + 112, PY + 40, 'What to do next, and where', { fontFamily: FAMILY_BODY, fontSize: '16px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE });
    g.fillStyle(INK, 1).fillRect(LIST_X, PY + 80, LIST_W, 2).fillRect(LIST_X, PY + 84, LIST_W, 1);
    this.add.text(PX + PW - 30, PY + PH - 26, '↑↓ choose  ·  Enter: on the map  ·  J: the Journal’s Quests  ·  T or Esc to close', {
      fontFamily: FAMILY_UI, fontSize: '13px', color: MUTED, resolution: RENDER_SCALE
    }).setOrigin(1, 0.5);
  }

  private text(x: number, y: number, s: string, size: number, opts: { color?: string; family?: string; italic?: boolean; bold?: boolean; wrap?: number } = {}): Phaser.GameObjects.Text {
    const family = opts.family ?? FAMILY_BODY;
    const t = this.add.text(x, y, s, {
      fontFamily: family, fontSize: `${family === FAMILY_BODY || family === FAMILY_HEADING ? textSize(size) : size}px`, color: opts.color ?? INK_CSS,
      fontStyle: [opts.italic ? 'italic' : '', opts.bold ? 'bold' : ''].join(' ').trim() || 'normal',
      resolution: RENDER_SCALE, ...(opts.wrap ? { wordWrap: { width: opts.wrap } } : {})
    });
    this.content.add(t);
    return t;
  }

  private drawRows(onHud: string): void {
    const waiting = this.tasks.filter(t => !t.actionable && t.kind !== 'main').length, todo = this.tasks.length - waiting;
    this.add.text(PX + PW - 90, PY + 50, [`${todo} to do`, waiting ? `${waiting} waiting` : ''].filter(Boolean).join('  ·  '), {
      fontFamily: FAMILY_UI, fontSize: '15px', color: BRASS_CSS, resolution: RENDER_SCALE
    }).setOrigin(1, 0.5);
    if (!this.tasks.length) {
      this.text(LIST_X, LIST_TOP + 8, 'Nothing to do just now.', 20, { family: FAMILY_HEADING });
      this.text(LIST_X, LIST_TOP + 40, 'Say hello to the neighbours (E): people ask for help once they know you, and the story finds you.', 16, { italic: true, color: MUTED, wrap: LIST_W });
      return;
    }
    let y = LIST_TOP;
    this.tasks.forEach((task, i) => {
      // The side quests waiting on something come last, under their own heading (quests/tasks.ts orders them so).
      if (!task.actionable && task.kind !== 'main' && (i === 0 || this.tasks[i - 1]!.actionable || this.tasks[i - 1]!.kind === 'main')) {
        const head = this.text(LIST_X, y + 14, 'WAITING ON SOMETHING: a day, a little more trust, the story', 13, { family: FAMILY_UI, color: MUTED, bold: true });
        y += head.height + 20;
      }
      const bg = this.add.graphics();
      this.content.add(bg);
      const top = y + 10;
      const badge = BADGE[task.kind];
      const b = this.add.graphics().fillStyle(badge.color, task.actionable ? 1 : 0.55).fillRoundedRect(LIST_X + 8, top + 2, 80, 22, 6);
      this.content.add(b);
      this.content.add(this.add.text(LIST_X + 48, top + 13, badge.word, { fontFamily: FAMILY_UI, fontSize: '12px', fontStyle: 'bold', color: '#fbf3df', resolution: RENDER_SCALE }).setOrigin(0.5));
      let ty = top;
      const title = this.text(TEXT_X, ty, task.title, 20, { family: FAMILY_HEADING, wrap: TEXT_W });
      ty += title.height + 2;
      if (task.id === onHud) {
        const tag = this.text(TEXT_X + Math.min(title.width, TEXT_W) + 10, top + 4, '◆ on your HUD', 12, { family: FAMILY_UI, color: BRASS_CSS, bold: true });
        // A long title: the tag goes on its own line under it.
        if (tag.x + tag.width > TEXT_X + TEXT_W + 90) { tag.setPosition(TEXT_X, ty); ty += tag.height + 2; }
      }
      const next = this.text(TEXT_X, ty, task.next, 16, { wrap: TEXT_W });
      ty += next.height + 3;
      const where = [task.placeName ? `⌖ ${task.where}` : task.where, task.when].filter(Boolean).join('  ·  ');
      const at = this.text(TEXT_X, ty, where, 14, { family: FAMILY_UI, color: task.place ? BRASS_CSS : MUTED, wrap: TEXT_W });
      ty += at.height + 2;
      if (task.detail) { const d = this.text(TEXT_X, ty, task.detail, 14, { italic: true, color: MUTED, wrap: TEXT_W }); ty += d.height + 2; }
      const h = ty - y + 10;
      // On the map: for anything with a place (a Mark's answer is in the Journal).
      const map = task.place || task.kind === 'mark'
        ? this.text(LIST_X + LIST_W - 10, top + 2, task.kind === 'mark' ? 'Journal ›' : 'Map ›', 15, { family: FAMILY_UI, color: BRASS_CSS, bold: true }).setOrigin(1, 0)
        : null;
      map?.setInteractive({ useHandCursor: true }).on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.inList(p)) this.showOnMap(task); });
      const hit = this.add.zone(LIST_X, y, LIST_W, h).setOrigin(0).setInteractive({ useHandCursor: true })
        .on('pointerdown', (p: Phaser.Input.Pointer) => { if (!this.inList(p)) return; if (this.picked === i) this.showOnMap(task); else this.pick(i); });
      this.content.add(hit);
      if (map) this.content.bringToTop(map);
      this.rows.push({ task, y, h, bg, map, hit });
      y += h;
      // A hairline between rows.
      const rule = this.add.graphics().fillStyle(INK, 0.12).fillRect(LIST_X, y, LIST_W, 1);
      this.content.add(rule);
    });
    this.limit = Math.max(0, y - LIST_BOTTOM + 6);
  }

  /** A click inside the list's window (rows scrolled out of it are masked, not gone). */
  private inList(p: Phaser.Input.Pointer): boolean {
    const y = this.cameras.main.getWorldPoint(p.x, p.y).y;
    return y >= LIST_TOP - 4 && y <= LIST_BOTTOM + 4;
  }

  private pick(i: number, force = false): void {
    if (!this.rows.length) return;
    const next = Phaser.Math.Clamp(i, 0, this.rows.length - 1);
    if (next === this.picked && !force) return;
    if (next !== this.picked) playSfx('click');
    this.picked = next;
    this.rows.forEach((r, k) => {
      r.bg.clear();
      if (k === next) r.bg.fillStyle(PICKED, 1).fillRoundedRect(LIST_X, r.y + 2, LIST_W, r.h - 4, 8).lineStyle(1.5, 0xa67c2e, 0.6).strokeRoundedRect(LIST_X, r.y + 2, LIST_W, r.h - 4, 8);
      r.map?.setAlpha(k === next ? 1 : 0.55);
    });
    // Keep the chosen row in view.
    const row = this.rows[next]!;
    if (row.y - this.scroll < LIST_TOP) this.setScroll(row.y - LIST_TOP);
    else if (row.y + row.h - this.scroll > LIST_BOTTOM) this.setScroll(row.y + row.h - LIST_BOTTOM);
  }

  private move(dy: number): void { this.setScroll(this.scroll + dy); }

  private setScroll(v: number): void {
    this.scroll = Phaser.Math.Clamp(v, 0, this.limit);
    this.content.y = -this.scroll;
    // Rows wholly outside the list's window are masked, not gone: they stop taking clicks (the backdrop's close).
    for (const r of this.rows) {
      const shown = r.y + r.h - this.scroll > LIST_TOP && r.y - this.scroll < LIST_BOTTOM;
      if (r.hit.input) r.hit.input.enabled = shown;
      if (r.map?.input) r.map.input.enabled = shown;
    }
  }

  // ── Open and close ───────────────────────────────────────────────────────

  private pauseWorld(paused: boolean): void {
    const host = this.scene.get(this.open.host);
    if (host?.input) {
      host.input.enabled = !paused;
      const keys = host.input.keyboard;
      if (keys) { keys.enabled = !paused; keys.resetKeys(); }
    }
    if (paused) this.open.clock.pause('tasks'); else this.open.clock.resume('tasks');
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 120, onComplete: () => this.scene.stop() });
  }

  /** Close at once, for the map or the Journal to open in its place. */
  private closeNow(): void {
    this.closed = true;
    this.scene.stop();
  }

  private teardown(): void {
    this.closed = true;
    this.input.keyboard?.removeAllListeners('keydown');
    this.input.removeAllListeners('wheel');
    this.rows = [];
    this.pauseWorld(false);
  }
}
