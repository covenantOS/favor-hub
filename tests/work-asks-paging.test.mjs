// Run with: npm test
//
// Ask pipeline paging (Work Center tab Asks): asksResponse with status, state, search, offset and limit over 120 made-up asks.
// Every filter runs over all asks on the server, so counts and matches cover every page, not the rows one page returns.
// Names, ids and amounts are made up: the repository is public. The mirror stub refuses the same statement text the live endpoint refuses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const asks = await import('../functions/_lib/work/asks.ts');
const { MIRROR_REFUSES } = await import('../functions/_lib/work/repo.ts');

const TODAY = '2026-10-10';
const N = 120;
let mdb;
let hub;
const realFetch = globalThis.fetch;

const stmt = (db, sql, args = []) => ({
  bind: (...a) => stmt(db, sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
});
const pad = (n) => String(n).padStart(2, '0');

before(() => {
  mdb = new DatabaseSync(':memory:');
  mdb.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, deceased INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date DATETIME, gift_type TEXT, gift_status TEXT, constituent_record_id TEXT, soft_credits TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due DATETIME, action_completed_date DATETIME, action_summary TEXT, action_description TEXT, constituent_record_id TEXT, raw_json TEXT);
    CREATE TABLE action_tags (id TEXT PRIMARY KEY, action_ask_amount REAL);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_active INTEGER);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    INSERT INTO fundraisers VALUES ('501', 'Fay', 'Alpha', 1);
  `);
  const who = mdb.prepare('INSERT INTO constituents (id, first_name, last_name, raw_json) VALUES (?,?,?,?)');
  const holds = mdb.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)');
  const gift = mdb.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, constituent_record_id, soft_credits) VALUES (?,?,?,?,?,?,?)');
  const ask = mdb.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_summary, action_description, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?)');
  const tag = mdb.prepare('INSERT INTO action_tags (id, action_ask_amount) VALUES (?,?)');
  // Partner i has one ask, id 5000 + i, for 1000 * (1 + i % 4), tagged in 2026 on day 1 + i % 27 of month 1 + i % 9.
  // Every 4th partner gives 5,000 on 2026-09-30, which settles the ask (the asks are all before that day).
  // Every 5th partner without a gift has an expected close of 2026-12-01 (Closing).
  // Partners named Pine Hollow are every 17th: 0, 17, 34, 51, 68, 85, 102, 119.
  for (let i = 0; i < N; i++) {
    const cid = String(1000 + i);
    const name = i % 17 === 0 ? `Pine Hollow ${i}` : `Cedar Sample ${i}`;
    who.run(cid, 'F', 'L', JSON.stringify({ name, address: { city: 'Testville', state: 'XX' } }));
    holds.run('a' + i, cid, '501', 'Regional Development Director (RDD)', null);
    const d = `2026-${pad(1 + (i % 9))}-${pad(1 + (i % 27))}`;
    ask.run(String(5000 + i), d + 'T00:00:00', d + 'T00:00:00', 'A call', i % 3 === 0 ? 'Made-up line.' : '', cid, JSON.stringify({ id: String(5000 + i), fundraisers: ['501'] }));
    tag.run(String(5000 + i), 1000 * (1 + (i % 4)));
    if (i % 4 === 0) gift.run('g' + i, 5000, '2026-09-30T00:00:00', 'Donation', 'Active', cid, null);
  }
  hub = new DatabaseSync(':memory:');
  hub.exec(readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8'));
  hub.exec(readFileSync(new URL('../db/work-asks.sql', import.meta.url), 'utf8'));
  const close = hub.prepare('INSERT INTO act_ask_close (action_id, expected_close, set_by, set_by_email, set_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < N; i++) if (i % 5 === 0 && i % 4 !== 0) close.run(String(5000 + i), '2026-12-01', 'Fay', 'fay@example.org', '2026-10-01T00:00:00Z');
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
const scope = { role: 'admin', email: 'pat@example.org', name: 'Pat', fid: '501', team: 'RDD', all: true, fids: new Set(['501']) };
const ctx = () => ({ env: env(), repo: { synced: async () => '2026-10-10T09:03:18Z' }, actor: 'Pat', email: 'pat@example.org', scope });
const page = (query, range = '12m') => asks.asksResponse(ctx(), '', range, query);
const ids = (out) => out.rows.map((r) => r.id);

describe('the asks route', () => {
  it('hands sort and dir to the query along with the filters and the page', () => {
    const src = readFileSync(new URL('../functions/api/work/asks.ts', import.meta.url), 'utf8');
    for (const k of ['status', 'state', 'q', 'sort', 'dir', 'offset', 'limit']) assert.equal(src.includes('    ' + k + ': ') && src.includes("p.get('" + k + "')"), true, k + ' is read from the URL');
  });
});

describe('paged asks', () => {
  it('returns the first 50 rows by default, with the total for the filter', async () => {
    const out = await page({});
    assert.equal(out.rows.length, 50);
    assert.equal(out.matched, N);
    assert.equal(out.shown, N);
    assert.deepEqual([out.offset, out.limit, out.status, out.state], [0, 50, 'all', '']);
  });

  it('pages through every ask once, newest ask first by default', async () => {
    const seen = [];
    const dates = [];
    for (const offset of [0, 50, 100]) {
      const out = await page({ offset, limit: 50 });
      seen.push(...ids(out));
      dates.push(...out.rows.map((r) => r.first));
    }
    assert.equal(new Set(seen).size, N);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.deepEqual([(await page({})).sort, (await page({})).dir], ['asked', 'desc']);
    const states = (await page({ offset: 0, limit: N })).rows.map((r) => r.state);
    assert.equal(states.filter((s) => s === 'closing').length, 18);
    assert.equal(states.filter((s) => s === 'open').length, 72);
    assert.equal(states.filter((s) => s === 'gave').length, 30);
  });

  it('counts the open filter across every page: open and closing, not gave', async () => {
    const out = await page({ status: 'open', limit: 10 });
    assert.equal(out.rows.length, 10);
    assert.equal(out.shown, 90);
    assert.deepEqual(Object.fromEntries(Object.entries(out.counts).map(([k, v]) => [k, v.n])), { open: 72, closing: 18, past: 0, gave: 0 });
    assert.equal(out.rows.some((r) => r.state === 'gave'), false);
    const gave = await page({ status: 'gave', limit: 10 });
    assert.equal(gave.matched, 30);
    assert.equal(gave.counts.gave.total, 30 * 5000);
    assert.equal(gave.counts.gave.n, 30);
  });

  it('pages inside one stage, newest ask first', async () => {
    const first = await page({ status: 'open', state: 'open', offset: 0, limit: 50 });
    const second = await page({ status: 'open', state: 'open', offset: 50, limit: 50 });
    assert.equal(first.matched, 72);
    assert.equal(second.rows.length, 22);
    const dates = [...first.rows, ...second.rows].map((r) => r.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(new Set([...ids(first), ...ids(second)]).size, 72);
    const closing = await page({ state: 'closing', offset: 10, limit: 10 });
    assert.equal(closing.matched, 18);
    assert.equal(closing.rows.length, 8);
    const all = await page({ state: 'closing', limit: 50 });
    assert.equal(all.rows.every((r) => r.state === 'closing'), true);
    assert.deepEqual(ids(closing), ids(all).slice(10));
  });

  it('sorts over every ask before it cuts a page: amount, partner, stage, close and director', async () => {
    const amounts = [];
    for (const offset of [0, 50, 100]) amounts.push(...(await page({ sort: 'amount', dir: 'desc', offset, limit: 50 })).rows.map((r) => r.amount));
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
    assert.equal(amounts[0], 4000);
    assert.equal(amounts[N - 1], 1000);
    const up = await page({ sort: 'amount', dir: 'asc', limit: 5 });
    assert.deepEqual(up.rows.map((r) => r.amount), [1000, 1000, 1000, 1000, 1000]);
    assert.deepEqual([up.sort, up.dir], ['amount', 'asc']);
    const names = [];
    for (const offset of [0, 60]) names.push(...(await page({ sort: 'partner', offset, limit: 60 })).rows.map((r) => r.name.toLowerCase()));
    assert.deepEqual(names, [...names].sort());
    const stages = (await page({ sort: 'stage', limit: N })).rows.map((r) => r.state);
    assert.deepEqual([...new Set(stages)], ['closing', 'open', 'gave']);
    const flip = (await page({ sort: 'stage', dir: 'desc', limit: N })).rows.map((r) => r.state);
    assert.deepEqual([...new Set(flip)], ['gave', 'open', 'closing']);
    for (const dir of ['asc', 'desc']) {
      const close = (await page({ sort: 'close', dir, limit: N })).rows;
      const dated = close.filter((r) => r.close).length;
      assert.equal(dated, 18);
      assert.equal(close.slice(0, dated).every((r) => r.close), true);
      assert.equal(close.slice(dated).every((r) => !r.close), true);
    }
    const who = await page({ sort: 'director', limit: 3 });
    assert.deepEqual(who.rows.map((r) => r.ownerNames), [['Fay Alpha'], ['Fay Alpha'], ['Fay Alpha']]);
  });

  it('sorts inside a search and a stage, and falls back to the default for a bad sort or direction', async () => {
    const out = await page({ q: 'pine', state: 'open', sort: 'amount', dir: 'asc', limit: 50 });
    assert.equal(out.matched, 5);
    assert.deepEqual(out.rows.map((r) => r.amount), out.rows.map((r) => r.amount).sort((a, b) => a - b));
    const bad = await page({ sort: 'nope', dir: 'sideways' });
    assert.deepEqual([bad.sort, bad.dir], ['asked', 'desc']);
    assert.deepEqual([(await page({ sort: 'partner' })).dir, (await page({ sort: 'amount' })).dir], ['asc', 'desc']);
  });

  it('names who tagged each ask and keeps the full text only when the line leaves some out', async () => {
    const out = await page({ sort: 'partner', q: 'Pine Hollow 0', limit: 5 });
    const row = out.rows.find((r) => r.name === 'Pine Hollow 0');
    assert.deepEqual(row.taggedNames, ['Fay Alpha']);
    assert.equal(asks.textOf('Made-up line.', 'A call'), 'A call' + String.fromCharCode(10) + 'Made-up line.');
    assert.equal(asks.textOf('', 'A call'), '');
    assert.equal(asks.textOf('A call', 'A call'), '');
  });

  it('runs search over every page: the match count and the rows cover all asks, not the loaded page', async () => {
    const all = await page({ q: 'PINE hollow', limit: 3 });
    assert.equal(all.matched, 8);
    assert.equal(all.shown, 8);
    assert.equal(all.rows.length, 3);
    const rest = await page({ q: 'pine hollow', offset: 3, limit: 50 });
    assert.equal(rest.rows.length, 5);
    assert.deepEqual([...ids(all), ...ids(rest)].length, 8);
    assert.equal(rest.rows.every((r) => r.name.startsWith('Pine Hollow')), true);
  });

  it('keeps the search inside the filter: counts and matches for a search with a status', async () => {
    const out = await page({ status: 'all', q: 'pine' });
    assert.deepEqual(Object.fromEntries(Object.entries(out.counts).map(([k, v]) => [k, v.n])), { open: 5, closing: 1, past: 0, gave: 2 });
    const gave = await page({ status: 'gave', q: 'pine' });
    assert.equal(gave.matched, 2);
    assert.equal(gave.shown, 2);
    assert.deepEqual(gave.rows.map((r) => r.state), ['gave', 'gave']);
  });

  it('falls back to the defaults for a bad status, state, offset or limit, and caps the limit', async () => {
    const out = await page({ status: 'nope', state: 'nope', offset: -4, limit: 'abc' });
    assert.deepEqual([out.status, out.state, out.offset, out.limit], ['all', '', 0, 50]);
    assert.equal((await page({ limit: 0 })).limit, 1);
    assert.equal((await page({ limit: 999999 })).limit, asks.MAX_PAGE);
    assert.equal((await page({ offset: 500 })).rows.length, 0);
  });

  it('answers the director picker and the tagged range the same way on every page', async () => {
    const all = await asks.asksResponse(ctx(), '', 'all', { limit: 50 });
    assert.equal(all.range, 'all');
    assert.equal(all.matched, N);
    const none = await asks.asksResponse(ctx(), '999', '12m', { limit: 50 });
    assert.equal(none.owner, '');
  });
});
