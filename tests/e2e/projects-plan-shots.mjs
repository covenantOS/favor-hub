// Screenshots of the planner, team workload and Friday update on a local build (python -m http.server in dist) with the
// API answered from Q:/Temp/Will/projects-ai/canned.json (written by tests/projects-plan-canned.mjs). Writes to Q:/Temp/Will/projects-ai/shots.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const canned = JSON.parse(readFileSync('Q:/Temp/Will/projects-ai/canned.json', 'utf8'));
const out = 'Q:/Temp/Will/projects-ai/shots';
const base = 'http://localhost:4417';
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
for (const [name, vp, mobile] of [['desk', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ' pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ' console ' + m.text()); });
  const j = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  await page.route('**/api/projects/plan/draft', (r) => r.fulfill(j(canned.draft)));
  await page.route('**/api/projects/plan/check', (r) => r.fulfill(j({ ok: true, warnings: canned.draft.warnings })));
  await page.route('**/api/projects/workload*', (r) => r.fulfill(j(canned.workload)));
  await page.route('**/api/projects/*/status/draft', (r) => r.fulfill(j(canned.statusDraft)));
  await page.route('**/api/projects/*/status', (r) => r.fulfill(j(canned.statusOff)));
  await page.route(/\/api\/(?!projects)/, (r) => r.fulfill(j({ ok: true })));
  await page.goto(base + '/projects/?mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-h="plan"]');
  await page.screenshot({ path: `${out}/${name}-home.png` });
  await page.click('[data-h="plan"]');
  await page.waitForSelector('#pl-prompt');
  await page.fill('#pl-prompt', 'Banquet in Houston on December 6 for about 80 partners');
  await page.screenshot({ path: `${out}/${name}-ask.png` });
  await page.click('[data-go]');
  await page.waitForSelector('[data-plan]');
  await page.screenshot({ path: `${out}/${name}-plan.png` });
  await page.evaluate(() => { const b = document.querySelector('.pj-sheet__body'); b.scrollTop = b.scrollHeight; });
  await page.screenshot({ path: `${out}/${name}-plan-bottom.png` });
  await page.keyboard.press('Escape');
  await page.click('#pj-tab-team');
  await page.waitForSelector('.pj-tl__cell');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-team.png` });
  await page.click('.wl-btn.lv-over');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${name}-team-pop.png` });
  await page.goto(base + '/projects/p/?p=MKT&mock=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-pa="status"]', { state: 'attached' }).catch(() => null);
  const st = await page.$('[data-pa="status"]');
  if (st) {
    await st.click();
    await page.waitForSelector('.pj-st');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-status.png` });
  } else errors.push(name + ' no status button (mock project missing)');
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no errors');
