// Screenshots of the mailbox switcher, the colored markers and the From picker with invented mail (?mock=1).
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
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Optimize Dep/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto(BASE + '/mail/?mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/boxes-${name}-1-all.png` });
  if (name === 'desktop') {
    await page.click('[data-box="accounting@favorintl.org"]');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/boxes-${name}-2-accounting.png` });
    await page.click('[data-act="box-manage"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/boxes-${name}-3-manage.png` });
    await page.keyboard.press('Escape');
    await page.click('.ml-compose');
    await page.waitForSelector('[data-from]');
    await page.screenshot({ path: `${OUT}/boxes-${name}-4-compose-from.png` });
    console.log('from value', await page.$eval('[data-from]', (e) => e.value));
  } else {
    await page.click('[data-act="labels-sheet"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/boxes-${name}-2-sheet.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
