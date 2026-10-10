// Run with: npm test
//
// The thank-you lists (Gifts of $5,000 and up, the six-week email list, the quarterly packets). Each runs its real SQL
// against an in-memory SQLite stand-in for the mirror, with made-up partners, gifts, addresses and emails. The repository
// is public, so no partner or gift here is real, and no test touches a live database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import './support/resolve-ts.mjs';

const engine = await import('../functions/_lib/reports/engine.ts');
const largeGifts = (await import('../functions/_lib/reports/defs/large-gifts.ts')).default;
const caroleList = (await import('../functions/_lib/reports/defs/carole-list.ts')).default;
const packets = (await import('../functions/_lib/reports/defs/packets.ts')).default;

const TODAY = '2026-10-10';

function mirror() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE funds (id TEXT, fund_description TEXT);
    CREATE TABLE assignments (id TEXT, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_end_date TEXT, fundraiser_active INTEGER);
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, constituent_type TEXT, first_name TEXT, last_name TEXT, preferred_name TEXT, organization_name TEXT, title TEXT,
      spouse_first_name TEXT, spouse_last_name TEXT, spouse_id TEXT, inactive INTEGER, deceased INTEGER, raw_json TEXT);
    CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT,
                        gift_constituency TEXT, gift_splits TEXT, soft_credits TEXT, gift_payment_method TEXT);
    CREATE TABLE addresses (id TEXT, constituent_record_id TEXT, address_lines TEXT, address_city TEXT, address_state TEXT,
                            address_postal_code TEXT, address_country TEXT, do_not_mail INTEGER, is_primary INTEGER, is_inactive INTEGER);
    CREATE TABLE emails (id TEXT, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER, do_not_email INTEGER, is_inactive INTEGER);
    CREATE TABLE phones (id TEXT, constituent_record_id TEXT, phone_number TEXT, phone_type TEXT, is_primary INTEGER, do_not_call INTEGER, is_inactive INTEGER);
    CREATE TABLE actions (id TEXT, constituent_record_id TEXT, action_type TEXT, action_completed_date TEXT, action_date_due TEXT, raw_json TEXT);

    INSERT INTO funds VALUES ('F1', 'Where Needed Most'), ('F2', 'Chad Radio');

    INSERT INTO constituents VALUES
      ('101', 'L101', 'Individual', 'Ann', 'Smith', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, '{}'),
      ('102', 'L102', 'Organization', NULL, NULL, NULL, 'Lakeside Foundation', NULL, NULL, NULL, NULL, 0, 0, '{}'),
      ('103', 'L103', 'Individual', 'Grace', 'Donor', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, '{}'),
      ('104', 'L104', 'Individual', 'Ben', 'Lee', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, '{}'),
      ('105', 'L105', 'Individual', 'Old', 'Gift', NULL, NULL, NULL, NULL, NULL, NULL, 0, 1, '{}'),
      ('201', 'T201', 'Individual', 'Typed', 'Partner', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, '{}'),
      ('106', 'L106', 'Individual', 'Wes', 'Living', NULL, NULL, NULL, NULL, NULL, '107', 0, 0, '{}'),
      ('107', 'L107', 'Individual', 'Dina', 'Living', NULL, NULL, NULL, NULL, NULL, '106', 0, 1, '{}'),
      ('108', 'L108', 'Individual', 'Ivy', 'Out', NULL, NULL, NULL, NULL, NULL, '109', 1, 0, '{}'),
      ('109', 'L109', 'Individual', 'Lou', 'Out', NULL, NULL, NULL, NULL, NULL, '108', 0, 1, '{}'),
      ('110', 'L110', 'Individual', 'Big', 'Older', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, '{}'),
      ('111', 'L111', 'Individual', 'Zero', 'Gift', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, '{}');

    INSERT INTO gifts VALUES
      ('g1', '101', 6000, '2026-09-15T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s1","amount":{"value":6000},"fund_id":"F2"}]', NULL, NULL),
      ('g2', '103', 25000, '2026-09-20T10:00:00', 'Donation', 'Active', 'DAF Provider', '[{"id":"s2","amount":{"value":25000},"fund_id":"F1"}]', '[{"constituent_id":"102","amount":{"value":25000}}]', NULL),
      ('g3', '104', 5000, '2026-08-02T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s3","amount":{"value":5000},"fund_id":"F1"}]', NULL, NULL),
      ('g4', '105', 7000, '2026-09-10T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s4","amount":{"value":7000},"fund_id":"F1"}]', NULL, NULL),
      ('g5', '101', 5200, '2026-05-01T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s5","amount":{"value":5200},"fund_id":"F1"}]', NULL, NULL),
      ('g6', '101', 12000, '2026-10-02T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s6","amount":{"value":12000},"fund_id":"F1"}]', NULL, NULL),
      ('g7', '201', 40, '2026-09-01T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s7","amount":{"value":40},"fund_id":"F1"}]', NULL, NULL),
      ('g8', '107', 9000, '2026-09-05T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s8","amount":{"value":9000},"fund_id":"F1"}]', NULL, NULL),
      ('g9', '108', 8000, '2026-09-06T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s9","amount":{"value":8000},"fund_id":"F1"}]', NULL, NULL),
      ('g10', '110', 8000, '2020-03-01T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s10","amount":{"value":8000},"fund_id":"F1"}]', NULL, NULL),
      ('g11', '110', 50, '2026-09-12T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s11","amount":{"value":50},"fund_id":"F1"}]', NULL, NULL),
      ('g12', '111', 6000, '2019-03-01T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s12","amount":{"value":6000},"fund_id":"F1"}]', NULL, NULL),
      ('g13', '111', 0, '2026-09-13T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s13","amount":{"value":0},"fund_id":"F1"}]', NULL, NULL);

    INSERT INTO addresses VALUES
      ('a1', '101', '12 Oak St', 'Tampa', 'FL', '33601', 'United States', 0, 1, 0),
      ('a2', '102', '4 Pine Rd', 'Orlando', 'FL', '32801', 'United States', 0, 1, 0),
      ('a3', '103', '9 Elm Ct', 'Miami', 'FL', '33101', 'United States', 0, 1, 0),
      ('a4', '201', '7 Bay Ave', 'Sarasota', 'FL', '34236', 'United States', 0, 1, 0),
      ('a5', '106', '5 Lake Dr', 'Ocala', 'FL', '34470', 'United States', 0, 1, 0);

    INSERT INTO emails VALUES
      ('e1', '101', 'ann@example.test', 1, 0, 0),
      ('e2', '102', 'grants@example.test', 1, 1, 0),
      ('e3', '103', 'donor@example.test', 1, 1, 0),
      ('e4', '201', 'typed@example.test', 1, 0, 0),
      ('e5', '107', 'dina@example.test', 1, 0, 0),
      ('e6', '108', 'ivy@example.test', 1, 0, 0),
      ('e7', '110', 'big@example.test', 1, 0, 0),
      ('e8', '111', 'zero@example.test', 1, 0, 0);

    INSERT INTO phones VALUES ('p1', '101', '813-555-0101', 'Mobile', 1, 0, 0), ('p2', '201', '941-555-0201', 'Home', 1, 1, 0);

    INSERT INTO actions VALUES
      ('x1', '101', 'RESERVED (HQTY Letter)', '2026-09-20', '2026-09-20', '{"completed":1}');
  `);
  return (sql, params = []) => db.prepare(sql).all(...params);
}

const opts = (sql, asked = {}, edits = {}) => ({ user: { email: 't@example.test', name: 'Test' }, asked, name: 'Test', sql, kpi: async () => null, edits, today: TODAY });

const hqty = await import('../functions/_lib/work/hqty.ts');

describe('gifts of $5,000 and up', () => {
  it('lists letters still to mail since January 1, sorted by gift date', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'new', min: '5000', letter: '' }));
    assert.deepEqual(r.rows.map((x) => x.gdate), ['2026-08-02', '2026-09-05', '2026-09-20', '2026-10-02']);
    assert.equal(r.count, 4);
    assert.equal(r.totals.amount, 51000);
    const byDate = Object.fromEntries(r.rows.map((x) => [x.gdate, x]));
    assert.equal(byDate['2026-09-20'].partner, 'Lakeside Foundation', 'the soft-credited partner is listed, not the giver');
    assert.equal(byDate['2026-09-20'].giver, 'Grace Donor');
    assert.equal(byDate['2026-09-20'].letter, 'Not mailed');
    assert.equal(byDate['2026-10-02'].letter, 'Not mailed', 'the letter logged on 9/20 is before this gift');
    assert.equal(byDate['2026-08-02'].letter, 'Hold', 'no address on record');
    assert.equal(byDate['2026-09-20'].address, '4 Pine Rd, Orlando, FL 32801');
  });

  it('counts an HQTY letter logged on or after the gift as mailed', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'month', min: '5000', letter: '' }));
    const byDate = Object.fromEntries(r.rows.map((x) => [x.gdate, x]));
    assert.equal(byDate['2026-09-15'].letter, 'Mailed');
    assert.equal(r.count, 3);
    assert.equal(r.totals.amount, 40000);
    const mailed = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '5000', letter: 'Mailed' }));
    assert.equal(mailed.count, 2);
  });

  it('leaves off a household whose every record is deceased or inactive, and keeps one with a living spouse', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '5000', letter: '' }));
    const partners = r.rows.map((x) => x.partner);
    assert.equal(partners.includes('Old Gift'), false, 'deceased, no spouse');
    assert.equal(partners.includes('Ivy Out'), false, 'inactive, spouse deceased');
    assert.equal(partners.includes('Dina Living'), true, 'deceased, spouse living');
  });

  it('ties its count to the gifts table, counting the households it leaves off', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '5000', letter: 'Not mailed' }));
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 8);
    assert.equal(r.count, 2, 'the letter filter narrows the rows, not the tie-out');
  });

  it('respects the $10,000 minimum', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '10000', letter: '' }));
    assert.deepEqual(r.rows.map((x) => x.amount).sort((a, b) => a - b), [12000, 25000]);
  });

  it('picks the same gifts as the Work Center HQTY letters desk, with the same letter status', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '5000', letter: '' }));
    const { shaped } = await hqty.loadHqty({}, sql, { today: TODAY });
    assert.deepEqual(r.rows.map((x) => x.gift_id).sort(), shaped.rows.map((x) => x.giftId).sort());
    const desk = Object.fromEntries(shaped.rows.map((x) => [x.giftId, x.state]));
    for (const row of r.rows) {
      const want = desk[row.gift_id] === 'mailed' ? 'Mailed' : null;
      if (want) assert.equal(row.letter, want, row.gift_id);
      else assert.notEqual(row.letter, 'Mailed', row.gift_id);
    }
  });
});

describe('six-week email list', () => {
  const typed = { 'T201|include': '1' };

  it('lists partners with any gift in the window and a largest gift of $5,000 or more at any date, or a typed-in id, who have an email', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, caroleList, opts(sql, { within: '24' }, typed));
    assert.deepEqual(r.rows.map((x) => x.id).sort(), ['101', '107', '110', '111', '201']);
    const ann = r.rows.find((x) => x.id === '101');
    assert.equal(ann.email, 'ann@example.test');
    assert.equal(ann.gifts, 3);
    assert.equal(ann.last_amt, 12000);
    assert.equal(ann.last_date, '2026-10-02');
    const big = r.rows.find((x) => x.id === '110');
    assert.equal(big.gifts, 1, 'only the gift in the window counts as a gift');
    assert.equal(big.largest, 8000, 'the largest gift comes from any date');
    assert.equal(r.rows.find((x) => x.id === '111').gifts, 1, 'a $0 gift in the window counts, as in query 1194');
  });

  it('credits a soft-credited gift to the recipient and leaves off a partner whose email is marked do not email', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, caroleList, opts(sql, { within: '24' }, typed));
    assert.equal(r.rows.some((x) => x.id === '102' || x.id === '103'), false);
    assert.equal(r.tiles.find((t) => t.label === 'Do not email').value, 1);
  });

  it('leaves off a household whose every record is deceased or inactive, and keeps one with a living spouse', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, caroleList, opts(sql, { within: '24' }, typed));
    assert.equal(r.rows.some((x) => x.id === '108'), false);
    assert.equal(r.rows.some((x) => x.id === '107'), true);
    assert.equal(r.tiles.find((t) => t.label === 'Deceased or inactive').value, 1);
  });

  it('ties the candidate count to the gifts table', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, caroleList, opts(sql, { within: '24' }, typed));
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 7);
  });
});

describe('thank-you packets', () => {
  it('lists the quarter\'s gifts of $5,000 and up with the partner, packet and email check', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, packets, opts(sql, { q: '2026-Q3', cat: '' }));
    assert.equal(r.count, 3);
    assert.equal(r.totals.amount, 20000);
    const byAmount = Object.fromEntries(r.rows.map((x) => [x.amount, x]));
    assert.equal(byAmount[6000].packet, 'Chad');
    assert.equal(byAmount[6000].send, 'Email');
    assert.equal(byAmount[5000].send, 'No email');
    assert.equal(byAmount[9000].send, 'Email');
    assert.equal(r.tiles.find((t) => t.label === 'Left off').sub, '1 do not email, 2 deceased or inactive households');
  });

  it('leaves off a do-not-email partner and a deceased or inactive household', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, packets, opts(sql, { q: '2026-Q3', cat: '' }));
    const partners = r.rows.map((x) => x.partner);
    assert.equal(partners.includes('Lakeside Foundation'), false);
    assert.equal(partners.includes('Old Gift'), false);
    assert.equal(partners.includes('Ivy Out'), false);
  });

  it('filters by category and still ties the whole quarter', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, packets, opts(sql, { q: '2026-Q3', cat: 'DAF Provider' }));
    assert.equal(r.count, 0);
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 60000);
  });

  it('the Q2 window holds one gift of $5,000 in this made-up set', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, packets, opts(sql, { q: '2026-Q2', cat: '' }));
    assert.equal(r.count, 1);
    assert.equal(r.rows[0].amount, 5200);
  });
});
