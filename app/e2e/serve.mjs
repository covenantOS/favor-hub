// A local server for the e2e scripts: the built app and static files from disk, /api forwarded to the live hub as the FavorOS Tester.
// Every classic page that runs inside the app's frame, loaded against the live API as the FavorOS Tester (reads only: the tester's writes
// answer 403). A local server serves the built app and the static files and forwards /api to dash.favorintl.org.
// Usage:  node app/e2e/islands.mjs [route ...]      Screenshots go to Q:\Temp\Will\react-app\shots\islands.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const LIVE = 'https://dash.favorintl.org';
const OUT = process.env.SHOTS || 'Q:/Temp/Will/react-app/shots/islands';
mkdirSync(OUT, { recursive: true });

const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split(/\r?\n/)[0].trim();
const sess = await (await fetch(LIVE + '/api/admin/test-session' + (process.env.WHO === 'two' ? '?who=two' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + key } })).json();
if (!sess.cookie) throw new Error('no test session');
const COOKIE = `favor_hub_session=${sess.cookie}; hub_gc=1; hub_tester=1`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const serve = (res, f) => {
  if (!f || !existsSync(f) || !statSync(f).isFile()) return false;
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(f).pipe(res);
  return true;
};
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const safe = normalize(decodeURIComponent(u.pathname)).replace(/^[/\\]+/, '');
  if (u.pathname.startsWith('/api/') || u.pathname === '/version.json') {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
    const r = await fetch(LIVE + u.pathname + u.search, { method: req.method, headers: { cookie: COOKIE, 'x-hub-request': '1', 'content-type': req.headers['content-type'] || 'application/json' }, body });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (serve(res, join(PUBLIC, safe)) || serve(res, join(DIST, safe))) return;
  // A classic page address asked for with fetch is the classic page itself (what the middleware does); a page load is the app.
  if (req.headers['sec-fetch-dest'] === 'empty' || req.headers['x-hub-request']) {
    const dir = join(DIST, safe);
    if (serve(res, join(dir, 'index.html')) || serve(res, dir + '.html')) return;
  }
  serve(res, join(DIST, '_app', 'index.html')) || (res.writeHead(404), res.end());
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
export const BASE = `http://127.0.0.1:${server.address().port}`;
export const stop = () => server.close();
export { COOKIE, OUT };
