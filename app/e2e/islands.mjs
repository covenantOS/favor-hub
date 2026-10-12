// Every classic page that runs inside the app's frame, loaded against the live API as the FavorOS Tester (reads only: the tester's writes
// answer 403). A local server serves the built app and the static files and forwards /api to dash.favorintl.org.
// Usage:  node app/e2e/islands.mjs [route ...]      Screenshots go to Q:\Temp\Will\react-app\shots\islands.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { MIGRATED_ROUTES, FULL_LOAD } from '../../shared/app2.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const LIVE = 'https://dash.favorintl.org';
const OUT = process.env.SHOTS || 'Q:/Temp/Will/react-app/shots/islands';
mkdirSync(OUT, { recursive: true });

const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split(/\r?\n/)[0].trim();
const sess = await (await fetch(LIVE + '/api/admin/test-session', { method: 'POST', headers: { Authorization: 'Bearer ' + key } })).json();
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
const BASE = `http://127.0.0.1:${server.address().port}`;

const routes = process.argv.slice(2).length ? process.argv.slice(2) : MIGRATED_ROUTES.filter((r) => r !== '/');
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const NOISE = /(?!)|WebSocket|favicon|net::ERR_ABORTED|Failed to load resource.*(40[34])/;
let bad = 0;
for (const route of routes) {
  for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['iphone', { ...devices['iPhone 14'] }]]) {
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
    await ctx.addCookies([{ name: 'hub_tester', value: '1', url: BASE }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if ((m.type() === 'error' && !NOISE.test(m.text())) || m.text().includes('[legacy]')) errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 100) + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' ').slice(0, 200)));
    const t0 = Date.now();
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    let verdict = 'ok';
    try {
      await page.waitForSelector('#h-content .app-legacy > *', { state: 'attached', timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('#h-content [aria-busy="true"]') && !document.querySelector('#h-content [class*="skel"]'), null, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const info = await page.evaluate(() => ({ nav: document.body.dataset.nav, text: document.getElementById('h-content').innerText.trim().length, alert: !!document.querySelector('#h-content > [role=alert]'), url: location.pathname }));
      if (info.alert) verdict = 'FAILED to load';
      else if (info.text < 20) verdict = 'EMPTY';
      if (!info.nav) verdict += ' (no nav id)';
      if (errs.length) verdict += ` console errors: ${errs.slice(0, 3).join(' | ')}`;
      await page.screenshot({ path: `${OUT}/${route.replace(/\W+/g, '_')}-${label}.png`, fullPage: false });
    } catch (e) {
      await page.screenshot({ path: `${OUT}/fail-${label}.png` }).catch(() => {});
      verdict = 'FAIL [' + errs.slice(0, 3).join(' | ') + '] ' + e.message.split('\n')[0] + (page.url().includes('classic=1') ? ' (fell back to classic)' : '');
    }
    if (verdict !== 'ok') bad++;
    console.log(`${route} ${label} ${Date.now() - t0} ms: ${verdict}`);
    await ctx.close();
  }
}

// Moving between routes inside the frame: the shell stays mounted and the second visit to a page is warm.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addCookies([{ name: 'hub_tester', value: '1', url: BASE }]);
  const page = await ctx.newPage();
  await page.route('**/api/hub/app2', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, eligible: true, optedIn: true, routes: MIGRATED_ROUTES.map((x) => x), audience: 'admin' }) }));
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text().slice(0, 120)); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.r2t-tile, .r2t-clear', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (document.getElementById('h-app').dataset.mark = 'kept'));
  const steps = process.env.STEPS ? process.env.STEPS.split(',').map((h) => [h, h]) : [['/chat/', 'Chat'], ['/requests/', 'Requests'], ['/', 'Today'], ['/chat/', 'Chat'], ['/requests/', 'Requests'], ['/', 'Today']];
  const rows = [];
  for (const [href, name] of steps) {
    const t0 = Date.now();
    await page.locator(`.h-side a[href="${href}"]`).first().evaluate((a) => a.click());
    await page.waitForFunction((h) => location.pathname === h, href, { timeout: 10000 });
    await page.waitForFunction(() => { const m = document.querySelector('#h-content'); return m && m.children.length && !m.querySelector('.app-legacy[aria-busy="true"]') && (m.querySelector('.r2t-tile, .r2t-clear') || m.querySelector('.app-legacy > *')); }, null, { timeout: 15000 });
    rows.push(`${name} ${Date.now() - t0} ms`);
  }
  const mark = await page.evaluate(() => document.getElementById('h-app').dataset.mark);
  console.log('route changes (first, then repeat):', rows.join(', '));
  console.log(mark === 'kept' && !errs.length ? 'shell kept across routes' : 'SHELL RELOADED or errors: ' + errs.join(' | '));
  if (mark !== 'kept' || errs.length) bad++;
  // Leak check: leave a page 20 times and the listeners, timers, observers and sockets it made return to where they were after the first visit.
  for (const pair of [['/chat/', '/requests/'], ['/mail/', '/requests/']]) {
    const go = async (href) => {
      await page.locator(`.h-side a[href="${href}"]`).first().evaluate((a) => a.click());
      await page.waitForFunction((h) => location.pathname === h, href, { timeout: 10000 });
      await page.waitForFunction(() => !document.querySelector('.app-legacy[aria-busy="true"]'), null, { timeout: 15000 });
      await page.waitForTimeout(250);
    };
    await go(pair[0]); await go(pair[1]);
    const base = await page.evaluate(() => window.__hubOwn.counts());
    for (let i = 0; i < 20; i++) { await go(pair[0]); await go(pair[1]); }
    const end = await page.evaluate(() => window.__hubOwn.counts());
    const grew = Object.keys(base).filter((k) => end[k] > base[k] + 1);
    console.log(`leak check ${pair[0]} x20: base ${JSON.stringify(base)} end ${JSON.stringify(end)} ${grew.length ? 'LEAK ' + grew.join(',') : 'ok'}`);
    if (grew.length) bad++;
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log(bad ? `${bad} problems` : 'ALL ISLANDS OK');
void FULL_LOAD;
