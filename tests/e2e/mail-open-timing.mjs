// Client-side time to open a conversation, from the press on a row to the message body on screen, with invented mail (?mock=1).
// The mock answers a thread read in about 180 ms, as a stand-in for the network. Cases: not read ahead (first open), read ahead in this tab,
// and opened from the copy on this device after a reload. Not part of npm test.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:4399';
const browser = await chromium.launch({ channel: 'msedge' });
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('favor.hub.nav.v1', JSON.stringify({ access: { workCenter: true, mail: true }, counts: {} })); } catch (e) { /* none */ } });
const open = async (i) => page.evaluate(async (i) => {
  const rows = document.querySelectorAll('.ml-row[data-id] .ml-row__a');
  const a = rows[i];
  if (!a) return -1;
  const t0 = performance.now();
  a.click();
  await new Promise((ok) => {
    const done = () => document.querySelector('.ml-thread .ml-msg__body, .ml-thread .ml-frame');
    if (done()) return ok();
    const mo = new MutationObserver(() => { if (done()) { mo.disconnect(); ok(); } });
    mo.observe(document.querySelector('[data-read]'), { childList: true, subtree: true });
  });
  const ms = performance.now() - t0;
  document.querySelector('[data-act="back"]')?.click();
  location.hash = '#/INBOX';
  return ms;
}, i);
const load = async () => { await page.goto(BASE + '/mail/?mock=1', { waitUntil: 'networkidle' }); await page.waitForSelector('.ml-row[data-id]'); };
const report = (name, a) => console.log(name.padEnd(46), 'n=' + a.length, 'p50', String(pct(a, 0.5)).padStart(4), 'ms  p95', String(pct(a, 0.95)).padStart(4), 'ms');

// 1. first open, nothing read ahead: click rows at once, beyond the first five, before the idle read-ahead can reach them
await load();
await page.evaluate(() => indexedDB.deleteDatabase('favor-mail'));
await load();
const cold = [];
for (let i = 10; i < 20; i++) cold.push(await open(i));
report('not read ahead (network answers, ~180 ms)', cold);
// 2. read ahead in this tab
await load();
await page.waitForTimeout(6000);
const warm = [];
for (let i = 0; i < 20; i++) warm.push(await open(i));
report('read ahead (first 20 rows, idle time)', warm);
// 3. from the device copy after a reload, clicked before the page reads ahead again
const dev = [];
for (let i = 0; i < 10; i++) { await load(); dev.push(await open(i)); }
report('from this device after a reload', dev);
await browser.close();
