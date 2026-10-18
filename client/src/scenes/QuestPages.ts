// The Journal's Quests page (Kasey's playtest, 2026-10-18: "a quest log … as guidance"), drawn inside PeopleScene's
// two-page notebook like the Marks pages (scenes/MarkPages.ts). The data is quests/questLog.ts's QuestLog
// (quests/runtime.ts questLogNow).
//
//   left page   MAIN STORY: the objective (where, when, who, how to get there, why), or between beats the next beat
//               and something to do meanwhile; the last beats done, ticked. TOWN PROJECTS: each under way, its site
//               and next step.
//   right page  FAVORS: the ones taken on (task, where, by when) and who has one to ask. DREAMS: each known dream,
//               the resident, the dream in their words, the stages done ticked and the next step with what it waits for.
// Normal text: W/S or ↑↓ (and the wheel, Page Up / Page Down) scroll both pages when they run long. Larger text:
// ui/accessiblePages.ts reflows and scrolls them, as on every page. O shows or hides the HUD's objective line.
import Phaser from 'phaser';
import { accessibility, textSize } from '../accessibility/runtime';
import type { Objective } from '../quests/objective';
import type { QuestLog } from '../quests/questLog';
import { objectiveShown, setObjectiveShown } from '../quests/state';
import { FAMILY_BODY, FAMILY_HEADING, FAMILY_UI, RENDER_SCALE } from '../util/constants';

const INK_CSS = '#2b2219', MUTED = '#6f6150', BRASS_CSS = '#8a6a24', DONE_CSS = '#2f6b3a';

export interface QuestPageBox { lx: number; lw: number; rx: number; rw: number; top: number; bottom: number }

interface TextOpts { color?: string; family?: string; italic?: boolean; bold?: boolean; wrap?: number }

export class QuestPages {
  private scroll = 0;
  private limit = 0;
  private mask?: Phaser.Display.Masks.GeometryMask;
  private shape?: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene, private content: Phaser.GameObjects.Container, private box: QuestPageBox,
    private redraw: () => void, private names: (ids: readonly string[]) => string) {}

  /** Show or hide the HUD's objective line (remembered on this device). */
  toggleObjective(): void { setObjectiveShown(!objectiveShown()); this.redraw(); }

  /** A key on the Quests page: true when it was the page's. */
  key(e: KeyboardEvent): boolean {
    if (e.key === 'o' || e.key === 'O' || e.code === 'KeyO') { this.toggleObjective(); return true; }
    if (accessibility().textSize !== 'normal') return false;
    const step = e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' ? 60 : e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' ? -60
      : e.key === 'PageDown' ? 300 : e.key === 'PageUp' ? -300 : 0;
    if (!step) return false;
    this.move(step);
    return true;
  }

  wheel(dy: number): void { if (accessibility().textSize === 'normal') this.move(Math.sign(dy) * 60); }

  private move(dy: number): void {
    const next = Phaser.Math.Clamp(this.scroll + dy, 0, this.limit);
    if (next === this.scroll) return;
    this.scroll = next;
    this.content.y = -this.scroll;
  }

  /** Off the Quests page: the page's mask and scroll go (normal text; larger text belongs to accessiblePages). */
  leave(): void {
    if (accessibility().textSize !== 'normal') return;
    this.content.clearMask();
    this.content.y = 0;
    this.scroll = 0;
  }

  destroy(): void { this.mask?.destroy(); this.shape?.destroy(); }

  private text(x: number, y: number, s: string, size: number, opts: TextOpts = {}): Phaser.GameObjects.Text {
    const family = opts.family ?? FAMILY_BODY;
    const t = this.scene.add.text(x, y, s, {
      fontFamily: family, fontSize: `${family === FAMILY_BODY ? textSize(size) : size}px`, color: opts.color ?? INK_CSS,
      fontStyle: [opts.italic ? 'italic' : '', opts.bold ? 'bold' : ''].join(' ').trim() || 'normal',
      resolution: RENDER_SCALE, ...(opts.wrap ? { wordWrap: { width: opts.wrap } } : {})
    });
    this.content.add(t);
    return t;
  }

  /** Draw the page; returns nothing (the content container holds it). */
  draw(log: QuestLog): void {
    const { lx, lw, rx, rw, top, bottom } = this.box;
    // ── Left: the story ─────────────────────────────────────────────────────
    let y = top;
    const header = (x: number, s: string) => { const t = this.text(x, y, s.toUpperCase(), 13, { family: FAMILY_UI, color: BRASS_CSS, bold: true }); y += t.height + 6; };
    const line = (x: number, s: string, size: number, w: number, opts: TextOpts = {}, gap = 4) => { const t = this.text(x, y, s, size, { wrap: w, ...opts }); y += t.height + gap; return t; };
    const { main, next, meanwhile } = log.objectives;
    header(lx, 'Main story');
    if (main) this.objective(main, lx, lw, () => y, v => { y = v; });
    else if (next) {
      line(lx, 'Next in the story', 13, lw, { family: FAMILY_UI, color: MUTED, italic: true }, 2);
      this.objective(next, lx, lw, () => y, v => { y = v; });
      y += 4;
      line(lx, 'Meanwhile', 13, lw, { family: FAMILY_UI, color: MUTED, italic: true }, 2);
      this.suggestion(meanwhile, lx, lw, () => y, v => { y = v; });
    } else this.suggestion(meanwhile, lx, lw, () => y, v => { y = v; });
    if (log.beats.length) {
      y += 6;
      for (const b of log.beats) line(lx, `✓ ${b.title}`, 14, lw, { family: FAMILY_UI, color: DONE_CSS }, 2);
    }
    y += 14;
    header(lx, 'Town Projects');
    if (!log.projects.length) line(lx, 'None under way. The Town Ledger (L) shows what opens when.', 15, lw, { italic: true, color: MUTED });
    for (const p of log.projects) {
      line(lx, `○ ${p.name.charAt(0).toUpperCase()}${p.name.slice(1)}${p.placeName ? ` · ${p.placeName}` : ''}`, 16, lw, {}, 1);
      line(lx + 18, p.next, 14, lw - 18, { italic: true, color: BRASS_CSS }, 8);
    }
    let leftBottom = y;

    // ── Right: favors and dreams ────────────────────────────────────────────
    y = top;
    // "Favors you took on" only once there's one; until then the section is who has one to ask.
    header(rx, log.favors.length ? 'Favors you took on' : 'Favors');
    if (!log.favors.length && !log.offers.length) line(rx, 'None yet. Neighbours ask once they know you.', 15, rw, { italic: true, color: MUTED });
    for (const f of log.favors) {
      line(rx, `${f.name}: ${f.task}`, 16, rw, {}, 1);
      line(rx + 18, `${f.placeName} · by Day ${f.by}`, 14, rw - 18, { color: MUTED }, f.dream ? 1 : 8);
      if (f.dream) line(rx + 18, `For their dream: ${f.dream}`, 13, rw - 18, { italic: true, color: BRASS_CSS }, 8);
    }
    for (const f of log.offers) line(rx, `${f.name} has a Favor to ask: talk to them (${f.placeName}).`, 15, rw, { italic: true }, 6);
    y += 12;
    header(rx, 'Dreams');
    if (!log.dreams.length) line(rx, 'Nobody has told you their dream yet. People open up as they come to trust you.', 15, rw, { italic: true, color: MUTED });
    for (const d of log.dreams) {
      line(rx, `${d.name}${d.complete ? '  ✦ came true' : `  · ${d.stage} of ${d.total}`}`, 19, rw, { family: FAMILY_HEADING, color: d.complete ? DONE_CSS : INK_CSS }, 1);
      line(rx, `“${d.dream}”`, 14, rw, { italic: true, color: MUTED }, 3);
      for (const s of d.done.slice(-3)) line(rx + 18, `✓ ${s.words}`, 14, rw - 18, { family: FAMILY_UI, color: DONE_CSS }, 2);
      if (d.done.length > 3) line(rx + 18, `and ${d.done.length - 3} more done`, 13, rw - 18, { italic: true, color: MUTED }, 2);
      if (d.next) {
        line(rx + 18, `Next: ${d.next.words}`, 15, rw - 18, {}, 1);
        line(rx + 18, d.next.how, 13, rw - 18, { italic: true, color: d.next.actionable ? BRASS_CSS : MUTED }, 10);
      } else y += 8;
    }
    leftBottom = Math.max(leftBottom, y);

    // ── Scrolling (normal text) ─────────────────────────────────────────────
    if (accessibility().textSize === 'normal') {
      this.limit = Math.max(0, leftBottom - bottom);
      this.scroll = Math.min(this.scroll, this.limit);
      this.content.y = -this.scroll;
      if (this.limit > 0) {
        if (!this.mask) {
          this.shape = this.scene.make.graphics({}, false).fillRect(lx - 30, top - 8, rx + rw - lx + 60, bottom - top + 8);
          this.mask = this.shape.createGeometryMask();
        }
        this.content.setMask(this.mask);
      } else this.content.clearMask();
    }
  }

  private objective(o: Objective, x: number, w: number, get: () => number, set: (y: number) => void): void {
    let y = get();
    const add = (s: string, size: number, opts: TextOpts, gap: number) => { const t = this.text(x, y, s, size, { wrap: w, ...opts }); y += t.height + gap; };
    add(o.title, 22, { family: FAMILY_HEADING }, 2);
    const named = this.names(o.people);
    const who = named ? ` · With ${named}` : '';
    add(`When: ${o.when || 'any time'}${who}`, 14, { family: FAMILY_UI, color: MUTED }, 3);
    // The route is districts ("Market Row, then Old Quarter"); the place ends it.
    if (o.route) add(`How to get there: ${o.route}, then ${o.title.split(',')[0]}.`, 15, {}, 3);
    else if (o.direction) add(`How to get there: ${o.direction.replace('→ ', '')}.`, 15, {}, 3);
    else if (o.place) add('You are in the right district.', 15, { color: MUTED }, 3);
    add(o.reason, 15, { italic: true }, 4);
    set(y);
  }

  private suggestion(o: Objective, x: number, w: number, get: () => number, set: (y: number) => void): void {
    let y = get();
    const add = (s: string, size: number, opts: TextOpts, gap: number) => { const t = this.text(x, y, s, size, { wrap: w, ...opts }); y += t.height + gap; };
    add(o.title, 18, { family: FAMILY_HEADING }, 2);
    const where = [o.where, o.when, o.direction].filter(Boolean).join(' · ');
    if (where) add(where, 14, { family: FAMILY_UI, color: MUTED }, 3);
    add(o.reason, 15, { italic: true }, 4);
    set(y);
  }
}

/** The footer switch for the HUD's objective line (drawn outside the scrolling page). */
export function objectiveSwitchText(): string {
  return objectiveShown() ? '◉ Objective line on screen  ·  O to hide' : '○ Objective line hidden  ·  O to show';
}
