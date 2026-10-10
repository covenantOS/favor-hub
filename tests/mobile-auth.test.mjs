// Run with: npm test
//
// Native sign-in and device tokens: every refusal the research plan lists (wrong audience, wrong domain, expired, stale, blocked,
// revoked device) plus the test-mode verifier, which must refuse to run on the live host. Google's keys are a local stand-in.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { call, idToken, IOS_CLIENT, signIn, testToken, WEB_CLIENT, world } from './support/mobile-harness.mjs';

const signInWith = (w, token, extra = {}) => call(w, 'POST', '/api/auth/native', { body: { id_token: token, device_name: 'Test phone' }, ...extra });
const now = () => Math.floor(Date.now() / 1000);
const deviceCount = (w) => w.db.prepare('SELECT COUNT(*) AS n FROM hub_devices').get().n;

describe('POST /api/auth/native', () => {
  it('accepts a token for the iOS client and for the web client, and returns a device session', async () => {
    const w = await world();
    for (const aud of [IOS_CLIENT, WEB_CLIENT]) {
      const out = await signInWith(w, await idToken({ aud, email: 'ada@favorintl.org' }));
      assert.equal(out.status, 200);
      assert.match(out.body.token, /^fdv_[0-9a-f]{64}$/);
      assert.equal(out.body.email, 'ada@favorintl.org');
      assert.ok(Date.parse(out.body.expires_at) > Date.now() + 89 * 86400000);
    }
  });

  it('stores only the SHA-256 of the token, never the token', async () => {
    const w = await world();
    const out = await signInWith(w, await idToken());
    const rows = w.db.prepare('SELECT * FROM hub_devices').all();
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, out.body.token);
    assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(rows).includes(out.body.token), false);
  });

  it('refuses a token meant for another app', async () => {
    const w = await world();
    const out = await signInWith(w, await idToken({ aud: 'someone-else.apps.googleusercontent.com' }));
    assert.equal(out.status, 401);
    assert.equal(deviceCount(w), 0);
  });

  it('refuses a wrong domain, a missing hd, an unverified email and a personal Gmail', async () => {
    const w = await world();
    assert.equal((await signInWith(w, await idToken({ email: 'ada@gmail.com', hd: undefined }))).status, 403);
    assert.equal((await signInWith(w, await idToken({ email: 'ada@favorintl.org', hd: 'other.org' }))).status, 403);
    assert.equal((await signInWith(w, await idToken({ email: 'ada@favorintl.org', hd: undefined }))).status, 403);
    assert.equal((await signInWith(w, await idToken({ email_verified: false }))).status, 403);
    assert.equal(deviceCount(w), 0);
  });

  it('refuses an expired token, a token from the future and a token signed with another key', async () => {
    const w = await world();
    assert.equal((await signInWith(w, await idToken({ exp: now() - 600, iat: now() - 4000 }))).status, 401);
    assert.equal((await signInWith(w, await idToken({ iat: now() + 3600, exp: now() + 7200 }))).status, 401);
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    assert.equal((await signInWith(w, await idToken({}, { pair: other }))).status, 401);
    assert.equal((await signInWith(w, await idToken({}, { kid: 'unknown-key' }))).status, 401);
    assert.equal(deviceCount(w), 0);
  });

  it('refuses a token older than ten minutes even though Google would still call it valid', async () => {
    const w = await world();
    const out = await signInWith(w, await idToken({ iat: now() - 15 * 60, exp: now() + 45 * 60 }));
    assert.equal(out.status, 401);
    assert.equal(out.body.error, 'stale_signin');
  });

  it('refuses a blocked account and records the refusal', async () => {
    const w = await world();
    const t = new Date().toISOString();
    w.db.prepare("INSERT INTO hub_users (email, name, role, blocked, created_at, updated_at) VALUES ('gone@favorintl.org', 'Gone', 'staff', 1, ?, ?)").run(t, t);
    const out = await signInWith(w, await idToken({ email: 'gone@favorintl.org' }));
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'blocked');
    assert.equal(deviceCount(w), 0);
    assert.ok(w.db.prepare("SELECT 1 FROM hub_auth_log WHERE event = 'native_refused' AND email = 'gone@favorintl.org'").get());
  });

  it('adds a first-time staff account to hub_users the way the web sign-in does', async () => {
    const w = await world();
    await signInWith(w, await idToken({ email: 'newhire@favorintl.org', name: 'New Hire' }));
    const u = w.db.prepare("SELECT role, blocked FROM hub_users WHERE email = 'newhire@favorintl.org'").get();
    assert.deepEqual({ ...u }, { role: 'staff', blocked: 0 });
  });

  it('limits sign-in attempts from one address', async () => {
    const w = await world();
    let last;
    for (let i = 0; i < 32; i++) last = await signInWith(w, 'garbage', { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
    assert.equal(last.status, 429);
  });

  it('keeps at most eight live phones for one person, signing out the oldest', async () => {
    const w = await world();
    for (let i = 0; i < 10; i++) {
      await signInWith(w, await idToken(), { headers: { 'CF-Connecting-IP': '198.51.100.' + (i + 1) } });
      await new Promise((r) => setTimeout(r, 3));
    }
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM hub_devices WHERE revoked_at IS NULL').get().n, 8);
  });
});

describe('the test-mode verifier', () => {
  it('works on a local address with the variable on', async () => {
    const w = await world();
    w.env.MOBILE_AUTH_TEST = 'on';
    const out = await call(w, 'POST', '/api/auth/native', { body: { id_token: testToken(), device_name: 'T' }, host: 'http://localhost:8788' });
    assert.equal(out.status, 200);
  });

  it('still runs the audience, domain and freshness checks on a test token', async () => {
    const w = await world();
    w.env.MOBILE_AUTH_TEST = 'on';
    const local = { host: 'http://127.0.0.1:8788' };
    assert.equal((await call(w, 'POST', '/api/auth/native', { body: { id_token: testToken({ aud: 'x' }) }, ...local })).status, 401);
    assert.equal((await call(w, 'POST', '/api/auth/native', { body: { id_token: testToken({ hd: 'other.org', email: 'a@other.org' }) }, ...local })).status, 403);
    assert.equal((await call(w, 'POST', '/api/auth/native', { body: { id_token: testToken({ iat: now() - 3600 }) }, ...local })).status, 401);
  });

  it('is refused on the live host even with the variable set', async () => {
    const w = await world();
    w.env.MOBILE_AUTH_TEST = 'on';
    for (const host of ['https://dash.favorintl.org', 'https://hub.favorintl.org', 'https://favor-hub-d4n.pages.dev']) {
      const out = await call(w, 'POST', '/api/auth/native', { body: { id_token: testToken(), device_name: 'T' }, host });
      assert.ok(out.status === 401 || out.status === 301 || out.status === 308, host + ' answered ' + out.status);
      assert.equal(deviceCount(w), 0);
    }
  });

  it('is refused when the variable is off', async () => {
    const w = await world();
    const out = await call(w, 'POST', '/api/auth/native', { body: { id_token: testToken() }, host: 'http://localhost:8788' });
    assert.equal(out.status, 401);
  });
});

describe('device tokens', () => {
  it('stop working when the person is blocked, on the next call', async () => {
    const w = await world();
    const token = await signIn(w);
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token })).status, 200);
    w.db.prepare("UPDATE hub_users SET blocked = 1 WHERE email = 'ada@favorintl.org'").run();
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token })).status, 401);
  });

  it('stop working after Sign out on the phone, and the row is kept with a time', async () => {
    const w = await world();
    const token = await signIn(w);
    assert.equal((await call(w, 'POST', '/api/auth/native/revoke', { token })).status, 204);
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token })).status, 401);
    assert.ok(w.db.prepare('SELECT revoked_at FROM hub_devices').get().revoked_at);
  });

  it('stop working after the person signs out all their phones', async () => {
    const w = await world();
    const a = await signIn(w);
    const b = await signIn(w, {}, 'Second phone');
    const out = await call(w, 'POST', '/api/auth/native/revoke-all', { token: a, body: {} });
    assert.equal(out.body.revoked, 2);
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token: b })).status, 401);
  });

  it('can be revoked remotely by an admin, and only by an admin', async () => {
    const w = await world();
    const ada = await signIn(w);
    const willToken = await signIn(w, { email: 'will@favorintl.org', name: 'Will Hamilton' });
    const denied = await call(w, 'POST', '/api/auth/native/revoke-all', { token: ada, body: { email: 'will@favorintl.org' } });
    assert.equal(denied.status, 403);
    const ok = await call(w, 'POST', '/api/auth/native/revoke-all', { token: willToken, body: { email: 'ada@favorintl.org' } });
    assert.equal(ok.body.revoked, 1);
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token: ada })).status, 401);
    const list = await call(w, 'GET', '/api/auth/native/devices?email=ada@favorintl.org', { token: willToken });
    assert.equal(list.body.devices.length, 1);
    assert.ok(list.body.devices[0].revoked_at);
    assert.equal(JSON.stringify(list.body).includes('token_hash'), false);
  });

  it('an admin can sign out one phone by its id and leave the others', async () => {
    const w = await world();
    const a1 = await signIn(w);
    const a2 = await signIn(w);
    const willToken = await signIn(w, { email: 'will@favorintl.org', name: 'Will Hamilton' });
    const list = await call(w, 'GET', '/api/auth/native/devices?email=ada@favorintl.org', { token: willToken });
    const first = list.body.devices[list.body.devices.length - 1];
    const out = await call(w, 'POST', '/api/auth/native/revoke-all', { token: willToken, body: { email: 'ada@favorintl.org', device_id: first.id } });
    assert.equal(out.body.revoked, 1);
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token: a1 })).status, 401);
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token: a2 })).status, 200);
  });

  it('stop working when they expire', async () => {
    const w = await world();
    const token = await signIn(w);
    w.db.prepare("UPDATE hub_devices SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token })).status, 401);
  });

  it('are not accepted outside the iPhone routes', async () => {
    const w = await world();
    const token = await signIn(w, { email: 'will@favorintl.org', name: 'Will Hamilton' });
    const mw = await import('../functions/_middleware.ts');
    let reached = false;
    const res = await mw.onRequest({
      request: new Request('https://dash.favorintl.org/api/requests', { headers: { Authorization: 'Bearer ' + token } }),
      env: w.env,
      next: async () => {
        reached = true;
        return new Response('ok');
      },
    });
    assert.equal(res.status, 401);
    assert.equal(reached, false);
  });

  it('a made-up fdv_ token is refused', async () => {
    const w = await world();
    assert.equal((await call(w, 'GET', '/api/mobile/config', { token: 'fdv_' + '0'.repeat(64) })).status, 401);
  });

  it('a browser cookie session cannot use the iPhone routes', async () => {
    const w = await world();
    const mod = await import('../functions/api/mobile/config.ts');
    const res = await mod.onRequestGet({
      request: new Request('https://dash.favorintl.org/api/mobile/config', { headers: { 'X-Hub-Email': 'will@favorintl.org', 'X-Hub-Via': 'google' } }),
      env: w.env,
      params: {},
      waitUntil() {},
    });
    assert.equal(res.status, 401);
  });

  it('the agent key does not reach the iPhone routes either', async () => {
    const w = await world();
    w.env.AGENT_API_KEY = 'agent-secret';
    const out = await call(w, 'GET', '/api/mobile/config', { token: 'agent-secret' });
    assert.equal(out.status, 401);
  });
});
