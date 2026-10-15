// Pure security policy for the desktop shell: the page's Content-Security-Policy, which URLs the window may
// navigate to, which links open in the system browser, and which IPC senders are the game. No Electron imports.
import { APP_HOST, APP_SCHEME } from './config';

/**
 * The game's CSP, sent as a header with every app:// response (protocol.ts). What the game needs:
 * - scripts: its own module chunks only (no inline script, no eval);
 * - styles: index.html's inline <style> (Phaser itself styles the canvas through the DOM, which CSP allows);
 * - images and media: its own files plus data: and blob: (Phaser's built-in textures, decoded loads);
 * - connect: its own files (YAML/JSON manifests, audio via fetch) and the monde-mind server (fetch + SSE);
 * - WebGL needs nothing from CSP. No plugins, frames, forms or <base>.
 */
export function buildCsp(connectOrigins: readonly string[]): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'data:', 'blob:', ...connectOrigins],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"]
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** True for app://monde/… (Node's URL gives non-special schemes an opaque "null" origin, so compare parts). */
export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST;
  } catch {
    return false;
  }
}

/** Same origin as `origin` (an http(s) origin such as the Vite dev server's). */
export function isSameOrigin(url: string, origin: string): boolean {
  try { return new URL(url).origin === origin; } catch { return false; }
}

/** The game's own pages: app://monde/, plus the dev server in `desktop:dev`. */
export function isGameUrl(url: string, devOrigin: string | null): boolean {
  return isAppUrl(url) || (devOrigin !== null && isSameOrigin(url, devOrigin));
}

/** A link that may open in the system browser: http(s) and mailto only, never file:, app: or custom schemes. */
export function externalUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Launch arguments the game may read from its URL: an invite code, or Offline (api.ts mindConfig). */
export function entryQuery(argv: readonly string[]): string {
  const params = new URLSearchParams();
  for (const arg of argv) {
    const invite = /^--invite=([A-Za-z0-9_-]{1,64})$/.exec(arg);
    if (invite) params.set('invite', invite[1]!);
    if (arg === '--offline') params.set('offline', '');
  }
  const query = params.toString().replace(/=(?=&|$)/g, '');
  return query ? `?${query}` : '';
}
