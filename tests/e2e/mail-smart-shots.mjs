// Screenshots of Mail with invented mail (?mock=1) on desktop and phone. Not part of npm test.
// usage: BASE=http://localhost:4399 OUT=Q:/Temp/Will/mail-smart/shots node tests/e2e/mail-smart-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4399';
const OUT = process.env.OUT || 'Q:/Temp/Will/mail-smart/shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'phone' ? 2 : 1, hasTouch: name === 'phone' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('favor.hub.nav.v1', JSON.stringify({ access: { workCenter: true, mail: true }, counts: {} })); } catch (e) { /* none */ } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto(BASE + '/mail/?mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-1-inbox.png` });
  // needs you
  await page.click('.ml-tab[href="#/needs"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}-2-needs.png` });
  await page.click('.ml-tab[href="#/INBOX"]');
  await page.waitForSelector('.ml-row[data-id]');
  // filters
  await page.click('[data-flag="unread"]');
  await page.waitForTimeout(500);
  await page.click('[data-act="sort"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}-3-unread-oldest.png` });
  await page.click('[data-flag="unread"]');
  await page.waitForTimeout(400);
  // select several: avatar press, shift range
  const avs = await page.$$('.ml-row[data-id] .ml-av');
  await avs[0].click();
  await avs[3].click({ modifiers: ['Shift'] });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-4-selected.png` });
  const n = await page.$$eval('.ml-row.is-picked', (r) => r.length);
  console.log(name, 'picked rows', n);
  await page.click('[data-sel="move"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-5-move.png` });
  await page.keyboard.press('Escape');
  await page.click('[data-act="pick-clear"]').catch(() => {});
  // open a partner thread
  await page.click('.ml-tab[href="#/partners"]');
  await page.waitForSelector('.ml-row[data-id]');
  await page.click('.ml-row[data-id] .ml-row__a');
  await page.waitForSelector('.ml-pcard', { timeout: 5000 });
  await page.waitForSelector('.ml-sugg__b', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-6-thread.png` });
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
