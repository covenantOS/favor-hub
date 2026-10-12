// Run with: npm test (or node --test tests/receipts-stale.test.mjs)
// The Receipts waiting list reads Blackbaud in about 6 seconds. A copy up to five minutes old is served as it is. An older copy (up to a
// day) is served at once while a fresh read runs behind it. Printing and marking always read fresh. Made-up data only.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { waitingGifts } = await import('../functions/_lib/receipts/store.ts');

const OLD_CSV = 'QRECID,Amount\n1001,25\n';
const NEW_CSV = 'QRECID,Amount\n1001,25\n1002,40\n';
const realFetch = globalThis.fetch;
let db;
let env;
let fetched;

const fakeD1 = (d) => {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => d.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: d.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(d.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => stmt(sql) };
};
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const seed = (csv, ageMs) => db.prepare("INSERT OR REPLACE INTO rcp_settings (key, value, updated_by, updated_at) VALUES ('cache:waiting:90', ?, 'cache', ?)").run(csv, ago(ageMs));
const stored = () => db.prepare("SELECT value FROM rcp_settings WHERE key = 'cache:waiting:90'").get().value;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE rcp_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL)');
  env = { DB: fakeD1(db), RECEIPTS_KEY: 'test' };
  fetched = 0;
  globalThis.fetch = async () => { fetched++; await new Promise((r) => setTimeout(r, 30)); return new Response(JSON.stringify({ ok: true, csv: NEW_CSV }), { status: 200 }); };
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('Receipts waiting list copy', () => {
  it('a copy under five minutes old is served with no Blackbaud read', async () => {
    seed(OLD_CSV, 60_000);
    const out = await waitingGifts(env, 90, false, () => assert.fail('no refresh needed'));
    assert.equal(out.gifts.length, 1);
    assert.equal(out.cached, true);
    assert.equal(fetched, 0);
  });

  it('an older copy is served at once and a read runs behind it', async () => {
    seed(OLD_CSV, 3 * 3600_000);
    const behind = [];
    const t0 = Date.now();
    const out = await waitingGifts(env, 90, false, (p) => behind.push(p));
    assert.ok(Date.now() - t0 < 25, 'did not wait for Blackbaud');
    assert.equal(out.gifts.length, 1, 'the old copy is what the page shows');
    assert.equal(behind.length, 1);
    await Promise.all(behind);
    assert.equal(fetched, 1);
    assert.equal(stored(), NEW_CSV, 'the next open is current');
    const next = await waitingGifts(env, 90, false, () => assert.fail('fresh now'));
    assert.equal(next.gifts.length, 2);
  });

  it('a copy more than a day old is not served; the page waits for a read', async () => {
    seed(OLD_CSV, 25 * 3600_000);
    const out = await waitingGifts(env, 90, false, () => assert.fail('nothing to defer'));
    assert.equal(out.gifts.length, 2);
    assert.equal(out.cached, false);
    assert.equal(fetched, 1);
  });

  it('printing and marking read fresh whatever the copy says', async () => {
    seed(OLD_CSV, 1000);
    const out = await waitingGifts(env, 90, true);
    assert.equal(out.gifts.length, 2);
    assert.equal(fetched, 1);
  });

  it('with no way to run behind the page, an older copy waits for a read', async () => {
    seed(OLD_CSV, 3 * 3600_000);
    const out = await waitingGifts(env, 90, false);
    assert.equal(out.gifts.length, 2);
    assert.equal(fetched, 1);
  });

  it('no copy at all waits for a read and keeps it', async () => {
    const out = await waitingGifts(env, 90, false, () => assert.fail('nothing to defer'));
    assert.equal(out.gifts.length, 2);
    assert.equal(stored(), NEW_CSV);
  });
});
