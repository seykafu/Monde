// Keystone perspective math. The shader and input picking both run on
// screenToSource, so its correctness IS click correctness.

import { describe, it, expect } from "vitest";
import { screenToSource, sourceToScreen, type KeystoneParams } from "../keystone";

const W = 2560, H = 1440;
const P: KeystoneParams = { k: 0.12, centerX: 494 / 1280 };

describe("keystone perspective", () => {
  it("leaves the bottom edge untouched", () => {
    for (const X of [0, 400, 988, 1600, 2559]) {
      const s = screenToSource(X, H, W, H, P)!;
      expect(s.x).toBeCloseTo(X, 6);
      expect(s.y).toBeCloseTo(H, 6);
    }
  });

  it("leaves the optical axis vertical", () => {
    const cx = P.centerX * W;
    // Not Y = 0: under this tilt the top ~40 design px of the screen look
    // past the top of the camera image (the top bar covers them).
    for (const Y of [100, 300, 900, 1400]) {
      expect(screenToSource(cx, Y, W, H, P)!.x).toBeCloseTo(cx, 6);
    }
  });

  it("round-trips source → screen → source exactly", () => {
    for (let i = 0; i < 400; i++) {
      const x = ((i * 7919) % 1000) / 1000 * W;
      const y = ((i * 104729) % 1000) / 1000 * H;
      const sc = sourceToScreen(x, y, W, H, P);
      const back = screenToSource(sc.x, sc.y, W, H, P);
      expect(back, `(${x.toFixed(1)}, ${y.toFixed(1)})`).not.toBeNull();
      expect(back!.x).toBeCloseTo(x, 4);
      expect(back!.y).toBeCloseTo(y, 4);
    }
  });

  it("shrinks things equally on both axes as they recede", () => {
    // A small square high on the screen must stay square, just smaller —
    // perspective, not a keystone squash that makes far soldiers thin.
    const probe = (y: number) => {
      const a = sourceToScreen(1000, y, W, H, P);
      const bx = sourceToScreen(1004, y, W, H, P);
      const by = sourceToScreen(1000, y + 4, W, H, P);
      return { sx: (bx.x - a.x) / 4, sy: (by.y - a.y) / 4 };
    };
    for (const y of [100, 500, 1000]) {
      const { sx, sy } = probe(y);
      expect(sx / sy).toBeCloseTo(1, 2);
    }
    // ...and genuinely smaller further up.
    expect(probe(100).sx).toBeLessThan(probe(1300).sx);
  });

  it("reveals nothing beyond the camera image instead of smearing its edge", () => {
    // Top-left corner: the image has converged inward, so the corner is empty.
    expect(screenToSource(0, 0, W, H, P)).toBeNull();
  });

  it("is the identity with no tilt", () => {
    const f = { ...P, k: 0 };
    const a = screenToSource(123, 456, W, H, f)!;
    const b = sourceToScreen(123, 456, W, H, f);
    expect(a.x).toBeCloseTo(123, 9); expect(a.y).toBeCloseTo(456, 9);
    expect(b.x).toBeCloseTo(123, 9); expect(b.y).toBeCloseTo(456, 9);
  });
});
