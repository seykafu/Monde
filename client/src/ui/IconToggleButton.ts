import Phaser from "phaser";
import { COLORS } from "../util/constants";
import { sfxClick, sfxHover } from "../audio/Sfx";

// Generic circular glyph toggle for the battle top bar — same pattern and
// visual language as FastForwardButton (which predates it), parameterized
// on the glyph so new toggles (danger ranges, future overlays) don't each
// fork the class.
//
// Hit zone is a transparent Rectangle child (same pattern as
// SettingsButton/Button) — Phaser's native Rectangle input geometry covers
// the whole touch target reliably where Container-level Circle hit areas
// have intermittently failed.
export class IconToggleButton extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private glyph: Phaser.GameObjects.Text;
  private hovered = false;
  private enabled = false;
  private readonly onToggle: (enabled: boolean) => void;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    glyphChar: string,
    onToggle: (enabled: boolean) => void
  ) {
    super(scene, x, y);
    this.onToggle = onToggle;
    const hitR = 24;
    this.bg = scene.add.graphics();
    this.add(this.bg);
    this.glyph = scene.add.text(0, 1, glyphChar, {
      fontFamily: "Segoe UI Symbol, Apple Symbols, Symbola, sans-serif",
      fontSize: "16px",
      color: "#f4e4b0"
    }).setOrigin(0.5);
    this.add(this.glyph);

    const hitZone = scene.add.rectangle(0, 0, hitR * 2, hitR * 2, 0x000000, 0).setOrigin(0.5);
    hitZone.setInteractive({ useHandCursor: true });
    this.add(hitZone);

    hitZone.on("pointerover", () => { this.hovered = true; sfxHover(); this.redraw(); });
    hitZone.on("pointerout", () => { this.hovered = false; this.redraw(); });
    hitZone.on("pointerdown", () => {
      sfxClick();
      this.setEnabled(!this.enabled);
    });
    this.setDepth(1000);
    this.redraw();
    scene.add.existing(this);
  }

  public isEnabled(): boolean { return this.enabled; }

  // Programmatic toggle (keyboard shortcut path) — fires the callback and
  // keeps the visual in sync, exactly like a click.
  public setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    this.onToggle(v);
    this.redraw();
  }

  private redraw(): void {
    const r = 18;
    const g = this.bg;
    g.clear();
    if (this.enabled) {
      g.fillStyle(COLORS.gold, this.hovered ? 1.0 : 0.92);
      g.fillCircle(0, 0, r);
      g.lineStyle(1, COLORS.gold, 1.0);
      g.strokeCircle(0, 0, r);
      this.glyph.setColor("#1a1408");
    } else {
      g.fillStyle(this.hovered ? 0x1c2032 : 0x131724, 0.92);
      g.fillCircle(0, 0, r);
      g.lineStyle(1, COLORS.gold, this.hovered ? 0.95 : 0.55);
      g.strokeCircle(0, 0, r);
      this.glyph.setColor("#f4e4b0");
    }
  }
}
