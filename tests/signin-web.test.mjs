// Sign in (/login/) and Connect Google (/connect/) on the web app. /login/ is open to visitors, so its entry in web.routes decides
// (functions/_lib/web.ts webLoginOn); a Worker that is down never costs the page (tryServeWeb). /connect/ follows the usual audience.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { webLoginOn, webNotFoundOn, tryServeWeb, decideWeb, LOGIN_PATHS } = await import('../functions/_lib/web.ts');
const { WEB_ROUTES, WEB_ONLY_ROUTES, parseWebEntries } = await import('../shared/web.ts');
const { resetHubCache } = await import('../functions/_lib/admin/hubcache.ts').catch(() => ({}));

const user = (email, role = 'staff') => ({ email, name: email, picture: '', role, via: 'google', kpi: true });
const will = user('will@favorintl.org', 'admin');
const staff = user('someone@favorintl.org');

function world(settings = {}, bind = true) {
  if (typeof resetHubCache === 'function') resetHubCache();
  const d1 = memoryD1();
  d1.exec('CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)');
  for (const [k, v] of Object.entries(settings)) d1.db.prepare('INSERT INTO hub_settings VALUES (?, ?, ?, ?)').run(k, v, 't', 'now');
  return { DB: d1, ...(bind ? { WEB: { fetch: async () => new Response('web') } } : {}) };
}
const at = (path) => new URL('https://dash.test' + path);

describe('the two pages are built, and neither is a web-only page', () => {
  it('both are in the route list with an Astro twin to fall back on', () => {
    assert.ok(WEB_ROUTES.includes('/login/'));
    assert.ok(WEB_ROUTES.includes('/connect/'));
    assert.ok(!WEB_ONLY_ROUTES.includes('/login/') && !WEB_ONLY_ROUTES.includes('/connect/'));
    assert.deepEqual(parseWebEntries('/login/@all,/connect/@all'), [{ route: '/login/', audience: 'all' }, { route: '/connect/', audience: 'all' }]);
  });
  it('the sign-in page answers at both addresses', () => {
    assert.ok(LOGIN_PATHS.has('/login') && LOGIN_PATHS.has('/login/'));
  });
});

describe('who gets the web sign-in page', () => {
  it('nobody while /login/ is not in web.routes, with or without a binding', async () => {
    assert.equal(await webLoginOn(world(), at('/login/'), null), false);
    assert.equal(await webLoginOn(world({ 'web.routes': '/projects/@all' }), at('/login/?web=1'), null), false);
    assert.equal(await webLoginOn(world({ 'web.routes': '/login/@all' }, false), at('/login/'), null), false);
  });
  it('a visitor who is not signed in gets it at @all, and at a narrower audience only with ?web=1', async () => {
    const all = world({ 'web.routes': '/login/@all' });
    assert.equal(await webLoginOn(all, at('/login/'), null), true);
    const narrow = world({ 'web.routes': '/login/@testers' });
    assert.equal(await webLoginOn(narrow, at('/login/'), null), false);
    assert.equal(await webLoginOn(narrow, at('/login/?web=1'), null), true);
  });
  it('a signed-in person follows the entry audience', async () => {
    const env = world({ 'web.routes': '/login/@testers' });
    assert.equal(await webLoginOn(env, at('/login/'), will), true);
    assert.equal(await webLoginOn(env, at('/login/'), staff), false);
    assert.equal(await webLoginOn(world({ 'web.routes': '/login/@admin' }), at('/login/'), staff), false);
  });
  it('?classic=1 always gets the Astro page', async () => {
    assert.equal(await webLoginOn(world({ 'web.routes': '/login/@all' }), at('/login/?classic=1'), null), false);
    assert.equal(await webLoginOn(world({ 'web.routes': '/login/@all' }), at('/login/?classic=1&web=1'), will), false);
  });
});

describe('the sign-in page survives the web app being down', () => {
  const req = new Request(at('/login/'));
  it('hands back the web page when it answers with HTML', async () => {
    const res = await tryServeWeb({ WEB: { fetch: async () => new Response('<p>x</p>', { headers: { 'Content-Type': 'text/html' } }) } }, req);
    assert.equal(res.headers.get('X-Hub-Front'), 'web');
    assert.equal(res.headers.get('Cache-Control'), 'private, no-cache');
  });
  it('returns null for a thrown call, a 5xx and an answer that is not a page, so the Astro page answers', async () => {
    assert.equal(await tryServeWeb({ WEB: { fetch: async () => { throw new Error('down'); } } }, req), null);
    assert.equal(await tryServeWeb({ WEB: { fetch: async () => new Response('x', { status: 503, headers: { 'Content-Type': 'text/html' } }) } }, req), null);
    assert.equal(await tryServeWeb({ WEB: { fetch: async () => new Response('Not found', { status: 404 }) } }, req), null);
  });
});

describe('Connect Google follows the usual audience', () => {
  it('goes to the web app for a person in the entry audience and stays Astro for anyone else', async () => {
    const env = world({ 'web.routes': '/connect/@testers' });
    const ask = (u) => decideWeb(env, new Request(at('/connect/'), { headers: { 'Sec-Fetch-Dest': 'document' } }), at('/connect/'), u);
    assert.equal((await ask(will)).kind, 'web');
    assert.equal((await ask(staff)).kind, 'pass');
    const all = world({ 'web.routes': '/connect/@all' });
    assert.equal((await decideWeb(all, new Request(at('/connect/'), { headers: { 'Sec-Fetch-Dest': 'document' } }), at('/connect/'), staff)).kind, 'web');
  });
});

describe('the Worker names nobody only for the sign-in page', () => {
  const src = readFileSync(new URL('../web/src/server.ts', import.meta.url), 'utf8');
  it('refuses a request with no person unless it is /login/', () => {
    assert.ok(src.includes(String.raw`!request.headers.get('X-Hub-Email') && !/^\/login\/?$/.test(url.pathname)`));
  });
});

describe('the not-found page', () => {
  const field = user('field@partner.org', 'field');
  it('goes to the web app for a signed-in person in the /404/ audience and stays Astro for anyone else', async () => {
    const env = world({ 'web.routes': '/404/@testers' });
    assert.equal(await webNotFoundOn(env, at('/nope/'), will), true);
    assert.equal(await webNotFoundOn(env, at('/nope/'), staff), false);
    assert.equal(await webNotFoundOn(world({ 'web.routes': '/404/@all' }), at('/nope/'), staff), true);
    assert.equal(await webNotFoundOn(world({ 'web.routes': '/404/@all' }), at('/nope/'), field), false);
  });
  it('stays off when it is not listed, for a visitor, with ?classic=1 or ?web=0, and with no binding', async () => {
    assert.equal(await webNotFoundOn(world(), at('/nope/'), will), false);
    assert.equal(await webNotFoundOn(world({ 'web.routes': '/projects/@all' }), at('/nope/'), will), false);
    const on = world({ 'web.routes': '/404/@all' });
    assert.equal(await webNotFoundOn(on, at('/nope/'), null), false);
    assert.equal(await webNotFoundOn(on, at('/nope/?classic=1'), staff), false);
    assert.equal(await webNotFoundOn(on, at('/nope/?web=0'), staff), false);
    assert.equal(await webNotFoundOn(world({ 'web.routes': '/404/@all' }, false), at('/nope/'), staff), false);
  });
});
