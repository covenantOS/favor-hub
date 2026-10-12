// Live page checks as the FavorOS Tester (no Google account): the page draws the built-in sample mailbox, so undo send, Send anyway, assign
// and a partner thread run on the real deployed page without touching anyone's mail. Needs FAVOR_AGENT_KEY in the environment.
import { chromium } from 'playwright';
const BASE = 'https://dash.favorintl.org';
const OUT = process.env.OUT || 'Q:/Temp/Will/mail-smart/shots';
const key = process.env.FAVOR_AGENT_KEY;
const sess = await (await fetch(BASE + '/api/admin/test-session', { method: 'POST', headers: { Authorization: 'Bearer ' + key } })).json();
if (!sess.cookie) throw new Error('no test session: ' + JSON.stringify(sess).slice(0, 120));
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const phone = name === 'phone';
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone });
  await ctx.addCookies([
    { name: 'favor_hub_session', value: sess.cookie, domain: 'dash.favorintl.org', path: '/', httpOnly: true, secure: true },
    { name: 'hub_gc', value: '1', domain: 'dash.favorintl.org', path: '/', secure: true },
    { name: 'hub_tester', value: '1', domain: 'dash.favorintl.org', path: '/', secure: true },
  ]);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Blocked script|Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.goto(BASE + '/mail/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ml-row[data-id]', { timeout: 15000 });
  console.log(name, 'js', await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /mail\.js/.test(s))));
  // a partner thread
  await page.locator('.ml-row[data-id] .ml-row__a').first().click();
  await page.waitForSelector('.ml-msg__body', { timeout: 8000 });
  await page.waitForSelector('.ml-pcard', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/live-${name}-1-partner-thread.png` });
  // assign
  await page.locator('[data-act="thread-more"]:visible').first().click();
  await page.click('[data-more="assign"]');
  await page.waitForSelector('[data-hof]');
  await page.screenshot({ path: `${OUT}/live-${name}-2-assign.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // undo send
  await page.locator('[data-act="compose"]:visible').first().click();
  await page.waitForSelector('[data-ed]');
  await page.fill('#ml-c-to', 'maya.okafor@example.org'); await page.keyboard.press('Enter');
  await page.fill('#ml-c-subj', 'Dates');
  await page.click('[data-ed]'); await page.keyboard.type('Hi Maya, Friday works for me.');
  await page.click('[data-c="send"]');
  await page.waitForSelector('.ml-toast [data-undo]');
  await page.screenshot({ path: `${OUT}/live-${name}-3-undo-send.png` });
  await page.click('.ml-toast [data-undo]');
  await page.waitForSelector('[data-ed]');
  // Send anyway
  await page.click('[data-ed]'); await page.keyboard.press('Control+A'); await page.keyboard.type('Hi Maya, our donor letter is attached.');
  await page.click('[data-c="send"]');
  await page.waitForSelector('[data-fix]', { timeout: 6000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/live-${name}-4-send-anyway.png` });
  await page.click('[data-fix]');
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
