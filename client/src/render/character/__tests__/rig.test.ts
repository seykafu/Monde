import { describe, expect, it } from 'vitest';
import { ACCESSORIES, BASTIEN_LOOK, BOTTOM_STYLES, DEFAULT_PLAYER_LOOK, HAIR_STYLES, residentLook, type Look } from '../look';
import { renderSheet } from '../rig';
import { FACINGS, PROCEDURAL_LAYOUT, columns, frameFor } from '../sheet';

const W = 32, H = 48;
type Sheet = ReturnType<typeof renderSheet>;
const alpha = (s: Sheet, x: number, y: number) => s.data[(y * s.width + x) * 4 + 3]!;
const pixel = (s: Sheet, x: number, y: number) => {
  const i = (y * s.width + x) * 4;
  return s.data[i + 3] ? (s.data[i]! << 16) | (s.data[i + 1]! << 8) | s.data[i + 2]! : -1;
};
/** A cell's pixels as a string, optionally mirrored, for comparisons. */
function cell(s: Sheet, frame: number, mirror = false): string {
  const cols = s.width / W, cx = (frame % cols) * W, cy = Math.floor(frame / cols) * H, out: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(pixel(s, cx + (mirror ? W - 1 - x : x), cy + y));
  return out.join(',');
}
function bounds(s: Sheet, frame: number) {
  const cols = s.width / W, cx = (frame % cols) * W, cy = Math.floor(frame / cols) * H;
  let top = H, bottom = -1, left = W, right = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alpha(s, cx + x, cy + y)) {
    top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
  }
  return { top, bottom, left, right };
}
const L = PROCEDURAL_LAYOUT;
const walkFrame = (facing: (typeof FACINGS)[number], i: number) => frameFor(L, facing, 'walk', i).frame;

const variety: Look[] = [DEFAULT_PLAYER_LOOK, BASTIEN_LOOK];
for (const hairStyle of HAIR_STYLES) for (const bottomStyle of BOTTOM_STYLES) for (const accessory of ACCESSORIES)
  variety.push({ ...DEFAULT_PLAYER_LOOK, hairStyle, bottomStyle, accessory });

describe('procedural rig', () => {
  const player = renderSheet(DEFAULT_PLAYER_LOOK);

  it('fills the procedural layout: 4 rows × (3 idle + 4 walk) cells of 32×48', () => {
    expect(player.width).toBe(columns(L) * W);
    expect(player.height).toBe(4 * H);
  });

  it('draws hard-edged pixels (alpha 0 or 255), feet on the ground, nothing clipped, in every look and frame', () => {
    for (const look of variety) {
      const s = renderSheet(look);
      expect(s.data.filter((v, i) => i % 4 === 3 && v !== 0 && v !== 255).length).toBe(0);
      for (let f = 0; f < 4 * columns(L); f++) {
        const b = bounds(s, f);
        expect(b.bottom).toBe(H - 1);           // the sole's outline sits on the cell's bottom row
        expect(b.top).toBeGreaterThan(0);       // no hair cut off at the top
        expect(b.left).toBeGreaterThan(0);
        expect(b.right).toBeLessThan(W - 1);
      }
    }
  });

  it('keeps the small palette of GDD §16.1: at most 24 colours a frame', () => {
    for (const look of variety) {
      const s = renderSheet(look);
      for (let f = 0; f < 4 * columns(L); f++) expect(new Set(cell(s, f).split(',')).size - 1).toBeLessThanOrEqual(24);
    }
  });

  it('draws "right" as "left" mirrored', () => {
    for (let c = 0; c < columns(L); c++) expect(cell(player, 2 * columns(L) + c)).toBe(cell(player, columns(L) + c, true));
  });

  it('gives every facing four distinct walk frames, with the body 1 px up on passing frames', () => {
    for (const facing of FACINGS) {
      const frames = [0, 1, 2, 3].map(i => cell(player, walkFrame(facing, i)));
      expect(new Set(frames).size).toBe(4);
      const tops = [0, 1, 2, 3].map(i => bounds(player, walkFrame(facing, i)).top);
      expect(tops[1]).toBe(tops[0]! - 1);
      expect(tops[3]).toBe(tops[2]! - 1);
      expect(tops[0]).toBe(tops[2]);
    }
  });

  it('breathes (head and shoulders 1 px down) and blinks only where there is a face', () => {
    const idle = (facing: (typeof FACINGS)[number], kind: 'idle' | 'blink', i = 0) => frameFor(L, facing, kind, i).frame;
    for (const facing of FACINGS) {
      expect(bounds(player, idle(facing, 'idle', 1)).top).toBe(bounds(player, idle(facing, 'idle', 0)).top + 1);
      const blinkDiffers = cell(player, idle(facing, 'blink')) !== cell(player, idle(facing, 'idle', 0));
      expect(blinkDiffers).toBe(facing !== 'up');
    }
  });

  it('draws different looks differently', () => {
    const a = cell(renderSheet(residentLook('odile', 0xc9734a)), 0), b = cell(renderSheet(residentLook('pell', 0x6a8fb5)), 0);
    expect(a).not.toBe(b);
  });
});

describe('resident looks', () => {
  it('are complete and stable for any id', () => {
    for (let i = 0; i < 300; i++) {
      const id = `resident_${i}~${i * 7}`;
      const look = residentLook(id, 0x336699);
      for (const v of Object.values(look)) expect(v).not.toBeUndefined();
      for (const k of ['skin', 'hair', 'eyes', 'top', 'bottom', 'shoes', 'accessoryColour'] as const) {
        expect(Number.isInteger(look[k]) && look[k] >= 0 && look[k] <= 0xffffff).toBe(true);
      }
      expect(HAIR_STYLES).toContain(look.hairStyle);
      expect(look).toEqual(residentLook(id, 0x336699));
      expect(look.top).toBe(0x336699);
    }
  });
});
