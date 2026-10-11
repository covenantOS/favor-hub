// Run with: npm test
//
// Calls the real POST /api/drill handler (functions/api/drill.ts) with a stand-in for the Favor Brain. Checks
// who may ask (signed in; numbers need KPI access, definitions do not), the key and person the Brain gets, the
// size limit, and that the Brain's answer comes back as it was sent. No network and no names: the Brain is stubbed.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let onRequestPost;
const realFetch = globalThis.fetch;
const seen = [];
let brainStatus = 200;
let brainBody = JSON.stringify({ ok: true, total: 0, count: 0, rows: [] });

const env = { BRAIN_HUB_KEY: 'test-brain-key', BRAIN_URL: 'https://brain.test' };
const staff = (kpi) => ({ 'X-Hub-Email': 'staff@favorintl.org', 'X-Hub-Name': 'Staff Person', ...(kpi ? { 'X-Hub-Kpi': '1' } : {}) });

function call(body, headers = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return onRequestPost({ request: new Request('https://hub.test/api/drill', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw }), env });
}

before(async () => {
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(brainBody, { status: brainStatus, headers: { 'Content-Type': 'application/json' } });
  };
  ({ onRequestPost } = await import('../functions/api/drill.ts'));
});

after(() => {
  globalThis.fetch = realFetch;
});

describe('POST /api/drill', () => {
  it('asks for a sign-in first', async () => {
    const res = await call({ kind: 'definition', sections: ['Team revenue'] });
    assert.equal(res.status, 401);
  });

  it('gives a definition to any signed-in staff member', async () => {
    seen.length = 0;
    brainBody = JSON.stringify({ ok: true, definition: '## Team revenue\n- x' });
    const res = await call({ kind: 'definition', sections: ['Team revenue'] }, staff(false));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).definition, '## Team revenue\n- x');
    assert.equal(seen.length, 1);
  });

  it('refuses the numbers without KPI access and never reaches the Brain', async () => {
    seen.length = 0;
    const res = await call({ kind: 'slice', slice: 'rdds' }, staff(false));
    assert.equal(res.status, 403);
    assert.equal(seen.length, 0);
  });

  it('passes a number request to the Brain with the key and the person asking', async () => {
    seen.length = 0;
    brainStatus = 200;
    brainBody = JSON.stringify({ ok: true, total: 12.5, count: 1, rows: [{ gift_id: '1' }] });
    const res = await call({ kind: 'year' }, staff(true));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, total: 12.5, count: 1, rows: [{ gift_id: '1' }] });
    const [call1] = seen;
    assert.equal(call1.url, 'https://brain.test/hub/drill');
    assert.equal(call1.init.method, 'POST');
    assert.equal(call1.init.headers.Authorization, 'Bearer test-brain-key');
    assert.equal(call1.init.headers['X-Acting-Email'], 'staff@favorintl.org');
    assert.equal(call1.init.body, JSON.stringify({ kind: 'year' }));
  });

  it('returns the Brain status when the Brain refuses', async () => {
    brainStatus = 403;
    brainBody = JSON.stringify({ ok: false, error: 'not_allowed', message: 'Open to leadership.' });
    const res = await call({ kind: 'slice', slice: 'npmg' }, staff(true));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'not_allowed');
    brainStatus = 200;
  });

  it('refuses a request too long to be a drill-down', async () => {
    const res = await call({ kind: 'definition', sections: ['x'.repeat(3000)] }, staff(false));
    assert.equal(res.status, 413);
  });

  it('refuses a body that is not JSON', async () => {
    const res = await call('not json', staff(true));
    assert.equal(res.status, 400);
  });
});
