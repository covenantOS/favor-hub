// The hand-off to the React app (functions/_lib/app2.ts, functions/api/hub/app2.ts). A page reaches the app only when the route is listed,
// the person is in the audience, they opted in and the request is a page load. Everyone else keeps the Astro page.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { decide, isPageLoad, readApp2Settings } = await import('../functions/_lib/app2.ts');
const route = await import('../functions/api/hub/app2.ts');

const admin = { email: 'test.admin@favorintl.org', name: 'Test Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const staff = { ...admin, email: 'test.staff@favorintl.org', role: 'staff' };

function world(settings = {}) {
  const d1 = memoryD1();
  d1.exec('CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)');
  for (const [k, v] of Object.entries(settings)) d1.db.prepare('INSERT INTO hub_settings VALUES (?, ?, ?, ?)').run(k, v, 't', 'now');
  return { DB: d1, db: d1.db };
}
const page = (path, { cookie = '', dest = 'document' } = {}) => {
  const url = new URL('https://hub.test' + path);
  return { url, request: new Request(url, { headers: { 'Sec-Fetch-Dest': dest, ...(cookie ? { Cookie: cookie } : {}) } }) };
};
const go = (env, path, user, opts) => {
  const { url, request } = page(path, opts);
  return decide(env, request, url, user);
};
const ON = { 'app2.routes': '/' };

describe('who gets the app', () => {
  it('nobody when no route is enabled, even with the cookie', async () => {
    assert.equal((await go(world(), '/', admin, { cookie: 'hub_app2=%2F' })).kind, 'pass');
  });
  it('an opted-in admin gets / when it is enabled', async () => {
    assert.equal((await go(world(ON), '/', admin, { cookie: 'hub_app2=%2F' })).kind, 'app');
  });
  it('without the cookie the page is Astro, and the database is not read', async () => {
    const env = world(ON);
    env.DB.prepare = () => { throw new Error('should not read'); };
    assert.equal((await go(env, '/', admin)).kind, 'pass');
  });
  it('staff stay on Astro until the audience is all', async () => {
    assert.equal((await go(world(ON), '/', staff, { cookie: 'hub_app2=%2F' })).kind, 'pass');
    assert.equal((await go(world({ ...ON, 'app2.audience': 'all' }), '/', staff, { cookie: 'hub_app2=%2F' })).kind, 'app');
  });
  it('other routes and script reads keep the Astro page', async () => {
    assert.equal((await go(world(ON), '/work/', admin, { cookie: 'hub_app2=%2F' })).kind, 'pass');
    assert.equal((await go(world(ON), '/', admin, { cookie: 'hub_app2=%2F', dest: 'empty' })).kind, 'pass');
  });
  it('the switch sets and clears the cookie and lands on the clean address', async () => {
    const on = await go(world(ON), '/?app2=1', admin);
    assert.equal(on.kind, 'redirect');
    assert.equal(on.to, '/');
    assert.match(on.cookie, /hub_app2=%2F;.*Max-Age=2592000/);
    const off = await go(world(ON), '/?app2=0', admin);
    assert.match(off.cookie, /Max-Age=0/);
    const denied = await go(world(ON), '/?app2=1', staff);
    assert.match(denied.cookie, /Max-Age=0/);
  });
  it('a page load is told from a script read', () => {
    assert.equal(isPageLoad(page('/').request), true);
    assert.equal(isPageLoad(page('/', { dest: 'empty' }).request), false);
    // The service worker passes a page load on as a script fetch and says so.
    const sw = page('/', { dest: 'empty' }).request;
    assert.equal(isPageLoad(new Request(sw.url, { headers: { 'Sec-Fetch-Dest': 'empty', 'X-Hub-Doc': '1' } })), true);
    // The browser's own read-ahead of a linked page (speculation rules prefetch) is a page load; a script read is not.
    assert.equal(isPageLoad(new Request('https://hub.test/', { headers: { 'Sec-Fetch-Dest': 'empty', 'Sec-Purpose': 'prefetch' } })), true);
    assert.equal(isPageLoad(new Request('https://hub.test/', { headers: { 'Sec-Fetch-Dest': 'empty', 'Sec-Purpose': 'prefetch', 'X-Hub-Request': '1' } })), false);
  });
  it('settings default to off and admin-only', async () => {
    assert.deepEqual(await readApp2Settings(world()), { routes: [], audience: 'admin' });
  });
});

describe('/api/hub/app2', () => {
  const call = (env, method, user, body) =>
    route[`onRequest${method[0] + method.slice(1).toLowerCase()}`]({ request: new Request('https://hub.test/api/hub/app2', { method, body: body && JSON.stringify(body), headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name, 'X-Hub-Role': user.role, 'X-Hub-Via': user.via, 'X-Hub-Kpi': '1' } }), env });
  it('reports eligibility and sets the cookie on opt-in', async () => {
    const env = world(ON);
    const got = await (await call(env, 'GET', admin)).json();
    assert.deepEqual({ e: got.eligible, o: got.optedIn, r: got.routes }, { e: true, o: false, r: ['/'] });
    const res = await call(env, 'POST', admin, { on: true });
    assert.match(res.headers.get('Set-Cookie'), /hub_app2=/);
    const staffGot = await (await call(env, 'GET', staff)).json();
    assert.equal(staffGot.eligible, false);
  });
  it('only an admin saves the settings, and unknown routes are refused', async () => {
    const env = world();
    assert.equal((await call(env, 'PUT', staff, { routes: '/' })).status, 403);
    assert.equal((await call(env, 'PUT', admin, { routes: '/nope/' })).status, 400);
    const ok = await (await call(env, 'PUT', admin, { routes: '/', audience: 'all' })).json();
    assert.deepEqual({ r: ok.routes, a: ok.audience }, { r: ['/'], a: 'all' });
    const off = await (await call(env, 'PUT', admin, { routes: '' })).json();
    assert.deepEqual(off.routes, []);
  });
});
