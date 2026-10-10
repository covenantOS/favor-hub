// Run with: npm test (or node --test tests/work-drain-race.test.mjs)
//
// Two senders against the Work Center outbox. The real db/work.sql schema runs in node:sqlite (the stand-in for D1 that the other
// Work Center tests use), and the upkeep route is a stand-in that can hold one send open, the way a slow Blackbaud does.
// Made-up ids only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const svc = await import('../functions/_lib/work/service.ts');

const SCHEMA = readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8');
const CREATE_PATH = '/constituent/v1/actions';

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

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

let db;
let ctx;
let sent; // every call that reached the stand-in Blackbaud, in order
let hold; // when set, the next send reports it has started and waits until released
let failNext = false; // when set, the next send throws before anything reaches Blackbaud

function newCtx() {
  const repo = {
    async send(list) {
      if (failNext) {
        failNext = false;
        throw new Error('connection reset');
      }
      sent.push(...list);
      if (hold && !hold.used) {
        hold.used = true;
        hold.started.resolve();
        await hold.release.promise;
      } else {
        await new Promise((r) => setTimeout(r, 5));
      }
      return { results: list.map((c) => ({ ok: true, status: 200, body: { id: String(7000 + sent.length) } })), wait: undefined, callsToday: 10 };
    },
    async refreshMirror() {
      return { ok: true, runId: 'r1', maxCalls: 0 };
    },
    async synced() {
      return '2026-10-09T09:00:00Z';
    },
  };
  return { env: { DB: fakeD1(db) }, repo, actor: 'Pat Smith', email: 'pat@example.org' };
}

const agoIso = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

const createItem = (sub) => ({
  submissionId: sub,
  cid: '100',
  label: `Partner 100 | ${sub}`,
  steps: [{ op: 'create', body: { constituent_id: '100', date: '2026-10-08T00:00:00', type: 'RDD Action', category: 'Phone call', summary: `Called about ${sub}`, fundraisers: ['9001'] }, label: 'entry' }],
});

// A batch made more than two minutes ago with both rows still queued: the case the GET routes pick up.
async function stuckBatch() {
  const b = await svc.saveBatch(ctx, 'create', [createItem('s1'), createItem('s2')], {});
  db.prepare('UPDATE act_batches SET created_at = ? WHERE id = ?').run(agoIso(3), b.id);
  return b;
}

// Each Blackbaud create is counted by its summary. A row that goes out twice shows up as 2.
function sendsOf(summary) {
  return sent.filter((c) => c.method === 'POST' && c.path === CREATE_PATH && c.body?.summary === summary).length;
}

function assertEachSentOnce() {
  for (const s of ['Called about s1', 'Called about s2']) assert.equal(sendsOf(s), 1, `${s} reached Blackbaud ${sendsOf(s)} times`);
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  sent = [];
  hold = null;
  failNext = false;
  ctx = newCtx();
});

describe('two senders on one batch', () => {
  it('two boards open at the same moment: each row goes out once', async () => {
    const b = await stuckBatch();
    await Promise.all([svc.resumeStuck(ctx), svc.resumeStuck(ctx)]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM act_outbox WHERE batch_id = ? AND state = ?').get(b.id, 'sent').n, 2);
    assertEachSentOnce();
  });

  it('a second run while the first is inside its two-minute lease sends nothing', async () => {
    const b = await stuckBatch();
    hold = { started: deferred(), release: deferred() };
    const first = svc.runBatch(ctx, b.id);
    await hold.started.promise;
    const second = await svc.runBatch(ctx, b.id);
    assert.equal(second.held, 'busy');
    hold.release.resolve();
    await first;
    assertEachSentOnce();
  });

  it('a board load after a run has held the batch for three minutes: each row goes out once', async () => {
    const b = await stuckBatch();
    hold = { started: deferred(), release: deferred() };
    const first = svc.runBatch(ctx, b.id);
    await hold.started.promise;
    // The first run is still waiting on Blackbaud. Its lock was written three minutes ago and never renewed.
    db.prepare('UPDATE act_settings SET updated_at = ? WHERE key = ?').run(agoIso(3), `lock:${b.id}`);
    await svc.resumeStuck(ctx); // what GET /api/work/board starts in waitUntil
    hold.release.resolve();
    await first;
    assertEachSentOnce();
  });

  it('the overnight drain while a run holds the batch for three minutes: each row goes out once', async () => {
    const b = await stuckBatch();
    hold = { started: deferred(), release: deferred() };
    const first = svc.runBatch(ctx, b.id);
    await hold.started.promise;
    db.prepare('UPDATE act_settings SET updated_at = ? WHERE key = ?').run(agoIso(3), `lock:${b.id}`);
    await svc.drain(ctx); // what POST /api/work/drain runs
    hold.release.resolve();
    await first;
    assertEachSentOnce();
  });
});

describe('the row claim', () => {
  it('a row another run claimed a few minutes ago is left alone, and sent once its claim is ten minutes old', async () => {
    const b = await stuckBatch();
    db.prepare("UPDATE act_outbox SET state = 'sending', claimed_at = ? WHERE batch_id = ?").run(agoIso(5), b.id);
    await svc.runBatch(ctx, b.id);
    assert.equal(sent.length, 0, 'nothing is sent while the claim is live');
    db.prepare("UPDATE act_outbox SET claimed_at = ? WHERE batch_id = ?").run(agoIso(11), b.id);
    await svc.runBatch(ctx, b.id);
    assertEachSentOnce();
  });

  it('a send that throws puts its rows back in the queue for the next run', async () => {
    const b = await stuckBatch();
    failNext = true;
    await assert.rejects(svc.runBatch(ctx, b.id), /connection reset/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE state IN ('sending', 'sent')").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE state = 'queued'").get().n, 2);
    await svc.runBatch(ctx, b.id);
    assertEachSentOnce();
  });

  it('Undo waits while a row is being sent', async () => {
    const b = await stuckBatch();
    db.prepare("UPDATE act_outbox SET state = 'sending', claimed_at = ? WHERE batch_id = ?").run(agoIso(0), b.id);
    await assert.rejects(svc.undoBatch(ctx, b.id), /still taking this batch/);
  });

  it('a row being sent still shows on the board as saving', async () => {
    const b = await svc.saveBatch(ctx, 'reschedule', [{ actionId: '501', cid: '100', label: 'Partner 100 | TY', steps: [{ op: 'patch', body: { date: '2026-10-20T00:00:00' }, label: 'reschedule' }] }], {});
    db.prepare("UPDATE act_outbox SET state = 'sending', claimed_at = ? WHERE batch_id = ?").run(agoIso(0), b.id);
    const pending = await svc.loadPending(ctx.env);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].state, 'queued');
  });
});
