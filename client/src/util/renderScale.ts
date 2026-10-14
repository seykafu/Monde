import Phaser from "phaser";
import { RENDER_SCALE } from "./constants";

/**
 * EXPERIMENTAL native-resolution rendering (Tier 0, step 2).
 *
 * Phaser's FIT scale mode locks the canvas backing buffer to the game size
 * (ScaleManager: `baseSize.setSize(gameWidth, gameHeight)`), so a 1280x720
 * game is rendered into a 720p buffer and then upscaled to the window — the
 * source of text/sprite softness on large displays. To render at native
 * resolution we make the game (and therefore the backing buffer) bigger:
 * `width/height = GAME_* x RENDER_SCALE` in main.ts.
 *
 * That alone would shrink the world into the top-left corner, because every
 * scene still draws in 1280x720 design coordinates. This patch maps that
 * design space onto the bigger buffer by zooming each camera by RENDER_SCALE.
 *
 * The crucial detail is the zoom PIVOT. Phaser zooms around the camera's
 * origin (default 0.5 = center), which would offset scrollFactor-0 ("pinned")
 * UI differently from scrolling world objects and scatter the HUD. Pivoting
 * at the top-left (origin 0,0) instead makes the mapping a clean
 *   screenPos = (worldPos - scroll * scrollFactor) * RENDER_SCALE
 * for BOTH world objects and pinned UI — so the 1280x720 design lands exactly
 * on the 0..(1280*RS) x 0..(720*RS) buffer with no per-object compensation.
 *
 * We monkey-patch CameraManager.add (which Phaser also uses internally to
 * create each scene's default main camera, and which BattleScene calls for
 * its uiCamera) so every camera gets the treatment with zero per-scene edits.
 * Explicit viewport args (BattleScene's `cameras.add(0,0,GAME_WIDTH,
 * GAME_HEIGHT)`) are given in design coordinates, so we scale them to buffer
 * space here too.
 *
 * No-op when RENDER_SCALE === 1: we never install the patch, so default
 * behaviour is byte-identical.
 *
 * Must be called BEFORE `new Phaser.Game(config)`.
 */
export const installRenderScale = (): void => {
  const rs = RENDER_SCALE;
  if (rs === 1) return; // OFF — leave Phaser entirely untouched.

  // Bounds clamping must match the zoom PIVOT. Phaser's stock
  // clampX/clampY hard-code the default center pivot: they shift the
  // legal scroll range by (displayWidth - width) / 2, which is the
  // correction for a camera that zooms around its middle. Our cameras
  // zoom around the TOP-LEFT (origin 0,0), where the visible world is
  // simply [scrollX, scrollX + displayWidth] — no shift. Left stock,
  // every setBounds camera gets its scroll range displaced by
  // -width*(rs-1)/(2*rs) buffer px (-640, -360 design px at rs=2):
  // BattleScene's B1 entry clamped to scrollX=-640 permanently, pushing
  // the map half a screen off-viewport with drag unable to recover
  // (preRender re-clamps every frame).
  //
  // The replacement is origin-aware and reduces EXACTLY to Phaser's
  // stock math at origin 0.5, so non-patched cameras (there are none,
  // but belt-and-suspenders) behave identically.
  const camProto = Phaser.Cameras.Scene2D.BaseCamera.prototype as unknown as {
    clampX: (x: number) => number;
    clampY: (y: number) => number;
    _bounds: Phaser.Geom.Rectangle;
    width: number;
    height: number;
    originX: number;
    originY: number;
    zoomX: number;
    zoomY: number;
    displayWidth: number;
    displayHeight: number;
  };
  camProto.clampX = function (x: number): number {
    const bounds = this._bounds;
    const dw = this.displayWidth;
    const shift = this.width * this.originX * (1 - 1 / this.zoomX);
    const bx = bounds.x - shift;
    const bw = Math.max(bx, bx + bounds.width - dw);
    return x < bx ? bx : x > bw ? bw : x;
  };
  camProto.clampY = function (y: number): number {
    const bounds = this._bounds;
    const dh = this.displayHeight;
    const shift = this.height * this.originY * (1 - 1 / this.zoomY);
    const by = bounds.y - shift;
    const bh = Math.max(by, by + bounds.height - dh);
    return y < by ? by : y > bh ? bh : y;
  };

  const proto = Phaser.Cameras.Scene2D.CameraManager.prototype as unknown as {
    add: (
      x?: number, y?: number, width?: number, height?: number,
      makeMain?: boolean, name?: string
    ) => Phaser.Cameras.Scene2D.Camera;
  };
  const originalAdd = proto.add;

  proto.add = function (
    this: Phaser.Cameras.Scene2D.CameraManager,
    x?: number, y?: number, width?: number, height?: number,
    makeMain?: boolean, name?: string
  ): Phaser.Cameras.Scene2D.Camera {
    // Scale explicit (design-space) viewport args into buffer space. When
    // args are omitted (the default main camera), Phaser fills width/height
    // from the scale manager (already the buffer size) — leave those alone.
    const sx = typeof x === "number" ? x * rs : x;
    const sy = typeof y === "number" ? y * rs : y;
    const sw = typeof width === "number" ? width * rs : width;
    const sh = typeof height === "number" ? height * rs : height;

    const cam = originalAdd.call(this, sx, sy, sw, sh, makeMain, name);
    // Top-left pivot + zoom: maps the 1280x720 design onto the bigger buffer.
    cam.setOrigin(0, 0);
    cam.setZoom(rs);
    return cam;
  };
};
