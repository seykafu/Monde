// A short VN beat over the town for the Projects (MVP G-03): a resident's answer when asked to help or to give, Pell's
// sign-off for the Fund, and an opening ceremony. The dialogue panel's look (dialogue/panel.ts: panel, name plate,
// portrait, buttons) with the board left in view above it, so an opening is seen happening on the street.
//
// Steps play in order: a line (a resident's, with their portrait, or the narrator's, in italics), a choice (1–4,
// ↑↓ and Enter, or a click; its answer can add steps), or a live line (one line from the resident's agent online,
// with "…" while it comes; skipped when it doesn't). Enter, Space or a click reads on; Esc closes an ask (a ceremony
// reads on instead, so nothing in it is skipped). The clock is held and the zone's input paused while it's open.
import Phaser from 'phaser';
import { playSfx } from '../audio/Sfx';
import {
  BODY_COLOUR, BODY_Y, CHOICE_GAP, CHOICE_W, CHOICE_X, NARRATION_COLOUR, NamePlate, PAD, PANEL_X, PANEL_Y, PORTRAIT_X,
  PORTRAIT_Y, PanelButton, bodyStyle, drawPanel, rosterColour
} from '../dialogue/panel';
import { Portrait } from '../dialogue/portrait';
import { portraitLook } from '../dialogue/portraitModel';
import type { Clock } from '../sim/clock';
import { displayName } from '../sim/residentSim';
import { GAME_HEIGHT, GAME_WIDTH } from '../util/constants';
import { personaCards } from '../world/residents';

export const PROJECT_BEAT = 'ProjectBeat';

export type BeatStep =
  | { kind: 'line'; speaker: string; expr?: string; text: string; onShow?: () => void }
  | { kind: 'choice'; choices: readonly { label: string; run: () => BeatStep[] | void }[] }
  | { kind: 'live'; speaker: string; expr?: string; fetch: () => Promise<string | null> };

export interface BeatOpen {
  host: string;
  clock: Clock;
  steps: BeatStep[];
  /** A ceremony: Esc reads on instead of closing, so its reveal always happens. */
  ceremony?: boolean;
  onClose?: () => void;
}

const CARDS = new Map(personaCards.map((card, index) => [card.id, { card, index }]));
/** Characters a second as the dialogue panel's "normal" text speed reads (mind/reader.ts MS_PER_CHAR is per speed). */
const CHARS_PER_MS = 0.06;
const LIVE_TIMEOUT_MS = 6000;

/** Open a beat over `host` (false if one's already up). */
export function playBeat(host: Phaser.Scene, open: Omit<BeatOpen, 'host'>): boolean {
  if (!host.scene.get(PROJECT_BEAT)) host.scene.add(PROJECT_BEAT, BeatScene, false);
  if (host.scene.isActive(PROJECT_BEAT)) return false;
  host.scene.launch(PROJECT_BEAT, { ...open, host: host.scene.key } satisfies BeatOpen);
  return true;
}

export class BeatScene extends Phaser.Scene {
  private open!: BeatOpen;
  private queue: BeatStep[] = [];
  private body!: Phaser.GameObjects.Text;
  private plate!: NamePlate;
  private portrait: Portrait | null = null;
  private speaker = '';
  private buttons: PanelButton[] = [];
  private focus = 0;
  private full = '';
  private shown = 0;
  private typing = false;
  private waiting = false;
  private closed = false;
  private seen = new WeakSet<KeyboardEvent>();

  constructor() { super(PROJECT_BEAT); }

  init(data: BeatOpen): void {
    this.open = data;
    this.queue = [...data.steps];
    this.closed = false; this.speaker = ''; this.portrait = null; this.buttons = []; this.typing = false; this.waiting = false;
  }

  create(): void {
    this.scene.bringToTop();
    this.hold(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.hold(false));
    // A soft floor of shade under the panel; the street stays in view above it.
    const shade = this.add.graphics();
    shade.fillGradientStyle(0x0c100d, 0x0c100d, 0x0c100d, 0x0c100d, 0, 0, 0.55, 0.55).fillRect(0, GAME_HEIGHT * 0.45, GAME_WIDTH, GAME_HEIGHT * 0.55);
    this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive().on('pointerup', () => this.advance());
    drawPanel(this.add.graphics().setDepth(2));
    this.plate = new NamePlate(this, 150);
    this.plate.container.setDepth(6).setAlpha(0);
    this.body = this.add.text(PANEL_X + PAD, BODY_Y, '', bodyStyle()).setDepth(4);
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
    this.next();
  }

  update(_time: number, delta: number): void {
    if (!this.typing) return;
    this.shown = Math.min(this.full.length, this.shown + delta * CHARS_PER_MS);
    this.body.setText(this.full.slice(0, Math.floor(this.shown)));
    if (this.shown >= this.full.length) this.typing = false;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.closed || e.repeat || this.seen.has(e)) return;
    this.seen.add(e);
    if (this.buttons.length) {
      const n = Number(e.key);
      if (n >= 1 && n <= this.buttons.length) { this.buttons[n - 1]!.onClick(); return; }
      if (e.key === 'ArrowDown' || e.key === 'Tab') { e.preventDefault?.(); this.setFocus((this.focus + 1) % this.buttons.length); return; }
      if (e.key === 'ArrowUp') { this.setFocus((this.focus + this.buttons.length - 1) % this.buttons.length); return; }
      if (e.key === 'Enter' || e.key === ' ') { this.buttons[this.focus]!.onClick(); return; }
      if (e.key === 'Escape' && !this.open.ceremony) this.close();
      return;
    }
    if (e.key === 'Escape' && !this.open.ceremony) { this.close(); return; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key === 'e' || e.key === 'E') this.advance();
  }

  private advance(): void {
    if (this.closed || this.buttons.length || this.waiting) return;
    if (this.typing) { this.typing = false; this.shown = this.full.length; this.body.setText(this.full); return; }
    playSfx('click');
    this.next();
  }

  private next(): void {
    const step = this.queue.shift();
    if (!step) { this.close(); return; }
    if (step.kind === 'line') { this.say(step.speaker, step.text, step.expr); step.onShow?.(); return; }
    if (step.kind === 'choice') { this.choose(step.choices); return; }
    // A live line: "…" while it comes, then the line, or on to the next step without one.
    this.say(step.speaker, '…', step.expr);
    this.typing = false;
    this.waiting = true;
    const timeout = new Promise<null>(resolve => this.time.delayedCall(LIVE_TIMEOUT_MS, () => resolve(null)));
    void Promise.race([step.fetch().catch(() => null), timeout]).then(text => {
      if (this.closed) return;
      this.waiting = false;
      if (text && text.trim()) this.say(step.speaker, text.trim(), step.expr);
      else this.next();
    });
  }

  private say(speaker: string, text: string, expr?: string): void {
    const narrator = speaker === 'narrator';
    this.showSpeaker(narrator ? null : speaker, expr);
    this.body.setColor(narrator ? NARRATION_COLOUR : BODY_COLOUR).setFontStyle(narrator ? 'italic' : 'normal');
    this.full = text; this.shown = 0; this.typing = true;
    this.body.setText('');
  }

  private showSpeaker(id: string | null, expr?: string): void {
    if (!id) {
      if (this.portrait) { const old = this.portrait; this.tweens.add({ targets: old.root, alpha: 0, duration: 140, onComplete: () => old.destroy() }); }
      this.portrait = null; this.speaker = '';
      this.tweens.add({ targets: this.plate.container, alpha: 0, duration: 120 });
      return;
    }
    if (id !== this.speaker || !this.portrait) {
      if (this.portrait) { const old = this.portrait; this.tweens.add({ targets: old.root, alpha: 0, duration: 140, onComplete: () => old.destroy() }); }
      const entry = CARDS.get(id);
      const look = entry ? portraitLook(entry.card, rosterColour(entry.index)) : portraitLook({ id, age: 35, pronouns: 'they/them', kind: 'resident', appearance: '' } as never, rosterColour(id.length * 7));
      const portrait = new Portrait(this, { residentId: id, look, x: PORTRAIT_X, y: PORTRAIT_Y, label: false });
      portrait.root.setDepth(3).setAlpha(0);
      portrait.setExpression(expr ?? 'neutral', true);
      this.tweens.add({ targets: portrait.root, alpha: 1, duration: 160 });
      this.portrait = portrait; this.speaker = id;
      this.plate.setName(entry ? displayName(entry.card.name) : id);
    } else if (expr) this.portrait.setExpression(expr);
    this.tweens.add({ targets: this.plate.container, alpha: 1, duration: 120 });
  }

  private choose(choices: readonly { label: string; run: () => BeatStep[] | void }[]): void {
    const h = 44;
    const top = PANEL_Y - 16 - choices.length * (h + CHOICE_GAP);
    this.buttons = choices.map((c, i) => new PanelButton(this, CHOICE_X, top + i * (h + CHOICE_GAP), CHOICE_W, `${i + 1} · ${c.label}`, () => {
      this.clearChoices();
      const more = c.run();
      if (more?.length) this.queue.unshift(...more);
      this.next();
    }, { minH: h }));
    for (const b of this.buttons) { b.bg.setDepth(7); b.label.setDepth(8); b.hit.setDepth(9); }
    this.setFocus(0);
  }

  private setFocus(i: number): void { this.focus = i; this.buttons.forEach((b, j) => b.setFocus(j === i)); }
  private clearChoices(): void { this.buttons.forEach(b => b.destroy()); this.buttons = []; }

  private hold(on: boolean): void {
    const host = this.scene.get(this.open.host);
    if (host?.input) {
      host.input.enabled = !on;
      if (host.input.keyboard) { host.input.keyboard.enabled = !on; host.input.keyboard.resetKeys(); }
    }
    if (on) this.open.clock.pause('project'); else this.open.clock.resume('project');
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearChoices();
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 140, onComplete: () => { this.scene.stop(); this.open.onClose?.(); } });
  }
}
