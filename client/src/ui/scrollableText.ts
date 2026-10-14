import Phaser from "phaser";

// Scrollable text panel — wraps a Phaser Text object inside a geometry-masked
// Container, so any body that overflows the panel becomes scrollable instead
// of bleeding past the borders. Used by:
//
//   - BattlePrepScene's "Field Brief" (long battle intros like b07's
//     monastery briefing)
//   - OverworldScene's battle-card hover description (the script's intros
//     are paragraph-length and were previously truncated to 3 lines)
//
// Mouse wheel scrolls when pointer is inside the panel rect. A thin gold
// scrollbar appears on the right edge when the text overflows; hidden when
// it fits. Call setText(...) to swap the body without recreating the panel
// (OverworldScene re-feeds on every battle-card hover).
//
// Cleanup: call destroy() to remove every backing object. Safe to call
// repeatedly from a scene's create() if the helper is recreated on
// re-entry.

export interface ScrollableTextOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  style: Phaser.Types.GameObjects.Text.TextStyle;
  // Inner padding inside the (x, y, w, h) box. Default 0 — caller usually
  // accounts for padding in the box dimensions.
  padding?: { left?: number; top?: number; right?: number; bottom?: number };
  // Right-edge scrollbar styling. Defaults: gold thumb on a dark track.
  scrollbar?: {
    width?: number;       // default 6
    trackColor?: number;  // default 0x1a0e04 @ 0.6
    thumbColor?: number;  // default 0xc9b07a @ 0.85
    show?: boolean;       // default true; false hides the scrollbar entirely
  };
}

export interface ScrollableTextHandle {
  setText(text: string): void;
  destroy(): void;
}

export const createScrollableText = (
  scene: Phaser.Scene,
  opts: ScrollableTextOpts
): ScrollableTextHandle => {
  const padLeft = opts.padding?.left ?? 0;
  const padTop = opts.padding?.top ?? 0;
  const padRight = opts.padding?.right ?? 0;
  const padBottom = opts.padding?.bottom ?? 0;

  // Visible rect (the masked viewport) — text is clipped to these bounds.
  const visibleX = opts.x + padLeft;
  const visibleY = opts.y + padTop;
  const visibleW = opts.w - padLeft - padRight;
  const visibleH = opts.h - padTop - padBottom;

  // Reserve space for the scrollbar so text doesn't render under it. Even
  // when scrollbar is hidden (text fits), this leaves a small right-margin
  // so swapping bodies doesn't shift left/right based on scrollability.
  const sbWidth = opts.scrollbar?.width ?? 6;
  const sbShow = opts.scrollbar?.show ?? true;
  const textWrapW = visibleW - (sbShow ? sbWidth + 6 : 0);

  // Container holds the text; we translate its y to scroll. Position the
  // container at the visible rect's top-left so the text's local (0, 0)
  // corresponds to the start of the panel's content area.
  const container = scene.add.container(visibleX, visibleY);
  const text = scene.add.text(0, 0, opts.text, {
    ...opts.style,
    wordWrap: { width: textWrapW }
  });
  container.add(text);

  // Geometry mask clips anything in the container to the visible rect.
  // Using a `make.graphics` + `createGeometryMask` instead of a bitmap mask
  // keeps GPU memory minimal and avoids a render-target.
  const maskShape = scene.make.graphics({ x: 0, y: 0 }, false);
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(visibleX, visibleY, visibleW, visibleH);
  container.setMask(maskShape.createGeometryMask());

  // Scrollbar (drawn in absolute coords, NOT inside the container).
  const trackColor = opts.scrollbar?.trackColor ?? 0x1a0e04;
  const thumbColor = opts.scrollbar?.thumbColor ?? 0xc9b07a;
  const sbX = opts.x + opts.w - padRight - sbWidth;
  const sbG = scene.add.graphics();

  // Wheel hit zone covers the WHOLE panel, not just the scrollbar — players
  // expect to scroll by hovering anywhere on the body and using the wheel.
  const hitZone = scene.add.zone(opts.x + opts.w / 2, opts.y + opts.h / 2, opts.w, opts.h)
    .setInteractive();

  let scroll = 0;
  let maxScroll = 0;

  const recomputeScrollBounds = (): void => {
    maxScroll = Math.max(0, text.height - visibleH);
    if (scroll > maxScroll) scroll = maxScroll;
    container.y = visibleY - scroll;
  };

  const drawScrollbar = (): void => {
    sbG.clear();
    if (!sbShow) return;
    if (maxScroll <= 0) return; // nothing to scroll, hide the bar entirely
    sbG.fillStyle(trackColor, 0.6);
    sbG.fillRect(sbX, visibleY, sbWidth, visibleH);
    const thumbH = Math.max(24, (visibleH / text.height) * visibleH);
    const thumbY = visibleY + (scroll / maxScroll) * (visibleH - thumbH);
    sbG.fillStyle(thumbColor, 0.85);
    sbG.fillRect(sbX, thumbY, sbWidth, thumbH);
  };

  // Two wheel paths: a direct listener on the hit zone (fires when pointer
  // is registered as over the zone), AND a global wheel listener filtered
  // by pointer position (handles cases where Phaser's pointer-over state
  // hasn't latched onto the zone yet — common right after a setText swap).
  const onWheel = (deltaY: number): void => {
    if (maxScroll <= 0) return;
    scroll = Phaser.Math.Clamp(scroll + deltaY * 0.5, 0, maxScroll);
    container.y = visibleY - scroll;
    drawScrollbar();
  };
  hitZone.on("wheel", (_p: Phaser.Input.Pointer, _dx: number, dy: number) => onWheel(dy));
  const globalWheel = (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number): void => {
    if (p.x < opts.x || p.x > opts.x + opts.w) return;
    if (p.y < opts.y || p.y > opts.y + opts.h) return;
    onWheel(dy);
  };
  scene.input.on("wheel", globalWheel);

  recomputeScrollBounds();
  drawScrollbar();

  return {
    setText(newText: string): void {
      text.setText(newText);
      // Reset scroll to top on body change — UX expectation when hovering
      // a new battle card or loading a new prep screen.
      scroll = 0;
      recomputeScrollBounds();
      drawScrollbar();
    },
    destroy(): void {
      scene.input.off("wheel", globalWheel);
      hitZone.destroy();
      sbG.destroy();
      maskShape.destroy();
      container.destroy(); // destroys the text inside as a child
    }
  };
};
