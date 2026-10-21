/* global URL, AbortSignal, fetch */
/** Run npm run dashboard (staging), or npm run dashboard -- --url http://localhost:8080.
 * Set ADMIN_TOKEN or save it in ~/.config/monde/admin_token.txt. Open http://localhost:4310.
 * Tokens stay in this process. The page shows UTC calendar days; world costs cover the chart range.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export function buildUpstreamRequest(target, token, path, method = 'GET', body) {
  const local = new URL(path, 'http://localhost:4310');
  const routes = { '/api/usage': '/admin/usage.json', '/api/models': '/admin/models' };
  if (!routes[local.pathname] || !['GET', 'PUT'].includes(method) || (method === 'PUT' && local.pathname !== '/api/models')) return null;
  const url = new URL(routes[local.pathname], target);
  if (local.pathname === '/api/usage' && local.searchParams.has('days')) url.searchParams.set('days', local.searchParams.get('days'));
  return { url, options: { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(15000), ...(method === 'PUT' ? { body } : {}) } };
}

export function createDashboardServer(target, token) {
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      // Defense against an upstream accidentally echoing credentials, including JSON escapes.
      res.end(body.replaceAll(token, '[redacted]').replaceAll(JSON.stringify(token).slice(1, -1), '[redacted]'));
    };
    if (!['localhost:4310', '127.0.0.1:4310'].includes(req.headers.host) ||
        (req.headers.origin && !['http://localhost:4310', 'http://127.0.0.1:4310'].includes(req.headers.origin))) {
      return send(403, '{"error":"forbidden"}');
    }
    try {
      if (req.url === '/' && req.method === 'GET') return send(200, await readFile(new URL('./index.html', import.meta.url), 'utf8'), 'text/html; charset=utf-8');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) return send(413, '{"error":"request too large"}');
      }
      const upstream = buildUpstreamRequest(target, token, req.url, req.method, body);
      if (!upstream) return send(404, '{"error":"not found"}');
      const response = await fetch(upstream.url, upstream.options);
      const data = await response.json();
      return send(response.status, JSON.stringify(data));
    } catch {
      return send(502, '{"error":"Could not reach the Monde server"}');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--url')) throw new Error();
    const target = new URL(args[1] ?? 'https://monde-mind-staging.fly.dev');
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error();
    const token = (process.env.ADMIN_TOKEN ?? await readFile(`${homedir()}/.config/monde/admin_token.txt`, 'utf8')).trim();
    if (!token) throw new Error();
    const server = createDashboardServer(target, token);
    server.on('error', () => { process.stderr.write('Dashboard could not listen on 127.0.0.1:4310.\n'); process.exitCode = 1; });
    server.listen(4310, '127.0.0.1', () => process.stdout.write('http://localhost:4310\n'));
  } catch {
    process.stderr.write('Set ADMIN_TOKEN or ~/.config/monde/admin_token.txt; usage: npm run dashboard -- [--url http://localhost:8080]\n');
    process.exitCode = 1;
  }
}
