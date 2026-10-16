/**
 * A resident's speech bubble on the board (GDD §9.11.3 "plays as speech bubbles over their heads"; §16.6 UI art).
 *
 * Cream paper with an ink border drawn pixel by pixel (stepped corners, a stepped tail, a drop shadow), the speaker's
 * first name in a small warm header and the line in the body face under it, wrapped. It lives in the world (the main
 * camera: it scrolls, keystones and darkens with the board like the name tags) and follows the speaker every frame;
 * bubbleLayout.ts keeps it in view and clear of the HUD. Made up front, so it belongs to the world camera.
 */
import Phaser from 'phaser';
import { DEPTH } from '../../render/depth';
import { DIORAMA_PERSPECTIVE_K } from '../../render/dioramaConfig';
import { FAMILY_BODY, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../../util/constants';
import { TAIL, hudSafe, placeBubble, type BubbleAnchor, type BubbleSafe } from './bubbleLayout';

const PAPER = 0xfff3d6, PAPER_HI = 0xfffbef, INK = 0x4a3526, SHADOW = 0x1e140c;
const PAD_X = 8, PAD_Y = 5, WRAP = 196, FADE_MS = 160;
let SAFE: BubbleSafe | null = null;
const safe = (): BubbleSafe => (SAFE ??= hudSafe(GAME_WIDTH, GAME_HEIGHT, { k: DIORAMA_PERSPECTIVE_K, centerX: 0.5 }));

export class SpeechBubble {
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly name: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private alpha = 0;
  private shown = false;
  private box = { w: 0, h: 0 };
  private drawn = '';
  /** Who it's over (resident id), while shown. */
  owner: string | null = null;

  constructor(scene: Phaser.Scene) {
    this.frame = scene.add.graphics().setDepth(DEPTH.FLOATER).setVisible(false);
    const style = (size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle =>
      ({ fontFamily: FAMILY_BODY, fontSize: `${size}px`, color, resolution: RENDER_SCALE, ...extra });
    this.name = scene.add.text(0, 0, '', style(10, '#9a5b2a', { fontStyle: 'bold' })).setDepth(DEPTH.FLOATER + 0.01).setVisible(false);
    this.body = scene.add.text(0, 0, '', style(13, '#3b2a1e', { wordWrap: { width: WRAP, useAdvancedWrap: true }, lineSpacing: 1 }))
      .setDepth(DEPTH.FLOATER + 0.01).setVisible(false);
  }

  get objects(): Phaser.GameObjects.GameObject[] { return [this.frame, this.name, this.body]; }
  get showing(): boolean { return this.shown; }
  get text(): string { return this.shown ? this.body.text : ''; }

  /** Show `text` (the speaker's first name over it) for `owner`. */
  say(owner: string, speaker: string, text: string): void {
    this.owner = owner;
    this.shown = true;
    this.name.setText(speaker);
    this.body.setText(text);
    const w = Math.ceil(Math.max(this.body.width, this.name.width, 28)) + PAD_X * 2;
    const h = Math.ceil(this.name.height + this.body.height) + PAD_Y * 2 - 1;
    this.box = { w, h };
    this.drawn = '';
  }

  /** Fade out. */
  hide(): void { this.shown = false; }
  /** Gone at once (a dialogue opened over the board). */
  hideNow(): void { this.shown = false; this.alpha = 0; this.owner = null; this.setVisible(false); }

  /** Follow the speaker (null: hold where it is) and fade; call every frame. */
  update(dtMs: number, anchor: BubbleAnchor | null, view: Phaser.Geom.Rectangle): void {
    this.alpha = Phaser.Math.Clamp(this.alpha + (this.shown ? 1 : -1) * dtMs / FADE_MS, 0, 1);
    if (this.alpha <= 0) { if (!this.shown) this.owner = null; this.setVisible(false); return; }
    if (anchor) {
      const p = placeBubble(this.box, anchor, view, safe());
      const key = `${this.box.w}x${this.box.h}:${p.flipped ? 'u' : 'd'}:${p.tailX - p.left}`;
      if (key !== this.drawn) { this.draw(p.flipped, p.tailX - p.left); this.drawn = key; }
      this.frame.setPosition(p.left, p.top);
      this.name.setPosition(p.left + PAD_X, p.top + PAD_Y - 1);
      this.body.setPosition(p.left + PAD_X, p.top + PAD_Y - 1 + this.name.height);
    }
    this.frame.setAlpha(this.alpha);
    this.name.setAlpha(this.alpha);
    this.body.setAlpha(this.alpha);
    this.setVisible(true);
  }

  private setVisible(on: boolean): void {
    this.frame.setVisible(on); this.name.setVisible(on); this.body.setVisible(on);
  }

  /** The frame in local px: (0, 0) is the box's top-left; the tail hangs below it (or rises above it, flipped). */
  private draw(flipped: boolean, tail: number): void {
    const { w, h } = this.box, g = this.frame.clear();
    // Drop shadow, then the ink outline with stepped corners, then the paper.
    g.fillStyle(SHADOW, 0.28).fillRect(3, 3, w - 2, h - 2).fillRect(2, 4, w, h - 4);
    g.fillStyle(INK, 1).fillRect(2, 0, w - 4, h).fillRect(0, 2, w, h - 4).fillRect(1, 1, w - 2, h - 2);
    g.fillStyle(PAPER, 1).fillRect(3, 2, w - 6, h - 4).fillRect(2, 3, w - 4, h - 6);
    g.fillStyle(PAPER_HI, 1).fillRect(3, 2, w - 6, 1);
    // The tail: a stepped wedge pointing at the speaker, ink round paper, opening into the box through its border.
    const x = Math.round(Math.max(8, Math.min(w - 8, tail)));
    g.fillStyle(PAPER, 1).fillRect(x - 3, flipped ? 0 : h - 2, 6, 2);
    for (let i = 0; i < TAIL; i++) {
      const half = Math.max(0, 3 - i * 0.6);
      const y = flipped ? -1 - i : h + i;
      g.fillStyle(INK, 1).fillRect(Math.round(x - half - 1), y, Math.round(half * 2) + 2, 1);
      if (half >= 0.5) g.fillStyle(PAPER, 1).fillRect(Math.round(x - half), y, Math.round(half * 2), 1);
    }
  }
}
