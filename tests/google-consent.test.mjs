// Run with: npm test
//
// The Google connection (functions/api/google/connect.ts and callback.ts): the first connection asks for
// the three read scopes plus the sign-in identity; the Google Sheets step asks only for drive.file plus
// the identity, keeps what the person already granted, and does not force a second screen; "force" asks
// again with the screen. The callback fails closed with no identity, refuses another person's Google
// account, sends a person whose grant exists but who got no refresh token round once more, and stores the
// union of the scopes Google reports. A stand-in answers for Google's token call.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let connect;
let callback;
let google;
let d1;
let env;
const KEY = 'ab'.repeat(32);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (email) => `x.${b64({ email })}.y`;
const asUser = (url, email = 'ada@favorintl.org', extra = {}) => new Request('https://dash.test' + url, { headers: { 'X-Hub-Email': email, 'X-Hub-Name': 'Ada', 'X-Hub-Via': 'google', ...extra } });
let tokenAnswer;

before(async () => {
  connect = await import('../functions/api/google/connect.ts');
  callback = await import('../functions/api/google/callback.ts');
  google = await import('../functions/_lib/hub/google.ts');
});

beforeEach(() => {
  d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/google.sql', import.meta.url), 'utf8'));
  env = { DB: d1, GOOGLE_TOKEN_KEY: KEY, GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
  tokenAnswer = {};
  globalThis.fetch = async (url) => (String(url) === 'https://oauth.test/token' ? new Response(JSON.stringify(tokenAnswer), { status: 200 }) : new Response('{}', { status: 404 }));
});

const startOf = async (qs) => {
  const res = await connect.onRequestGet({ request: asUser('/api/google/connect' + qs), env });
  const loc = new URL(res.headers.get('Location'));
  return { res, q: loc.searchParams, cookie: res.headers.get('Set-Cookie') };
};

describe('connect', () => {
  it('asks for the three read scopes and the identity the first time, with the consent screen', async () => {
    const { q, res } = await startOf('?next=%2Ftoday');
    assert.equal(res.status, 302);
    const scopes = q.get('scope').split(' ');
    assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events.readonly'));
    assert.ok(scopes.includes('openid') && scopes.includes('email'));
    assert.ok(!scopes.includes('https://www.googleapis.com/auth/drive.file'));
    assert.equal(q.get('prompt'), 'consent');
    assert.equal(q.get('include_granted_scopes'), 'true');
  });

  it('asks for drive.file and the identity only for Google Sheets, with no forced screen', async () => {
    const { q } = await startOf('?add=sheets&next=%2Fbrain%2F');
    assert.deepEqual(q.get('scope').split(' ').sort(), ['email', 'https://www.googleapis.com/auth/drive.file', 'openid']);
    assert.equal(q.get('prompt'), null);
    assert.equal(q.get('include_granted_scopes'), 'true');
    assert.equal(q.get('access_type'), 'offline');
    assert.equal(q.get('hd'), 'favorintl.org');
    assert.equal(q.get('login_hint'), 'ada@favorintl.org');
    assert.ok(q.get('state').endsWith('|sheets'));
  });

  it('force asks again with the consent screen', async () => {
    const { q } = await startOf('?add=sheets&force=1&next=%2Fbrain%2F');
    assert.equal(q.get('prompt'), 'consent');
    assert.ok(q.get('state').endsWith('|sheets+force'));
  });

  it('keeps next on this site', async () => {
    const { q } = await startOf('?next=https%3A%2F%2Fevil.test%2F');
    assert.equal(decodeURIComponent(q.get('state').split('|')[1]), '/');
  });

  it('sends a person who is not signed in to the sign-in page', async () => {
    const res = await connect.onRequestGet({ request: new Request('https://dash.test/api/google/connect'), env });
    assert.match(res.headers.get('Location'), /\/login\//);
  });
});

describe('callback', () => {
  const back = async (state, { email = 'ada@favorintl.org', code = 'c1', answer, error } = {}) => {
    tokenAnswer = answer;
    const q = new URLSearchParams({ state, code });
    if (error) q.set('error', error);
    const res = await callback.onRequestGet({ request: asUser('/api/google/callback?' + q, email, { Cookie: 'hub_gstate=' + encodeURIComponent(state) }), env });
    return { res, loc: res.headers.get('Location') };
  };
  const stored = () => d1.db.prepare('SELECT email, scopes FROM hub_google').all().map((r) => ({ ...r }));

  it('stores the token and the scopes for the first connection', async () => {
    const { loc } = await back('s1|%2Ftoday', { answer: { access_token: 'a', refresh_token: 'r', scope: 'calendar openid', id_token: idToken('ada@favorintl.org') } });
    assert.equal(loc, '/today?google=connected');
    assert.deepEqual(stored(), [{ email: 'ada@favorintl.org', scopes: 'calendar openid' }]);
  });

  it('stores the union Google reports for the Sheets step and says google=sheets', async () => {
    const union = 'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/drive.file openid email';
    const { loc } = await back('s2|%2Fbrain%2F|sheets', { answer: { access_token: 'a', refresh_token: 'r2', scope: union, id_token: idToken('ada@favorintl.org') } });
    assert.equal(loc, '/brain/?google=sheets');
    assert.equal(stored()[0].scopes, union);
    assert.equal(await google.accessToken(env, 'ada@favorintl.org').then(() => 'refreshed').catch(() => 'refresh failed'), 'refreshed');
  });

  it('refuses to store anything when Google sends no identity', async () => {
    const { loc } = await back('s3|%2Fbrain%2F|sheets', { answer: { access_token: 'a', refresh_token: 'r', scope: 'x' } });
    assert.equal(loc, '/connect/?google=failed');
    assert.deepEqual(stored(), []);
  });

  it('refuses another person\'s Google account', async () => {
    const { loc } = await back('s4|%2Fbrain%2F|sheets', { answer: { access_token: 'a', refresh_token: 'r', scope: 'x', id_token: idToken('ben@favorintl.org') } });
    assert.equal(loc, '/connect/?google=wrong-account');
    assert.deepEqual(stored(), []);
  });

  it('goes round once more with the consent screen when the grant exists but no refresh token came', async () => {
    const { loc } = await back('s5|%2Fbrain%2F|sheets', { answer: { access_token: 'a', scope: 'x', id_token: idToken('ada@favorintl.org') } });
    const u = new URL(loc, 'https://dash.test');
    assert.equal(u.pathname, '/api/google/connect');
    assert.equal(u.searchParams.get('add'), 'sheets');
    assert.equal(u.searchParams.get('force'), '1');
    assert.equal(u.searchParams.get('next'), '/brain/');
    assert.deepEqual(stored(), []);
  });

  it('does not loop: with force already asked and still no token it says no-token', async () => {
    const { loc } = await back('s6|%2Fbrain%2F|sheets+force', { answer: { access_token: 'a', scope: 'x', id_token: idToken('ada@favorintl.org') } });
    assert.equal(loc, '/connect/?google=no-token');
  });

  it('says declined when the person pressed Cancel, and expired when the state does not match', async () => {
    assert.equal((await back('s7|%2F', { answer: {}, error: 'access_denied' })).loc, '/connect/?google=declined');
    tokenAnswer = {};
    const res = await callback.onRequestGet({ request: asUser('/api/google/callback?state=a&code=c', 'ada@favorintl.org', { Cookie: 'hub_gstate=b' }), env });
    assert.equal(res.headers.get('Location'), '/connect/?google=expired');
  });
});
