// Run with: npm test
//
// The lists that replace saved Blackbaud queries: Yesterday's gifts, Top partners by total giving, RDD and church engagement
// actions, Gifts with no fundraiser credit, and the query map. Each runs its real SQL against an in-memory SQLite stand-in for
// the mirror, with made-up partners, gifts and actions. The repository is public, so nothing here is real and no test touches a
// live database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import './support/resolve-ts.mjs';

const engine = await import('../functions/_lib/reports/engine.ts');
const reg = await import('../functions/_lib/reports/registry.ts');
const giftDay = (await import('../functions/_lib/reports/defs/gift-day.ts')).default;
const giftDayMod = await import('../functions/_lib/reports/defs/gift-day.ts');
const topPartners = (await import('../functions/_lib/reports/defs/top-partners.ts')).default;
const rddMod = await import('../functions/_lib/reports/defs/rdd-actions.ts');
const rddActions = rddMod.default;
const gapsMod = await import('../functions/_lib/reports/defs/credit-gaps.ts');
const creditGaps = gapsMod.default;
const queryMap = (await import('../functions/_lib/reports/defs/query-map.ts')).default;
const { QUERY_MAP } = await import('../functions/_lib/reports/qmap.ts');

const TODAY = '2026-10-12'; // a Monday

function mirror() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, constituent_type TEXT, first_name TEXT, middle_name TEXT, last_name TEXT,
      organization_name TEXT, spouse_first_name TEXT, spouse_last_name TEXT, spouse_id TEXT, primary_address_id TEXT, inactive INTEGER, deceased INTEGER);
    CREATE TABLE addresses (id TEXT, constituent_record_id TEXT, address_lines TEXT, address_city TEXT, address_state TEXT);
    CREATE TABLE emails (id TEXT, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER, do_not_email INTEGER, is_inactive INTEGER);
    CREATE TABLE phones (id TEXT, constituent_record_id TEXT, phone_number TEXT, is_primary INTEGER, is_inactive INTEGER);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT);
    CREATE TABLE assignments (id TEXT, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    CREATE TABLE appeals (id TEXT, appeal_id TEXT, appeal_category TEXT);
    CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT, gift_splits TEXT,
      soft_credits TEXT, fundraiser_credits TEXT);
    CREATE TABLE actions (id TEXT, constituent_record_id TEXT, action_type TEXT, action_category TEXT, action_date_due TEXT, action_completed_date TEXT,
      action_fundraiser_id TEXT, raw_json TEXT);
    CREATE TABLE action_tags (id TEXT, action_ask_amount REAL, action_referrals REAL, attended_Hosted TEXT, presented INTEGER, scheduling INTEGER,
      stewardship INTEGER, texted INTEGER, thanked INTEGER);

    INSERT INTO constituents VALUES
      ('1', 'L1', 'Individual', 'Ann', 'Marie', 'Smith', NULL, NULL, NULL, NULL, 'a1', 0, 0),
      ('2', 'L2', 'Organization', NULL, NULL, NULL, 'Lakeside Fund', NULL, NULL, NULL, 'a2', 0, 0),
      ('3', 'L3', 'Individual', 'Ben', NULL, 'Lee', NULL, NULL, NULL, NULL, NULL, 0, 0),
      ('4', 'L4', 'Individual', 'Cy', NULL, 'Dunn', NULL, NULL, NULL, NULL, NULL, 1, 0),
      ('5', 'L5', 'Individual', 'Di', NULL, 'Ray', NULL, NULL, NULL, NULL, NULL, 0, 0),
      ('90', 'F90', 'Individual', 'Rita', NULL, 'Director', NULL, NULL, NULL, NULL, NULL, 0, 0),
      ('91', 'F91', 'Individual', 'Pat', NULL, 'Care', NULL, NULL, NULL, NULL, NULL, 0, 0),
      ('92', 'F92', 'Individual', 'Newly', NULL, 'Hired', NULL, NULL, NULL, NULL, NULL, 0, 0);
    INSERT INTO addresses VALUES ('a1', '1', '1 Oak St', 'Tampa', 'FL'), ('a2', '2', '2 Pine Rd', 'Orlando', 'FL');
    INSERT INTO emails VALUES ('e1', '1', 'ann@example.test', 1, 0, 0), ('e2', '2', 'old@example.test', 1, 0, 1);
    INSERT INTO phones VALUES ('p1', '1', '813-555-0101', 1, 0);
    INSERT INTO fundraisers VALUES ('90', 'Rita', 'Director', 'Regional Development Director (RDD)'), ('91', 'Pat', 'Care', 'Partner Care');
    INSERT INTO assignments VALUES
      ('x1', '1', '90', 'Regional Development Director (RDD)', NULL),
      ('x2', '1', '91', 'Partner Care', NULL),
      ('x3', '2', '91', 'Partner Care', NULL),
      ('x4', '3', '90', 'Regional Development Director (RDD)', '2026-01-01T00:00:00'),
      ('x5', '5', '92', 'Regional Development Director (RDD)', NULL);
    INSERT INTO appeals VALUES ('ap1', 'P200-RDAD', 'Portfolio'), ('ap2', 'L268-AD', 'Direct Mail Appeal'), ('ap3', 'Y268-TY', 'Personal Contact'), ('ap4', 'Z200-REIM', 'Other');

    INSERT INTO gifts VALUES
      -- Friday to Sunday before the Monday
      ('g1', '1', 50, '2026-10-09T00:00:00', 'Donation', 'Active', '[{"amount":{"value":50},"appeal_id":"ap1"},{"amount":{"value":0},"appeal_id":"ap3"}]', NULL, '[{"constituent_id":"90"}]'),
      ('g2', '3', 25, '2026-10-10T00:00:00', 'RecurringGiftPayment', 'Active', '[{"amount":{"value":25},"appeal_id":"ap1"}]', NULL, NULL),
      ('g3', '2', 7000, '2026-10-11T00:00:00', 'Donation', 'Active', '[{"amount":{"value":7000},"appeal_id":"ap3"}]', '[{"constituent_id":"2","amount":{"value":4000}},{"constituent_id":"1","amount":{"value":3000}}]', NULL),
      ('g4', '5', 3, '2026-10-11T00:00:00', 'Donation', 'Active', '[{"amount":{"value":3},"appeal_id":"ap1"}]', NULL, NULL),
      ('g5', '1', 200, '2026-10-11T00:00:00', 'RecurringGift', 'Active', '[{"amount":{"value":200},"appeal_id":"ap1"}]', NULL, NULL),
      ('g6', '5', 60, '2026-10-08T00:00:00', 'Donation', 'Active', '[{"amount":{"value":60},"appeal_id":"ap1"}]', NULL, NULL),
      -- older giving for totals
      ('g7', '1', 30000, '2025-05-01T00:00:00', 'Donation', 'Active', '[{"amount":{"value":30000},"appeal_id":"ap2"}]', NULL, '[{"constituent_id":"90"}]'),
      ('g8', '4', 60000, '2024-05-01T00:00:00', 'Donation', 'Active', '[{"amount":{"value":60000},"appeal_id":"ap2"}]', NULL, NULL),
      ('g9', '1', 9000, '2026-02-01T00:00:00', 'RecurringGift', 'Active', '[]', NULL, NULL),
      ('g10', '3', 1500, '2026-03-02T00:00:00', 'Donation', 'Active', '[{"amount":{"value":1500},"appeal_id":"ap4"}]', NULL, NULL),
      ('g11', '5', 2500, '2026-04-02T00:00:00', 'Donation', 'Active', '[{"amount":{"value":2500},"appeal_id":"ap3"}]', NULL, '[]'),
      ('g12', '1', 800, '2026-09-20T00:00:00', 'Donation', 'Active', '[{"amount":{"value":800},"appeal_id":"ap3"}]', NULL, NULL);

    INSERT INTO actions VALUES
      ('a10', '1', 'RDD Action', 'Phone call', '2026-10-05T00:00:00', '2026-10-05T00:00:00', '["90"]', '{"completed":true}'),
      ('a11', '1', 'RDD Action', 'Email', '2026-09-30T00:00:00', '2026-09-30T00:00:00', '["90","92"]', '{"completed":true}'),
      ('a12', '2', 'CED Action', 'Meeting', '2026-10-06T00:00:00', '2026-10-07T00:00:00', '["92"]', '{"completed":true}'),
      ('a13', '3', 'PC Action', 'Email', '2026-10-06T00:00:00', '2026-10-06T00:00:00', '["91"]', '{"completed":true}'),
      ('a14', '5', 'RDD Action', 'Phone call', '2026-10-08T00:00:00', NULL, '["90"]', '{"completed":false}'),
      ('a15', '5', 'RDD Action', 'Task/Other', '2026-10-08T00:00:00', '2026-10-08T00:00:00', '["90"]', '{"completed":true}'),
      ('a16', '2', 'RDD Action', 'Phone call', '2026-10-02T00:00:00', '2026-10-02T00:00:00', '["90"]', '{"completed":true}');
    INSERT INTO action_tags VALUES
      ('a10', 500, 2, 'Attended', 1, 0, 1, 1, 1),
      ('a11', NULL, NULL, NULL, 0, 1, 0, 0, 0),
      ('a12', NULL, NULL, 'Hosted', 0, 0, 0, 0, 0);
  `);
  return (sql, params = []) => db.prepare(sql).all(...params);
}

const opts = (sql, asked = {}, edits = {}, today = TODAY) => ({ user: { email: 't@example.test', name: 'Test' }, asked, name: 'Test', sql, kpi: async () => null, edits, today });

describe("yesterday's gifts", () => {
  it('looks back over the weekend on a Monday and at yesterday on other days', () => {
    assert.deepEqual(giftDayMod.rangeFor('2026-10-12', { when: 'since' }), ['2026-10-09', '2026-10-11']);
    assert.deepEqual(giftDayMod.rangeFor('2026-10-13', { when: 'since' }), ['2026-10-12', '2026-10-12']);
    assert.deepEqual(giftDayMod.rangeFor('2026-10-13', { when: 'week' }), ['2026-10-06', '2026-10-12']);
    assert.deepEqual(giftDayMod.rangeFor('2026-10-13', { when: 'custom', from: '2026-10-05', to: '2026-10-01' }), ['2026-10-01', '2026-10-05']);
  });

  it('gives one row per gift and open assignment, with the soft credit recipient as the partner', async () => {
    const r = await engine.runReport({}, giftDay, opts(mirror(), { when: 'since' }));
    const g3 = r.rows.filter((x) => x.gid === 'g3');
    assert.deepEqual(g3.map((x) => x.partner).sort(), ['Ann M. Smith', 'Ann M. Smith', 'Lakeside Fund']);
    assert.equal(g3.find((x) => x.partner === 'Lakeside Fund').giver, '', 'the giver is the partner itself, so nothing is shown as soft credited from');
    const ann = g3.filter((x) => x.partner === 'Ann M. Smith');
    assert.deepEqual(ann.map((x) => x.holder).sort(), ['Pat Care', 'Rita Director']);
    assert.equal(ann[0].giver, 'Lakeside Fund');
  });

  it('shows each appeal of a split gift on one row and the last action of the partner', async () => {
    const r = await engine.runReport({}, giftDay, opts(mirror(), { when: 'since' }));
    const g1 = r.rows.filter((x) => x.gid === 'g1');
    assert.equal(g1.length, 2, 'two holders, one row each');
    assert.equal(g1[0].appeal, 'P200-RDAD, Y268-TY');
    assert.equal(g1[0].last_date, '2026-10-05');
    assert.equal(g1[0].last_type, 'RDD Action');
    assert.equal(g1[0].last_done, 'Yes');
    assert.equal(g1[0].email, 'ann@example.test');
    assert.equal(g1[0].phone, '813-555-0101');
  });

  it('keeps recurring gift setups and payments by default and leaves out gifts under the amount', async () => {
    const r = await engine.runReport({}, giftDay, opts(mirror(), { when: 'since' }));
    const ids = new Set(r.rows.map((x) => x.gid));
    assert.equal(ids.has('g5'), true, 'a new recurring gift is the first call Partner Care makes');
    assert.equal(ids.has('g2'), true);
    assert.equal(ids.has('g4'), false, 'under $5');
    assert.equal(ids.has('g6'), false, 'before the weekend');
    const any = await engine.runReport({}, giftDay, opts(mirror(), { when: 'since', min: '0.01' }));
    assert.equal(any.rows.some((x) => x.gid === 'g4'), true);
    const oneoff = await engine.runReport({}, giftDay, opts(mirror(), { when: 'since', types: 'oneoff' }));
    assert.equal(oneoff.rows.some((x) => x.gid === 'g5' || x.gid === 'g2'), false);
  });

  it('shows a partner nobody holds with an empty holder and filters by who holds it', async () => {
    const sql = mirror();
    const all = await engine.runReport({}, giftDay, opts(sql, { when: 'since' }));
    const g2 = all.rows.find((x) => x.gid === 'g2');
    assert.equal(g2.holder, '', 'the only assignment ended');
    const none = await engine.runReport({}, giftDay, opts(sql, { when: 'since', holder: 'none' }));
    assert.deepEqual(new Set(none.rows.map((x) => x.gid)), new Set(['g2']));
    const pc = await engine.runReport({}, giftDay, opts(sql, { when: 'since', holder: 'Partner Care' }));
    assert.equal(pc.rows.every((x) => x.holder === 'Pat Care'), true);
    const dir = await engine.runReport({}, giftDay, opts(sql, { when: 'since', holder: 'director' }));
    assert.equal(dir.rows.every((x) => x.holder === 'Rita Director'), true);
    const named = await engine.runReport({}, giftDay, opts(sql, { when: 'since', who: 'rita' }));
    assert.equal(named.rows.length, dir.rows.length);
  });

  it('names a fundraiser added since the last sync from the constituent record', async () => {
    const r = await engine.runReport({}, giftDay, opts(mirror(), { when: 'custom', from: '2026-10-08', to: '2026-10-08' }));
    assert.equal(r.rows.find((x) => x.gid === 'g6').holder, 'Newly Hired');
  });

  it('counts the giver as well as the recipient when asked', async () => {
    const sql = mirror();
    const recipients = await engine.runReport({}, giftDay, opts(sql, { when: 'since' }));
    const both = await engine.runReport({}, giftDay, opts(sql, { when: 'since', credit: 'both' }));
    assert.equal(recipients.rows.filter((x) => x.gid === 'g3').length, 3);
    assert.equal(both.rows.filter((x) => x.gid === 'g3' && x.partner === 'Lakeside Fund').length >= 1, true);
  });

  it('ties its gift count to the gifts table and counts a gift once in the total', async () => {
    const r = await engine.runReport({}, giftDay, opts(mirror(), { when: 'since' }));
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 4);
    assert.equal(r.totals.amount, 14275, 'g1 50 + g2 25 + g5 200, and g3 7000 once for each of its two partners; the second holder adds nothing');
  });
});

describe('top partners by total giving', () => {
  it('counts the whole gift for each soft credit recipient, as Blackbaud totals it, and leaves recurring setups out', async () => {
    const r = await engine.runReport({}, topPartners, opts(mirror(), { min: '10000' }));
    assert.deepEqual(r.rows.map((x) => x.lookup).sort(), ['L1', 'L4']);
    const by = Object.fromEntries(r.rows.map((x) => [x.lookup, x]));
    assert.equal(by.L1.total, 37850, 'g7 30000 + g3 7000 whole + g1 50 + g12 800; the 9000 recurring setup and the 200 setup are not counted');
    assert.equal(by.L4.total, 60000);
    assert.equal(by.L4.status, 'Inactive', 'an inactive record stays on the list and says so');
    const small = await engine.runReport({}, topPartners, opts(mirror(), { min: '10000' }));
    assert.equal(small.rows.some((x) => x.lookup === 'L2'), false, 'a 4000 credit portion would not reach the cut-off, and 7000 is under it');
  });

  it('applies the cut-off and the years counted', async () => {
    const sql = mirror();
    const high = await engine.runReport({}, topPartners, opts(sql, { min: '50000' }));
    assert.deepEqual(high.rows.map((x) => x.lookup), ['L4']);
    const year = await engine.runReport({}, topPartners, opts(sql, { min: '10000', within: 'year' }));
    assert.deepEqual(year.rows.map((x) => x.lookup), []);
    const last = await engine.runReport({}, topPartners, opts(sql, { min: '10000', within: 'last' }));
    assert.deepEqual(last.rows.map((x) => x.lookup), ['L1']);
  });

  it('shows who holds the partner, filters on it, and ties to the gifts table', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, topPartners, opts(sql, { min: '10000', who: 'rita' }));
    assert.deepEqual(r.rows.map((x) => x.lookup), ['L1']);
    assert.equal(r.tie.status, 'match');
    assert.equal(r.tie.mine, 2, 'the tie counts every partner at the cut-off, not the narrowed list');
  });
});

describe('RDD and church engagement actions', () => {
  it('lists completed RDD and CED actions in the dates with the tags typed on each', async () => {
    const r = await engine.runReport({}, rddActions, opts(mirror(), { when: 'custom', from: '2026-10-01', to: '2026-10-09' }, {}));
    assert.deepEqual(r.rows.map((x) => x.id), ['a16', 'a10', 'a12', 'a15']);
    const a10 = r.rows.find((x) => x.id === 'a10');
    assert.equal(a10.fundraisers, 'Director, Rita');
    assert.equal(a10.ask, 500);
    assert.equal(a10.referrals, 2);
    assert.equal(a10.attended, 'Attended');
    assert.equal(a10.hosted, '');
    assert.equal(a10.presented, 'Presented');
    assert.equal(a10.texted, 'Texted');
    assert.equal(a10.thanked, 'Thanked');
    assert.equal(r.rows.find((x) => x.id === 'a12').hosted, 'Hosted');
  });

  it('leaves out open actions and other types, and filters by type and fundraiser', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, rddActions, opts(sql, { when: 'custom', from: '2026-10-01', to: '2026-10-09' }));
    const ids = r.rows.map((x) => x.id);
    assert.equal(ids.includes('a13'), false, 'a PC action');
    assert.equal(ids.includes('a14'), false, 'not completed');
    const ced = await engine.runReport({}, rddActions, opts(sql, { when: 'custom', from: '2026-10-01', to: '2026-10-09', types: 'ced' }));
    assert.deepEqual(ced.rows.map((x) => x.id), ['a12']);
    const who = await engine.runReport({}, rddActions, opts(sql, { when: 'custom', from: '2026-09-01', to: '2026-10-09', who: 'hired' }));
    assert.deepEqual(who.rows.map((x) => x.id), ['a11', 'a12']);
  });

  it('names a fundraiser the fundraisers table does not hold yet from the constituent record', async () => {
    const r = await engine.runReport({}, rddActions, opts(mirror(), { when: 'custom', from: '2026-09-30', to: '2026-09-30' }));
    assert.equal(r.rows[0].fundraisers, 'Director, Rita; Hired, Newly');
  });

  it('leaves out the partners on the leave-out list and says how many', async () => {
    const r = await engine.runReport({}, rddActions, opts(mirror(), { when: 'custom', from: '2026-10-01', to: '2026-10-09' }, { 'L2|leave_out': '1' }));
    assert.equal(r.rows.some((x) => x.partner === 'Lakeside Fund'), false);
    assert.equal(r.tie.status, 'match');
    assert.match(r.tie.note, /2 left out/);
  });

  it('this month starts on the first, last month is the whole month before', () => {
    assert.deepEqual(rddMod.rangeFor('2026-10-12', { when: 'month' }), ['2026-10-01', '2026-10-12']);
    assert.deepEqual(rddMod.rangeFor('2026-10-12', { when: 'last-month' }), ['2026-09-01', '2026-09-30']);
    assert.deepEqual(rddMod.rangeFor('2026-10-12', { when: '30' }), ['2026-09-13', '2026-10-12']);
  });
});


describe('gifts with no fundraiser credit', () => {
  it('lists gifts without a credit and skips the appeals and categories the saved query skips', async () => {
    const r = await engine.runReport({}, creditGaps, opts(mirror(), { list: 'gaps' }));
    const ids = new Set(r.rows.map((x) => x.gid));
    assert.equal(ids.has('g1'), false, 'it has a fundraiser credit');
    assert.equal(ids.has('g7'), false, 'it has a fundraiser credit');
    assert.equal(ids.has('g8'), false, 'before January 2025');
    assert.equal(ids.has('g10'), false, 'the only split sits on a skipped appeal');
    assert.equal(ids.has('g2'), true);
    assert.equal(ids.has('g11'), true, 'an empty credit list is no credit');
    const g12 = r.rows.find((x) => x.gid === 'g12');
    assert.equal(g12.appeal, 'Y268-TY');
    assert.equal(g12.category, 'Personal Contact');
  });

  it('ties the list plus the skipped gifts to every gift with no credit', async () => {
    const r = await engine.runReport({}, creditGaps, opts(mirror(), { list: 'gaps' }));
    assert.equal(r.tie.status, 'match');
    assert.match(r.tie.note, /on skipped appeals/);
  });

  it('shows the major list for one-time and recurring payments of $1,000 or more, without the patron list', async () => {
    const sql = mirror();
    const r = await engine.runReport({}, creditGaps, opts(sql, { list: 'major' }));
    assert.deepEqual([...new Set(r.rows.map((x) => x.gid))].sort(), ['g10', 'g11', 'g3']);
    const patron = await engine.runReport({}, creditGaps, opts(sql, { list: 'major' }, { 'L5|patron': '1' }));
    assert.deepEqual([...new Set(patron.rows.map((x) => x.gid))].sort(), ['g10', 'g3']);
  });

  it('credits the personal contact list to the giver and needs a Partner Care holder', async () => {
    const r = await engine.runReport({}, creditGaps, opts(mirror(), { list: 'pc', when: 'custom', from: '2026-01-01', to: '2026-10-12' }));
    assert.deepEqual(r.rows.map((x) => x.gid).sort(), ['g12', 'g3', 'g5']);
    assert.equal(r.rows.find((x) => x.gid === 'g3').partner, 'Lakeside Fund', 'the giver, not the soft credit recipient');
  });

  it('uses last month for the personal contact list unless dates are picked', () => {
    assert.deepEqual(gapsMod.rangeFor('2026-10-12', { list: 'pc' }), ['2026-09-01', '2026-09-30']);
    assert.deepEqual(gapsMod.rangeFor('2026-10-12', { list: 'gaps' }), ['2025-01-01', '2026-10-12']);
  });
});


describe('the query map', () => {
  it('gives every query a number, a replacement and a statement of how it was checked', () => {
    assert.equal(QUERY_MAP.length, 105);
    for (const r of QUERY_MAP) {
      assert.equal(r.length, 9);
      assert.match(r[7], /^\d+$/, `query number for ${r[0]}`);
      assert.ok(r[8].length > 3, `tie-out text for ${r[0]}`);
      assert.ok(r[5].length > 3, `replacement for ${r[0]}`);
    }
    assert.equal(new Set(QUERY_MAP.map((r) => r[7])).size, 105);
  });

  it('points every report replacement at a report that exists', () => {
    for (const r of QUERY_MAP.filter((x) => x[4] === 'report' && x[6])) assert.ok(reg.entryOf(r[6]), `${r[0]} -> ${r[6]}`);
  });

  it('shows the queries run in the last 120 days when asked', async () => {
    const all = await engine.runReport({}, queryMap, opts(() => [], {}, {}, '2026-10-12'));
    const recent = await engine.runReport({}, queryMap, opts(() => [], { recent: '120' }, {}, '2026-10-12'));
    assert.equal(all.count, 105);
    assert.ok(recent.count > 50 && recent.count < 105);
    assert.ok(recent.rows.every((r) => r.last >= '2026-06-14'));
    const wc = await engine.runReport({}, queryMap, opts(() => [], { recent: '120', now: 'report' }, {}, '2026-10-12'));
    assert.ok(wc.rows.length > 0 && wc.rows.every((r) => r.kind === 'report'));
  });

  it('has a replacement that is not "nothing" for every query run in the last 120 days', async () => {
    const recent = await engine.runReport({}, queryMap, opts(() => [], { recent: '120' }, {}, '2026-10-12'));
    for (const r of recent.rows) assert.ok(['report', 'wc', 'machine', 'oneoff', 'brain'].includes(r.kind), r.query);
    // A report replacement is a page that exists, built or on its way in another lane (mailing).
    for (const r of recent.rows.filter((x) => x.kind === 'report' && x.report)) assert.ok(reg.entryOf(r.report), r.query);
  });
});

describe('the registry', () => {
  it('lists the four new reports with a definition', () => {
    for (const id of ['gift-day', 'top-partners', 'rdd-actions', 'credit-gaps']) {
      assert.ok(reg.entryOf(id), id);
      assert.equal(reg.isReady(id), true, id);
    }
  });
});
