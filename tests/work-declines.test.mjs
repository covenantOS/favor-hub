// Run with: npm test
//
// Declines: the reading of declined recurring payments and zeroed gifts from the mirror, the state of each row (open, paid since,
// schedule ended, closed by a person), and the follow-up write against stand-ins for Blackbaud and the hub database. Every name,
// id and amount is made up: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const dec = await import('../functions/_lib/work/declines.ts');
const svc = await import('../functions/_lib/work/declines-svc.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const fields = await import('../functions/_lib/actions/fields.ts');

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const day = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const SCHEMA = ['work.sql', 'work-gifts.sql', 'work-reminders.sql', 'work-declines.sql'].map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8')).join('\n');

describe('cleanReason and kindOf', () => {
  it('drops the HARD or SOFT prefix and closes up spaces', () => {
    assert.equal(dec.cleanReason('HARDREJECT: Please call the number on the back of your card.  Your bank requested that we do not honor this card.'), 'Please call the number on the back of your card. Your bank requested that we do not honor this card.');
    assert.equal(dec.cleanReason('SOFTREJECT: Insufficient funds in the account.'), 'Insufficient funds in the account.');
    assert.equal(dec.cleanReason(null), '');
  });
  it('a $0 payment is hard or soft by its prefix; a rejected payment kept at full amount is its own kind; a $0 donation is zeroed', () => {
    assert.equal(dec.kindOf({ amount: 0, type: 'RecurringGiftPayment', ref: 'HARDREJECT: Invalid account number.' }), 'hard');
    assert.equal(dec.kindOf({ amount: 0, type: 'RecurringGiftPayment', ref: 'SOFTREJECT: Try again.' }), 'soft');
    assert.equal(dec.kindOf({ amount: 50, type: 'Donation', ref: 'HARDREJECT: Invalid account number.' }), 'full');
    assert.equal(dec.kindOf({ amount: 0, type: 'Donation', ref: 'returned check' }), 'zeroed');
    assert.equal(dec.kindOf({ amount: 25, type: 'Donation', ref: 'Thank you' }), null);
  });
  it('words a payment method', () => {
    assert.equal(dec.methodWord('CreditCard'), 'Card');
    assert.equal(dec.methodWord('DirectDebit'), 'Bank');
  });
});

describe('stateOf', () => {
  const base = { kind: 'hard', scheduleStatus: 'Active', paidSince: null, date: '2026-10-01', status: 'open' };
  it('open until something changes it', () => {
    assert.equal(dec.stateOf(base), 'open');
    assert.equal(dec.stateOf({ ...base, paidSince: '2026-10-09' }), 'paid');
    assert.equal(dec.stateOf({ ...base, paidSince: '2026-09-01' }), 'open');
    assert.equal(dec.stateOf({ ...base, scheduleStatus: 'Terminated' }), 'ended');
    assert.equal(dec.stateOf({ ...base, status: 'fixed' }), 'done');
    assert.equal(dec.stateOf({ ...base, kind: 'zeroed', scheduleStatus: 'Terminated' }), 'open');
  });
});

/* ------------------------------------------------------------------ the mirror */
let mirror;
const q = async (sql, params = []) => {
  readOnly(sql);
  return mirror.prepare(sql).all(...params);
};
function addGift(id, cid, amount, date, type, ref, extra = {}) {
  mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, gift_payment_method, gift_comments, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, amount, date + 'T00:00:00', type, extra.status || 'Active', extra.pm || 'CreditCard', ref || null, cid, JSON.stringify({ reference: ref || undefined, linked_gifts: extra.sched ? [extra.sched] : undefined })
  );
}
function buildMirror() {
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_type TEXT, first_name TEXT, last_name TEXT, deceased INTEGER DEFAULT 0, inactive INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT, gift_payment_method TEXT, gift_comments TEXT, constituent_record_id TEXT, raw_json TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
    CREATE TABLE phones (id TEXT PRIMARY KEY, constituent_record_id TEXT, phone_number TEXT, is_primary INTEGER DEFAULT 1, do_not_call INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE emails (id TEXT PRIMARY KEY, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER DEFAULT 1, do_not_email INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE addresses (id TEXT PRIMARY KEY, constituent_record_id TEXT, address_lines TEXT, do_not_mail INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 1, is_inactive INTEGER DEFAULT 0);
    INSERT INTO fundraisers VALUES ('600', 'Pat', 'Care');
  `);
  const people = ['Hank Hard', 'Sally Soft', 'Paula Paid', 'Edna Ended', 'Zed Zeroed', 'Fiona Full', 'Nora NoPhone', 'Old Oldest'];
  people.forEach((n, i) => {
    const id = String(i + 1);
    mirror.prepare('INSERT INTO constituents (id, constituent_type, first_name, last_name, raw_json) VALUES (?,?,?,?,?)').run(id, 'Individual', n.split(' ')[0], n.split(' ')[1], JSON.stringify({ name: n, address: { city: 'Tampa', state: 'FL' } }));
    mirror.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run('as' + id, id, '600', 'Partner Care', null);
    if (n !== 'Nora NoPhone') mirror.prepare('INSERT INTO phones (id, constituent_record_id, phone_number) VALUES (?,?,?)').run('ph' + id, id, '(555) 010-00' + String(id).padStart(2, '0'));
    mirror.prepare('INSERT INTO emails (id, constituent_record_id, email_address) VALUES (?,?,?)').run('em' + id, id, `p${id}@example.org`);
    mirror.prepare('INSERT INTO addresses (id, constituent_record_id, address_lines) VALUES (?,?,?)').run('ad' + id, id, '1 Test Way');
  });
  // schedules
  addGift('s1', '1', 25, '2024-01-01', 'RecurringGift', null);
  addGift('s2', '2', 40, '2024-01-01', 'RecurringGift', null);
  addGift('s3', '3', 30, '2024-01-01', 'RecurringGift', null);
  addGift('s4', '4', 20, '2024-01-01', 'RecurringGift', null, { status: 'Active' });
  mirror.prepare("UPDATE gifts SET gift_status = 'Terminated' WHERE id = 's4'").run();
  addGift('s7', '7', 15, '2024-01-01', 'RecurringGift', null);
  // declines
  addGift('101', '1', 0, day(-2), 'RecurringGiftPayment', 'HARDREJECT: Invalid account number.', { sched: 's1' });
  addGift('102', '1', 0, day(-32), 'RecurringGiftPayment', 'HARDREJECT: Invalid account number.', { sched: 's1' });
  addGift('103', '2', 0, day(-1), 'RecurringGiftPayment', 'SOFTREJECT: Insufficient funds in the account.', { sched: 's2' });
  addGift('104', '3', 0, day(-10), 'RecurringGiftPayment', 'SOFTREJECT: Try again.', { sched: 's3' });
  addGift('105', '3', 30, day(-3), 'RecurringGiftPayment', null, { sched: 's3' });
  addGift('106', '4', 0, day(-5), 'RecurringGiftPayment', 'HARDREJECT: Stolen or lost card.', { sched: 's4' });
  addGift('107', '5', 0, day(-6), 'Donation', 'returned check', { pm: 'PersonalCheck' });
  addGift('108', '6', 50, day(-4), 'Donation', 'HARDREJECT: Invalid account number.');
  addGift('109', '7', 0, day(-3), 'RecurringGiftPayment', 'HARDREJECT: Please call.', { sched: 's7' });
  addGift('110', '8', 0, day(-200), 'RecurringGiftPayment', 'HARDREJECT: Old.', { sched: 's7' });
  addGift('111', '2', 40, day(-30), 'RecurringGiftPayment', null, { sched: 's2' });
}

describe('the mirror SQL passes the endpoint refusal rule', () => {
  it('has none of the words the mirror refuses', () => {
    for (const s of [dec.DECLINED_SQL, dec.SCHEDULE_SQL, dec.PAID_SQL, dec.HOLDERS_SQL]) assert.doesNotThrow(() => readOnly(s));
  });
});

describe('loadDeclines against the mirror', () => {
  beforeEach(buildMirror);
  it('lists every decline in the window with its kind, reason, schedule and attempts', async () => {
    const rows = await dec.loadDeclines(q, { today: TODAY, follow: [] });
    const by = Object.fromEntries(rows.map((r) => [r.giftId, r]));
    assert.deepEqual(Object.keys(by).sort(), ['101', '103', '104', '106', '107', '108', '109']);
    assert.equal(by['101'].kind, 'hard');
    assert.equal(by['101'].reason, 'Invalid account number.');
    assert.equal(by['101'].amount, 25);
    assert.equal(by['101'].attempts, 2);
    assert.equal(by['101'].method, 'Card');
    assert.equal(by['103'].kind, 'soft');
    assert.equal(by['107'].kind, 'zeroed');
    assert.equal(by['108'].kind, 'full');
    assert.equal(by['108'].amount, 50);
    assert.deepEqual(by['101'].holders, ['Pat Care']);
    assert.equal(by['101'].age, 2);
    assert.ok(!('110' in by), 'a decline older than the window is left off');
    assert.ok(!('102' in by), 'an earlier decline on the same schedule counts as an attempt, not a second row');
  });
  it('a later payment on the schedule makes the decline paid, a terminated schedule makes it ended', async () => {
    const rows = await dec.loadDeclines(q, { today: TODAY, follow: [] });
    const by = Object.fromEntries(rows.map((r) => [r.giftId, r]));
    assert.equal(by['104'].state, 'paid');
    assert.equal(by['104'].paidSince, day(-3));
    assert.equal(by['106'].state, 'ended');
    assert.equal(by['101'].state, 'open');
    assert.equal(by['103'].state, 'open', 'a payment before the decline does not clear it');
  });
  it('shows a phone only when the partner may be called, and lists newest first', async () => {
    const rows = await dec.loadDeclines(q, { today: TODAY, follow: [] });
    assert.equal(rows.find((r) => r.giftId === '101').phone, '(555) 010-0001');
    assert.equal(rows.find((r) => r.giftId === '109').phone, null, 'a partner with no number on file');
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date);
    mirror.prepare("UPDATE phones SET do_not_call = 1 WHERE constituent_record_id = '1'").run();
    const again = await dec.loadDeclines(q, { today: TODAY, follow: [] });
    assert.equal(again.find((r) => r.giftId === '101').phone, null);
  });
  it('the latest follow-up decides the status, and an open one after a close reopens the row', async () => {
    const f = (gift, status, at, how = 'call') => ({ gift_id: gift, how, outcome: 'talked', status, line: '', actor: 'Pat Care', at });
    let rows = await dec.loadDeclines(q, { today: TODAY, follow: [f('101', 'fixed', day(-1) + 'T10:00:00Z')] });
    assert.equal(rows.find((r) => r.giftId === '101').state, 'done');
    rows = await dec.loadDeclines(q, { today: TODAY, follow: [f('101', 'fixed', day(-1) + 'T10:00:00Z'), f('101', 'open', TODAY + 'T10:00:00Z')] });
    assert.equal(rows.find((r) => r.giftId === '101').state, 'open');
    assert.equal(rows.find((r) => r.giftId === '101').steps, 2);
  });
});

/* ------------------------------------------------------------------ logging a follow-up */
let hub;
let calls;
let nextId;
let realFetch;
let ctx;
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
function newCtx(scope) {
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
  return { env: { DB: fakeD1(hub), MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/d1/query' }, repo, actor: 'Pat Care', email: 'pat@example.org', scope };
}
const PC = { role: 'partner_care', fid: '600', fids: new Set(['600']), all: false, email: 'pat@example.org', name: 'Pat Care', team: 'Partner Care' };

describe('logging a follow-up', () => {
  beforeEach(() => {
    buildMirror();
    hub = new DatabaseSync(':memory:');
    hub.exec(SCHEMA);
    calls = [];
    nextId = 9000;
    ctx = newCtx(PC);
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://mirror.test')) return realFetch(url, init);
      const { sql, params } = JSON.parse(init.body);
      let rows;
      if (/FROM constituents WHERE id = \?1/.test(sql)) rows = [{ t: 'Individual', f: 'Ann', l: 'Partner', p: null, o: null, d: 0 }];
      else if (/json_extract\(raw_json, '\$\.completed'\) = 1/.test(sql) && /id IN/.test(sql) && !/constituent_record_id/.test(sql)) rows = [];
      else rows = mirror.prepare(sql).all(...params);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const created = () => calls.flat().filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
  async function run(id) {
    const s = await import('../functions/_lib/work/service.ts');
    for (let i = 0; i < 10; i++) { const r = await s.runBatch(ctx, id); if (!r.left) return r; }
  }

  it('lists the declines with the counts the tab shows', async () => {
    const out = await svc.declinesResponse(ctx);
    assert.equal(out.stats.hard, 2, 'd1 and d7 are the hard declines still open; d4 sits on an ended schedule');
    assert.equal(out.stats.soft, 1);
    assert.equal(out.stats.other, 2);
    assert.equal(out.stats.paid, 1);
  });

  it('a call writes one Information Update, completed, with the decline in the description', async () => {
    const out = await svc.logFollowUp(ctx, { giftId: '101', how: 'call', outcome: 'talked', status: 'open', line: 'New card coming', req: 'a1' });
    await run(out.batch.id);
    const c = created();
    assert.equal(c.length, 1);
    assert.equal(c[0].body.type, 'RESERVED (Information Update)');
    assert.equal(c[0].body.category, 'Phone call');
    assert.equal(c[0].body.completed, true);
    assert.equal(c[0].body.outcome, 'Successful');
    assert.equal(c[0].body.constituent_id, '1');
    assert.deepEqual(c[0].body.fundraisers, ['600']);
    assert.match(c[0].body.description, /Gift 101/);
    assert.match(c[0].body.description, /New card coming/);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_declines').get().n, 1);
  });

  it('closing the follow-up takes the row off the open list; Undo puts it back', async () => {
    const out = await svc.logFollowUp(ctx, { giftId: '101', how: 'call', outcome: 'talked', status: 'fixed', req: 'a2' });
    await run(out.batch.id);
    let list = await svc.declinesResponse(ctx);
    assert.equal(list.rows.find((r) => r.giftId === '101').state, 'done');
    assert.equal(list.stats.closedWeek, 1);
    hub.prepare("UPDATE act_batches SET state = 'undone' WHERE id = ?").run(out.batch.id);
    list = await svc.declinesResponse(ctx);
    assert.equal(list.rows.find((r) => r.giftId === '101').state, 'open');
  });

  it('left a message logs an unsuccessful call, keeps the row open and sets a reminder', async () => {
    const out = await svc.logFollowUp(ctx, { giftId: '103', how: 'call', outcome: 'left', status: 'fixed', req: 'a3' });
    await run(out.batch.id);
    assert.equal(created()[0].body.outcome, 'Unsuccessful');
    assert.equal(hub.prepare('SELECT status, outcome FROM act_declines').get().status, 'open', 'a message left never closes the decline');
    assert.equal(hub.prepare("SELECT COUNT(*) n FROM act_reminders WHERE kind = 'message'").get().n, 1);
  });

  it('a text carries the Texted tag; a note needs words and is a task', async () => {
    const t = await svc.logFollowUp(ctx, { giftId: '101', how: 'text', req: 'a4' });
    await run(t.batch.id);
    assert.equal(created()[0].body.category, 'Phone call');
    assert.ok(calls.flat().find((c) => c.path === '/constituent/v1/actions/customfields' && c.body && c.body.category === 'Texted'));
    await assert.rejects(svc.logFollowUp(ctx, { giftId: '101', how: 'note', req: 'a5' }), /Write what happened/);
    const n = await svc.logFollowUp(ctx, { giftId: '103', how: 'note', status: 'unreachable', line: 'Number disconnected', req: 'a6' });
    await run(n.batch.id);
    assert.equal(created()[1].body.category, 'Task/Other');
    assert.equal(created()[1].body.direction, undefined);
  });

  it('refuses a step the partner has nothing on file for, a decline not on the list and a role outside the desk', async () => {
    await assert.rejects(svc.logFollowUp(ctx, { giftId: '109', how: 'call', req: 'b2' }), /No phone number/);
    await assert.rejects(svc.logFollowUp(ctx, { giftId: '999', how: 'note', line: 'x', req: 'b3' }), /not on the list/);
    const dir = { ...ctx, scope: { role: 'director', fid: '501', fids: new Set(['501']), all: false, email: 'a@b.c', name: 'A', team: 'RDD' } };
    await assert.rejects(svc.declinesResponse(dir), /admin desk/);
    await assert.rejects(svc.logFollowUp(dir, { giftId: '101', how: 'note', line: 'x' }), /admin desk/);
  });

  it('a press repeated with the same req saves one action', async () => {
    const a = await svc.logFollowUp(ctx, { giftId: '101', how: 'email', req: 'same' });
    await svc.logFollowUp(ctx, { giftId: '101', how: 'email', req: 'same' }).catch(() => null);
    await run(a.batch.id);
    assert.equal(created().length, 1);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_declines').get().n, 1);
  });

  it('a person with no Blackbaud fundraiser id logs the action without a fundraiser', async () => {
    const desk = { ...ctx, scope: { role: 'admin', fid: null, fids: new Set(), all: false, email: 'pat@example.org', name: 'Desk', team: 'Operations' } };
    const out = await svc.logFollowUp(desk, { giftId: '101', how: 'email', req: 'c1' });
    ctx = desk;
    await run(out.batch.id);
    assert.equal(created()[0].body.fundraisers, undefined);
  });

  it('a role test may log on its one test record without a decline', async () => {
    const t = { ...ctx, testCid: '27202' };
    const out = await svc.logFollowUp(t, { giftId: '1', cid: '27202', how: 'note', line: 'test', req: '101' });
    ctx = t;
    await run(out.batch.id);
    assert.equal(created()[0].body.constituent_id, '27202');
    await assert.rejects(svc.logFollowUp(t, { giftId: '1', cid: '5', how: 'note', line: 'test', req: '103' }), /not on the list|test record/);
  });
});
