// Chat, two users. Tester and Tester Two talk on qa-scratch-tester (the test users see only each other), never real staff.
// Runs against whichever Chat the host serves. CHAT_HOST is the address both users load (default the live site); NATIVE=1 opts both
// into the React app first (?app2=1), so they get native Chat and the native dock. A preview branch alias carries the socket too:
//   CHAT_HOST=https://native-chat.favor-hub-d4n.pages.dev NATIVE=1 node app/e2e/chat.mjs
// The phone step loads the local build (app/e2e/serve.mjs).
// Nothing here may cost money (Will, 2026-10-12): every route that calls Workers AI is stubbed in the browser. Translation, Catch me up,
// voice-note transcription and Favor Brain answer from the stubs below; huddles are read from a stub instead of starting a meeting.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { BASE, stop } from './serve.mjs';

const OUT = process.env.SHOTS || 'Q:/Temp/Will/react-app/shots/chat';
mkdirSync(OUT, { recursive: true });
const key = readFileSync('C:/Users/Willb/.claude/secrets/favor-hub-agent-key.txt', 'utf8').split(/\r?\n/)[0].trim();
const LIVE = 'https://dash.favorintl.org';
const H = { Authorization: 'Bearer ' + key };
await fetch(LIVE + '/api/admin/test-seed', { method: 'POST', headers: H }).catch(() => undefined);
const two = (await (await fetch(LIVE + '/api/admin/test-session?who=two', { method: 'POST', headers: H })).json()).cookie;
const one = (await (await fetch(LIVE + '/api/admin/test-session', { method: 'POST', headers: H })).json()).cookie;
const PATH = process.env.CHAT_URL || '/chat/';
const HOST = process.env.CHAT_HOST || LIVE;
const NATIVE = process.env.NATIVE === '1';
const ME1 = 'tester@favorintl.org';
const ME2 = 'tester2@favorintl.org';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }).catch(() => chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }));
const results = [];
const step = async (name, fn, shot) => {
  const t0 = Date.now();
  try {
    const note = (await fn()) || '';
    results.push([name, 'ok', Date.now() - t0, note]);
  } catch (e) {
    results.push([name, 'FAIL', Date.now() - t0, e.message.split('\n').slice(0, 3).join(' ').slice(0, 260)]);
    if (shot) await shot.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }).catch(() => undefined);
  } finally {
    // Stubs a step sets on a page (upload, Brain, huddle) never outlive the step, so one failure does not spill into the next.
    for (const pg of [globalThis.__p1, globalThis.__p2]) if (pg) await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
  }
};
const cookiesFor = (tok) =>
  [...new Set([new URL(LIVE).hostname, new URL(HOST).hostname])].flatMap((domain) => [
    { name: 'favor_hub_session', value: tok, domain, path: '/', secure: true, httpOnly: true },
    { name: 'hub_gc', value: '1', domain, path: '/', secure: true },
  ]);
// Counts the sockets a page holds open, for the leak check, and keeps them so a step can drop the connection.
const countSockets = () => {
  const W = window.WebSocket;
  window.__wsOpen = 0;
  window.__wsAll = [];
  window.WebSocket = function (...a) {
    const s = new W(...a);
    window.__wsOpen++;
    window.__wsAll.push(s);
    window.__wsLog = window.__wsLog || [];
    s.addEventListener('open', () => window.__wsLog.push(['open', Date.now() % 1e6]));
    s.addEventListener('close', () => window.__wsLog.push(['close', Date.now() % 1e6]));
    s.addEventListener('close', () => window.__wsOpen--);
    return s;
  };
  window.WebSocket.prototype = W.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
};
const tag = 'chat-e2e ' + (Date.now() % 100000);
const french = new Set();
let frenchSent = null;
const stubAI = async (ctx) => {
  await ctx.route('**/api/chat/translate', async (route) => {
    if (frenchSent) await frenchSent;
    const ids = (JSON.parse(route.request().postData() || '{}').ids || []).map(Number);
    const items = {};
    ids.filter((id) => french.has(id)).forEach((id) => (items[id] = { text: 'Hello, can you send the report before Thursday? (stub) ' + tag, src: 'fr' }));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items }) });
  });
  // The French message's id is noted as it is sent, so the translation stub answers for it alone.
  await ctx.route('**/api/chat/channels/*/messages', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST' || !/Bonjour/.test(r.postData() || '')) return route.fallback();
    let done;
    frenchSent = new Promise((ok) => (done = ok));
    const res = await route.fetch();
    const d = await res.json();
    if (d && d.message) french.add(Number(d.message.id));
    done();
    await route.fulfill({ response: res, json: d });
  });
  await ctx.route('**/api/chat/channels/*/catchup', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, headline: 'Caught up (stub)', points: [{ text: 'Tester Two asked for the report', ids: [] }], for_you: [], count: 4, people: 1 }) })
  );
};
// Desktop notices: a stand-in Notification that starts at "default" (so Chat shows its Turn on prompt) and records what it shows.
const mockNotify = () => {
  window.__notes = [];
  let perm = 'default';
  function N(title, o) {
    window.__notes.push([title, (o && o.body) || '']);
    this.close = () => undefined;
  }
  Object.defineProperty(N, 'permission', { get: () => perm });
  N.requestPermission = () => {
    perm = 'granted';
    return Promise.resolve('granted');
  };
  window.Notification = N;
};
// Partners and funds for the @ list: invented, so no real partner is named in the test channel.
const stubEntities = (ctx) =>
  ctx.route('**/api/chat/entities*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [{ kind: 'p', id: '99000001', name: 'Testpartner Example Church', sub: 'Partner' }, { kind: 'f', id: '99000002', name: 'Test Fund Example', sub: 'Fund' }] }) })
  );
const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await stubAI(ctx1);
await stubEntities(ctx1);
await ctx1.addCookies(cookiesFor(one));
await ctx1.grantPermissions(['microphone', 'camera', 'clipboard-read', 'clipboard-write'], { origin: HOST }).catch(() => undefined);
await ctx1.addInitScript(countSockets);
await ctx1.addInitScript(mockNotify);
const p1 = await ctx1.newPage();
globalThis.__p1 = p1;
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await stubAI(ctx2);
await ctx2.addCookies(cookiesFor(two));
const p2 = await ctx2.newPage();
globalThis.__p2 = p2;
const errs = [];
p1.on('pageerror', (e) => { if (!/ViewTransition/.test(e.message)) errs.push(e.message.slice(0, 80) + ' @ ' + String(e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' ').slice(0, 160)); });
p2.on('pageerror', (e) => { if (!/ViewTransition/.test(e.message)) errs.push('two: ' + e.message.slice(0, 80)); });

const boot = await fetch(LIVE + '/api/chat/boot', { headers: { Cookie: 'favor_hub_session=' + one, 'X-Hub-Request': '1' } }).then((x) => x.json()).catch(() => ({}));
const ch = (boot.channels || []).find((c) => /qa-scratch-tester/.test(c.name || ''));
const open = async (page) => {
  if (NATIVE) await page.goto(HOST + '/?app2=1', { waitUntil: 'commit' });
  await page.goto(HOST + PATH + (ch ? '?c=' + encodeURIComponent(ch.id) : ''), { waitUntil: 'commit' });
  await page.waitForSelector('.ch-comp textarea', { timeout: 25000 });
};
await open(p1);
await open(p2);
// Both pages wait for their websocket to be open before anything is sent, so a message is never sent into a room nobody is listening in.
await Promise.all([p1, p2].map((p) => p.waitForFunction(() => !document.querySelector('.ch-conn, [data-conn="off"]'), null, { timeout: 15000 }).catch(() => undefined)));
await p1.waitForTimeout(2500);
const say = async (page, text, where = '.ch-main') => {
  const ta = page.locator(where + ' .ch-comp textarea:visible').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially(text, { delay: 3 });
  await page.keyboard.press('Enter');
};
const seen = (page, text, ms = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: ms, polling: 25 });
// The message goes to the middle of the list first: the Catch me up strip and the pin bar sit over its top edge.
const center = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
const more = async (page, text, act) => {
  const msg = page.locator('.ch-main .ch-msg', { hasText: text }).last();
  await center(msg);
  await msg.hover();
  await msg.locator('[data-act="more"]').first().click();
  await page.locator('.ch-pop [data-act="' + act + '"]').first().click();
};
// A Favor Brain answer as the server sends it, with a text block and a tiles block for the Brain renderer.
const answer = (id, text) => ({ id, channel_id: ch.id, user_id: 'brain', body: '', created_at: new Date().toISOString(), visible_to: ME1, attachments: [], reactions: [], brain: { status: 'done', q: 'stub question', blocks: [{ type: 'text', md: text }, { type: 'tiles', tiles: [{ label: 'Partners who gave', value: 12 }] }] } });
const openScratch = async (page) => {
  await page.locator('.ch-side .ch-row', { hasText: 'qa-scratch-tester' }).first().click();
  await page.waitForFunction(() => /qa-scratch-tester/.test(document.querySelector('.ch-head')?.textContent || ''), null, { timeout: 8000 });
};

await step('channel opens for both users', async () => {
  if (!ch) throw new Error('no qa-scratch-tester channel');
  if (NATIVE && !(await p1.locator('#chat-root[data-native]').count())) throw new Error('the page is not native Chat');
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
  const ta = p2.locator('.ch-main .ch-comp textarea:visible').first();
  await ta.click();
  await ta.pressSequentially('typing now typing now', { delay: 120 });
  await p1.waitForFunction(() => /typing/i.test(document.querySelector('.ch-typing, [data-typing]')?.textContent || ''), null, { timeout: 6000 });
  await ta.fill('');
}, p1);
await step('edit is seen', async () => {
  await more(p1, tag + ' one', 'edit');
  await p1.keyboard.press('End');
  await p1.keyboard.type(' edited');
  await p1.keyboard.press('Enter');
  await seen(p2, tag + ' one edited');
}, p1);
await step('delete is seen', async () => {
  await say(p1, tag + ' gone');
  await seen(p2, tag + ' gone');
  const msg = p1.locator('.ch-msg', { hasText: tag + ' gone' }).last();
  await center(msg);
  await msg.hover();
  await msg.locator('[data-act="more"], [aria-label="More"]').first().click();
  await p1.locator('button', { hasText: /^Delete/ }).first().click();
  const ok = p1.locator('.ch-modal button, [role=dialog] button', { hasText: /^Delete$/ });
  if (await ok.count()) await ok.first().click();
  await p2.waitForFunction((t) => !document.body.innerText.includes(t), tag + ' gone', { timeout: 8000 });
}, p1);
await step('thread reply is seen', async () => {
  const msg = p2.locator('.ch-msg', { hasText: tag + ' two' }).last();
  await center(msg);
  await msg.hover();
  await msg.locator('[data-act="thread"], [aria-label*="eply"]').first().click();
  await p2.waitForSelector('[data-ta="thread"]', { timeout: 5000 });
  await p2.locator('[data-ta="thread"]').fill(tag + ' threaded');
  await p2.keyboard.press('Enter');
  await p1.waitForFunction(() => /1 repl/.test(document.body.innerText), null, { timeout: 8000 });
  await p2.locator('.ch-right [data-act="close-right"]').first().click().catch(() => undefined);
}, p2);
await step('French message arrives translated', async () => {
  await say(p2, 'Bonjour, pouvez-vous envoyer le rapport avant jeudi ? ' + tag);
  await p1.waitForFunction((t) => [...document.querySelectorAll('.ch-msg')].some((m) => m.textContent.includes(t) && /Translated from/.test(m.textContent)), tag, { timeout: 15000 });
}, p1);
await step('pin, pins panel, bookmark add and remove, seen by the other', async () => {
  await more(p1, tag + ' two', 'pin');
  await p2.waitForFunction((t) => /pinned/i.test(document.querySelector('.ch-pinbar')?.textContent || '') && [...document.querySelectorAll('.ch-msg.is-pinned')].some((m) => m.textContent.includes(t)), tag + ' two', { timeout: 8000 });
  await p1.locator('.ch-pinbar [data-act="pins"]').click();
  await p1.waitForFunction((t) => [...document.querySelectorAll('.ch-right .ch-pinned')].some((m) => m.textContent.includes(t)), tag + ' two', { timeout: 6000 });
  const bm = 'Reports ' + tag.slice(-5);
  await p1.locator('.ch-right [data-act="bm-add"]').click();
  const d = p1.locator('[role=dialog]');
  await d.locator('input').nth(0).fill('/reports/');
  await d.locator('input').nth(1).fill(bm);
  await d.locator('[data-act="bm-save"]').click();
  await p2.waitForFunction((t) => (document.querySelector('.ch-pinbar')?.textContent || '').includes(t), bm, { timeout: 8000 });
  await p1.screenshot({ path: `${OUT}/desk-pins.png` });
  await p1.locator('.ch-right .ch-bm', { hasText: bm }).locator('[data-act="bm-del"]').click();
  await p2.waitForFunction((t) => !(document.querySelector('.ch-pinbar')?.textContent || '').includes(t), bm, { timeout: 8000 });
  await p1.locator('.ch-right .ch-pinned', { hasText: tag + ' two' }).locator('[data-act="pin"]').click();
  await p2.waitForFunction((t) => ![...document.querySelectorAll('.ch-msg.is-pinned')].some((m) => m.textContent.includes(t)), tag + ' two', { timeout: 8000 });
  await p1.locator('.ch-right [data-act="close-right"]').first().click();
}, p2);
await step('mention picker and highlight; unread count, new line, Catch me up offer, rail and tab title', async () => {
  await p1.locator('.ch-side .ch-row', { hasText: 'FavorOS Tester Two' }).first().click();
  await p1.waitForFunction(() => /FavorOS Tester Two/.test(document.querySelector('.ch-head')?.textContent || ''), null, { timeout: 8000 });
  for (let i = 1; i <= 5; i++) await say(p2, tag + ' unread ' + i);
  const ta = p2.locator('.ch-main .ch-comp textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially('@FavorOS Tes', { delay: 20 });
  await p2.waitForSelector('.ch-pop--mention [data-act="mention-pick"]', { timeout: 4000 });
  await p2.locator('.ch-pop--mention [data-act="mention-pick"]', { hasText: 'FavorOS Tester' }).first().click();
  await ta.pressSequentially(' look at this ' + tag, { delay: 3 });
  await p2.keyboard.press('Enter');
  await p1.waitForFunction(() => { const r = [...document.querySelectorAll('.ch-side .ch-row')].find((x) => /qa-scratch-tester/.test(x.textContent)); return r && r.classList.contains('is-unread') && r.querySelector('.ch-badge'); }, null, { timeout: 15000 }).catch(async (err) => {
    const why = await p1.evaluate(() => ({ ws: window.__wsLog, row: [...document.querySelectorAll('.ch-side .ch-row')].find((x) => /qa-scratch-tester/.test(x.textContent))?.outerHTML.slice(0, 200) }));
    throw new Error(err.message.split(String.fromCharCode(10))[0] + ' ' + JSON.stringify(why));
  });
  await p1.waitForFunction(() => /^\(\d+\)/.test(document.title) && /\d/.test(document.querySelector('.h-side a[href="/chat/"]')?.textContent || ''), null, { timeout: 8000 });
  await openScratch(p1);
  await p1.waitForSelector('.ch-main .ch-new', { timeout: 8000 });
  await p1.waitForSelector('#sm-catch [data-act="sm-catch-go"]', { timeout: 8000 });
  await p1.screenshot({ path: `${OUT}/desk-unread.png` });
  await p1.locator('#sm-catch [data-act="sm-catch-go"]').click();
  await p1.waitForFunction(() => /Caught up/.test(document.querySelector('#sm-catch')?.textContent || ''), null, { timeout: 8000 });
  await p1.locator('#sm-catch [data-act="sm-catch-x"]').click();
  await p1.locator('.ch-main .ch-msg.is-mention', { hasText: 'look at this ' + tag }).first().waitFor({ timeout: 5000 });
}, p1);
await step('history: Load earlier, then mark unread from a message', async () => {
  const older = p1.locator('.ch-main [data-act="older"]');
  if (!(await older.count())) throw new Error('no earlier messages to load');
  const n0 = await p1.locator('.ch-main .ch-msg').count();
  await older.click();
  await p1.waitForFunction((n) => document.querySelectorAll('.ch-main .ch-msg').length > n, n0, { timeout: 8000 });
  await more(p1, tag + ' unread 3', 'mark-unread');
  await p1.waitForFunction(() => /Marked unread/.test(document.querySelector('.ch-toast')?.textContent || ''), null, { timeout: 5000 });
  await p1.waitForFunction(() => [...document.querySelectorAll('.ch-side .ch-row.is-unread')].some((x) => /qa-scratch-tester/.test(x.textContent)), null, { timeout: 5000 });
  await p1.locator('.ch-side .ch-row', { hasText: 'FavorOS Tester Two' }).first().click();
  await openScratch(p1);
  await p1.waitForFunction(() => ![...document.querySelectorAll('.ch-side .ch-row.is-unread')].some((x) => /qa-scratch-tester/.test(x.textContent)), null, { timeout: 5000 });
}, p1);
await step('Catch me up', async () => {
  await p1.locator('.ch-head [data-act="sm-catch"]').click();
  await p1.waitForFunction(() => {
    const t = document.querySelector('#sm-catch')?.textContent || '';
    return t && !/Reading the new messages/.test(t) && /(messages from|Nothing new|Caught up|For you)/.test(t);
  }, null, { timeout: 30000 });
  const t = await p1.locator('#sm-catch').innerText();
  await p1.locator('#sm-catch [data-act="sm-catch-x"]').click();
  return t.split('\n')[0].slice(0, 80);
}, p1);
await step('Turn into a reminder', async () => {
  await more(p1, tag + ' two', 'sm-turn');
  await p1.locator('[role=dialog] [data-act="sm-t-remind"]').click();
  await p1.locator('[role=dialog] [data-act="sm-rem-set"][data-code="hour"]').click();
  await p1.waitForFunction(() => /Reminder set/.test(document.querySelector('.ch-toast')?.textContent || ''), null, { timeout: 10000 });
}, p1);
await step('voice note: record, attach, send, play (upload and transcript stubbed)', async () => {
  const vid = 'stub' + Date.now();
  await p1.route('**/api/chat/upload', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: vid, name: 'voice-note.webm', size: 2048, mime: 'audio/webm', url: '/api/chat/file/' + vid }) }));
  await p1.route('**/api/chat/channels/*/messages', async (route) => {
    const r = route.request();
    const b = JSON.parse(r.postData() || '{}');
    if (r.method() !== 'POST' || !(b.attachments || []).some((a) => a.voice)) return route.continue();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, message: { id: 910000000 + Math.floor(Math.random() * 9999999), channel_id: ch.id, user_id: ME1, body: '', created_at: new Date().toISOString(), reactions: [], attachments: [{ type: 'file', id: vid, name: 'Voice note 0:02', mime: 'audio/webm', size: 2048, url: '/api/chat/file/' + vid, voice: true, transcript_status: 'ready', transcript: 'Stub transcript ' + tag }] } }) });
  });
  await p1.locator('.ch-main [data-act="sm-mic"]').click();
  await p1.waitForSelector('.ch-main .sm-rec', { timeout: 6000 });
  await p1.waitForTimeout(2500);
  await p1.locator('.ch-main [data-act="sm-rec-go"]').click();
  await p1.waitForFunction(() => { const p = document.querySelector('.ch-main .ch-pend'); return p && !p.hidden && /Voice note/.test(p.textContent) && !/uploading/.test(p.textContent); }, null, { timeout: 15000 });
  await p1.locator('.ch-main [data-send="main"]').click();
  await p1.waitForFunction((t) => [...document.querySelectorAll('.ch-main .ch-voice')].some((v) => v.textContent.includes(t) && v.querySelector('audio')), 'Stub transcript ' + tag, { timeout: 8000 });
  await p1.unroute('**/api/chat/upload');
  await p1.unroute('**/api/chat/channels/*/messages');
}, p1);
await step('@Favor Brain answers privately (stubbed)', async () => {
  const id = 900000000 + Math.floor(Math.random() * 99999999);
  await p1.route('**/api/chat/channels/*/messages', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST' || !String(r.postData() || '').includes('<@brain>')) return route.continue();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, message: answer(id, 'Stub answer ' + tag) }) });
  });
  await p1.route('**/api/chat/messages/' + id + '/dismiss', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  const ta = p1.locator('.ch-main .ch-comp textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially('@Favor', { delay: 20 });
  await p1.waitForSelector('.ch-pop--mention', { timeout: 4000 });
  await p1.keyboard.press('Enter');
  await ta.pressSequentially('how many partners gave this week', { delay: 3 });
  await p1.keyboard.press('Enter');
  const ans = p1.locator('.ch-msg--brain', { hasText: 'Stub answer ' + tag });
  await ans.waitFor({ timeout: 8000 });
  if (!/Only visible to you/.test(await ans.innerText())) throw new Error('the answer is not marked private');
  if (!(await ans.locator('.blk-tiles').count())) throw new Error('the Brain renderer did not draw the tiles block');
  await p1.screenshot({ path: `${OUT}/desk-brain.png` });
  await ans.locator('[data-act="dismiss-answer"]').click();
  await ans.waitFor({ state: 'detached', timeout: 5000 });
  await p1.unroute('**/api/chat/channels/*/messages');
}, p1);
await step('@Favor Brain answer shared to the channel (stubbed)', async () => {
  const id = 900000000 + Math.floor(Math.random() * 99999999);
  await p1.route('**/api/chat/channels/*/messages', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST' || !String(r.postData() || '').includes('<@brain>')) return route.continue();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, message: answer(id, 'Share me ' + tag) }) });
  });
  await p1.route('**/api/chat/messages/' + id + '/share', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, message: { ...answer(id + 1, 'Share me ' + tag), visible_to: null, brain: { ...answer(id + 1, 'Share me ' + tag).brain, shared_by: ME1 } } }) }));
  await p1.locator('.ch-main [data-act="ask-brain"]').click();
  const ta = p1.locator('.ch-main .ch-comp textarea').first();
  await ta.pressSequentially('which funds grew this month', { delay: 3 });
  await p1.keyboard.press('Enter');
  const ans = p1.locator('.ch-msg--brain', { hasText: 'Share me ' + tag });
  await ans.first().waitFor({ timeout: 8000 });
  await ans.first().locator('[data-act="share-answer"]').click();
  await p1.waitForFunction((t) => [...document.querySelectorAll('.ch-msg--brain')].some((m) => m.textContent.includes(t) && /Shared by/.test(m.textContent) && !/Only visible to you/.test(m.textContent)), 'Share me ' + tag, { timeout: 6000 });
  await p1.unroute('**/api/chat/channels/*/messages');
}, p1);
await step('huddle strip with timer and Join (huddle state stubbed)', async () => {
  const h = { id: 'abcdefabcdefabcdefabcdef', title: 'Huddle in #qa-scratch-tester', startedAt: Date.now() - 65000, people: [{ email: ME2, name: 'FavorOS Tester Two' }], live: true };
  await p1.route('**/api/chat/channels/*/huddle', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, huddle: h }) }));
  await p1.locator('.ch-side .ch-row', { hasText: 'qa-scratch-tester' }).first().click();
  await p1.waitForFunction(() => { const h = document.querySelector('.ch-hud'); return h && !h.hidden && /Huddle/.test(h.textContent) && h.querySelector('.ch-hud__join'); }, null, { timeout: 12000 });
  const t1 = await p1.locator('[data-hud-dur]').innerText();
  await p1.waitForTimeout(1200);
  if ((await p1.locator('[data-hud-dur]').innerText()) === t1) throw new Error('the huddle timer does not move');
  await p1.screenshot({ path: `${OUT}/desk-huddle.png` });
  // Join opens the pre-join sheet (camera and microphone check). Cancel, so no meeting starts.
  await p1.locator('.ch-hud__join').click();
  await p1.waitForSelector('.pj-sheet', { timeout: 8000 });
  await p1.waitForTimeout(600);
  await p1.screenshot({ path: `${OUT}/desk-prejoin.png` });
  await p1.locator('.pj-cancel').click();
  await p1.waitForSelector('.pj-sheet', { state: 'detached', timeout: 5000 });
  await p1.unroute('**/api/chat/channels/*/huddle');
}, p1);
await step('DM: Tester to Tester Two', async () => {
  await p1.locator('.ch-side__head [data-act="new-dm"]').click();
  await p1.locator('[role=dialog] [data-pp="' + ME2 + '"]').click();
  await p1.locator('[role=dialog] [data-act="pp-done"]').click();
  await p1.waitForFunction(() => /FavorOS Tester Two/.test(document.querySelector('.ch-head')?.textContent || ''), null, { timeout: 8000 });
  await say(p1, tag + ' dm');
  await p2.waitForFunction(() => [...document.querySelectorAll('.ch-side .ch-row')].some((r) => (r.querySelector('.ch-row__n')?.textContent || '').trim() === 'FavorOS Tester' && r.querySelector('.ch-badge')), null, { timeout: 10000 });
  await p2.locator('.ch-side .ch-row', { has: p2.locator('.ch-row__n', { hasText: /^FavorOS Tester$/ }) }).first().click();
  await seen(p2, tag + ' dm');
  await openScratch(p2);
}, p2);
await step('dock: badge for the other user, same message list, reply', async () => {
  const p2b = await ctx2.newPage();
  try {
    await p2b.goto(HOST + '/', { waitUntil: 'commit' });
    await p2b.waitForSelector('.fd__btn', { timeout: 20000 });
    await p2b.waitForTimeout(1500);
    const n0 = Number((await p2b.locator('.fd__n').textContent().catch(() => '0')) || 0) || 0;
    await say(p1, tag + ' dock');
    await p2b.waitForFunction((n) => { const b = document.querySelector('.fd__n'); return b && !b.hidden && Number(b.textContent) > n; }, n0, { timeout: 12000 });
    await p2b.waitForFunction((t) => [...document.querySelectorAll('.fd-t')].some((x) => x.textContent.includes(t)), tag + ' dock', { timeout: 8000 });
    await p2b.locator('.fd__btn').click();
    await p2b.waitForSelector('.fd-p .ch-row, .fd-p .fp-row', { timeout: 10000 });
    await p2b.locator('.fd-p .ch-row, .fd-p .fp-row', { has: p2b.locator('.ch-row__n, .fp-row__n', { hasText: /^FavorOS Tester$/ }) }).first().click();
    await p2b.waitForFunction((t) => [...document.querySelectorAll('.fd-p .ch-msg, .fd-p .fp-m')].some((m) => m.textContent.includes(t)), tag + ' dock', { timeout: 10000 });
    if (NATIVE && !(await p2b.locator('#dock-chat .ch-msg').count())) throw new Error('the dock does not draw the Chat message list');
    await p2b.screenshot({ path: `${OUT}/desk-dock.png` });
    const ta = p2b.locator('.fd-p .ch-comp textarea, .fd-p [data-mi] [contenteditable], .fd-p [data-mi] textarea').first();
    await ta.click();
    await p2b.keyboard.type(tag + ' from the dock');
    await p2b.keyboard.press('Enter');
    await seen(p1, tag + ' from the dock');
    // Catch me up in the dock's conversation header (stubbed), then the Threads list.
    await p2b.locator('#dock-chat .ch-dock__head [data-act="sm-catch"]').click();
    await p2b.waitForFunction(() => /Caught up|Nothing new/.test(document.querySelector('#dock-chat #sm-catch')?.textContent || ''), null, { timeout: 8000 });
    await p2b.locator('#dock-chat .ch-dock__head [data-act="back"]').click();
    await p2b.locator('#dock-chat [data-act="page"]').click();
    await p2b.waitForSelector('#dock-chat .ch-pagelist, #dock-chat .ch-empty--page', { timeout: 8000 });
    await p2b.screenshot({ path: `${OUT}/desk-dock-threads.png` });
  } finally {
    await p2b.close();
  }
}, p2);
await step('mute and unmute', async () => {
  await openScratch(p1);
  const muted = () => p1.evaluate((cid) => fetch('/api/chat/boot', { headers: { 'X-Hub-Request': '1' } }).then((x) => x.json()).then((b) => (b.channels || []).find((c) => c.id === cid)?.muted), ch.id);
  await p1.locator('.ch-head [aria-label="Channel details"]').click();
  await p1.locator('.ch-right [data-act="mute"]').click();
  await p1.waitForSelector('.ch-side .ch-row.is-muted', { timeout: 5000 });
  await p1.waitForTimeout(600);
  if ((await muted()) !== true) throw new Error('mute did not save');
  await p1.locator('.ch-right [data-act="mute"]').click();
  await p1.waitForSelector('.ch-side .ch-row.is-muted', { state: 'detached', timeout: 5000 });
  await p1.waitForTimeout(600);
  if ((await muted()) !== false) throw new Error('unmute did not save');
  await p1.locator('.ch-right [data-act="close-right"]').click();
}, p1);
await step('leave and rejoin', async () => {
  await p2.locator('.ch-head [aria-label="Channel details"]').click();
  await p2.locator('.ch-right [data-act="leave"]').click();
  await p2.waitForFunction(() => ![...document.querySelectorAll('.ch-side .ch-row')].some((r) => /qa-scratch-tester/.test(r.textContent)), null, { timeout: 8000 });
  await p1.locator('.ch-head [aria-label="Channel details"]').click();
  await p1.locator('.ch-right [role=tab]', { hasText: 'Members' }).click();
  await p1.locator('.ch-right [data-act="add-members"]').click();
  await p1.locator('[role=dialog] [data-pp="' + ME2 + '"]').click();
  await p1.locator('[role=dialog] [data-act="pp-done"]').click();
  await p2.waitForFunction(() => [...document.querySelectorAll('.ch-side .ch-row')].some((r) => /qa-scratch-tester/.test(r.textContent)), null, { timeout: 10000 });
  await p1.locator('.ch-right [data-act="close-right"]').click();
  await openScratch(p2);
  await say(p1, tag + ' back');
  await seen(p2, tag + ' back');
}, p2);
await step('sidebar pages: Threads, Mentions and reactions, Drafts', async () => {
  for (const pg of ['threads', 'activity', 'drafts']) {
    await p1.locator(`.ch-side [data-act="page"][data-page="${pg}"]`).click();
    await p1.waitForFunction((x) => document.querySelector('#chat-root')?.getAttribute('data-page') === x && document.querySelector('.ch-main .ch-pagelist, .ch-main .ch-empty--page'), pg, { timeout: 8000 });
    if (pg === 'threads') {
      const want = await p1.evaluate(() => fetch('/api/chat/threads', { headers: { 'X-Hub-Request': '1' } }).then((x) => x.json()).then((d) => (d.threads || []).length));
      const got = await p1.locator('.ch-main .ch-th').count();
      if (got !== want) throw new Error('Threads shows ' + got + ', the server lists ' + want);
    }
    if (pg === 'activity') await p1.screenshot({ path: `${OUT}/desk-activity.png` });
  }
  await openScratch(p1);
}, p1);
await step('switcher (Ctrl K) and search with a filter, jump to a hit', async () => {
  await p1.locator('.ch-main .ch-msgs').click({ position: { x: 5, y: 5 } });
  await p1.keyboard.press('Control+k');
  await p1.locator('[data-swq]').fill('Tester Two');
  await p1.waitForSelector('.ch-sw [data-act="sw-pick"]', { timeout: 4000 });
  await p1.keyboard.press('Enter');
  await p1.waitForFunction(() => /FavorOS Tester Two/.test(document.querySelector('.ch-head')?.textContent || ''), null, { timeout: 8000 });
  await p1.keyboard.press('Control+k');
  await p1.locator('[data-swq]').fill('qa-scratch');
  await p1.waitForFunction(() => /qa-scratch/.test(document.querySelector('.ch-sw [data-act="sw-pick"]')?.textContent || ''), null, { timeout: 4000 });
  await p1.keyboard.press('Enter');
  await p1.waitForFunction(() => /qa-scratch-tester/.test(document.querySelector('.ch-head')?.textContent || ''), null, { timeout: 8000 });
  await p1.locator('.ch-head [data-act="search"]').click();
  await p1.locator('[data-sq]').fill(tag + ' two');
  await p1.waitForSelector('.ch-search [data-act="hit"]', { timeout: 10000 });
  await p1.locator('.ch-search__f [data-sf="here"]').click();
  await p1.waitForSelector('.ch-search__f [data-sf="here"].is-on', { timeout: 3000 });
  await p1.waitForSelector('.ch-search [data-act="hit"]', { timeout: 10000 });
  await p1.screenshot({ path: `${OUT}/desk-search.png` });
  await p1.locator('.ch-search [data-act="hit"]').first().click();
  await p1.waitForSelector('.ch-msg.is-flash', { timeout: 8000 });
}, p1);
await step('channel tools: new channel and browse dialogs, topic edit seen by the other', async () => {
  await p1.locator('.ch-sec[data-sec="channels"] .ch-sec__h .ch-iconbtn').click();
  await p1.waitForSelector('[role=dialog] [data-act="nc-create"]', { timeout: 4000 });
  await p1.screenshot({ path: `${OUT}/desk-newchannel.png` });
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
  await p1.locator('.ch-side [data-act="browse"]').click();
  await p1.waitForSelector('[role=dialog]', { timeout: 4000 });
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
  await p1.locator('.ch-head [aria-label="Channel details"]').click();
  const inp = p1.locator('.ch-right [data-topic]');
  const old = await inp.inputValue();
  await inp.fill(old + ' ' + tag);
  await p2.waitForFunction((t) => (document.querySelector('.ch-head__topic')?.textContent || '').includes(t), tag, { timeout: 10000 });
  await inp.fill(old);
  await p2.waitForFunction((t) => !(document.querySelector('.ch-head__topic')?.textContent || '').includes(t), tag, { timeout: 10000 });
  await p1.locator('.ch-right [data-act="close-right"]').click();
}, p2);
await step('reactions: add, count and who reacted, remove, seen both ways', async () => {
  const msg = p1.locator('.ch-main .ch-msg', { hasText: tag + ' two' }).last();
  await center(msg);
  await msg.hover();
  await msg.locator('.ch-bar [data-act="react-pick"]').click();
  await p1.waitForSelector('.ch-pop .ch-emo__e', { timeout: 5000 });
  await p1.locator('.ch-pop .ch-emo__e').first().click();
  const em = await msg.locator('.ch-react [data-act="react"]').first().getAttribute('data-e', { timeout: 6000 });
  const rx = (p, n) => p.waitForFunction(([t, e, n]) => { const m = [...document.querySelectorAll('.ch-main .ch-msg')].filter((x) => x.textContent.includes(t)).pop(); const b = m && m.querySelector('.ch-react [data-e="' + e + '"]'); return n === 0 ? !b : b && b.textContent.trim().endsWith(String(n)); }, [tag + ' two', em, n], { timeout: 8000 });
  await rx(p2, 1);
  const who = await p2.locator('.ch-main .ch-msg', { hasText: tag + ' two' }).last().locator(`.ch-react [data-e="${em}"]`).getAttribute('title');
  if (!/FavorOS Tester/.test(who || '')) throw new Error('who reacted: ' + who);
  await p2.locator('.ch-main .ch-msg', { hasText: tag + ' two' }).last().locator(`.ch-react [data-e="${em}"]`).click();
  await rx(p1, 2);
  await msg.locator(`.ch-react [data-e="${em}"]`).click();
  await rx(p2, 1);
  await p2.locator('.ch-main .ch-msg', { hasText: tag + ' two' }).last().locator(`.ch-react [data-e="${em}"]`).click();
  await rx(p1, 0);
}, p1);
await step('formatting bar and markdown, drawn for the other', async () => {
  const ta = p1.locator('.ch-main .ch-comp textarea').first();
  await ta.click();
  await ta.fill('boldword');
  await p1.keyboard.press('Control+a');
  await p1.locator('.ch-main [data-act="fmt"][data-f="bold"]').click();
  await p1.keyboard.press('End');
  await p1.keyboard.type(' _itword_ ~~stword~~ `codeword` ' + tag + ' fmt');
  await p1.keyboard.press('Enter');
  await p2.waitForFunction((t) => { const m = [...document.querySelectorAll('.ch-main .ch-msg')].filter((x) => x.textContent.includes(t)).pop(); return m && /boldword/.test(m.querySelector('strong, b')?.textContent || '') && /itword/.test(m.querySelector('em, i')?.textContent || '') && /stword/.test(m.querySelector('s, del')?.textContent || '') && /codeword/.test(m.querySelector('code')?.textContent || ''); }, tag + ' fmt', { timeout: 8000 });
}, p2);
await step('drafts kept per conversation, counted in the sidebar', async () => {
  const ta = p1.locator('.ch-main .ch-comp textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially('draft ' + tag, { delay: 3 });
  await p1.waitForTimeout(700);
  await p1.locator('.ch-side .ch-row', { hasText: 'FavorOS Tester Two' }).first().click();
  await p1.waitForSelector('.ch-side .ch-row[data-id="' + ch.id + '"] .ch-row__ic--draft', { timeout: 4000 });
  if (!/\d/.test(await p1.locator('.ch-side [data-act="page"][data-page="drafts"]').innerText())) throw new Error('no draft count');
  await openScratch(p1);
  if ((await ta.inputValue()) !== 'draft ' + tag) throw new Error('draft not restored: ' + (await ta.inputValue()));
  await ta.fill('');
  await p1.waitForTimeout(700);
}, p1);
await step('partner and fund chips from the @ list, Blackbaud action review', async () => {
  const ta = p1.locator('.ch-main .ch-comp textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially('gift from @Testp', { delay: 40 });
  await p1.locator('.ch-pop--mention [data-act="mention-pick"]', { hasText: 'Testpartner Example Church' }).waitFor({ timeout: 6000 });
  await p1.locator('.ch-pop--mention [data-act="mention-pick"]', { hasText: 'Testpartner Example Church' }).click();
  await ta.pressSequentially(' for @Test F', { delay: 40 });
  await p1.locator('.ch-pop--mention [data-act="mention-pick"]', { hasText: 'Test Fund Example' }).waitFor({ timeout: 6000 });
  await p1.locator('.ch-pop--mention [data-act="mention-pick"]', { hasText: 'Test Fund Example' }).click();
  await ta.pressSequentially(' ' + tag + ' chips', { delay: 3 });
  await p1.keyboard.press('Enter');
  await p2.waitForFunction((t) => [...document.querySelectorAll('.ch-main .ch-msg')].some((m) => m.textContent.includes(t) && m.querySelector('.fe-chip--partner') && m.querySelector('.fe-chip--fund')), tag + ' chips', { timeout: 10000 });
  await more(p1, tag + ' chips', 'sm-turn');
  await p1.locator('[role=dialog] [data-act="sm-t-bb"]').click();
  await p1.waitForFunction(() => { const d = document.querySelector('[role=dialog]'); return d && /Testpartner|Blackbaud/.test(d.textContent) && !d.querySelector('.ch-skel'); }, null, { timeout: 8000 });
  let note = 'no Blackbaud owners for the tester';
  if (await p1.locator('[role=dialog] [data-act="sm-bb-review"]').count()) {
    const sum = p1.locator('[role=dialog] textarea').first();
    if (await sum.count()) await sum.fill('Test summary ' + tag);
    await p1.locator('[role=dialog] [data-act="sm-bb-review"]').click();
    await p1.waitForSelector('[role=dialog] .sm-review', { timeout: 4000 });
    await p1.screenshot({ path: `${OUT}/desk-bb-review.png` });
    note = 'review step shown, nothing saved';
  }
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
  return note;
}, p1);
await step('copy link, Make a request, Make a task', async () => {
  await more(p1, tag + ' two', 'copy-link');
  await p1.waitForFunction(() => /Link copied/.test(document.querySelector('.ch-toast')?.textContent || ''), null, { timeout: 5000 });
  const clip = await p1.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (!/\/chat\/\?c=.+&m=\d+/.test(clip)) throw new Error('link is ' + clip);
  await more(p1, tag + ' two', 'make-request');
  await p1.waitForSelector('[role=dialog] [data-rq-title]', { timeout: 4000 });
  if (!(await p1.locator('[role=dialog] [data-rq-title]').inputValue()).includes(tag)) throw new Error('request title not filled from the message');
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
  await more(p1, tag + ' two', 'sm-turn');
  await p1.waitForSelector('[role=dialog] [data-act="sm-t-task"]', { timeout: 6000 });
  for (const a of ['sm-t-request', 'sm-t-remind', 'sm-t-bb']) if (!(await p1.locator(`[role=dialog] [data-act="${a}"]`).count())) throw new Error('Turn into lacks ' + a);
  await p1.screenshot({ path: `${OUT}/desk-turn-into.png` });
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
}, p1);
await step('slash commands and the plus menu', async () => {
  const ta = p1.locator('.ch-main .ch-comp textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially('/', { delay: 20 });
  await p1.waitForSelector('.ch-pop--slash [data-act="slash-pick"]', { timeout: 4000 });
  const cmds = await p1.locator('.ch-pop--slash [data-act="slash-pick"]').allInnerTexts();
  for (const c of ['/brain', '/request', '/huddle', '/clip']) if (!cmds.some((x) => x.includes(c))) throw new Error('missing ' + c);
  await ta.pressSequentially('request Test request ' + tag, { delay: 3 });
  if (await p1.locator('.ch-pop--slash').count()) await p1.keyboard.press('Escape');
  await p1.keyboard.press('Enter');
  await p1.waitForSelector('[role=dialog] [data-rq-title]', { timeout: 4000 });
  if (!(await p1.locator('[role=dialog] [data-rq-title]').inputValue()).includes('Test request ' + tag)) throw new Error('/request did not fill the title');
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
  await p1.locator('.ch-main .ch-comp [data-act="plus"]').click();
  for (const a of ['upload', 'drive-pick', 'clip-pick', 'clip-rec', 'meeting', 'request-new']) if (!(await p1.locator(`.ch-pop [data-act="${a}"]`).count())) throw new Error('plus menu lacks ' + a);
  await p1.screenshot({ path: `${OUT}/desk-plus.png` });
  await p1.keyboard.press('Escape');
}, p1);
await step('emoji picker inserts into the message box', async () => {
  const ta = p1.locator('.ch-main .ch-comp textarea').first();
  await ta.fill('');
  await p1.locator('.ch-main .ch-comp [data-act="emoji"]').click();
  await p1.waitForSelector('.ch-pop .ch-emo__e', { timeout: 5000 });
  await p1.screenshot({ path: `${OUT}/desk-emoji.png` });
  await p1.locator('.ch-pop .ch-emo__e').first().click();
  const v = await ta.inputValue();
  if (!/\p{Extended_Pictographic}/u.test(v)) throw new Error('no emoji in the box: ' + v);
  await ta.fill('');
  if (await p1.locator('.ch-pop').count()) await p1.keyboard.press('Escape');
}, p1);
await step('language menu and Show original', async () => {
  await p1.locator('.ch-head [data-act="sm-lang"]').click();
  await p1.waitForSelector('.ch-pop [data-act="sm-setlang"]', { timeout: 4000 });
  const n = await p1.locator('.ch-pop [data-act="sm-setlang"]').count();
  await p1.keyboard.press('Escape');
  const fr = p1.locator('.ch-main .ch-msg', { hasText: 'Translated from' }).last();
  await center(fr);
  await fr.locator('[data-act="sm-orig"]').click();
  await p1.waitForFunction((t) => [...document.querySelectorAll('.ch-main .ch-msg')].some((m) => m.textContent.includes('Bonjour') && m.textContent.includes(t) && /Show translation/.test(m.textContent)), tag, { timeout: 4000 });
  await p1.locator('.ch-main .ch-msg', { hasText: 'Show translation' }).last().locator('[data-act="sm-orig"]').click();
  await p1.waitForFunction((t) => [...document.querySelectorAll('.ch-main .ch-msg')].some((m) => m.textContent.includes(t) && /Translated from/.test(m.textContent)), tag, { timeout: 4000 });
  return n + ' languages';
}, p1);
await step('attachments: picture and PDF upload, viewer, Files tab, Drive and clip pickers, link card', async () => {
  const png = await p1.screenshot({ clip: { x: 360, y: 120, width: 160, height: 100 } });
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]).drawText('Test sheet', { x: 30, y: 100, size: 18 });
  const pdf = Buffer.from(await doc.save());
  await p1.locator('.ch-main form input[type=file]').setInputFiles([
    { name: 'e2e-picture.png', mimeType: 'image/png', buffer: png },
    { name: 'e2e-sheet.pdf', mimeType: 'application/pdf', buffer: pdf },
  ]);
  await p1.waitForFunction(() => { const p = document.querySelector('.ch-main .ch-pend'); return p && !p.hidden && p.querySelectorAll('.ch-pend__i').length === 2 && !/uploading/.test(p.textContent); }, null, { timeout: 20000 });
  await say(p1, tag + ' files');
  await p2.waitForFunction((t) => [...document.querySelectorAll('.ch-main .ch-msg')].some((m) => m.textContent.includes(t) && m.querySelector('.ch-cards img') && /e2e-sheet/.test(m.textContent)), tag + ' files', { timeout: 10000 });
  const fm = p1.locator('.ch-main .ch-msg', { hasText: tag + ' files' }).last();
  await fm.locator('.ch-cards img').first().click();
  await p1.waitForFunction(() => window.FavorChatView && window.FavorChatView.isOpen(), null, { timeout: 6000 });
  await p1.waitForTimeout(500);
  await p1.screenshot({ path: `${OUT}/desk-viewer-image.png` });
  await p1.keyboard.press('Escape');
  await p1.waitForFunction(() => !window.FavorChatView.isOpen(), null, { timeout: 4000 });
  await fm.locator('.ch-cards >> text=e2e-sheet').first().click();
  await p1.waitForFunction(() => window.FavorChatView.isOpen(), null, { timeout: 6000 });
  await p1.waitForTimeout(1200);
  await p1.screenshot({ path: `${OUT}/desk-viewer-pdf.png` });
  await p1.keyboard.press('Escape');
  await p1.waitForFunction(() => !window.FavorChatView.isOpen(), null, { timeout: 4000 });
  await p1.locator('.ch-head [aria-label="Channel details"]').click();
  await p1.locator('.ch-right [role=tab]', { hasText: 'Files' }).click();
  await p1.waitForFunction(() => /e2e-sheet/.test(document.querySelector('.ch-right .ch-det')?.textContent || ''), null, { timeout: 4000 });
  await p1.locator('.ch-right [data-act="close-right"]').click();
  await p1.locator('.ch-main .ch-comp [data-act="plus"]').click();
  await p1.locator('.ch-pop [data-act="drive-pick"]').click();
  await p1.locator('[role=dialog] input').first().fill('report');
  await p1.waitForTimeout(1500);
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
  await p1.locator('.ch-main .ch-comp [data-act="plus"]').click();
  await p1.locator('.ch-pop [data-act="clip-pick"]').click();
  await p1.waitForSelector('[role=dialog]', { timeout: 4000 });
  await p1.locator('[role=dialog] [data-act="modal-x"]').first().click();
  await say(p1, 'https://favorintl.org/ ' + tag + ' link');
  await p2.waitForFunction((t) => [...document.querySelectorAll('.ch-main .ch-msg')].some((m) => m.textContent.includes(t) && m.querySelector('.ch-cards')), tag + ' link', { timeout: 20000 });
}, p1);
await step('typing in a thread is seen', async () => {
  const openT = async (p) => {
    const m = p.locator('.ch-main .ch-msg', { hasText: tag + ' two' }).last();
    await center(m);
    await m.locator('.ch-replies').click();
    await p.waitForSelector('.ch-right [data-ta="thread"]', { timeout: 5000 });
  };
  await openT(p1);
  await openT(p2);
  await p2.locator('.ch-right [data-ta="thread"]').pressSequentially('typing in the thread', { delay: 120 });
  await p1.waitForFunction(() => /typing/i.test(document.querySelector('.ch-right .ch-typing')?.textContent || ''), null, { timeout: 6000 });
  await p2.locator('.ch-right [data-ta="thread"]').fill('');
  for (const p of [p1, p2]) await p.locator('.ch-right [data-act="close-right"]').first().click();
}, p1);
await step('socket drops and comes back; a message sent meanwhile arrives', async () => {
  await p1.evaluate(() => window.__wsAll.filter((s) => s.readyState === 1 && /chat\/ws/.test(s.url)).forEach((s) => s.close()));
  await say(p2, tag + ' while away');
  await seen(p1, tag + ' while away', 15000);
  await p1.waitForFunction(() => window.__wsAll.some((s) => s.readyState === 1 && /chat\/ws/.test(s.url)), null, { timeout: 10000 });
}, p1);
await step('presence: away when the tab hides, online when it shows, ping after 10 s hidden', async () => {
  await p2.locator('.ch-head [aria-label="Channel details"]').click();
  await p2.locator('.ch-right [role=tab]', { hasText: 'Members' }).click();
  const dot = (s) => p2.waitForFunction((st) => [...document.querySelectorAll('.ch-right .ch-person')].some((r) => /FavorOS Tester/.test(r.textContent) && !/Tester Two/.test(r.textContent) && r.querySelector('.ch-dot')?.getAttribute('data-p') === st), s, { timeout: 8000 });
  const vis = (hidden) => p1.evaluate((h) => {
    if (!window.__sendWrapped) {
      window.__sendWrapped = true;
      const s = WebSocket.prototype.send;
      WebSocket.prototype.send = function (d) { (window.__sent = window.__sent || []).push(String(d)); return s.call(this, d); };
    }
    window.__sent = [];
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await vis(true);
  await dot('away');
  await p1.waitForTimeout(10300);
  await vis(false);
  await dot('online');
  const sent = await p1.evaluate(() => window.__sent);
  if (!sent.includes('ping')) throw new Error('no ping after 10 s hidden: ' + JSON.stringify(sent));
  await p2.locator('.ch-right [data-act="close-right"]').click();
}, p2);
await step('desktop notice for a direct message, with the Turn on prompt', async () => {
  await p1.locator('.ch-ask [data-act="notify-on"]').click();
  await p1.waitForFunction(() => /Notices are on/.test(document.querySelector('.ch-toast')?.textContent || ''), null, { timeout: 5000 });
  if (await p1.locator('.ch-ask').count()) throw new Error('the prompt stays');
  await p1.evaluate(() => { document.hasFocus = () => false; });
  await p2.locator('.ch-side .ch-row', { has: p2.locator('.ch-row__n', { hasText: /^FavorOS Tester$/ }) }).first().click();
  await say(p2, tag + ' notice');
  await p1.waitForFunction((t) => window.__notes.some((n) => n[1].includes(t)), tag + ' notice', { timeout: 10000 });
  await p1.evaluate(() => { delete document.hasFocus; });
  await openScratch(p2);
  return JSON.stringify(await p1.evaluate(() => window.__notes[window.__notes.length - 1]));
}, p1);
await step('20-visit leak check', async () => {
  const c = () => p1.evaluate(() => ({ own: window.__hubOwn ? window.__hubOwn.counts() : null, ws: window.__wsOpen, nodes: document.getElementsByTagName('*').length }));
  const away = await p1.evaluate(() => ['/requests/', '/mail/', '/'].find((h) => document.querySelector('.h-side a[href="' + h + '"]')));
  if (!away) throw new Error('no rail link to leave Chat by');
  const trip = async () => {
    await p1.locator(`.h-side a[href="${away}"]`).first().evaluate((a) => a.click());
    await p1.waitForTimeout(150);
    await p1.locator('.h-side a[href="/chat/"]').first().evaluate((a) => a.click());
    await p1.waitForSelector('.ch-comp textarea', { timeout: 8000 });
  };
  await trip();
  await p1.waitForTimeout(800);
  const base = await c();
  for (let i = 0; i < 20; i++) await trip();
  await p1.waitForTimeout(1500);
  const end = await c();
  const grew = base.own ? Object.keys(base.own).filter((k) => k !== 'to' && end.own[k] > base.own[k] + 1) : [];
  if (grew.length) throw new Error('leak ' + grew.join(','));
  if (end.ws > 2) throw new Error(end.ws + ' sockets open');
  if (end.nodes > base.nodes * 1.3 + 200) throw new Error('nodes ' + base.nodes + ' to ' + end.nodes);
  return JSON.stringify({ via: away, ...end });
}, p1);
await step('phone: list, conversation and back, no horizontal overflow', async () => {
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await stubAI(c3);
  const p3 = await c3.newPage();
  try {
    await p3.goto(BASE + PATH, { waitUntil: 'commit' });
    await p3.waitForSelector('.ch .ch-side .ch-row[data-id]', { timeout: 25000 });
    await p3.waitForTimeout(1200);
    await p3.screenshot({ path: `${OUT}/phone-list.png` });
    const w0 = await p3.evaluate(() => document.documentElement.scrollWidth);
    await p3.locator('.ch-side .ch-row[data-id]').first().tap();
    await p3.waitForSelector('.ch[data-view="channel"] .ch-main .ch-msg', { timeout: 10000 });
    await p3.waitForTimeout(600);
    await p3.screenshot({ path: `${OUT}/phone-conv.png` });
    const w1 = await p3.evaluate(() => document.documentElement.scrollWidth);
    if (!/[?&]c=/.test(p3.url())) throw new Error('the address has no c= for the conversation: ' + p3.url());
    let w2 = 0;
    const rep = p3.locator('.ch-main .ch-replies').last();
    if (await rep.count()) {
      await rep.scrollIntoViewIfNeeded();
      const top0 = await p3.evaluate(() => document.querySelector('.ch-main .ch-msgs').scrollTop);
      await rep.tap();
      await p3.waitForSelector('.ch[data-view="thread"] .ch-right [data-ta="thread"]', { timeout: 8000 });
      await p3.waitForTimeout(500);
      await p3.screenshot({ path: `${OUT}/phone-thread.png` });
      w2 = await p3.evaluate(() => document.documentElement.scrollWidth);
      if (!/[?&]t=\d+/.test(p3.url())) throw new Error('the address has no t= for the thread: ' + p3.url());
      await p3.goBack();
      await p3.waitForSelector('.ch[data-view="channel"]', { timeout: 5000 });
      await p3.waitForTimeout(300);
      const top1 = await p3.evaluate(() => document.querySelector('.ch-main .ch-msgs').scrollTop);
      if (Math.abs(top1 - top0) > 60) throw new Error('back from the thread, the conversation moved from ' + top0 + ' to ' + top1);
    }
    // A tap on a message opens its actions as a sheet; Back closes it.
    await p3.locator('.ch-main .ch-msg .ch-msg__text').last().tap();
    await p3.waitForSelector('.ch-msheet', { timeout: 5000 });
    await p3.waitForTimeout(400);
    await p3.screenshot({ path: `${OUT}/phone-sheet.png` });
    await p3.goBack();
    await p3.waitForSelector('.ch-msheet', { state: 'detached', timeout: 5000 });
    await p3.goBack();
    await p3.waitForSelector('.ch[data-view="list"]', { timeout: 5000 });
    if (w0 > 392 || w1 > 392 || w2 > 392) throw new Error('horizontal overflow ' + w0 + ' / ' + w1 + ' / ' + w2);
  } finally {
    await c3.close();
  }
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
