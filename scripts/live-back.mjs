#!/usr/bin/env node
// Opens web routes live as the FavorOS Tester, taps to another page and presses Back (and taps from that page back in), and fails when
// the page left anything behind:
// streamed parts still hidden in the page (div id="S:0"), an id that appears twice, a second menu or top bar, or a page that has
// stopped drawing (requestAnimationFrame never runs, which is what keeps React's streamed swaps from finishing).
// It also loads each route once with requestAnimationFrame switched off, which is the stall that left the parts behind: the streamed
// swaps must finish on a timer (web/src/routes/__root.tsx presets $RT) whatever the frames do.
// The ship scripts run it after live-console on every --check route marked =web; a finding is reported with the ship.
// usage: HUB_AGENT_KEY=... node scripts/live-back.mjs /gifts/ /projects/ [--via /changelog/,/gifts/letters/]
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = process.env.HUB_ORIGIN || 'https://dash.favorintl.org';
const key = process.env.HUB_AGENT_KEY;
if (!key) throw new Error('HUB_AGENT_KEY is not set');
const args = process.argv.slice(2);
const vi = args.indexOf('--via');
// One web page and one classic page: Back from a classic page is the case that left the leftovers.
const via = (vi >= 0 ? args[vi + 1] : '/changelog/,/gifts/letters/').split(',');
const paths = args.filter((a, i) => a.startsWith('/') && !(vi >= 0 && i === vi + 1)).concat(vi < 0 ? (process.env.LIVE_BACK || '').split(' ').filter((a) => a.startsWith('/')) : []);

function chrome() {
  const root = homedir() + '/AppData/Local/ms-playwright';
  const dir = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : null;
  const exe = dir ? `${root}/${dir}/chrome-win64/chrome.exe` : '';
  return existsSync(exe) ? exe : undefined;
}

const INVENTORY = () => {
  const ids = {};
  for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
  const n = (s) => document.querySelectorAll(s).length;
  return new Promise((resolve) => {
    let drawn = false;
    requestAnimationFrame(() => { drawn = true; });
    setTimeout(() => resolve({
      dupIds: Object.entries(ids).filter(([, v]) => v > 1).map(([k, v]) => `${k}x${v}`),
      streamed: n("[id^='S:'], [id^='B:']"),
      side: n('.h-side'),
      top: n('.h-top'),
      content: n('#h-content'),
      drawn,
    }), 500);
  });
};
// A tap is a click on a link, which is how a person moves and the only way a view transition starts (page.goto never starts one).
const tap = (pg, href) => pg.evaluate((h) => { const a = document.createElement('a'); a.href = h; document.body.appendChild(a); a.click(); }, href);
const NO_FRAMES = 'window.requestAnimationFrame = function () { return 0; };';
const settled = () => !!document.querySelector('.h-top') && !document.querySelector('.h-top--wait') && !!document.querySelector('.h-top__right .h-acct');

const browser = await chromium.launch({ executablePath: chrome() });
let bad = 0;
try {
  for (const path of paths) {
    {
      // Frames off: the page must still finish its streamed parts.
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const r = await ctx.request.post(BASE + '/api/admin/test-session', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok()) throw new Error('no tester session: ' + r.status());
      await ctx.addInitScript(NO_FRAMES);
      const pg = await ctx.newPage();
      let line = '';
      try {
        await pg.goto(BASE + path, { waitUntil: 'load', timeout: 90000 });
        await pg.waitForFunction(settled, null, { timeout: 60000 }).catch(() => undefined);
        await pg.waitForTimeout(2500);
        const stuck = await pg.evaluate(INVENTORY);
        const found = [];
        if (stuck.streamed) found.push(`${stuck.streamed} streamed parts never revealed with frames off`);
        if (stuck.dupIds.length) found.push(`ids twice with frames off ${stuck.dupIds.slice(0, 5).join(' ')}`);
        if (stuck.side !== 1 || stuck.top !== 1) found.push(`${stuck.side} menus and ${stuck.top} top bars with frames off`);
        line = found.length ? `DUPLICATES ${path} with frames off\n   ${found.join('\n   ')}` : `clean      ${path} with frames off`;
        if (found.length) bad++;
      } catch (e) {
        bad++;
        line = `FAILED     ${path} with frames off: ${String(e.message).slice(0, 160)}`;
      }
      console.log(line);
      await ctx.close();
    }
    for (const to of via) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const r = await ctx.request.post(BASE + '/api/admin/test-session', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok()) throw new Error('no tester session: ' + r.status());
      const pg = await ctx.newPage();
      const wait = async () => { await pg.waitForFunction(settled, null, { timeout: 60000 }).catch(() => undefined); await pg.waitForTimeout(2500); };
      let line = '';
      try {
        await pg.goto(BASE + path, { waitUntil: 'load', timeout: 90000 });
        await wait();
        const fresh = await pg.evaluate(INVENTORY);
        const found = [];
        for (let round = 1; round <= 2; round++) {
          await tap(pg, to);
          await pg.waitForURL('**' + to, { timeout: 60000 });
          await pg.waitForTimeout(2500);
          await pg.goBack({ waitUntil: 'load', timeout: 90000 });
          await wait();
          const back = await pg.evaluate(INVENTORY);
          if (!back.drawn) found.push(`round ${round}: the page stopped drawing`);
          if (back.dupIds.length) found.push(`round ${round}: ids twice ${back.dupIds.slice(0, 5).join(' ')}`);
          if (back.streamed > fresh.streamed) found.push(`round ${round}: ${back.streamed} streamed parts left in the page (${fresh.streamed} on a fresh load)`);
          for (const k of ['side', 'top', 'content']) if (back[k] !== fresh[k]) found.push(`round ${round}: ${back[k]} x .${k} (${fresh[k]} on a fresh load)`);
        }
        // And the way in from the other page: a tap from it to this route.
        await pg.goto(BASE + to, { waitUntil: 'load', timeout: 90000 });
        await pg.waitForTimeout(2500);
        await tap(pg, path);
        await pg.waitForURL('**' + path, { timeout: 60000 });
        await wait();
        const into = await pg.evaluate(INVENTORY);
        if (!into.drawn) found.push('tap in: the page stopped drawing');
        if (into.dupIds.length) found.push(`tap in: ids twice ${into.dupIds.slice(0, 5).join(' ')}`);
        if (into.streamed > fresh.streamed) found.push(`tap in: ${into.streamed} streamed parts left in the page`);
        line = found.length ? `DUPLICATES ${path} via ${to}\n   ${[...new Set(found)].join('\n   ')}` : `clean      ${path} via ${to} (2 rounds back, 1 tap in)`;
        if (found.length) bad++;
      } catch (e) {
        bad++;
        line = `FAILED     ${path} via ${to}: ${String(e.message).slice(0, 160)}`;
      }
      console.log(line);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
