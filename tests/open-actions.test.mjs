// Run with: npm test   (Node 22.18 or newer; uses the built-in test runner and node:sqlite, nothing to install)
//
// Builds the mirror's actions, constituents and fundraisers tables in memory with the real column
// layout, the real indexes and the real shapes of raw_json, then runs the exact code that
// /api/hub/day runs against the mirror: yourDayBlackbaud with a query function that executes the SQL.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import { openActionSql, shapeYourDay, yourDayActionsSql, yourDayBlackbaud } from '../functions/_lib/hub/actions.ts';

// The card's Eastern date is passed in. A fixed date shows the query never reads the database clock.
const TODAY = '2026-10-09';
const FR_A = '5001';
const FR_B = '5002';
const day = (offset, from = TODAY) => {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

let db;

function add(id, { due, completed, computed, status, completedDate = null, fundraisers = [FR_A], type = 'RDD Action', cid = '1', summary = `task ${id}` }) {
  const raw = { id, category: 'Task/Other', completed, computed_status: computed, constituent_id: cid, date: `${due}T00:00:00`, fundraisers, status, summary, type };
  if (completedDate) raw.completed_date = `${completedDate}T00:00:00`;
  db.prepare('INSERT INTO actions (id, action_date_due, action_type, action_category, action_summary, action_completed_date, constituent_record_id, action_fundraiser_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, `${due}T00:00:00`, type, 'Task/Other', summary, completedDate ? `${completedDate}T00:00:00` : null, cid, JSON.stringify(fundraisers), JSON.stringify(raw)
  );
}

// The same contract as the mirror endpoint: SQL and positional parameters in, rows out.
const query = async (sql, params = []) => db.prepare(sql).all(...params);
const ids = (rows) => rows.map((r) => r.id);
const dayRows = (fundraiser, today = TODAY) => db.prepare(yourDayActionsSql(60)).all(today, fundraiser);

before(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE actions (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME DEFAULT null, date_modified DATETIME DEFAULT null, action_date_due DATETIME DEFAULT null,
      action_category TEXT, action_type TEXT, action_priority_level TEXT, action_completed_date DATETIME DEFAULT null, action_direction TEXT, action_summary TEXT,
      action_description TEXT, constituent_record_id TEXT, action_fundraiser_id TEXT, raw_json TEXT, synced_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX idx_actions_action_type ON actions(action_type);
    CREATE INDEX idx_actions_action_completed_date ON actions(action_completed_date);
    CREATE INDEX idx_actions_action_category ON actions(action_category);
    CREATE INDEX idx_actions_constituent ON actions(constituent_record_id);
    CREATE TABLE constituents (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, raw_json TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY UNIQUE, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_email TEXT DEFAULT null);
    INSERT INTO constituents (id, first_name, last_name, raw_json) VALUES ('1', 'Ada', 'Partner', '{"name":"Ada Partner"}');
    INSERT INTO fundraisers (id, fundraiser_first_name, fundraiser_last_name, fundraiser_email) VALUES ('${FR_A}', 'Fay', 'Alpha', 'fay@example.org'), ('${FR_B}', 'Gus', 'Bravo', 'Gus@Example.org');
  `);

  // Open, in the window.
  add('100', { due: day(-400), completed: false, computed: 'PastDue', status: 'Past due' }); // oldest, past due
  add('101', { due: day(-3), completed: false, computed: 'PastDue', status: 'Past due', fundraisers: [FR_A, FR_B] });
  add('102', { due: day(0), completed: false, computed: 'Open', status: 'Open' }); // due today, not overdue
  add('103', { due: day(5), completed: false, computed: 'Open', status: 'Open' });
  add('105', { due: day(7), completed: false, computed: 'Open', status: 'Open' }); // the last day of the window still shows
  // Open but after the window.
  add('104', { due: day(8), completed: false, computed: 'Open', status: 'Open' });
  // The defect: closed in bulk by a Database View import, no completed date in the record.
  add('200', { due: day(-120), completed: true, computed: 'Completed', status: 'Completed', type: 'RESERVED (Review New Constituent Record)' });
  add('201', { due: day(-119), completed: true, computed: 'Completed', status: 'Completed', type: 'RESERVED (Review New Constituent Record)', fundraisers: [FR_A, FR_B] });
  // Completed the normal way, with a date.
  add('300', { due: day(-10), completed: true, computed: 'Completed', status: 'Completed', completedDate: day(-9) });
  // Completed with a date while the old status field still says Open (18 such rows in the mirror on 2026-10-09).
  add('301', { due: day(-40), completed: true, computed: 'Completed', status: 'Open', completedDate: day(-39) });
  // Canceled never counts as open.
  add('302', { due: day(-2), completed: false, computed: 'Canceled', status: 'Canceled' });
  // Someone else's.
  add('400', { due: day(-2), completed: false, computed: 'PastDue', status: 'Past due', fundraisers: ['99999'] });
  // Open on paper, but its constituent was deleted or merged away and the mirror dropped the record (9 such rows on 2026-10-09).
  add('600', { due: day(-60), completed: false, computed: 'PastDue', status: 'Past due', cid: '36580', type: 'RESERVED (Review New Constituent Record)' });
  // A record without the completed flag at all is treated as open, which is what the date column alone said before.
  db.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, constituent_record_id, raw_json) VALUES (?,?,?,?,?)').run('500', `${day(-1)}T00:00:00`, null, '1', JSON.stringify({ id: '500', fundraisers: [FR_A] }));
});

describe('open action definition', () => {
  it('leaves out an action closed in bulk that has no completed date', () => {
    const open = db.prepare(`SELECT a.id FROM actions a WHERE ${openActionSql('a')} ORDER BY a.id`).all();
    assert.ok(!ids(open).includes('200'));
    assert.ok(!ids(open).includes('201'));
  });

  it('leaves out completed, completed-with-stale-status and canceled actions', () => {
    const open = ids(db.prepare(`SELECT a.id FROM actions a WHERE ${openActionSql('a')}`).all());
    for (const id of ['300', '301', '302']) assert.ok(!open.includes(id), `${id} must not be open`);
  });

  it('keeps every action that is still open', () => {
    const open = ids(db.prepare(`SELECT a.id FROM actions a WHERE ${openActionSql('a')} ORDER BY a.id`).all());
    assert.deepEqual(open, ['100', '101', '102', '103', '104', '105', '400', '500', '600']);
  });

  it('matches what the old date-only rule would have wrongly counted', () => {
    const dateOnly = db.prepare('SELECT COUNT(*) AS n FROM actions WHERE action_completed_date IS NULL').get().n;
    const shared = db.prepare(`SELECT COUNT(*) AS n FROM actions a WHERE ${openActionSql('a')}`).get().n;
    assert.equal(dateOnly - shared, 3); // 200, 201 and the canceled 302
  });
});

describe('Your day', () => {
  it("lists one person's open actions in the window, oldest first", async () => {
    const r = await yourDayBlackbaud(query, 'fay@example.org', TODAY);
    assert.deepEqual(ids(r.actions), ['100', '101', '500', '102', '103', '105']);
  });

  it('returns the shape the card reads, with the true counts', async () => {
    const r = await yourDayBlackbaud(query, 'fay@example.org', TODAY);
    assert.deepEqual(Object.keys(r).sort(), ['actions', 'linked', 'overdue', 'total']);
    assert.equal(r.linked, true);
    assert.equal(r.total, 6);
    assert.equal(r.overdue, 3); // 100, 101 and 500 are before today; 102 is due today
    assert.deepEqual(Object.keys(r.actions[0]).sort(), ['category', 'cid', 'due', 'id', 'partner', 'summary', 'type']);
  });

  it('finds the fundraiser whose stored address has capital letters', async () => {
    const r = await yourDayBlackbaud(query, 'gus@example.org', TODAY);
    assert.equal(r.linked, true);
    assert.deepEqual(ids(r.actions), ['101']);
  });

  it('counts a shared action for each person it is assigned to', async () => {
    assert.deepEqual(ids(dayRows(FR_B)), ['101']);
  });

  it('shows an action due on the last day of the window and hides the next day', () => {
    const rows = ids(dayRows(FR_A));
    assert.ok(rows.includes('105'));
    assert.ok(!rows.includes('104'));
  });

  it('takes the window and the overdue test from the date it is given, not the database clock', () => {
    add('700', { due: '2020-01-09', completed: false, computed: 'PastDue', status: 'Past due', fundraisers: ['7000'] });
    add('701', { due: '2020-01-10', completed: false, computed: 'Open', status: 'Open', fundraisers: ['7000'] });
    add('702', { due: '2020-01-17', completed: false, computed: 'Open', status: 'Open', fundraisers: ['7000'] });
    add('703', { due: '2020-01-18', completed: false, computed: 'Open', status: 'Open', fundraisers: ['7000'] });
    const rows = dayRows('7000', '2020-01-10');
    assert.deepEqual(ids(rows), ['700', '701', '702']);
    assert.equal(shapeYourDay(rows).overdue, 1);
  });

  it('leaves out an action whose constituent is not in the mirror', async () => {
    const r = await yourDayBlackbaud(query, 'fay@example.org', TODAY);
    assert.ok(!ids(r.actions).includes('600'));
    assert.equal(r.total, 6);
  });

  it('reports the true total and overdue count, not the page size', async () => {
    const r = await yourDayBlackbaud(query, 'fay@example.org', TODAY, 2);
    assert.equal(r.actions.length, 2);
    assert.equal(r.total, 6);
    assert.equal(r.overdue, 3);
    assert.ok(!('total' in r.actions[0]) && !('overdue_n' in r.actions[0]));
  });

  it('keeps counting past the row limit', () => {
    for (let i = 0; i < 70; i++) add(`9${String(i).padStart(3, '0')}`, { due: day(-5), completed: false, computed: 'PastDue', status: 'Past due', fundraisers: ['77777'] });
    const rows = dayRows('77777');
    const shaped = shapeYourDay(rows, 12);
    assert.equal(rows.length, 60);
    assert.equal(shaped.total, 70);
    assert.equal(shaped.overdue, 70);
  });

  it('returns nothing, with zero counts, when the person has no open actions', () => {
    assert.deepEqual(shapeYourDay(dayRows('12345'), 12), { actions: [], total: 0, overdue: 0 });
  });

  it('says not linked when no fundraiser has the address', async () => {
    assert.deepEqual(await yourDayBlackbaud(query, 'nobody@example.org', TODAY), { linked: false, actions: [], total: 0, overdue: 0 });
  });

  it('names the partner from the constituent record', () => {
    assert.equal(dayRows(FR_A)[0].partner, 'Ada Partner');
  });

  it('starts from the completed-date index so it never scans the whole table', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${yourDayActionsSql(60)}`).all(TODAY, FR_A).map((r) => r.detail).join(' | ');
    assert.match(plan, /SEARCH a USING INDEX idx_actions_action_completed_date/);
  });
});
