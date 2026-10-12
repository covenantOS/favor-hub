// Screenshots of Mail round 2 with invented mail (?mock=1): the briefing, the sender profile and partner card with timeline, the gift and
// promise cards, hover cards in a message, categories in words, find a time, and the writing check. Not part of npm test.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4399';
const OUT = process.env.OUT || 'Q:/Temp/Will/mail-smart/shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const phone = name === 'phone';
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('favor.hub.nav.v1', JSON.stringify({ access: { workCenter: true, mail: true }, counts: {} })); sessionStorage.clear(); } catch (e) { /* none */ } });
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Optimize Dep|Blocked script execution/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto(BASE + '/mail/?mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]');
  await page.waitForSelector('.ml-brief', { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/know-${name}-1-briefing.png` });
  await page.click('.ml-brief__i');
  await page.waitForSelector('.ml-pcard', { timeout: 6000 });
  await page.waitForSelector('.ml-sugg__b', { timeout: 6000 });
  await page.waitForTimeout(500);
  await page.click('[data-act="timeline"]');
  await page.waitForSelector('.ml-tl__i');
  await page.screenshot({ path: `${OUT}/know-${name}-2-partner.png` });
  // hover card in the message body
  const frame = await page.waitForSelector('.ml-msg.is-open iframe');
  const cf = await frame.contentFrame();
  await cf.waitForSelector('.fos-ent', { timeout: 6000 });
  if (!phone) {
    await cf.hover('.fos-ent[data-k="appeal"]');
    await page.waitForSelector('.ml-ent:not([hidden])', { timeout: 3000 });
    await page.screenshot({ path: `${OUT}/know-${name}-3-hover.png` });
  }
  // ask and find a time
  await page.fill('[data-ask]', 'What does Maya want?');
  await page.click('[data-act="ask-go"]');
  await page.waitForSelector('.ml-answer:not(:has-text("Reading"))', { timeout: 4000 });
  await page.click('[data-act="find-time"]');
  await page.waitForSelector('[data-slot]', { timeout: 4000 });
  await page.screenshot({ path: `${OUT}/know-${name}-4-find-time.png` });
  await page.keyboard.press('Escape');
  // categories in words
  if (!phone) {
    await page.click('[data-act="cats"]');
    await page.waitForSelector('[data-catf]');
    await page.fill('[data-catf] [name="name"]', 'Trips');
    await page.fill('[data-catf] [name="description"]', 'Anything about a mission trip, a visit or travel plans');
    await page.screenshot({ path: `${OUT}/know-${name}-5-category.png` });
    await page.click('[data-catf] button[type="submit"]');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
  }
  // the writing check
  await page.locator('[data-act="compose"]:visible').first().click();
  await page.waitForSelector('[data-ed]');
  await page.fill('#ml-c-to', 'maya.okafor@example.org');
  await page.keyboard.press('Enter');
  await page.fill('#ml-c-subj', 'Dates');
  await page.click('[data-ed]');
  await page.keyboard.type('Hi Maya, our donor letter is attached.');
  await page.click('[data-c="send"]');
  await page.waitForSelector('.ml-warn', { timeout: 4000 });
  await page.screenshot({ path: `${OUT}/know-${name}-6-check.png` });
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
