// How long a message, an edit and a typing signal take to reach the second user, over N tries (default 30), plus whether the socket stays up.
// Usage: node app/e2e/chat-latency.mjs [tries]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const N = Number(process.argv[2] || 30);
const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split(/\r?\n/)[0].trim();
const LIVE = 'https://dash.favorintl.org';
const H = { Authorization: 'Bearer ' + key };
const tok = async (q) => (await (await fetch(LIVE + '/api/admin/test-session' + q, { method: 'POST', headers: H })).json()).cookie;
const [one, two] = [await tok(''), await tok('?who=two')];
const boot = await fetch(LIVE + '/api/chat/boot', { headers: { Cookie: 'favor_hub_session=' + one, 'X-Hub-Request': '1' } }).then((x) => x.json());
const ch = boot.channels.find((c) => /qa-scratch-tester/.test(c.name));
const browser = await chromium.launch({ channel: 'msedge' });
const mk = async (t) => {
  const c = await browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block' });
  await c.addCookies([{ name: 'favor_hub_session', value: t, domain: 'dash.favorintl.org', path: '/', secure: true, httpOnly: true }, { name: 'hub_gc', value: '1', domain: 'dash.favorintl.org', path: '/', secure: true }]);
  const p = await c.newPage();
  const ws = [];
  p.on('websocket', (w) => { const r = { url: w.url().replace(LIVE, ''), open: Date.now(), closed: 0 }; ws.push(r); w.on('close', () => (r.closed = Date.now())); });
  await p.goto(LIVE + '/chat/?c=' + encodeURIComponent(ch.id), { waitUntil: 'commit' });
  await p.waitForSelector('.ch-comp textarea', { timeout: 25000 });
  await p.waitForTimeout(2500);
  return { p, ws };
};
const a = await mk(one);
const b = await mk(two);
const tag = 'lat' + (Date.now() % 100000);
const waitText = (p, t, ms) => p.waitForFunction((x) => document.body.innerText.includes(x), t, { timeout: ms, polling: 25 }).then(() => true, () => false);
const stats = (xs) => { const s = xs.filter((x) => x != null).sort((p, q) => p - q); return { n: s.length, lost: xs.length - s.length, min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], over2s: s.filter((x) => x > 2000).length }; };

const msg = [];
for (let i = 0; i < N; i++) {
  const t = `${tag} m${i}x`;
  const ta = a.p.locator('.ch-comp textarea:visible').first();
  await ta.click();
  await ta.fill(t);
  const t0 = Date.now();
  await a.p.keyboard.press('Enter');
  msg.push((await waitText(b.p, t, 12000)) ? Date.now() - t0 : null);
  await a.p.waitForTimeout(300);
}
console.log('message  ', JSON.stringify(stats(msg)));

const edit = [];
for (let i = 0; i < Math.min(N, 10); i++) {
  const t = `${tag} m${i}x`;
  const m = a.p.locator('.ch-msg', { hasText: t }).last();
  await m.hover();
  await m.locator('[data-act="more"]').first().click();
  await a.p.locator('.ch-pop [data-act="edit"]').first().click();
  await a.p.keyboard.press('End');
  await a.p.keyboard.type(' E');
  const t0 = Date.now();
  await a.p.keyboard.press('Enter');
  edit.push((await waitText(b.p, t + " E", 12000)) ? Date.now() - t0 : null);
}
console.log('edit     ', JSON.stringify(stats(edit)));

const typing = [];
for (let i = 0; i < Math.min(N, 10); i++) {
  const ta = b.p.locator('.ch-comp textarea:visible').first();
  await ta.fill('');
  await ta.click();
  const t0 = Date.now();
  await ta.pressSequentially('abc', { delay: 30 });
  const ok = await a.p.waitForFunction(() => /typing/i.test(document.querySelector('.ch-main .ch-typing')?.textContent || ''), null, { timeout: 8000, polling: 25 }).then(() => true, () => false);
  typing.push(ok ? Date.now() - t0 : null);
  await ta.fill('');
  await a.p.waitForTimeout(5500);
}
console.log('typing   ', JSON.stringify(stats(typing)));

for (const [n, x] of [['Tester', a], ['Tester Two', b]]) console.log(n, 'sockets', JSON.stringify(x.ws.map((w) => ({ url: w.url, upMs: (w.closed || Date.now()) - w.open, closed: !!w.closed }))));
await browser.close();
