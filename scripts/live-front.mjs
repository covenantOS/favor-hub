#!/usr/bin/env node
// Reads FavorOS pages live as the FavorOS Tester and says which front answered each one (X-Hub-Front: web, app2, or the Astro page).
// usage: HUB_AGENT_KEY=... node scripts/live-front.mjs /web-check/=web /gifts/=classic
// Exits 1 when a page answers from the wrong front, is not 200, or a web page has no rail in its HTML.
import { execSync } from 'node:child_process';
const BASE = process.env.HUB_ORIGIN || 'https://dash.favorintl.org';
// Copies of FULL_LOAD (shared/app2.ts), WEB_EXACT_ROUTES, WEB_WHOLE_PAGE_ROUTES and WEB_OWN_SWITCH (shared/web.ts); tests/web-route.test.mjs checks they match.
const FULL_LOAD = ['/dashboard/', '/meet/room/', '/meet/g/', '/clips/rec/', '/login/', '/help/videos/'];
const SOLO = ['/clips/rec/', '/dashboard/'];
const EXACT = ['/gifts/', '/brain/', '/admin/', '/meet/'];
const WHOLE = ['/meet/room/'];
const OWN_SWITCH = ['/gifts/other/', '/moves/'];
const key = process.env.HUB_AGENT_KEY;
if (!key) throw new Error('HUB_AGENT_KEY is not set');
const s = await fetch(BASE + '/api/admin/test-session', { method: 'POST', headers: { Authorization: 'Bearer ' + key } });
const cookie = (s.headers.get('set-cookie') || '').match(/favor_hub_session=[^;]+/)?.[0];
if (!cookie) throw new Error('no tester session: ' + s.status);
// A check is written when its branch is queued, and the route's web.routes entry often changes after that (a helper turns a route on for
// testers once it ships, or a check from an older entry still says classic). The tester gets every listed route, so the setting as it
// stands now says which front is right. When the setting can be read, a check that disagrees with it is judged by the setting and
// marked STALE; a page that answers against the setting is BAD.
const listed = readListed();
let bad = 0;
const list = process.argv.slice(2).length ? process.argv.slice(2) : (process.env.LIVE_CHECKS || '').split(' ').filter(Boolean);
for (const arg of list) {
  // Git Bash rewrites an argument that starts with / into a Windows path (C:/Program Files/Git/gifts/) unless MSYS_NO_PATHCONV=1 is set;
  // take the part after Git back, so the check reads https://dash.favorintl.org/gifts/ either way.
  const [raw, asked = 'web'] = arg.split('=');
  const path = raw.replace(/^[A-Za-z]:[\\/].*?[\\/]Git(?=[\\/])/, '').replace(/\\/g, '/');
  const bySetting = listed && !OWN_SWITCH.some((r) => path.startsWith(r)) ? (serves(path, listed) ? 'web' : 'classic') : null;
  const want = bySetting || asked;
  const stale = bySetting && bySetting !== asked ? ` (STALE check said ${asked}; web.routes says ${bySetting})` : '';
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: cookie + '; hub_gc=1', 'Sec-Fetch-Dest': 'document', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
  });
  const html = await res.text();
  const front = res.headers.get('x-hub-front') || 'classic';
  const rail = (html.match(/h-area__link/g) || []).length;
  const ok = res.status === 200 && front === want && (want !== 'web' || rail > 0);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'BAD '} ${path} ${res.status} front=${front} rail-links=${rail} bytes=${html.length}${stale}`);
}
process.exit(bad ? 1 : 0);

// The routes in web.routes (audience left off: the tester gets all of them), or null when the setting cannot be read here.
function readListed() {
  try {
    const out = execSync(`npx wrangler d1 execute favor-requests --remote --json --command "SELECT value FROM hub_settings WHERE key = 'web.routes'"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
    const v = String(JSON.parse(out)[0].results[0]?.value || '').trim();
    if (v === '*') return null;
    return v.split(',').map((x) => x.split('@')[0].trim()).filter(Boolean).map((r) => (r.endsWith('/') ? r : r + '/'));
  } catch {
    return null;
  }
}

// Same matching as webServes in shared/web.ts: / and the exact routes match only themselves, the rest match everything under them,
// and the help videos under /help/videos/ always load from Astro.
function serves(path, routes) {
  const p = path.endsWith('/') ? path : path + '/';
  if (FULL_LOAD.some((f) => !SOLO.includes(f) && !WHOLE.includes(f) && (p === f || p.startsWith(f)))) return false;
  return routes.some((r) => (r === '/' || EXACT.includes(r) ? p === r : p.startsWith(r)));
}
