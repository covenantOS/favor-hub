// Run with: npm test
//
// A signed-out person who opens a hub link comes back to that exact page after sign-in. The return path
// must stay on this site: functions/_lib/next.ts accepts one slash and printable ASCII only, so "/\evil.com",
// "//evil.com" and a tab inside the path all fall back to "/". The Google connect and callback steps send a
// person without a session to sign-in with the page they asked for, not to Today.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let safeNextPath;
let connect;
let callback;
let d1;
let env;
const KEY = 'ab'.repeat(32);
const asUser = (url) => new Request('https://dash.test' + url, { headers: { 'X-Hub-Email': 'ada@favorintl.org', 'X-Hub-Name': 'Ada', 'X-Hub-Via': 'google' } });
const anon = (url) => new Request('https://dash.test' + url);

before(async () => {
  ({ safeNextPath } = await import('../functions/_lib/next.ts'));
  connect = await import('../functions/api/google/connect.ts');
  callback = await import('../functions/api/google/callback.ts');
});

beforeEach(() => {
  d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/google.sql', import.meta.url), 'utf8'));
  env = { DB: d1, GOOGLE_TOKEN_KEY: KEY, GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
});

describe('safeNextPath', () => {
  it('keeps a path on this site, with its query', () => {
    assert.equal(safeNextPath('/partners/27202?tab=gifts'), '/partners/27202?tab=gifts');
    assert.equal(safeNextPath('/meetings/abc%20def'), '/meetings/abc%20def');
    assert.equal(safeNextPath('/'), '/');
  });

  it('falls back to Today for anything that could leave the site', () => {
    const bad = [
      '//evil.com',
      '/\\evil.com',
      '/\\\\evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/ /evil.com',
      'https://evil.com/x',
      'evil.com',
      '',
      '/partners/é',
      '/' + 'a'.repeat(2000),
    ];
    for (const raw of bad) assert.equal(safeNextPath(raw), '/', JSON.stringify(raw));
    assert.equal(safeNextPath(undefined), '/');
    assert.equal(safeNextPath(['/x']), '/');
  });
});

describe('sign-in return path', () => {
  it('a signed-out connect request goes to sign-in with the page asked for', async () => {
    const res = await connect.onRequestGet({ request: anon('/api/google/connect?next=%2Fpartners%2F27202%3Ftab%3Dgifts'), env });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://dash.test/login/?next=%2Fpartners%2F27202%3Ftab%3Dgifts');
  });

  it('a signed-out connect request with an off-site next goes to sign-in on Today', async () => {
    const res = await connect.onRequestGet({ request: anon('/api/google/connect?next=%2F%5Cevil.com'), env });
    assert.equal(res.headers.get('Location'), 'https://dash.test/login/?next=%2F');
  });

  it('a signed-in connect request never puts an off-site path in the Google state', async () => {
    const res = await connect.onRequestGet({ request: asUser('/api/google/connect?next=%2F%5Cevil.com'), env });
    const state = new URL(res.headers.get('Location')).searchParams.get('state');
    assert.equal(state.split('|')[1], '%2F');
  });

  it('a callback whose session was lost sends the person to sign-in with their page', async () => {
    const state = 'uuid|' + encodeURIComponent('/reports/thank-you');
    const res = await callback.onRequestGet({ request: anon('/api/google/callback?state=' + encodeURIComponent(state) + '&code=x'), env });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://dash.test/login/?next=%2Freports%2Fthank-you');
  });
});
