#!/usr/bin/env node
// Reads FavorOS pages live as the FavorOS Tester and says which front answered each one (X-Hub-Front: web, app2, or the Astro page).
// usage: HUB_AGENT_KEY=... node scripts/live-front.mjs /web-check/=web /gifts/=classic
// Exits 1 when a page answers from the wrong front, is not 200, or a web page has no rail in its HTML.
const BASE = process.env.HUB_ORIGIN || 'https://dash.favorintl.org';
const key = process.env.HUB_AGENT_KEY;
if (!key) throw new Error('HUB_AGENT_KEY is not set');
const s = await fetch(BASE + '/api/admin/test-session', { method: 'POST', headers: { Authorization: 'Bearer ' + key } });
const cookie = (s.headers.get('set-cookie') || '').match(/favor_hub_session=[^;]+/)?.[0];
if (!cookie) throw new Error('no tester session: ' + s.status);
let bad = 0;
const list = process.argv.slice(2).length ? process.argv.slice(2) : (process.env.LIVE_CHECKS || '').split(' ').filter(Boolean);
for (const arg of list) {
  // Git Bash rewrites an argument that starts with / into a Windows path (C:/Program Files/Git/gifts/) unless MSYS_NO_PATHCONV=1 is set;
  // take the part after Git back, so the check reads https://dash.favorintl.org/gifts/ either way.
  const [raw, want = 'web'] = arg.split('=');
  const path = raw.replace(/^[A-Za-z]:[\\/].*?[\\/]Git(?=[\\/])/, '').replace(/\\/g, '/');
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: cookie + '; hub_gc=1', 'Sec-Fetch-Dest': 'document', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
  });
  const html = await res.text();
  const front = res.headers.get('x-hub-front') || 'classic';
  const rail = (html.match(/h-area__link/g) || []).length;
  const ok = res.status === 200 && front === want && (want !== 'web' || rail > 0);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'BAD '} ${path} ${res.status} front=${front} rail-links=${rail} bytes=${html.length}`);
}
process.exit(bad ? 1 : 0);
