// Run with: npm test
//
// Ask pipeline (Work Center tab Asks): shapeAsks, loadAsks, asksResponse and setClose against an in-memory copy of the mirror's tables
// and the hub's act_ask_close table. Every name, id and amount is made up: the repository is public. The mirror stub refuses the same
// statement text the live endpoint refuses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { after, before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const asks = await import('../functions/_lib/work/asks.ts');
const { MIRROR_REFUSES } = await import('../functions/_lib/work/repo.ts');

const TODAY = '2026-10-10';
let mdb;
let hub;
const realFetch = globalThis.fetch;

const stmt = (db, sql, args = []) => ({
  bind: (...a) => stmt(db, sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
});

function gift(id, cid, amount, date, soft = null) {
  mdb.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, constituent_record_id, soft_credits) VALUES (?,?,?,?,?,?,?)').run(id, amount, date + 'T00:00:00', 'Donation', 'Active', cid, soft ? JSON.stringify(soft) : null);
}
function ask(id, cid, amount, date, { owners = ['501'], summary = 'A call', description = '' } = {}) {
  const raw = { id, completed: true, constituent_id: cid, fundraisers: owners };
  mdb.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_summary, action_description, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?)').run(id, date + 'T00:00:00', date + 'T00:00:00', summary, description, cid, JSON.stringify(raw));
  mdb.prepare('INSERT INTO action_tags (id, action_ask_amount) VALUES (?,?)').run(id, amount);
}

before(() => {
  mdb = new DatabaseSync(':memory:');
  mdb.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, deceased INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date DATETIME, gift_type TEXT, gift_status TEXT, constituent_record_id TEXT, soft_credits TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due DATETIME, action_completed_date DATETIME, action_summary TEXT, action_description TEXT, constituent_record_id TEXT, raw_json TEXT);
    CREATE TABLE action_tags (id TEXT PRIMARY KEY, action_ask_amount REAL);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
    INSERT INTO fundraisers VALUES ('501', 'Fay', 'Alpha'), ('502', 'Gus', 'Bravo');
    INSERT INTO constituents (id, first_name, last_name, raw_json) VALUES
      ('1', 'Ada', 'Example', '{"name":"Ada Example","address":{"city":"Holland","state":"MI"}}'),
      ('2', 'Ben', 'Sample', '{"name":"Ben Sample","address":{"city":"Tampa","state":"FL"}}'),
      ('3', 'Cy', 'Third', '{"name":"Cy Third"}');
  `);
  // Ada: two asks of 5,000 and one gift of 5,000 after the first. Ben: an ask of 3,000 and a gift of 2,000 (short). Cy: asked 1,000 and a soft credit of 1,500.
  ask('11', '1', 5000, '2026-03-01', { description: 'Clinic fridge for Gulu.\nSecond line.' });
  ask('12', '1', 5000, '2026-06-01');
  ask('13', '2', 3000, '2026-08-01', { owners: ['502'], summary: 'Lunch' });
  ask('14', '3', 1000, '2026-09-01');
  ask('15', '1', 0, '2026-09-02');
  ask('16', '9', 8000, '2026-09-03'); // partner not in the mirror (merged away)
  ask('99', '2', 7000, '2024-01-01'); // outside the window
  gift('g1', '1', 5000, '2026-04-01');
  gift('g0', '1', 5000, '2026-02-01'); // before the first ask: does not count
  gift('g2', '2', 2000, '2026-09-01');
  gift('g3', '8', 9000, '2026-09-20', [{ constituent_id: '3', amount: { value: 1500 } }]);
  hub = new DatabaseSync(':memory:');
  hub.exec(readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8'));
  hub.exec(readFileSync(new URL('../db/work-asks.sql', import.meta.url), 'utf8'));
  globalThis.fetch = async (url, init) => {
    const { sql, params } = JSON.parse(init.body);
    if (MIRROR_REFUSES.test(sql)) return new Response('refused', { status: 400 });
    return new Response(JSON.stringify(mdb.prepare(sql).all(...params)), { status: 200 });
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

const env = () => ({ DB: { prepare: (s) => stmt(hub, s) }, MIRROR_API_KEY: 'test' });
const dirScope = (fid) => ({ role: 'director', email: 'pat@example.org', name: 'Pat', fid, team: 'RDD', all: false, fids: new Set([fid]) });
const ctx = (scope, more = {}) => ({ env: env(), repo: { synced: async () => '2026-10-10T09:03:18Z' }, actor: 'Pat', email: 'pat@example.org', scope, ...more });

describe('shapeAsks', () => {
  const base = (over = {}) => ({ asks: [], gifts: [], closes: [], ...over });
  const A = (id, cid, amt, d, extra = {}) => ({ id, cid, d, amt, summary: '', description: '', frs: '["501"]', name: 'N' + cid, city: '', st: '', deceased: 0, ...extra });
  it('puts an ask with no close date, a future date and a past date in their columns', () => {
    const rows = asks.shapeAsks(base({ asks: [A('1', '1', 100, '2026-09-01'), A('2', '2', 200, '2026-09-01'), A('3', '3', 300, '2026-09-01')], closes: [{ action_id: '2', expected_close: '2026-11-01', set_by: 'Pat' }, { action_id: '3', expected_close: '2026-10-01', set_by: 'Pat' }] }), TODAY);
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.state])), { 1: 'open', 2: 'closing', 3: 'past' });
  });
  it('treats a close date of today as closing', () => {
    const [r] = asks.shapeAsks(base({ asks: [A('1', '1', 100, '2026-09-01')], closes: [{ action_id: '1', expected_close: TODAY, set_by: 'x' }] }), TODAY);
    assert.equal(r.state, 'closing');
  });
  it('settles an ask with a gift of the amount or more dated on or after it, and not with an earlier or smaller one', () => {
    const rows = asks.shapeAsks(base({ asks: [A('1', '1', 5000, '2026-03-01'), A('2', '2', 3000, '2026-08-01')], gifts: [{ id: 'g0', giver: '1', amount: 5000, gdate: '2026-02-28', soft: null }, { id: 'g2', giver: '2', amount: 2000, gdate: '2026-09-01', soft: null }] }), TODAY);
    assert.deepEqual(rows.map((r) => r.state), ['open', 'open']);
    const hit = asks.shapeAsks(base({ asks: [A('1', '1', 5000, '2026-03-01')], gifts: [{ id: 'g1', giver: '1', amount: 6000, gdate: '2026-03-01', soft: null }] }), TODAY)[0];
    assert.equal(hit.state, 'gave');
    assert.deepEqual(hit.gave, { amount: 6000, date: '2026-03-01', giftId: 'g1' });
  });
  it('lets one gift settle one ask, the oldest it covers', () => {
    const rows = asks.shapeAsks(base({ asks: [A('2', '1', 5000, '2026-06-01'), A('1', '1', 5000, '2026-03-01')], gifts: [{ id: 'g1', giver: '1', amount: 5000, gdate: '2026-07-01', soft: null }] }), TODAY);
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.state])), { 1: 'gave', 2: 'open' });
  });
  it('counts a soft credit to the partner at the credited amount', () => {
    const soft = JSON.stringify([{ constituent_id: '3', amount: { value: 1500 } }]);
    const rows = asks.shapeAsks(base({ asks: [A('1', '3', 1000, '2026-09-01'), A('2', '4', 2000, '2026-09-01')], gifts: [{ id: 'g3', giver: '8', amount: 9000, gdate: '2026-09-20', soft }] }), TODAY);
    assert.equal(rows.find((r) => r.id === '1').state, 'gave');
    assert.equal(rows.find((r) => r.id === '2').state, 'open');
  });
  it('drops an ask of zero or less and an ask with no date', () => {
    assert.equal(asks.shapeAsks(base({ asks: [A('1', '1', 0, '2026-09-01'), A('2', '1', -5, '2026-09-01'), A('3', '1', 10, '')] }), TODAY).length, 0);
  });
  it('reads the first line of the description, else the summary', () => {
    assert.equal(asks.lineOf('First.\nSecond.', 'S'), 'First.');
    assert.equal(asks.lineOf('', 'TEXTED'), 'TEXTED');
  });
  it('totals the board', () => {
    const rows = asks.shapeAsks(base({ asks: [A('1', '1', 100, '2026-09-01'), A('2', '2', 200, '2026-09-01'), A('3', '3', 300, '2026-09-01')], closes: [{ action_id: '2', expected_close: '2026-12-01', set_by: 'x' }, { action_id: '3', expected_close: '2026-10-01', set_by: 'x' }], gifts: [{ id: 'g', giver: '1', amount: 150, gdate: '2026-09-02', soft: null }] }), TODAY);
    const { stats, columns } = asks.statsOf(rows, TODAY);
    assert.deepEqual(stats.open, { n: 2, total: 500 });
    assert.deepEqual(stats.soon, { n: 1, total: 200 });
    assert.deepEqual(stats.past, { n: 1, total: 300 });
    assert.deepEqual(stats.gave, { n: 1, total: 150 });
    assert.deepEqual(columns.open, { n: 0, total: 0 });
  });
});

describe('asksResponse', () => {
  it('reads from the mirror: skips the merged partner, the zero ask and the old ask, and ties out to a direct count', async () => {
    const out = await asks.asksResponse(ctx({ ...dirScope('501'), role: 'admin', all: true }), '');
    assert.deepEqual(out.rows.map((r) => r.id).sort(), ['11', '12', '13', '14']);
    const direct = mdb.prepare(`SELECT SUM(t.action_ask_amount) AS s FROM action_tags t JOIN actions a ON a.id = t.id JOIN constituents c ON c.id = a.constituent_record_id
      WHERE t.action_ask_amount > 0 AND substr(a.action_completed_date, 1, 10) >= ?`).get('2025-10-10').s;
    assert.equal(out.total, direct);
    const byId = Object.fromEntries(out.rows.map((r) => [r.id, r]));
    assert.equal(byId['11'].state, 'gave');
    assert.equal(byId['12'].state, 'open');
    assert.equal(byId['13'].state, 'open');
    assert.equal(byId['14'].state, 'gave');
    assert.equal(byId['11'].line, 'Clinic fridge for Gulu.');
    assert.equal(byId['11'].place, 'Holland, MI');
  });
  it('shows a director only the asks on their own id, and lets a wide scope pick one director', async () => {
    const mine = await asks.asksResponse(ctx(dirScope('502')), '');
    assert.deepEqual(mine.rows.map((r) => r.id), ['13']);
    assert.equal(mine.owner, '502');
    const all = await asks.asksResponse(ctx({ ...dirScope('501'), role: 'support', fids: new Set(['501', '502']) }), '');
    assert.equal(all.everyone, 4);
    assert.deepEqual(all.owners.map((o) => o.name), ['Fay Alpha', 'Gus Bravo']);
    const pick = await asks.asksResponse(ctx({ ...dirScope('501'), role: 'support', fids: new Set(['501', '502']) }), '502');
    assert.deepEqual(pick.rows.map((r) => r.id), ['13']);
  });
  it('refuses Partner Care and grants writers', async () => {
    await assert.rejects(() => asks.asksResponse(ctx({ ...dirScope('501'), role: 'partner_care' }), ''), /directors and the Support Team/);
  });
});

describe('setClose', () => {
  it('saves a close date, moves the ask to Closing and returns the earlier date for Undo', async () => {
    const c = ctx(dirScope('501'));
    const a = await asks.setClose(c, '12', '2026-12-31');
    assert.deepEqual(a, { id: '12', close: '2026-12-31', previous: null });
    const b = await asks.setClose(c, '12', '2027-01-15');
    assert.equal(b.previous, '2026-12-31');
    const out = await asks.asksResponse(c, '');
    assert.equal(out.rows.find((r) => r.id === '12').state, 'closing');
    assert.equal(out.rows.find((r) => r.id === '12').close.date, '2027-01-15');
    const clear = await asks.setClose(c, '12', null);
    assert.equal(clear.previous, '2027-01-15');
    assert.equal((await asks.asksResponse(c, '')).rows.find((r) => r.id === '12').state, 'open');
    assert.equal(hub.prepare("SELECT COUNT(*) AS n FROM act_events WHERE kind = 'ask_close'").get().n, 3);
  });
  it('refuses a past date, a bad date, an id that is not an ask and an ask outside the portfolio', async () => {
    const c = ctx(dirScope('501'));
    await assert.rejects(() => asks.setClose(c, '12', '2026-10-09'), /today or a later day/);
    await assert.rejects(() => asks.setClose(c, '12', '2026-13-45'), /Pick a date/);
    await assert.rejects(() => asks.setClose(c, '12', 'soon'), /Pick a date/);
    await assert.rejects(() => asks.setClose(c, 'x1', '2026-12-01'), /not an ask/);
    await assert.rejects(() => asks.setClose(c, '404', '2026-12-01'), /not in the Blackbaud copy/);
    await assert.rejects(() => asks.setClose(c, '13', '2026-12-01'), /outside your portfolio/);
  });
  it('limits a role test to the test record', async () => {
    const c = ctx(dirScope('501'), { testCid: '27202' });
    await assert.rejects(() => asks.setClose(c, '12', '2026-12-01'), /only the test record/);
  });
});

describe('the quick dates', () => {
  const run = () => {
    const w = { WCTabs: { registerTab() {} }, FavorWG: null };
    const doc = { addEventListener() {}, querySelector() { return null; } };
    vm.runInNewContext(readFileSync(new URL('../public/js/work-asks.js', import.meta.url), 'utf8'), { window: w, document: doc, Date });
    return w.WCAsks;
  };
  it('finds Easter', () => {
    const { easter } = run();
    assert.equal(easter(2026), '2026-04-05');
    assert.equal(easter(2027), '2027-03-28');
  });
  it('offers 30 days, 60 days, year end and the day after Easter, rolling to next year once a date has passed', () => {
    const { shapeQuick } = run();
    assert.deepEqual(JSON.stringify(shapeQuick('2026-10-10').map((x) => x[1])), JSON.stringify(['2026-11-09', '2026-12-09', '2026-12-31', '2027-03-29']));
    assert.deepEqual(JSON.stringify(shapeQuick('2026-12-31').map((x) => x[1])), JSON.stringify(['2027-01-30', '2027-03-01', '2026-12-31', '2027-03-29']));
    assert.equal(shapeQuick('2027-01-05')[3][1], '2027-03-29');
  });
});
