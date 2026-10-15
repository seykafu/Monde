import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { parseWindowState, placeWindow, readWindowState, writeWindowState, type WindowState } from '../windowState';

const defaults = { width: 1280, height: 720, minWidth: 960, minHeight: 540 };
const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const external = { x: 1512, y: -200, width: 2560, height: 1415 };
const state = (x: number, y: number, width = 1300, height = 760, extra: Partial<WindowState> = {}): WindowState =>
  ({ bounds: { x, y, width, height }, maximized: false, fullscreen: false, ...extra });

describe('placeWindow', () => {
  it('opens at the game size, centred, on first run', () => {
    expect(placeWindow(null, [laptop], defaults)).toEqual({ bounds: { width: 1280, height: 720 }, useContentSize: true, maximized: false, fullscreen: false });
  });

  it('restores a saved place, size and modes', () => {
    expect(placeWindow(state(100, 80, 1300, 760, { maximized: true, fullscreen: true }), [laptop], defaults))
      .toEqual({ bounds: { x: 100, y: 80, width: 1300, height: 760 }, useContentSize: false, maximized: true, fullscreen: true });
  });

  it('keeps a window on a second display while it is plugged in', () => {
    expect(placeWindow(state(2000, 0), [laptop, external], defaults).bounds).toEqual({ x: 2000, y: 0, width: 1300, height: 760 });
  });

  it('re-centres a window whose display is gone', () => {
    expect(placeWindow(state(2000, 0), [laptop], defaults).bounds).toEqual({ width: 1300, height: 760 });
    expect(placeWindow(state(-5000, -5000), [laptop], defaults).bounds).toEqual({ width: 1300, height: 760 });
  });

  it('clamps the size to the minimum and the largest display', () => {
    expect(placeWindow(state(0, 30, 200, 100), [laptop], defaults).bounds).toMatchObject({ width: 960, height: 540 });
    expect(placeWindow(state(0, 30, 9000, 9000), [laptop], defaults).bounds).toMatchObject({ width: 1512, height: 920 });
  });
});

describe('window-state.json', () => {
  it('round-trips and survives junk', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'monde-window-'));
    const file = path.join(dir, 'window-state.json');
    expect(readWindowState(file)).toBeNull();
    writeWindowState(file, state(10, 20));
    expect(readWindowState(file)).toEqual(state(10, 20));
    expect(readdirSync(dir)).toEqual(['window-state.json']);
    writeFileSync(file, '{"bounds": {"x": "left"}}');
    expect(readWindowState(file)).toBeNull();
    expect(parseWindowState({ bounds: { x: 1.4, y: 2.6, width: 1000, height: 600 }, maximized: 'yes' }))
      .toEqual({ bounds: { x: 1, y: 3, width: 1000, height: 600 }, maximized: false, fullscreen: false });
  });
});
