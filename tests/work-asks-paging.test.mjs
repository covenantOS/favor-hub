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

describe('paged asks', () => {
  it('returns the first 50 rows by default, with the total for the filter', async () => {
    const out = await page({});
    assert.equal(out.rows.length, 50);
    assert.equal(out.matched, N);
    assert.equal(out.shown, N);
    assert.deepEqual([out.offset, out.limit, out.status, out.state], [0, 50, 'all', '']);
  });

  it('pages through every ask once, in list order: closing, then open, then gave', async () => {
    const seen = [];
    for (const offset of [0, 50, 100]) seen.push(...ids(await page({ offset, limit: 50 })));
    assert.equal(new Set(seen).size, N);
    const states = (await page({ offset: 0, limit: N })).rows.map((r) => r.state);
    assert.deepEqual([...new Set(states)], ['closing', 'open', 'gave']);
    assert.equal(states.lastIndexOf('closing') < states.indexOf('open'), true);
    assert.equal(states.lastIndexOf('open') < states.indexOf('gave'), true);
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

  it('pages inside one column, newest ask first for Asked, earliest close first for Closing', async () => {
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
    assert.deepEqual(ids(closing), [...ids(closing)].sort());
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
