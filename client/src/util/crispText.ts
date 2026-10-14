import Phaser from "phaser";

/**
 * Boost Phaser Text resolution + force LINEAR texture sampling so text
 * stays crisp on every display.
 *
 * The global `pixelArt: true` config in main.ts forces NEAREST sampling on
 * every texture, which is correct for the chunky 32x40 unit sprites but
 * turns canvas-rendered text into jaggy garbage when the game canvas is
 * Phaser.Scale.FIT-scaled up to the window. We monkey-patch
 * GameObjectFactory.text so every `scene.add.text(...)` call gets:
 *
 *   - resolution = render density (>=2x, capped at 3x), so the glyph canvas
 *     is rendered at higher pixel density before being uploaded as a texture.
 *   - LINEAR filter on the resulting texture, so the downsample from the
 *     high-density glyph canvas to the on-screen size is bilinear-smooth
 *     instead of nearest-neighbor jagged.
 *
 * Combined: glyphs render at 2x-3x density and sample down smoothly, so
 * serif headings (Cinzel) keep clean anti-aliased edges instead of the
 * jaggy look they got at 1x density. Applied on ALL displays now, not just
 * retina — the worst blur was on ordinary 1x monitors where this used to
 * no-op out.
 *
 * Scope note: this fixes the glyph texture itself. The remaining softness
 * on large windows comes from FIT upscaling the fixed 1280x720 backing
 * buffer to the display, which this patch cannot change (the canvas backing
 * is locked to the game size in FIT mode). Lifting that ceiling is the
 * native-resolution render step, tracked in docs/RAVAGE_HD2D_PLAN.md.
 *
 * Memory impact: each text texture grows ~4x (2x in each dimension). Most
 * text textures are small (a few KB each), so total cost is on the order of
 * 1–2MB across the whole game — acceptable.
 *
 * Must be called BEFORE `new Phaser.Game(config)` so the override is in
 * place by the time any scene's create() runs and starts spawning text.
 */
export const installCrispText = (): void => {
  // Render every glyph canvas at >=2x density, capped at 3x. Previously
  // this was gated to retina (dpr>1) and skipped entirely at dpr===1 —
  // but the worst text blur shows up on ordinary 1x monitors, where the
  // 1280x720 canvas is FIT-scaled up to the window and serif headings
  // (Cinzel) that rely on anti-aliasing turn jaggy. Rendering the glyph
  // texture at 2x+ density and sampling it down with LINEAR gives clean,
  // anti-aliased edges within the frame regardless of display DPI, with
  // no early-out on 1x. (The remaining hard ceiling is the canvas->window
  // upscale itself, which FIT locks to the 720p backing buffer; lifting
  // that is the native-resolution step and is tracked separately.)
  const dpr = window.devicePixelRatio || 1;
  const density = Math.min(3, Math.max(2, Math.ceil(dpr)));
  // Capture the original factory method so we can delegate to it. The
  // patched version runs every `scene.add.text(x, y, content, style?)` call
  // through the same path it always used, then mutates the result.
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (
      x: number, y: number,
      text: string | string[],
      style?: Phaser.Types.GameObjects.Text.TextStyle
    ) => Phaser.GameObjects.Text;
  };
  const originalText = factory.text;

  factory.text = function (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number, y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle
  ): Phaser.GameObjects.Text {
    const t = originalText.call(this, x, y, text, style);
    t.setResolution(density);
    // The text's texture is constructed during the constructor's initial
    // updateText() call, so it exists by the time we get here. Subsequent
    // setText() calls re-render into the same texture, so the filter mode
    // we set now persists for the lifetime of the Text object.
    if (t.texture) {
      t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    return t;
  };
};
