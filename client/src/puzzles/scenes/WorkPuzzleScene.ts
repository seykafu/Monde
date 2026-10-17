import Phaser from 'phaser';
import { telemetry } from '../../telemetry/emit';
import { FAMILY_BODY, FAMILY_HEADING, RENDER_SCALE } from '../../util/constants';
import { sfxCineChime, installAudioUnlock } from '../../audio/Sfx';
import { reducedMotion, textSize } from '../../accessibility/runtime';
import type { Clock } from '../../sim/clock';
import { getFellow } from '../../fellow/state';
import { regardFor } from '../../scenes/friendship';
import type { PuzzleState } from '../core';
import { delivered, mailSteps, stepsBetween } from '../mailRound';
import { inOrder, swapMove } from '../libraryReturns';
import { WORK_PUZZLES, storeWork, workBoard, type WorkBoard, type WorkPuzzleKind } from '../work';
import { PUZZLE_SCENE } from './PuzzleScene';

// G-07: the community-work boards (§15.21) in the Spring puzzles' paper shell (PuzzleScene's look and keys). Time stops
// while it's open; leaving keeps the board; the job pays (economy/attach.ts) only when it's won within par.
export const WORK_PUZZLE_SCENE = 'WorkPuzzle';
export interface WorkPuzzleOpen { kind: WorkPuzzleKind; host: string; clock: Clock; done?: (solved: boolean) => void }
export function openWorkPuzzle(host: Phaser.Scene, clock: Clock, kind: WorkPuzzleKind): Promise<boolean> {
  if (host.scene.isActive(WORK_PUZZLE_SCENE) || host.scene.isActive(PUZZLE_SCENE)) return Promise.resolve(false);
  if (!host.game.scene.keys[WORK_PUZZLE_SCENE]) host.scene.add(WORK_PUZZLE_SCENE, WorkPuzzleScene, false);
  return new Promise(resolve => {
    host.scene.launch(WORK_PUZZLE_SCENE, { kind, clock, host: host.scene.key, done: resolve } satisfies WorkPuzzleOpen);
    host.scene.bringToTop(WORK_PUZZLE_SCENE);
  });
}

const INK = '#3d4637', FAINT = '#8a7a5c', PAPER_BUTTON = '#e1d1ab', FOCUS = '#c5d1b0';
/** The map's frame on the paper (the Mail Round draws the district inside it). */
const MAP = { x: 110, y: 170, w: 650, h: 360 };

export class WorkPuzzleScene extends Phaser.Scene {
  private opening!: WorkPuzzleOpen;
  private board!: WorkBoard;
  private state!: PuzzleState;
  private page!: Phaser.GameObjects.Container;
  private actions: { text: Phaser.GameObjects.Text; run(): void; label?: string }[] = [];
  private focus = 0;
  private feedback = '';
  /** Library: the slot of the book lifted off the shelf. */
  private picked: number | null = null;
  /** What just moved, for the little walk or swap (none with reduced motion). */
  private moved: { from: number; to: number } | null = null;
  private saved = 0;
  constructor() { super(WORK_PUZZLE_SCENE); }

  init(open: WorkPuzzleOpen): void {
    this.opening = open;
    this.board = workBoard(this.registry, open.kind, open.clock.day, getFellow(this.registry)?.skills.wits.level ?? 1);
    this.state = this.board.state;
    this.focus = 0; this.feedback = ''; this.picked = null; this.moved = null; this.saved = this.state.elapsed;
  }
  preload(): void {
    const bg = WORK_PUZZLES[this.opening.kind].backdrop;
    if (!this.textures.exists(bg)) this.load.image(bg, `${import.meta.env.BASE_URL}assets/backdrops/${bg}.jpg`);
  }
  create(): void {
    const id = WORK_PUZZLES[this.opening.kind].id;
    telemetry({ type: 'puzzle_opened', day: this.opening.clock.day, id });
    const host = this.scene.get(this.opening.host), input = host.input.enabled, keyboard = host.input.keyboard?.enabled;
    host.input.enabled = false; if (host.input.keyboard) { host.input.keyboard.resetKeys(); host.input.keyboard.enabled = false; }
    this.opening.clock.pause('work-puzzle');
    const bg = WORK_PUZZLES[this.opening.kind].backdrop;
    if (this.textures.exists(bg)) this.add.image(640, 360, bg).setDisplaySize(1280, 720);
    this.add.rectangle(640, 360, 1280, 720, 0x182c26, 0.7).setInteractive();
    this.add.rectangle(640, 355, 1160, 626, 0xf3e7c9).setStrokeStyle(3, 0xb79b68);
    this.add.rectangle(75, 355, 12, 626, 0x7a5641);
    this.page = this.add.container(); this.draw(); installAudioUnlock(this);
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (['Tab', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      if (e.key === 'Escape') this.scene.stop();
      else if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
        const d = e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        this.focus = (this.focus + d + this.actions.length) % this.actions.length; this.highlight();
      } else if (e.key === 'Enter' || e.key === ' ') this.actions[this.focus]?.run();
      else if (e.key.toLowerCase() === 'u') this.undo();
      else if (e.key.toLowerCase() === 'r') this.reset();
      else if (e.key.toLowerCase() === 'h') this.hint();
    };
    this.input.keyboard?.on('keydown', key);
    this.events.once('shutdown', () => {
      this.persist(); this.input.keyboard?.off('keydown', key);
      host.input.enabled = input;
      if (host.input.keyboard) { host.input.keyboard.resetKeys(); host.input.keyboard.enabled = keyboard ?? true; }
      telemetry({ type: 'puzzle_left', day: this.opening.clock.day, id });
      this.opening.clock.resume('work-puzzle');
      this.opening.done?.(this.state.solved && this.board.puzzle.win(this.state));
    });
  }
  update(_time: number, delta: number): void {
    if (this.state.solved || !this.game.hasFocus) return;
    this.state = { ...this.state, elapsed: this.state.elapsed + delta / 1000 };
    // The hint clock is saved every few seconds (and on every move and on leaving), not every frame.
    if (this.state.elapsed - this.saved >= 5) this.persist();
  }

  private persist(): void { storeWork(this.registry, this.board, this.state); this.saved = this.state.elapsed; }
  private text(x: number, y: number, text: string, size = 18, width = 1050): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, { fontFamily: FAMILY_BODY, fontSize: `${textSize(size)}px`, color: INK, resolution: RENDER_SCALE, wordWrap: { width }, lineSpacing: 5 });
    this.page.add(t); return t;
  }
  private button(x: number, y: number, text: string, run: () => void, width = 150, size = 18, label?: string): Phaser.GameObjects.Text {
    const t = this.text(x, y, text, size, width).setPadding(7, 5).setBackgroundColor(PAPER_BUTTON).setInteractive({ useHandCursor: true });
    const i = this.actions.length; this.actions.push({ text: t, run, label });
    t.on('pointerover', () => { this.focus = i; this.highlight(); }).on('pointerup', run);
    return t;
  }
  private highlight(): void {
    this.actions.forEach((a, i) => a.text.setBackgroundColor(i === this.focus ? FOCUS : PAPER_BUTTON).setColor(i === this.focus ? '#213b30' : INK));
    this.focusLine?.setText(this.actions[this.focus]?.label ?? '');
  }
  private focusLine: Phaser.GameObjects.Text | null = null;

  /** Every board change: save, then check for the win (or say why it isn't one yet). */
  private changed(next: PuzzleState, moved: { from: number; to: number } | null, note = ''): void {
    if (next === this.state) { this.draw(); return; }
    this.state = next; this.moved = moved; this.feedback = note;
    if (this.board.puzzle.win(this.state)) {
      // Won: the keyboard lands on the way out (draw clamps this to the last action).
      this.state = { ...this.state, solved: true }; this.focus = Number.MAX_SAFE_INTEGER;
      telemetry({ type: 'puzzle_solved', day: this.opening.clock.day, id: WORK_PUZZLES[this.opening.kind].id });
      sfxCineChime();
      this.feedback = this.board.kind === 'mail' ? 'Ada stamps the empty satchel. “Quicker than the last post-boy.”' : 'Margo runs a finger along the spines. “Exactly where they live.”';
    } else this.feedback = this.overPar() || note;
    this.persist(); this.draw();
  }
  private overPar(): string {
    if (this.board.kind === 'mail') {
      const { round } = this.board, steps = mailSteps(round.map, this.state.cells), all = delivered(round, this.state.cells).length === round.letters.length;
      if (all) return `Every letter is in, but the round took ${steps} steps and par is ${round.par}. Undo, or start the round again for a shorter way.`;
      return steps > round.par ? `That’s ${steps} steps, over par (${round.par}) with letters still to go. Undo, or start again.` : '';
    }
    const { shelf } = this.board, swaps = this.state.cells[0]!;
    if (inOrder(this.state.cells.slice(1))) return `In order, but in ${swaps} swaps, and par is ${shelf.par}. Undo, or put them back and try again.`;
    return swaps >= shelf.par ? `That’s ${swaps} swaps, and par is ${shelf.par}: this trolley can’t be finished within it now. Undo, or start again.` : '';
  }
  private undo(): void {
    if (this.state.solved) return;
    this.picked = null; this.changed(this.board.puzzle.undo(this.state), null);
  }
  /** As PuzzleScene: a fresh board that keeps the hint clock and hints, and can itself be undone. */
  private reset(): void {
    if (this.state.solved) return;
    this.picked = null;
    this.changed({ ...this.board.puzzle.reset(), elapsed: this.state.elapsed, hints: this.state.hints, undo: [...this.state.undo, [...this.state.cells]] }, null,
      this.board.kind === 'mail' ? 'Back at the start with a full satchel. Your hints are still here.' : 'The trolley as it came. Your hints are still here.');
  }
  private hint(): void {
    const resident = WORK_PUZZLES[this.opening.kind].resident;
    const hint = this.board.puzzle.hint(this.state, { askResident: true, regard: regardFor(this.registry, resident), wits: getFellow(this.registry)?.skills.wits.level });
    if (hint) { this.state = { ...this.state, hints: Math.min(3, this.state.hints + 1) }; this.feedback = hint; }
    else this.feedback = this.state.hints === 0 ? 'Take your time. The first nudge comes after three minutes of play.' : `A first-step walkthrough needs Friend Regard (40) with ${resident === 'ada' ? 'Ada' : 'Margo'}.`;
    this.persist(); this.draw();
  }

  private draw(): void {
    // A walk or swap still running belongs to pieces about to be redrawn.
    this.tweens?.killAll();
    this.page.removeAll(true); this.actions = []; this.focusLine = null;
    this.text(104, 58, this.board.puzzle.title, 30).setFontFamily(FAMILY_HEADING);
    this.text(104, 104, this.board.puzzle.instructions, 17, 1060);
    if (this.board.kind === 'mail') this.mail(this.board); else this.library(this.board);
    const hint = this.feedback || (this.state.hints ? this.board.puzzle.hints[this.state.hints - 1]! : 'No rush. The town’s clock is waiting for you.');
    this.text(104, 548, hint, 17, 1050);
    if (!this.state.solved) {
      this.button(104, 605, 'Undo [U]', () => this.undo(), 110);
      this.button(230, 605, 'Reset [R]', () => this.reset(), 110);
      const resident = WORK_PUZZLES[this.opening.kind].resident === 'ada' ? 'Ada' : 'Margo';
      this.button(356, 605, this.state.hints === 0 ? 'Hint [H]' : `Ask ${resident} [H]`, () => this.hint(), 235);
    }
    this.button(845, 605, this.state.solved ? 'Done. Collect the pay →' : 'I’ll come back later', () => this.scene.stop(), 290);
    this.text(104, 676, 'Tab / arrows: select   ·   Enter / Space: use   ·   U undo · R reset · H hint   ·   Esc: leave with progress saved', 14).setColor('#fff0ce');
    this.focus = Math.max(0, Math.min(this.focus, this.actions.length - 1)); this.highlight();
  }

  // ── Mail Round ──────────────────────────────────────────────────────────────

  private mail(board: Extract<WorkBoard, { kind: 'mail' }>): void {
    const { round } = board, { map } = round, path = this.state.cells, here = path[path.length - 1]!;
    const scale = Math.min(MAP.w / map.width, MAP.h / map.height);
    const ox = MAP.x + (MAP.w - map.width * scale) / 2, oy = MAP.y + (MAP.h - map.height * scale) / 2;
    const at = (i: number) => ({ x: ox + map.nodes[i]!.x * scale, y: oy + map.nodes[i]!.y * scale });
    const done = new Set(delivered(round, path)), letters = new Set(round.letters);
    const walked = new Set(path.slice(1).map((v, i) => `${Math.min(v, path[i]!)}-${Math.max(v, path[i]!)}`));
    const g = this.add.graphics(); this.page.add(g);
    g.fillStyle(0xe8d9b4, 1).fillRect(MAP.x, MAP.y, MAP.w, MAP.h).lineStyle(2, 0xb79b68, 1).strokeRect(MAP.x, MAP.y, MAP.w, MAP.h);
    for (const [a, b, w] of map.edges) {
      const p = at(a), q = at(b), trod = walked.has(`${a}-${b}`);
      g.lineStyle(trod ? 4 : 2, trod ? 0x7a5641 : 0xb79b68, trod ? 0.9 : 0.8).lineBetween(p.x, p.y, q.x, q.y);
      this.text((p.x + q.x) / 2 - 7, (p.y + q.y) / 2 - 9, String(w), 12, 40).setColor(FAINT);
    }
    const legal = new Set(this.state.solved ? [] : board.puzzle.legalMoves(this.state));
    const glyph = (i: number) => letters.has(i) ? (done.has(i) ? '✓' : '✉') : i === map.start ? '⌂' : '•';
    map.nodes.forEach((node, i) => {
      const p = at(i);
      if (legal.has(i)) {
        const steps = stepsBetween(map, here, i);
        this.button(p.x - 13, p.y - 15, glyph(i), () => this.walk(i), 40, 18, `Next: ${node.label} · ${steps} steps${letters.has(i) && !done.has(i) ? ' · a letter' : ''}`);
      } else if (i !== here) this.text(p.x - 7, p.y - 12, glyph(i), letters.has(i) ? 18 : 14, 40).setColor(letters.has(i) ? INK : FAINT);
      // Doors stand a few steps apart, so a letter is tagged with its number in the satchel list, not its address.
      if (letters.has(i)) this.text(p.x + 15, p.y - 2, String(round.letters.indexOf(i) + 1), 12, 30).setColor(done.has(i) ? FAINT : '#a2452f');
    });
    // The Fellow, walking the last street (straight there with reduced motion).
    const me = at(here), walker = this.text(me.x - 11, me.y - 15, '◉', 22, 40).setColor('#a2452f');
    if (this.moved && !reducedMotion() && this.tweens) {
      const from = at(this.moved.from);
      walker.setPosition(from.x - 11, from.y - 15);
      this.tweens.add({ targets: walker, x: me.x - 11, y: me.y - 15, duration: 220, ease: 'Sine.easeInOut' });
    }
    this.moved = null;
    const steps = mailSteps(map, path), x = 800;
    this.text(x, 172, `Steps ${steps}  ·  par ${round.par}`, 22, 360).setColor(steps > round.par ? '#a2452f' : INK);
    this.text(x, 210, `Here: ${map.nodes[here]!.label}`, 15, 360);
    this.text(x, 240, `Letters ${done.size} of ${round.letters.length}`, 17, 360);
    round.letters.forEach((l, i) => this.text(x, 270 + i * 25, `${i + 1}  ${done.has(l) ? '✓' : '✉'}  ${map.nodes[l]!.label}`, 15, 360).setColor(done.has(l) ? FAINT : INK));
    this.focusLine = this.text(x, 480, '', 15, 360).setColor('#213b30');
  }
  private walk(node: number): void {
    const from = this.state.cells[this.state.cells.length - 1]!;
    // The keyboard starts again at the first street out of the new door.
    this.focus = 0;
    this.changed(this.board.puzzle.move(this.state, node), { from, to: node });
  }

  // ── Library Returns ─────────────────────────────────────────────────────────

  private library(board: Extract<WorkBoard, { kind: 'library' }>): void {
    const { shelf } = board, n = shelf.initial.length, books = this.state.cells.slice(1), swaps = this.state.cells[0]!;
    const width = Math.min(88, 1040 / n), left = 104 + (1056 - width * n) / 2, base = 360;
    const g = this.add.graphics(); this.page.add(g);
    g.fillStyle(0x7a5641, 1).fillRect(left - 12, base, width * n + 24, 14).fillStyle(0x5c3f2f, 1).fillRect(left - 12, 196, 10, base - 196).fillRect(left + width * n + 2, 196, 10, base - 196);
    const x = (slot: number) => left + slot * width + 4;
    books.forEach((rank, slot) => {
      const lifted = this.picked === slot, call = shelf.calls[rank]!;
      const t = this.button(x(slot), lifted ? 196 : 222, call, () => this.pick(slot), width - 8, 16,
        lifted ? `${call} is off the shelf: choose a book to swap it with, or this one to put it back.` : this.picked === null ? `Slot ${slot + 1}: ${call}` : `Swap ${shelf.calls[books[this.picked]!]} with ${call}`);
      t.setFixedSize(width - 8, 130).setAlign('center');
      if (lifted) t.setBackgroundColor('#d9b779');
      if (this.moved && !reducedMotion() && this.tweens && (slot === this.moved.from || slot === this.moved.to)) {
        const other = slot === this.moved.from ? this.moved.to : this.moved.from;
        t.setX(x(other));
        this.tweens.add({ targets: t, x: x(slot), duration: 220, ease: 'Sine.easeInOut' });
      }
      this.text(x(slot) + width / 2 - 12, base + 20, String(slot + 1), 12, 40).setColor(FAINT);
    });
    this.moved = null;
    this.text(104, 420, `Swaps ${swaps}  ·  par ${shelf.par}`, 22, 500).setColor(swaps > shelf.par ? '#a2452f' : INK);
    this.text(104, 458, 'Smallest call number at the left. Read them like decimals: 041.7 comes before 041.9, and both before 112.0.', 15, 1000);
    this.focusLine = this.text(104, 494, '', 15, 1050).setColor('#213b30');
  }
  private pick(slot: number): void {
    if (this.state.solved) return;
    if (this.picked === null || this.picked === slot) { this.picked = this.picked === null ? slot : null; this.draw(); return; }
    const from = this.picked, n = this.board.kind === 'library' ? this.board.shelf.initial.length : 0;
    this.picked = null;
    this.changed(this.board.puzzle.move(this.state, swapMove(n, from, slot)), { from, to: slot });
  }
}
