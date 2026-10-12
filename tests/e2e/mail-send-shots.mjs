// Undo send and "Send anyway?" with invented mail (?mock=1). Not part of npm test.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:4399';
const OUT = process.env.OUT || 'Q:/Temp/Will/mail-smart/shots';
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const phone = name === 'phone';
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('favor.hub.nav.v1', JSON.stringify({ access: { workCenter: true, mail: true }, counts: {} })); localStorage.removeItem('favor.mail.countdown'); } catch (e) { /* none */ } });
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Optimize Dep|Blocked script/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto(BASE + '/mail/?mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]');
  const compose = async (html) => {
    await page.locator('[data-act="compose"]:visible').first().click();
    await page.waitForSelector('[data-ed]');
    await page.fill('#ml-c-to', 'maya.okafor@example.org'); await page.keyboard.press('Enter');
    await page.fill('#ml-c-subj', 'Dates');
    await page.click('[data-ed]'); await page.keyboard.type(html);
  };
  // 1. a clean message: held 15 s with Undo, Undo returns the text
  await compose('Hi Maya, Friday works for me.');
  await page.click('[data-c="send"]');
  await page.waitForSelector('.ml-toast [data-undo]');
  await page.screenshot({ path: `${OUT}/send-${name}-1-undo-bar.png` });
  await page.click('.ml-toast [data-undo]');
  await page.waitForSelector('[data-ed]');
  console.log(name, 'text after undo:', (await page.innerText('[data-ed]')).slice(0, 40));
  // 2. findings: Send anyway? counts down and sends by itself
  await page.click('[data-ed]'); await page.keyboard.press('Control+A'); await page.keyboard.type('Hi Maia, our donor letter is attached.');
  await page.click('[data-c="send"]');
  await page.waitForSelector('[data-fix]', { timeout: 4000 }).catch(async () => { await page.screenshot({ path: OUT + '/dbg.png' }); throw new Error('no sheet'); });
  await page.screenshot({ path: `${OUT}/send-${name}-2-send-anyway.png` });
  await page.waitForSelector('.ml-toast [data-undo]', { timeout: 8000 });
  console.log(name, 'sent by itself after the count');
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
