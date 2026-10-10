// Run with: npm test
//
// Reports group B3, partner and mailing lists: Active, LYBUNT and lapsed partners, Appeal mailing list, Portfolio export and
// Prayer list. Made-up names and figures only: the repository is public and no test touches a live database. The mirror and
// the KPI dashboard are stand-ins, picked by the marker comment each definition puts at the top of its SQL.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const engine = await import('../functions/_lib/reports/engine.ts');
const shared = await import('../functions/_lib/reports/defs/lists-shared.ts');
const status = (await import('../functions/_lib/reports/defs/status.ts')).default;
const mailing = (await import('../functions/_lib/reports/defs/mailing.ts')).default;
const portfolio = (await import('../functions/_lib/reports/defs/portfolio.ts')).default;
const prayer = (await import('../functions/_lib/reports/defs/prayer.ts')).default;
const reg = await import('../functions/_lib/reports/registry.ts');
const csv = await import('../functions/_lib/reports/csv.ts');

const user = { email: 'a@x.org', name: 'A' };
const TODAY = '2026-10-10';

// ---- the household rule, on made-up partners ----
const CONS = [
  { id: '1', spouse_id: '2', deceased: 0, inactive: 0 },
  { id: '2', spouse_id: '1', deceased: 0, inactive: 0 },
  { id: '3', spouse_id: null, deceased: 0, inactive: 0 },
  { id: '4', spouse_id: null, deceased: 1, inactive: 0 },
  { id: '5', spouse_id: '6', deceased: 0, inactive: 1 },
  { id: '6', spouse_id: '5', deceased: 1, inactive: 0 },
  { id: '7', spouse_id: null, deceased: 0, inactive: 0 },
  { id: '8', spouse_id: null, deceased: 0, inactive: 0 },
  { id: '9', spouse_id: null, deceased: 0, inactive: 0 },
  { id: '10', spouse_id: '11', deceased: 1, inactive: 0 },
  { id: '11', spouse_id: '10', deceased: 0, inactive: 0 },
];
const credit = (rid, first_d, last_d, total, n, big, last_amt) => ({ rid, first_d, last_d, total, n, big, last_amt });
const CREDITS = [
  credit('1', '2020-01-01', '2026-03-01', 500, 5, 200, 100),
  credit('2', '2021-01-01', '2026-09-01', 300, 3, 150, 60),
  credit('3', '2022-01-01', '2025-06-01', 80, 2, 50, 30),
  credit('4', '2022-01-01', '2025-06-01', 90, 2, 50, 40),
  credit('5', '2019-01-01', '2023-01-01', 70, 1, 70, 70),
  credit('6', '2019-01-01', '2023-01-01', 20, 1, 20, 20),
  credit('7', '2019-01-01', '2023-06-01', 40, 1, 40, 40),
  credit('8', '2025-10-10', '2025-10-10', 25, 1, 25, 25),
  credit('9', '2024-10-10', '2024-10-10', 35, 1, 35, 35),
  credit('10', '2023-01-01', '2023-02-01', 60, 2, 30, 30),
];
// Active 1 (partners 1 and 2 are one household), LYBUNT 2 (3 and 8), lapsed 3 (7, 9 and the household 10 and 11 whose living spouse keeps it in).
const COUNTS = { active: 1, lybunt: 2, lapsed: 3 };

const PEOPLE = {
  1: { id: '1', lookup: '1001', type: 'Individual', first: 'Ann', last: 'Lake', org: null, sf: 'Ben', sl: 'Lake', city: 'Tulsa', state: 'OK' },
  2: { id: '2', lookup: '1002', type: 'Individual', first: 'Ben', last: 'Lake', org: null, sf: 'Ann', sl: 'Lake', city: 'Tulsa', state: 'OK' },
  3: { id: '3', lookup: '1003', type: 'Individual', first: 'Cy', last: 'Moss', org: null, sf: null, sl: null, city: 'Reno', state: 'NV' },
  7: { id: '7', lookup: '1007', type: 'Individual', first: 'Di', last: 'Pine', org: null, sf: null, sl: null, city: 'Mesa', state: 'AZ' },
  8: { id: '8', lookup: '1008', type: 'Organization', first: null, last: null, org: 'Test Chapel', sf: null, sl: null, city: 'Tulsa', state: 'OK' },
  9: { id: '9', lookup: '1009', type: 'Individual', first: 'Eve', last: 'Rowe', org: null, sf: null, sl: null, city: 'Reno', state: 'NV' },
  10: { id: '10', lookup: '1010', type: 'Individual', first: 'Fay', last: 'Birch', org: null, sf: 'Gus', sl: 'Birch', city: 'Mesa', state: 'AZ' },
  11: { id: '11', lookup: '1011', type: 'Individual', first: 'Gus', last: 'Birch', org: null, sf: 'Fay', sl: 'Birch', city: 'Mesa', state: 'AZ' },
};
const HOLDERS = [
  { cid: '1', type: 'Regional Development Director (RDD)', first: 'Dir', last: 'One' },
  { cid: '3', type: 'Partner Care', first: 'Care', last: 'Person' },
  { cid: '7', type: 'Prospect Steward', first: 'Dir', last: 'Two' },
  { cid: '7', type: 'Regional Development Director (RDD)', first: 'Dir', last: 'Two' },
];

const seen = [];
function mirror(over = {}) {
  return async (sql, params = []) => {
    const mark = /-- b3:(\w+)/.exec(sql)?.[1];
    seen.push({ mark, sql, params });
    if (over[mark]) return over[mark](sql, params);
    if (mark === 'credits') return CREDITS;
    if (mark === 'constituents') return CONS;
    if (mark === 'detail') return JSON.parse(params[0]).map((id) => PEOPLE[id]).filter(Boolean);
    if (mark === 'holders') return HOLDERS.filter((h) => JSON.parse(params[0]).includes(h.cid));
    throw new Error('unexpected query ' + mark);
  };
}
const kpiWith = (status) => async () => ({ asOf: TODAY, monthlyGiving: [], monthlyGifts: [], monthlyRecurring: [], monthlyRecurringGifts: [], ytdRevenue: 0, ytdGifts: 0, status });
const KPI = { ...COUNTS, activeAfter: '2025-10-10', lapsedOnOrBefore: '2024-10-10' };
const run = (def, asked, o = {}) => engine.runReport({}, def, { user, asked, name: def.id, today: TODAY, sql: mirror(), kpi: kpiWith(KPI), edits: {}, ...o });

describe('the household rule', () => {
  it('counts spouses once and keeps a household while any member is living', () => {
    const hh = shared.buildHouseholds(CONS);
    assert.equal(hh.hid('2'), '1');
    assert.equal(hh.hid('6'), '5');
    assert.equal(hh.isLiving('1'), true);
    assert.equal(hh.isLiving('4'), false);
    assert.equal(hh.isLiving('5'), false);
    assert.equal(hh.isLiving('10'), true);
    assert.equal(hh.hid('999'), '999');
  });
  it('takes the KPI windows: a gift on the line is not active, and one on the 24 month line is lapsed', () => {
    assert.equal(shared.statusOf('2025-10-10', true, '2025-10-10', '2024-10-10'), 'lybunt');
    assert.equal(shared.statusOf('2025-10-11', true, '2025-10-10', '2024-10-10'), 'active');
    assert.equal(shared.statusOf('2024-10-10', true, '2025-10-10', '2024-10-10'), 'lapsed');
    assert.equal(shared.statusOf('2024-10-10', false, '2025-10-10', '2024-10-10'), 'gone');
  });
  it('adds a household once, with the later last gift', () => {
    const g = shared.groupGiving(CREDITS, shared.buildHouseholds(CONS));
    const h = g.get('1');
    assert.equal(h.last, '2026-09-01');
    assert.equal(h.first, '2020-01-01');
    assert.equal(h.n, 8);
    assert.equal(h.total, 800);
    assert.equal(h.big, 200);
    assert.equal(h.lastAmt, 60);
    assert.deepEqual(shared.countStatus(g, '2025-10-10', '2024-10-10'), COUNTS);
  });
  it('does month arithmetic like the KPI worker', () => {
    assert.equal(shared.addMonths('2026-03-31', -1), '2026-02-28');
    assert.equal(shared.addMonths('2026-10-10', -12), '2025-10-10');
    assert.equal(shared.addMonths('2024-02-29', 12), '2025-02-28');
  });
});

describe('active, lybunt and lapsed partners', () => {
  it('lists the same number of households as the KPI count, for all three groups', async () => {
    for (const g of ['active', 'lybunt', 'lapsed']) {
      const r = await run(status, { group: g });
      assert.equal(r.count, COUNTS[g], g);
      assert.equal(r.tie.status, 'match', g);
      assert.equal(r.tie.mine, COUNTS[g]);
      assert.equal(r.tie.kpi, COUNTS[g]);
    }
  });
  it('says Differs when the dashboard counts something else, and unavailable when it does not answer', async () => {
    const off = await run(status, { group: 'lybunt' }, { kpi: kpiWith({ ...KPI, lybunt: 5 }) });
    assert.equal(off.tie.status, 'differs');
    assert.equal(off.tie.diff, 3);
    const down = await run(status, { group: 'lybunt' }, { kpi: async () => null });
    assert.equal(down.tie.status, 'unavailable');
  });
  it('shows all three counts in tiles beside the dashboard figures', async () => {
    const r = await run(status, { group: 'active' });
    assert.deepEqual(r.tiles.map((t) => t.value), [1, 2, 3]);
    assert.match(r.tiles[1].sub, /KPI dashboard 2/);
  });
  it('names a couple once and shows who holds them and where they live', async () => {
    const r = await run(status, { group: 'active' });
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].partner, 'Ann & Ben Lake');
    assert.equal(r.rows[0].held, 'Dir One');
    assert.equal(r.rows[0].state, 'OK');
    assert.equal(r.rows[0].status, 'Active');
    assert.equal(r.rows[0].last, '2026-09-01');
    assert.deepEqual(r.totals, { total: 800, n: 8 });
  });
  it('narrows by state or held by, and then does not claim the KPI count', async () => {
    const r = await run(status, { group: 'lybunt', state: 'ok' });
    assert.deepEqual(r.rows.map((x) => x.partner), ['Test Chapel']);
    assert.equal(r.tie.status, 'none');
    const h = await run(status, { group: 'lapsed', held: 'two' });
    assert.deepEqual(h.rows.map((x) => x.partner), ['Di Pine']);
    assert.equal(h.rows[0].held, 'Dir Two');
  });
  it('takes the windows and the as-of date from the KPI figures, not from its own count', async () => {
    seen.length = 0;
    await run(status, { group: 'active' });
    assert.equal(seen.find((s) => s.mark === 'credits').params[0], TODAY);
  });
  it('lists annual givers by partner with no KPI tie', async () => {
    const r = await run(status, { group: 'annual', asof: '2026-03-31' }, { sql: mirror({ annual: async (_s, p) => [{ rid: '3' }].map((x) => ({ ...x, p })) }) });
    assert.equal(r.count, 1);
    assert.equal(r.rows[0].status, 'Annual giver');
    assert.equal(r.tie.status, 'none');
    const q = seen.filter((s) => s.mark === 'annual').pop();
    assert.deepEqual(q.params, ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31']);
  });
  it('exports to CSV with the totals row', async () => {
    const r = await run(status, { group: 'active' });
    const out = csv.toCsv(r.columns, r.rows, r.totals);
    assert.ok(out.includes('Ann & Ben Lake'));
    assert.ok(out.trimEnd().split('\r\n').pop().startsWith('Total,'));
  });
});

describe('appeal mailing list', () => {
  const row = (o = {}) => ({ id: '1', lookup: '2001', first: 'Hal', last: 'Dunn', org: null, sf: 'Ivy', sl: 'Dunn', lines: '12 Oak St\r\nUnit 4', city: 'Tulsa', state: 'OK', zip: '74101', lastDate: '2026-05-01', lastAmt: 40, ...o });
  it('builds the saved filters into one read-only query', async () => {
    seen.length = 0;
    const r = await run(mailing, { from: '2026-01-01', to: '2026-09-30', min: '$25', state: 'ok', held: 'dir', appeal: 's24a-x' }, { sql: mirror({ mailing: async () => [row()] }) });
    const q = seen.find((s) => s.mark === 'mailing');
    assert.match(q.sql, /do_not_mail/);
    assert.match(q.sql, /Donor Advised Fund/);
    assert.match(q.sql, /International Entity/);
    assert.match(q.sql, /inactive, 0\) = 0 AND COALESCE\(c\.deceased/);
    assert.deepEqual(q.params, ['2026-01-01', '2026-09-30', 25, 'OK', '%dir%', 'S24A-X']);
    assert.equal(r.count, 1);
  });
  it('shows organizations too when asked, with no code exclusion', async () => {
    seen.length = 0;
    await run(mailing, { kind: 'all' }, { sql: mirror({ mailing: async () => [] }) });
    assert.doesNotMatch(seen.find((s) => s.mark === 'mailing').sql, /Church/);
  });
  it('writes the name, address lines and last gift on each row', async () => {
    const r = await run(mailing, {}, { sql: mirror({ mailing: async () => [row(), row({ id: '2', lookup: '2002', first: null, last: null, sf: null, sl: null, org: 'Test Fund', lines: 'PO Box 9' })] }) });
    assert.equal(r.rows[0].addressee, 'Hal & Ivy Dunn');
    assert.equal(r.rows[0].salutation, 'Hal and Ivy');
    assert.equal(r.rows[0].line1, '12 Oak St');
    assert.equal(r.rows[0].line2, 'Unit 4');
    assert.equal(r.rows[0].lastAmt, 40);
    assert.equal(r.rows[1].addressee, 'Test Fund');
    assert.equal(r.rows[1].line2, '');
    assert.deepEqual(r.totals, {});
    assert.equal(r.tie.status, 'none');
    assert.equal(r.tiles[0].value, 2);
  });
  it('leaves the filter out of the query when it is blank', async () => {
    seen.length = 0;
    await run(mailing, {}, { sql: mirror({ mailing: async () => [] }) });
    assert.deepEqual(seen.find((s) => s.mark === 'mailing').params, []);
  });
});

describe('prayer list', () => {
  it('defaults to the last two years and the saved total-gifts window', async () => {
    seen.length = 0;
    const r = await run(prayer, {}, { sql: mirror({ prayer: async () => [{ id: '1', first: 'Jo', last: 'Reed', org: null }, { id: '2', first: null, last: null, org: 'Test Chapel' }] }) });
    const q = seen.find((s) => s.mark === 'prayer');
    assert.deepEqual(q.params, ['2024-10-10', TODAY, '2023-01-01', '2025-01-31']);
    assert.deepEqual(r.columns.map((c) => c.label), ['First name', 'Name']);
    assert.deepEqual(r.rows, [{ first: 'Jo', name: 'Jo Reed' }, { first: '', name: 'Test Chapel' }]);
  });
  it('takes typed dates, and drops the total-gifts rule when its dates are cleared', async () => {
    seen.length = 0;
    await run(prayer, { from: '2024-09-30', to: '2026-09-30', tfrom: '', tto: '' }, { sql: mirror({ prayer: async () => [] }) });
    const q = seen.find((s) => s.mark === 'prayer');
    assert.deepEqual(q.params, ['2024-09-30', '2026-09-30']);
    assert.doesNotMatch(q.sql, /SUM\(t\.gift_amount\)/);
  });
});

describe('portfolio export', () => {
  const prow = (o = {}) => ({
    id: '5', lookup: '3001', type: 'Individual', first: 'Kay', last: 'Hill', org: null, sf: null, sl: null,
    firstDate: '2019-01-01', firstAmt: 10, lastDate: '2026-02-01', lastAmt: 50, bigDate: '2022-02-01', bigAmt: 500, total: 900, n: 12,
    lines: '9 Elm Rd', city: 'Reno', state: 'NV', zip: '89501', email: 'kay@example.org', phones: 'Cell 555-0100', held: 'Dir One', atype: 'Regional Development Director (RDD)', ...o,
  });
  it('asks for the person, the assignment type, the state and the gift rules', async () => {
    seen.length = 0;
    await run(portfolio, { held: 'Dir One', atype: 'rdd', state: 'nv', bigmin: '1,000', gmin: '5000', gfrom: '2025-01-01', gto: '2025-12-31' }, { sql: mirror({ portfolio: async () => [prow()] }) });
    const q = seen.find((s) => s.mark === 'portfolio');
    assert.deepEqual(q.params, [TODAY, '%Dir One%', '%Regional Development Director%', 'NV', 1000, 5000, '2025-01-01', '2025-12-31']);
    assert.match(q.sql, /assignment_to_date IS NULL/);
    assert.match(q.sql, /COALESCE\(c\.deceased, 0\) = 0/);
  });
  it('includes deceased partners only when asked', async () => {
    seen.length = 0;
    await run(portfolio, { show: 'all' }, { sql: mirror({ portfolio: async () => [] }) });
    assert.doesNotMatch(seen.find((s) => s.mark === 'portfolio').sql, /deceased/);
  });
  it('writes one row per partner with the gift columns and totals', async () => {
    const r = await run(portfolio, {}, { sql: mirror({ portfolio: async () => [prow(), prow({ id: '6', lookup: '3002', first: 'Lee', total: 100.5, n: 3, lastAmt: null, lastDate: null })] }) });
    assert.equal(r.rows[0].name, 'Kay Hill');
    assert.equal(r.rows[0].line1, '9 Elm Rd');
    assert.equal(r.rows[1].lastAmt, null);
    assert.deepEqual(r.totals, { total: 1000.5, n: 15 });
    assert.equal(r.tie.status, 'none');
    assert.deepEqual(r.tiles.map((t) => t.value), [2, 1000.5]);
  });
});

describe('the registry', () => {
  it('turns the four lists from coming soon to live, for the roles that use them', () => {
    for (const id of ['status', 'portfolio', 'prayer']) assert.equal(reg.isReady(id), true, id);
    assert.equal(reg.isReady('mailing'), false);
    const mine = (...a) => new Set(a);
    assert.ok(reg.listFor(mine('rdd'), false).some((r) => r.id === 'status' && r.ready));
    assert.ok(reg.listFor(mine('rdd'), false).some((r) => r.id === 'portfolio' && r.ready));
    assert.ok(reg.listFor(mine('operations'), false).some((r) => r.id === 'prayer' && r.ready));
    assert.equal(reg.listFor(mine('marketing'), false).some((r) => r.id === 'portfolio'), false);
  });
});
