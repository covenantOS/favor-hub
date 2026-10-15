import { chromium, devices } from 'playwright';
import { MIGRATED_ROUTES, FULL_LOAD } from '../../shared/app2.ts';
import { BASE, OUT, stop } from './serve.mjs';

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
  await page.waitForSelector('.td-row, .td-clear', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (document.getElementById('h-app').dataset.mark = 'kept'));
  const steps = process.env.STEPS ? process.env.STEPS.split(',').map((h) => [h, h]) : [['/chat/', 'Chat'], ['/requests/', 'Requests'], ['/', 'Today'], ['/chat/', 'Chat'], ['/requests/', 'Requests'], ['/', 'Today']];
  const rows = [];
  for (const [href, name] of steps) {
    const t0 = Date.now();
    await page.locator(`.h-side a[href="${href}"]`).first().evaluate((a) => a.click());
    await page.waitForFunction((h) => location.pathname === h, href, { timeout: 10000 });
    await page.waitForFunction(() => { const m = document.querySelector('#h-content'); return m && m.children.length && !m.querySelector('.app-legacy[aria-busy="true"]') && (m.querySelector('.td-row, .td-clear') || m.querySelector('.app-legacy > *')); }, null, { timeout: 15000 });
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

// The main action of three classic pages, run once inside the frame. Chat sends to the tester's own scratch channel, Brain answers from a stub,
// Work Center completes a task and undoes it when the sample data has one.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addCookies([{ name: 'hub_tester', value: '1', url: BASE }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  const report = (name, ok, note = '') => { console.log(`action ${name}: ${ok ? 'ok' : 'FAIL'} ${note}`); if (!ok) bad++; };
  try {
    await page.goto(BASE + '/chat/', { waitUntil: 'domcontentloaded' });
    const ta = page.locator('.ch-comp textarea:visible').first();
    await ta.waitFor({ timeout: 20000 });
    const text = 'islands test ' + Date.now();
    await ta.click();
    await ta.pressSequentially(text, { delay: 5 });
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 8000 });
    report('chat send', true, `${Date.now() - t0} ms to the message on screen`);
  } catch (e) { report('chat send', false, e.message.split('\n')[0]); }
  try {
    // fetch with keepalive (what Brain uses) is not always seen by page.route, so the stub sits in the page itself.
    await page.addInitScript(() => { const f = window.fetch; window.fetch = (u, o) => (String(u).indexOf('/api/brain/ask') >= 0 ? Promise.resolve(new Response(JSON.stringify({ ok: true, outcome: 'ok', ref: 'stub', title: 'Stub', blocks: [{ type: 'text', md: 'Stubbed answer for the islands test.' }] }), { headers: { 'content-type': 'application/json' } })) : f(u, o)); });
    await page.goto(BASE + '/brain/', { waitUntil: 'domcontentloaded' });
    await page.locator('.bc-starter').first().waitFor({ timeout: 20000 });
    // The box is redrawn once while the page finishes starting, so type until the text stays.
    for (let k = 0; k < 4 && !(await page.locator('#bc-input').inputValue()); k++) { await page.locator('#bc-input').click(); await page.locator('#bc-input').pressSequentially('How many partners gave this month?', { delay: 5 }); await page.waitForTimeout(400); }
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    const seen = () => page.waitForFunction(() => document.body.innerText.includes('Stubbed answer'), null, { timeout: 2500 }).then(() => true, () => false);
    for (let k = 0; k < 4 && !(await seen()); k++) { if (!(await page.locator('#bc-input').inputValue())) await page.locator('#bc-input').pressSequentially('How many partners gave this month?', { delay: 5 }); await page.locator('#bc-send').click({ force: true }); }
    await page.waitForFunction(() => document.body.innerText.includes('Stubbed answer'), null, { timeout: 4000 });
    report('brain ask', true, `${Date.now() - t0} ms to the answer`);
  } catch (e) { await page.screenshot({ path: OUT + '/fail-brain.png' }).catch(() => {}); report('brain ask', false, e.message.split('\n')[0]); }
  try {
    await page.goto(BASE + '/work/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#h-content .app-legacy > *', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(3000);
    const done = page.locator('#h-content button:visible', { hasText: /^(Done|Mark done|Complete)$/ }).first();
    if (!(await done.count())) report('work center complete/undo', true, 'SKIPPED: no task with a Done button in the sample data');
    else {
      await done.click();
      const undo = page.locator('button:visible', { hasText: /^Undo$/ }).first();
      await undo.waitFor({ timeout: 5000 });
      await undo.click();
      report('work center complete/undo', true);
    }
  } catch (e) { report('work center complete/undo', false, e.message.split('\n')[0]); }
  if (errs.length) report('page errors during actions', false, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
stop();
console.log(bad ? `${bad} problems` : 'ALL ISLANDS OK');
void FULL_LOAD;
