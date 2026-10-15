// The window's size, position, maximized and fullscreen state, kept in <userData>/window-state.json between
// runs. Pure placement logic plus small synchronous file helpers (written on close). No Electron imports.
import { readFileSync, renameSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';

export interface Rect { x: number; y: number; width: number; height: number }

export interface WindowState {
  /** The normal (not maximized, not fullscreen) frame bounds. */
  bounds: Rect;
  maximized: boolean;
  fullscreen: boolean;
}

export interface WindowDefaults { width: number; height: number; minWidth: number; minHeight: number }

export interface Placement {
  /** Frame bounds; x and y are absent to let the OS centre the window. */
  bounds: { x?: number; y?: number; width: number; height: number };
  /** Size is the content area (first run: the game's 1280×720), not the frame. */
  useContentSize: boolean;
  maximized: boolean;
  fullscreen: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseWindowState(raw: unknown): WindowState | null {
  const s = raw as Partial<WindowState> | null;
  const b = s?.bounds as Partial<Rect> | undefined;
  if (!s || typeof s !== 'object' || !b || ![b.x, b.y, b.width, b.height].every(finite)) return null;
  return {
    bounds: { x: Math.round(b.x!), y: Math.round(b.y!), width: Math.round(b.width!), height: Math.round(b.height!) },
    maximized: s.maximized === true,
    fullscreen: s.fullscreen === true
  };
}

const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Where to open the window. A saved size is clamped to the minimum and to the largest display; a saved
 * position is kept only if its title bar (top 40 px) is on a display now, so an unplugged monitor can't
 * strand the window off-screen.
 */
export function placeWindow(state: WindowState | null, workAreas: readonly Rect[], defaults: WindowDefaults): Placement {
  if (!state) {
    return { bounds: { width: defaults.width, height: defaults.height }, useContentSize: true, maximized: false, fullscreen: false };
  }
  const maxW = Math.max(defaults.minWidth, ...workAreas.map(a => a.width));
  const maxH = Math.max(defaults.minHeight, ...workAreas.map(a => a.height));
  const width = Math.min(Math.max(state.bounds.width, defaults.minWidth), maxW);
  const height = Math.min(Math.max(state.bounds.height, defaults.minHeight), maxH);
  const titleBar: Rect = { x: state.bounds.x, y: state.bounds.y, width, height: Math.min(40, height) };
  const visible = workAreas.some(a => overlap(titleBar, a) >= Math.min(titleBar.width, 120) * titleBar.height * 0.5);
  return {
    bounds: visible ? { x: state.bounds.x, y: state.bounds.y, width, height } : { width, height },
    useContentSize: false,
    maximized: state.maximized,
    fullscreen: state.fullscreen
  };
}

export function readWindowState(file: string): WindowState | null {
  try { return parseWindowState(JSON.parse(readFileSync(file, 'utf8'))); } catch { return null; }
}

/** Written synchronously (the window is closing); temp + rename so a crash never leaves half a file. */
export function writeWindowState(file: string, state: WindowState): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(state)}\n`, 'utf8');
    renameSync(tmp, file);
  } catch {
    rmSync(tmp, { force: true });
  }
}
