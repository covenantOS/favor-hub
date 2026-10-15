#!/usr/bin/env node
// Who gets which route from the web app (hub setting web.routes). One read and one write per change, so agents do not undo each other.
// usage: node scripts/web-routes.mjs                     show the setting
//        node scripts/web-routes.mjs set /projects/ all  turn a route on for testers | admin | all
//        node scripts/web-routes.mjs off /projects/      send a route back to Astro for everyone (the rollback)
// Needs the Marketing account environment (source Q:/work/favor-hub/cfenv.sh). The middleware reads settings through a short cache,
// so a change reaches every page within about a minute.
import { execSync } from 'node:child_process';

const [cmd, route, audience] = process.argv.slice(2);
const q = (sql) => JSON.parse(execSync(`npx wrangler d1 execute favor-requests --remote --json --command ${JSON.stringify(sql)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
const read = () => (q("SELECT value FROM hub_settings WHERE key = 'web.routes'")[0] || {}).value || '';
const parse = (v) => v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [r, a] = x.split('@'); return { r: r.endsWith('/') ? r : r + '/', a }; });
const fmt = (list) => list.map((e) => e.r + (e.a ? '@' + e.a : '')).join(',');
const now = read();
if (!cmd) { console.log('web.routes = ' + (now || '(empty: every page from Astro)')); process.exit(0); }
if (!route || !route.startsWith('/')) throw new Error('name a route, such as /projects/');
const r = route.endsWith('/') ? route : route + '/';
let list = parse(now).filter((e) => e.r !== r);
if (cmd === 'set') {
  if (!['testers', 'admin', 'all'].includes(audience)) throw new Error('audience is testers, admin or all');
  list.push({ r, a: audience });
} else if (cmd !== 'off') throw new Error('command is set or off');
const value = fmt(list).replace(/'/g, "''");
q(`INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('web.routes', '${value}', 'web-routes.mjs', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
console.log('web.routes = ' + (read() || '(empty)'));
