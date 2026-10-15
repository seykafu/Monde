import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createAppHandler, mimeType, parseRange, resolveAppPath } from '../protocol';

describe('resolveAppPath', () => {
  it('maps URL paths under the root', () => {
    expect(resolveAppPath('/game', '/')).toBe('/game/index.html');
    expect(resolveAppPath('/game', '/index.html')).toBe('/game/index.html');
    expect(resolveAppPath('/game', '/assets/sprites/a%20b.png')).toBe('/game/assets/sprites/a b.png');
    expect(resolveAppPath('/game', '/assets/')).toBe('/game/assets/index.html');
  });

  it.each(['/../secret', '/%2e%2e/secret', '/assets/../../secret', '/..%2fsecret', '/%2e%2e%5csecret', '/%00', '/%E0%A4%A'])('refuses %s', p => {
    const resolved = resolveAppPath('/game', p);
    expect(resolved === null || resolved.startsWith('/game/')).toBe(true);
    if (p !== '/%2e%2e%5csecret') expect(resolved).toBeNull(); // on POSIX "..\secret" is just an odd file name
  });

  it('stays under the root with Windows separators and drive letters', () => {
    const win = path.win32;
    expect(resolveAppPath('C:\\Monde\\game', '/assets/a.png', win)).toBe('C:\\Monde\\game\\assets\\a.png');
    expect(resolveAppPath('C:\\Monde\\game', '/..%5c..%5cWindows%5cwin.ini', win)).toBeNull();
    expect(resolveAppPath('C:\\Monde\\game', '/%5c%5cserver%5cshare%5cx', win)).toBe('C:\\Monde\\game\\server\\share\\x');
    expect(resolveAppPath('C:\\Monde\\game', '/C:/Windows/win.ini', win)?.startsWith('C:\\Monde\\game\\')).toBe(true);
  });
});

describe('parseRange', () => {
  it('parses single byte ranges', () => {
    expect(parseRange('bytes=0-0', 10)).toEqual([0, 0]);
    expect(parseRange('bytes=2-', 10)).toEqual([2, 9]);
    expect(parseRange('bytes=-3', 10)).toEqual([7, 9]);
    expect(parseRange('bytes=5-100', 10)).toEqual([5, 9]);
  });
  it('sends the whole file for no range or one it does not support', () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseRange('items=0-1', 10)).toBeNull();
  });
  it('flags unsatisfiable ranges', () => {
    expect(parseRange('bytes=10-', 10)).toBe('invalid');
    expect(parseRange('bytes=5-2', 10)).toBe('invalid');
    expect(parseRange('bytes=-0', 10)).toBe('invalid');
  });
});

describe('createAppHandler', () => {
  let root: string;
  const csp = "default-src 'self'";
  let handler: (request: Request) => Promise<Response>;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'monde-game-'));
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await mkdir(path.join(root, 'audio', 'music'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Monde</title>');
    await writeFile(path.join(root, 'assets', 'index.js'), 'console.log(1)');
    await writeFile(path.join(root, 'assets', 'manifest.json'), '{"a":1}');
    await writeFile(path.join(root, 'audio', 'music', 'theme.mp3'), Buffer.from('0123456789'));
    handler = createAppHandler({ root, host: 'monde', csp });
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('serves index.html with the CSP', async () => {
    const res = await handler(new Request('app://monde/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe(csp);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toContain('<title>Monde</title>');
  });

  it('serves module scripts and JSON with their types', async () => {
    const js = await handler(new Request('app://monde/assets/index.js'));
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const json = await handler(new Request('app://monde/assets/manifest.json?v=2'));
    expect(await json.json()).toEqual({ a: 1 });
  });

  it('answers HEAD and byte ranges (music probing)', async () => {
    const head = await handler(new Request('app://monde/audio/music/theme.mp3', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('audio/mpeg');
    expect(head.headers.get('content-length')).toBe('10');
    expect(await head.text()).toBe('');
    const part = await handler(new Request('app://monde/audio/music/theme.mp3', { headers: { range: 'bytes=0-0' } }));
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 0-0/10');
    expect(await part.text()).toBe('0');
    const tail = await handler(new Request('app://monde/audio/music/theme.mp3', { headers: { range: 'bytes=7-' } }));
    expect(await tail.text()).toBe('789');
    const bad = await handler(new Request('app://monde/audio/music/theme.mp3', { headers: { range: 'bytes=50-' } }));
    expect(bad.status).toBe(416);
  });

  it('404s missing files, directories, other hosts and traversal (no HTML fallback)', async () => {
    for (const url of ['app://monde/audio/music/missing.mp3', 'app://monde/assets', 'app://other/index.html', 'app://monde/%2e%2e/etc/passwd']) {
      const res = await handler(new Request(url));
      expect(res.status, url).toBe(404);
      expect(res.headers.get('content-type') ?? '', url).not.toMatch(/text\/html/);
    }
  });

  it('refuses methods other than GET and HEAD', async () => {
    const res = await handler(new Request('app://monde/index.html', { method: 'POST', body: 'x' }));
    expect(res.status).toBe(405);
  });

  it('knows the game asset types', () => {
    expect(mimeType('a.png')).toBe('image/png');
    expect(mimeType('a.OGG')).toBe('audio/ogg');
    expect(mimeType('scene.yaml')).toBe('text/yaml; charset=utf-8');
    expect(mimeType('font.woff2')).toBe('font/woff2');
    expect(mimeType('x.unknown')).toBe('application/octet-stream');
  });
});
