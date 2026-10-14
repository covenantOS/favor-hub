// Chat 2026-10-14 additions, two users on qa-scratch-tester (Tester and Tester Two only, never real staff):
// /todo checklist ticked by the other person and in Projects, /poll votes, /schedule posting on time, /remind me, /status, /meet tip,
// desktop and phone screenshots. CHAT_HOST is the address both users load (a preview alias or the live site).
//   CHAT_HOST=https://chat-upgrade.favor-hub-d4n.pages.dev node app/e2e/chat-plus.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOTS || 'Q:/Temp/Will/chat-plus/shots';
mkdirSync(OUT, { recursive: true });
const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split(/\r?\n/)[0].trim();
const LIVE = 'https://dash.favorintl.org';
const HOST = process.env.CHAT_HOST || LIVE;
const H = { Authorization: 'Bearer ' + key };
const two = (await (await fetch(LIVE + '/api/admin/test-session?who=two', { method: 'POST', headers: H })).json()).cookie;
const one = (await (await fetch(LIVE + '/api/admin/test-session', { method: 'POST', headers: H })).json()).cookie;
const api = (tok, method, path, body) =>
  fetch(HOST + path, { method, headers: { Cookie: 'favor_hub_session=' + tok, 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const boot = await api(one, 'GET', '/api/chat/boot');
const qa = boot.channels.find((c) => c.name === 'qa-scratch-tester');
if (!qa) throw new Error('no qa-scratch-tester channel: ' + boot.channels.map((c) => c.name).join(','));
const CH = qa.id;
console.log('channel', CH, 'members', qa.members);
if ((qa.members || []).some((m) => !/^tester2?@favorintl\.org$/.test(m))) throw new Error('qa-scratch-tester has a real person in it; stopping');

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const note = (await fn()) || ''; results.push([name, 'ok', Date.now() - t0, note]);
  } catch (e) {
    results.push([name, 'FAIL', Date.now() - t0, String(e.message).split('\n')[0].slice(0, 240)]);
  }
};
const send = (tok, body) => api(tok, 'POST', `/api/chat/channels/${CH}/messages`, { body });

const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const ctxFor = async (tok, phone) => {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const domain = new URL(HOST).hostname;
  await ctx.addCookies([
    { name: 'favor_hub_session', value: tok, domain, path: '/', secure: true, httpOnly: true },
    { name: 'hub_gc', value: '1', domain, path: '/', secure: true },
  ]);
  return ctx;
};
const p1 = await (await ctxFor(one)).newPage();
const p2 = await (await ctxFor(two)).newPage();
const url = `${HOST}/chat/?c=${CH}&app2=1`;
await Promise.all([p1.goto(url), p2.goto(url)]);
await p1.waitForSelector('.ch-comp textarea, .ch-comp [contenteditable]', { timeout: 30000 });
await p2.waitForSelector('.ch-comp textarea, .ch-comp [contenteditable]', { timeout: 30000 });
const type = async (p, text) => {
  const box = p.locator('.ch-main .ch-comp textarea').first();
  await box.click();
  await box.fill(text);
  await p.keyboard.press('Escape').catch(() => undefined);
  await box.press('Enter');
};
const stamp = Date.now().toString(36).slice(-4);

let clMid = 0;
await step('slash menu lists the new commands', async () => {
  const box = p1.locator('.ch-main .ch-comp textarea').first();
  await box.click();
  await box.fill('/');
  await p1.waitForTimeout(400);
  const txt = await p1.locator('.ch-pop').first().innerText();
  await p1.screenshot({ path: `${OUT}/01-slash-menu.png` });
  await box.fill('');
  for (const c of ['remind', 'schedule', 'todo', 'poll', 'meet']) if (!txt.includes(c)) throw new Error('missing /' + c);
});

await step('/todo makes a checklist card both users see', async () => {
  await type(p1, `/todo QA ${stamp}: label the boxes @Tester Two fri; print the sheet; call the hall`);
  await p1.locator('.ch-cl', { hasText: 'QA ' + stamp }).waitFor({ timeout: 20000 });
  await p2.locator('.ch-cl', { hasText: 'QA ' + stamp }).waitFor({ timeout: 20000 });
  const n = await p2.locator('.ch-cl').last().locator('.ch-cl__i').count();
  if (n !== 3) throw new Error('lines ' + n);
  clMid = Number(await p1.locator('.ch-cl').last().locator('[data-act=ck]').first().getAttribute('data-mid'));
  await p1.locator('.ch-cl').last().scrollIntoViewIfNeeded();
  await p1.screenshot({ path: `${OUT}/02-checklist-desktop.png` });
  return 'message ' + clMid;
});

await step('Tester Two ticks a line; Tester sees it done; the task is done in Projects', async () => {
  await p2.locator('.ch-cl').last().locator('[data-act=ck]').nth(1).click();
  await p1.waitForFunction(() => [...document.querySelectorAll('.ch-cl')].pop()?.querySelectorAll('.ch-cl__i.is-done').length === 1, null, { timeout: 15000 });
  const tid = await p1.locator('.ch-cl').last().locator('[data-act=ck]').nth(1).getAttribute('data-tid');
  const t = await api(one, 'GET', `/api/tasks/${tid}`);
  const st = t.task?.status || t.status;
  if (st !== 'done') throw new Error('task status ' + st);
  await p1.screenshot({ path: `${OUT}/03-checklist-ticked.png` });
});

await step('done in Projects redraws the checklist in Chat', async () => {
  const tid = await p1.locator('.ch-cl').last().locator('[data-act=ck]').nth(2).getAttribute('data-tid');
  const r = await api(one, 'PATCH', `/api/tasks/${tid}`, { done: true });
  if (r.ok === false) throw new Error(JSON.stringify(r).slice(0, 200));
  await p2.waitForFunction(() => [...document.querySelectorAll('.ch-cl')].pop()?.querySelectorAll('.ch-cl__i.is-done').length === 2, null, { timeout: 15000 });
});

await step('Add a line', async () => {
  await p1.locator('.ch-cl').last().locator('[data-act=ck-add]').click();
  await p1.locator('.ch-cl__in').fill('sweep the floor');
  await p1.locator('.ch-cl__in').press('Enter');
  await p2.waitForFunction(() => [...document.querySelectorAll('.ch-cl')].pop()?.querySelectorAll('.ch-cl__i').length === 4, null, { timeout: 15000 });
});

await step('/poll and votes from both', async () => {
  await type(p1, `/poll Lunch ${stamp}? | Tuesday | Wednesday | Thursday`);
  await p2.locator('.ch-poll', { hasText: 'Lunch ' + stamp }).waitFor({ timeout: 20000 });
  await p1.locator('.ch-poll', { hasText: 'Lunch ' + stamp }).waitFor({ timeout: 20000 });
  await p2.locator('.ch-poll').last().locator('[data-act=vote]').nth(2).click();
  await p1.waitForTimeout(800);
  await p1.locator('.ch-poll').last().locator('[data-act=vote]').nth(0).click();
  await p2.waitForFunction(() => /2 people voted/.test([...document.querySelectorAll('.ch-poll')].pop()?.textContent || ''), null, { timeout: 15000 });
  await p1.locator('.ch-poll').last().scrollIntoViewIfNeeded();
  await p1.screenshot({ path: `${OUT}/04-poll.png` });
});

await step('/remind me shows a private note', async () => {
  await type(p1, `/remind me in 3 hours check the QA list ${stamp}`);
  await p1.waitForFunction((s) => [...document.querySelectorAll('.ch-note')].some((n) => n.textContent.includes('Reminder set') && n.textContent.includes(s)), stamp, { timeout: 15000 });
  await p2.waitForTimeout(1500);
  if ((await p2.content()).includes('Reminder set')) throw new Error('Tester Two sees the private note');
});

await step('/schedule posts on time, as the writer, for the other person', async () => {
  await type(p1, `/schedule in 1 minute Scheduled hello ${stamp}`);
  await p1.waitForFunction(() => [...document.querySelectorAll('.ch-note')].some((n) => /posts (Today|Tomorrow)/.test(n.textContent)), null, { timeout: 15000 });
  await p1.screenshot({ path: `${OUT}/05-scheduled-note.png` });
  await p1.waitForTimeout(65000);
  await api(two, 'GET', '/api/chat/dock'); // any Chat load posts what is due
  await p2.waitForFunction((s) => document.body.textContent.includes('Scheduled hello ' + s), stamp, { timeout: 20000 });
});

await step('/scheduled lists and cancels', async () => {
  await send(one, `/schedule tomorrow 8am Cancel me ${stamp}`);
  await type(p1, '/scheduled');
  await p1.waitForFunction((s) => [...document.querySelectorAll('.ch-note')].some((n) => n.textContent.includes('Cancel me ' + s)), stamp, { timeout: 15000 });
  await p1.locator('.ch-note').last().locator('[data-act=sch-cancel]').last().click();
  await p1.waitForTimeout(1200);
  const left = await api(one, 'GET', '/api/chat/scheduled');
  if (left.items.some((x) => x.text.includes('Cancel me ' + stamp))) throw new Error('still waiting');
});

await step('/status shows beside the name', async () => {
  await send(two, '/status Testing chat until tomorrow');
  const b = await api(one, 'GET', '/api/chat/boot');
  if (!b.status['tester2@favorintl.org']) throw new Error('no status');
  await send(two, '/back');
});

await step('/meet with no time gives a how-to', async () => {
  const r = await send(one, '/meet');
  if (r.message?.attachments?.[0]?.kind !== 'tip') throw new Error(JSON.stringify(r).slice(0, 200));
});

await step('phone: checklist and poll fit and tap', async () => {
  const pp = await (await ctxFor(one, true)).newPage();
  await pp.goto(`${HOST}/chat/?c=${CH}&app2=1`);
  await pp.waitForSelector('.ch-cl', { timeout: 30000 });
  await pp.locator('.ch-cl').last().scrollIntoViewIfNeeded();
  await pp.screenshot({ path: `${OUT}/06-phone-checklist.png` });
  await pp.locator('.ch-poll').last().scrollIntoViewIfNeeded();
  await pp.screenshot({ path: `${OUT}/07-phone-poll.png` });
  const wide = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) throw new Error('page scrolls sideways');
  const box = await pp.locator('.ch-cl').last().locator('[data-act=ck]').first().boundingBox();
  if (!box || box.width < 32) throw new Error('tick box too small: ' + (box && box.width));
});

await browser.close();
console.table(results.map(([n, s, ms, note]) => ({ step: n, result: s, ms, note })));
process.exit(results.some((r) => r[1] === 'FAIL') ? 1 : 0);
