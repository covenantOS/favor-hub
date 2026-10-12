// Run with: npm test (or node --test tests/work-snapshots.test.mjs)
// The hub keeps the answers to the Work lists' Blackbaud statements (mirror_snap) and serves them in milliseconds. A scheduled pass re-reads
// the ones used lately. A thank-you or an undo lives in the hub database, so a stale saved answer never brings a finished row back.
// Made-up data only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { listMirrorQ, refreshSnapshots, SNAP_KEEP_MS } = await import('../functions/_lib/work/partner.ts');
const { shapeGifts } = await import('../functions/_lib/work/gifts.ts');

const realFetch = globalThis.fetch;
let db, env, answers, calls;
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
const SQL = 'SELECT id FROM gifts WHERE id = ?1';

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/work-snap.sql', import.meta.url), 'utf8'));
  env = { DB: fakeD1(db), MIRROR_API_KEY: 'test' };
  answers = [{ id: 'g1' }];
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(answers), { status: 200 }); };
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('saved Blackbaud answers', () => {
  it('the first read goes to the mirror and is kept; the second is served from FavorOS database', async () => {
    const q = listMirrorQ(env);
    assert.deepEqual(await q(SQL, ['a']), [{ id: 'g1' }]);
    assert.equal(calls, 1);
    answers = [{ id: 'g1' }, { id: 'g2' }];
    assert.deepEqual(await q(SQL, ['a']), [{ id: 'g1' }], 'the saved answer, no new read');
    assert.equal(calls, 1);
    assert.deepEqual(await q(SQL, ['b']), [{ id: 'g1' }, { id: 'g2' }], 'other values are another statement');
    assert.equal(calls, 2);
  });

  it('a saved answer older than a day and a half is read again', async () => {
    const q = listMirrorQ(env);
    await q(SQL, ['a']);
    db.prepare('UPDATE mirror_snap SET at = ?').run(ago(SNAP_KEEP_MS + 1000));
    answers = [{ id: 'new' }];
    assert.deepEqual(await q(SQL, ['a']), [{ id: 'new' }]);
    assert.equal(calls, 2);
  });

  it('the scheduled pass re-reads statements used lately whose copy is over four minutes old, and leaves fresh ones alone', async () => {
    const q = listMirrorQ(env);
    await q(SQL, ['old']);
    await q(SQL, ['fresh']);
    db.prepare("UPDATE mirror_snap SET at = ? WHERE params = '[\"old\"]'").run(ago(10 * 60000));
    answers = [{ id: 'newer' }];
    calls = 0;
    const out = await refreshSnapshots(env);
    assert.equal(out.refreshed, 1);
    assert.equal(calls, 1);
    assert.deepEqual(await q(SQL, ['old']), [{ id: 'newer' }]);
    assert.deepEqual(await q(SQL, ['fresh']), [{ id: 'g1' }]);
  });

  it('a statement nobody used for three days is dropped, and one that fails keeps serving its old answer', async () => {
    const q = listMirrorQ(env);
    await q(SQL, ['a']);
    await q(SQL, ['b']);
    db.prepare("UPDATE mirror_snap SET last_used = ? WHERE params = '[\"a\"]'").run(ago(4 * 86400000));
    db.prepare("UPDATE mirror_snap SET at = ? WHERE params = '[\"b\"]'").run(ago(10 * 60000));
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    await refreshSnapshots(env);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mirror_snap').get().n, 1);
    assert.deepEqual(await q(SQL, ['b']), [{ id: 'g1' }]);
  });

  it('a statement that cannot write is the only kind kept: a write statement is refused before any read', async () => {
    const q = listMirrorQ(env);
    await assert.rejects(q('DELETE FROM gifts', []));
    assert.equal(calls, 0);
  });
});

describe('a finished row never comes back from a saved answer', () => {
  const stale = {
    gifts: [{ id: 'x1', giver: '1', amount: 200, gdate: '2026-10-09', added: '2026-10-10T06:00:00-04:00', gtype: 'Donation', pm: 'Cash', splits: null, soft: null, link: null, comment: null }],
    holds: [{ cid: '1', fid: '501', type: 'RDD' }], evidence: [], stats: [], last: [], phones: [], monthly: [], funds: [],
    facts: [{ id: '1', name: 'Ada Example', kind: 'Individual', city: 'Holland', st: 'MI', deceased: 0, inactive: 0 }],
    fundraisers: [{ id: '501', first: 'F', last: 'A', active: 1 }],
  };
  const o = { today: '2026-10-10', nowMs: Date.parse('2026-10-10T14:00:00-04:00') };

  it('a thank-you made after the answer was saved takes the gift off the list; undoing it puts the gift back', () => {
    assert.equal(shapeGifts({ ...stale, thanks: [] }, o).rows.length, 1);
    const thanked = { gift_id: 'x1', cid: '1', how: 'letter', outcome: 'sent', created_at: '2026-10-10T15:00:00Z', actor: 'Fay Alpha', remind_on: null };
    assert.equal(shapeGifts({ ...stale, thanks: [thanked] }, o).rows.length, 0);
    assert.equal(shapeGifts({ ...stale, thanks: [] }, o).rows.length, 1, 'the undone batch is no longer in the thanks FavorOS reads');
  });
});
