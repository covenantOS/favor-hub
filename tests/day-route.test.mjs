// Run with: npm test
//
// Calls the real GET /api/hub/day handler (functions/api/hub/day.ts). The mirror endpoint is a
// stand-in that runs the posted SQL on an in-memory copy of the mirror tables (node:sqlite), and the
// clock is fixed at 10:30 PM Eastern on October 9, when the UTC date is already October 10. That
// checks the order of the query parameters, the Eastern date, the shape the Today card reads, and
// what happens when the mirror fails.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it, mock } from 'node:test';
import './support/resolve-ts.mjs';

const MIRROR_URL = 'https://mirror.test/d1/query';
const KEY = 'test-mirror-key';
let db;
let onRequestGet;
let mirrorDown = false;
const posted = [];

function add(id, { due, fr, completed = false, computed = 'Open', completedDate = null, cid = '1' }) {
  const raw = { id, completed, computed_status: computed, constituent_id: cid, date: `${due}T00:00:00`, fundraisers: [fr], status: completed ? 'Completed' : 'Open', summary: `task ${id}`, type: 'RDD Action' };
  if (completedDate) raw.completed_date = `${completedDate}T00:00:00`;
  db.prepare('INSERT INTO actions (id, action_date_due, action_type, action_category, action_summary, action_completed_date, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?,?)').run(
    id, `${due}T00:00:00`, 'RDD Action', 'Task/Other', `task ${id}`, completedDate ? `${completedDate}T00:00:00` : null, cid, JSON.stringify(raw)
  );
}

// The hub's own D1, used here only to look up a Google connection. Nobody in these tests has one.
const hubDb = { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}) }) }) };
const env = { MIRROR_API_KEY: KEY, MIRROR_QUERY_URL: MIRROR_URL, DB: hubDb };

async function day(headers) {
  const res = await onRequestGet({ request: new Request('https://hub.test/api/hub/day', { headers }), env });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due DATETIME, action_type TEXT, action_category TEXT, action_summary TEXT,
      action_completed_date DATETIME, constituent_record_id TEXT, raw_json TEXT);
    CREATE INDEX idx_actions_action_completed_date ON actions(action_completed_date);
    CREATE TABLE constituents (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, raw_json TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_email TEXT);
    INSERT INTO constituents VALUES ('1', 'Ada', 'Partner', '{"name":"Ada Partner"}');
    INSERT INTO fundraisers VALUES ('5001', 'fay@example.org'), ('6001', 'will@favorintl.org');
  `);
  add('a1', { due: '2026-09-01', fr: '5001', computed: 'PastDue' }); // overdue
  add('a2', { due: '2026-10-09', fr: '5001' }); // due today in Eastern time, so not overdue
  add('a3', { due: '2026-10-16', fr: '5001' }); // the seventh day, still in the window
  add('a4', { due: '2026-10-17', fr: '5001' }); // the eighth day, past the window
  add('a5', { due: '2026-08-01', fr: '5001', completed: true, computed: 'Completed' }); // closed in bulk, no completed date
  add('a6', { due: '2026-09-02', fr: '5001', computed: 'PastDue', cid: '999' }); // its partner record is gone from the mirror
  add('a7', { due: '2026-09-03', fr: '5001', completed: true, computed: 'Completed', completedDate: '2026-09-04' });
  add('b1', { due: '2026-10-01', fr: '6001', computed: 'PastDue' });

  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url) !== MIRROR_URL) throw new Error(`unexpected fetch ${url}`);
    const { sql, params } = JSON.parse(init.body);
    posted.push({ auth: init.headers?.Authorization, sql, params });
    if (mirrorDown) return new Response('{"error":"down"}', { status: 500 });
    return Response.json(db.prepare(sql).all(...params));
  });
  // 2026-10-10 02:30 UTC is 2026-10-09 10:30 PM in New York.
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T02:30:00Z') });
  ({ onRequestGet } = await import('../functions/api/hub/day.ts'));
});

after(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe('GET /api/hub/day', () => {
  it('lists the signed-in person\'s open actions through day seven, on the Eastern date', async () => {
    const { status, body } = await day({ 'X-Hub-Email': 'Fay@Example.org', 'X-Hub-Via': 'google' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.blackbaud.linked, true);
    assert.deepEqual(body.blackbaud.actions.map((a) => a.id), ['a1', 'a2', 'a3']);
    assert.equal(body.blackbaud.total, 3);
    assert.equal(body.blackbaud.overdue, 1); // a2 is due today in New York; the UTC date would have made it overdue
    assert.deepEqual(body.google, { connected: false });
  });

  it('sends today\'s Eastern date first and the fundraiser id second, with the mirror key', async () => {
    posted.length = 0;
    await day({ 'X-Hub-Email': 'fay@example.org', 'X-Hub-Via': 'google' });
    assert.deepEqual(posted.map((p) => p.params), [['fay@example.org'], ['2026-10-09', '5001']]);
    assert.ok(posted.every((p) => p.auth === `Bearer ${KEY}`));
  });

  it('gives the card each row without the count columns', async () => {
    const { body } = await day({ 'X-Hub-Email': 'fay@example.org', 'X-Hub-Via': 'google' });
    assert.deepEqual(Object.keys(body.blackbaud).sort(), ['actions', 'linked', 'overdue', 'total']);
    assert.deepEqual(Object.keys(body.blackbaud.actions[0]).sort(), ['category', 'cid', 'due', 'id', 'partner', 'summary', 'type']);
    assert.equal(body.blackbaud.actions[0].partner, 'Ada Partner');
  });

  it('reads Will\'s list for the agent key', async () => {
    const { body } = await day({ 'X-Hub-Email': 'agent@favorintl.org', 'X-Hub-Via': 'agent' });
    assert.deepEqual(body.blackbaud.actions.map((a) => a.id), ['b1']);
    assert.equal(body.blackbaud.overdue, 1);
  });

  it('says not linked when no fundraiser has the address', async () => {
    const { body } = await day({ 'X-Hub-Email': 'nobody@example.org', 'X-Hub-Via': 'google' });
    assert.deepEqual(body.blackbaud, { linked: false, actions: [], total: 0, overdue: 0 });
  });

  it('keeps the page up and says not linked when the mirror fails', async () => {
    mirrorDown = true;
    try {
      const { status, body } = await day({ 'X-Hub-Email': 'fay@example.org', 'X-Hub-Via': 'google' });
      assert.equal(status, 200);
      assert.equal(body.blackbaud.linked, false);
      assert.equal(body.blackbaud.total, 0);
      assert.equal(body.blackbaud.error, 'mirror 500');
    } finally {
      mirrorDown = false;
    }
  });

  it('asks for sign-in without a hub user', async () => {
    const { status, body } = await day({});
    assert.equal(status, 401);
    assert.equal(body.error, 'signin');
  });
});
