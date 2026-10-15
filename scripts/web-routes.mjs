#!/usr/bin/env node
// Who gets which route from the web app (hub setting web.routes).
// usage: node scripts/web-routes.mjs                     show the setting
//        node scripts/web-routes.mjs set /projects/ all  turn a route on for testers | admin | all
//        node scripts/web-routes.mjs off /projects/      send a route back to Astro for everyone (the rollback)
// Needs the Marketing account environment (source Q:/work/favor-hub/cfenv.sh). The middleware reads settings through a short cache,
// so a change reaches every page within about a minute.
//
// Several sessions change this setting at the same time. A plain read then write let one session's write drop a route another had
// just added (/receipts/ went missing on 2026-10-15). Each change is now a compare-and-swap: the UPDATE carries the value it read in
// its WHERE clause, so it lands only when nobody wrote in between; otherwise it reads again and reapplies its one change. Every change
// is appended to Q:/work/favor-hub/web-routes.log with the before and after values and the folder it ran from.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const LOG = 'Q:/work/favor-hub/web-routes.log';
const [cmd, route, audience] = process.argv.slice(2);
// favor-requests lives on the Marketing account. This machine's own CLOUDFLARE_* variables point at another account, so a run without
// cfenv.sh found no database and failed with a bare error (2026-10-15). Every call now runs wrangler in Git Bash after sourcing cfenv.sh
// (it reads the key from a file), so the script works from any folder and from PowerShell. The SQL travels in an environment variable,
// so no shell ever re-quotes it.
const CFENV = 'Q:/work/favor-hub/cfenv.sh';
const BASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find((p) => existsSync(p)) || 'bash';
const run = (sql) => {
  try {
    const line = `${existsSync(CFENV) ? `source ${CFENV} && ` : ''}npx wrangler d1 execute favor-requests --remote --json --command "$WEB_ROUTES_SQL"`;
    return JSON.parse(execFileSync(BASH, ['-lc', line], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WEB_ROUTES_SQL: sql, MSYS_NO_PATHCONV: '1' } }))[0];
  } catch (e) {
    const why = String(e.stderr || e.stdout || e.message).split('\n').filter((l) => /error|not found|auth/i.test(l)).slice(0, 3).join(' ') || String(e.message).split('\n')[0];
    throw new Error('could not read or write web.routes on favor-requests: ' + why);
  }
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const read = () => {
  const row = run("SELECT value FROM hub_settings WHERE key = 'web.routes'").results[0];
  return row ? String(row.value ?? '') : null;
};
const parse = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [r, a] = x.split('@'); return { r: r.endsWith('/') ? r : r + '/', a }; });
const fmt = (list) => list.map((e) => e.r + (e.a ? '@' + e.a : '')).join(',');

const now = read();
if (!cmd) { console.log('web.routes = ' + (now || '(empty: every page from Astro)')); process.exit(0); }
if (!route || !route.startsWith('/')) throw new Error('name a route, such as /projects/');
if (cmd === 'set' && !['testers', 'admin', 'all'].includes(audience)) throw new Error('audience is testers, admin or all');
if (cmd !== 'set' && cmd !== 'off') throw new Error('command is set or off');
const r = route.endsWith('/') ? route : route + '/';
const apply = (v) => {
  const list = parse(v).filter((e) => e.r !== r);
  if (cmd === 'set') list.push({ r, a: audience });
  return fmt(list);
};
const by = `web-routes.mjs ${basename(process.cwd())}`.slice(0, 80);

let before = now;
for (let attempt = 1; ; attempt++) {
  const after = apply(before);
  if (after === (before ?? '')) { console.log('web.routes = ' + (after || '(empty)') + '  (no change)'); break; }
  const res = before === null
    ? run(`INSERT OR IGNORE INTO hub_settings (key, value, updated_by, updated_at) VALUES ('web.routes', ${lit(after)}, ${lit(by)}, datetime('now'))`)
    : run(`UPDATE hub_settings SET value = ${lit(after)}, updated_by = ${lit(by)}, updated_at = datetime('now') WHERE key = 'web.routes' AND value = ${lit(before)}`);
  if (res.meta?.changes === 1) {
    appendFileSync(LOG, `${new Date().toISOString()} ${by} ${cmd} ${r}${audience ? '@' + audience : ''}\n  before ${before ?? '(none)'}\n  after  ${after}\n`);
    console.log('web.routes = ' + (read() || '(empty)'));
    break;
  }
  if (attempt >= 10) throw new Error('web.routes kept changing under this write; nothing was written. Run it again.');
  // Someone wrote between the read and the write: read again and reapply this one change on top of theirs.
  await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 1200));
  before = read();
}
