import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { Script } from 'node:vm';
// @ts-expect-error The dependency-free dashboard is a standalone Node script.
import { buildUpstreamRequest, createDashboardServer } from '../../../../tools/dashboard/server.mjs';

it('adds credentials only to the upstream header, with fixed routes and no redirects', () => {
  const request = buildUpstreamRequest('https://example.test', 'private-token', '/api/usage?days=7&token=attacker');
  expect(request.url.href).toBe('https://example.test/admin/usage.json?days=7');
  expect(request.options.headers.authorization).toBe('Bearer private-token');
  expect(request.options.redirect).toBe('error');
  expect(buildUpstreamRequest('https://example.test', 'private-token', '/admin')).toBeNull();
  expect(buildUpstreamRequest('https://example.test', 'private-token', '/api/usage', 'PUT')).toBeNull();
  const put = buildUpstreamRequest('https://example.test', 'private-token', '/api/models', 'PUT', '{"role":"plan","model":null}');
  expect(put.options.body).not.toContain('private-token');
  expect(put.url.href).not.toContain('private-token');
});
it('never returns an echoed upstream token and rejects foreign origins', async () => {
  const token = 'private-token';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ echoed: token }))));
  const server = createDashboardServer('https://example.test', token);
  const get = (path = '/api/usage', origin?: string) => new Promise<{ status: number; body: string }>(resolve => {
    const req = Object.assign(Readable.from([]), { url: path, method: 'GET', headers: { host: 'localhost:4310', ...(origin ? { origin } : {}) } });
    let status = 0;
    server.emit('request', req, { setHeader() {}, writeHead(code: number) { status = code; }, end(body: string) { resolve({ status, body }); } });
  });
  try {
    expect(await get()).toEqual({ status: 200, body: '{"echoed":"[redacted]"}' });
    expect((await get('/api/usage', 'https://foreign.example')).status).toBe(403);
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.body).not.toContain(token);
    expect(page.body).toContain('Where it goes');
    expect(() => new Script(page.body.match(/<script>([\s\S]*?)<\/script>/)![1]!)).not.toThrow();
  } finally { vi.unstubAllGlobals(); server.close(); }
});
