import Phaser from "phaser";
import { COLORS, FAMILY_HEADING } from "../util/constants";
import { sfxClick, sfxHover } from "../audio/Sfx";

export interface ButtonOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  onClick: () => void;
  enabled?: boolean;
  primary?: boolean; // gold accent vs steel
  fontSize?: number;
}

// Pixels of forgiveness around every visible edge. Kept ≤ half the smallest
// gap between adjacent buttons (4px in BattleScene) so neighbours don't
// overlap and steal each other's clicks.
const HIT_PAD = 2;

// Least space kept between a label and the button's left and right edges.
const LABEL_PAD = 12;

// History note: an earlier version made the Container itself interactive with
// a custom Rectangle hit area. That worked geometrically but Phaser's
// Container hit-test path occasionally mis-mapped pointer coordinates so the
// right half of the visible button stopped registering clicks (cursor had to
// be left of centre). We now attach a transparent Phaser.GameObjects.Rectangle
// child and let it own the input. Rectangles use Phaser's native geometry
// path, which is rock-solid — clicks land exactly on the visible rect, plus
// HIT_PAD of slop on every edge.
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private hitZone: Phaser.GameObjects.Rectangle;
  private opts: ButtonOpts;
  private hovered = false;
  private pressed = false;
  private enabledFlag = true;

  constructor(scene: Phaser.Scene, opts: ButtonOpts) {
    // Container at the desired top-left of the visible button. Visible bg is
    // drawn at local (0, 0) → (w, h); hit zone is centred on that rect with
    // HIT_PAD of slop on every side.
    super(scene, opts.x, opts.y);
    this.opts = opts;
    this.enabledFlag = opts.enabled ?? true;

    this.bg = scene.add.graphics();

    this.text = scene.add.text(opts.w / 2, opts.h / 2, opts.label, {
      fontFamily: FAMILY_HEADING,
      fontSize: `${opts.fontSize ?? 16}px`,
      color: "#f4e4b0",
      stroke: "#000",
      strokeThickness: 2,
      shadow: { offsetX: 0, offsetY: 2, color: "#000", blur: 4, fill: true }
    }).setOrigin(0.5).setLetterSpacing(0.5);
    this.fitLabel();

    // Transparent rectangle that owns the input. Centred on the visible rect.
    // Origin (0.5, 0.5) so size = visual size + 2*HIT_PAD reaches symmetrically
    // beyond the visible edges.
    const fullW = opts.w + HIT_PAD * 2;
    const fullH = opts.h + HIT_PAD * 2;
    this.hitZone = scene.add.rectangle(opts.w / 2, opts.h / 2, fullW, fullH, 0x000000, 0)
      .setOrigin(0.5);
    this.hitZone.setInteractive({ useHandCursor: true });

    this.add([this.bg, this.text, this.hitZone]);

    this.hitZone.on("pointerover", () => {
      if (!this.enabledFlag) return;
      this.hovered = true;
      sfxHover();
      this.redraw();
    });
    // IMPORTANT: do not clear `pressed` here. Sub-pixel cursor jitter during a
    // click can fire pointerout/over rapidly, and clearing pressed would cancel
    // the click. A global pointerup listener below resets `pressed` cleanly.
    this.hitZone.on("pointerout", () => {
      this.hovered = false;
      this.redraw();
    });
    this.hitZone.on("pointerdown", () => {
      if (!this.enabledFlag) return;
      this.pressed = true;
      this.redraw();
    });
    this.hitZone.on("pointerup", () => {
      if (!this.enabledFlag) return;
      const wasPressed = this.pressed;
      this.pressed = false;
      this.redraw();
      if (wasPressed) {
        sfxClick();
        opts.onClick();
      }
    });
    // If the user releases outside the button after pressing on it, drop the
    // pressed visual state so it doesn't get stuck.
    const onGlobalUp = (): void => {
      if (this.pressed) {
        this.pressed = false;
        this.redraw();
      }
    };
    scene.input.on("pointerup", onGlobalUp);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.off("pointerup", onGlobalUp);
    });

    this.redraw();
    scene.add.existing(this);
  }

  setEnabled(b: boolean): void {
    this.enabledFlag = b;
    if (b) this.hitZone.setInteractive({ useHandCursor: true });
    else this.hitZone.disableInteractive();
    this.redraw();
  }

  // Override so callers that screen-pin the button (BattleScene.pin → setScrollFactor(0))
  // also pin the visible bg/text + the interactive hitZone child.
  //
  // Why this is hand-rolled instead of just calling super.setScrollFactor(x, y, true):
  // Phaser 3.80's Container.setScrollFactor(x, y, updateChildren=true) iterates
  // children via ArrayUtils.SetAll, which guards each assignment with
  // `hasOwnProperty('scrollFactorX')`. scrollFactorX/Y are defined on the prototype
  // by the Components.ScrollFactor mixin and only become own properties after
  // setScrollFactor() has been called once on that specific instance. Freshly-built
  // Button children fail the hasOwnProperty check, so the recursion is a silent
  // no-op — the Container itself gets pinned (visual stays put when the camera
  // scrolls) but the hit zone keeps scrollFactor=1 (hit-test runs in world space).
  // Symptom: cursor has to hover ABOVE the visible button by the camera scroll
  // delta to register a click. Calling .setScrollFactor() explicitly on each child
  // invokes the prototype method, which assigns the property as an own property,
  // sidestepping the quirk.
  setScrollFactor(x: number, y?: number): this {
    super.setScrollFactor(x, y);
    const sy = y ?? x;
    this.bg.setScrollFactor(x, sy);
    this.text.setScrollFactor(x, sy);
    this.hitZone.setScrollFactor(x, sy);
    return this;
  }

  setLabel(s: string): void {
    this.text.setText(s);
    this.fitLabel();
  }

  // A label too long for the button shrinks to fit inside its border
  // rather than running past it.
  private fitLabel(): void {
    const room = this.opts.w - LABEL_PAD * 2;
    this.text.setScale(this.text.width > room ? room / this.text.width : 1);
  }

  private redraw(): void {
    const { w, h, primary } = this.opts;
    const g = this.bg;
    g.clear();
    const accent = primary ? COLORS.gold : COLORS.steel;
    const fillTop = this.enabledFlag ? (this.pressed ? 0x0a0c14 : this.hovered ? 0x1c2032 : 0x131724) : 0x0a0c14;
    const fillBot = this.enabledFlag ? (this.pressed ? 0x05060a : 0x0a0c14) : 0x05060a;
    g.fillGradientStyle(fillTop, fillTop, fillBot, fillBot, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(1, accent, this.enabledFlag ? 0.85 : 0.3);
    g.strokeRect(0.5, 0.5, w - 1, h - 1);
    g.lineStyle(1, primary ? 0xffd97a : 0xb6c2d6, this.enabledFlag ? (this.hovered ? 0.6 : 0.25) : 0.1);
    g.strokeRect(2.5, 2.5, w - 5, h - 5);
    this.text.setColor(this.enabledFlag ? (primary ? "#fff2c0" : "#dde6ef") : "#5a5a60");
  }
}
