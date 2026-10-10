// Run with: npm test
// A feedback picture is private: only the sender attaches or removes it, and only the sender and the hub admin view it.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let route;
const rows = new Map([[27, { id: 27, email: 'ada@favorintl.org', shot_key: null }]]);
const puts = [];
const deletes = [];
const objects = new Map();
const env = {
  DB: {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => {
          if (/SELECT id, email, shot_key/.test(sql)) return rows.get(Number(args[0])) ? { ...rows.get(Number(args[0])) } : null;
          return null;
        },
        run: async () => {
          const row = rows.get(Number(args[args.length - 1]));
          if (row && /SET shot_key = \?/.test(sql)) row.shot_key = args[0];
          if (row && /SET shot_key = NULL/.test(sql)) row.shot_key = null;
          return { meta: {} };
        },
      }),
    }),
  },
  UPLOADS: {
    put: async (key, body) => { puts.push(key); objects.set(key, body); },
    get: async (key) => (objects.has(key) ? { body: objects.get(key) } : null),
    delete: async (key) => { deletes.push(key); objects.delete(key); },
  },
};

const owner = { 'X-Hub-Email': 'ada@favorintl.org', 'X-Hub-Via': 'google' };
const other = { 'X-Hub-Email': 'grace@favorintl.org', 'X-Hub-Via': 'google' };
const admin = { 'X-Hub-Email': 'will@favorintl.org', 'X-Hub-Via': 'google', 'X-Hub-Role': 'admin' };
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;

async function call(method, headers, body, path = '27/shot', type = 'image/jpeg') {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = type;
  const req = new Request('https://hub.test/api/feedback/' + path, { method, headers: h, body });
  return route({ request: req, env, params: { path: path.split('/') } });
}

before(async () => { ({ onRequest: route } = await import('../functions/api/feedback/[[path]].ts')); });

describe('feedback picture route', () => {
  it('refuses a signed-out request', async () => {
    assert.equal((await call('POST', {}, jpeg())).status, 401);
  });
  it('refuses a picture from anyone but the sender', async () => {
    assert.equal((await call('POST', other, jpeg())).status, 403);
    assert.equal(puts.length, 0);
  });
  it('refuses a picture that is not a JPEG', async () => {
    assert.equal((await call('POST', owner, jpeg(), '27/shot', 'image/png')).status, 415);
  });
  it('refuses a picture over the size limit', async () => {
    assert.equal((await call('POST', owner, new Uint8Array(1_500_001).buffer)).status, 413);
  });
  it('stores the sender picture privately and records its key', async () => {
    const res = await call('POST', owner, jpeg());
    assert.equal(res.status, 200);
    assert.deepEqual(puts, ['feedback/27.jpg']);
    assert.equal(rows.get(27).shot_key, 'feedback/27.jpg');
  });
  it('serves the picture to the sender and the hub admin, never cached', async () => {
    for (const h of [owner, admin]) {
      const res = await call('GET', h);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
    }
  });
  it('does not serve it to other staff', async () => {
    assert.equal((await call('GET', other)).status, 403);
  });
  it('removes the picture for the sender', async () => {
    assert.equal((await call('DELETE', other)).status, 403);
    assert.equal((await call('DELETE', owner)).status, 200);
    assert.deepEqual(deletes, ['feedback/27.jpg']);
    assert.equal(rows.get(27).shot_key, null);
    assert.equal((await call('GET', owner)).status, 404);
  });
});
