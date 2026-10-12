// Chat, two users. Tester and Tester Two talk on qa-scratch-tester (the test users see only each other).
// Runs against whichever Chat the app serves at CHAT_URL (default /chat/). Tester Two's page talks to the live host directly.
// Usage: node app/e2e/chat.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { BASE, stop } from './serve.mjs';

const OUT = 'Q:/Temp/Will/react-app/shots/chat';
mkdirSync(OUT, { recursive: true });
const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split(/\r?\n/)[0].trim();
const LIVE = 'https://dash.favorintl.org';
const H = { Authorization: 'Bearer ' + key };
await fetch(LIVE + '/api/admin/test-seed', { method: 'POST', headers: H }).catch(() => undefined);
const two = (await (await fetch(LIVE + '/api/admin/test-session?who=two', { method: 'POST', headers: H })).json()).cookie;
const one = (await (await fetch(LIVE + '/api/admin/test-session', { method: 'POST', headers: H })).json()).cookie;
const PATH = process.env.CHAT_URL || '/chat/';

const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const results = [];
const step = async (name, fn, shot) => {
  const t0 = Date.now();
  try {
    results.push([name, 'ok', Date.now() - t0, (await fn()) || '']);
  } catch (e) {
    results.push([name, 'FAIL', Date.now() - t0, e.message.split('\n').slice(0, 3).join(' ').slice(0, 260)]);
    if (shot) await shot.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }).catch(() => undefined);
  }
};
const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await ctx1.addCookies([
  { name: 'favor_hub_session', value: one, domain: 'dash.favorintl.org', path: '/', secure: true, httpOnly: true },
  { name: 'hub_gc', value: '1', domain: 'dash.favorintl.org', path: '/', secure: true },
]);
const p1 = await ctx1.newPage();
// Both users go to the live host: the local test server cannot carry the Chat websocket, and two people need the same socket room.
const HOST = process.env.CHAT_HOST || LIVE;
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await ctx2.addCookies([
  { name: 'favor_hub_session', value: two, domain: 'dash.favorintl.org', path: '/', secure: true, httpOnly: true },
  { name: 'hub_gc', value: '1', domain: 'dash.favorintl.org', path: '/', secure: true },
]);
const p2 = await ctx2.newPage();
const errs = [];
p1.on('pageerror', (e) => { if (!/ViewTransition/.test(e.message)) errs.push(e.message.slice(0, 80) + ' @ ' + String(e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' ').slice(0, 160)); }); // the classic frame's view-transition abort on quick taps is tracked separately

const boot = await fetch(LIVE + '/api/chat/boot', { headers: { Cookie: 'favor_hub_session=' + one, 'X-Hub-Request': '1' } }).then((x) => x.json()).catch(() => ({}));
const ch = (boot.channels || []).find((c) => /qa-scratch-tester/.test(c.name || ''));
const open = async (page, base) => {
  await page.goto(base + PATH + (ch ? '?c=' + encodeURIComponent(ch.id) : ''), { waitUntil: 'commit' });
  await page.waitForSelector('.ch-comp textarea', { timeout: 25000 });
};
await open(p1, HOST);
await open(p2, LIVE);
// Both pages wait for their websocket to be open before anything is sent, so a message is never sent into a room nobody is listening in.
await Promise.all([p1, p2].map((p) => p.waitForFunction(() => !document.querySelector('.ch-conn, [data-conn="off"]'), null, { timeout: 15000 }).catch(() => undefined)));
await p1.waitForTimeout(2500);
const say = async (page, text) => {
  const ta = page.locator('.ch-comp textarea:visible').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially(text, { delay: 3 });
  await page.keyboard.press('Enter');
};
const seen = (page, text, ms = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: ms, polling: 25 });
const tag = 'chat-e2e ' + (Date.now() % 100000);

await step('channel opens for both users', async () => {
  if (!ch) throw new Error('no qa-scratch-tester channel');
}, p1);
await step('send: Tester to Tester Two', async () => {
  const t0 = Date.now();
  await say(p1, tag + ' one');
  await seen(p1, tag + ' one');
  const own = Date.now() - t0;
  await seen(p2, tag + ' one');
  return `own screen ${own} ms, other screen ${Date.now() - t0} ms`;
}, p2);
await step('send: Tester Two to Tester', async () => {
  await say(p2, tag + ' two');
  await seen(p1, tag + ' two');
}, p1);
await step('typing is seen by the other', async () => {
  const ta = p2.locator('.ch-comp textarea:visible').first();
  await ta.click();
  await ta.pressSequentially('typing now typing now', { delay: 120 });
  await p1.waitForFunction(() => /typing/i.test(document.querySelector('.ch-typing, [data-typing]')?.textContent || ''), null, { timeout: 6000 });
  await ta.fill('');
}, p1);
await step('edit is seen', async () => {
  const msg = p1.locator('.ch-msg', { hasText: tag + ' one' }).last();
  await msg.hover();
  await msg.locator('[data-act="more"]').first().click();
  await p1.locator('.ch-pop [data-act="edit"]').first().click();
  await p1.keyboard.press('End');
  await p1.keyboard.type(' edited');
  await p1.keyboard.press('Enter');
  await seen(p2, tag + ' one edited');
}, p1);
await step('delete is seen', async () => {
  await say(p1, tag + ' gone');
  await seen(p2, tag + ' gone');
  const msg = p1.locator('.ch-msg', { hasText: tag + ' gone' }).last();
  await msg.hover();
  await msg.locator('[data-act="more"], [aria-label="More"]').first().click();
  await p1.locator('button', { hasText: /^Delete/ }).first().click();
  const ok = p1.locator('.ch-modal button, [role=dialog] button', { hasText: /^Delete$/ });
  if (await ok.count()) await ok.first().click();
  await p2.waitForFunction((t) => !document.body.innerText.includes(t), tag + ' gone', { timeout: 8000 });
}, p1);
await step('thread reply is seen', async () => {
  const msg = p2.locator('.ch-msg', { hasText: tag + ' two' }).last();
  await msg.hover();
  await msg.locator('[data-act="thread"], [aria-label*="eply"]').first().click();
  await p2.waitForSelector('[data-ta="thread"]', { timeout: 5000 });
  await p2.locator('[data-ta="thread"]').fill(tag + ' threaded');
  await p2.keyboard.press('Enter');
  await p1.waitForFunction(() => /1 repl/.test(document.body.innerText), null, { timeout: 8000 });
}, p2);
await step('French message arrives', async () => {
  await say(p2, 'Bonjour, pouvez-vous envoyer le rapport avant jeudi ? ' + tag);
  await seen(p1, 'Bonjour');
}, p1);
await step('20-visit leak check', async () => {
  const c = () => p1.evaluate(() => (window.__hubOwn ? window.__hubOwn.counts() : null));
  const base = await c();
  if (!base) return 'hub-own not present';
  for (let i = 0; i < 20; i++) {
    await p1.locator('.h-side a[href="/requests/"]').first().evaluate((a) => a.click());
    await p1.waitForTimeout(150);
    await p1.locator('.h-side a[href="/chat/"]').first().evaluate((a) => a.click());
    await p1.waitForSelector('.ch-comp textarea', { timeout: 8000 });
  }
  const end = await c();
  const grew = Object.keys(base).filter((k) => k !== 'to' && end[k] > base[k] + 1);
  if (grew.length) throw new Error('leak ' + grew.join(','));
  return JSON.stringify(end);
}, p1);
await step('phone layout has no horizontal overflow', async () => {
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p3 = await c3.newPage();
  await p3.goto(BASE + PATH, { waitUntil: 'commit' });
  await p3.waitForSelector('.ch', { timeout: 25000 });
  await p3.waitForTimeout(1500);
  await p3.screenshot({ path: `${OUT}/phone-list.png` });
  const w = await p3.evaluate(() => document.documentElement.scrollWidth);
  await c3.close();
  if (w > 392) throw new Error('horizontal overflow ' + w);
}, p1);
await step('no page errors', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
});

await browser.close();
stop();
let bad = 0;
for (const [n, r, ms, note] of results) {
  console.log(`${r === 'ok' ? 'ok  ' : 'FAIL'} ${n} (${ms} ms) ${note}`);
  if (r !== 'ok') bad++;
}
console.log(bad ? `${bad} FAILED of ${results.length}` : `ALL ${results.length} CHAT STEPS OK`);
process.exit(bad ? 1 : 0);
