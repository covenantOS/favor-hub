// An invented Blackbaud mirror (the tables and columns the Lists snapshot reads, with the real shapes of the JSON columns) and a hub
// database with the lr_ tables. Every person here is made up. The as-of day is AS_OF.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const AS_OF = '2026-10-12';

export function makeMirror() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, constituent_type TEXT, first_name TEXT, last_name TEXT, organization_name TEXT, spouse_id TEXT,
      spouse_is_head_of_household INTEGER, deceased INTEGER DEFAULT 0, inactive INTEGER DEFAULT 0, primary_address_id TEXT, raw_json TEXT);
    CREATE TABLE addresses (id TEXT PRIMARY KEY, constituent_record_id TEXT, address_city TEXT, address_state TEXT, address_postal_code TEXT, address_country TEXT, is_primary INTEGER, is_inactive INTEGER DEFAULT 0, date_modified TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, constituent_record_id TEXT, gift_date TEXT, gift_amount REAL, gift_type TEXT, gift_payment_method TEXT, gift_splits TEXT, fundraiser_credits TEXT, soft_credits TEXT,
      acknowledgment_status TEXT, receipt_status TEXT);
    CREATE TABLE appeals (id TEXT PRIMARY KEY, appeal_id TEXT, appeal_description TEXT, appeal_category TEXT, appeal_start_date TEXT);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_id TEXT, fund_description TEXT, fund_category TEXT, fund_inactive INTEGER DEFAULT 0);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_active INTEGER DEFAULT 1);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_from_date TEXT, assignment_to_date TEXT);
    CREATE TABLE solicit_codes (constituent_record_id TEXT, solicit_code TEXT, solicit_start TEXT, solicit_end TEXT);
    CREATE TABLE constituent_codes (constituent_record_id TEXT, code_description TEXT, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE custom_fields (constituent_record_id TEXT, category TEXT, value TEXT);
    CREATE TABLE constituent_relationships (constituent_id TEXT, relation_id TEXT, type TEXT, position TEXT, end_date TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE event_participants (event_id TEXT, constituent_record_id TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, constituent_record_id TEXT, action_category TEXT, action_date_due TEXT, action_completed_date TEXT, raw_json TEXT);
  `);
  const ins = (t, rows) => {
    for (const r of rows) {
      const cols = Object.keys(r);
      db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r[c]));
    }
  };
  const person = (id, first, last, extra = {}) => ({ id, constituent_lookup_id: String(id - 100), constituent_type: 'Individual', first_name: first, last_name: last, primary_address_id: 'a' + id, raw_json: '{}', ...extra });
  ins('constituents', [
    person('101', 'Alice', 'Tester', { spouse_id: '102', spouse_is_head_of_household: 0 }),
    person('102', 'Bob', 'Tester', { spouse_id: '101', spouse_is_head_of_household: 0 }),
    person('103', 'Carol', 'Solo'),
    person('104', 'Dan', 'Early'),
    person('105', 'Eve', 'Lapsed'),
    person('106', 'Frank', 'Gone', { deceased: 1 }),
    { id: '107', constituent_lookup_id: '7', constituent_type: 'Organization', organization_name: 'Test Church', primary_address_id: 'a107', raw_json: '{}' },
    { id: '108', constituent_lookup_id: '8', constituent_type: 'Organization', organization_name: 'Test Giving Fund', primary_address_id: 'a108', raw_json: '{}' },
    person('109', 'Grace', 'Softcredit'),
    person('110', 'Henry', 'Major'),
    person('111', 'Ivy', 'Nogifts'),
    person('112', 'Jon', 'Alsoalive', { spouse_id: '113' }),
    person('113', 'Kay', 'Alsoalive', { spouse_id: '112', deceased: 1 }),
  ]);
  const addr = (id, city, state, zip) => ({ id: 'a' + id, constituent_record_id: String(id), address_city: city, address_state: state, address_postal_code: zip, address_country: null, is_primary: 1, date_modified: '2026-01-01' });
  ins('addresses', [addr(101, 'Tampa', 'FL', '33601'), addr(103, 'Austin', 'TX', '78701'), addr(104, 'Tampa', 'FL', '33602'), addr(105, 'Denver', 'CO', '80201'), addr(106, 'Tampa', 'FL', '33603'), addr(107, 'Macon', 'GA', '31201'), addr(109, 'Reno', 'NV', '89501'), addr(110, 'Austin', 'TX', '78702'), addr(112, 'Boise', 'ID', '83701')]);
  ins('appeals', [
    { id: '1', appeal_id: 'K24A-TEST', appeal_description: 'Acquisition test', appeal_category: 'Acquisition', appeal_start_date: '2024-09-01' },
    { id: '2', appeal_id: 'L26A-WS', appeal_description: 'Monthly letter', appeal_category: 'Direct Mail Appeal', appeal_start_date: '2026-01-01' },
    { id: '3', appeal_id: 'W200-WM', appeal_description: 'White mail', appeal_category: 'White Mail', appeal_start_date: '2020-01-01' },
  ]);
  ins('funds', [
    { id: '79', fund_id: 'WNM', fund_description: 'Where Needed Most', fund_category: 'Where Needed Most' },
    { id: '80', fund_id: 'EDU', fund_description: 'Education Fund', fund_category: 'Education' },
  ]);
  ins('fundraisers', [
    { id: '5001', fundraiser_first_name: 'Rita', fundraiser_last_name: 'Director', fundraiser_type: 'Regional Development Director (RDD)' },
    { id: '5002', fundraiser_first_name: 'Pam', fundraiser_last_name: 'Care', fundraiser_type: 'Partner Care' },
  ]);
  const split = (fund, appeal, amt) => JSON.stringify([{ id: 's', amount: { value: amt }, fund_id: fund, appeal_id: appeal }]);
  const gift = (id, cid, date, amt, extra = {}) => ({ id: String(id), constituent_record_id: cid, gift_date: date + 'T00:00:00', gift_amount: amt, gift_type: 'Donation', gift_payment_method: 'PersonalCheck', gift_splits: split('79', '2', amt), fundraiser_credits: null, soft_credits: null, ...extra });
  ins('gifts', [
    gift(1, '101', '2026-08-01', 100, { gift_splits: split('79', '1', 100) }),
    gift(2, '102', '2026-09-01', 50),
    gift(3, '103', '2026-07-01', 25, { gift_type: 'RecurringGiftPayment', gift_payment_method: 'CreditCard', fundraiser_credits: JSON.stringify([{ amount: { value: 25 }, constituent_id: '5002' }]) }),
    gift(4, '103', '2026-06-01', 25, { gift_type: 'RecurringGiftPayment', gift_payment_method: 'CreditCard' }),
    gift(5, '103', '2026-06-01', 25, { gift_type: 'RecurringGift' }),
    gift(6, '104', '2025-03-01', 200, { gift_splits: split('80', '1', 200) }),
    gift(7, '104', '2027-01-01', 999),
    gift(8, '105', '2023-06-01', 75),
    gift(9, '105', '2025-12-01', 0),
    gift(10, '106', '2023-02-01', 40),
    gift(11, '108', '2026-05-01', 600, { soft_credits: JSON.stringify([{ amount: { value: 600 }, constituent_id: '109' }]), gift_splits: split('80', '3', 600) }),
    gift(12, '107', '2024-11-20', 30),
    gift(13, '110', '2025-02-01', 1500, { gift_splits: split('79', '1', 1500) }),
    gift(14, '112', '2026-09-20', 10),
  ]);
  ins('assignments', [
    { id: 'x1', constituent_record_id: '101', assignment_fundraiser_id: '5001', assignment_type: 'Regional Development Director (RDD)', assignment_from_date: '2020-01-01', assignment_to_date: null },
    { id: 'x2', constituent_record_id: '102', assignment_fundraiser_id: '5002', assignment_type: 'Partner Care', assignment_from_date: '2020-01-01', assignment_to_date: null },
    { id: 'x3', constituent_record_id: '103', assignment_fundraiser_id: '5002', assignment_type: 'Partner Care', assignment_from_date: '2020-01-01', assignment_to_date: null },
    { id: 'x4', constituent_record_id: '104', assignment_fundraiser_id: '5001', assignment_type: 'Regional Development Director (RDD)', assignment_from_date: '2020-01-01', assignment_to_date: '2025-01-01' },
    { id: 'x5', constituent_record_id: '110', assignment_fundraiser_id: '5001', assignment_type: 'Regional Development Director (RDD)', assignment_from_date: '2020-01-01', assignment_to_date: null },
  ]);
  ins('solicit_codes', [
    { constituent_record_id: '103', solicit_code: 'Do Not Mail', solicit_start: '2025-01-01', solicit_end: null },
    { constituent_record_id: '104', solicit_code: 'Do Not Mail', solicit_start: '2020-01-01', solicit_end: '2024-01-01' },
  ]);
  ins('constituent_codes', [
    { constituent_record_id: '107', code_description: 'Church' },
    { constituent_record_id: '101', code_description: 'Partner' },
  ]);
  ins('custom_fields', [{ constituent_record_id: '101', category: 'Online Express Email Signup', value: 'Yes' }]);
  ins('constituent_relationships', [{ constituent_id: '107', relation_id: '110', type: 'Pastor', position: 'Lead Pastor', end_date: null }]);
  ins('events', [{ id: 'e1', name: 'Test Dinner' }]);
  ins('event_participants', [{ event_id: 'e1', constituent_record_id: '102' }]);
  ins('actions', [
    { id: 'ac1', constituent_record_id: '101', action_category: 'Phone call', action_date_due: '2026-09-01T00:00:00', action_completed_date: '2026-09-02T00:00:00', raw_json: '{"completed":true}' },
    { id: 'ac2', constituent_record_id: '102', action_category: 'Email', action_date_due: '2026-09-10T00:00:00', action_completed_date: null, raw_json: '{"completed":false}' },
  ]);
  return db;
}

export function makeHub() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../../db/lists-reports.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE act_staff (email TEXT PRIMARY KEY, name TEXT, team TEXT, bb_fundraiser_id TEXT, work_center INTEGER DEFAULT 0, entry_owner INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
    INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center) VALUES ('rita@favorintl.org', 'Rita Director', 'rdd', '5001', 1), ('pam@favorintl.org', 'Pam Care', 'partner_care', '5002', 1);`);
  return db;
}

/** A Q function (sql, params) over a node:sqlite database. */
export const qOf = (db) => async (sql, params = []) => db.prepare(sql).all(...params);

/** The SnapshotIO the builder takes, reading the fixture mirror and writing the fixture hub. */
export function ioOf(mirror, hub) {
  return {
    read: async (sql, params = []) => {
      // node 24's SQLite refuses a correlated column in a subquery's ORDER BY (D1 accepts it); the fixture has one address per record.
      sql = sql.replace('ORDER BY (x.id = p.primary_address_id) DESC, ', 'ORDER BY ');
      const used = [...sql.matchAll(/\?(\d+)/g)].map((m) => +m[1]);
      return mirror.prepare(sql).all(...(used.length ? params.slice(0, Math.max(...used)) : []));
    },
    hub: qOf(hub),
    write: async (stmts) => {
      hub.exec('BEGIN');
      try {
        for (const s of stmts) hub.prepare(s.sql).run(...s.params);
        hub.exec('COMMIT');
      } catch (e) {
        hub.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** A D1Database stand-in over node:sqlite: prepare().bind().first/all/run and batch(). */
export function d1Of(db) {
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { meta: { changes: Number(r.changes) } };
    },
    _sql: sql,
    _params: params,
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of list) out.push(db.prepare(s._sql).run(...s._params));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
