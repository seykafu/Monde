// Desktop constants and the build-time config (dist/build-config.json, written by scripts/build-config.ts).
// No Electron imports, so the pure modules and their tests can use it.
import { readFileSync } from 'node:fs';

/** The game is served from app://monde/ (protocol.ts), a standard, secure scheme with its own origin. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'monde';
/** The page's origin as servers see it (the Origin header); server/src/app.ts allows it for CORS. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY = `${APP_ORIGIN}/index.html`;

export const PRODUCT_NAME = 'Monde';
/** The loading background: index.html's body colour, so the window never flashes white. */
export const BACKGROUND = '#14110f';

/**
 * The window's first size is the game's 1280×720 (content area). GDD-GAP: the GDD gives no minimum window
 * size; 960×540 keeps the game's 16:9 frame and its smallest UI text readable.
 */
export const WINDOW = { width: 1280, height: 720, minWidth: 960, minHeight: 540 } as const;

export interface BuildConfig {
  /** The monde-mind server the client bundle was built against (VITE_MIND_URL or the client's default). */
  mindUrl: string;
}

/** An http(s) URL's origin, or null. Only https, except plain http to this machine for local testing. */
export function mindOrigin(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol === 'https:') return parsed.origin;
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return parsed.origin;
  return null;
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/** The build config, or null when it is missing or malformed (then the CSP allows no server: Quiet Mode). */
export function readBuildConfig(file: string): BuildConfig | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildConfig> | null;
    if (!raw || typeof raw.mindUrl !== 'string' || !mindOrigin(raw.mindUrl)) return null;
    return { mindUrl: raw.mindUrl };
  } catch {
    return null;
  }
}
