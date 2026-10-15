// The hand-off to the FavorOS web app (functions/_lib/web.ts). A page reaches the web app only when the route is built and turned on,
// the person is in the audience and has not opted out, and the request is a page load. Everyone else keeps the Astro page.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { decideWeb, inWebAudience, webCookie } = await import('../functions/_lib/web.ts');
const { WEB_ROUTES, parseWebRoutes, webServes } = await import('../shared/web.ts');
const { resetHubCache } = await import('../functions/_lib/admin/hubcache.ts').catch(() => ({}));

const user = (email, role = 'staff', via = 'google') => ({ email, name: email, picture: '', role, via, kpi: true });
const will = user('will@favorintl.org', 'admin');
const tester = user('tester@favorintl.org', 'admin');
const admin = user('someone.admin@favorintl.org', 'admin');
const staff = user('someone@favorintl.org');
const field = user('field@partner.org', 'field');

function world(settings = {}, bind = true) {
  if (typeof resetHubCache === 'function') resetHubCache();
  const d1 = memoryD1();
  d1.exec('CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)');
  for (const [k, v] of Object.entries(settings)) d1.db.prepare('INSERT INTO hub_settings VALUES (?, ?, ?, ?)').run(k, v, 't', 'now');
  return { DB: d1, ...(bind ? { WEB: { fetch: async () => new Response('web') } } : {}) };
}
const go = (env, path, u, { cookie = '', dest = 'document' } = {}) => {
  const url = new URL('https://dash.test' + path);
  return decideWeb(env, new Request(url, { headers: { 'Sec-Fetch-Dest': dest, ...(cookie ? { Cookie: cookie } : {}) } }), url, u);
};
const R = WEB_ROUTES[0];

describe('who gets the web app', () => {
  it('nothing is served while web.routes is empty', async () => {
    assert.equal((await go(world(), R, will)).kind, 'pass');
  });
  it('testers and Will get a turned-on route by default; other admins and staff do not', async () => {
    const env = world({ 'web.routes': R });
    assert.equal((await go(env, R, will)).kind, 'web');
    assert.equal((await go(env, R, tester)).kind, 'web');
    assert.equal((await go(env, R, admin)).kind, 'pass');
    assert.equal((await go(env, R, staff)).kind, 'pass');
  });
  it('audience admin and all widen the ring; field staff never get it', async () => {
    assert.equal((await go(world({ 'web.routes': R, 'web.audience': 'admin' }), R, admin)).kind, 'web');
    assert.equal((await go(world({ 'web.routes': R, 'web.audience': 'admin' }), R, staff)).kind, 'pass');
    assert.equal((await go(world({ 'web.routes': R, 'web.audience': 'all' }), R, staff)).kind, 'web');
    assert.equal(inWebAudience(field, { routes: [R], audience: 'all' }), false);
  });
  it('a script reading the page, ?classic=1, the opt-out cookie and a missing binding all keep Astro', async () => {
    const on = { 'web.routes': '*', 'web.audience': 'all' };
    assert.equal((await go(world(on), R, staff, { dest: 'empty' })).kind, 'pass');
    assert.equal((await go(world(on), R + '?classic=1', staff)).kind, 'pass');
    assert.equal((await go(world(on), R, staff, { cookie: 'hub_web_off=1' })).kind, 'pass');
    assert.equal((await go(world(on, false), R, staff)).kind, 'pass');
  });
  it('a pass tells classic pages which routes are on (for hub-swap.js)', async () => {
    const d = await go(world({ 'web.routes': '*', 'web.audience': 'all' }), '/gifts/', staff);
    assert.equal(d.kind, 'pass');
    assert.deepEqual(d.routes, WEB_ROUTES.map((r) => r));
    assert.match(webCookie(d.routes), /^hub_web=/);
    assert.match(webCookie([]), /Max-Age=0/);
  });
  it('?web=0 and ?web=1 switch the person and land on the same address', async () => {
    const off = await go(world(), '/projects/?web=0&tab=mine', staff);
    assert.equal(off.kind, 'switch');
    assert.equal(off.to, '/projects/?tab=mine');
    assert.match(off.cookie, /hub_web_off=1/);
    assert.match((await go(world(), '/?web=1', staff)).cookie, /Max-Age=0/);
  });
});

describe('the route list', () => {
  it('parses a comma list, keeps only built routes and owns sub-paths', () => {
    assert.deepEqual(parseWebRoutes(R + ', /nope/'), [R]);
    assert.deepEqual(parseWebRoutes(''), []);
    assert.equal(webServes(R + 'deeper', [R]), true);
    assert.equal(webServes('/', ['/x/']), false);
  });
});

describe('the classic pages cooperate', () => {
  it('hub-swap.js loads a web route whole and the service worker keeps /_w/ files', () => {
    const swap = readFileSync(new URL('../public/js/hub-swap.js', import.meta.url), 'utf8');
    assert.match(swap, /hub_web=/);
    assert.match(swap, /isWeb\(pathOf\(u\)\)\) \{ location\.href = u/);
    assert.match(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), /'\/_w\/'/);
  });
});

