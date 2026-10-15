// The Partners directory: the copy of every Blackbaud record (built from an invented mirror and an invented lists snapshot), its
// filters, sort and pages, and the promise that nothing a person types lands in the SQL text. Every person here is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { buildDirectory, kindOf, sortNameOf } from '../functions/_lib/partners/directory.ts';
import { DUP_SQL, exportQuery, facetQueries, listQuery, normalizeSpec } from '../functions/_lib/partners/query.ts';

const TODAY = '2026-10-14';

function mirrorDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, constituent_type TEXT, first_name TEXT, last_name TEXT, preferred_name TEXT, organization_name TEXT,
      raw_json TEXT, deceased INTEGER DEFAULT 0, inactive INTEGER DEFAULT 0, gives_anonymously INTEGER DEFAULT 0, requests_no_email INTEGER DEFAULT 0, no_valid_address INTEGER DEFAULT 0,
      date_added TEXT, spouse_id TEXT);
    CREATE TABLE emails (constituent_record_id TEXT, email_address TEXT, is_primary INTEGER, is_inactive INTEGER DEFAULT 0, do_not_email INTEGER DEFAULT 0);
    CREATE TABLE phones (constituent_record_id TEXT, phone_number TEXT, is_primary INTEGER, is_inactive INTEGER DEFAULT 0, do_not_call INTEGER DEFAULT 0);
    CREATE TABLE addresses (constituent_record_id TEXT, address_lines TEXT, address_city TEXT, address_state TEXT, address_postal_code TEXT, address_country TEXT, is_primary INTEGER, do_not_mail INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_type TEXT, gift_status TEXT, soft_credits TEXT);
    CREATE TABLE assignments (constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_to_date TEXT);
    CREATE TABLE fundraisers (id TEXT, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
    CREATE TABLE constituent_codes (constituent_record_id TEXT, code_description TEXT, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE solicit_codes (constituent_record_id TEXT, solicit_code TEXT, solicit_end TEXT);
    CREATE TABLE actions (id TEXT, constituent_record_id TEXT, action_category TEXT, action_date_due TEXT, action_completed_date TEXT, raw_json TEXT);
  `);
  const ins = (t, rows) => { for (const r of rows) { const c = Object.keys(r); db.prepare(`INSERT INTO ${t} (${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`).run(...c.map((k) => r[k])); } };
  const person = (id, first, last, x = {}) => ({ id, constituent_lookup_id: String(Number(id) - 100), constituent_type: 'Individual', first_name: first, last_name: last, raw_json: '{}', date_added: '2020-01-01', ...x });
  ins('constituents', [
    person('101', 'Alice', 'Tester', { spouse_id: '102' }),
    person('102', 'Bob', 'Tester', { spouse_id: '101' }),
    person('103', 'Carol', 'Solo'),
    person('104', 'Dan', 'Never'),
    person('105', 'Eve', 'Gone', { deceased: 1 }),
    { id: '107', constituent_lookup_id: '7', constituent_type: 'Organization', organization_name: 'The Test Church', raw_json: '{"name":"The Test Church"}', date_added: '2021-01-01' },
    { id: '108', constituent_lookup_id: '8', constituent_type: 'Organization', organization_name: 'Test Giving Fund', raw_json: '{}', date_added: '2021-01-01' },
  ]);
  ins('emails', [{ constituent_record_id: '101', email_address: 'alice@example.test', is_primary: 1 }, { constituent_record_id: '103', email_address: 'carol@example.test', is_primary: 1 }, { constituent_record_id: '104', email_address: 'carol@example.test', is_primary: 1 }]);
  ins('phones', [{ constituent_record_id: '101', phone_number: '(555) 010-1234', is_primary: 1 }]);
  ins('addresses', [
    { constituent_record_id: '101', address_lines: '1 Test Street', address_city: 'Tampa', address_state: 'FL', address_postal_code: '33601', is_primary: 1 },
    { constituent_record_id: '103', address_lines: '3 Test Road', address_city: 'Austin', address_state: 'TX', address_postal_code: '78701', is_primary: 1 },
    { constituent_record_id: '107', address_lines: '7 Church Way', address_city: 'Macon', address_state: 'GA', address_postal_code: '31201', is_primary: 1 },
  ]);
  ins('gifts', [
    { id: 'g1', constituent_record_id: '108', gift_amount: 500, gift_type: 'Donation', soft_credits: '[{"constituent_id":"103","amount":{"value":500}}]' },
    { id: 'g2', constituent_record_id: '101', gift_amount: 50, gift_type: 'RecurringGift', gift_status: 'Active' },
  ]);
  ins('assignments', [{ constituent_record_id: '101', assignment_fundraiser_id: '9001', assignment_to_date: null }, { constituent_record_id: '103', assignment_fundraiser_id: '9002', assignment_to_date: '2020-01-01' }]);
  ins('fundraisers', [{ id: '9001', fundraiser_first_name: 'Rita', fundraiser_last_name: 'Holder' }, { id: '9002', fundraiser_first_name: 'Old', fundraiser_last_name: 'Holder' }]);
  ins('constituent_codes', [{ constituent_record_id: '101', code_description: 'Partner' }, { constituent_record_id: '107', code_description: 'Church' }, { constituent_record_id: '108', code_description: 'DAF Provider' }, { constituent_record_id: '104', code_description: 'Prospect' }]);
  ins('solicit_codes', [{ constituent_record_id: '103', solicit_code: 'Do Not Mail', solicit_end: null }, { constituent_record_id: '101', solicit_code: 'Do Not Call', solicit_end: '2020-01-01' }]);
  ins('actions', [
    { id: 'a1', constituent_record_id: '101', action_category: 'Phone call', action_date_due: '2026-09-01', action_completed_date: '2026-09-02', raw_json: '{"completed":true}' },
    { id: 'a2', constituent_record_id: '103', action_category: 'Task/Other', action_date_due: '2026-10-20', action_completed_date: null, raw_json: '{"completed":false,"computed_status":"Open"}' },
  ]);
  return db;
}

function hubDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../db/partners-directory.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE lr_hh (household_id TEXT PRIMARY KEY, first_gift TEXT, last_gift TEXT, last_amt REAL, largest REAL, lifetime REAL, gifts INTEGER);
           CREATE TABLE lr_gift (gift_id TEXT, household_id TEXT, gift_date TEXT, credited REAL);`);
  // The household of 101 and 102 (key 101) gave $1,200 last year; Carol (103) was soft credited $500 this year through the fund (108).
  db.prepare("INSERT INTO lr_hh VALUES ('101', '2018-03-01', '2025-05-01', 1200, 1200, 1250, 2)").run();
  db.prepare("INSERT INTO lr_hh VALUES ('103', '2026-02-01', '2026-02-01', 500, 500, 500, 1)").run();
  db.prepare("INSERT INTO lr_gift VALUES ('gx', '101', '2025-05-01', 1200), ('g0', '101', '2018-03-01', 50), ('g1', '103', '2026-02-01', 500)").run();
  return db;
}

const run = (db, sql, params = []) => db.prepare(sql).all(...params.map((p) => (typeof p === 'boolean' ? Number(p) : p)));
let hub;
const q = (sql, params) => run(hub, sql, params);

before(async () => {
  const mirror = mirrorDb();
  hub = hubDb();
  const io = {
    read: async (sql, params = []) => {
      assert.doesNotMatch(sql, /insert|update|replace|upsert|delete|drop|alter|create/i, 'the mirror refuses write words');
      return run(mirror, sql, params);
    },
    hub: async (sql, params = []) => run(hub, sql, params),
    write: async (stmts) => { for (const s of stmts) hub.prepare(s.sql).run(...s.params); },
  };
  const r = await buildDirectory(io, TODAY);
  assert.equal(r.records, 7);
});

const ctx = { today: TODAY, email: 'tester@favorintl.org', fid: '9001' };
const list = (o, page = 1, size = 50) => { const lq = listQuery(normalizeSpec(o), ctx, page, size, true); return { rows: q(lq.sql, lq.params), n: q(lq.countSql, lq.countParams)[0].n }; };

describe('directory copy', () => {
  it('has every record, givers or not', () => {
    assert.equal(q('SELECT COUNT(*) n FROM pd_partner')[0].n, 7);
  });
  it('sorts kinds out of the type and codes', () => {
    assert.equal(kindOf('Organization', ['Church']), 'church');
    assert.equal(kindOf('Organization', ['DAF Provider']), 'foundation');
    assert.equal(kindOf('Organization', ['Business']), 'organization');
    assert.equal(kindOf('Individual', ['Church']), 'individual');
    assert.equal(sortNameOf('organization', 'The Test Church', '', ''), 'test church');
    assert.equal(sortNameOf('individual', 'Alice Tester', 'Alice', 'Tester'), 'tester, alice');
  });
  it('gives both spouses their household figures from the lists snapshot', () => {
    const r = q("SELECT id, lifetime, last_gift, last_year, recurring FROM pd_partner WHERE id IN ('101', '102') ORDER BY id");
    assert.deepEqual(r.map((x) => [x.lifetime, x.last_gift, x.last_year, x.recurring]), [[1250, '2025-05-01', 1200, 1], [1250, '2025-05-01', 1200, 1]]);
  });
  it('credits a soft-credited partner and shows the fund as passing gifts on', () => {
    const c = q("SELECT lifetime, ytd FROM pd_partner WHERE id = '103'")[0];
    assert.deepEqual([c.lifetime, c.ytd], [500, 500]);
    const f = q("SELECT lifetime, passed_on, passed_n, kind FROM pd_partner WHERE id = '108'")[0];
    assert.deepEqual([f.lifetime, f.passed_on, f.passed_n, f.kind], [0, 500, 1, 'foundation']);
  });
  it('keeps current holders and solicit codes only', () => {
    assert.equal(q("SELECT holders FROM pd_partner WHERE id = '103'")[0].holders, '');
    assert.equal(q("SELECT holder_names FROM pd_partner WHERE id = '101'")[0].holder_names, 'Rita Holder');
    assert.equal(q("SELECT solicit FROM pd_partner WHERE id = '101'")[0].solicit, '');
    assert.equal(q("SELECT solicit FROM pd_partner WHERE id = '103'")[0].solicit, '|Do Not Mail|');
  });
  it('stores the menus with counts', () => {
    const m = JSON.parse(q("SELECT value FROM pd_meta WHERE key = 'menus'")[0].value);
    assert.ok(m.codes.some((c) => c.v === 'Church' && c.n === 1));
    assert.ok(m.holders.some((h) => h.v === '9001' && h.name === 'Rita Holder'));
  });
});

describe('directory list', () => {
  it('leaves out deceased records unless asked', () => {
    assert.equal(list({}).n, 6);
    assert.equal(list({ deceased: 'include' }).n, 7);
    assert.deepEqual(list({ deceased: 'only' }).rows.map((r) => r.id), ['105']);
  });
  it('finds by name, email, lookup id, phone digits, street and city', () => {
    // A spouse's name finds the household: both records.
    assert.deepEqual(list({ q: 'alice' }).rows.map((r) => r.id).sort(), ['101', '102']);
    assert.deepEqual(list({ q: 'carol@example' }).rows.map((r) => r.id).sort(), ['103', '104']);
    assert.deepEqual(list({ q: '(555) 010-1234' }).rows.map((r) => r.id), ['101']);
    assert.deepEqual(list({ q: 'church way' }).rows.map((r) => r.id), ['107']);
    assert.deepEqual(list({ q: 'austin' }).rows.map((r) => r.id), ['103']);
  });
  it('filters by kind, household, status, holder, code, solicit code and band', () => {
    assert.deepEqual(list({ kinds: ['household'] }).rows.map((r) => r.id).sort(), ['101', '102']);
    assert.deepEqual(list({ kinds: 'church,foundation' }).rows.map((r) => r.id).sort(), ['107', '108']);
    assert.deepEqual(list({ status: ['lybunt'] }).rows.map((r) => r.id).sort(), ['101', '102']);
    assert.deepEqual(list({ status: ['active'] }).rows.map((r) => r.id), ['103']);
    assert.equal(list({ status: ['never'] }).n, 3);
    assert.deepEqual(list({ holder: '_mine' }).rows.map((r) => r.id), ['101']);
    assert.equal(list({ holder: '_none' }).n, 5);
    assert.deepEqual(list({ codes: ['Prospect'] }).rows.map((r) => r.id), ['104']);
    assert.deepEqual(list({ solicitNot: ['Do Not Mail'], kinds: ['individual'] }).rows.map((r) => r.id).sort(), ['101', '102', '104']);
    assert.deepEqual(list({ band: '1k' }).rows.map((r) => r.id).sort(), ['101', '102']);
    assert.equal(list({ band: 'none' }).n, 3);
    assert.deepEqual(list({ recurring: true }).rows.map((r) => r.id).sort(), ['101', '102']);
    assert.deepEqual(list({ openActions: true }).rows.map((r) => r.id), ['103']);
  });
  it('sorts and pages on the server', () => {
    assert.deepEqual(list({ sort: 'name' }).rows.map((r) => r.name).slice(0, 2), ['Dan Never', 'Carol Solo']);
    assert.equal(list({ sort: 'lifetime', dir: 'desc' }).rows[0].lifetime, 1250);
    // Empty values sort last either way.
    assert.equal(list({ sort: 'last_gift', dir: 'asc' }).rows.at(-1).last_gift, null);
    const p1 = list({ sort: 'name' }, 1, 25);
    assert.equal(p1.rows.length, 6);
    const lq = listQuery(normalizeSpec({}), ctx, 2, 25, true);
    assert.equal(q(lq.sql, lq.params).length, 0);
  });
  it('counts each kind and status under the other filters', () => {
    const f = facetQueries(normalizeSpec({ status: ['never'] }), ctx);
    const kinds = Object.fromEntries(q(f.kinds.sql, f.kinds.params).map((r) => [r.k, r.n]));
    assert.equal(kinds.individual, 1);
    const st = Object.fromEntries(q(f.status.sql, f.status.params).map((r) => [r.k, r.n]));
    assert.equal(st.lybunt, 2);
  });
  it('never puts typed text in the SQL', () => {
    const evil = "x' OR 1=1; --";
    const lq = listQuery(normalizeSpec({ q: evil, codes: [evil], tags: [evil], holder: evil, sort: evil, states: [evil] }), ctx, 1, 25, true);
    assert.ok(!lq.sql.includes(evil));
    assert.ok(!lq.sql.includes('OR 1=1'));
    assert.equal(q(lq.sql, lq.params).length, 0);
  });
  it('exports a selection by id', () => {
    const e = exportQuery(normalizeSpec({}), ctx, true, ['107', '101']);
    assert.deepEqual(q(e.sql, e.params).map((r) => r.id).sort(), ['101', '107']);
  });
  it('finds records that share an email as possible duplicates', () => {
    const pairs = q(DUP_SQL);
    assert.ok(pairs.some((p) => p.a === '103' && p.b === '104' && p.why.includes('email')));
    // Spouses are never offered as duplicates.
    assert.ok(!pairs.some((p) => p.a === '101' && p.b === '102'));
  });
});
