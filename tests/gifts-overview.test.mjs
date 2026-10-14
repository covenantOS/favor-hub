// Run with: npm test
//
// Gifts > Overview (GET /api/gifts/overview): the gift day on one screen. Pickup days, the chart's weekdays and buckets and the
// $25,000 cap, online gifts waiting for approval, FavorOS deposits (testers left out), receipts, HQTY letters, a failing part
// answering null while the rest answer, and the access gate. A real SQLite copy stands in for the Blackbaud copy and for the hub's
// tables. Made-up data only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const ov = await import('../functions/_lib/gifts/overview.ts');
const route = await import('../functions/api/gifts/overview.ts');

const SCHEMA = ['gift-entry.sql', 'gift-photo.sql', 'gift-photo-coding.sql', 'online-gifts.sql', 'receipts.sql']
  .map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8'))
  .concat([
    `CREATE TABLE act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
     CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT);
     CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT, role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0);
     INSERT INTO hub_users VALUES ('ada@example.org','Ada Admin','admin',0),('sam@example.org','Sam Staff','staff',0),('pat@example.org','Pat Desk','staff',0);`,
  ])
  .join(';\n');

const COPY = `
  CREATE TABLE gifts (id TEXT PRIMARY KEY, date_added TEXT, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_payment_method TEXT, gift_splits TEXT, gift_comments TEXT, constituent_record_id TEXT, raw_json TEXT);
  CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, organization_name TEXT, first_name TEXT, last_name TEXT);
  CREATE TABLE appeals (id TEXT PRIMARY KEY, appeal_id TEXT, appeal_description TEXT, appeal_category TEXT);
  CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, run_at TEXT, sync_status TEXT);
  INSERT INTO sync_log (table_name, run_at, sync_status) VALUES ('__complete__','2026-10-14 15:00:00','success'),('__complete__','2026-10-14 21:11:19','success');
  INSERT INTO constituents VALUES ('c1','1001',NULL,'Ada','Sample'),('c2','1002',NULL,'Bo','Example'),('c3','1003','Linden Ridge Church',NULL,NULL),('27202','1','Test Record',NULL,NULL);
`;

// Wednesday 2026-10-14, noon Eastern.
const NOW = new Date('2026-10-14T16:00:00Z');
let copy;
let n;
function addGift({ day = '2026-10-13', cents = 5000, method = 'PersonalCheck', type = 'Donation', batch = null, comments = null, cid = 'c1', added = null, src = null } = {}) {
  n += 1;
  const raw = { id: String(n), date: day + 'T00:00:00' };
  if (batch) raw.batch_number = batch;
  if (src) raw.source = src;
  copy
    .prepare('INSERT INTO gifts (id, date_added, gift_amount, gift_date, gift_type, gift_payment_method, gift_splits, gift_comments, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(String(n), added || day + 'T08:00:00-04:00', cents / 100, day + 'T00:00:00', type, method, '[]', comments, cid, JSON.stringify(raw));
  return String(n);
}
const q = async (sql, params = []) => {
  assert.doesNotMatch(sql, /insert|update|replace|upsert|delete|drop|alter|create/i, 'the mirror refuses this text');
  return copy.prepare(sql).all(...params);
};

let env;
const realFetch = globalThis.fetch;
const realError = console.error;
beforeEach(() => {
  n = 0;
  copy = memoryD1().db;
  copy.exec(COPY);
  env = { DB: memoryD1(), MIRROR_API_KEY: 'test-key' };
  env.DB.exec(SCHEMA);
  globalThis.fetch = async (_url, init) => {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify(await q(b.sql, b.params)), { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

const deposit = (id, { status = 'open', at = '2026-10-14T13:00:00Z', email = 'pat@example.org' } = {}) =>
  env.DB.db
    .prepare("INSERT INTO ge_deposit (id, kind, name, deposit_date, tape_cents, tape_count, status, created_by, created_by_email, created_at) VALUES (?, 'regular', ?, '2026-10-14', 0, 0, ?, 'Pat', ?, ?)")
    .run(id, 'Regular Mail ' + id, status, email, at);
const gg = (id, dep, status, cents = 1000) =>
  env.DB.db
    .prepare("INSERT INTO ge_gift (id, deposit_id, seq, status, amount_cents, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, ?, 'Pat', '2026-10-14T13:00:00Z', '2026-10-14T13:00:00Z')")
    .run(id, dep, status, cents);

const noLetters = async () => ({ shaped: { rows: [] } });
const run = (o = {}) => ov.giftsOverview(env, q, { now: NOW, hqty: noLetters, ...o });

describe('pickup days and weekdays', () => {
  it('Monday, Wednesday and Friday are pickup days', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(ov.isPickupDay), [false, true, false, true, false, true, false]);
  });

  it('answers the day, the weekday and whether mail comes', async () => {
    const out = await run();
    assert.equal(out.ok, true);
    assert.equal(out.today, '2026-10-14');
    assert.equal(out.weekday, 'Wednesday');
    assert.equal(out.pickupDay, true);
    assert.equal((await run({ now: new Date('2026-10-15T16:00:00Z') })).pickupDay, false);
    assert.equal((await run({ now: new Date('2026-10-17T16:00:00Z') })).weekday, 'Saturday');
  });

  it('uses the Eastern day, not the UTC day', async () => {
    const out = await run({ now: new Date('2026-10-15T02:30:00Z') });
    assert.equal(out.today, '2026-10-14');
  });

  it('the last 7 weekdays skip weekends, and a Monday looks back to Friday', () => {
    assert.deepEqual(ov.lastWeekdays('2026-10-14'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13']);
    assert.equal(ov.lastWeekdays('2026-10-12').at(-1), '2026-10-09');
    assert.equal(ov.lastWeekdays('2026-10-17').at(-1), '2026-10-16', 'a Saturday looks back to Friday');
  });
});

describe('the chart', () => {
  it('buckets checks and cash, card and online, and other by payment method', () => {
    assert.equal(ov.bucketOf('PersonalCheck'), 'checks');
    assert.equal(ov.bucketOf('Cash'), 'checks');
    for (const m of ['CreditCard', 'DirectDebit', 'PayPal']) assert.equal(ov.bucketOf(m), 'card');
    for (const m of ['Other', 'Stock', 'DonorAdvisedFund', '', null, undefined]) assert.equal(ov.bucketOf(m), 'other');
  });

  it('sums by gift date for the 7 weekdays through yesterday, with the cap and the raw stock gift', async () => {
    addGift({ day: '2026-10-13', cents: 10000 });
    addGift({ day: '2026-10-13', cents: 2500, method: 'Cash' });
    addGift({ day: '2026-10-13', cents: 7500, method: 'CreditCard' });
    addGift({ day: '2026-10-13', cents: 1200, method: 'DirectDebit' });
    addGift({ day: '2026-10-13', cents: 400, method: 'PayPal' });
    addGift({ day: '2026-10-12', cents: 9000000, method: 'Other' });
    addGift({ day: '2026-10-12', cents: 100, method: 'Stock' });
    addGift({ day: '2026-10-09', cents: 3000 });
    // Left out: today, a weekend, older than 7 weekdays, a pledge payment type, a zero or negative amount.
    addGift({ day: '2026-10-14', cents: 99900 });
    addGift({ day: '2026-10-10', cents: 99900 });
    addGift({ day: '2026-10-02', cents: 99900 });
    addGift({ day: '2026-10-13', cents: 99900, type: 'RecurringGiftPayment' });
    addGift({ day: '2026-10-13', cents: 0 });
    addGift({ day: '2026-10-13', cents: -5000 });
    const { chart } = await run();
    assert.equal(chart.capCents, 2500000);
    assert.deepEqual(chart.days.map((d) => d.date), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13']);
    assert.deepEqual(chart.days.at(-1), { date: '2026-10-13', weekday: 'Tuesday', checksCents: 12500, cardCents: 9100, otherCents: 0 });
    assert.deepEqual(chart.days.at(-2), { date: '2026-10-12', weekday: 'Monday', checksCents: 0, cardCents: 0, otherCents: 9000100 }, 'raw sum, not capped');
    assert.equal(chart.days.find((d) => d.date === '2026-10-09').checksCents, 3000);
    assert.equal(chart.days[0].checksCents + chart.days[0].cardCents + chart.days[0].otherCents, 0, 'a day with no gifts is zeros');
  });
});

describe('mail and review', () => {
  it('counts deposits started today and deposits still open, and leaves testers and removed deposits out', async () => {
    deposit('d1', { status: 'open' });
    deposit('d2', { status: 'committed' });
    deposit('d3', { status: 'removed' });
    deposit('d4', { status: 'open', email: 'tester@favorintl.org' });
    deposit('d5', { status: 'needs_person', at: '2026-10-12T13:00:00Z' });
    deposit('d6', { status: 'created', at: '2026-10-12T13:00:00Z' });
    // 9 PM Eastern on the 14th is already the 15th in UTC. It still started today.
    deposit('d7', { status: 'open', at: '2026-10-15T01:00:00Z' });
    const out = await run();
    assert.deepEqual(out.mail, { startedToday: 3, openDeposits: 3 });
  });

  it('a tester sees the test deposits', async () => {
    deposit('d1');
    deposit('d4', { email: 'tester@favorintl.org' });
    assert.equal((await run({ tester: true })).mail.startedToday, 2);
    assert.equal((await run()).mail.startedToday, 1);
  });

  it('review counts held, review and failed gifts in open deposits only', async () => {
    deposit('d1', { status: 'open' });
    deposit('d2', { status: 'committed' });
    deposit('d4', { status: 'open', email: 'tester@favorintl.org' });
    gg('g1', 'd1', 'review');
    gg('g2', 'd1', 'held');
    gg('g3', 'd1', 'failed');
    gg('g4', 'd1', 'ready');
    gg('g5', 'd1', 'removed');
    gg('g6', 'd2', 'review');
    gg('g7', 'd4', 'review');
    assert.deepEqual((await run()).review, { waiting: 3 });
    assert.deepEqual((await run({ tester: true })).review, { waiting: 4 });
  });
});

describe('online gifts waiting for approval', () => {
  it('lists the website, monthly and form-batch gifts with no review, newest first, and counts them all', async () => {
    const a = addGift({ method: 'CreditCard', cents: 5000, comments: 'Gift via favorintl.org', cid: 'c1', added: '2026-10-13T09:00:00-04:00' });
    addGift({ method: 'CreditCard', cents: 7000, comments: 'Gift via favorintl.org', cid: 'c2', added: '2026-10-12T09:00:00-04:00' });
    addGift({ method: 'DirectDebit', cents: 2500, type: 'RecurringGiftPayment', comments: 'Gift via favorintl.org', src: 'realtime-web', cid: 'c2', added: '2026-10-14T07:00:00-04:00' });
    addGift({ method: 'CreditCard', cents: 1500, batch: 'DF-2026-0042', cid: 'c3', added: '2026-10-11T09:00:00-04:00' });
    env.DB.db.prepare("INSERT INTO act_settings (key, value, updated_at) VALUES ('og:bb', ?, '2026-10-14T10:00:00Z')").run(JSON.stringify({ at: '2026-10-14T10:00:00Z', waiting: [], formBatches: ['DF-2026-0042'] }));
    // Left out: already approved, the test record, older than 14 days, a batch the page does not list.
    env.DB.db.prepare("INSERT INTO og_review (gift_key, source, chosen_fund, state, approved_by, approved_at) VALUES (?, 'website', '79', 'approved', 'pat@example.org', '2026-10-14T12:00:00Z')").run('re:' + a);
    addGift({ method: 'CreditCard', comments: 'Gift via favorintl.org', cid: '27202' });
    addGift({ method: 'CreditCard', comments: 'Gift via favorintl.org', day: '2026-09-20' });
    addGift({ method: 'CreditCard', batch: 'DF-2026-0099' });
    const { online } = await run();
    assert.equal(online.toApprove, 3);
    assert.equal(online.cents, 2500 + 7000 + 1500);
    assert.deepEqual(online.rows.map((r) => [r.kind, r.cents, r.cid]), [['Monthly', 2500, 'c2'], ['Website', 7000, 'c2'], ['One time', 1500, 'c3']]);
    assert.deepEqual(Object.keys(online.rows[0]).sort(), ['cents', 'cid', 'date', 'kind', 'name']);
  });

  it('shows only the 5 newest rows but counts every gift', async () => {
    for (let i = 1; i <= 8; i++) addGift({ method: 'CreditCard', cents: 1000, comments: 'Gift via favorintl.org', added: `2026-10-13T0${i}:00:00-04:00` });
    const { online } = await run();
    assert.equal(online.toApprove, 8);
    assert.equal(online.cents, 8000);
    assert.equal(online.rows.length, 5);
  });

  it('a tester also sees the test record', async () => {
    addGift({ method: 'CreditCard', comments: 'Gift via favorintl.org', cid: '27202' });
    assert.equal((await run()).online.toApprove, 0);
    assert.equal((await run({ tester: true })).online.toApprove, 1);
  });
});

describe('Blackbaud month, receipts, letters and freshness', () => {
  it('reads this month from the month page and the freshness from the copy', async () => {
    for (let i = 0; i < 3; i++) addGift({ day: '2026-10-09', cents: 10000, batch: 'GFT-2026-1103', added: '2026-10-12T08:14:31.43-04:00' });
    addGift({ day: '2026-09-30', cents: 5000, batch: 'GFT-2026-1070', added: '2026-09-30T08:14:31.43-04:00' });
    const out = await run();
    assert.deepEqual(out.blackbaud, { deposits: 1, items: 3, cents: 30000 });
    assert.equal(out.asOf, '2026-10-14T21:11:19Z');
  });

  it('receipts left follow the open print file; the last file is the newest one not cancelled', async () => {
    assert.deepEqual((await run()).receipts, { left: 0, lastFile: null });
    const ins = env.DB.db.prepare("INSERT INTO rcp_batches (id, kind, letter_date, appeal_code, count, gifts, marked, status, pdf_key, letters, copy, created_at) VALUES (?, ?, '2026-10-12', 'Y26A-TY', ?, ?, ?, ?, 'k', '[]', '{}', ?)");
    ins.run('b1', 'new', 40, 52, 52, 'done', '2026-10-05T14:00:00Z');
    ins.run('b2', 'new', 30, 41, 10, 'marking', '2026-10-12T14:00:00Z');
    ins.run('b3', 'reprint', 5, 5, 0, 'reprint', '2026-10-13T14:00:00Z');
    ins.run('b4', 'new', 9, 9, 0, 'cancelled', '2026-10-14T09:00:00Z');
    assert.deepEqual((await run()).receipts, { left: 31, lastFile: { at: '2026-10-12T14:00:00Z', gifts: 41, marked: 10 } });
    env.DB.db.prepare("UPDATE rcp_batches SET status = 'printing' WHERE id = 'b2'").run();
    assert.equal((await run()).receipts.left, 30, 'before marking starts, the letters in the file');
  });

  it('letters count this month and show the 5 newest with their state', async () => {
    const row = (i, date, state) => ({ giftId: String(i), amount: 5000 + i, date, fund: 'Where Needed Most', partner: { name: 'Partner ' + i, place: '' }, state });
    const rows = [row(1, '2026-10-12', 'write'), row(2, '2026-10-11', 'printed'), row(3, '2026-10-09', 'mailed'), row(4, '2026-10-08', 'cannot'), row(5, '2026-10-07', 'signed'), row(6, '2026-10-02', 'write'), row(7, '2026-09-28', 'write')];
    let seen;
    const out = await run({ hqty: async (_e, _q, o) => ((seen = o), { shaped: { rows } }) });
    assert.deepEqual(seen, { today: '2026-10-14', since: '2026-10-01' });
    assert.equal(out.letters.month, 6);
    assert.equal(out.letters.rows.length, 5);
    assert.deepEqual(out.letters.rows[0], { name: 'Partner 1', cents: 500100, fund: 'Where Needed Most', date: '2026-10-12', state: 'write', stateLabel: 'To write' });
  });
});

describe('each part answers on its own', () => {
  it('a failing part is null and the others still answer', async () => {
    console.error = () => {};
    addGift({ day: '2026-10-13', cents: 10000 });
    const failing = async (sql, params) => {
      if (/GROUP BY d, pm/.test(sql)) throw new Error('mirror 500');
      return q(sql, params);
    };
    const out = await ov.giftsOverview(env, failing, { now: NOW, hqty: async () => { throw new Error('desk down'); } });
    assert.equal(out.chart, null);
    assert.equal(out.letters, null);
    assert.equal(out.ok, true);
    assert.deepEqual(out.mail, { startedToday: 0, openDeposits: 0 });
    assert.deepEqual(out.review, { waiting: 0 });
    assert.ok(out.blackbaud && out.receipts && out.online);
    assert.equal(out.asOf, '2026-10-14T21:11:19Z');
  });

  it('with the copy down, only FavorOS parts answer', async () => {
    console.error = () => {};
    const down = async () => { throw new Error('mirror down'); };
    const out = await ov.giftsOverview(env, down, { now: NOW, hqty: noLetters });
    assert.equal(out.blackbaud, null);
    assert.equal(out.online, null);
    assert.equal(out.chart, null);
    assert.equal(out.asOf, null);
    assert.ok(out.mail && out.review && out.receipts && out.letters);
  });
});

describe('the route', () => {
  const ADA = { email: 'ada@example.org', name: 'Ada Admin', role: 'admin' };
  const SAM = { email: 'sam@example.org', name: 'Sam Staff', role: 'staff' };
  const PAT = { email: 'pat@example.org', name: 'Pat Desk', role: 'staff' };
  const call = (who) => {
    const headers = who ? { 'x-hub-email': who.email, 'x-hub-name': who.name, 'x-hub-role': who.role } : {};
    return route.onRequestGet({ request: new Request('https://favor-hub.example.org/api/gifts/overview', { headers }), env, params: {}, waitUntil: () => {} });
  };

  it('403 without gift entry access, 401 signed out, 200 for an admin and for a person given access', async () => {
    console.error = () => {};
    assert.equal((await call(SAM)).status, 403);
    assert.equal((await call(null)).status, 401);
    const r = await call(ADA);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.deepEqual(Object.keys(body).sort(), ['asOf', 'blackbaud', 'chart', 'letters', 'mail', 'ok', 'online', 'pickupDay', 'receipts', 'review', 'today', 'weekday']);
    assert.equal(body.chart.capCents, 2500000);
    env.DB.db.prepare("INSERT INTO ge_person (email, access, posting) VALUES ('pat@example.org', 1, 0)").run();
    assert.equal((await call(PAT)).status, 200);
  });

  it('leaves the test user\'s deposits out of what a real admin sees', async () => {
    console.error = () => {};
    const now = new Date().toISOString();
    deposit('d1', { at: now });
    deposit('d4', { at: now, email: 'tester@favorintl.org' });
    assert.equal((await (await call(ADA)).json()).mail.startedToday, 1);
  });
});
