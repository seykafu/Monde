// The dialogue portrait (GDD §16.2, §18 Dialogue): a resident's bust in the VN panel, one of six expressions.
//
// Art first: if client/public/assets/portraits/manifest.json lists the resident, their PNGs load when the
// conversation opens (lazily, once per session: textures outlive the scene) and the bust shows the file for
// each expression (portraitModel.artExpression). Otherwise, and until the files arrive, it draws a
// procedural cartoon bust in the resident's colours: back hair, shoulders and collar, head and ears, front
// hair and headwear (static), then a face layer per expression, then glasses, moustache and the frame.
// Expression changes are quick and small: the face (or the art) crossfades over 110 ms with a slight squash,
// a surprise hops and anger shakes, all inside 150 ms.
import Phaser from 'phaser';
import type { PortraitExpression } from '@monde/shared';
import { FAMILY_BODY, RENDER_SCALE } from '../util/constants';
import {
  FACES, MANIFEST_PATH, PORTRAIT_H, PORTRAIT_W, artExpression, mixColour, parsePortraitManifest, portraitExpression,
  portraitTextureKey, portraitUrl, shadeColour, type PortraitLook, type PortraitManifest
} from './portraitModel';

type G = Phaser.GameObjects.Graphics;
interface Pt { x: number; y: number }
/** A face layer or an art image: what an expression change crossfades. */
type Fadeable = { visible: boolean; setAlpha(alpha: number): unknown; setVisible(visible: boolean): unknown };

const W = PORTRAIT_W, H = PORTRAIT_H;
const GOLD = 0xe4c77f;
const INK = 0x2a1c22;
/** Expression change: crossfade and squash length (§ brief: under 150 ms). */
export const SWAP_MS = 110;
const MUTED = '#cfc4a6';

// ── Geometry helpers ────────────────────────────────────────────────────────

const quad = (a: Pt, c: Pt, b: Pt, n = 14): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return out;
};

/** An ellipse's outline from angle a0 to a1 (radians, 0 = right, clockwise on screen), optionally tapering below. */
const arcPts = (cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 40, taper = 0): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, s = Math.sin(a);
    const k = s > 0 ? 1 - taper * s * s : 1;
    out.push({ x: cx + rx * Math.cos(a) * k, y: cy + ry * s });
  }
  return out;
};

function fill(g: G, pts: Pt[], colour: number, alpha = 1): void {
  g.fillStyle(colour, alpha).fillPoints(pts as Phaser.Types.Math.Vector2Like[], true, true);
}
function outline(g: G, pts: Pt[], width: number, colour: number, alpha = 1, closed = true): void {
  g.lineStyle(width, colour, alpha).strokePoints(pts as Phaser.Types.Math.Vector2Like[], closed, closed);
}
function shape(g: G, pts: Pt[], colour: number, line: number, width = 2.5): void {
  fill(g, pts, colour);
  outline(g, pts, width, line);
}
/** A stroke with round ends. */
function stroke(g: G, pts: Pt[], width: number, colour: number, alpha = 1): void {
  g.lineStyle(width, colour, alpha).strokePoints(pts as Phaser.Types.Math.Vector2Like[], false, false);
  g.fillStyle(colour, alpha).fillCircle(pts[0]!.x, pts[0]!.y, width / 2).fillCircle(pts.at(-1)!.x, pts.at(-1)!.y, width / 2);
}
/** A crescent-ish ribbon along a curve, `w0` thick at the start and `w1` at the end (brows, lids, lashes). */
function ribbon(g: G, pts: Pt[], w0: number, w1: number, colour: number, alpha = 1): void {
  const top: Pt[] = [], bottom: Pt[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const t = i / (pts.length - 1), w = (w0 + (w1 - w0) * t) / 2;
    top.push({ x: p.x - (dy / len) * w, y: p.y + (dx / len) * w });
    bottom.push({ x: p.x + (dy / len) * w, y: p.y - (dx / len) * w });
  });
  fill(g, [...top, ...bottom.reverse()], colour, alpha);
}

const line = (c: number): number => mixColour(shadeColour(c, 0.42), INK, 0.55);
const light = (c: number, t = 0.3): number => mixColour(c, 0xfff1c9, t);
const dark = (c: number, t = 0.82): number => mixColour(shadeColour(c, t), 0x3b2f5e, 0.12);

// ── Layout (design pixels inside the 230×270 frame) ─────────────────────────

interface Frame {
  cx: number; hy: number; rx: number; ry: number;
  /** The face's centre line, turned a little to the right (§16.1: three-quarter view, facing right). */
  fx: number; ey: number; eyeR: number; my: number; shoulderY: number;
}
function frameFor(look: PortraitLook): Frame {
  const child = look.age === 'child';
  const cx = W / 2, hy = child ? 120 : 112, rx = child ? 55 : 53, ry = child ? 58 : 62;
  const fx = cx + 6, ey = hy + (child ? 8 : 4);
  return { cx, hy, rx, ry, fx, ey, eyeR: child ? 14 : 12, my: ey + (child ? 34 : 40), shoulderY: child ? 208 : 198 };
}

// ── The frame and the static bust ───────────────────────────────────────────

export function drawFrame(g: G, look: PortraitLook): void {
  const f = frameFor(look);
  g.fillStyle(shadeColour(look.colour, 0.3), 0.97).fillRoundedRect(0, 0, W, H, 16);
  for (let i = 0; i < 6; i++) g.fillStyle(light(look.colour, 0.35), 0.06).fillCircle(f.cx, f.hy - 4, 118 - i * 15);
  g.fillStyle(0x000000, 0.12).fillRect(10, H - 26, W - 20, 2);
}

function drawBackHair(g: G, look: PortraitLook, f: Frame): void {
  const { cx, hy, rx, ry } = f, hair = look.hair, ln = line(hair);
  switch (look.hairStyle) {
    case 'bob': {
      const top = arcPts(cx, hy - 6, rx + 12, ry + 8, Math.PI, Math.PI * 2, 24);
      const pts = [{ x: cx - rx - 14, y: hy + 40 }, ...top, { x: cx + rx + 13, y: hy + 40 },
        ...quad({ x: cx + rx + 13, y: hy + 40 }, { x: cx + rx + 6, y: hy + 54 }, { x: cx + rx - 8, y: hy + 48 }, 6),
        ...quad({ x: cx - rx + 8, y: hy + 48 }, { x: cx - rx - 8, y: hy + 56 }, { x: cx - rx - 14, y: hy + 40 }, 6)];
      shape(g, pts, hair, ln);
      return;
    }
    case 'long': {
      const top = arcPts(cx, hy - 6, rx + 12, ry + 8, Math.PI, Math.PI * 2, 24);
      const pts = [{ x: cx - rx - 22, y: H - 30 }, ...quad({ x: cx - rx - 22, y: H - 30 }, { x: cx - rx - 20, y: hy + 10 }, top[0]!, 8),
        ...top, ...quad(top.at(-1)!, { x: cx + rx + 22, y: hy + 10 }, { x: cx + rx + 24, y: H - 34 }, 8),
        { x: cx + 30, y: H - 40 }, { x: cx - 30, y: H - 40 }];
      shape(g, pts, hair, ln);
      return;
    }
    case 'curly': {
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.85 + (Math.PI * 1.3 * i) / 10;
        const x = cx + (rx + 6) * Math.cos(a), y = hy - 6 + (ry + 6) * Math.sin(a);
        g.fillStyle(hair).fillCircle(x, y, 17);
        g.lineStyle(2.5, ln).strokeCircle(x, y, 17);
      }
      fill(g, arcPts(cx, hy - 6, rx + 8, ry + 6), hair);
      return;
    }
    case 'tufty': {
      for (const [dx, h2, lean] of [[-42, 16, -16], [-22, 22, -14], [-2, 14, -10]] as const) {
        const base = { x: cx + dx, y: hy - ry + 14 };
        const tip = { x: base.x + lean, y: hy - ry - h2 };
        const tuft = [...quad({ x: base.x - 15, y: base.y }, { x: base.x - 16, y: base.y - h2 * 1.1 }, tip, 8),
          ...quad(tip, { x: base.x + 10, y: base.y - h2 * 0.9 }, { x: base.x + 15, y: base.y }, 8)];
        shape(g, tuft, hair, ln, 2.2);
      }
      shape(g, arcPts(cx, hy - 8, rx + 6, ry + 2), hair, ln);
      return;
    }
    case 'ponytail': {
      // Pulled back into a tail that hangs behind the head (the back of the head is the viewer's left).
      const root = { x: cx - rx + 4, y: hy - 34 };
      const tail = [...quad(root, { x: cx - rx - 26, y: hy - 30 }, { x: cx - rx - 18, y: hy + 66 }, 12),
        ...quad({ x: cx - rx - 18, y: hy + 66 }, { x: cx - rx - 2, y: hy + 20 }, { x: root.x + 14, y: root.y + 6 }, 10).slice(1)];
      shape(g, tail, hair, ln);
      stroke(g, quad({ x: cx - rx - 8, y: hy - 12 }, { x: cx - rx - 16, y: hy + 20 }, { x: cx - rx - 14, y: hy + 50 }, 8), 1.6, dark(hair, 0.78), 0.55);
      g.fillStyle(look.cloth).fillRoundedRect(root.x - 12, root.y - 2, 14, 10, 3);
      shape(g, arcPts(cx, hy - 8, rx + 5, ry + 2), hair, ln);
      return;
    }
    case 'pigtails': {
      for (const side of [-1, 1]) {
        const x = cx + side * (rx + 14), y = hy + 14;
        const bunch = [...quad({ x: x - side * 14, y: y - 18 }, { x: x + side * 26, y: y - 8 }, { x: x + side * 6, y: y + 40 }, 12),
          ...quad({ x: x + side * 6, y: y + 40 }, { x: x - side * 10, y: y + 18 }, { x: x - side * 14, y: y - 18 }, 8).slice(1)];
        shape(g, bunch, hair, ln);
        g.fillStyle(look.cloth).fillCircle(x - side * 10, y - 12, 6);
      }
      shape(g, arcPts(cx, hy - 8, rx + 6, ry + 2), hair, ln);
      return;
    }
    case 'swept': {
      // Grown out: one shaggy mass down the back of the head (the viewer's left) to the collar, its ends flicking out.
      const x0 = cx - rx;
      const nape = [{ x: x0 + 10, y: hy - 34 }, ...quad({ x: x0 - 8, y: hy - 14 }, { x: x0 - 14, y: hy + 28 }, { x: x0 - 6, y: hy + 56 }, 10),
        { x: x0 - 18, y: hy + 68 }, { x: x0 + 2, y: hy + 62 }, { x: x0 + 2, y: hy + 76 }, { x: x0 + 16, y: hy + 62 },
        { x: x0 + 28, y: hy + 58 }, { x: cx - 16, y: hy + 36 }];
      shape(g, nape, hair, ln);
      stroke(g, quad({ x: x0 - 4, y: hy + 6 }, { x: x0 - 8, y: hy + 34 }, { x: x0 - 2, y: hy + 54 }, 8), 1.6, dark(hair, 0.78), 0.55);
      shape(g, arcPts(cx, hy - 8, rx + 7, ry + 3), hair, ln);
      return;
    }
    case 'buzz':
      shape(g, arcPts(cx, hy - 6, rx + 2, ry - 1), hair, ln);
      return;
    case 'bun':
    case 'braid': {
      if (look.hairStyle === 'bun' && look.headwear === 'none') {
        g.fillStyle(hair).fillCircle(cx - 6, hy - ry - 10, 24);
        g.lineStyle(2.5, ln).strokeCircle(cx - 6, hy - ry - 10, 24);
        stroke(g, quad({ x: cx - 22, y: hy - ry - 20 }, { x: cx - 6, y: hy - ry - 4 }, { x: cx + 12, y: hy - ry - 18 }, 8), 2.2, dark(hair, 0.7));
      }
      shape(g, arcPts(cx, hy - 8, rx + 6, ry + 3), hair, ln);
      return;
    }
    default:
      shape(g, arcPts(cx, hy - 8, rx + (look.hairStyle === 'cropped' ? 3 : 6), ry + (look.hairStyle === 'cropped' ? 0 : 2)), hair, ln);
  }
}

function drawBody(g: G, look: PortraitLook, f: Frame): void {
  const { cx, hy, ry, shoulderY } = f, skin = look.skin, cloth = look.cloth;
  const half = look.build === 'broad' ? 104 : look.build === 'narrow' ? 86 : 95;
  // Neck, with the chin's shadow.
  const neck = [{ x: cx - 18, y: hy + ry - 24 }, { x: cx + 22, y: hy + ry - 24 }, { x: cx + 24, y: shoulderY + 14 }, { x: cx - 20, y: shoulderY + 14 }];
  shape(g, neck, skin, line(skin));
  fill(g, arcPts(cx + 4, hy + ry - 6, 24, 9), dark(skin, 0.85));
  // Shoulders.
  const bottom = H - 3;
  const body = [
    { x: cx - half, y: bottom },
    ...quad({ x: cx - half, y: bottom }, { x: cx - half + 2, y: shoulderY + 6 }, { x: cx - 28, y: shoulderY }, 10),
    ...quad({ x: cx + 32, y: shoulderY }, { x: cx + half - 2, y: shoulderY + 6 }, { x: cx + half, y: bottom }, 10)
  ];
  shape(g, body, cloth, line(cloth), 3);
  fill(g, [{ x: cx + half - 26, y: shoulderY + 16 }, { x: cx + half - 6, y: shoulderY + 24 }, { x: cx + half - 2, y: bottom - 1 }, { x: cx + half - 30, y: bottom - 1 }], dark(cloth), 0.75);
  stroke(g, quad({ x: cx - half + 20, y: shoulderY + 30 }, { x: cx - half + 26, y: shoulderY + 44 }, { x: cx - half + 24, y: bottom - 4 }, 6), 2, line(cloth), 0.5);
  // Neckline.
  switch (look.collar) {
    case 'vneck':
      shape(g, [{ x: cx - 20, y: shoulderY - 1 }, { x: cx + 24, y: shoulderY - 1 }, { x: cx + 2, y: shoulderY + 34 }], skin, line(cloth));
      break;
    case 'shirt': {
      const collar = light(0xe8e2d4, 0.2);
      shape(g, [{ x: cx - 18, y: shoulderY - 6 }, { x: cx + 1, y: shoulderY + 14 }, { x: cx - 30, y: shoulderY + 22 }], collar, line(0xb8b0a0), 2);
      shape(g, [{ x: cx + 22, y: shoulderY - 6 }, { x: cx + 3, y: shoulderY + 14 }, { x: cx + 36, y: shoulderY + 22 }], collar, line(0xb8b0a0), 2);
      break;
    }
    default:
      shape(g, [...arcPts(cx + 2, shoulderY + 1, 24, 13, 0, Math.PI, 16)], skin, line(cloth));
  }
  // An apron's bib and neck strap, or a scarf (a tea towel over a shoulder reads the same), as the sprite wears them.
  if (look.apron !== undefined) {
    const a = look.apron, top = shoulderY + 30;
    stroke(g, quad({ x: cx - 30, y: top + 2 }, { x: cx - 26, y: shoulderY - 2 }, { x: cx - 8, y: shoulderY - 8 }, 8), 5, line(a));
    stroke(g, quad({ x: cx - 30, y: top + 2 }, { x: cx - 26, y: shoulderY - 2 }, { x: cx - 8, y: shoulderY - 8 }, 8), 3, a);
    stroke(g, quad({ x: cx + 36, y: top + 2 }, { x: cx + 32, y: shoulderY - 2 }, { x: cx + 14, y: shoulderY - 8 }, 8), 5, line(a));
    stroke(g, quad({ x: cx + 36, y: top + 2 }, { x: cx + 32, y: shoulderY - 2 }, { x: cx + 14, y: shoulderY - 8 }, 8), 3, a);
    const bib = [{ x: cx - 36, y: top }, { x: cx + 42, y: top }, { x: cx + 46, y: bottom + 2 }, { x: cx - 40, y: bottom + 2 }];
    shape(g, bib, a, line(a), 2.5);
    fill(g, [{ x: cx + 26, y: top + 2 }, { x: cx + 41, y: top + 2 }, { x: cx + 44, y: bottom }, { x: cx + 28, y: bottom }], dark(a), 0.6);
  }
  if (look.scarf !== undefined) {
    const sc = look.scarf, ln = line(sc);
    const wrap = [...quad({ x: cx - 40, y: shoulderY - 8 }, { x: cx + 2, y: shoulderY + 30 }, { x: cx + 44, y: shoulderY - 8 }, 14),
      ...quad({ x: cx + 44, y: shoulderY - 8 }, { x: cx + 40, y: shoulderY + 10 }, { x: cx + 30, y: shoulderY + 18 }, 6).slice(1),
      ...quad({ x: cx + 30, y: shoulderY + 18 }, { x: cx + 2, y: shoulderY + 44 }, { x: cx - 30, y: shoulderY + 18 }, 14).slice(1),
      ...quad({ x: cx - 30, y: shoulderY + 18 }, { x: cx - 40, y: shoulderY + 10 }, { x: cx - 40, y: shoulderY - 8 }, 6).slice(1)];
    shape(g, [{ x: cx - 30, y: shoulderY + 16 }, { x: cx - 14, y: shoulderY + 22 }, { x: cx - 18, y: bottom }, { x: cx - 38, y: bottom }], sc, ln, 2.5);
    shape(g, wrap, sc, ln, 2.5);
    stroke(g, quad({ x: cx - 30, y: shoulderY + 6 }, { x: cx + 2, y: shoulderY + 32 }, { x: cx + 34, y: shoulderY + 6 }, 12), 1.8, dark(sc), 0.6);
  }
}

function headPts(f: Frame, look: PortraitLook): Pt[] {
  return arcPts(f.cx, f.hy, f.rx, f.ry, 0, Math.PI * 2, 56, look.age === 'child' ? 0.16 : 0.24);
}

function drawHead(g: G, look: PortraitLook, f: Frame): void {
  const { cx, hy, rx, ey, fx } = f, skin = look.skin, ln = line(skin);
  // Ears: the near one whole, the far one tucked behind the turned head.
  for (const [x, w] of [[cx - rx + 1, 16], [cx + rx - 1, 13]] as const) {
    g.fillStyle(skin).fillEllipse(x, ey + 2, w, 26);
    g.lineStyle(2.5, ln).strokeEllipse(x, ey + 2, w, 26);
    g.fillStyle(dark(skin, 0.82)).fillEllipse(x, ey + 3, w * 0.45, 13);
  }
  const head = headPts(f, look);
  shape(g, head, skin, ln, 3);
  // Cel shade down the far cheek and jaw (light from the upper left).
  const shade = [...arcPts(cx, hy, rx, f.ry, -Math.PI * 0.32, Math.PI * 0.42, 18, 0.24)];
  const inner = quad(shade.at(-1)!, { x: cx + rx - 8, y: hy + 6 }, shade[0]!, 12);
  fill(g, [...shade, ...inner.slice(1)], dark(skin, 0.9), 0.7);
  outline(g, head, 3, ln);
  // Nose: a small hook pointing right.
  stroke(g, quad({ x: fx + 3, y: ey + 14 }, { x: fx + 10, y: ey + 25 }, { x: fx + 2, y: ey + 27 }, 8), 2.5, ln, 0.9);
  if (look.age === 'elder') {
    for (const side of [-1, 1]) {
      const x = fx + side * 37;
      stroke(g, [{ x, y: ey + 1 }, { x: x + side * 7, y: ey - 2 }], 1.8, ln, 0.55);
      stroke(g, [{ x, y: ey + 5 }, { x: x + side * 7, y: ey + 6 }], 1.8, ln, 0.55);
    }
    stroke(g, quad({ x: fx - 12, y: ey + 24 }, { x: fx - 19, y: ey + 34 }, { x: fx - 16, y: ey + 42 }, 8), 1.8, ln, 0.45);
    stroke(g, quad({ x: fx + 16, y: ey + 24 }, { x: fx + 22, y: ey + 34 }, { x: fx + 19, y: ey + 42 }, 8), 1.8, ln, 0.45);
  }
  if (look.stubble) {
    // A shadow of stubble round the jaw and the upper lip (a scatter, the same every draw).
    const dot = mixColour(shadeColour(skin, 0.68), look.hair, 0.35);
    for (let i = 0; i < 140; i++) {
      // Denser toward the jaw line and fading inward, so the shadow has no edge of its own.
      const a = Math.PI * (0.1 + 0.8 * ((i * 0.618034) % 1)), u = (i * 0.381966 + 0.13) % 1, k = 0.5 + 0.46 * Math.sqrt(u);
      const x = fx - 4 + Math.cos(a) * (rx - 4) * k, y = hy + 6 + Math.sin(a) * (f.ry - 2) * k;
      if (y < ey + 26) continue;
      g.fillStyle(dot, 0.12 + 0.5 * u).fillCircle(x, y, 1.1);
    }
  }
  if (look.freckles) {
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      g.fillStyle(shadeColour(skin, 0.72), 0.8).fillCircle(fx + side * (24 + (i % 3) * 6) + (i > 2 ? 3 : 0), ey + 18 + (i > 2 ? 5 : 0), 1.6);
    }
  }
}

function drawFrontHair(g: G, look: PortraitLook, f: Frame): void {
  const { cx, hy, rx, ry } = f, hair = look.hair, ln = line(hair);
  const cap = (lower: number, scallop: number, sweep: number, span = 0.02): Pt[] => {
    const top = arcPts(cx, hy - 4, rx + 4, ry + 4, Math.PI * (1 + span), Math.PI * (2 - span), 26);
    const edge: Pt[] = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = top.at(-1)!.x + (top[0]!.x - top.at(-1)!.x) * t;
      const y = hy - lower + Math.sin(t * Math.PI) * -6 + (i % 2 ? scallop : 0) + sweep * (t - 0.5) * 8;
      edge.push({ x, y });
    }
    return [...top, ...edge];
  };
  const hl = (r: number, a0: number, a1: number) =>
    ribbon(g, arcPts(cx - 4, hy - 8, rx - r, ry - r - 4, a0, a1, 12), 2, 6, light(hair, 0.45), 0.9);
  switch (look.hairStyle) {
    case 'bob': {
      shape(g, cap(22, 4, -1), hair, ln);
      for (const side of [-1, 1]) {
        const x = cx + side * (rx - 4);
        const outer = quad({ x: x + side * 8, y: hy - 36 }, { x: x + side * 18, y: hy + 12 }, { x: x + side * 4, y: hy + 46 }, 12);
        const inner = quad({ x: x + side * 4, y: hy + 46 }, { x: x - side * 14, y: hy + 30 }, { x: x - side * 8, y: hy - 30 }, 12);
        shape(g, [...outer, ...inner.slice(1)], hair, ln);
        stroke(g, quad({ x: x + side * 4, y: hy - 18 }, { x: x + side * 8, y: hy + 14 }, { x: x + side * 1, y: hy + 36 }, 8), 1.6, dark(hair, 0.8), 0.5);
      }
      break;
    }
    case 'long':
      shape(g, cap(26, 3, 2), hair, ln);
      shape(g, [...quad({ x: cx - rx + 10, y: hy - 26 }, { x: cx - rx - 2, y: hy + 20 }, { x: cx - rx - 8, y: hy + 70 }, 10), { x: cx - rx - 20, y: hy + 66 }, { x: cx - rx - 14, y: hy - 20 }], hair, ln);
      break;
    case 'curly':
      for (let i = 0; i < 5; i++) {
        const x = cx - rx + 18 + i * ((rx * 2 - 36) / 4), y = hy - ry + 30 + (i % 2) * 5;
        g.fillStyle(hair).fillCircle(x, y, 13);
        g.lineStyle(2.2, ln).strokeCircle(x, y, 13);
      }
      break;
    case 'bun':
    case 'braid':
    case 'ponytail': {
      // Swept back: a high hairline with a parting.
      const top = arcPts(cx, hy - 4, rx + 4, ry + 4, Math.PI * 1.1, Math.PI * 1.9, 26);
      const edge = quad(top.at(-1)!, { x: cx + 8, y: hy - 76 }, top[0]!, 12);
      shape(g, [...top, ...edge.slice(1)], hair, ln);
      for (const dx of [-26, -8, 12]) {
        stroke(g, quad({ x: cx + dx, y: hy - 50 + Math.abs(dx) * 0.3 }, { x: cx + dx - 6, y: hy - 62 }, { x: cx + dx - 2, y: hy - ry - 2 }, 6), 1.6, dark(hair, 0.78), 0.55);
      }
      break;
    }
    case 'tufty':
      shape(g, cap(42, 2, 1, 0.12), hair, ln);
      break;
    case 'cropped':
      shape(g, cap(34, 2, 0), hair, ln);
      break;
    case 'buzz':
      // Close-cropped: a hairline high on the brow, no fringe.
      shape(g, cap(46, 0, 0, 0.05), hair, ln);
      break;
    case 'pigtails':
      shape(g, cap(26, 5, 1), hair, ln);
      stroke(g, quad({ x: cx - 2, y: hy - ry - 2 }, { x: cx + 2, y: hy - 50 }, { x: cx + 4, y: hy - 30 }, 8), 2, dark(hair, 0.7), 0.7);
      break;
    case 'swept':
      // A smooth fringe swept down from a parting on the far side toward the near brow.
      shape(g, cap(24, 0, 3), hair, ln);
      stroke(g, quad({ x: cx + 26, y: hy - ry + 4 }, { x: cx - 6, y: hy - 44 }, { x: cx - rx + 2, y: hy - 18 }, 10), 1.8, dark(hair, 0.78), 0.55);
      break;
    case 'cowlick':
      shape(g, cap(24, 6, 2), hair, ln);
      shape(g, [...quad({ x: cx - 2, y: hy - ry - 2 }, { x: cx + 4, y: hy - ry - 30 }, { x: cx + 24, y: hy - ry - 22 }, 8), { x: cx + 12, y: hy - ry + 2 }], hair, ln, 2.2);
      break;
    default:
      shape(g, cap(26, 5, 1), hair, ln);
  }
  if (look.headwear === 'none') hl(10, Math.PI * 1.2, Math.PI * 1.45);
  if (look.greyTemples) {
    for (const side of [-1, 1]) {
      ribbon(g, quad({ x: cx + side * (rx - 6), y: hy - 40 }, { x: cx + side * (rx + 3), y: hy - 22 }, { x: cx + side * (rx - 1), y: hy - 4 }, 8), 3, 6, 0xc3c0b8, 0.95);
    }
  }
  if (look.hairStyle === 'braid') {
    for (let i = 0; i < 6; i++) {
      const x = cx - rx + 4 - i * 1.5 + (i % 2 ? 4 : -4), y = hy + 34 + i * 17;
      g.fillStyle(hair).fillEllipse(x, y, 22, 20);
      g.lineStyle(2.2, ln).strokeEllipse(x, y, 22, 20);
      stroke(g, [{ x: x - 8, y: y - 2 }, { x: x + 6, y: y + 5 }], 1.8, ln, 0.6);
    }
    g.fillStyle(look.cloth).fillRect(cx - rx - 8, hy + 132, 16, 6);
  }
}

function drawHeadwear(g: G, look: PortraitLook, f: Frame): void {
  const { cx, hy, rx, ry, fx } = f, c = look.capColour, ln = line(c);
  switch (look.headwear) {
    case 'peaked': {
      const crown = [...arcPts(cx, hy - 34, rx + 8, ry - 16, Math.PI, Math.PI * 2, 24), { x: cx + rx + 6, y: hy - 30 }, { x: cx - rx - 6, y: hy - 30 }];
      shape(g, crown, c, ln, 3);
      g.fillStyle(dark(c, 0.7)).fillRect(cx - rx - 6, hy - 40, rx * 2 + 12, 11);
      g.fillStyle(dark(c, 0.55)).fillEllipse(fx + 18, hy - 27, rx * 1.5, 14);
      g.lineStyle(2.5, ln).strokeEllipse(fx + 18, hy - 27, rx * 1.5, 14);
      g.fillStyle(0xe4c77f).fillCircle(fx + 2, hy - 52, 6);
      g.lineStyle(1.5, 0x8a6a2a).strokeCircle(fx + 2, hy - 52, 6);
      break;
    }
    case 'flat': {
      const crown = [...arcPts(cx + 4, hy - 30, rx + 10, ry - 30, Math.PI * 1.02, Math.PI * 1.98, 24), { x: cx + rx + 12, y: hy - 28 }, { x: cx - rx - 6, y: hy - 30 }];
      shape(g, crown, c, ln, 3);
      for (let i = 0; i < 4; i++) stroke(g, [{ x: cx - 30 + i * 18, y: hy - 52 }, { x: cx - 24 + i * 18, y: hy - 40 }], 1.6, dark(c, 0.75), 0.7);
      g.fillStyle(dark(c, 0.7)).fillEllipse(fx + 26, hy - 28, rx * 1.1, 10);
      g.lineStyle(2.5, ln).strokeEllipse(fx + 26, hy - 28, rx * 1.1, 10);
      break;
    }
    case 'beanie': {
      shape(g, [...arcPts(cx, hy - 32, rx + 8, ry - 6, Math.PI, Math.PI * 2, 24)], c, ln, 3);
      g.fillStyle(dark(c, 0.8)).fillRoundedRect(cx - rx - 9, hy - 44, rx * 2 + 18, 18, 6);
      g.lineStyle(2.5, ln).strokeRoundedRect(cx - rx - 9, hy - 44, rx * 2 + 18, 18, 6);
      for (let x = cx - rx - 2; x < cx + rx + 6; x += 9) stroke(g, [{ x, y: hy - 41 }, { x, y: hy - 30 }], 1.6, ln, 0.5);
      break;
    }
    default:
  }
}

/** Everything that doesn't change with the expression. */
export function drawBust(g: G, look: PortraitLook): void {
  if (look.animal) { drawCatBody(g, look); return; }
  const f = frameFor(look);
  drawBackHair(g, look, f);
  drawBody(g, look, f);
  drawHead(g, look, f);
  drawFrontHair(g, look, f);
  drawHeadwear(g, look, f);
}

// ── The face, per expression ────────────────────────────────────────────────

function drawEye(g: G, look: PortraitLook, f: Frame, x: number, far: boolean, expr: PortraitExpression): void {
  const spec = FACES[expr], skin = look.skin, ink = INK, ey = f.ey;
  const sx = far ? 0.9 : 1, r = f.eyeR;
  const inner = far ? -1 : 1; // which way the nose is
  if (spec.eyes === 'smile') {
    ribbon(g, quad({ x: x - r * sx, y: ey + 3 }, { x, y: ey - 11 }, { x: x + r * sx, y: ey + 3 }, 12), 3, 4.5, ink);
    return;
  }
  const wide = spec.eyes === 'wide';
  const rw = r * sx * (wide ? 1.15 : 1), rh = r * (wide ? 1.3 : 1.05);
  g.fillStyle(0xfffaf0).fillEllipse(x, ey, rw * 2, rh * 2);
  const ir = r * 0.72 * spec.iris.scale * (look.age === 'child' ? 1.08 : 1);
  const ix = x + spec.iris.dx * sx, iy = ey + spec.iris.dy + (wide ? 0 : 1);
  g.fillStyle(look.eyes).fillCircle(ix, iy, ir);
  g.fillStyle(dark(look.eyes, 0.55)).fillCircle(ix, iy - ir * 0.25, ir * 0.55);
  g.fillStyle(0x1a1418).fillCircle(ix, iy, ir * 0.45);
  g.fillStyle(0xffffff).fillCircle(ix - ir * 0.38, iy - ir * 0.42, Math.max(2, ir * 0.3)).fillCircle(ix + ir * 0.35, iy + ir * 0.35, Math.max(1, ir * 0.14));
  // Lids: a skin-coloured cover above the lid line hides what the lid hides.
  const left = x - rw - 1, right = x + rw + 1;
  const lid = (yInner: number, yOuter: number) => {
    const yl = inner > 0 ? yOuter : yInner, yr = inner > 0 ? yInner : yOuter; // the inner end faces the nose
    fill(g, [{ x: left, y: ey - rh - 4 }, { x: right, y: ey - rh - 4 }, { x: right, y: yr }, { x: left, y: yl }], skin);
    ribbon(g, [{ x: left, y: yl }, { x: right, y: yr }], inner > 0 ? 3 : 5, inner > 0 ? 5 : 3, ink);
  };
  if (spec.eyes === 'narrow') {
    lid(ey - rh * 0.2, ey - rh * 0.75);
    fill(g, [{ x: left, y: ey + rh * 0.62 }, { x: right, y: ey + rh * 0.62 }, { x: right, y: ey + rh + 3 }, { x: left, y: ey + rh + 3 }], skin);
    stroke(g, [{ x: left + 3, y: ey + rh * 0.62 }, { x: right - 3, y: ey + rh * 0.62 }], 1.8, line(skin), 0.7);
    return;
  }
  if (spec.eyes === 'lidded') {
    lid(ey - rh * 0.55, ey - rh * 0.05);
    stroke(g, quad({ x: x - rw * 0.7, y: ey + rh + 1 }, { x, y: ey + rh + 4 }, { x: x + rw * 0.7, y: ey + rh + 1 }, 8), 1.6, line(skin), 0.6);
    return;
  }
  // Open and wide: a lash line over the top, a flick at the outer corner, a light lower lid.
  const lash = arcPts(x, ey, rw + 1, rh + 1, Math.PI * 1.08, Math.PI * 1.92, 14);
  ribbon(g, lash, 3, 4.5, ink);
  const outer = inner > 0 ? lash[0]! : lash.at(-1)!;
  stroke(g, [outer, { x: outer.x - inner * 5, y: outer.y - 4 }], 3, ink);
  stroke(g, arcPts(x, ey, rw * 0.8, rh + 1, Math.PI * 0.25, Math.PI * 0.75, 8), 1.6, line(skin), wide ? 0.8 : 0.45);
}

function drawBrow(g: G, look: PortraitLook, f: Frame, x: number, far: boolean, expr: PortraitExpression): void {
  const b = FACES[expr].brow;
  const toNose = far ? -1 : 1, by = f.ey - f.eyeR - 10;
  const inner = { x: x + toNose * 12, y: by + b.inner }, outer = { x: x - toNose * (far ? 13 : 15), y: by + b.outer };
  const mid = { x: (inner.x + outer.x) / 2, y: (inner.y + outer.y) / 2 - b.arch };
  const browColour = mixColour(look.hair === 0xece8df || look.hair === 0xc9cdd4 ? 0x8a8478 : shadeColour(look.hair, 0.8), INK, 0.25);
  ribbon(g, quad(inner, mid, outer, 10), b.weight + 1, b.weight * 0.55, browColour);
}

function drawMouth(g: G, look: PortraitLook, f: Frame, expr: PortraitExpression): void {
  const mx = f.fx + 2, my = f.my, lip = mixColour(shadeColour(look.skin, 0.45), 0x8a2f35, 0.45);
  const cavity = 0x5a1f28, tongue = 0xdb7480;
  switch (FACES[expr].mouth) {
    case 'calm':
      stroke(g, quad({ x: mx - 10, y: my }, { x: mx + 1, y: my + 3 }, { x: mx + 11, y: my - 1 }, 8), 3, lip);
      break;
    case 'grin': {
      const top = quad({ x: mx - 17, y: my - 4 }, { x: mx, y: my + 1 }, { x: mx + 18, y: my - 5 }, 12);
      const bottom = quad({ x: mx + 18, y: my - 5 }, { x: mx + 1, y: my + 22 }, { x: mx - 17, y: my - 4 }, 12);
      const mouth = [...top, ...bottom.slice(1)];
      fill(g, mouth, cavity);
      g.fillStyle(tongue).fillEllipse(mx + 1, my + 10, 16, 8);
      ribbon(g, top.map(p => ({ x: p.x, y: p.y + 2.5 })), 4, 4, 0xfffaf0);
      outline(g, mouth, 2.5, lip);
      stroke(g, [{ x: mx - 19, y: my - 7 }, { x: mx - 15, y: my - 3 }], 2.2, lip);
      stroke(g, [{ x: mx + 20, y: my - 8 }, { x: mx + 16, y: my - 4 }], 2.2, lip);
      break;
    }
    case 'frown':
      stroke(g, quad({ x: mx - 13, y: my + 6 }, { x: mx, y: my - 6 }, { x: mx + 13, y: my + 5 }, 10), 3.2, lip);
      break;
    case 'grit': {
      const teeth = [{ x: mx - 17, y: my - 3 }, { x: mx + 18, y: my - 5 }, { x: mx + 19, y: my + 6 }, { x: mx - 16, y: my + 8 }];
      fill(g, teeth, 0xfffaf0);
      stroke(g, [{ x: mx - 16, y: my + 2 }, { x: mx + 18, y: my + 1 }], 1.6, line(look.skin), 0.8);
      for (const dx of [-8, 1, 10]) stroke(g, [{ x: mx + dx, y: my - 3 }, { x: mx + dx, y: my + 6 }], 1.4, line(look.skin), 0.6);
      outline(g, teeth, 2.6, lip);
      break;
    }
    case 'open': {
      const o = arcPts(mx + 1, my + 4, 9, 12, 0, Math.PI * 2, 24);
      fill(g, o, cavity);
      g.fillStyle(tongue).fillEllipse(mx + 1, my + 11, 11, 5);
      outline(g, o, 2.6, lip);
      break;
    }
    case 'wavy': {
      const pts: Pt[] = [];
      for (let i = 0; i <= 16; i++) pts.push({ x: mx - 15 + (30 * i) / 16, y: my + 1 + Math.sin((i / 16) * Math.PI * 3) * 2.6 });
      stroke(g, pts, 3, lip);
      break;
    }
  }
}

function drawExtras(g: G, look: PortraitLook, f: Frame, expr: PortraitExpression): void {
  const { cx, hy, rx, fx, ey } = f;
  const nearX = fx - 23, farX = fx + 23;
  for (const extra of FACES[expr].extras) {
    switch (extra) {
      case 'blush':
        for (const x of [nearX - 5, farX + 6]) {
          g.fillStyle(0xff7b7b, 0.32).fillEllipse(x, ey + 18, 24, 11);
          for (let i = -1; i <= 1; i++) stroke(g, [{ x: x + i * 6 - 2, y: ey + 21 }, { x: x + i * 6 + 2, y: ey + 15 }], 1.6, 0xe0605f, 0.6);
        }
        break;
      case 'tear': {
        const x = nearX - f.eyeR + 1, y = ey + f.eyeR + 4;
        const drop = [{ x, y: y - 6 }, ...arcPts(x, y + 3, 4.5, 5.5, -Math.PI * 0.15, Math.PI * 1.15, 12)];
        shape(g, drop, 0xa8dcf7, 0x4a8ab0, 1.6);
        g.fillStyle(0xffffff, 0.9).fillCircle(x - 1.5, y + 1.5, 1.4);
        break;
      }
      case 'vein': {
        const vx = fx + 34, vy = hy - 34, red = 0xd8473f;
        for (const [dx, dy, a0] of [[-6, -6, 0], [6, -6, 0.5], [6, 6, 1], [-6, 6, 1.5]] as const) {
          stroke(g, arcPts(vx + dx, vy + dy, 5.5, 5.5, Math.PI * a0, Math.PI * (a0 + 0.5), 6), 3, red);
        }
        break;
      }
      case 'flush':
        g.fillStyle(0xd8473f, 0.14).fillEllipse(fx, ey + 14, 70, 12);
        break;
      case 'pop':
        for (const [a, len] of [[-0.6, 13], [-0.4, 16], [-0.18, 12]] as const) {
          const ox = cx + rx * 0.9, oy = hy - 34;
          const c = Math.cos(a * Math.PI), s = Math.sin(a * Math.PI);
          stroke(g, [{ x: ox + c * 18, y: oy + s * 18 }, { x: ox + c * (18 + len), y: oy + s * (18 + len) }], 3.5, 0xfff1c9, 0.95);
        }
        break;
      case 'sweat': {
        const x = cx - rx + 8, y = hy - 22;
        const drop = [{ x, y: y - 10 }, ...arcPts(x, y + 3, 7, 8.5, -Math.PI * 0.12, Math.PI * 1.12, 14)];
        shape(g, drop, 0xc4e8fb, 0x4a8ab0, 2);
        g.fillStyle(0xffffff, 0.9).fillEllipse(x - 2.5, y + 1, 3, 5);
        break;
      }
    }
  }
}

/** The six-way part: brows, eyes, mouth and the small extras. */
export function drawFace(g: G, look: PortraitLook, expr: PortraitExpression): void {
  if (look.animal) { drawCatFace(g, look, expr); return; }
  const f = frameFor(look);
  const nearX = f.fx - 23, farX = f.fx + 23;
  drawEye(g, look, f, nearX, false, expr);
  drawEye(g, look, f, farX, true, expr);
  drawBrow(g, look, f, nearX, false, expr);
  drawBrow(g, look, f, farX, true, expr);
  drawMouth(g, look, f, expr);
  drawExtras(g, look, f, expr);
}

/** Over the face: glasses, a moustache, then the frame's border. */
export function drawOverlay(g: G, look: PortraitLook): void {
  if (!look.animal) {
    const f = frameFor(look), { fx, ey, hy, cx, rx } = f;
    const frameColour = look.glasses === 'on_head' ? 0x6b3f22 : 0x3a2a26;
    switch (look.glasses) {
      case 'round':
      case 'heavy': {
        const w = look.glasses === 'heavy' ? 4 : 2.5;
        for (const x of [fx - 23, fx + 23]) {
          if (look.glasses === 'heavy') g.lineStyle(w, frameColour).strokeRoundedRect(x - 16, ey - 13, 32, 26, 8);
          else g.lineStyle(w, frameColour).strokeCircle(x, ey, 16);
          stroke(g, arcPts(x, ey, 11, 10, Math.PI * 1.15, Math.PI * 1.45, 6), 2, 0xffffff, 0.55);
        }
        stroke(g, quad({ x: fx - 7, y: ey - 2 }, { x: fx, y: ey - 6 }, { x: fx + 7, y: ey - 2 }, 6), w, frameColour);
        stroke(g, [{ x: fx - 39, y: ey - 2 }, { x: cx - rx + 2, y: ey - 4 }], w, frameColour);
        break;
      }
      case 'halfmoon':
        for (const x of [fx - 23, fx + 23]) {
          stroke(g, arcPts(x, ey + 3, 15, 12, 0, Math.PI, 12), 2.5, 0x8a6a2a);
          stroke(g, [{ x: x - 15, y: ey + 3 }, { x: x + 15, y: ey + 3 }], 2.5, 0x8a6a2a);
        }
        stroke(g, [{ x: fx - 8, y: ey + 3 }, { x: fx + 8, y: ey + 3 }], 2.5, 0x8a6a2a);
        for (let i = 0; i < 9; i++) g.fillStyle(0xe4c77f).fillCircle(cx - rx + 2 + i * 1.5, ey + 8 + i * 9, 1.6);
        break;
      case 'on_head':
        for (const x of [fx - 20, fx + 18]) {
          g.fillStyle(0xdfe9ef, 0.35).fillEllipse(x, hy - 50, 26, 17);
          g.lineStyle(3, frameColour).strokeEllipse(x, hy - 50, 26, 17);
        }
        stroke(g, [{ x: fx - 7, y: hy - 51 }, { x: fx + 5, y: hy - 51 }], 3, frameColour);
        break;
      default:
    }
    if (look.moustache) {
      const mx = fx + 3, my = ey + 31;
      const pts = [...quad({ x: mx - 24, y: my + 8 }, { x: mx - 14, y: my - 10 }, { x: mx, y: my - 3 }, 8),
        ...quad({ x: mx, y: my - 3 }, { x: mx + 14, y: my - 10 }, { x: mx + 25, y: my + 7 }, 8),
        ...quad({ x: mx + 25, y: my + 7 }, { x: mx + 12, y: my + 3 }, { x: mx, y: my + 5 }, 6),
        ...quad({ x: mx, y: my + 5 }, { x: mx - 12, y: my + 3 }, { x: mx - 24, y: my + 8 }, 6)];
      shape(g, pts, look.hair, line(look.hair), 2.2);
    }
  }
  g.lineStyle(2, GOLD, 0.5).strokeRoundedRect(1, 1, W - 2, H - 2, 16);
}

// ── Bastien (and any later animal): a cat bust ──────────────────────────────

/** content/residents/bastien.yaml: an orange tabby with a white bib and a notched left ear. */
const CAT = { fur: 0xd98a3d, markings: 0xa8592a, bib: 0xf4ecdc, eyes: 0x9bbf4a, nose: 0xe88f96 } as const;

function catFrame(): { cx: number; hy: number } { return { cx: W / 2 + 4, hy: 128 }; }
/** The cat's colours: its card look's coat, or Bastien's. */
const catOf = (look: PortraitLook): { fur: number; markings: number; bib: number; eyes: number; nose: number } => ({ ...CAT, ...look.coat });

function drawCatBody(g: G, look: PortraitLook): void {
  const { cx, hy } = catFrame(), CAT = catOf(look), ln = line(CAT.fur);
  const body = [{ x: cx - 96, y: H - 3 }, ...quad({ x: cx - 96, y: H - 3 }, { x: cx - 92, y: hy + 40 }, { x: cx, y: hy + 34 }, 14),
    ...quad({ x: cx, y: hy + 34 }, { x: cx + 94, y: hy + 40 }, { x: cx + 98, y: H - 3 }, 14).slice(1)];
  shape(g, body, CAT.fur, ln, 3);
  fill(g, [...quad({ x: cx - 40, y: H - 3 }, { x: cx - 44, y: hy + 50 }, { x: cx + 4, y: hy + 44 }, 10),
    ...quad({ x: cx + 4, y: hy + 44 }, { x: cx + 52, y: hy + 50 }, { x: cx + 46, y: H - 3 }, 10).slice(1)], CAT.bib);
  for (const dx of [-70, 66]) ribbon(g, [{ x: cx + dx, y: hy + 70 }, { x: cx + dx * 0.9, y: hy + 92 }], 6, 2, CAT.markings);
  // Head with cheek fluff.
  const head: Pt[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (Math.PI * 2 * i) / 48, s = Math.sin(a), cheek = s > 0.1 && Math.abs(Math.cos(a)) > 0.55 ? (i % 2 ? 7 : 0) : 0;
    head.push({ x: cx + (66 + cheek) * Math.cos(a), y: hy + (56 + cheek * 0.4) * s });
  }
  shape(g, head, CAT.fur, ln, 3);
  for (const dx of [-14, 0, 14]) ribbon(g, [{ x: cx + dx * 1.2, y: hy - 52 }, { x: cx + dx, y: hy - 32 }], 6, 2, CAT.markings);
  for (const side of [-1, 1]) ribbon(g, [{ x: cx + side * 62, y: hy - 4 }, { x: cx + side * 46, y: hy + 2 }], 5, 2, CAT.markings);
  fill(g, arcPts(cx + 4, hy + 24, 30, 20), CAT.bib);
  g.fillStyle(CAT.nose).fillTriangle(cx - 2, hy + 10, cx + 12, hy + 10, cx + 5, hy + 18);
  for (const side of [-1, 1]) for (const dy of [-3, 4]) {
    stroke(g, quad({ x: cx + 5 + side * 26, y: hy + 22 + dy }, { x: cx + 5 + side * 48, y: hy + 18 + dy * 1.6 }, { x: cx + 5 + side * 70, y: hy + 22 + dy * 2.4 }, 8), 1.4, 0xfff6e8, 0.9);
  }
}

function drawCatFace(g: G, look: PortraitLook, expr: PortraitExpression): void {
  const { cx, hy } = catFrame(), CAT = catOf(look), ln = line(CAT.fur), spec = FACES[expr];
  // Ears follow the mood: up, tall, drooped or flat back. The notch is on his left (the viewer's right).
  const earUp = expr === 'surprised' ? 1.25 : expr === 'sad' ? 0.55 : expr === 'angry' ? 0.45 : expr === 'worried' ? 0.8 : 1;
  const flare = expr === 'angry' || expr === 'sad' ? 1.5 : 1;
  for (const side of [-1, 1]) {
    const base0 = { x: cx + side * 22, y: hy - 50 }, base1 = { x: cx + side * 60, y: hy - 26 };
    const tip = { x: cx + side * (44 * flare), y: hy - 50 - 46 * earUp };
    const ear = side > 0 ? [base0, tip, { x: tip.x + 4, y: tip.y + 14 }, { x: tip.x - 2, y: tip.y + 20 }, base1] : [base0, tip, base1];
    fill(g, ear, CAT.fur);
    outline(g, ear, 3, ln, 1, false);
    fill(g, [{ x: base0.x + side * 8, y: base0.y + 2 }, { x: tip.x - side * 3, y: tip.y + 16 }, { x: base1.x - side * 12, y: base1.y - 6 }], 0xf2b4b0, 0.9);
  }
  // Eyes.
  for (const side of [-1, 1]) {
    const x = cx + 4 + side * 28, y = hy - 8;
    if (spec.eyes === 'smile') { ribbon(g, quad({ x: x - 12, y: y + 2 }, { x, y: y - 9 }, { x: x + 12, y: y + 2 }, 10), 3, 4, INK); continue; }
    const r = spec.eyes === 'wide' ? 16 : 13;
    g.fillStyle(CAT.eyes).fillEllipse(x, y, r * 2, r * 1.9);
    const pw = spec.eyes === 'wide' ? r * 1.2 : expr === 'angry' ? 3 : 6;
    g.fillStyle(0x1a1418).fillEllipse(x + spec.iris.dx, y + spec.iris.dy, pw, r * 1.6);
    g.fillStyle(0xffffff).fillCircle(x - r * 0.35, y - r * 0.4, 3);
    g.lineStyle(2.5, INK).strokeEllipse(x, y, r * 2, r * 1.9);
    if (spec.eyes === 'narrow' || spec.eyes === 'lidded') {
      const yIn = spec.eyes === 'narrow' ? y - 2 : y - r * 0.6, yOut = spec.eyes === 'narrow' ? y - r * 0.8 : y - r * 0.1;
      const xl = x - r - 2, xr = x + r + 2, yl = side > 0 ? yIn : yOut, yr = side > 0 ? yOut : yIn;
      fill(g, [{ x: xl, y: y - r - 4 }, { x: xr, y: y - r - 4 }, { x: xr, y: yr }, { x: xl, y: yl }], CAT.fur);
      ribbon(g, [{ x: xl, y: yl }, { x: xr, y: yr }], 4, 4, INK);
    }
  }
  // Mouth.
  const mx = cx + 5, my = hy + 22, lip = line(CAT.bib);
  switch (spec.mouth) {
    case 'open':
    case 'grit': {
      const o = arcPts(mx, my + 8, expr === 'angry' ? 13 : 9, expr === 'angry' ? 9 : 11, 0, Math.PI * 2, 20);
      fill(g, o, 0x5a1f28);
      if (expr === 'angry') { g.fillStyle(0xffffff).fillTriangle(mx - 10, my + 1, mx - 6, my + 1, mx - 8, my + 8).fillTriangle(mx + 6, my + 1, mx + 10, my + 1, mx + 8, my + 8); }
      outline(g, o, 2.2, lip);
      break;
    }
    case 'frown':
      stroke(g, quad({ x: mx - 9, y: my + 8 }, { x: mx, y: my }, { x: mx + 9, y: my + 8 }, 8), 2.4, lip);
      break;
    case 'wavy': {
      const pts: Pt[] = [];
      for (let i = 0; i <= 12; i++) pts.push({ x: mx - 11 + (22 * i) / 12, y: my + 4 + Math.sin((i / 12) * Math.PI * 3) * 2 });
      stroke(g, pts, 2.4, lip);
      break;
    }
    default:
      stroke(g, quad({ x: mx - 12, y: my + 2 }, { x: mx - 6, y: my + 9 }, { x: mx, y: my + 2 }, 6), 2.4, lip);
      stroke(g, quad({ x: mx, y: my + 2 }, { x: mx + 6, y: my + 9 }, { x: mx + 12, y: my + 2 }, 6), 2.4, lip);
  }
  drawExtras(g, look, { cx, hy: hy - 6, rx: 62, ry: 56, fx: cx + 4, ey: hy - 8, eyeR: 13, my, shoulderY: H }, expr);
}

// ── The component ───────────────────────────────────────────────────────────

let manifestLoad: Promise<PortraitManifest> | null = null;
/** The art manifest, fetched once per session; a missing or broken file means no art (never an error). */
export function loadPortraitManifest(base: string = import.meta.env.BASE_URL): Promise<PortraitManifest> {
  manifestLoad ??= fetch(`${base}${MANIFEST_PATH}`, { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : {}))
    .then(parsePortraitManifest)
    .catch(() => ({}));
  return manifestLoad;
}

export interface PortraitOptions {
  residentId: string;
  look: PortraitLook;
  x: number;
  y: number;
  /** Show the expression's name in the top corner. */
  label?: boolean;
  /** Load art from the manifest (off for galleries that only want the procedural bust). */
  art?: boolean;
}

export class Portrait {
  readonly root: Phaser.GameObjects.Container;
  /** Squash and hop pivot: bottom centre of the frame. */
  private readonly body: Phaser.GameObjects.Container;
  private readonly bust: G;
  private readonly faces: [G, G];
  private readonly overlay: G;
  private readonly images: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private readonly label: Phaser.GameObjects.Text | null;
  /** A dark veil over the frame while the player speaks (darker, never see-through). */
  private readonly veil: G;
  private active = 0;
  private shown: string | null = null;
  /** The expression id last asked for (before mapping), so art that arrives later can honour it. */
  private wanted = 'neutral';
  private dim: Phaser.Tweens.Tween | null = null;
  private art: PortraitManifest = {};
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly opts: PortraitOptions) {
    this.root = scene.add.container(opts.x, opts.y);
    const frame = scene.add.graphics();
    drawFrame(frame, opts.look);
    this.body = scene.add.container(W / 2, H);
    const at = <T extends Phaser.GameObjects.Components.Transform>(o: T): T => { o.setPosition(-W / 2, -H); return o; };
    this.bust = at(scene.add.graphics());
    drawBust(this.bust, opts.look);
    this.faces = [at(scene.add.graphics()), at(scene.add.graphics())];
    this.overlay = at(scene.add.graphics());
    drawOverlay(this.overlay, opts.look);
    this.images = [0, 1].map(() => scene.add.image(0, 0, '__MISSING').setOrigin(0.5, 1).setVisible(false)) as [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
    this.body.add([this.bust, ...this.faces, ...this.images, this.overlay]);
    this.label = opts.label
      ? scene.add.text(W - 12, 12, '', { fontFamily: FAMILY_BODY, fontSize: '13px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE }).setOrigin(1, 0)
      : null;
    this.veil = scene.add.graphics().setAlpha(0);
    this.veil.fillStyle(0x0c100d, 1).fillRoundedRect(0, 0, W, H, 16);
    this.root.add([frame, this.body, ...(this.label ? [this.label] : []), this.veil]);
    if (opts.art !== false) void this.loadArt();
  }

  get x(): number { return this.opts.x; }

  /**
   * Show an expression (any id: mapped onto the six, unknown → neutral). A change crossfades in 110 ms with a
   * small squash; surprise adds a hop and anger a shake. `instant` skips the motion (first draw, galleries).
   */
  setExpression(expr: string, instant = false): void {
    this.wanted = expr;
    const portrait = portraitExpression(expr);
    const file = artExpression(this.art, this.opts.residentId, expr);
    const key = file ? `art:${file}` : `face:${portrait}`;
    if (key === this.shown || this.destroyed) return;
    const first = this.shown === null;
    this.shown = key;
    this.label?.setText(portrait);
    const next = 1 - this.active, prev = this.active;
    this.active = next;
    const tweens = this.scene.tweens;
    tweens.killTweensOf([...this.faces, ...this.images, this.body]);
    this.body.setScale(1).setPosition(W / 2, H);
    if (file) {
      const image = this.images[next].setTexture(portraitTextureKey(this.opts.residentId, file)).setVisible(true);
      image.setScale(Math.min(W / image.width, H / image.height)).setPosition(0, 0);
      this.faces.forEach(f => f.setVisible(false));
      this.bust.setVisible(false);
      this.overlay.setVisible(false);
      this.fade(image, this.images[prev].visible ? this.images[prev] : null, instant || first);
    } else {
      const face = this.faces[next].clear().setVisible(true);
      drawFace(face, this.opts.look, portrait);
      this.images.forEach(i => i.setVisible(false));
      this.bust.setVisible(true);
      this.overlay.setVisible(true);
      this.fade(face, this.faces[prev], instant || first);
    }
    if (instant || first) return;
    tweens.add({ targets: this.body, scaleY: { from: 0.965, to: 1 }, scaleX: { from: 1.02, to: 1 }, duration: 130, ease: 'Back.easeOut' });
    if (portrait === 'surprised') tweens.add({ targets: this.body, y: { from: H - 7, to: H }, duration: 140, ease: 'Quad.easeOut' });
    if (portrait === 'angry') tweens.add({ targets: this.body, x: { from: W / 2 - 3, to: W / 2 + 3 }, duration: 35, yoyo: true, repeat: 1, onComplete: () => this.body.setX(W / 2) });
  }

  /** The "Hm." thinking beat: a small fidget. */
  fidget(): void {
    if (this.destroyed) return;
    this.scene.tweens.add({
      targets: this.root, x: { from: this.opts.x - 3, to: this.opts.x + 3 }, duration: 130, yoyo: true, repeat: 1,
      ease: 'Sine.easeInOut', onComplete: () => this.root.setX(this.opts.x)
    });
  }

  /** Dim while the player is the one speaking. */
  setDimmed(dim: boolean): void {
    if (this.destroyed) return;
    this.dim?.stop();
    this.dim = this.scene.tweens.add({ targets: this.veil, alpha: dim ? 0.4 : 0, duration: 120 });
  }

  destroy(): void {
    this.destroyed = true;
    this.root.destroy();
  }

  private fade(next: Fadeable, prev: Fadeable | null, instant: boolean): void {
    if (instant || !prev) {
      next.setAlpha(1);
      if (prev && prev !== next) prev.setVisible(false);
      return;
    }
    next.setAlpha(0);
    this.scene.tweens.add({ targets: next, alpha: 1, duration: SWAP_MS, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: prev, alpha: 0, duration: SWAP_MS, ease: 'Sine.easeIn', onComplete: () => prev.setVisible(false) });
  }

  /** Load the resident's art (if the manifest lists any) and switch to it once it's in. */
  private async loadArt(): Promise<void> {
    const manifest = await loadPortraitManifest();
    const id = this.opts.residentId, exprs = manifest[id];
    if (this.destroyed || !exprs?.length) return;
    const textures = this.scene.textures, load = this.scene.load;
    const missing = exprs.filter(e => !textures.exists(portraitTextureKey(id, e)));
    const ready = () => {
      if (this.destroyed) return;
      const have = exprs.filter(e => textures.exists(portraitTextureKey(id, e)));
      this.art = have.length ? { [id]: have } : {};
      this.shown = null;
      this.setExpression(this.wanted, true);
    };
    if (!missing.length) { ready(); return; }
    for (const e of missing) load.image(portraitTextureKey(id, e), portraitUrl(import.meta.env.BASE_URL, id, e));
    load.once(Phaser.Loader.Events.COMPLETE, ready);
    load.start();
  }
}
