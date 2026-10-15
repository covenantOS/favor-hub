// Today's kept page (public/sw.js) holds partner names and gifts in the browser. It is tied to one sign-in by the hub_who cookie
// (functions/_lib/session.ts) and has to be gone, or never shown, in every case below.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { ENTRY, WHO_A, WHO_B, loginPage, makeWorker, signedInAs, webPage } from './support/sw-harness.mjs';

const { hubWho, hubWhoCookie, clearHubWhoCookie, whoCookieFor, whoScope, nameSession } = await import('../functions/_lib/session.ts');
const req = (cookie) => new Request('https://dash.favorintl.org/', { headers: cookie ? { Cookie: cookie } : {} });
const ENV = { AGENT_API_KEY: 'k'.repeat(40) };
const ADMIN = whoScope({ role: 'admin', kpi: true });
const STAFF = whoScope({ role: 'staff', kpi: true });
const STAFF_NO_KPI = whoScope({ role: 'staff', kpi: false });

describe('hub_who (server)', () => {
  it('is an HMAC under a server secret: not the token, not a plain hash of it, different per sign-in and per secret', async () => {
    const t1 = 'a'.repeat(64);
    const t2 = 'b'.repeat(64);
    const a = await hubWho(ENV, t1, ADMIN);
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, await hubWho(ENV, t2, ADMIN));
    assert.notEqual(a, await hubWho({ AGENT_API_KEY: 'z'.repeat(40) }, t1, ADMIN));
    assert.ok(!t1.includes(a) && !a.includes(t1.slice(0, 8)));
    assert.notEqual(a, createHash('sha256').update(t1).digest('hex').slice(0, 32));
    assert.notEqual(a, createHash('sha256').update('who:' + t1).digest('hex').slice(0, 32));
    assert.equal(a, await hubWho(ENV, t1, ADMIN), 'stable for one session');
  });
  it('sets nothing when the server has no secret, so nothing is kept', async () => {
    assert.equal(await hubWho({}, 't', ADMIN), '');
    assert.equal(await hubWhoCookie({}, 't', ADMIN), null);
    assert.equal(await whoCookieFor({}, req('favor_hub_session=' + 't'.repeat(64)), ADMIN), null);
  });
  it('is readable by the worker, lives as long as the session cookie, and is cleared at sign-out', async () => {
    const c = await hubWhoCookie(ENV, 't'.repeat(64), ADMIN);
    assert.ok(!c.includes('HttpOnly') && c.includes('Max-Age=2592000') && c.includes('Secure'));
    assert.ok(clearHubWhoCookie().includes('Max-Age=0'));
  });
  it('is set only when it does not already name the request\'s session, and only for a day when it is set late', async () => {
    const token = 'c'.repeat(64);
    const who = await hubWho(ENV, token, ADMIN);
    assert.equal(await whoCookieFor(ENV, req(''), ADMIN), null);
    const late = await whoCookieFor(ENV, req('favor_hub_session=' + token), ADMIN);
    assert.ok(late.includes('hub_who=' + who) && late.includes('Max-Age=86400'));
    assert.equal(await whoCookieFor(ENV, req(`favor_hub_session=${token}; hub_who=${who}`), ADMIN), null);
    assert.ok((await whoCookieFor(ENV, req(`favor_hub_session=${token}; hub_who=${'0'.repeat(32)}`), ADMIN)).includes('hub_who=' + who));
  });
});

describe('hub_who follows the role (server)', () => {
  const token = 'd'.repeat(64);
  const sess = 'favor_hub_session=' + token;
  it('differs for the same sign-in under another role or KPI access', async () => {
    const a = await hubWho(ENV, token, ADMIN);
    const b = await hubWho(ENV, token, STAFF);
    const c = await hubWho(ENV, token, STAFF_NO_KPI);
    assert.equal(new Set([a, b, c]).size, 3);
  });
  it('is reset on the next response of any kind after a role change, and only then', async () => {
    const was = await hubWho(ENV, token, ADMIN);
    const now = await hubWho(ENV, token, STAFF);
    const api = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    const same = await nameSession(ENV, req(`${sess}; hub_who=${was}`), ADMIN, api());
    assert.equal(same.headers.getSetCookie().length, 0, 'unchanged role: no cookie');
    const changed = await nameSession(ENV, req(`${sess}; hub_who=${was}`), STAFF, api());
    const set = changed.headers.getSetCookie();
    assert.equal(set.length, 1);
    assert.ok(set[0].startsWith('hub_who=' + now) && !set[0].includes('HttpOnly'));
    assert.equal(await changed.text(), '{"ok":true}', 'the answer itself is untouched');
  });
  it('does nothing without a signed-in scope, a session cookie or a secret, and never undoes a sign-out', async () => {
    const ok = () => new Response('x', { status: 200 });
    assert.equal((await nameSession(ENV, req(sess), '', ok())).headers.getSetCookie().length, 0);
    assert.equal((await nameSession(ENV, req(''), STAFF, ok())).headers.getSetCookie().length, 0);
    assert.equal((await nameSession({}, req(sess), STAFF, ok())).headers.getSetCookie().length, 0);
    const out = new Response('{}', { status: 200 });
    out.headers.append('Set-Cookie', clearHubWhoCookie());
    const res = await nameSession(ENV, req(`${sess}; hub_who=${'0'.repeat(32)}`), STAFF, out);
    assert.deepEqual(res.headers.getSetCookie(), [clearHubWhoCookie()]);
  });
});

describe('kept Today in the service worker', () => {
  const kept = async (w) => (await (await w.caches.open('favoros-sw-1-today')).keys()).length;

  it('keeps the page after a visit and answers the next visit from it, with the server\'s time and the scripts held until it has drawn', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    const first = await w.load('/', webPage('Ann'));
    assert.ok(first.text.includes('Good morning, Ann') && !first.res.headers.has('x-hub-kept'));
    assert.equal(await kept(w), 1);
    const second = await w.load('/', webPage('Ann', 'A', 'Thu, 15 Oct 2026 13:00:00 GMT'));
    assert.ok(second.res.headers.has('x-hub-kept'));
    assert.ok(second.text.includes('Pat Partner'));
    assert.ok(second.text.includes('window.__hubNow=' + Date.parse('Thu, 15 Oct 2026 12:00:00 GMT')));
    assert.ok(second.text.includes('requestAnimationFrame') && !second.text.includes('<script type="module" async=""'));
    assert.ok(second.text.includes(ENTRY('A')));
  });

  it('is dropped on sign-out (the logout call and the page\'s forget message)', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann'));
    assert.equal(await kept(w), 1);
    w.handlers.fetch({ request: { url: 'https://dash.favorintl.org/api/auth/logout', method: 'POST', mode: 'cors', headers: new Headers() }, respondWith: (p) => p.then(() => {}), waitUntil() {} });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await w.caches.keys(), []);
    const v = makeWorker({ cookies: signedInAs(WHO_A) });
    await v.load('/', webPage('Ann'));
    await v.message('forget');
    assert.deepEqual(await v.caches.keys(), []);
  });

  it('is still shown the next morning (15 hours later)', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann'));
    const cache = await w.caches.open('favoros-sw-1-today');
    const key = (await cache.keys())[0];
    const old = await cache.match(key);
    await cache.put(key, new Response(await old.text(), { headers: { ...Object.fromEntries(old.headers), 'x-kept-at': String(Date.now() - 15 * 3600 * 1000) } }));
    assert.ok((await w.load('/', webPage('Ann'))).res.headers.has('x-hub-kept'));
  });

  it('is never shown after the 24 hour limit, and is removed', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann'));
    const cache = await w.caches.open('favoros-sw-1-today');
    const key = (await cache.keys())[0];
    const old = await cache.match(key);
    await cache.put(key, new Response(await old.text(), { headers: { ...Object.fromEntries(old.headers), 'x-kept-at': String(Date.now() - 24 * 3600 * 1000 - 1000) } }));
    const r = await w.load('/', webPage('Ann'));
    assert.ok(!r.res.headers.has('x-hub-kept'));
    assert.ok(r.text.includes('Good morning, Ann'));
  });

  it('is not shown to another sign-in in the same browser, and the new person\'s page does not inherit it', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann'));
    w.state.cookies.hub_who = WHO_B;
    const r = await w.load('/', webPage('Bob'));
    assert.ok(!r.res.headers.has('x-hub-kept'));
    assert.ok(r.text.includes('Bob') && !r.text.includes('Ann'));
    const again = await w.load('/', webPage('Bob'));
    assert.ok(again.res.headers.has('x-hub-kept') && again.text.includes('Bob') && !again.text.includes('Ann'));
    w.state.cookies.hub_who = WHO_A;
    const back = await w.load('/', webPage('Ann'));
    assert.ok(back.text.includes('Ann') && !back.text.includes('Bob'), 'each person has a copy of their own');
  });

  it('is not shown after a role change: the admin copy is gone for the same person once the server names the new role', async () => {
    const token = 'e'.repeat(64);
    const asAdmin = await hubWho(ENV, token, ADMIN);
    const asStaff = await hubWho(ENV, token, STAFF);
    const w = makeWorker({ cookies: signedInAs(asAdmin) });
    await w.load('/', webPage('Ann'));
    assert.equal(await kept(w), 1);
    w.state.cookies.hub_who = asStaff;
    const r = await w.load('/', webPage('Ann'));
    assert.ok(!r.res.headers.has('x-hub-kept'), 'the copy drawn for the admin is not served to the staff role');
    const next = await w.load('/', webPage('Ann'));
    assert.ok(next.res.headers.has('x-hub-kept'));
    w.state.cookies.hub_who = asAdmin;
    const back = await w.load('/', webPage('Ann'));
    assert.ok(back.res.headers.has('x-hub-kept'), 'each role has its own copy');
  });

  it('is not shown once the cookie is gone (a session that ended: the cookies expire together)', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann'));
    delete w.state.cookies.hub_who;
    const r = await w.load('/', loginPage);
    assert.ok(!r.res.headers.has('x-hub-kept'));
    assert.ok(!r.text.includes('Pat Partner'));
  });

  it('is removed, and the page reloaded, when the session ended on the server with no sign-out and the cookies are still there', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann'));
    assert.equal(await kept(w), 1);
    // The kept page shows first; the server's answer to the same visit is the sign-in page (a redirect), not Today.
    const r = await w.load('/', loginPage);
    assert.ok(r.res.headers.has('x-hub-kept'));
    assert.equal(await kept(w), 0, 'the copy is deleted as soon as the server says the person is not signed in');
    assert.deepEqual(w.navigated, ['https://dash.favorintl.org/'], 'the page loads again from the server');
    const next = await w.load('/', loginPage);
    assert.ok(!next.res.headers.has('x-hub-kept') && !next.text.includes('Pat Partner'));
  });

  it('is removed when the web Today is turned off for the person (opt-out cookie, or "/" no longer listed)', async () => {
    const off = makeWorker({ cookies: signedInAs(WHO_A) });
    await off.load('/', webPage('Ann'));
    off.state.cookies.hub_web_off = '1';
    assert.ok(!(await off.load('/', webPage('Ann'))).res.headers.has('x-hub-kept'));
    const unlisted = makeWorker({ cookies: signedInAs(WHO_A) });
    await unlisted.load('/', webPage('Ann'));
    unlisted.state.cookies.hub_web = encodeURIComponent('/churches/~/work/');
    assert.ok(!(await unlisted.load('/', webPage('Ann'))).res.headers.has('x-hub-kept'));
  });

  it('reloads from the new copy when a release changed the page\'s scripts', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann', 'A'));
    await w.load('/', webPage('Ann', 'B'));
    assert.deepEqual(w.navigated, ['https://dash.favorintl.org/']);
    const r = await w.load('/', webPage('Ann', 'B'));
    assert.ok(r.text.includes(ENTRY('B')) && w.navigated.length === 1);
  });

  it('answers only "/" with no query: other pages, addresses with a query and non-navigations are untouched', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', webPage('Ann'));
    for (const p of ['/?classic=1', '/?web=1', '/chat/', '/partners/']) {
      const r = await w.load(p, webPage('Ann'));
      assert.ok(!r.res || !r.res.headers.has('x-hub-kept'), p);
    }
  });

  it('keeps nothing for a page the web app did not draw (a classic page, an error, a sign-in page)', async () => {
    const w = makeWorker({ cookies: signedInAs(WHO_A) });
    await w.load('/', () => new Response('<html>classic</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await w.load('/', () => new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html', 'x-hub-front': 'web' } }));
    await w.load('/', loginPage);
    assert.equal(await kept(w), 0);
  });
});
