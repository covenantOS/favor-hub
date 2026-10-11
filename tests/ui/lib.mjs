// Shared pieces for the lintapple sweep: devices, a signed-in context, arriving by clicking from Today, and a ready check.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');

export const PROFILES = {
  phone: { viewport: { width: 440, height: 893 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  ipad: { viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
};

export const BASE = (process.env.HUB_URL || 'https://dash.favorintl.org').replace(/\/$/, '');

// The saved admin cookie lives outside the repo. HUB_COOKIES points at it; tests/ui/.cookies.json (gitignored) is the fallback.
export async function loadCookies() {
  const path = process.env.HUB_COOKIES || join(HERE, '.cookies.json');
  if (!existsSync(path)) throw new Error('No cookie file. Set HUB_COOKIES to the saved admin cookie JSON (or put it at tests/ui/.cookies.json, which git ignores).');
  const host = new URL(BASE).hostname;
  const secure = BASE.startsWith('https');
  return JSON.parse(await readFile(path, 'utf8')).map((c) => ({ ...c, domain: host, secure: secure && c.secure }));
}

export async function launch() {
  try { return await chromium.launch({ channel: 'msedge' }); } catch { return chromium.launch(); }
}

// Every write method is stopped at the network, so the sweep cannot change data even if a page fires one on load.
export async function newSession(browser, name, cookies, blocked) {
  const context = await browser.newContext({ ...PROFILES[name], colorScheme: 'light', serviceWorkers: 'block' });
  await context.addCookies(cookies);
  await context.route('**/*', (route) => {
    const req = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.continue();
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  const page = await context.newPage();
  return { context, page };
}

export async function ready(page, settle = 1500) {
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settle);
  // A skeleton still on screen means the page is not done.
  await page.waitForFunction(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    return ![...document.querySelectorAll('[aria-busy="true"], [class*="skel"]')].some(vis);
  }, null, { timeout: 8000 }).catch(() => {});
}

export async function openToday(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  const url = page.url();
  if (/sign-?in|login|accounts\.google/i.test(url) || await page.locator('form[action*="login"], #login-form').count()) {
    throw new Error('Signed out: the cookie is expired or not accepted at ' + BASE);
  }
}

const visible = (loc) => loc.filter({ visible: true });

// Click the first visible match; true when something was clicked.
export async function clickFirst(page, selector) {
  const loc = visible(page.locator(selector));
  if (!(await loc.count())) return false;
  await loc.first().click({ timeout: 5000 });
  return true;
}

// Reach a nav page the way a person does: area on the phone bar (or the More sheet, or the rail), then the tab row.
export async function gotoByClicking(page, area, pageId) {
  const here = () => page.evaluate(() => document.body.dataset.nav || '');
  if ((await here()) === pageId) return 'already';
  const areaSel = `[data-area-link="${area.id}"]`;
  let how = 'area';
  if (!(await clickFirst(page, `#h-bar ${areaSel}`)) && !(await clickFirst(page, `.h-side ${areaSel}:not(.h-area--pop *)`))) {
    // Phone: the area sits behind More. Desktop: the full menu may be collapsed, so try the page link itself.
    if (await clickFirst(page, '#h-bar-more')) {
      await page.waitForTimeout(500);
      how = 'more';
      if (!(await clickFirst(page, `.h-side [data-nav-id="${pageId}"]`)) && !(await clickFirst(page, `.h-side ${areaSel}`))) throw new Error('not reachable from More');
    } else if (!(await clickFirst(page, `.h-side [data-nav-id="${pageId}"]`))) throw new Error('not reachable from the menu');
  }
  await page.waitForTimeout(900);
  if ((await here()) !== pageId) {
    const tab = visible(page.locator(`.h-tab[data-nav-id="${pageId}"]`));
    if (await tab.count()) { await tab.first().click({ timeout: 5000 }); how += '+tab'; }
    else if (await clickFirst(page, `.h-side [data-nav-id="${pageId}"]`)) how += '+menu';
    else throw new Error('page link not found after opening the area');
  }
  await ready(page);
  return how;
}
