// Run with: npm test
//
// GET /api/hub/home-drill (the rows behind a Work Overview count). Checks the guards that need no Blackbaud copy: a signed-out
// request is refused and a key the page does not mark gets a 400. No network, no names.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let onRequestGet;
before(async () => {
  ({ onRequestGet } = await import('../functions/api/hub/home-drill.ts'));
  globalThis.__homeLib = await import('../functions/_lib/work/home.ts');
});

const call = (query, headers = {}) => onRequestGet({ request: new Request('https://hub.test/api/hub/home-drill' + query, { headers }), env: {} });

describe('GET /api/hub/home-drill', () => {
  it('refuses a request with no sign-in', async () => {
    const res = await call('?key=open');
    assert.equal(res.status, 401);
  });
  it('refuses a key the page does not mark', async () => {
    const res = await call('?key=everything', { 'X-Hub-Email': 'staff@favorintl.org', 'X-Hub-Name': 'Staff Person' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'bad_key');
  });
  it('lists exactly the counts the Overview marks', () => {
    assert.deepEqual([...globalThis.__homeLib.HOME_DRILLS].sort(), ['first', 'gifts', 'open', 'over24', 'overdue', 'today']);
  });
});
