// app://monde/ serves the built client (client/dist, or Resources/game in a packaged app). A standard, secure
// scheme gives the page a real origin, so relative URLs (Vite's base "./" and import.meta.env.BASE_URL),
// fetch(), module scripts, localStorage and IndexedDB behave as they do on itch.io. No Electron imports: the
// handler is a plain Request → Response function (main.ts hands it to protocol.handle), tested under vitest.
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';

type PathModule = typeof nodePath.posix;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm'
};

export function mimeType(file: string): string {
  return MIME[nodePath.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * The file under `root` for a URL path, or null if it would escape the root. "/" is index.html. Takes the
 * path module so tests can check Windows separators too.
 */
export function resolveAppPath(root: string, pathname: string, path: PathModule = nodePath): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  if (decoded === '' || decoded.endsWith('/')) decoded += 'index.html';
  const base = path.resolve(root);
  const file = path.resolve(base, `.${path.sep}${decoded.replace(/^[/\\]+/, '')}`);
  return file.startsWith(base + path.sep) ? file : null;
}

/** A single `bytes=` range → [start, end] inclusive; 'invalid' for an unsatisfiable one; null to send it all. */
export function parseRange(header: string | null, size: number): [number, number] | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multiple ranges or another unit: answer with the whole file
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start: number, end: number;
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(a); end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return [start, end];
}

export interface AppHandlerOptions {
  /** The built client: index.html and its assets. */
  root: string;
  /** Only app://<host>/ is served. */
  host: string;
  /** Sent with every response; it governs the document. */
  csp: string;
}

/** The app:// handler. GET and HEAD only; no SPA fallback (a missing asset is a 404, as music probing expects). */
export function createAppHandler(options: AppHandlerOptions): (request: Request) => Promise<Response> {
  const base: Record<string, string> = {
    'content-security-policy': options.csp,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache'
  };
  const status = (code: number, extra: Record<string, string> = {}) =>
    new Response(null, { status: code, headers: { ...base, ...extra } });
  return async request => {
    let url: URL;
    try { url = new URL(request.url); } catch { return status(400); }
    if (url.host !== options.host) return status(404);
    if (request.method !== 'GET' && request.method !== 'HEAD') return status(405, { allow: 'GET, HEAD' });
    const file = resolveAppPath(options.root, url.pathname);
    if (!file) return status(404);
    let data: Buffer;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return status(404);
      data = await fs.readFile(file);
    } catch {
      return status(404);
    }
    const headers: Record<string, string> = { ...base, 'content-type': mimeType(file), 'accept-ranges': 'bytes' };
    const range = parseRange(request.headers.get('range'), data.length);
    if (range === 'invalid') return status(416, { 'content-range': `bytes */${data.length}` });
    const body = range ? data.subarray(range[0], range[1] + 1) : data;
    if (range) headers['content-range'] = `bytes ${range[0]}-${range[1]}/${data.length}`;
    headers['content-length'] = String(body.length);
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: range ? 206 : 200, headers });
  };
}
