// Screenshots of Mail with invented mail (?mock=1) on desktop (1440 and 1280) and phone. Not part of npm test.
// usage: BASE=http://localhost:4399 OUT=Q:/Temp/Will/mail-smart/shots node tests/e2e/mail-smart-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4399';
const OUT = process.env.OUT || 'Q:/Temp/Will/mail-smart/shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
const sizes = [['desktop', { width: 1440, height: 900 }], ['desk1280', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]];
for (const [name, vp] of sizes) {
  const phone = name === 'phone';
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('favor.hub.nav.v1', JSON.stringify({ access: { workCenter: true, mail: true }, counts: {} })); } catch (e) { /* none */ } });
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Optimize Dep/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto(BASE + '/mail/?mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}-1-inbox.png` });
  const view = phone ? '.ml-tab[href="#/needs"]' : '.ml-lab--sub[href="#/needs"]';
  await page.click(view);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}-2-needs.png` });
  await page.goto(BASE + '/mail/?mock=1#/INBOX', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]');
  await page.click('[data-filterbtn]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-3-filter-menu.png` });
  await page.check('[data-fl="unread"]');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-4-filtered.png` });
  await page.click('[data-act="sort-menu"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-5-sort-menu.png` });
  await page.click('[data-sort="old"]');
  await page.waitForTimeout(500);
  await page.click('[data-act="flags-clear"]');
  await page.waitForTimeout(500);
  const avs = await page.$$('.ml-row[data-id] .ml-av');
  await avs[0].click();
  await avs[3].click({ modifiers: ['Shift'] });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-6-selected.png` });
  console.log(name, 'picked rows', await page.$$eval('.ml-row.is-picked', (r) => r.length));
  await page.click('[data-act="pick-clear"]');
  if (!phone) {
    await page.click('.ml-lab--sub[href="#/partners"]');
    await page.waitForSelector('.ml-row[data-id]');
    await page.click('.ml-row[data-id] .ml-row__a');
    await page.waitForSelector('.ml-pcard', { timeout: 5000 });
    await page.waitForSelector('.ml-sugg__b', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}-7-thread.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
