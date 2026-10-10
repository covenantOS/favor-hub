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
    CREATE TABLE constituents (id TEXT, constituent_type TEXT, first_name TEXT, last_name TEXT, organization_name TEXT, inactive INTEGER, deceased INTEGER);
    CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT,
                        gift_constituency TEXT, gift_splits TEXT, soft_credits TEXT);
    CREATE TABLE addresses (id TEXT, constituent_record_id TEXT, address_lines TEXT, address_city TEXT, address_state TEXT,
                            address_postal_code TEXT, is_primary INTEGER, is_inactive INTEGER);
    CREATE TABLE emails (id TEXT, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER, do_not_email INTEGER, is_inactive INTEGER);
    CREATE TABLE phones (id TEXT, constituent_record_id TEXT, phone_number TEXT, phone_type TEXT, is_primary INTEGER, do_not_call INTEGER, is_inactive INTEGER);
    CREATE TABLE actions (id TEXT, constituent_record_id TEXT, action_type TEXT, action_completed_date TEXT, action_date_due TEXT, raw_json TEXT);

    INSERT INTO funds VALUES ('F1', 'Where Needed Most'), ('F2', 'Chad Radio');

    INSERT INTO constituents VALUES
      ('101', 'Individual', 'Ann', 'Smith', NULL, 0, 0),
      ('102', 'Organization', NULL, NULL, 'Lakeside Foundation', 0, 0),
      ('103', 'Individual', 'Grace', 'Donor', NULL, 0, 0),
      ('104', 'Individual', 'Ben', 'Lee', NULL, 0, 0),
      ('105', 'Individual', 'Old', 'Gift', NULL, 0, 1),
      ('201', 'Individual', 'Typed', 'Partner', NULL, 0, 0);

    INSERT INTO gifts VALUES
      ('g1', '101', 6000, '2026-09-15T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s1","amount":{"value":6000},"fund_id":"F2"}]', NULL),
      ('g2', '103', 25000, '2026-09-20T10:00:00', 'Donation', 'Active', 'DAF Provider', '[{"id":"s2","amount":{"value":25000},"fund_id":"F1"}]', '[{"constituent_id":"102","amount":25000}]'),
      ('g3', '104', 5000, '2026-08-02T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s3","amount":{"value":5000},"fund_id":"F1"}]', NULL),
      ('g4', '105', 7000, '2026-09-10T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s4","amount":{"value":7000},"fund_id":"F1"}]', NULL),
      ('g5', '101', 5200, '2026-05-01T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s5","amount":{"value":5200},"fund_id":"F1"}]', NULL),
      ('g6', '101', 12000, '2026-10-02T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s6","amount":{"value":12000},"fund_id":"F1"}]', NULL),
      ('g7', '201', 40, '2026-09-01T10:00:00', 'Donation', 'Active', 'Partner', '[{"id":"s7","amount":{"value":40},"fund_id":"F1"}]', NULL);

    INSERT INTO addresses VALUES
      ('a1', '101', '12 Oak St', 'Tampa', 'FL', '33601', 1, 0),
      ('a2', '102', '4 Pine Rd', 'Orlando', 'FL', '32801', 1, 0),
      ('a3', '103', '9 Elm Ct', 'Miami', 'FL', '33101', 1, 0),
      ('a4', '201', '7 Bay Ave', 'Sarasota', 'FL', '34236', 1, 0);

    INSERT INTO emails VALUES
      ('e1', '101', 'ann@example.test', 1, 0, 0),
      ('e2', '102', 'grants@example.test', 1, 1, 0),
      ('e3', '103', 'donor@example.test', 1, 1, 0),
      ('e4', '201', 'typed@example.test', 1, 0, 0);

    INSERT INTO phones VALUES ('p1', '101', '813-555-0101', 'Mobile', 1, 0, 0), ('p2', '201', '941-555-0201', 'Home', 1, 1, 0);

    INSERT INTO actions VALUES
      ('x1', '101', 'RESERVED (HQTY Letter)', '2026-09-20', '2026-09-20', '{"completed":1}');
  `);
  return (sql, params = []) => db.prepare(sql).all(...params);
}

const opts = (sql, asked = {}, edits = {}) => ({ user: { email: 't@example.test', name: 'Test' }, asked, name: 'Test', sql, kpi: async () => null, edits, today: TODAY });

describe('gifts of $5,000 and up', () => {
  it('lists gifts not yet mailed in the last 12 months, sorted by gift date', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'new', min: '5000', letter: '' }));
    assert.deepEqual(r.rows.map((x) => x.gdate), ['2026-08-02', '2026-09-10', '2026-09-20', '2026-10-02']);
    assert.equal(r.count, 4);
    assert.equal(r.totals.amount, 49000);
    const byDate = Object.fromEntries(r.rows.map((x) => [x.gdate, x]));
    assert.equal(byDate['2026-09-20'].partner, 'Lakeside Foundation', 'the soft-credited partner is listed, not the giver');
    assert.equal(byDate['2026-09-20'].through, 'DAF');
    assert.equal(byDate['2026-09-20'].letter, 'Not mailed');
    assert.equal(byDate['2026-10-02'].letter, 'Not mailed');
    assert.equal(byDate['2026-09-10'].letter, 'Hold', 'no address on record');
    assert.equal(byDate['2026-08-02'].letter, 'Hold', 'no address on record');
    assert.equal(byDate['2026-09-20'].address, '4 Pine Rd, Orlando, FL 32801');
  });

  it('counts an HQTY letter logged on or after the gift as mailed', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'month', min: '5000', letter: '' }));
    const byDate = Object.fromEntries(r.rows.map((x) => [x.gdate, x]));
    assert.equal(byDate['2026-09-15'].letter, 'Mailed');
    assert.equal(r.count, 3);
    assert.equal(r.totals.amount, 38000);
    const mailed = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '5000', letter: 'Mailed' }));
    assert.equal(mailed.count, 2);
  });

  it('ties its total to the gifts table for the same dates and minimum', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '5000', letter: 'Not mailed' }));
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 60200);
    assert.equal(r.count, 2, 'the letter filter narrows the rows, not the tie-out');
  });

  it('respects the $10,000 minimum', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, largeGifts, opts(sql, { preset: 'year', min: '10000', letter: '' }));
    assert.deepEqual(r.rows.map((x) => x.amount).sort((a, b) => a - b), [12000, 25000]);
  });
});

describe('six-week email list', () => {
  const typed = { '201|include': '1' };

  it('lists partners with a largest gift of $5,000 or more, or a typed-in id, who have an email and an address', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, caroleList, opts(sql, { within: '24' }, typed));
    assert.deepEqual(r.rows.map((x) => x.id).sort(), ['101', '201']);
    const ann = r.rows.find((x) => x.id === '101');
    assert.equal(ann.email, 'ann@example.test');
    assert.equal(ann.gifts, 3);
    assert.equal(ann.last_amt, 12000);
    assert.equal(ann.last_date, '2026-10-02');
  });

  it('leaves off a partner whose email is marked do not email, and says how many', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, caroleList, opts(sql, { within: '24' }, typed));
    assert.equal(r.rows.some((x) => x.id === '103'), false);
    assert.equal(r.tiles.find((t) => t.label === 'Do not email').value, 1);
  });

  it('ties the candidate count to the gifts table', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, caroleList, opts(sql, { within: '24' }, typed));
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 5);
  });
});

describe('thank-you packets', () => {
  it('lists the quarter\'s gifts of $5,000 and up with the partner, packet and email check', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, packets, opts(sql, { q: '2026-Q3', cat: '' }));
    assert.equal(r.count, 4);
    assert.equal(r.totals.amount, 43000);
    const byAmount = Object.fromEntries(r.rows.map((x) => [x.amount, x]));
    assert.equal(byAmount[6000].packet, 'Chad');
    assert.equal(byAmount[6000].send, 'Email');
    assert.equal(byAmount[25000].partner, 'Lakeside Foundation');
    assert.equal(byAmount[25000].packet, 'Ev & Disc');
    assert.equal(byAmount[25000].send, 'Do not email');
    assert.equal(byAmount[5000].send, 'No email');
    assert.equal(r.tiles.find((t) => t.label === 'Foundation and DAF').value, 1);
  });

  it('filters by category and still ties the whole quarter', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, packets, opts(sql, { q: '2026-Q3', cat: 'DAF Provider' }));
    assert.equal(r.count, 1);
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 43000);
  });

  it('the Q2 window holds no gifts of $5,000 in this made-up set', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, packets, opts(sql, { q: '2026-Q2', cat: '' }));
    assert.equal(r.count, 1);
    assert.equal(r.rows[0].amount, 5200);
  });
});
