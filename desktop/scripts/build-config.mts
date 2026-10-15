// Writes desktop/dist/build-config.json: the monde-mind server the client bundle talks to, so the main process
// can allow exactly that origin in the page's CSP (connect-src). It resolves VITE_MIND_URL the way Vite does
// for a production build: the environment first, then client/.env.production.local, .env.production,
// .env.local and .env; failing those, the client's DEFAULT_MIND_URL (client/src/mind/api.ts).
//
// Run by `npm run build -w @monde/desktop` (after tsc). To point the desktop build at another server, set
// VITE_MIND_URL for `npm run desktop:build` / `desktop:dist`: the client build and this file both read it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const desktop = path.resolve(import.meta.dirname, '..');
const client = path.resolve(desktop, '..', 'client');
const KEY = 'VITE_MIND_URL';

function unquote(value: string): string {
  const v = value.trim();
  const q = v[0];
  if ((q === '"' || q === "'" || q === '`') && v.endsWith(q) && v.length >= 2) return v.slice(1, -1);
  return v.replace(/\s+#.*$/, '').trim();
}

function fromEnvFiles(): string | undefined {
  for (const name of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const file = path.join(client, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
      if (m?.[1] === KEY) return unquote(m[2] ?? '');
    }
  }
  return undefined;
}

function clientDefault(): string {
  const source = readFileSync(path.join(client, 'src', 'mind', 'api.ts'), 'utf8');
  const m = /export const DEFAULT_MIND_URL\s*=\s*['"`]([^'"`]+)['"`]/.exec(source);
  if (!m) throw new Error('desktop: could not find DEFAULT_MIND_URL in client/src/mind/api.ts; set VITE_MIND_URL');
  return m[1]!;
}

export function resolveMindUrl(): string {
  const url = process.env[KEY]?.trim() || fromEnvFiles() || clientDefault();
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`desktop: ${KEY} is not a URL: ${url}`); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error(`desktop: ${KEY} must be https (or http://localhost for testing): ${url}`);
  }
  return url;
}

export function writeBuildConfig(): string {
  const mindUrl = resolveMindUrl();
  mkdirSync(path.join(desktop, 'dist'), { recursive: true });
  writeFileSync(path.join(desktop, 'dist', 'build-config.json'), `${JSON.stringify({ mindUrl }, null, 2)}\n`);
  return mindUrl;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(`desktop: build-config.json → monde-mind at ${writeBuildConfig()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
