// Run with: npm test
// The request attachment route needs a signed-in user, serves only req_ keys, and never lets a cache keep a file.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let get;
const store = {
  'req_1/att_1.png': { body: 'png', httpMetadata: { contentType: 'image/png' } },
  'expenses/x.pdf': { body: 'pdf', httpMetadata: { contentType: 'application/pdf' } },
  'receipts/b.pdf': { body: 'pdf', httpMetadata: { contentType: 'application/pdf' } },
  'videos/a.mp4': { body: 'mp4', httpMetadata: { contentType: 'video/mp4' } },
};
const env = { UPLOADS: { get: async (k) => store[k] || null } };
const call = (path, headers = {}) => get({ request: new Request('https://hub.test/api/uploads/' + path, { headers }), env, params: { path: path.split('/') } });
const signedIn = { 'X-Hub-Email': 'ada@favorintl.org', 'X-Hub-Via': 'google' };

before(async () => { ({ onRequestGet: get } = await import('../functions/api/uploads/[[path]].ts')); });

describe('uploads route', () => {
  it('refuses a signed-out request without touching the bucket', async () => {
    const res = await call('req_1/att_1.png');
    assert.equal(res.status, 401);
    assert.match(res.headers.get('Cache-Control'), /no-store/);
  });
  it('serves a request attachment to a signed-in user with private no-store caching', async () => {
    const res = await call('req_1/att_1.png', signedIn);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(res.headers.get('Content-Type'), 'image/png');
  });
  it('does not serve expense PDFs, receipts or videos from this route', async () => {
    for (const k of ['expenses/x.pdf', 'receipts/b.pdf', 'videos/a.mp4', 'req_1/../expenses/x.pdf']) {
      assert.equal((await call(k, signedIn)).status, 404, k);
    }
  });
});
