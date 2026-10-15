// Run with: npm test
//
// Recurring gifts: the reading of every schedule from the mirror, the five numbers on the page, the overlay of finished changes, and
// the edit and undo routes against a stand-in for the Blackbaud connection (the sender is injected, so nothing here can reach
// Blackbaud) and an in-memory hub database. Every name, id and amount is made up: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const read = await import('../functions/_lib/recurring/read.ts');
const svc = await import('../functions/_lib/recurring/service.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const fields = await import('../functions/_lib/actions/fields.ts');

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const day = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const SCHEMA = ['work.sql', 'work-gifts.sql', 'work-reminders.sql', 'recurring.sql'].map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8')).join('\n');

/* ------------------------------------------------------------------ the mirror */
let mirror;
const q = async (sql, params = []) => {
  readOnly(sql);
  return mirror.prepare(sql).all(...params);
};
function sched(id, cid, o = {}) {
  const status = o.status || 'Active';
  mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, gift_payment_method, constituent_record_id, gift_splits, raw_json) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, o.amount ?? 50, (o.start || day(-400)) + 'T00:00:00', 'RecurringGift', status, o.pm || 'CreditCard', cid, JSON.stringify([{ fund_id: '79' }]), '{}'
  );
  mirror.prepare('INSERT INTO recurring_schedules (gift_id, constituent_record_id, gift_status, amount, frequency, start_date, end_date, next_transaction_date, status_date, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    id, cid, status, o.amount ?? 50, o.freq || 'MONTHLY', o.start || day(-400), o.end || null, o.next === undefined ? day(20) : o.next, o.sdate || null, o.synced || TODAY + ' 05:00:00'
  );
}
let gid = 5000;
function pay(s, date, amount = 50, ref = null) {
  mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, gift_payment_method, constituent_record_id, linked_gift_id, gift_comments, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    String(gid++), amount, date + 'T00:00:00', 'RecurringGiftPayment', 'Active', 'CreditCard', '1', s, ref, JSON.stringify({ reference: ref || undefined, linked_gifts: [s] })
  );
}
function buildMirror() {
  gid = 5000;
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_type TEXT, first_name TEXT, last_name TEXT, deceased INTEGER DEFAULT 0, inactive INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT, gift_payment_method TEXT, gift_comments TEXT, constituent_record_id TEXT, gift_splits TEXT, linked_gift_id TEXT, raw_json TEXT);
    CREATE TABLE recurring_schedules (gift_id TEXT PRIMARY KEY, constituent_record_id TEXT, gift_status TEXT, amount REAL, frequency TEXT, start_date TEXT, end_date TEXT, next_transaction_date TEXT, status_date TEXT, annual_amount REAL, origin TEXT, gift_date_modified TEXT, status TEXT, detail TEXT, synced_at TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
    INSERT INTO fundraisers VALUES ('600', 'Pat', 'Care');
    INSERT INTO funds VALUES ('79', 'Where Needed Most');
  `);
  ['Ann Active', 'Dee Declined', 'Pete PastDue', 'Ed Ended', 'Hal Held', 'Olly Old', 'Pam PastEnd', 'Rae Recovered', 'Stan Soft'].forEach((n, i) => {
    const id = String(i + 1);
    mirror.prepare('INSERT INTO constituents (id, constituent_type, first_name, last_name, raw_json) VALUES (?,?,?,?,?)').run(id, 'Individual', n.split(' ')[0], n.split(' ')[1], JSON.stringify({ name: n, address: { city: 'Tampa', state: 'FL' } }));
    mirror.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run('as' + id, id, '600', 'Partner Care', null);
  });
  // 1: healthy, paid on the first of each of the last 12 months, bank draft
  sched('1001', '1', { amount: 100, pm: 'DirectDebit', start: day(-800) });
  for (let m = 0; m < 12; m++) pay('1001', day(-15 - m * 30), 100);
  pay('1001', day(-800), 100);
  // 2: a hard decline ten days ago, nothing since
  sched('1002', '2', { amount: 40 });
  pay('1002', day(-100), 40);
  pay('1002', day(-10), 0, 'HARDREJECT: Invalid account number.');
  // 3: active, next charge twelve days ago
  sched('1003', '3', { amount: 30, next: day(-12) });
  pay('1003', day(-45), 30);
  // 4: stopped 20 days ago after paying a month before
  sched('1004', '4', { amount: 20, status: 'Terminated', sdate: day(-20) });
  pay('1004', day(-50), 20);
  // 5: held
  sched('1005', '5', { amount: 15, status: 'Held', sdate: day(-5) });
  // 6: two years of giving
  sched('1006', '6', { amount: 25, start: day(-900) });
  pay('1006', day(-800), 25);
  pay('1006', day(-5), 25);
  // 7: active past its end date
  sched('1007', '7', { amount: 10, end: day(-30) });
  pay('1007', day(-35), 10);
  // 8: declined, then a later payment went through
  sched('1008', '8', { amount: 60 });
  pay('1008', day(-40), 0, 'SOFTREJECT: Insufficient funds.');
  pay('1008', day(-8), 60);
  // 9: a decline from before July of last year is out of the window
  sched('1009', '9', { amount: 35 });
  pay('1009', day(-3), 35);
}

describe('the schedules and the five numbers', () => {
  beforeEach(buildMirror);
  it('reads every schedule with its partner, method, fund, holder and twelve months', async () => {
    const out = await read.loadRecurring(q, { today: TODAY });
    assert.equal(out.rows.length, 9);
    const r = out.rows.find((x) => x.id === '1001');
    assert.equal(r.name, 'Ann Active');
    assert.equal(r.method, 'Bank');
    assert.equal(r.fund, 'Where Needed Most');
    assert.equal(r.holder, 'Pat Care');
    assert.equal(r.months.length, 12);
    assert.equal(r.paid, 13);
    assert.equal(r.paid12, 12);
    assert.equal(r.annual, 1200);
  });
  it('counts active, declined, stopped in 90 days, past due and past end the way the page says', async () => {
    const { stats } = await read.loadRecurring(q, { today: TODAY });
    assert.equal(stats.active, 7, 'every active schedule: 1, 2, 3, 6, 7, 8, 9');
    assert.equal(stats.card + stats.bank, stats.active);
    assert.equal(stats.bank, 1);
    assert.equal(stats.declined, 2, 'schedules 2 and 8 had a rejected charge since July');
    assert.equal(stats.stopped90, 1);
    assert.equal(stats.pastDue, 1);
    assert.equal(stats.pastEnd, 1);
    assert.equal(stats.held, 1);
    assert.equal(stats.scheduledEach, 100 + 40 + 30 + 25 + 10 + 60 + 35);
    assert.equal(stats.twoYears, 2, 'schedules 1 and 6 first paid over two years ago');
  });
  it('a decline that a later payment cleared stays counted as declined but is marked recovered, and sorts below an open decline', async () => {
    const { rows } = await read.loadRecurring(q, { today: TODAY });
    assert.equal(rows[0].id, '1002', 'the open decline comes first');
    const rec = rows.find((x) => x.id === '1008');
    assert.equal(rec.flags.declined, true);
    assert.equal(rec.declineRecovered, true);
  });
  it('a schedule that was stopped long ago is not in the 90 day count', async () => {
    mirror.prepare("UPDATE recurring_schedules SET status_date = ? WHERE gift_id = '1004'").run(day(-200));
    const { stats } = await read.loadRecurring(q, { today: TODAY });
    assert.equal(stats.stopped90, 0);
  });
  it('declineSince is the first of July of the current or the last year', () => {
    assert.equal(read.declineSince('2026-10-14'), '2026-07-01');
    assert.equal(read.declineSince('2027-02-03'), '2026-07-01');
  });
  it('the mirror reader never carries a write word', () => {
    for (const sql of [read.SCHEDULES_SQL, read.MONTHLY_SQL, read.LIFETIME_SQL, read.REJECTS_SQL, read.PAID30_SQL, read.FUNDS_BY_ID_SQL]) assert.doesNotMatch(sql, /insert|update|replace|upsert|delete|drop|alter|create/i);
  });
  it('payments in the last 30 days are counted by schedule and dollars', async () => {
    const { stats } = await read.loadRecurring(q, { today: TODAY });
    assert.equal(stats.paid30Schedules, 4, 'schedules 1, 6, 8 and 9 each have a payment in the last 30 days');
  });
});

/* ------------------------------------------------------------------ the overlay and the change views */
describe('overlay', () => {
  const raw = (o = {}) => ({ id: '1001', cid: '1', status: 'Active', amount: 50, freq: 'MONTHLY', start: '', ends: '', nxt: '', sdate: '', synced: '2026-10-10 05:00:00', pm: 'CreditCard', splits: null, ...o });
  const change = (o = {}) => ({ id: 'c1', gift_id: '1001', cid: '1', op: 'amount', before_json: JSON.stringify({ amount: 50 }), after_json: JSON.stringify({ amount: 75, frequency: 'MONTHLY', status: 'Active' }), asked_by: null, state: 'done', error: null, undo_of: null, batch_id: null, actor: 'Pat', actor_email: 'pat@example.org', at: '2026-10-11T12:00:00.000Z', ...o });
  it('lays a finished change over a row synced before it, and leaves a row synced after it alone', () => {
    assert.equal(svc.overlay([raw()], [change()], TODAY)[0].amount, 75);
    assert.equal(svc.overlay([raw({ synced: '2026-10-12 05:00:00' })], [change()], TODAY)[0].amount, 50);
  });
  it('a failed or lost change changes nothing; a stop reads as stopped', () => {
    assert.equal(svc.overlay([raw()], [change({ state: 'failed' })], TODAY)[0].amount, 50);
    const stop = change({ op: 'status', after_json: JSON.stringify({ status: 'Terminated' }) });
    const out = svc.overlay([raw()], [stop], TODAY)[0];
    assert.equal(out.status, 'Terminated');
    assert.equal(out.sdate, '2026-10-11');
  });
  it('words each kind of change', () => {
    assert.equal(svc.summaryOf('amount', { amount: 50 }, { amount: 75.5 }), 'Amount $50 to $75.5');
    assert.equal(svc.summaryOf('frequency', { frequency: 'MONTHLY' }, { frequency: 'QUARTERLY' }), 'Frequency monthly to quarterly');
    assert.equal(svc.summaryOf('status', { status: 'Active' }, { status: 'Held' }), 'Held');
    assert.equal(svc.summaryOf('status', { status: 'Held' }, { status: 'Active' }), 'Resumed');
    assert.equal(svc.summaryOf('status', { status: 'Active' }, { status: 'Terminated' }), 'Stopped');
  });
  it('Undo shows for the person who made the change or an admin, within 24 hours, never on a stop or an undo', () => {
    const now = Date.parse('2026-10-11T20:00:00Z');
    const rows = [change(), change({ id: 'c2', op: 'status', after_json: JSON.stringify({ status: 'Terminated' }) }), change({ id: 'c3', undo_of: 'c1' })];
    const mine = svc.changeViews(rows, { email: 'pat@example.org', admin: false }, now).get('1001');
    assert.equal(mine.find((v) => v.id === 'c1').undoable, false, 'c1 has been undone by c3');
    assert.equal(mine.find((v) => v.id === 'c2').undoable, false, 'a stop is final');
    const other = svc.changeViews([change()], { email: 'sam@example.org', admin: false }, now).get('1001');
    assert.equal(other[0].undoable, false);
    assert.equal(svc.changeViews([change()], { email: 'sam@example.org', admin: true }, now).get('1001')[0].undoable, true);
    assert.equal(svc.changeViews([change()], { email: 'pat@example.org', admin: false }, now + 25 * 3600_000).get('1001')[0].undoable, false);
  });
});

/* ------------------------------------------------------------------ the edit and undo routes */
let hub;
let calls;
let nextId;
let realFetch;
let ctx;
let sent;
const CODES = fields.FALLBACK_CODES;

function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args, sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { for (const s of list) db.prepare(s.sql).run(...(s.args || [])); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
}
function newCtx(scope, email = 'pat@example.org') {
  const repo = {
    async send(list) {
      calls.push(list);
      const results = list.map((c) => {
        if (c.method === 'GET' && c.path.startsWith('/constituent/v1/actiontypes')) return { ok: true, status: 200, body: { value: CODES.types } };
        if (c.method === 'GET' && c.path.includes('/customfields/categories')) return { ok: true, status: 200, body: { value: [] } };
        if (c.method === 'GET') return { ok: true, status: 200, body: { count: 0, value: [] } };
        return { ok: true, status: 200, body: { id: String(nextId++) } };
      });
      return { results, callsToday: 10 };
    },
    async refreshMirror(ids, tags) { return { ok: true, runId: 'r', maxCalls: ids.length * (tags ? 2 : 1) }; },
    async synced() { return '2026-10-10T09:00:00Z'; },
    async loadBoard() { return { rows: [], people: {}, synced: '', orphans: 0, today: TODAY }; },
    async modifiedOf() { return new Map(); },
  };
  return { env: { DB: fakeD1(hub), MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/d1/query' }, repo, actor: 'Pat Care', email, scope };
}
const PC = { role: 'partner_care', fid: '600', fids: new Set(['600']), all: false, email: 'pat@example.org', name: 'Pat Care', team: 'Partner Care' };

/** The stand-in for favorintl.org's route: it keeps one state per schedule and answers like the real route does. */
function sender(over = {}) {
  const state = new Map();
  const base = (id) => state.get(id) || { id, constituent_id: '1', amount: 50, frequency: 'MONTHLY', status: 'Active' };
  const fn = async (_env, input) => {
    sent.push(input);
    if (over.fail) return over.fail;
    const before = base(input.id);
    const after = { ...before };
    if (input.op === 'amount') after.amount = input.amount;
    if (input.op === 'frequency') after.frequency = input.frequency;
    if (input.op === 'status') after.status = input.status;
    state.set(input.id, after);
    return { ok: true, before, after };
  };
  return fn;
}

describe('editing a schedule', () => {
  beforeEach(() => {
    buildMirror();
    hub = new DatabaseSync(':memory:');
    hub.exec(SCHEMA);
    calls = [];
    sent = [];
    nextId = 9000;
    ctx = newCtx(PC);
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://mirror.test')) throw new Error('A test reached the network: ' + url);
      const { sql, params } = JSON.parse(init.body);
      let rows;
      if (/FROM constituents WHERE id = \?1/.test(sql)) rows = [{ t: 'Individual', f: 'Ann', l: 'Partner', p: null, o: null, d: 0 }];
      else if (/json_extract\(raw_json, '\$\.completed'\) = 1/.test(sql) && /id IN/.test(sql) && !/constituent_record_id/.test(sql)) rows = [];
      else rows = mirror.prepare(sql).all(...params);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  const done = () => { globalThis.fetch = realFetch; };

  it('lists the schedules for the desk and refuses a role outside it', async () => {
    try {
      const out = await svc.recurringResponse(ctx);
      assert.equal(out.rows.length, 9);
      assert.equal(out.canEdit, true);
      assert.equal(out.stats.active, 7);
      const dir = { ...ctx, scope: { role: 'director', fid: '501', fids: new Set(['501']), all: false, email: 'a@b.c', name: 'A', team: 'RDD' } };
      await assert.rejects(svc.recurringResponse(dir), /admin desk/);
    } finally { done(); }
  });

  it('an amount change goes to the sender once, is saved with before and after, and shows at once over the mirror', async () => {
    try {
      const send = sender();
      const out = await svc.editSchedule(ctx, { giftId: '1002', op: 'amount', amount: '$1,500', askedBy: 'Phone call', req: 'a1' }, send);
      assert.equal(out.state, 'done');
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0], { id: '1002', op: 'amount', amount: 1500 });
      const row = hub.prepare('SELECT * FROM act_recurring_changes').get();
      assert.equal(row.state, 'done');
      assert.equal(row.asked_by, 'Phone call');
      assert.equal(JSON.parse(row.after_json).amount, 1500);
      assert.ok(!/token/i.test(JSON.stringify(row)), 'no payment token is stored');
      const list = await svc.recurringResponse(ctx);
      const r = list.rows.find((x) => x.id === '1002');
      assert.equal(r.amount, 1500);
      assert.match(r.changes[0].summary, /Amount \$50 to \$1,500/);
      assert.equal(r.changes[0].undoable, true);
    } finally { done(); }
  });

  it('it files one completed Information Update on the partner as a batch', async () => {
    try {
      const out = await svc.editSchedule(ctx, { giftId: '1002', op: 'frequency', frequency: 'quarterly', askedBy: 'Email', note: 'Wants fewer charges', req: 'a2' }, sender());
      assert.ok(out.batch && out.batch.id);
      const s = await import('../functions/_lib/work/service.ts');
      for (let i = 0; i < 10; i++) { const r = await s.runBatch(ctx, out.batch.id); if (!r.left) break; }
      const made = calls.flat().filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
      assert.equal(made.length, 1);
      assert.equal(made[0].body.type, 'RESERVED (Information Update)');
      assert.equal(made[0].body.completed, true);
      assert.equal(made[0].body.category, 'Email');
      assert.match(made[0].body.description, /Wants fewer charges/);
      assert.match(made[0].body.description, /Partner asked by email/);
      assert.match(made[0].body.summary, /Frequency monthly to quarterly/);
    } finally { done(); }
  });

  it('refuses bad input before anything is sent', async () => {
    try {
      const send = sender();
      const bad = async (input, re) => { await assert.rejects(svc.editSchedule(ctx, input, send), re); };
      await bad({ giftId: 'x', op: 'amount', amount: 10 }, /Pick a schedule/);
      await bad({ giftId: '1002', op: 'delete' }, /Change the amount/);
      await bad({ giftId: '1002', op: 'amount', amount: '0.50' }, /between \$1 and \$250,000/);
      await bad({ giftId: '1002', op: 'amount', amount: 'abc' }, /between \$1/);
      await bad({ giftId: '1002', op: 'amount', amount: 40 }, /already has/);
      await bad({ giftId: '1002', op: 'frequency', frequency: 'DAILY' }, /Pick weekly/);
      await bad({ giftId: '1002', op: 'frequency', frequency: 'MONTHLY' }, /already runs/);
      await bad({ giftId: '1002', op: 'status', status: 'Active' }, /already active/);
      await bad({ giftId: '1002', op: 'status', status: 'Paused' }, /Pick Active/);
      await bad({ giftId: '1004', op: 'amount', amount: 25 }, /has stopped/);
      await bad({ giftId: '100999', op: 'amount', amount: 25 }, /not on the list/);
      assert.equal(sent.length, 0);
      assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_recurring_changes').get().n, 0);
    } finally { done(); }
  });

  it('a refusal from Blackbaud is saved as failed and shown as not saved; a lost answer is saved as lost', async () => {
    try {
      await assert.rejects(svc.editSchedule(ctx, { giftId: '1002', op: 'amount', amount: 75, req: 'f1' }, sender({ fail: { ok: false, code: 'not_applied', message: 'Blackbaud accepted the change but the schedule still reads the old value.' } })), /still reads the old value/);
      await assert.rejects(svc.editSchedule(ctx, { giftId: '1002', op: 'amount', amount: 76, req: 'f2' }, sender({ fail: { ok: false, lost: true, message: 'Blackbaud did not answer.' } })), /did not answer/);
      const states = hub.prepare('SELECT state FROM act_recurring_changes ORDER BY at').all().map((r) => r.state);
      assert.deepEqual(states, ['failed', 'lost']);
      const list = await svc.recurringResponse(ctx);
      const r = list.rows.find((x) => x.id === '1002');
      assert.equal(r.amount, 40, 'nothing was applied over the mirror');
      assert.ok(r.changes.every((c) => !c.undoable));
    } finally { done(); }
  });

  it('a press repeated with the same req changes the schedule once', async () => {
    try {
      const send = sender();
      await svc.editSchedule(ctx, { giftId: '1002', op: 'amount', amount: 75, req: 'same' }, send);
      const again = await svc.editSchedule(ctx, { giftId: '1002', op: 'amount', amount: 75, req: 'same' }, send);
      assert.equal(again.repeat, true);
      assert.equal(sent.length, 1);
    } finally { done(); }
  });

  it('Undo puts the old value back through the sender, once, and only for the person who made the change or an admin', async () => {
    try {
      const send = sender();
      await svc.editSchedule(ctx, { giftId: '1002', op: 'amount', amount: 75, req: 'u1' }, send);
      const change = hub.prepare('SELECT id FROM act_recurring_changes').get();
      const other = newCtx({ ...PC, email: 'sam@example.org' }, 'sam@example.org');
      await assert.rejects(svc.undoChange(other, { id: change.id }, send), /person who made a change/);
      const out = await svc.undoChange(ctx, { id: change.id, req: 'u2' }, send);
      assert.equal(out.state, 'done');
      assert.deepEqual(sent[1], { id: '1002', op: 'amount', amount: 50 });
      await assert.rejects(svc.undoChange(ctx, { id: change.id, req: 'u3' }, send), /cannot be undone|already undone/);
      const list = await svc.recurringResponse(ctx);
      assert.equal(list.rows.find((x) => x.id === '1002').amount, 50);
    } finally { done(); }
  });

  it('Undo is closed after 24 hours and for a stop', async () => {
    try {
      const send = sender();
      await svc.editSchedule(ctx, { giftId: '1002', op: 'amount', amount: 75, req: 'o1' }, send);
      const change = hub.prepare('SELECT id FROM act_recurring_changes').get();
      hub.prepare('UPDATE act_recurring_changes SET at = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3600_000).toISOString(), change.id);
      await assert.rejects(svc.undoChange(ctx, { id: change.id }, send), /24 hours/);
      await svc.editSchedule(ctx, { giftId: '1003', op: 'status', status: 'Terminated', req: 'o2' }, send);
      const stop = hub.prepare("SELECT id FROM act_recurring_changes WHERE op = 'status'").get();
      await assert.rejects(svc.undoChange(ctx, { id: stop.id }, send), /final/);
    } finally { done(); }
  });

  it('a test account reads the page and cannot write; a role test may touch only its one record', async () => {
    try {
      const tester = newCtx({ role: 'admin', fid: null, fids: new Set(), all: true, email: 'tester@favorintl.org', name: 'T', team: '' }, 'tester@favorintl.org');
      const list = await svc.recurringResponse(tester);
      assert.equal(list.canEdit, false);
      const send = sender();
      await assert.rejects(svc.editSchedule(tester, { giftId: '1002', op: 'amount', amount: 75 }, send), /cannot write to Blackbaud/);
      await assert.rejects(svc.undoChange(tester, { id: 'x' }, send), /cannot write to Blackbaud/);
      const run = { ...ctx, testCid: '27202' };
      await assert.rejects(svc.editSchedule(run, { giftId: '1002', op: 'amount', amount: 75 }, send), /one test record/);
      assert.equal(sent.length, 0);
    } finally { done(); }
  });

  it('the live sender refuses to send without the Blackbaud connection and never reaches the network', async () => {
    try {
      const out = await svc.liveSender({ DB: null }, { id: '1002', op: 'amount', amount: 75 });
      assert.equal(out.ok, false);
      assert.match(out.message, /not set up/);
    } finally { done(); }
  });
});
