// Run with: npm test (or node --test tests/work-undo-once.test.mjs)
//
// Undo runs once per change. The real db/work.sql schema runs in node:sqlite (the stand-in for D1 that the other Work Center tests use),
// and the upkeep route is a stand-in. A role test on 2026-10-10 pressed Undo a second time while the first undo was still waiting to be
// sent, and four actions each got two DELETE rows. Made-up ids only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const svc = await import('../functions/_lib/work/service.ts');

const SCHEMA = readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8');

function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args,
    sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        for (const s of list) db.prepare(s.sql).run(...(s.args || []));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
}

let db;
let ctx;
let sent; // every call that reached the stand-in Blackbaud, in order
let nextId; // the id the stand-in gives each action it creates
let refuse; // the action ids whose DELETE the stand-in turns down

function newCtx() {
  const repo = {
    async send(list) {
      const results = [];
      for (const c of list) {
        sent.push(c);
        if (c.method === 'GET') results.push({ ok: true, status: 200, body: { count: 0, value: [] } });
        else if (c.method === 'POST') results.push({ ok: true, status: 200, body: { id: String(++nextId) } });
        else if (c.method === 'DELETE' && refuse.has(c.path.split('/').pop())) results.push({ ok: false, status: 400, body: { message: 'Blackbaud said no.' } });
        else results.push({ ok: true, status: 200, body: {} });
      }
      return { results, wait: undefined, callsToday: 10 };
    },
    async refreshMirror(ids) {
      return { ok: true, runId: 'r1', maxCalls: ids.length };
    },
    async synced() {
      return '2026-10-10T09:00:00Z';
    },
  };
  return { env: { DB: fakeD1(db) }, repo, actor: 'Pat Smith', email: 'pat@example.org' };
}

const createItem = (n) => ({
  submissionId: 's' + n,
  cid: '100',
  label: `Partner 100 | call ${n}`,
  steps: [{ op: 'create', body: { constituent_id: '100', date: '2026-10-08T00:00:00', type: 'RDD Action', category: 'Phone call', summary: `Called about gift ${n}`, fundraisers: ['9001'] }, label: 'entry' }],
});

/** A batch of n new actions, sent. Each one is in Blackbaud, so its Undo is a DELETE. */
async function postedBatch(n = 1) {
  const b = await svc.saveBatch(ctx, 'create', Array.from({ length: n }, (_, i) => createItem(i + 1)), {});
  await svc.runBatch(ctx, b.id);
  return b;
}

const count = (sql, ...args) => db.prepare(sql).get(...args).n;
const deletes = () => count("SELECT COUNT(*) AS n FROM act_outbox WHERE op = 'delete'");
const undoBatches = () => count("SELECT COUNT(*) AS n FROM act_batches WHERE op = 'undo'");
const refusal = (code, words) => (e) => e.status === 409 && e.code === code && words.test(e.message);

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  sent = [];
  nextId = 7000;
  refuse = new Set();
  ctx = newCtx();
});

describe('Undo runs once', () => {
  it('pressing Undo twice, the second time while the first undo waits, leaves one DELETE outbox row and says so', async () => {
    const b = await postedBatch(1);
    const first = await svc.undoBatch(ctx, b.id);
    assert.equal(first.batch.n, 1);
    await assert.rejects(svc.undoBatch(ctx, b.id), refusal('already_undone', /already being undone/));
    assert.equal(undoBatches(), 1);
    assert.equal(deletes(), 1, 'one DELETE outbox row, not two');
  });

  it('a batch of two actions gets one DELETE row for each action, not two each', async () => {
    const b = await postedBatch(2);
    const first = await svc.undoBatch(ctx, b.id);
    assert.equal(first.batch.n, 2);
    await assert.rejects(svc.undoBatch(ctx, b.id), refusal('already_undone', /already being undone/));
    assert.equal(undoBatches(), 1);
    assert.equal(deletes(), 2);
  });

  it('two presses in the same instant save one undo', async () => {
    const b = await postedBatch(2);
    const both = await Promise.allSettled([svc.undoBatch(ctx, b.id), svc.undoBatch(ctx, b.id)]);
    assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    const lost = both.find((r) => r.status === 'rejected').reason;
    assert.ok(refusal('already_undone', /already being undone/)(lost), lost.message);
    assert.equal(undoBatches(), 1);
    assert.equal(deletes(), 2);
  });

  it('after the first undo is sent, a second press is refused and nothing more goes to Blackbaud', async () => {
    const b = await postedBatch(1);
    const first = await svc.undoBatch(ctx, b.id);
    await svc.runBatch(ctx, first.batch.id);
    assert.equal(db.prepare('SELECT state FROM act_batches WHERE id = ?').get(b.id).state, 'undone');
    const deletesSent = () => sent.filter((c) => c.method === 'DELETE').length;
    assert.equal(deletesSent(), 1);
    await assert.rejects(svc.undoBatch(ctx, b.id), refusal('already_undone', /already undone/));
    assert.equal(deletes(), 1);
    assert.equal(deletesSent(), 1);
  });

  it('an undo is never itself undone, while it waits or after it is sent', async () => {
    const b = await postedBatch(1);
    const first = await svc.undoBatch(ctx, b.id);
    await assert.rejects(svc.undoBatch(ctx, first.batch.id), refusal('undo_of_undo', /undo cannot be undone/));
    await svc.runBatch(ctx, first.batch.id);
    await assert.rejects(svc.undoBatch(ctx, first.batch.id), refusal('undo_of_undo', /undo cannot be undone/));
    assert.equal(undoBatches(), 1);
    assert.equal(deletes(), 1);
  });

  it('an undo that ended with a row not sent can be pressed again for that row only', async () => {
    const b = await postedBatch(2);
    refuse = new Set(['7002']);
    const first = await svc.undoBatch(ctx, b.id);
    await svc.runBatch(ctx, first.batch.id);
    assert.equal(db.prepare('SELECT state FROM act_batches WHERE id = ?').get(first.batch.id).state, 'partial');
    assert.notEqual(db.prepare('SELECT state FROM act_batches WHERE id = ?').get(b.id).state, 'undone');
    refuse = new Set();
    const again = await svc.undoBatch(ctx, b.id);
    assert.equal(again.batch.n, 1, 'only the action Blackbaud still holds');
    await svc.runBatch(ctx, again.batch.id);
    assert.equal(db.prepare('SELECT state FROM act_batches WHERE id = ?').get(b.id).state, 'undone');
    await assert.rejects(svc.undoBatch(ctx, b.id), refusal('already_undone', /already undone/));
    assert.equal(undoBatches(), 2);
  });

  it('a second press leaves a contact held for a person where it was', async () => {
    const b = await svc.saveBatch(ctx, 'create', [createItem(1)], {});
    db.prepare("UPDATE act_outbox SET state = 'sent', bb_id = NULL WHERE batch_id = ?").run(b.id);
    const one = await svc.undoBatch(ctx, b.id);
    assert.equal(one.unresolved, 1);
    const held = db.prepare('SELECT state, last_error FROM act_outbox WHERE batch_id = ?').get(b.id);
    assert.equal(held.state, 'needs_human');
    const two = await svc.undoBatch(ctx, b.id);
    assert.equal(two.unresolved, 1);
    assert.equal(two.cancelled, 0);
    assert.deepEqual({ ...db.prepare('SELECT state, last_error FROM act_outbox WHERE batch_id = ?').get(b.id) }, { ...held });
  });

  it('Recent marks a change as undoing from the first press until the undo is sent', async () => {
    const b = await postedBatch(1);
    const row = async () => (await svc.recentBatches(ctx.env, 36)).find((x) => x.id === b.id);
    assert.equal((await row()).undoing, false);
    const first = await svc.undoBatch(ctx, b.id);
    assert.equal((await row()).undoing, true);
    assert.equal((await row()).undone, false);
    await svc.runBatch(ctx, first.batch.id);
    assert.equal((await row()).undoing, false);
    assert.equal((await row()).undone, true);
  });
});
