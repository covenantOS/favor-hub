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
const go = (env, path, u, { cookie = '', dest = 'document', purpose = '' } = {}) => {
  const url = new URL('https://dash.test' + path);
  return decideWeb(env, new Request(url, { headers: { 'Sec-Fetch-Dest': dest, ...(purpose ? { 'Sec-Purpose': purpose } : {}), ...(cookie ? { Cookie: cookie } : {}) } }), url, u);
};
const R = WEB_ROUTES[0];

describe('who gets the web app', () => {
  it('nothing is served while web.routes is empty', async () => {
    assert.equal((await go(world(), R, will)).kind, 'pass');
  });
  it('a route can carry its own audience (/x/@all) over the default', async () => {
    const env = world({ 'web.routes': R + '@all' });
    assert.equal((await go(env, R, staff)).kind, 'web');
    const adm = world({ 'web.routes': R + '@admin', 'web.audience': 'all' });
    assert.equal((await go(adm, R, staff)).kind, 'pass');
    assert.equal((await go(adm, R, admin)).kind, 'web');
    const { parseWebEntries, formatWebEntries } = await import('../shared/web.ts');
    assert.deepEqual(parseWebEntries(R + '@all, /nope/@all'), [{ route: R, audience: 'all' }]);
    assert.equal(formatWebEntries(parseWebEntries(R + '@admin')), R + '@admin');
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
    // The browser's read-ahead of a linked page is a page load: answering it with Astro left a classic copy for Back and Forward.
    assert.equal((await go(world(on), R, staff, { dest: 'empty', purpose: 'prefetch' })).kind, 'web');
    assert.equal((await go(world(on), R + '?classic=1', staff)).kind, 'pass');
    assert.equal((await go(world(on), R, staff, { cookie: 'hub_web_off=1' })).kind, 'pass');
    assert.equal((await go(world(on, false), R, staff)).kind, 'pass');
  });
  it('a pass tells classic pages which routes are on (for hub-swap.js)', async () => {
    const d = await go(world({ 'web.routes': '*', 'web.audience': 'all' }), '/gifts/letters/', staff);
    assert.equal(d.kind, 'pass');
    assert.deepEqual(d.routes, WEB_ROUTES.filter((r) => r !== '/gifts/other/'));
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
    // /gifts/ is the overview only; the letters and declines pages are still Astro.
    assert.equal(webServes('/gifts/', ['/gifts/']), true);
    assert.equal(webServes('/gifts/letters/', ['/gifts/']), false);
    assert.equal(webServes('/gifts/declines/', ['/gifts/']), false);
    assert.equal(webServes('/gifts/recurring/', ['/gifts/recurring/']), true);
    assert.equal(decodeURIComponent(webCookie(['/gifts/', '/projects/'])).includes('/gifts/$~/projects/'), true);
  });
});

describe('Help owns the paths under /help/ except the videos', () => {
  it('serves the articles, the changelog, feedback and welcome, and leaves /help/videos/ on Astro', async () => {
    const env = world({ 'web.routes': '/help/@all,/changelog/@all,/feedback/@all,/welcome/@all' });
    for (const p of ['/help/', '/help/getting-started/', '/changelog/', '/feedback/', '/welcome/']) assert.equal((await go(env, p, staff)).kind, 'web', p);
    for (const p of ['/help/videos/', '/help/videos/favoros-walk-through/']) assert.equal((await go(env, p, staff)).kind, 'pass', p);
    assert.equal(webServes('/help/videos/', ['/help/']), false);
    assert.equal(webServes('/help/connect-your-ai/', ['/help/']), true);
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

describe('a page with no Astro twin (Churches)', () => {
  const C = '/churches/';
  it('goes to every staff sign-in once it is turned on, whatever the audience or opt-out', async () => {
    const env = world({ 'web.routes': C });
    assert.equal((await go(env, C, staff)).kind, 'web');
    assert.equal((await go(env, C, staff, { cookie: 'hub_web_off=1' })).kind, 'web');
    assert.equal((await go(env, C, admin)).kind, 'web');
  });
  it('stays off until an admin lists it, never reaches field staff, and ignores script reads', async () => {
    assert.equal((await go(world(), C, staff)).kind, 'pass');
    assert.equal((await go(world({ 'web.routes': '/web-check/' }), C, staff)).kind, 'pass');
    assert.equal((await go(world({ 'web.routes': C }), C, field)).kind, 'pass');
    assert.equal((await go(world({ 'web.routes': C }), C, staff, { dest: 'empty' })).kind, 'pass');
  });
});

describe('routes only the web app has', () => {
  it('reaches staff whatever the audience, once listed', async () => {
    const env = world({ 'web.routes': '/data-care/', 'web.audience': 'testers' });
    assert.equal((await go(env, '/data-care/', staff)).kind, 'web');
    assert.equal((await go(env, '/data-care/', admin)).kind, 'web');
    assert.equal((await go(env, '/data-care/', field)).kind, 'pass');
    assert.equal((await go(env, '/data-care/', null)).kind, 'pass');
  });
  it('stays off when the route is not listed', async () => {
    const env = world({ 'web.routes': '/web-check/', 'web.audience': 'testers' });
    assert.equal((await go(env, '/data-care/', staff)).kind, 'pass');
  });
  it('does not open the other web routes to the audience', async () => {
    const env = world({ 'web.routes': '/web-check/,/data-care/', 'web.audience': 'testers' });
    assert.equal((await go(env, '/web-check/', staff)).kind, 'pass');
  });
});

describe('Other gifts carries its own switch', () => {
  const OG = '/gifts/other/';
  it('is not turned on by web.routes, not even by *', async () => {
    assert.deepEqual(parseWebRoutes('*').includes(OG), false);
    assert.deepEqual(parseWebRoutes(OG), []);
  });
  it('is served to Will and the testers with every switch empty, and to nobody else while gifts.other is off', async () => {
    const env = world();
    assert.equal((await go(env, OG, will)).kind, 'web');
    assert.equal((await go(env, OG, tester)).kind, 'web');
    assert.equal((await go(env, OG, admin)).kind, 'pass');
    assert.equal((await go(env, OG, staff)).kind, 'pass');
  });
  it('gifts.other = admins serves admins; field staff and ?classic=1 and a script read keep Astro', async () => {
    const env = world({ 'gifts.other': 'admins' });
    assert.equal((await go(env, OG, admin)).kind, 'web');
    assert.equal((await go(env, OG, staff)).kind, 'pass');
    assert.equal((await go(env, OG, field)).kind, 'pass');
    assert.equal((await go(env, OG + '?classic=1', admin)).kind, 'pass');
    assert.equal((await go(env, OG, admin, { dest: 'empty' })).kind, 'pass');
    assert.equal((await go(env, OG, admin, { cookie: 'hub_web_off=1' })).kind, 'pass');
  });
  it('tells classic pages the route is theirs to load whole', async () => {
    const d = await go(world({ 'gifts.other': 'admins' }), '/gifts/', admin);
    assert.deepEqual(d.routes, [OG]);
  });
});

describe('the hub_web cookie a web page carries', () => {
  const cookieRoutes = (d) => decodeURIComponent(webCookie(d.routes).split(';')[0].slice('hub_web='.length)).split('~').map((r) => r.replace(/\$$/, ''));
  it('a route held to testers is in a tester cookie and not in a staff cookie, on a page the web app serves', async () => {
    const env = world({ 'web.routes': '/brain/@testers,/projects/@all' });
    const t = await go(env, '/projects/', tester);
    const s = await go(env, '/projects/', staff);
    assert.equal(t.kind, 'web');
    assert.equal(s.kind, 'web');
    assert.ok(cookieRoutes(t).includes('/brain/') && cookieRoutes(t).includes('/projects/'));
    assert.ok(cookieRoutes(s).includes('/projects/'));
    assert.ok(!cookieRoutes(s).includes('/brain/'), 'staff are not given a testers-only route');
  });
  it('turning a route off drops it from the next answer', async () => {
    const s = await go(world({ 'web.routes': '/projects/@all' }), '/projects/', staff);
    assert.ok(cookieRoutes(s).includes('/projects/'));
    const off = await go(world({ 'web.routes': '/brain/@testers' }), '/', staff);
    assert.ok(!cookieRoutes(off).includes('/projects/'));
  });
});

describe('a test account set to staff', () => {
  const cookieRoutes = (d) => decodeURIComponent(webCookie(d.routes).split(';')[0].slice('hub_web='.length)).split('~').map((r) => r.replace(/\$$/, ''));
  it('gets the routes held to testers and all, and the classic page on a route held to admins', async () => {
    const tester2staff = user('tester2@favorintl.org', 'staff');
    const env = world({ 'web.routes': '/brain/@testers,/projects/@all,/partners/@admin' });
    const d = await go(env, '/projects/', tester2staff);
    assert.equal(d.kind, 'web');
    assert.ok(cookieRoutes(d).includes('/brain/') && cookieRoutes(d).includes('/projects/'));
    assert.ok(!cookieRoutes(d).includes('/partners/'), 'a route held to admins is not in the cookie of a test account set to staff');
    assert.equal((await go(env, '/partners/', tester2staff)).kind, 'pass');
    assert.equal((await go(env, '/partners/', user('tester2@favorintl.org', 'admin'))).kind, 'web');
  });
});

describe('live-front.mjs judges a check by web.routes as it stands', () => {
  it('keeps its copies of the full-load, exact and own-switch lists the same as shared/', async () => {
    const { FULL_LOAD } = await import('../shared/app2.ts');
    const { WEB_EXACT_ROUTES, WEB_OWN_SWITCH } = await import('../shared/web.ts');
    const src = readFileSync(new URL('../scripts/live-front.mjs', import.meta.url), 'utf8');
    const copy = (name) => JSON.parse(src.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
    assert.deepEqual(copy('FULL_LOAD'), [...FULL_LOAD]);
    assert.deepEqual(copy('EXACT'), [...WEB_EXACT_ROUTES]);
    assert.deepEqual(copy('OWN_SWITCH'), Object.keys(WEB_OWN_SWITCH));
  });
});
