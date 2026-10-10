// Run with: npm test
//
// The Work Center's service layer against a real SQLite copy of db/work.sql (node:sqlite standing in for D1) and a stand-in for the
// upkeep route. Made-up ids only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const svc = await import('../functions/_lib/work/service.ts');
const entry = await import('../functions/_lib/work/entry.ts');
const route = await import('../functions/_lib/work/route.ts');
const outbox = await import('../functions/_lib/actions/outbox.ts');

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
let calls;
let refreshes = []; // what the stand-in sync worker was asked to refresh
let script; // (call, n) => result | undefined
let ctx;

function newCtx() {
  const repo = {
    async send(list) {
      calls.push(list);
      const results = [];
      for (const c of list) {
        const r = script(c, calls.length);
        if (r === 'stop') break;
        results.push(r);
      }
      const wait = results.length === 0 ? script.wait || 'Blackbaud did not answer. It will try again.' : undefined;
      return { results, wait, callsToday: 10 };
    },
    async refreshMirror(ids, tags) {
      refreshes.push({ ids, tags });
      return { ok: true, runId: 'r' + refreshes.length, maxCalls: ids.length * (tags ? 2 : 1) };
    },
    async partnersByIds(ids) {
      return ids.map((cid) => ({ cid, name: 'Partner ' + cid, place: 'Tampa, FL', lookup: 'L' + cid, holders: [], deceased: false }));
    },
    async doneActions() {
      return [];
    },
  };
  return { env: { DB: fakeD1(db) }, repo, actor: 'Pat Smith', email: 'pat@example.org' };
}

const okScript = (c) => {
  if (c.method === 'GET' && c.path.includes('last_modified')) return { ok: true, status: 200, body: { count: 0, value: [] } };
  if (c.method === 'POST' && c.path === '/constituent/v1/actions') return { ok: true, status: 200, body: { id: String(7000 + calls.length) } };
  return { ok: true, status: 200, body: {} };
};

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  calls = [];
  refreshes = [];
  script = okScript;
  ctx = newCtx();
});

const row = (o) => ({
  id: '1', cid: '100', due: '2026-10-01', typeRaw: 'RDD Action', type: 'RDD Action', category: 'Task/Other', summary: 'TY', fundraisers: ['9001'], fullDescription: '',
  pending: null, group: null, ty: true, later: null, partner: 'Partner 100', ...o,
});
const board = (rows) => ({ rows, people: {}, synced: '2026-10-09T09:00:00Z', orphans: 0, today: '2026-10-09' });
const createItem = (o = {}) => ({
  submissionId: o.sub || 's1', cid: '100', label: 'Partner 100 | call',
  steps: [{ op: 'create', body: { constituent_id: '100', date: '2026-10-08T00:00:00', type: 'RDD Action', category: 'Phone call', summary: 'Called about the gift', fundraisers: ['9001'] }, label: 'entry' }],
});

describe('due dates', () => {
  it('a new due date may be two weeks out, today is allowed, yesterday is not', () => {
    const today = svc.todayEt();
    const plus = (n) => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    assert.equal(svc.validDue(plus(14)), plus(14));
    assert.equal(svc.validDue(today), today);
    assert.throws(() => svc.validDue(plus(-1)), /Pick a due date/);
    assert.throws(() => svc.validDue('next week'), /Pick a due date/);
  });
  it('a completion date still stops at tomorrow', () => {
    const today = svc.todayEt();
    const plus = (n) => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    assert.throws(() => svc.validDate(plus(14)), /Pick a real day/);
  });
  it('reschedule to a fixed date two weeks out plans a batch', async () => {
    const today = svc.todayEt();
    const due = new Date(Date.parse(today + 'T12:00:00Z') + 14 * 86400000).toISOString().slice(0, 10);
    const plan = await svc.planBatch(ctx, { op: 'reschedule', ids: ['1'], due }, board([row({})]));
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0].steps[0].body.date, due + 'T00:00:00');
  });
});

describe('one gift is one thank-you', () => {
  const rows = [row({ id: '1', group: ['1', '2'] }), row({ id: '2', group: ['1', '2'] }), row({ id: '3', cid: '101' })];
  it('in the default mode one task is the thank-you and the other task only closes', async () => {
    const plan = await svc.planBatch(ctx, { op: 'thank', ids: ['1', '2'], how: 'letter' }, board(rows));
    const ops = plan.items.map((i) => i.steps.map((s) => s.op));
    assert.deepEqual(ops[0], ['patch', 'tag']);
    assert.deepEqual(ops[1], ['patch']);
    assert.equal(plan.items[1].steps[0].body.category, undefined);
    assert.equal(plan.items.flatMap((i) => i.steps).filter((s) => s.op === 'tag').length, 1);
  });
  it('in two-record mode one contact is created for the gift', async () => {
    db.prepare("INSERT INTO act_settings (key, value, updated_at) VALUES ('thank_mode', 'two', 'x')").run();
    const plan = await svc.planBatch(ctx, { op: 'thank', ids: ['1', '2'], how: 'call' }, board(rows));
    assert.equal(plan.items.flatMap((i) => i.steps).filter((s) => s.op === 'create').length, 1);
    assert.deepEqual(plan.items[1].steps.map((s) => s.op), ['patch']);
  });
  it('tasks about two different gifts each get their own thank-you', async () => {
    const plan = await svc.planBatch(ctx, { op: 'thank', ids: ['1', '3'], how: 'letter' }, board(rows));
    assert.equal(plan.items.flatMap((i) => i.steps).filter((s) => s.op === 'tag').length, 2);
  });
});

describe('the freshness check', () => {
  it('leaves out actions Blackbaud changed since the sync and says how many', async () => {
    script = (c) => (c.path.includes('last_modified') ? { ok: true, status: 200, body: { count: 1, value: [{ id: '2' }] } } : okScript(c));
    const plan = await svc.planBatch(ctx, { op: 'complete', ids: ['1', '2'] }, board([row({ id: '1' }), row({ id: '2' })]));
    assert.deepEqual(plan.items.map((i) => i.actionId), ['1']);
    assert.equal(plan.changed, 1);
    assert.equal(plan.reads, 1);
  });
  it('a failed read stops the batch with a try-again message and spends one call', async () => {
    script = () => ({ ok: false, status: 500, body: null });
    await assert.rejects(() => svc.planBatch(ctx, { op: 'complete', ids: ['1', '2', '3'] }, board([row({ id: '1' }), row({ id: '2' }), row({ id: '3' })])), /Try again/);
    assert.equal(calls.length, 1);
  });
  it('the last_modified window is Eastern clock time', () => {
    assert.equal(svc.etClock(new Date('2026-10-10T01:29:37Z')), '2026-10-09T21:29:00');
  });
});

describe('undo and enter again', () => {
  it('a contact undone before it was sent can be entered again', async () => {
    const first = await svc.saveBatch(ctx, 'create', [createItem()], {});
    assert.equal(first.n, 1);
    await svc.undoBatch(ctx, first.id);
    const again = await svc.saveBatch(ctx, 'create', [createItem()], {});
    assert.equal(again.n, 1);
  });
  it('a contact sent, undone and entered again goes through', async () => {
    const first = await svc.saveBatch(ctx, 'create', [createItem()], {});
    await svc.runBatch(ctx, first.id);
    const undo = await svc.undoBatch(ctx, first.id);
    assert.ok(undo.batch.id);
    await svc.runBatch(ctx, undo.batch.id);
    assert.equal(db.prepare("SELECT idem_key FROM act_outbox WHERE batch_id = ?").get(first.id).idem_key, null);
    const again = await svc.saveBatch(ctx, 'create', [createItem()], {});
    assert.equal(again.n, 1);
    assert.ok(again.id);
  });
  it('the same contact twice in a row is one contact', async () => {
    await svc.saveBatch(ctx, 'create', [createItem()], {});
    const dup = await svc.saveBatch(ctx, 'create', [createItem({ sub: 's2' })], {});
    assert.equal(dup.n, 0);
  });
  it('undo of a sent create with no saved number is held for a person, not marked undone', async () => {
    const b = await svc.saveBatch(ctx, 'create', [createItem()], {});
    db.prepare("UPDATE act_outbox SET state = 'sent', bb_id = NULL WHERE batch_id = ?").run(b.id);
    const out = await svc.undoBatch(ctx, b.id);
    assert.equal(out.unresolved, 1);
    assert.equal(db.prepare('SELECT state FROM act_outbox WHERE batch_id = ?').get(b.id).state, 'needs_human');
    assert.notEqual(db.prepare('SELECT state FROM act_batches WHERE id = ?').get(b.id).state, 'undone');
  });
  it('undo says the tags stay', async () => {
    const item = {
      actionId: '1', cid: '100', label: 'Partner 100 | TY',
      steps: [
        { op: 'patch', actionId: '1', body: { completed: true }, before: { completed: false } },
        { op: 'tag', actionId: '1', body: { category: 'Thanked' } },
      ],
    };
    const b = await svc.saveBatch(ctx, 'thank', [item], {});
    db.prepare("UPDATE act_outbox SET state = 'sent' WHERE batch_id = ?").run(b.id);
    const out = await svc.undoBatch(ctx, b.id);
    assert.equal(out.tagsStay, 1);
  });
});

describe('a double press', () => {
  it('the same request id returns the first batch and saves nothing new', async () => {
    const a = await svc.saveBatch(ctx, 'create', [createItem()], {}, { reqId: 'press-1' });
    const other = createItem({ sub: 's9' }); other.steps[0].body.summary = 'A different line';
    const b = await svc.saveBatch(ctx, 'create', [other], {}, { reqId: 'press-1' });
    assert.equal(b.id, a.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM act_batches').get().n, 1);
    const again = await svc.batchByReq(ctx.env, 'press-1');
    assert.equal(again.batch.id, a.id);
  });
  it('one contact for many partners entered twice enters each partner once', async () => {
    db.prepare("INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, active, updated_at) VALUES ('a@example.org', 'Owner One', 'rdd', '9001', 0, 1, 'RDD Action', 1, 'x')").run();
    const input = { owner: '9001', date: svc.todayEt(), channel: 'call', summary: 'Checked in', tags: [], constituent_ids: ['100', '101'] };
    const one = await entry.entryMany(ctx, input);
    assert.equal(one.created, 2);
    const two = await entry.entryMany(ctx, input);
    assert.equal(two.created, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE op = 'create'").get().n, 2);
  });
});

describe('the daily lane', () => {
  it('batches saved close together count each other, so the second one waits for tonight', async () => {
    db.prepare("INSERT INTO act_batches (id, op, actor, actor_email, params, n, calls_planned, calls_used, run_when, state, undo_until, created_at) VALUES ('x', 'complete', 'a', 'a', '{}', 1, 2395, 0, 'now', 'queued', 'z', 'y')").run();
    const items = Array.from({ length: 20 }, (_, i) => createItem({ sub: 's' + i })).map((it, i) => ({ ...it, steps: [{ ...it.steps[0], body: { ...it.steps[0].body, summary: 'Contact ' + i } }] }));
    const b = await svc.saveBatch(ctx, 'create', items, {});
    assert.equal(b.run_when, 'tonight');
  });
});

describe('sending', () => {
  const patchBatch = async (n = 1) => {
    const items = Array.from({ length: n }, (_, i) => ({ actionId: String(i + 1), cid: '100', label: 'Partner | TY', steps: [{ op: 'patch', actionId: String(i + 1), body: { completed: true }, before: { completed: false } }] }));
    return svc.saveBatch(ctx, 'complete', items, {});
  };
  it('asks the sync worker to refresh the changed actions after a batch, and meters the SKY calls', async () => {
    const b = await patchBatch(3);
    assert.equal(b.calls, 3 + 1 + 3); // 3 changes, 1 read-back, 3 refresh reads
    await svc.runBatch(ctx, b.id);
    assert.deepEqual(refreshes, [{ ids: ['1', '2', '3'], tags: false }]);
    const ev = db.prepare("SELECT detail FROM act_events WHERE kind = 'refresh'").get();
    assert.match(ev.detail, /up to 3 SKY calls/);
  });
  it('refreshes a tagged action with its tags and counts two calls for it', async () => {
    const items = [{ actionId: '7', cid: '100', label: 'P | TY', steps: [{ op: 'patch', actionId: '7', body: { completed: true }, before: { completed: false } }, { op: 'tag', actionId: '7', body: { category: 'Thanked', date: '2026-10-09T00:00:00' } }] }];
    const b = await svc.saveBatch(ctx, 'complete', items, {});
    assert.equal(b.calls, 2 + 1 + 2);
    await svc.runBatch(ctx, b.id);
    assert.deepEqual(refreshes, [{ ids: ['7'], tags: true }]);
  });
  it('a thank-you that makes a new action reads the new one with its tags and the old one plain', async () => {
    const items = [{ actionId: '8', cid: '100', label: 'P | TY', steps: [
      { op: 'create', body: { summary: 'Thank you letter' } },
      { op: 'tag', dep: 0, body: { category: 'Thanked' } },
      { op: 'patch', actionId: '8', body: { completed: true }, before: { completed: false } },
    ] }];
    const b = await svc.saveBatch(ctx, 'complete', items, {});
    assert.equal(b.calls, 3 + 1 + 3); // 3 steps, 1 read-back, new action with tags 2 + old action 1
    await svc.runBatch(ctx, b.id);
    const sorted = refreshes.map((r) => ({ n: r.ids.length, tags: r.tags })).sort((x, y) => Number(y.tags) - Number(x.tags));
    assert.deepEqual(sorted, [{ n: 1, tags: true }, { n: 1, tags: false }]);
    const tag = calls.find((c) => c.path === '/constituent/v1/actions/customfields');
    assert.ok(tag && tag.body.parent_id && tag.body.parent_id !== '8', 'the tag goes on the new action, not the old task');
  });
  it('stops after one round when the route sends nothing back', async () => {
    script = () => 'stop';
    const b = await patchBatch(3);
    const out = await svc.runBatch(ctx, b.id);
    assert.equal(out.held, 'wait');
    assert.equal(calls.length, 1);
    assert.equal(out.left, 3);
  });
  it('says limit when the route says the day is used up', async () => {
    script = () => 'stop';
    script.wait = "Blackbaud is at today's limit. This posts after the reset.";
    const b = await patchBatch(1);
    assert.equal((await svc.runBatch(ctx, b.id)).held, 'limit');
  });
  it('a 429 counts a try and stops the round; the fifth try needs a person', async () => {
    script = () => ({ ok: false, status: 429, body: null });
    const b = await patchBatch(1);
    for (let i = 0; i < 4; i++) {
      const out = await svc.runBatch(ctx, b.id);
      assert.equal(out.held, 'wait');
    }
    assert.equal(db.prepare('SELECT state, attempts FROM act_outbox WHERE batch_id = ?').get(b.id).state, 'queued');
    await svc.runBatch(ctx, b.id);
    assert.equal(db.prepare('SELECT state FROM act_outbox WHERE batch_id = ?').get(b.id).state, 'needs_human');
  });
  it('a refused change needs a person at once', async () => {
    script = () => ({ ok: false, status: 0, body: { refused: 'no rule' }, refused: 'no rule' });
    const b = await patchBatch(1);
    await svc.runBatch(ctx, b.id);
    assert.equal(db.prepare('SELECT state FROM act_outbox WHERE batch_id = ?').get(b.id).state, 'needs_human');
  });
  it('the read-back after a send asks for the Eastern clock', async () => {
    const b = await patchBatch(1);
    const lo = svc.etClock(new Date(Date.now() - 11 * 60000));
    await svc.runBatch(ctx, b.id);
    const hi = svc.etClock(new Date(Date.now() - 9 * 60000));
    const read = calls.flat().find((c) => c.method === 'GET' && c.path.includes('last_modified'));
    assert.ok(read, 'a read-back was sent');
    const t = read.path.match(/last_modified=([^&]+)/)[1];
    assert.ok(t >= lo && t <= hi, `${t} is between ${lo} and ${hi}`);
  });
  it('a send moves the row from sent to verified when Blackbaud lists it', async () => {
    script = (c) => (c.path.includes('last_modified') ? { ok: true, status: 200, body: { count: 1, value: [{ id: '1', completed: true }] } } : okScript(c));
    const b = await patchBatch(1);
    await svc.runBatch(ctx, b.id);
    assert.equal(db.prepare('SELECT state FROM act_outbox WHERE batch_id = ?').get(b.id).state, 'verified');
  });
});

describe('a create whose answer was lost', () => {
  const want = { type: 'RDD Action', date: '2026-10-08', summary: 'Called about the gift' };
  const existing = [{ id: '55', type: 'RDD Action', date: '2026-10-08T00:00:00', summary: 'Called about the gift', added: '2026-09-01T10:00:00' }];
  it('an older action that looks the same is not this contact', () => {
    assert.deepEqual(outbox.matchLostCreate(existing, want, { after: '2026-10-09T09:00' }), { ids: [], unsure: false });
  });
  it('an action added after the row was queued is', () => {
    const e = [{ ...existing[0], added: '2026-10-09T09:05:00' }];
    assert.deepEqual(outbox.matchLostCreate(e, want, { after: '2026-10-09T09:00' }).ids, ['55']);
  });
  it('an action that belongs to another row is skipped', () => {
    const e = [{ ...existing[0], added: '2026-10-09T09:05:00' }];
    assert.deepEqual(outbox.matchLostCreate(e, want, { after: '2026-10-09T09:00', skipIds: ['55'] }).ids, []);
  });
  it('a look-alike with no added time is held for a person', () => {
    assert.equal(outbox.matchLostCreate([{ ...existing[0], added: null }], want, { after: '2026-10-09T09:00' }).unsure, true);
  });
  it('two matches are both returned so the row goes to a person', () => {
    const e = [{ ...existing[0], added: '2026-10-09T09:05:00' }, { ...existing[0], id: '56', added: '2026-10-09T09:06:00' }];
    assert.equal(outbox.matchLostCreate(e, want, { after: '2026-10-09T09:00' }).ids.length, 2);
  });
});

describe('changes must come from the page', () => {
  const req = (method, headers = {}) => new Request('https://dash.favorintl.org/api/work/batches', { method, headers });
  it('reads are open to any caller that passes sign-in', () => assert.equal(route.sameSite(req('GET')), true));
  it('a post from another favorintl.org address is turned away', () => assert.equal(route.sameSite(req('POST', { Origin: 'https://gmc.favorintl.org' })), false));
  it('a post from the page itself is allowed', () => assert.equal(route.sameSite(req('POST', { Origin: 'https://dash.favorintl.org' })), true));
  it('a post with no Origin needs the page header or a key', () => {
    assert.equal(route.sameSite(req('POST')), false);
    assert.equal(route.sameSite(req('POST', { 'X-Hub-Request': '1' })), true);
    assert.equal(route.sameSite(req('POST', { Authorization: 'Bearer abc' })), true);
  });
});
