#!/usr/bin/env node
// Screenshots for the changelog (/changelog). Signs in as the FavorOS Tester (test session, agent key), opens each area's page
// on the live site at desktop and phone size, blurs every piece of data on the page (names, amounts, rows, messages) so only the
// layout, headings and buttons read, and writes compressed WebP to public/changelog/now/<area>-desk.webp and -phone.webp
// (each under about 150 KB). src/data/changelog-shots.json lists them; an entry with no picture of its own shows its area's
// picture labeled "Today's view".
//
//   node scripts/changelog-shots.mjs                 every area
//   node scripts/changelog-shots.mjs meetings chat   only these areas
//   HUB_URL=https://<preview>.favor-hub.pages.dev node scripts/changelog-shots.mjs
//
// The agent key comes from AGENT_API_KEY or ~/.claude/secrets/favor-hub-agent-key.txt. Needs playwright-core and Edge.
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.HUB_URL || 'https://dash.favorintl.org').replace(/\/$/, '');
const OUT = join(ROOT, 'public/changelog/now');
const MAP = join(ROOT, 'src/data/changelog-shots.json');
const MAX = 150 * 1024;

/** The page that shows each changelog area. */
export const AREA_URL = {
  today: '/', partners: '/work/', 'work-center': '/work/', requests: '/requests/', projects: '/projects/', expenses: '/expenses/new/', staff: '/expenses/new/',
  receipts: '/receipts/', gifts: '/gift-entry/', statements: '/statements/', evaluations: '/evaluations/', learn: '/learn/',
  onboarding: '/onboarding/', foundations: '/foundations/', meetings: '/meet/', clips: '/clips/', chat: '/chat/', mail: '/mail/',
  brain: '/brain/', reporting: '/highlights/', lists: '/lists/', admin: '/admin/', help: '/help/', phone: '/', everywhere: '/',
};

function agentKey() {
  if (process.env.AGENT_API_KEY) return process.env.AGENT_API_KEY.trim();
  const f = join(homedir(), '.claude/secrets/favor-hub-agent-key.txt');
  if (!existsSync(f)) throw new Error('No agent key: set AGENT_API_KEY or put it in ~/.claude/secrets/favor-hub-agent-key.txt');
  return readFileSync(f, 'utf8').trim();
}

// Blurs everything that holds data. Headings, labels, tabs, buttons, inputs and the menu stay sharp.
const PRIVACY = () => {
  // Kept sharp: the frame, page titles, tabs, buttons, form labels. Any text with a digit is blurred wherever it sits.
  const keep = 'h1,[role=tab],.h-tab,button,select,input,textarea,label,th,summary,legend,kbd,.h-rel,.h-btn,.cl-t,.cl-a';
  const frame = '.h-top,.h-side,.h-phonebar,.h-tabs';
  if (!document.getElementById('cs-blur-css')) {
    const css = document.createElement('style');
    css.id = 'cs-blur-css';
    css.textContent = '.cs-blur{filter:blur(6px)!important}' +
      '[class*=tour],[id*=tour],.h-toast,.rp-toast,.wc-toast,[role=dialog]:not(.h-side){display:none!important}';
    document.head.appendChild(css);
  }
  const main = document.querySelector('.h-main') || document.body;
  const pass = () => {
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue || '';
      if (!t.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest(frame)) continue;
      const person = /@/.test(t) || el.closest('[class*=name],[class*=who],[class*=person],[class*=dm],[class*=member],[class*=owner],[class*=author],[class*=people],[class*=sender],[class*=from]');
      // Anything inside a row, card, list or message holds data: blurred even when it is a heading or a button.
      const inData = el.closest('li,article,tr,td,a:not(.h-btn),[class*=card],[class*=row],[class*=item],[class*=list],[class*=moment],[class*=msg],[class*=thread],[class*=tile],[class*=event],[class*=col],[class*=hist],[class*=recent],[class*=side],[class*=chats],[class*=rail],[class*=conv],aside,nav');
      const sharp = el.closest(keep) || el.closest('h2,h3,h4');
      if (el.closest('h1,[role=tab],.h-tab') && !/\d/.test(t)) continue;
      if (!person && !inData && sharp && !/\d/.test(t) && t.length < 60) continue;
      el.classList.add('cs-blur');
    }
    main.querySelectorAll('img, video, canvas, svg image, [class*=avatar], [class*=-av]').forEach((el) => { if (!el.closest(frame)) el.classList.add('cs-blur'); });
  };
  pass();
  new MutationObserver(pass).observe(main, { childList: true, subtree: true, characterData: true });
};

async function toWebp(png, width) {
  for (const q of [72, 62, 52, 42, 34]) {
    const buf = await sharp(png).resize({ width, withoutEnlargement: true }).webp({ quality: q, effort: 5 }).toBuffer();
    if (buf.length <= MAX) return buf;
  }
  return sharp(png).resize({ width: Math.round(width * 0.75) }).webp({ quality: 34 }).toBuffer();
}

/** Signs in as the tester and returns a browser context. */
export async function testerContext(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: opts.scale || 1, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
  const r = await ctx.request.post(BASE + '/api/admin/test-session', { headers: { 'X-Agent-Key': agentKey(), 'Content-Type': 'application/json' }, data: { who: opts.who || '' } });
  if (!r.ok()) throw new Error('Test session refused: ' + r.status());
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('favor.hub.sound', 'off');
      localStorage.setItem('favor.hub.tours.pending', '0');
      localStorage.setItem('favor.hub.tours.auto', 'off');
      localStorage.setItem('favor.hub.welcome.v1', '1');
    } catch (e) { /* storage refused */ }
  });
  return ctx;
}

/** Shoots the given areas at desktop and phone size. Returns { area: { desk, phone } } of public paths. */
export async function shoot(areas, log = console.log) {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const out = {};
  try {
    for (const size of ['desk', 'phone']) {
      const phone = size === 'phone';
      const ctx = await testerContext(browser, phone ? { viewport: { width: 390, height: 780 }, scale: 2, mobile: true } : { viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      for (const area of areas) {
        const url = AREA_URL[area];
        if (!url) continue;
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1800);
        if (/login|signin/.test(page.url())) throw new Error('Signed out at ' + url);
        await page.keyboard.press('Escape').catch(() => {});
        if (area === 'everywhere' && !phone) await page.evaluate(() => document.documentElement.classList.add('nav-wide'));
        await page.evaluate(PRIVACY);
        await page.waitForTimeout(1200);
        let png;
        if (phone) png = await page.screenshot({ type: 'png' });
        else {
          const box = area === 'everywhere' ? null : await page.locator('.h-main').first().boundingBox().catch(() => null);
          png = await page.screenshot({ type: 'png', clip: box ? { x: box.x, y: box.y, width: Math.min(box.width, 1440 - box.x), height: Math.min(900 - box.y, 820) } : undefined });
        }
        const webp = await toWebp(png, phone ? 600 : 1200);
        const name = `${area}-${size}.webp`;
        writeFileSync(join(OUT, name), webp);
        (out[area] ||= {})[phone ? 'phone' : 'desk'] = `/changelog/now/${name}`;
        log(`${name} ${Math.round(webp.length / 1024)} KB`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** Adds shot paths to src/data/changelog-shots.json. */
export function saveMap(found) {
  const cur = existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : {};
  for (const [k, v] of Object.entries(found)) cur[k] = { ...(cur[k] || {}), ...v };
  writeFileSync(MAP, JSON.stringify(cur, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const areas = want.length ? want : Object.keys(AREA_URL);
  saveMap(await shoot(areas));
}
