#!/usr/bin/env node
// Opens web routes live as the FavorOS Tester in a real browser and reports script errors, React hydration errors (#418, #419) above
// all, the ones a fetch check cannot see. The ship scripts run it after the live front check on every --check route marked =web; a
// finding is reported with the ship and does not undo it.
// usage: HUB_AGENT_KEY=... node scripts/live-console.mjs /brain/ /work/ [--loads 3]
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = process.env.HUB_ORIGIN || 'https://dash.favorintl.org';
const key = process.env.HUB_AGENT_KEY;
if (!key) throw new Error('HUB_AGENT_KEY is not set');
const args = process.argv.slice(2);
const li = args.indexOf('--loads');
const loads = li >= 0 ? Number(args[li + 1]) : 3;
const given = args.filter((a) => a.startsWith('/'));
const paths = (given.length ? given : (process.env.LIVE_CONSOLE || '').split(' ')).filter((a) => a && a.startsWith('/'));

// The Chromium the hub's QA scripts use.
function chrome() {
  const root = homedir() + '/AppData/Local/ms-playwright';
  const dir = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : null;
  const exe = dir ? `${root}/${dir}/chrome-win64/chrome.exe` : '';
  return existsSync(exe) ? exe : undefined;
}

const browser = await chromium.launch({ executablePath: chrome() });
let bad = 0;
try {
  for (const path of paths) {
    const errs = new Map();
    for (let i = 0; i < loads; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const r = await ctx.request.post(BASE + '/api/admin/test-session', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok()) throw new Error('no tester session: ' + r.status());
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => { const m = String(e.message || e).slice(0, 160); errs.set(m, (errs.get(m) || 0) + 1); });
      await pg.goto(BASE + path, { waitUntil: 'load', timeout: 90000 }).catch((e) => errs.set('load failed: ' + String(e.message).slice(0, 120), 1));
      await pg.waitForTimeout(4000);
      await ctx.close();
    }
    if (errs.size) bad++;
    console.log(`${errs.size ? 'ERRORS' : 'clean '} ${path} (${loads} loads)` + [...errs].map(([m, n]) => `\n   ${n}x ${m}`).join(''));
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
