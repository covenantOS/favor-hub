// Run with: npm test
//
// Gift entry, the month of mail deposits: one row per Blackbaud batch (typed in Blackbaud or sent from FavorOS), cash and check counts, a
// FavorOS deposit shown once, the default month, and the access gate. A real SQLite copy stands in for the Blackbaud copy (gifts, appeals,
// sync_log) and for FavorOS's own tables. Made-up data only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const month = await import('../functions/_lib/gifts/month.ts');
const monthRoute = await import('../functions/api/gift-entry/month.ts');
const store = await import('../functions/_lib/gifts/store.ts');
const intake = await import('../functions/_lib/actions/intake.ts');

const SCHEMA = ['gift-entry.sql', 'gift-photo.sql', 'gift-photo-coding.sql']
  .map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8'))
  .concat([
    `CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT);
     CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT, role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0);
     INSERT INTO hub_users VALUES ('ada@example.org','Ada Admin','admin',0),('sam@example.org','Sam Staff','staff',0),('pat@example.org','Pat Desk','staff',0);`,
  ])
  .join(';\n');

// The Blackbaud copy: the columns the month query reads.
const COPY = `
  CREATE TABLE gifts (id TEXT PRIMARY KEY, date_added TEXT, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_payment_method TEXT, gift_splits TEXT, raw_json TEXT);
  CREATE TABLE appeals (id TEXT PRIMARY KEY, appeal_id TEXT, appeal_description TEXT, appeal_category TEXT);
  CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, run_at TEXT, sync_status TEXT);
  INSERT INTO appeals VALUES ('2355','L26A-AD','Direct Mail, October 2026 Appeal, Active Donors','Direct Mail Appeal'),
    ('3001','A26-ACQ','Acquisition, Sample List','Acquisition'),
    ('3002','G26-FND','Foundation gift, Sample Trust','Foundation Gift'),
    ('3003','W200-GRAN','White Mail, Unidentified Motivation, Grant','White Mail');
  INSERT INTO sync_log (table_name, run_at, sync_status) VALUES ('__complete__','2026-10-14 15:00:00','success'),('__complete__','2026-10-14 21:11:19','success'),('dailyDocket','2026-10-14 23:00:00','success'),('__complete__','2026-10-14 23:30:00','error');
`;

let copy;
let n;
function addGift(batch, { day = '2026-10-09', added = '2026-10-12T08:14:31.43-04:00', method = 'PersonalCheck', cents = 5000, type = 'Donation', appeal = '2355' } = {}) {
  n += 1;
  const raw = { id: String(n), batch_number: batch, date_added: added, date: day + 'T00:00:00' };
  if (!batch) delete raw.batch_number;
  copy
    .prepare('INSERT INTO gifts (id, date_added, gift_amount, gift_date, gift_type, gift_payment_method, gift_splits, raw_json) VALUES (?,?,?,?,?,?,?,?)')
    .run(String(n), added, cents / 100, day + 'T00:00:00', type, method, JSON.stringify([{ id: 's' + n, appeal_id: appeal, fund_id: '79' }]), JSON.stringify(raw));
}
const many = (count, batch, o = {}) => {
  for (let i = 0; i < count; i++) addGift(batch, o);
};

/** A stand-in for the mirror's query endpoint. */
const q = async (sql, params = []) => {
  assert.doesNotMatch(sql, /insert|update|replace|upsert|delete|drop|alter|create/i, 'the mirror refuses this text');
  return copy.prepare(sql).all(...params);
};

let env;
const realFetch = globalThis.fetch;
beforeEach(() => {
  n = 0;
  copy = memoryD1().db;
  copy.exec(COPY);
  env = { DB: memoryD1(), MIRROR_API_KEY: 'test-key' };
  env.DB.exec(SCHEMA);
  // The route reads the copy through fetch (the mirror helper). Answer it from the in-memory copy.
  globalThis.fetch = async (_url, init) => {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify(await q(b.sql, b.params)), { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ADA = { email: 'ada@example.org', name: 'Ada Admin', role: 'admin' };
const SAM = { email: 'sam@example.org', name: 'Sam Staff', role: 'staff' };
const PAT = { email: 'pat@example.org', name: 'Pat Desk', role: 'staff' };
const call = (who, path = '/api/gift-entry/month') => {
  const headers = who ? { 'x-hub-email': who.email, 'x-hub-name': who.name, 'x-hub-role': who.role } : {};
  return monthRoute.onRequestGet({ request: new Request('https://favor-hub.example.org' + path, { headers }), env, params: {}, waitUntil: () => {} });
};

describe('one row per Blackbaud batch', () => {
  it('groups gifts by batch, counts cash and checks, and takes the gift date most gifts carry', async () => {
    many(3, 'GFT-2026-1103', { cents: 10000 });
    addGift('GFT-2026-1103', { method: 'Cash', cents: 2500 });
    addGift('GFT-2026-1103', { method: 'Cash', cents: 500 });
    addGift('GFT-2026-1103', { day: '2026-10-08', cents: 1000 });
    many(2, 'GFT-2026-1110', { day: '2026-10-12', added: '2026-10-13T07:38:43.833-04:00', cents: 123456 });
    const out = await month.monthDeposits(q, '2026-10', '2026-10');
    assert.deepEqual(out.deposits.map((d) => d.batch), ['GFT-2026-1110', 'GFT-2026-1103'], 'newest first');
    const b = out.deposits[1];
    assert.equal(b.items, 6);
    assert.equal(b.cash, 2);
    assert.equal(b.checks, 4);
    assert.equal(b.totalCents, 3 * 10000 + 2500 + 500 + 1000);
    assert.equal(b.giftDate, '2026-10-09');
    assert.equal(b.addedDate, '2026-10-12');
    assert.equal(b.source, 'blackbaud');
    assert.equal(b.enteredBy, '');
    assert.equal(b.approved, true);
    assert.equal(b.kind, 'Regular');
    assert.deepEqual(out.totals, { deposits: 2, items: 8, totalCents: 3 * 10000 + 3000 + 1000 + 2 * 123456 });
  });

  it('leaves out card, recurring, online and unbatched gifts, and batch numbers that are not mail numbers', async () => {
    addGift('GFT-2026-1103');
    addGift('GFT-2026-1103', { method: 'CreditCard', cents: 99900 });
    addGift('GFT-2026-1104', { method: 'DirectDebit', type: 'RecurringGiftPayment' });
    addGift('GFT-2026-1105', { method: 'CreditCard' });
    addGift('GFT-2026-1106', { method: 'Other' });
    addGift(null);
    addGift('WEB-2026-0004');
    const out = await month.monthDeposits(q, '2026-10', '2026-10');
    assert.deepEqual(out.deposits.map((d) => [d.batch, d.items, d.totalCents]), [['GFT-2026-1103', 1, 5000]]);
  });

  it('a batch counts in the month it was entered, not the month of its gift date', async () => {
    many(2, 'GFT-2026-1080', { day: '2026-09-30', added: '2026-10-01T08:18:28.617-04:00' });
    many(2, 'GFT-2026-1074', { day: '2026-09-28', added: '2026-09-29T08:00:00.000-04:00' });
    many(1, 'GFT-2026-1115', { day: '2026-10-30', added: '2026-11-02T08:00:00.000-05:00' });
    const oct = await month.monthDeposits(q, '2026-10', '2026-10');
    assert.deepEqual(oct.deposits.map((d) => [d.batch, d.giftDate, d.addedDate]), [['GFT-2026-1080', '2026-09-30', '2026-10-01']]);
    const nov = await month.monthDeposits(q, '2026-11', '2026-11');
    assert.deepEqual(nov.deposits.map((d) => d.batch), ['GFT-2026-1115']);
    const span = await month.monthDeposits(q, '2026-09', '2026-11');
    assert.equal(span.totals.deposits, 3);
  });

  it('a December month reaches January 1 and no further', async () => {
    addGift('GFT-2026-1300', { added: '2026-12-31T23:30:00.000-05:00', day: '2026-12-31' });
    addGift('GFT-2027-0001', { added: '2027-01-01T08:00:00.000-05:00', day: '2026-12-31' });
    assert.deepEqual((await month.monthDeposits(q, '2026-12', '2026-12')).deposits.map((d) => d.batch), ['GFT-2026-1300']);
    assert.equal(month.nextMonthStart('2026-12'), '2027-01-01');
    assert.equal(month.nextMonthStart('2026-02'), '2026-03-01');
  });

  it('reads the kind from the appeals of the gifts in the batch', async () => {
    many(3, 'GFT-2026-1201', { appeal: '3001' });
    many(2, 'GFT-2026-1202', { appeal: '3002' });
    many(2, 'GFT-2026-1203', { appeal: '3003' });
    many(3, 'GFT-2026-1204', { appeal: '2355' });
    addGift('GFT-2026-1204', { appeal: '3001' });
    const kinds = Object.fromEntries((await month.monthDeposits(q, '2026-10', '2026-10')).deposits.map((d) => [d.batch, d.kind]));
    assert.deepEqual(kinds, { 'GFT-2026-1201': 'Acquisition', 'GFT-2026-1202': 'Grant', 'GFT-2026-1203': 'Grant', 'GFT-2026-1204': 'Regular' });
  });

  it('still lists the batches when the kind query fails, and when the copy has no freshness', async () => {
    addGift('GFT-2026-1103');
    const flaky = async (sql, params) => {
      if (/json_each\(g\.gift_splits\)/.test(sql)) throw new Error('mirror 500');
      if (/sync_log/.test(sql)) throw new Error('mirror 500');
      return q(sql, params);
    };
    const out = await month.monthDeposits(flaky, '2026-10', '2026-10');
    assert.equal(out.deposits[0].kind, 'Regular');
    assert.equal(out.asOf, null);
  });

  it('asOf is the last finished sync of the copy', async () => {
    addGift('GFT-2026-1103');
    assert.equal((await month.monthDeposits(q, '2026-10', '2026-10')).asOf, '2026-10-14T21:11:19Z');
  });

  it('an empty month is an empty list with zero totals', async () => {
    const out = await month.monthDeposits(q, '2026-10', '2026-10');
    assert.deepEqual(out.deposits, []);
    assert.deepEqual(out.totals, { deposits: 0, items: 0, totalCents: 0 });
  });
});

async function favorosDeposit({ who = ADA, kind = 'regular', date = '2026-10-09', gifts = [], batch = null, status = 'open', createdAt = null } = {}) {
  const d = await store.createDeposit(env, { name: who.name, email: who.email }, { kind, date, tapeCents: 10000 * Math.max(gifts.length, 1), tapeCount: Math.max(gifts.length, 1) });
  gifts.forEach((g, i) => {
    env.DB.db
      .prepare('INSERT INTO ge_gift (id, deposit_id, seq, status, kind, amount_cents, gift_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(`${d.id}_${i}`, d.id, i + 1, g.status || 'sent', g.kind || 'check', g.cents ?? 10000, date, who.name, new Date().toISOString(), new Date().toISOString());
  });
  env.DB.db.prepare('UPDATE ge_deposit SET status = ?, bb_batch_number = ?, created_at = COALESCE(?, created_at) WHERE id = ?').run(status, batch, createdAt, d.id);
  return d;
}

describe('FavorOS deposits merge into the month', () => {
  it('a deposit sent from FavorOS shows once, matched by its batch number, with its enterer and approval', async () => {
    many(3, 'GFT-2026-1103', { cents: 10000 });
    many(2, 'GFT-2026-1110', { day: '2026-10-12', added: '2026-10-13T07:38:43.833-04:00' });
    const d = await favorosDeposit({ gifts: [{}, {}, { kind: 'cash' }], batch: 'GFT-2026-1103', status: 'committed', createdAt: '2026-10-12T13:00:00.000Z' });
    const out = await month.monthDeposits(q, '2026-10', '2026-10', { env });
    assert.equal(out.deposits.length, 2, 'not three');
    const b = out.deposits.find((x) => x.batch === 'GFT-2026-1103');
    assert.equal(b.source, 'favoros');
    assert.equal(b.favorosId, d.id);
    assert.equal(b.enteredBy, 'Ada Admin');
    assert.equal(b.approved, true);
    assert.equal(b.items, 3, 'Blackbaud holds what was keyed');
    assert.equal(b.totalCents, 30000);
    assert.equal(out.deposits.find((x) => x.batch === 'GFT-2026-1110').source, 'blackbaud');
    assert.deepEqual(out.totals, { deposits: 2, items: 5, totalCents: 30000 + 2 * 5000 });
  });

  it('a FavorOS deposit not yet in the copy shows from its own gift rows, unapproved until committed', async () => {
    const today = intake.etParts(new Date()).date;
    await favorosDeposit({ gifts: [{ cents: 4000 }, { kind: 'cash', cents: 1000 }, { status: 'removed', cents: 99999 }], batch: 'GFT-2026-1120', status: 'created', kind: 'acquisition', date: today });
    await favorosDeposit({ gifts: [], status: 'open', date: today });
    const ym = month.currentYm();
    const out = await month.monthDeposits(q, ym, ym, { env });
    assert.equal(out.deposits.length, 2);
    const sent = out.deposits.find((d) => d.batch === 'GFT-2026-1120');
    assert.deepEqual([sent.items, sent.cash, sent.checks, sent.totalCents, sent.approved, sent.kind, sent.source, sent.status], [2, 1, 1, 5000, false, 'Acquisition', 'favoros', 'created']);
    assert.equal(out.deposits.find((d) => d.batch === '').status, 'open');
  });

  it('leaves out removed deposits and test users, unless the test user is asking', async () => {
    const tester = { email: 'tester@favorintl.org', name: 'FavorOS Tester', role: 'admin' };
    const today = intake.etParts(new Date()).date;
    await favorosDeposit({ gifts: [{}], status: 'removed', date: today });
    await favorosDeposit({ who: tester, gifts: [{}], status: 'open', date: today });
    const ym = month.currentYm();
    assert.equal((await month.monthDeposits(q, ym, ym, { env })).deposits.length, 0);
    assert.equal((await month.monthDeposits(q, ym, ym, { env, withTesters: true })).deposits.length, 1);
  });

  it('a FavorOS batch counts in one month only, the month FavorOS made it', async () => {
    many(2, 'GFT-2026-1130', { day: '2026-10-30', added: '2026-11-02T08:00:00.000-05:00' });
    await favorosDeposit({ gifts: [{}, {}], batch: 'GFT-2026-1130', status: 'committed', date: '2026-10-30', createdAt: '2026-10-31T16:00:00.000Z' });
    const oct = await month.monthDeposits(q, '2026-10', '2026-10', { env });
    const nov = await month.monthDeposits(q, '2026-11', '2026-11', { env });
    assert.deepEqual(oct.deposits.map((d) => d.batch), ['GFT-2026-1130']);
    assert.deepEqual(nov.deposits.map((d) => d.batch), []);
  });
});

describe('GET /api/gift-entry/month', () => {
  it('answers the month, newest first, with totals and the copy freshness', async () => {
    many(2, 'GFT-2026-1103', { cents: 7000 });
    addGift('GFT-2026-1110', { day: '2026-10-12', added: '2026-10-13T07:38:43.833-04:00', method: 'Cash', cents: 1500 });
    const res = await call(ADA, '/api/gift-entry/month?ym=2026-10');
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.ok, true);
    assert.equal(b.ym, '2026-10');
    assert.deepEqual(b.deposits.map((d) => d.batch), ['GFT-2026-1110', 'GFT-2026-1103']);
    assert.equal(b.deposits[0].cash, 1);
    assert.deepEqual(b.totals, { deposits: 2, items: 3, totalCents: 15500 });
    assert.equal(b.asOf, '2026-10-14T21:11:19Z');
  });

  it('defaults to this month, Eastern', async () => {
    const day = intake.etParts(new Date()).date;
    addGift('GFT-2026-1140', { added: day + 'T08:00:00.000-04:00', day });
    addGift('GFT-2025-0100', { added: '2025-03-04T08:00:00.000-05:00', day: '2025-03-03' });
    const b = await (await call(ADA)).json();
    assert.equal(b.ym, day.slice(0, 7));
    assert.deepEqual(b.deposits.map((d) => d.batch), ['GFT-2026-1140']);
    assert.equal(month.currentYm(new Date('2026-11-01T03:30:00Z')), '2026-10', '11:30 pm Eastern on October 31 is still October');
    assert.equal(month.currentYm(new Date('2026-11-01T12:00:00Z')), '2026-11');
  });

  it('turns away a bad month', async () => {
    for (const ym of ['2026-13', '2026-1', 'october', '2026-10-01']) {
      const res = await call(ADA, '/api/gift-entry/month?ym=' + ym);
      assert.equal(res.status, 400, ym);
      assert.equal((await res.json()).error, 'bad_month');
    }
  });

  it('a person without gift entry access gets 403, and nobody signed in gets 401', async () => {
    addGift('GFT-2026-1103');
    assert.equal((await call(SAM, '/api/gift-entry/month?ym=2026-10')).status, 403);
    assert.equal((await call(null, '/api/gift-entry/month?ym=2026-10')).status, 401);
    env.DB.db.prepare("INSERT INTO ge_person (email, access, posting) VALUES ('pat@example.org', 1, 0)").run();
    const ok = await call(PAT, '/api/gift-entry/month?ym=2026-10');
    assert.equal(ok.status, 200, 'the admin desk, switched on by an admin, can read it');
    assert.equal((await ok.json()).deposits.length, 1);
  });
});
