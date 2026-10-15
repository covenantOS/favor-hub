// What keeps the network busy after a page is up. For each route: when the first content shows, the long tasks (main thread blocked
// 50 ms or more), when the last request settles, and every request still open or started after 3 s.
// Usage: node app/e2e/perf.mjs [route ...]   (default / and /work/)
import { chromium } from 'playwright';
import { BASE, stop } from './serve.mjs';

const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/work/'];
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
for (const route of routes) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addCookies([{ name: 'hub_tester', value: '1', url: BASE }]);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const reqs = new Map();
  page.on('request', (r) => reqs.set(r, { url: r.url().replace(BASE, ''), start: Date.now() - t0, end: null }));
  const done = (r) => { const x = reqs.get(r); if (x && x.end == null) x.end = Date.now() - t0; };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  await page.addInitScript(() => {
    window.__lt = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); } catch (_) { /* unsupported */ }
  });
  await page.goto(BASE + route, { waitUntil: 'commit' });
  let content = -1;
  try {
    await page.waitForSelector('#h-content .td-row, #h-content .td-clear, #h-content .app-legacy > *', { state: 'attached', timeout: 30000 });
    content = Date.now() - t0;
  } catch (_) { /* never showed */ }
  await page.waitForTimeout(12000);
  const list = [...reqs.values()];
  const settled = Math.max(0, ...list.filter((x) => x.end != null && x.start < 15000).map((x) => x.end));
  const lt = await page.evaluate(() => window.__lt || []);
  const tbt = lt.reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
  console.log(`\n${route}: first content ${content} ms, long tasks ${lt.length} (blocking ${tbt} ms), last request settled at ${settled} ms, ${list.length} requests`);
  list.filter((x) => x.start > 2000 || (x.end ?? 99999) - x.start > 700 || x.url.indexOf('/api/') === 0).sort((a, b) => a.start - b.start).slice(0, 60).forEach((x) => console.log(`   ${x.start}-${x.end ?? 'open'} ms  ${x.url.slice(0, 110)}`));
  await ctx.close();
  // Interactive: on a fresh load, a press on the menu is answered while the page is still loading.
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await c2.addCookies([{ name: 'hub_tester', value: '1', url: BASE }]);
  const p2 = await c2.newPage();
  await p2.goto(BASE + route, { waitUntil: 'commit' });
  await p2.waitForSelector('.h-side a[href="/chat/"]', { state: 'attached', timeout: 30000 });
  const ti = Date.now();
  await p2.locator('.h-side a[href="/chat/"]').first().evaluate((a) => a.click());
  await p2.waitForFunction(() => location.pathname === '/chat/', null, { timeout: 15000 }).catch(() => undefined);
  console.log(`   press on the menu while loading: answered in ${Date.now() - ti} ms`);
  await c2.close();
}
await browser.close();
stop();
