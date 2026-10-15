// Run with: npm test
//
// The two Blackbaud test records (37974 FavorOS Test Sponsor, 37975 FavorOS Test Recommender) stay out of every count, list, scan,
// letter and statement. One shared exclusion (functions/_lib/testpartners.ts) feeds each area below. Each test adds the two records
// with gifts, codes and actions to an invented mirror and checks the answer is the same as without them. Nothing touches Blackbaud.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { makeMirror, makeHub, ioOf } from './support/lists-fixture.mjs';

const tp = await import('../functions/_lib/testpartners.ts');
const { buildSnapshot } = await import('../functions/_lib/lists/snapshot.ts');
const { buildDirectory } = await import('../functions/_lib/partners/directory.ts');
const ch = await import('../functions/_lib/work/churches.ts');
const scan = await import('../functions/_lib/datacare/scan.ts');
const rec = await import('../functions/_lib/recurring/read.ts');
const cad = await import('../functions/_lib/work/cadence.ts');
const { giftsFromRows } = await import('../functions/_lib/receipts/rules.ts');
const stmt = await import('../functions/_lib/statements/data.ts');
const shared = await import('../functions/_lib/reports/defs/b1-shared.ts');

const IDS = ['37974', '37975'];
const TODAY = '2026-10-14';
const rows = (db, sql, params = []) => db.prepare(sql).all(...params);
const none = (list) => assert.ok(!list.some((v) => IDS.includes(String(v))), `a test record is still in ${JSON.stringify(list)}`);

describe('the shared exclusion', () => {
  it('names exactly the two records', () => {
    assert.deepEqual([...tp.TEST_PARTNER_IDS], IDS);
    assert.ok(tp.isTestPartnerRecord(37974) && tp.isTestPartnerRecord(' 37975 ') && !tp.isTestPartnerRecord('37976') && !tp.isTestPartnerRecord(null));
  });
  it('keeps rows with no id and look-alike ids', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id)');
    for (const v of ['37974', '37975', '379740', '3797', null, '1']) db.prepare('INSERT INTO t VALUES (?)').run(v);
    db.exec('INSERT INTO t VALUES (37974)');
    assert.deepEqual(rows(db, `SELECT id FROM t WHERE ${tp.notTestPartnerSql('id')}`).map((r) => r.id), ['379740', '3797', null, '1']);
  });
  it('recognises the names the receipts feed carries', () => {
    assert.ok(tp.isTestPartnerName('FavorOS Test Sponsor') && tp.isTestPartnerName('Recommender, FavorOS Test'));
    assert.ok(!tp.isTestPartnerName('Alice Tester') && !tp.isTestPartnerName('Test Church'));
  });
});

describe('Lists snapshot and All partners directory', () => {
  const addTest = (m) => {
    m.exec(`INSERT INTO constituents (id, constituent_lookup_id, constituent_type, organization_name, raw_json, no_valid_address) VALUES ('37974', '23109', 'Organization', 'FavorOS Test Sponsor', '{}', 1);
            INSERT INTO constituents (id, constituent_lookup_id, constituent_type, first_name, last_name, raw_json, no_valid_address) VALUES ('37975', '23110', 'Individual', 'FavorOS', 'Test Recommender', '{}', 1);
            INSERT INTO constituent_codes VALUES ('37974', 'Church', 0), ('37975', 'Board', 0);
            INSERT INTO gifts (id, constituent_record_id, gift_date, gift_amount, gift_type) VALUES ('t1', '37974', '2026-09-01T00:00:00', 50, 'Donation'), ('t2', '37975', '2026-09-02T00:00:00', 75, 'Donation');
            INSERT INTO actions (id, constituent_record_id, action_category, action_date_due, raw_json) VALUES ('ta', '37974', 'Phone call', '2026-09-03', '{"completed":1}')`);
  };
  const build = async (withTest) => {
    const mirror = makeMirror();
    const hub = makeHub();
    hub.exec(fs.readFileSync(new URL('../db/partners-directory.sql', import.meta.url), 'utf8'));
    // The directory reads a few columns the Lists fixture does not carry.
    for (const [t, c] of [['addresses', 'do_not_mail INTEGER'], ['gifts', 'gift_status TEXT'], ['constituents', 'preferred_name TEXT'], ['constituents', 'gives_anonymously INTEGER'], ['constituents', 'requests_no_email INTEGER'], ['constituents', 'date_added TEXT']]) {
      try { mirror.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* already there */ }
    }
    if (withTest) addTest(mirror);
    const io = ioOf(mirror, hub);
    const snap = await buildSnapshot(io, '2026-10-12');
    const dir = await buildDirectory(io, '2026-10-12');
    return { hub, snap, dir };
  };
  it('leaves both records out of every snapshot table and the directory, with the totals unchanged', async () => {
    const before = await build(false);
    const after = await build(true);
    assert.equal(after.snap.households, before.snap.households);
    assert.equal(after.snap.gifts, before.snap.gifts);
    assert.equal(after.dir.records, before.dir.records);
    assert.equal(after.dir.givers, before.dir.givers);
    const sum = (h) => rows(h, 'SELECT ROUND(SUM(lifetime), 2) AS s, SUM(gifts) AS n FROM lr_hh')[0];
    assert.deepEqual(sum(after.hub), sum(before.hub));
    none(rows(after.hub, 'SELECT record_id FROM lr_hh').map((r) => r.record_id));
    none(rows(after.hub, 'SELECT giver FROM lr_gift').map((r) => r.giver));
    none(rows(after.hub, 'SELECT id FROM pd_partner').map((r) => r.id));
  });
});

describe('Churches', () => {
  it('skips a test church in the list, the totals and the counts', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, organization_name TEXT, first_name TEXT, last_name TEXT, inactive INTEGER DEFAULT 0, deceased INTEGER DEFAULT 0, requests_no_email INTEGER DEFAULT 0, raw_json TEXT);
      CREATE TABLE constituent_codes (id TEXT PRIMARY KEY, constituent_record_id TEXT, code_description TEXT, is_inactive INTEGER DEFAULT 0);
      CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_constituency TEXT, acknowledgment_status TEXT, constituent_record_id TEXT);
      CREATE TABLE emails (id TEXT PRIMARY KEY, constituent_record_id TEXT, email_address TEXT);
      CREATE TABLE constituent_relationships (id TEXT PRIMARY KEY, constituent_id TEXT, name TEXT, type TEXT, position TEXT, end_date TEXT);
      CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
      CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
      CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due TEXT, action_completed_date TEXT, action_category TEXT, action_type TEXT, action_summary TEXT, constituent_record_id TEXT, raw_json TEXT);
    `);
    const church = (id, name) => {
      db.prepare('INSERT INTO constituents (id, constituent_lookup_id, organization_name, raw_json) VALUES (?,?,?,?)').run(id, 'L' + id, name, '{}');
      db.prepare('INSERT INTO constituent_codes (id, constituent_record_id, code_description) VALUES (?,?,?)').run('k' + id, id, 'Church');
      db.prepare('INSERT INTO emails VALUES (?,?,?)').run('e' + id, id, `${id}@x.test`);
      db.prepare('INSERT INTO gifts VALUES (?,?,?,?,?,?,?)').run('g' + id, 100, '2026-06-01T00:00:00', 'Donation', 'Church', 'NotAcknowledged', id);
    };
    church('1', 'Grace Test Church');
    const q = async (sql, params = []) => db.prepare(sql).all(...params);
    const before = await ch.loadChurches(q, TODAY);
    church('37974', 'FavorOS Test Sponsor');
    const after = await ch.loadChurches(q, TODAY);
    assert.deepEqual(after, before);
    assert.ok(!JSON.stringify(after).includes('FavorOS Test'));
  });
});

describe('Data care scans', () => {
  it('leaves a test record out of the missing address list and the duplicate email scan', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE constituents (id TEXT, constituent_lookup_id TEXT, first_name TEXT, last_name TEXT, organization_name TEXT, no_valid_address INTEGER, deceased INTEGER DEFAULT 0);
      CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_date TEXT);
      CREATE TABLE addresses (id TEXT, constituent_record_id TEXT, address_lines TEXT, do_not_mail INTEGER, is_inactive INTEGER DEFAULT 0);
      CREATE TABLE emails (id TEXT, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER, is_inactive INTEGER DEFAULT 0);
      INSERT INTO constituents VALUES ('1', 'L1', 'Real', 'Giver', NULL, 1, 0), ('37974', 'L9', NULL, NULL, 'FavorOS Test Sponsor', 1, 0), ('37975', 'L10', 'FavorOS', 'Test Recommender', NULL, 1, 0);
      INSERT INTO gifts VALUES ('g1', '1', 20, '2026-09-01'), ('g2', '37974', 20, '2026-09-01'), ('g3', '37975', 20, '2026-09-01');
      INSERT INTO emails VALUES ('e1', '1', 'same@x.test', 1, 0), ('e2', '37975', 'same@x.test', 1, 0), ('e3', '2', 'same@x.test', 1, 0);
    `);
    assert.deepEqual(rows(db, scan.FLAGGED_SQL, ['2026-01-01']).map((r) => r.cid), ['1']);
    const dupes = rows(db, scan.SHARED_EMAIL_SQL);
    assert.deepEqual(dupes.map((r) => r.ids.split(',').sort()), [['1', '2']]);
  });
});

describe('Recurring', () => {
  it('lists no schedule or payment for a test record', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE recurring_schedules (gift_id TEXT, constituent_record_id TEXT, gift_status TEXT, amount REAL, frequency TEXT, start_date TEXT, end_date TEXT, next_transaction_date TEXT, status_date TEXT, synced_at TEXT);
      CREATE TABLE gifts (id TEXT, gift_payment_method TEXT, gift_splits TEXT, gift_type TEXT, gift_amount REAL, gift_date TEXT, linked_gift_id TEXT, constituent_record_id TEXT);
      INSERT INTO recurring_schedules VALUES ('s1', '1', 'Active', 10, 'MONTHLY', '2026-01-01', NULL, '2026-11-01', NULL, '2026-10-14'), ('s2', '37974', 'Active', 99, 'MONTHLY', '2026-01-01', NULL, '2026-11-01', NULL, '2026-10-14'), ('s3', '37975', 'Active', 5, 'MONTHLY', '2026-01-01', NULL, '2026-11-01', NULL, '2026-10-14');
      INSERT INTO gifts (id, gift_type, gift_amount, gift_date, linked_gift_id, constituent_record_id) VALUES ('p1', 'RecurringGiftPayment', 10, '2026-10-01', 's1', '1'), ('p2', 'RecurringGiftPayment', 99, '2026-10-01', 's2', '37974');
    `);
    assert.deepEqual(rows(db, rec.SCHEDULES_SQL).map((r) => r.id), ['s1']);
    assert.deepEqual(rows(db, rec.PAID30_SQL, ['2026-09-01']).map((r) => [r.schedules, r.total, r.n]), [[1, 10, 1]]);
  });
});

describe('Moves board and Partner Care cadence', () => {
  it('writes the exclusion into the Partner Care givers query', () => {
    assert.match(cad.GIVERS_SQL, /NOT IN \('37974', '37975'\)/);
  });
});

describe('Receipts and first-gift letters', () => {
  it('drops the test records from the print query rows', () => {
    const row = (id, name) => ({ QRECID: id, 'Gift ID': 'G' + id, 'Gift Date': '10/01/2026', 'Gift Amount': '50', 'Gift Type': 'Cash', 'Constituent ID': 'C' + id, Name: name, 'Sort Name': name, 'Primary Addressee': name });
    const gifts = giftsFromRows([row('1', 'Alice Real'), row('2', 'FavorOS Test Sponsor'), row('3', 'FavorOS Test Recommender')]);
    assert.deepEqual(gifts.map((g) => g.id), ['1']);
  });
});

describe('Statements', () => {
  it('finds no test record by name or id', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE constituents (id TEXT, constituent_lookup_id TEXT, constituent_type TEXT, organization_name TEXT, first_name TEXT, last_name TEXT, spouse_first_name TEXT, spouse_last_name TEXT, primary_address_id TEXT);
      CREATE TABLE addresses (id TEXT, address_city TEXT, address_state TEXT);
      CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_type TEXT, gift_date TEXT);
      INSERT INTO constituents (id, constituent_lookup_id, constituent_type, organization_name) VALUES ('37974', '23109', 'Organization', 'FavorOS Test Sponsor');
      INSERT INTO constituents (id, constituent_lookup_id, constituent_type, first_name, last_name) VALUES ('37975', '23110', 'Individual', 'FavorOS', 'Test Recommender'), ('5', '5', 'Individual', 'Fay', 'Real');
    `);
    const sql = async (s, p = []) => db.prepare(s).all(...p);
    assert.deepEqual(await stmt.findPartners(sql, 'favoros'), []);
    assert.deepEqual(await stmt.findPartners(sql, '37974'), []);
    assert.equal((await stmt.findPartners(sql, 'fay')).length, 1);
  });
});

describe('Highlights (Daily Revenue grid)', () => {
  it('leaves the test records out of the gift grid', async () => {
    const calls = [];
    const ctx = { sql: async (s) => { calls.push(s); return []; } };
    const given = [
      { id: 'a', cid: '37974', amount: 50, d: '2026-10-12', gtype: 'Donation', splits: '[]', soft: '[]' },
      { id: 'b', cid: '37975', amount: 5, d: '2026-10-12', gtype: 'Donation', splits: '[]', soft: '[]' },
    ];
    assert.deepEqual(await shared.loadGrid(ctx, '2026-10-12', '2026-10-12', 5000, given), []);
    await shared.loadGrid(ctx, '2026-10-12', '2026-10-12');
    assert.match(calls[0], /NOT IN \('37974', '37975'\)/);
  });
});
