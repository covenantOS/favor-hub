import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const label = process.argv[2];
const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split('\n')[0].trim();
const r = await fetch('https://dash.favorintl.org/api/admin/test-session', { method: 'POST', headers: { Authorization: 'Bearer ' + key } });
const tok = (await r.json()).cookie;
const b = await chromium.launch({ channel: 'msedge' });
for (const [n, vp, ph] of [['390', { width: 390, height: 844 }, true], ['1440', { width: 1440, height: 900 }, false]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: ph ? 2 : 1, hasTouch: ph });
  await ctx.addCookies(['favor_hub_session=' + tok].map((c) => ({ name: 'favor_hub_session', value: tok, domain: 'dash.favorintl.org', path: '/', httpOnly: true, secure: true })).concat([{ name: 'hub_gc', value: '1', domain: 'dash.favorintl.org', path: '/' }, { name: 'hub_tester', value: '1', domain: 'dash.favorintl.org', path: '/' }]));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('https://dash.favorintl.org/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `Q:/Temp/Will/today-briefing/shots/${label}-${n}.png`, fullPage: false });
  console.log(n, errs, await page.locator('#br-root').innerText().then((t) => t.slice(0, 200)).catch(() => 'none'));
  await ctx.close();
}
await b.close();
