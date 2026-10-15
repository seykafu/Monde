// The VN panel's shared look (GDD §18 Dialogue): layout in design pixels, the HUD palette, the focusable
// button, the panel frame and name plates. StoryScene draws with these. They match DialogueScene's own
// constants and PanelButton exactly, so a scripted scene and a live conversation look like one panel.
// TODO(G-10): DialogueScene still keeps its private copies; switch it to this module once the concurrent
// edits to that file (hearts on the name plate) have landed.
import Phaser from 'phaser';
import { playSfx } from '../audio/Sfx';
import { FAMILY_BODY, FAMILY_HEADING, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { maxLinesFor } from '../ui/fitText';
import { PORTRAIT_H } from './portraitModel';

// ── Layout (1280×720) ───────────────────────────────────────────────────────

export const PANEL_X = 100;
export const PANEL_W = GAME_WIDTH - 200;
export const PANEL_H = 196;
export const PANEL_Y = GAME_HEIGHT - 20 - PANEL_H;
export const PAD = 30;
export const BODY_Y = PANEL_Y + 40;
export const BODY_W = PANEL_W - PAD * 2 - 60;
export const BODY_FONT = 22;
export const BODY_SPACING = 8;
export const BODY_MAX_LINES = maxLinesFor(BODY_FONT, BODY_SPACING, PANEL_H - 40 - 30);
export const PORTRAIT_X = PANEL_X + 22;
export const PORTRAIT_Y = PANEL_Y - PORTRAIT_H + 4;
export const PLATE_X = PANEL_X + 18;
export const PLATE_Y = PANEL_Y - 20;
export const PLATE_H = 38;
export const CHOICE_W = 480;
export const CHOICE_X = PANEL_X + PANEL_W - CHOICE_W;
export const CHOICE_GAP = 8;

// ── Palette (ZoneScene's HUD: deep green panels, cream text, a gold rule) ──

export const INK = 0x1f2a22;
export const PLATE = 0x28372d;
export const GOLD = 0xe4c77f;
export const CREAM = '#fff0ce';
export const MUTED = '#cfc4a6';
export const BODY_COLOUR = '#f3ecd9';
export const PLAYER_COLOUR = '#f6dc9c';
/** Narration: a warm parchment, set in italics, so it never reads as anyone's speech. */
export const NARRATION_COLOUR = '#e6dcc0';

/** The resident's roster colour, as their sprite wears it (scenes/zone/residents.ts). */
export const rosterColour = (index: number): number =>
  Phaser.Display.Color.HSLToColor(((index * 137.508) % 360) / 360, 0.52, 0.56).color;

export const bodyStyle = (): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FAMILY_BODY, fontSize: `${BODY_FONT}px`, color: BODY_COLOUR, lineSpacing: BODY_SPACING,
  wordWrap: { width: BODY_W }, resolution: RENDER_SCALE
});

/** The panel itself: ink, a gold rule and a fainter inner rule. */
export function drawPanel(g: Phaser.GameObjects.Graphics): Phaser.GameObjects.Graphics {
  g.fillStyle(INK, 0.95).fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 14);
  g.lineStyle(2, GOLD, 0.6).strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 14);
  g.lineStyle(1, GOLD, 0.2).strokeRoundedRect(PANEL_X + 5, PANEL_Y + 5, PANEL_W - 10, PANEL_H - 10, 11);
  return g;
}

/** A resident's name plate at the panel's top left; its width follows the name. */
export class NamePlate {
  readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  width = 0;

  constructor(scene: Phaser.Scene, private readonly minW: number) {
    this.bg = scene.add.graphics();
    this.text = scene.add.text(20, PLATE_H / 2, '', { fontFamily: FAMILY_HEADING, fontSize: '23px', color: CREAM, resolution: RENDER_SCALE }).setOrigin(0, 0.5);
    this.container = scene.add.container(PLATE_X, PLATE_Y, [this.bg, this.text]);
  }

  setName(name: string): this {
    this.text.setText(name);
    this.width = Math.max(this.minW, Math.ceil(this.text.width) + 40);
    this.bg.clear();
    this.bg.fillStyle(PLATE, 1).fillRoundedRect(0, 0, this.width, PLATE_H, 9);
    this.bg.lineStyle(2, GOLD, 0.85).strokeRoundedRect(0, 0, this.width, PLATE_H, 9);
    return this;
  }
}

/** The player's "You" plate on the right, shown while their own line is up. */
export function youPlate(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const you = scene.add.text(0, PLATE_H / 2, 'You', { fontFamily: FAMILY_HEADING, fontSize: '21px', color: '#e9f4ea', resolution: RENDER_SCALE }).setOrigin(0.5);
  const w = Math.ceil(you.width) + 44;
  const bg = scene.add.graphics();
  bg.fillStyle(0x2d4a43, 1).fillRoundedRect(-w / 2, 0, w, PLATE_H, 9);
  bg.lineStyle(2, 0x9fd3b6, 0.85).strokeRoundedRect(-w / 2, 0, w, PLATE_H, 9);
  return scene.add.container(PANEL_X + PANEL_W - 130 - w / 2, PLATE_Y, [bg, you]);
}

// ── A focusable button ──────────────────────────────────────────────────────

export class PanelButton {
  readonly bg: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly hit: Phaser.GameObjects.Rectangle;
  readonly h: number;
  private hovered = false;
  private focused = false;

  constructor(scene: Phaser.Scene, readonly x: number, private y: number, readonly w: number, text: string,
    readonly onClick: () => void, private readonly opts: { center?: boolean; muted?: boolean; size?: number; minH?: number } = {}) {
    const size = opts.size ?? 18;
    this.label = scene.add.text(0, 0, text, {
      fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: opts.muted ? MUTED : CREAM, resolution: RENDER_SCALE,
      wordWrap: { width: w - 28 }, lineSpacing: 2, align: opts.center ? 'center' : 'left'
    }).setDepth(41);
    this.h = Math.max(opts.minH ?? 40, Math.ceil(this.label.height) + 16);
    this.bg = scene.add.graphics().setDepth(40);
    this.hit = scene.add.rectangle(x, y, w, this.h, 0x000000, 0).setOrigin(0).setDepth(42).setInteractive({ useHandCursor: true });
    this.hit.on('pointerover', () => { this.hovered = true; this.redraw(); });
    this.hit.on('pointerout', () => { this.hovered = false; this.redraw(); });
    // Deferred a tick: the click may tear this button down, which mustn't happen inside its own input event.
    this.hit.on('pointerup', () => { playSfx('click'); scene.time.delayedCall(0, this.onClick); });
    this.moveTo(y);
  }

  moveTo(y: number): void {
    this.y = y;
    this.hit.setPosition(this.x, y);
    this.label.setPosition(this.opts.center ? this.x + this.w / 2 : this.x + 14, y + this.h / 2).setOrigin(this.opts.center ? 0.5 : 0, 0.5);
    this.redraw();
  }

  setFocus(on: boolean): void { this.focused = on; this.redraw(); }

  destroy(): void { this.bg.destroy(); this.label.destroy(); this.hit.destroy(); }

  private redraw(): void {
    const lit = this.hovered || this.focused;
    this.bg.clear();
    this.bg.fillStyle(lit ? 0x3a4d40 : PLATE, 0.96).fillRoundedRect(this.x, this.y, this.w, this.h, 9);
    this.bg.lineStyle(lit ? 2 : 1, lit ? 0xffe3a0 : GOLD, lit ? 1 : 0.55).strokeRoundedRect(this.x, this.y, this.w, this.h, 9);
  }
}
