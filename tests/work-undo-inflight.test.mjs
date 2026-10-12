// Run with: npm test (or node --test tests/work-undo-inflight.test.mjs)
//
// Undo is never refused or lost. The real db/work.sql schema runs in node:sqlite (the stand-in for D1 that the other Work Center tests use),
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


let gate; // when set, repo.send waits on it, which keeps a write in flight
const baseSend = (c) => c.repo.send;
function gated(c) {
  const real = c.repo.send;
  c.repo.send = async (list) => {
    if (gate) { gate.started(); await gate.wait; }
    return real(list);
  };
  return c;
}
const completeItem = (id) => ({ actionId: String(id), cid: '100', label: 'Partner 100 | Portfolio Constituent Gift', steps: [{ op: 'patch', actionId: String(id), body: { completed: true, status: 'Completed' }, before: { completed: false, status: 'Open' } }] });
const patches = () => sent.filter((c) => c.method === 'PATCH');
const count = (sql, ...args) => db.prepare(sql).get(...args).n;
const stateOf = (id) => db.prepare('SELECT state FROM act_batches WHERE id = ?').get(id).state;
const waits = () => count('SELECT COUNT(*) AS n FROM act_undo_wait');

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  sent = [];
  nextId = 7000;
  refuse = new Set();
  gate = null;
  ctx = gated(newCtx());
});

describe('Undo while the write is in flight', () => {
  it('is accepted, the completed mark leaves the board at once, and the reverse is sent after the first write lands', async () => {
    const b = await svc.saveBatch(ctx, 'complete', [completeItem(1771)], {});
    let release;
    let started;
    const began = new Promise((r) => (started = r));
    gate = { wait: new Promise((r) => (release = r)), started };
    const run = svc.runBatch(ctx, b.id);
    await began;
    assert.equal(count("SELECT COUNT(*) AS n FROM act_outbox WHERE batch_id = ? AND state = 'sending'", b.id), 1);
    const out = await svc.undoBatch(ctx, b.id);
    assert.equal(out.queued, true);
    assert.equal(out.batch, null);
    assert.equal(waits(), 1);
    assert.equal((await svc.recentBatches(ctx.env, 36)).find((x) => x.id === b.id).undoing, true, 'Recent shows it as being undone');
    assert.equal((await svc.loadPending(ctx.env)).length, 0, 'the board no longer holds the completed mark');
    gate = null;
    release();
    await run;
    assert.equal(waits(), 0);
    assert.equal(stateOf(b.id), 'undone');
    const p = patches();
    assert.equal(p.length, 2, 'the first write, then the reverse');
    assert.equal(p[0].body.completed, true);
    assert.equal(p[1].body.completed, false);
    assert.equal(p[1].body.status, 'Open');
  });

  it('cancels a row of the same change that has not been sent yet', async () => {
    const b = await svc.saveBatch(ctx, 'complete', [completeItem(1), completeItem(2)], {});
    db.prepare("UPDATE act_outbox SET state = 'sending', claimed_at = ? WHERE batch_id = ? AND action_id = '1'").run(new Date().toISOString(), b.id);
    const out = await svc.undoBatch(ctx, b.id);
    assert.equal(out.queued, true);
    assert.equal(out.cancelled, 1);
    assert.equal(db.prepare("SELECT state FROM act_outbox WHERE action_id = '2'").get().state, 'undone');
    db.prepare("UPDATE act_outbox SET state = 'sent' WHERE action_id = '1'").run();
    assert.equal(await svc.settleWaitingUndos(ctx), 1);
    assert.equal(patches().length, 1, 'only the reverse of action 1 is sent; action 2 never went');
    assert.equal(patches()[0].path.split('/').pop(), '1');
  });

  it('a double press while waiting saves one undo and says it is queued both times', async () => {
    const b = await svc.saveBatch(ctx, 'complete', [completeItem(5)], {});
    db.prepare("UPDATE act_outbox SET state = 'sending', claimed_at = ? WHERE batch_id = ?").run(new Date().toISOString(), b.id);
    const a = await svc.undoBatch(ctx, b.id);
    const c = await svc.undoBatch(ctx, b.id);
    assert.equal(a.queued, true);
    assert.equal(c.queued, true);
    assert.equal(waits(), 1);
    db.prepare("UPDATE act_outbox SET state = 'sent' WHERE batch_id = ?").run(b.id);
    await svc.settleWaitingUndos(ctx);
    await svc.settleWaitingUndos(ctx);
    assert.equal(count("SELECT COUNT(*) AS n FROM act_batches WHERE op = 'undo'"), 1);
    assert.equal(patches().length, 1);
    await assert.rejects(svc.undoBatch(ctx, b.id), (e) => e.code === 'already_undone');
  });

  it('a press waiting on a claim from a run that stopped is applied once the claim is ten minutes old', async () => {
    const b = await svc.saveBatch(ctx, 'complete', [completeItem(9)], {});
    db.prepare("UPDATE act_outbox SET state = 'sending', claimed_at = ? WHERE batch_id = ?").run(new Date().toISOString(), b.id);
    await svc.undoBatch(ctx, b.id);
    assert.equal(await svc.settleWaitingUndos(ctx), 0, 'a fresh claim is still in flight');
    db.prepare('UPDATE act_outbox SET claimed_at = ? WHERE batch_id = ?').run(new Date(Date.now() - 11 * 60000).toISOString(), b.id);
    assert.equal(await svc.settleWaitingUndos(ctx), 1);
    assert.equal(stateOf(b.id), 'undone');
  });
});

describe('Undo after the toast is gone and after a failed write', () => {
  it('Recent lists the change with its undo window, and Undo from there puts it back', async () => {
    const b = await svc.saveBatch(ctx, 'complete', [completeItem(31)], {});
    await svc.runBatch(ctx, b.id);
    const row = (await svc.recentBatches(ctx.env, 36)).find((x) => x.id === b.id);
    assert.ok(row, 'listed in Recent');
    assert.equal(row.undone, false);
    assert.ok(Date.parse(row.undo_until) - Date.now() > 23 * 3600000, 'open for about 24 hours');
    assert.match(row.label, /complete/i);
    const out = await svc.undoBatch(ctx, b.id);
    await svc.runBatch(ctx, out.batch.id);
    assert.equal(stateOf(b.id), 'undone');
    assert.equal(patches().at(-1).body.completed, false);
  });

  it('undoing a write Blackbaud turned down cancels it and sends nothing', async () => {
    const b = await svc.saveBatch(ctx, 'complete', [completeItem(41)], {});
    db.prepare("UPDATE act_outbox SET state = 'failed', last_error = 'Blackbaud said no.' WHERE batch_id = ?").run(b.id);
    const out = await svc.undoBatch(ctx, b.id);
    assert.equal(out.cancelled, 1);
    assert.equal(out.batch, null);
    assert.equal(stateOf(b.id), 'undone');
    assert.equal(patches().length, 0);
  });

  it('a write that fails while an undo waits is still released, and the undo ends the change', async () => {
    const b = await svc.saveBatch(ctx, 'complete', [completeItem(51)], {});
    db.prepare("UPDATE act_outbox SET state = 'sending', claimed_at = ? WHERE batch_id = ?").run(new Date().toISOString(), b.id);
    await svc.undoBatch(ctx, b.id);
    db.prepare("UPDATE act_outbox SET state = 'failed', last_error = 'no' WHERE batch_id = ?").run(b.id);
    await svc.settleWaitingUndos(ctx);
    assert.equal(stateOf(b.id), 'undone');
    assert.equal(waits(), 0);
    assert.equal(patches().length, 0);
  });
});
