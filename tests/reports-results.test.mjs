// Run with: npm test
//
// The results group of the Reports area: Foundations, Annual tax receipt lists, Contact data lists and Results by
// appeal. Each report runs through the engine with a stand-in mirror and a stand-in KPI dashboard. Made-up figures
// only: the repository is public and no test touches a live database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const engine = await import('../functions/_lib/reports/engine.ts');
const reg = await import('../functions/_lib/reports/registry.ts');
const tax = (await import('../functions/_lib/reports/defs/tax.ts')).default;
const contact = (await import('../functions/_lib/reports/defs/contact.ts')).default;
const foundations = (await import('../functions/_lib/reports/defs/foundations.ts')).default;
const appeals = (await import('../functions/_lib/reports/defs/appeal-results.ts')).default;

const user = { email: 'a@example.org', name: 'A' };
const year = new Date().getFullYear();
const today = `${year}-10-10`;

/** A KPI dashboard stand-in that answers the Marketing and Grants routes, as the hub reads them. */
function envWith(routes) {
  return {
    KPI_JWT_SECRET: 'test-secret',
    KPI: {
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        return routes[path] ? new Response(JSON.stringify(routes[path]), { status: 200 }) : new Response('{}', { status: 404 });
      },
    },
  };
}
const run = (env, def, asked, o = {}) => engine.runReport(env, def, { user, asked, name: def.id, today, edits: {}, ...o });
const kpi = (giving) => async () => ({ asOf: today, monthlyGiving: giving, monthlyGifts: [], monthlyRecurring: [], monthlyRecurringGifts: [], ytdRevenue: giving.reduce((s, v) => s + (v || 0), 0), ytdGifts: 0, status: null });

describe('registry', () => {
  it('turns the four results reports live and keeps their audiences', () => {
    for (const id of ['foundations', 'appeal-results']) {
      assert.ok(reg.isReady(id), `${id} is live`);
      assert.equal(reg.entryOf(id).group, 'results');
    }
    assert.deepEqual(reg.entryOf('appeal-results').audience, ['marketing']);
    assert.deepEqual([...reg.entryOf('tax').audience].sort(), ['admin_desk', 'operations']);
    for (const id of ['tax', 'contact']) assert.equal(reg.isReady(id), false, id + ' is held until solicit codes are in the mirror');
  });
});

describe('annual tax receipt lists', () => {
  const people = [
    { cid: '1', lookup: '101', org: null, first: 'Ann', last: 'Lee', spouse_first: 'Bo', spouse_last: 'Lee', total: 1000, excluded: 0, line: '1 Main St', city: 'Town', state: 'FL', zip: '32000', country: 'United States', dnm: 0, email: 'a@example.org' },
    { cid: '2', lookup: '102', org: null, first: 'Cy', last: 'Day', total: 300, excluded: 0, line: '', city: '', state: '', zip: '', country: null, dnm: 0, email: 'c@example.org' },
    { cid: '3', lookup: '103', org: null, first: 'Di', last: 'Poe', total: 400, excluded: 0, line: '', city: '', state: '', zip: '', country: null, dnm: 0, email: null },
    { cid: '4', lookup: '104', org: 'Grace Church', total: 5000, excluded: 1, line: '2 Oak', city: 'Town', state: 'FL', zip: '32000', country: 'United States', dnm: 0, email: null },
    { cid: '5', lookup: '105', org: null, first: 'Ed', last: 'Fox', total: 100, excluded: 0, line: '3 Elm', city: 'Town', state: 'FL', zip: '32000', country: 'United States', dnm: 0, email: null },
    { cid: '6', lookup: '106', org: null, first: 'Flo', last: 'Gray', total: 600, excluded: 0, line: '4 Pine', city: 'Paris', state: '', zip: '75000', country: 'France', dnm: 0, email: null },
    { cid: '7', lookup: '107', org: null, first: 'Gus', last: 'Hill', total: 250, excluded: 0, line: '5 Ash', city: 'Town', state: 'FL', zip: '32000', country: 'United States', dnm: 1, email: null },
  ];
  const sql = async (text) => (/constituent_record_id IS NULL/.test(text) ? [{ total: 50 }] : people);
  const total = people.reduce((s, p) => s + p.total, 0) + 50;
  it('splits partners into mail, email, other and no receipt by the saved rules', async () => {
    const all = await run({}, tax, { list: 'all', year: String(year) }, { sql, kpi: kpi([total]) });
    const by = Object.fromEntries(all.rows.map((r) => [r.lookup, r.list]));
    assert.deepEqual(by, { 101: 'Mail', 102: 'Email', 103: 'Other', 104: 'No receipt', 105: 'No receipt', 106: 'No receipt', 107: 'Mail' });
    assert.equal(all.rows.find((r) => r.lookup === '101').addressee, 'Ann and Bo Lee');
    assert.equal(all.rows.find((r) => r.lookup === '104').why, 'Church, foundation or DAF');
    assert.equal(all.rows.find((r) => r.lookup === '105').why, 'Under $250');
    assert.equal(all.rows.find((r) => r.lookup === '106').why, 'Address outside the United States');
    assert.equal(all.rows.find((r) => r.lookup === '107').mail, 'Do not mail');
  });
  it('shows one list, and every list plus no receipt equals the KPI year to date', async () => {
    const mail = await run({}, tax, { list: 'mail', year: String(year) }, { sql, kpi: kpi([total]) });
    assert.equal(mail.rows.length, 2);
    assert.equal(mail.totals.total, 1250);
    assert.equal(mail.tie.status, 'match');
    assert.equal(mail.tie.mine, total);
    assert.equal(mail.tiles[0].value, 2);
  });
  it('compares a through-month cut with the KPI months up to it, and says so for another year', async () => {
    const cut = await run({}, tax, { list: 'all', year: String(year), through: `${year}-02` }, { sql, kpi: kpi([total - 10, 10, 999]) });
    assert.equal(cut.tie.status, 'match');
    assert.equal(cut.tie.mine, total);
    const old = await run({}, tax, { list: 'mail', year: String(year - 1) }, { sql, kpi: kpi([1]) });
    assert.equal(old.tie.status, 'none');
  });
  it('shows Differs when the lists do not add up to the KPI figure', async () => {
    const r = await run({}, tax, { list: 'all', year: String(year) }, { sql, kpi: kpi([total + 5]) });
    assert.equal(r.tie.status, 'differs');
  });
});

describe('the year filters', () => {
  it('never read the clock at load: the default is decided at run time (a Worker reads 1970 until a request arrives)', async () => {
    const seen = {};
    const grab = (name) => async (text, params) => ((seen[name] ||= params), []);
    await run({}, tax, {}, { sql: grab('tax'), kpi: kpi([]) });
    await run({}, appeals, {}, { sql: grab('appeals') });
    await run({}, foundations, {}, { sql: grab('foundations') });
    assert.ok(seen.tax.includes(`${year - 1}-01-01`), 'tax defaults to last year');
    assert.ok(seen.appeals.includes(`${year}-01-01`), 'appeals default to this year');
    assert.ok(seen.foundations.includes(`${year}-01-01`), 'foundations default to this year');
    for (const d of [tax, appeals, foundations]) assert.equal(d.filters.find((f) => f.id === 'year').def, '');
  });
});

describe('contact data lists', () => {
  it('lists partners with an email, flags inactive and deceased, and has no KPI line', async () => {
    const raw = [
      { cid: '1', lookup: '11', org: null, first: 'Ann', last: 'Lee', added: '2026-01-02', inactive: 0, deceased: 0, email: 'a@example.org', city: 'Town', state: 'FL' },
      { cid: '2', lookup: '12', org: 'Grace Ministry', first: null, last: null, added: '2026-02-03', inactive: 1, deceased: 0, email: 'g@example.org', city: null, state: null },
    ];
    const r = await run({}, contact, { list: 'active-email' }, { sql: async () => raw });
    assert.equal(r.count, 2);
    assert.deepEqual(r.rows.map((x) => x.status), ['Active', 'Inactive']);
    assert.equal(r.rows[1].name, 'Grace Ministry');
    assert.equal(r.tie.status, 'none');
    assert.equal(r.tiles[1].value, 1);
  });
  it('asks for this month when no month is chosen on the newly added list', async () => {
    let seen;
    await run({}, contact, { list: 'new' }, { sql: async (_t, p) => ((seen = p), []) });
    assert.deepEqual(seen, [today.slice(0, 7)]);
  });
});

describe('results by appeal', () => {
  const rows = [
    { code: 'L1-AD', description: 'Direct Mail, Letter', category: 'Direct Mail Appeal', gifts: 10, partners: 9, raised: 1000.5, first: `${year}-01-05`, last: `${year}-03-01` },
    { code: 'N1-EMW', description: 'Digital Newsletter, Send', category: 'Digital Newsletter', gifts: 5, partners: 5, raised: 250, first: `${year}-02-05`, last: `${year}-02-20` },
  ];
  const env = envWith({
    '/api/cf/marketing/report': { byCategory: { 'Direct Mail Appeal': { giving: [1000.5] }, 'Digital Newsletter': { giving: [0, 250] }, 'Other marketing': { giving: [0] } } },
  });
  it('gives each appeal its gifts, partners, dollars and response, with mailed as a typed-in cell', async () => {
    const r = await run(env, appeals, { year: String(year) }, { sql: async () => rows, edits: { 'L1-AD|mailed': '5000' } });
    assert.equal(r.rows[0].mailed, 5000);
    assert.equal(r.rows[0].rate, 10 / 5000);
    assert.equal(r.rows[1].mailed, null);
    assert.equal(r.rows[1].rate, null);
    assert.deepEqual(r.editable, ['mailed']);
    assert.equal(r.rows[0].__key, 'L1-AD');
    assert.equal(r.rows[0].avg, 100.05);
    assert.deepEqual(r.totals, { gifts: 15, raised: 1250.5 });
    assert.equal(r.tiles.find((t) => t.label === 'Mailed (typed in)').value, 5000);
  });
  it('matches the Marketing tab by category and shows Differs when it moves', async () => {
    const ok = await run(env, appeals, { year: String(year) }, { sql: async () => rows });
    assert.equal(ok.tie.status, 'match');
    const bad = await run(envWith({ '/api/cf/marketing/report': { byCategory: { 'Direct Mail Appeal': { giving: [1] } } } }), appeals, { year: String(year) }, { sql: async () => rows });
    assert.equal(bad.tie.status, 'differs');
    const one = await run(env, appeals, { year: String(year), category: 'Digital Newsletter' }, { sql: async () => [rows[1]] });
    assert.equal(one.tie.status, 'match');
  });
  it('has no KPI line for a cut-off date and says the dashboard is unavailable when it does not answer', async () => {
    const cut = await run(env, appeals, { year: String(year), through: `${year}-02-01` }, { sql: async () => rows });
    assert.equal(cut.tie.status, 'none');
    const down = await run(envWith({}), appeals, { year: String(year) }, { sql: async () => rows });
    assert.equal(down.tie.status, 'unavailable');
  });
});

describe('foundations', () => {
  const funder = { cid: 'f1', lookup: '501', org: 'Hope Foundation', first: null, last: null, added: '2025-01-03', gifts: 2, total: 3000, lifetime: 9000, first_gift: '2020-01-01', last_gift: `${year}-05-01`, largest: 2000 };
  const sql = async (text) => {
    if (/WITH funders/.test(text)) return [{ funder: 'f1', id: '1', gift_date: `${year}-02-01`, amount: 1000 }, { funder: 'f1', id: '2', gift_date: `${year}-05-01`, amount: 2500 }];
    if (/FROM opportunities WHERE/.test(text)) return [{ funder: 'f1', awarded: 4000, award_date: `${year}-01-10` }];
    return [funder];
  };
  it('counts received up to the award, in gift order', async () => {
    const env = envWith({ '/api/cf/grants': { awards: { received: 3500 } } });
    const r = await run(env, foundations, { year: String(year) }, { sql });
    assert.equal(r.rows[0].awarded, 4000);
    assert.equal(r.rows[0].received, 3500);
    assert.equal(r.totals.received, 3500);
    assert.equal(r.tie.status, 'match');
  });
  it('caps what counts as received at what was awarded', async () => {
    const small = async (text) => (/WITH funders/.test(text) ? [{ funder: 'f1', id: '1', gift_date: `${year}-02-01`, amount: 6000 }] : sql(text));
    const r = await run(envWith({ '/api/cf/grants': { awards: { received: 4000 } } }), foundations, { year: String(year) }, { sql: small });
    assert.equal(r.rows[0].received, 4000);
    assert.equal(r.tie.status, 'match');
  });
  it('shows Differs against the Grants tab, compares last year on awards, and has no line for all years', async () => {
    const d = await run(envWith({ '/api/cf/grants': { awards: { received: 1 } } }), foundations, { year: String(year) }, { sql });
    assert.equal(d.tie.status, 'differs');
    const last = await run(envWith({ '/api/cf/grants': { totals: { lastYear: { portfolio: { giving: [4000, null] } } } } }), foundations, { year: String(year - 1) }, { sql });
    assert.equal(last.tie.status, 'match');
    const all = await run({}, foundations, { year: 'all' }, { sql });
    assert.equal(all.tie.status, 'none');
  });
});
