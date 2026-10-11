// Run with: npm test
// The report mirror cache: a second read is served from memory, then from KV in a fresh isolate, never from a failure,
// and a caller that changes its rows leaves the kept copy alone. Made-up rows; no live database.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { cachedMirror, clearReportCache } = await import('../functions/_lib/reports/cache.ts');

const fakeKv = () => {
  const m = new Map();
  return { m, puts: 0, async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async put(k, v) { this.puts++; m.set(k, v); } };
};
const counter = (rows) => { const c = { n: 0, read: async () => { c.n++; return rows; } }; return c; };

describe('report mirror cache', () => {
  beforeEach(() => clearReportCache());

  it('reads the mirror once for the same sql and params', async () => {
    const c = counter([{ a: 1 }]);
    const env = {};
    assert.deepEqual(await cachedMirror(env, 'SELECT 1', [1], c.read), [{ a: 1 }]);
    assert.deepEqual(await cachedMirror(env, 'SELECT 1', [1], c.read), [{ a: 1 }]);
    assert.equal(c.n, 1);
  });

  it('reads again for different params', async () => {
    const c = counter([]);
    await cachedMirror({}, 'SELECT 1', [1], c.read);
    await cachedMirror({}, 'SELECT 1', [2], c.read);
    assert.equal(c.n, 2);
  });

  it('writes a KV copy under hub:reports and serves a new isolate from it', async () => {
    const kv = fakeKv();
    const env = { BB_KV: kv };
    const c = counter([{ a: 7 }]);
    await cachedMirror(env, 'SELECT 2', [], c.read);
    assert.equal(kv.puts, 1);
    assert.ok([...kv.m.keys()][0].startsWith('hub:reports:'));
    clearReportCache();
    const again = counter([{ a: 99 }]);
    assert.deepEqual(await cachedMirror(env, 'SELECT 2', [], again.read), [{ a: 7 }]);
    assert.equal(again.n, 0);
  });

  it('does not keep a failed read', async () => {
    const kv = fakeKv();
    let fail = true;
    const read = async () => { if (fail) throw new Error('down'); return [{ ok: 1 }]; };
    await assert.rejects(cachedMirror({ BB_KV: kv }, 'SELECT 3', [], read));
    fail = false;
    assert.deepEqual(await cachedMirror({ BB_KV: kv }, 'SELECT 3', [], read), [{ ok: 1 }]);
    assert.equal(kv.puts, 1);
  });

  it('hands each caller its own copy', async () => {
    const c = counter([{ a: 1 }]);
    const one = await cachedMirror({}, 'SELECT 4', [], c.read);
    one[0].a = 500;
    one.push({ a: 2 });
    assert.deepEqual(await cachedMirror({}, 'SELECT 4', [], c.read), [{ a: 1 }]);
  });
});
