// Speech bubble placement (bubbleLayout.ts) and the dev hook's meeting place (chatterDev.ts): pure.
import { describe, expect, it } from 'vitest';
import { TAIL, hudSafe, placeBubble } from '../bubbleLayout';
import { meetingCells } from '../chatterDev';
import { screenToSource, sourceToScreen } from '../../../render/keystone';

const view = { x: 300, y: 200, width: 1280, height: 720 };
const keystone = { k: 0.12, centerX: 0.5 };
const safe = hudSafe(1280, 720, keystone);
const box = { w: 180, h: 40 };

describe('speech bubbles', () => {
  it('keep the HUD bands clear on screen, through the camera perspective', () => {
    // The source rows that land on the HUD's lines: the clock and Pillar strip end at screen y 156, the prompt starts at 620.
    expect(sourceToScreen(640, safe.top, 1280, 720, keystone).y).toBeGreaterThanOrEqual(160);
    expect(sourceToScreen(640, 720 - safe.bottom, 1280, 720, keystone).y).toBeLessThanOrEqual(620);
    expect(safe.top).toBeLessThan(162); // the perspective lifts the top band
    expect(screenToSource(640, 360, 1280, 720, keystone)).not.toBeNull();
  });

  it('sit over the speaker, centred, the tail at their head', () => {
    const p = placeBubble(box, { x: 900, headY: 600, footY: 650 }, view, safe);
    expect(p).toMatchObject({ left: 810, top: 600 - TAIL - 40, flipped: false, tailX: 900 });
  });

  it('stay inside the view at the sides, the tail still pointing at the speaker', () => {
    const left = placeBubble(box, { x: 310, headY: 600, footY: 650 }, view, safe);
    expect(left.left).toBe(view.x + safe.side);
    expect(left.tailX).toBe(left.left + 8);
    const right = placeBubble(box, { x: view.x + view.width - 5, headY: 600, footY: 650 }, view, safe);
    expect(right.left + box.w).toBe(view.x + view.width - safe.side);
  });

  it('flip under the speaker rather than slide under the clock or the zone title', () => {
    const p = placeBubble(box, { x: 900, headY: view.y + 120, footY: view.y + 170 }, view, safe);
    expect(p.flipped).toBe(true);
    expect(p.top).toBe(view.y + 170 + 4 + TAIL);
    expect(p.top).toBeGreaterThanOrEqual(view.y + safe.top);
  });

  it('never drop into the prompt band at the bottom', () => {
    const p = placeBubble(box, { x: 900, headY: view.y + 715, footY: view.y + 760 }, view, safe);
    expect(p.top + box.h).toBeLessThanOrEqual(view.y + view.height - safe.bottom);
  });
});

describe('the dev hook', () => {
  const open = (w: number, h: number, blocked: [number, number][] = []) =>
    Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => !blocked.some(([bx, by]) => bx === x && by === y)));
  it('stands the pair side by side on open ground near the player, in front of them first', () => {
    const cells = meetingCells(open(20, 20), { x: 10.5, y: 10.5 })!;
    expect(cells[1].x - cells[0].x).toBe(1);
    expect(cells[0].y).toBe(cells[1].y);
    expect(cells[0].y).toBeLessThan(10.5);
    expect(Math.hypot(cells[0].x - 10.5, cells[0].y - 10.5)).toBeLessThanOrEqual(5 * Math.SQRT2);
    expect(meetingCells(Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => false)), { x: 10, y: 10 })).toBeNull();
  });
});
