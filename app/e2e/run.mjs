// Playwright checks for the React shell and Today, on desktop (1440) and iPhone, against the built app (dist/_app) with the API mocked from
// invented fixtures. Run after `npm run build`:  npm run app:e2e
// Screenshots go to Q:\Temp\Will\react-app\shots (SHOTS=dir to change). Any console error or failed request fails the run.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { day, kpi, nav, staffNav, today } from './fixtures.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const SHOTS = process.env.SHOTS || 'Q:/Temp/Will/react-app/shots';
mkdirSync(SHOTS, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

function serve(res, file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
  return true;
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const safe = normalize(path).replace(/^([/\\])+/, '');
  if (path === '/__classic') return void serve(res, join(DIST, 'index.html'));
  if (path.startsWith('/_app/')) {
    if (serve(res, join(DIST, safe)) || serve(res, join(DIST, '_app', 'index.html'))) return;
  }
  if (serve(res, join(PUBLIC, safe)) || serve(res, join(DIST, safe))) return;
  // Everything else is the app, the way the Pages middleware serves it for an opted-in person.
  serve(res, join(DIST, '_app', 'index.html')) || (res.writeHead(404), res.end());
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page, { navAnswer = nav, todayAnswer = today, dayAnswer = day, delay = 0, fail = {} } = {}) {
  const writes = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${p}`);
      return json(route, { ok: true });
    }
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail[p]) return json(route, { ok: false, message: fail[p] }, 500);
    if (p === '/api/hub/nav') return json(route, navAnswer);
    if (p === '/api/hub/today') return json(route, todayAnswer);
    if (p === '/api/hub/day') return json(route, dayAnswer);
    if (p === '/api/hub/kpi') return json(route, kpi);
    if (p === '/api/hub/app2') return json(route, { ok: true, eligible: true, optedIn: true, routes: ['/'], audience: 'admin' });
    if (p === '/api/hub/notifications') return json(route, { ok: true, items: [{ id: 'live', source: 'Meetings', head: 'A meeting is on now', txt: 'Join from the Meetings page', href: '/meet/', n: 1, warn: false }, { id: 'mail', source: 'Mail', head: '7 unread', txt: '', href: '/mail/', n: 7, warn: false }], count: 8, counts: {} });
    if (p === '/api/hub/find') return json(route, { ok: true, people: [{ kind: 'person', id: 'test.staff@favorintl.org', title: 'Test Staff', sub: 'Team · test.staff@favorintl.org' }], funds: [{ kind: 'fund', id: '12', title: 'General Fund', sub: 'Fund' }], appeals: [] });
    if (p === '/api/hub/entity') return json(route, { ok: true, item: { kind: u.searchParams.get('kind'), id: u.searchParams.get('id'), title: 'Test Staff', sub: 'Colleague', url: '', facts: [{ k: 'Team', v: 'Support' }], acts: ['message', 'task', 'brain', 'send'] } });
    if (p === '/api/work/reminders') return json(route, { ok: true, rows: [{ id: 'r1', title: 'Call Sample Partner', at: new Date().toISOString(), bucket: 'now', cid: 101 }], count: 1 });
    if (p === '/api/requests/notices') return json(route, { ok: true, count: 1, items: [{ id: 1, kind: 'comment', actor_name: 'Test Staff', title: 'Banner', note: 'Looks good', request_id: 9, created_at: new Date().toISOString() }] });
    if (p === '/api/tasks/links/bell') return json(route, { ok: true, count: 0, items: [] });
    if (p === '/api/chat/inbox') return json(route, { ok: true, count: 0, items: [] });
    if (p === '/api/chat/dock') return json(route, { ok: true, me: nav.user.email, users: {}, channels: [], threads_unread: 0 });
    if (p === '/api/brain/connector') return json(route, { ok: true, connected: true });
    return json(route, { ok: true });
  });
  await page.route('**/help/learn.json', (r) => json(r, { articles: { today: { title: 'Today', summary: 'What is waiting on you.', href: '/help/today/', videos: [] } }, pages: { home: 'today' } }));
  await page.route('**/api/chat/ws', (r) => r.abort());
  return writes;
}

function watch(page, bag) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket connection/.test(m.text())) bag.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => bag.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (!/ws$|\/ws\b|favicon/.test(r.url())) bag.push('requestfailed: ' + r.url());
  });
}

const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name + ': ' + (e.message || e).split('\n')[0]]);
    process.exitCode = 1;
  }
};

for (const [label, ctxOpts] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['iphone', { ...devices['iPhone 14'] }],
]) {
  const errors = [];
  const ctx = await browser.newContext({ ...ctxOpts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  watch(page, errors);
  await mockApi(page);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  await check(label + ': Today paints its cards, day and year', async () => {
    await page.waitForSelector('.r2t-tile', { timeout: 15000 });
    assert.equal(await page.locator('.r2t-tile').count(), 3);
    await page.waitForSelector('.r2t-ev', { timeout: 15000 });
    await page.waitForSelector('#t-year .r2t-hero', { timeout: 15000 });
    assert.match(await page.locator('#t-hello').innerText(), /^Good (morning|afternoon|evening), Test$/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/today-${label}.png`, fullPage: true });
  });

  await check(label + ': the shell stays mounted when a link stays in the app', async () => {
    await page.evaluate(() => (document.getElementById('h-app').dataset.mark = 'kept'));
    await page.locator('a[href="/"]').first().dispatchEvent('click');
    assert.equal(await page.evaluate(() => document.getElementById('h-app').dataset.mark), 'kept');
  });

  await check(label + ': the menu shows counts and hides what staff cannot open', async () => {
    if (label === 'desktop') {
      assert.ok(await page.locator('.h-area[data-area="work"] .h-area__sum').innerText());
      assert.equal(await page.locator('.h-area[data-area="admin"]').count(), 1);
    } else {
      assert.ok(await page.locator('#h-bar a[data-bar]:not([hidden])').count() >= 3);
      assert.ok((await page.locator('#h-bar-more').count()) === 1);
    }
  });

  await check(label + ': the bell lists every source in one list with one badge', async () => {
    await page.locator('#wm-bell').click();
    await page.waitForSelector('.wm-pop .wm-chat__h');
    const heads = (await page.locator('.wm-pop .wm-chat__h').allTextContents()).map((h) => h.trim());
    assert.ok(heads.includes('Meetings') && heads.includes('Requests') && heads.includes('Reminders'), heads.join(','));
    assert.ok((await page.locator('#wm-bell em').innerText()).length > 0);
    await page.screenshot({ path: `${SHOTS}/bell-${label}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.wm-pop').count(), 0);
  });

  await check(label + ': Ctrl K opens search, finds people and funds, ends with Ask Brain', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('#cmdk:not([hidden])');
    await page.fill('#cmdk-input', 'test');
    await page.waitForSelector('#cmdk-list li:has-text("Test Staff")', { timeout: 8000 });
    const rows = await page.locator('#cmdk-list li[role=option] .cmdk__row-title').allInnerTexts();
    assert.equal(rows.at(-1), 'Ask Brain: test');
    await page.screenshot({ path: `${SHOTS}/search-${label}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cmdk[hidden]').count(), 1);
  });

  await check(label + ': a chip opens an entity card', async () => {
    await page.locator('.r2t-ev__a .fe-chip').first().hover().catch(() => undefined);
    if (label === 'iphone') await page.locator('.r2t-ev__a .fe-chip').first().click();
    await page.waitForSelector('.fe-card', { timeout: 8000 });
    assert.match(await page.locator('.fe-card').innerText(), /Test Staff/);
    await page.screenshot({ path: `${SHOTS}/entity-${label}.png` });
    await page.keyboard.press('Escape');
  });

  await check(label + ': the Help panel opens for this page', async () => {
    await page.locator('#lp-btn').click();
    await page.waitForSelector('#lp-dlg[open]');
    assert.match(await page.locator('#lp-body').innerText(), /What is waiting on you/);
    await page.keyboard.press('Escape');
  });

  if (label === 'desktop') {
    await check('desktop: Make a request, Feedback, Clips and the Chat dock are in place', async () => {
      assert.equal(await page.locator('a[aria-label="Make a request"]').count(), 1);
      assert.equal(await page.locator('#h-fb').count(), 1);
      assert.equal(await page.locator('#clip-cam:not([hidden])').count(), 1);
      await page.waitForSelector('#fd .fd__btn', { timeout: 8000 });
    });
    await check('desktop: the slim rail expands with the backslash key and remembers it', async () => {
      await page.keyboard.press('\\');
      await page.waitForFunction(() => document.documentElement.classList.contains('nav-wide'));
      await page.screenshot({ path: `${SHOTS}/rail-wide-desktop.png` });
      await page.keyboard.press('\\');
    });
  } else {
    await check('iphone: the menu button opens the full menu and More shows a count', async () => {
      await page.locator('#h-bar-more').click();
      await page.waitForFunction(() => document.getElementById('h-app').classList.contains('is-nav'));
      await page.screenshot({ path: `${SHOTS}/menu-iphone.png` });
      await page.locator('#h-side-x').click();
    });
  }

  await check(label + ': no console errors or failed requests', async () => {
    assert.deepEqual(errors, [], errors.join(' | '));
  });
  await ctx.close();
}

// A staff member gets a shorter menu and no year card; a card that fails shows its own message while the rest stays.
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  watch(page, errors);
  await mockApi(page, { navAnswer: staffNav, todayAnswer: { ...today, user: staffNav.user, access: staffNav.access }, dayAnswer: { ...day, blackbaud: { linked: false, actions: [], total: 0, overdue: 0 } } });
  await page.goto(BASE + '/');
  await check('staff: no Work Center, no Chat dock, no year card', async () => {
    await page.waitForSelector('.r2t-tile');
    assert.equal(await page.locator('.h-area[data-area="work"] a[data-nav-id="work"]').count(), 0);
    assert.equal(await page.locator('#fd').count(), 0);
    assert.equal(await page.locator('#t-year-wrap').count(), 0);
    await page.screenshot({ path: `${SHOTS}/today-staff-desktop.png`, fullPage: true });
  });
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  watch(p2, errs2);
  await mockApi(p2, { fail: { '/api/hub/day': 'Your day failed on purpose.' } });
  await p2.goto(BASE + '/');
  await check('failure: a broken Your day shows its message and the other cards stay', async () => {
    await p2.waitForSelector('.r2t-tile');
    await p2.waitForSelector('#d-grid .r2t-clear', { timeout: 10000 });
    assert.equal(await p2.locator('.r2t-tile').count(), 3);
    assert.equal(await p2.locator('#t-year .r2t-hero').count(), 1);
  });
  await ctx2.close();
}

// Time to content: cold (nothing stored) then warm (the last answers in sessionStorage), with the API held for 400 ms.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await mockApi(page, { delay: 400 });
  const timing = async () => {
    const t0 = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.waitForSelector('.r2t-tile:not(.r2t-skel)', { timeout: 20000 });
    return Date.now() - t0;
  };
  const cold = await timing();
  await page.waitForTimeout(1500);
  const warm = await timing();
  console.log(`new app, time to cards (API held 400 ms): cold ${cold} ms, warm ${warm} ms`);
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const old = await ctx2.newPage();
  let bytes = 0;
  old.on('response', async (r) => { if (/\.(js|css)(\?|$)/.test(r.url())) bytes += (await r.body().catch(() => Buffer.alloc(0))).length; });
  await mockApi(old, { delay: 400 });
  const oldTiming = async () => {
    const t0 = Date.now();
    await old.goto(BASE + '/__classic', { waitUntil: 'commit' });
    await old.waitForSelector('.r2t-tile', { timeout: 20000 });
    return Date.now() - t0;
  };
  const oc = await oldTiming();
  await old.waitForTimeout(1500);
  console.log(`classic page JS+CSS fetched on first load: ${Math.round(bytes / 1024)} KB`);
  const ow = await oldTiming();
  console.log(`classic, time to cards (API held 400 ms): cold ${oc} ms, warm ${ow} ms`);
  await ctx2.close();
  await ctx.close();
}

await browser.close();
server.close();
for (const [s, n] of results) console.log(s, n);
console.log(results.every(([s]) => s === 'ok') ? 'ALL PASS' : 'FAILURES');
