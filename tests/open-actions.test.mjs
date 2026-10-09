// Run with: npm test   (Node 22.18 or newer; uses the built-in test runner and node:sqlite, nothing to install)
//
// Builds the mirror's actions and constituents tables in memory with the real column layout and
// the real shapes of raw_json, then runs the exact SQL that /api/hub/day sends to the mirror.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import { openActionSql, shapeYourDay, yourDayActionsSql } from '../functions/_lib/hub/actions.ts';

// The query's look-ahead window runs from the database's own clock (UTC), so the fixtures hang off today's UTC date.
const TODAY = new Date().toISOString().slice(0, 10);
const MICHAEL = '20794';
const WILL = '27202';
const day = (offset) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

let db;

function add(id, { due, completed, computed, status, completedDate = null, fundraisers = [MICHAEL], type = 'RDD Action', cid = '1', summary = `task ${id}` }) {
  const raw = { id, category: 'Task/Other', completed, computed_status: computed, constituent_id: cid, date: `${due}T00:00:00`, fundraisers, status, summary, type };
  if (completedDate) raw.completed_date = `${completedDate}T00:00:00`;
  db.prepare('INSERT INTO actions (id, action_date_due, action_type, action_category, action_summary, action_completed_date, constituent_record_id, action_fundraiser_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, `${due}T00:00:00`, type, 'Task/Other', summary, completedDate ? `${completedDate}T00:00:00` : null, cid, JSON.stringify(fundraisers), JSON.stringify(raw)
  );
}

const ids = (rows) => rows.map((r) => r.id);
const dayRows = (fundraiser) => db.prepare(yourDayActionsSql(60)).all(TODAY, fundraiser);

before(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE actions (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME DEFAULT null, date_modified DATETIME DEFAULT null, action_date_due DATETIME DEFAULT null,
      action_category TEXT, action_type TEXT, action_priority_level TEXT, action_completed_date DATETIME DEFAULT null, action_direction TEXT, action_summary TEXT,
      action_description TEXT, constituent_record_id TEXT, action_fundraiser_id TEXT, raw_json TEXT, synced_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX idx_actions_action_completed_date ON actions(action_completed_date);
    CREATE TABLE constituents (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, raw_json TEXT);
    INSERT INTO constituents (id, first_name, last_name, raw_json) VALUES ('1', 'Ada', 'Partner', '{"name":"Ada Partner"}');
  `);

  // Open, in the window.
  add('100', { due: day(-400), completed: false, computed: 'PastDue', status: 'Past due' }); // oldest, past due
  add('101', { due: day(-3), completed: false, computed: 'PastDue', status: 'Past due', fundraisers: [MICHAEL, WILL] });
  add('102', { due: day(0), completed: false, computed: 'Open', status: 'Open' }); // due today, not overdue
  add('103', { due: day(5), completed: false, computed: 'Open', status: 'Open' });
  // Open but after the 7 day window.
  add('104', { due: day(9), completed: false, computed: 'Open', status: 'Open' });
  // The defect: closed in bulk by a Database View import, no completed date in the record.
  add('200', { due: day(-120), completed: true, computed: 'Completed', status: 'Completed', type: 'RESERVED (Review New Constituent Record)' });
  add('201', { due: day(-119), completed: true, computed: 'Completed', status: 'Completed', type: 'RESERVED (Review New Constituent Record)', fundraisers: [MICHAEL, WILL] });
  // Completed the normal way, with a date.
  add('300', { due: day(-10), completed: true, computed: 'Completed', status: 'Completed', completedDate: day(-9) });
  // Completed with a date while the old status field still says Open (18 such rows in the mirror on 2026-10-09).
  add('301', { due: day(-40), completed: true, computed: 'Completed', status: 'Open', completedDate: day(-39) });
  // Canceled never counts as open.
  add('302', { due: day(-2), completed: false, computed: 'Canceled', status: 'Canceled' });
  // Someone else's.
  add('400', { due: day(-2), completed: false, computed: 'PastDue', status: 'Past due', fundraisers: ['99999'] });
  // A record without the completed flag at all is treated as open, which is what the date column alone said before.
  db.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, raw_json) VALUES (?,?,?,?)').run('500', `${day(-1)}T00:00:00`, null, JSON.stringify({ id: '500', fundraisers: [MICHAEL] }));
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
    assert.deepEqual(open, ['100', '101', '102', '103', '104', '400', '500']);
  });

  it('matches what the old date-only rule would have wrongly counted', () => {
    const dateOnly = db.prepare('SELECT COUNT(*) AS n FROM actions WHERE action_completed_date IS NULL').get().n;
    const shared = db.prepare(`SELECT COUNT(*) AS n FROM actions a WHERE ${openActionSql('a')}`).get().n;
    assert.equal(dateOnly - shared, 3); // 200, 201 and the canceled 302
  });
});

describe('Your day query', () => {
  it("lists one person's open actions in the window, oldest first", () => {
    assert.deepEqual(ids(dayRows(MICHAEL)), ['100', '101', '500', '102', '103']);
  });

  it('counts a shared action for each person it is assigned to', () => {
    assert.deepEqual(ids(dayRows(WILL)), ['101']);
  });

  it('reports the true total and overdue count, not the page size', () => {
    const shaped = shapeYourDay(dayRows(MICHAEL), 2);
    assert.equal(shaped.actions.length, 2);
    assert.equal(shaped.total, 5);
    assert.equal(shaped.overdue, 3); // 100, 101 and 500 are before today; 102 is due today
    assert.ok(!('total' in shaped.actions[0]) && !('overdue_n' in shaped.actions[0]));
  });

  it('keeps counting past the row limit', () => {
    for (let i = 0; i < 70; i++) add(`9${String(i).padStart(3, '0')}`, { due: day(-5), completed: false, computed: 'PastDue', status: 'Past due', fundraisers: ['77777'] });
    const rows = db.prepare(yourDayActionsSql(60)).all(TODAY, '77777');
    const shaped = shapeYourDay(rows, 12);
    assert.equal(rows.length, 60);
    assert.equal(shaped.total, 70);
    assert.equal(shaped.overdue, 70);
  });

  it('returns nothing, with zero counts, when the person has no open actions', () => {
    const shaped = shapeYourDay(db.prepare(yourDayActionsSql(60)).all(TODAY, '12345'), 12);
    assert.deepEqual(shaped, { actions: [], total: 0, overdue: 0 });
  });

  it('names the partner from the constituent record', () => {
    assert.equal(dayRows(MICHAEL)[0].partner, 'Ada Partner');
  });

  it('starts from the completed-date index so it never scans the whole table', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${yourDayActionsSql(60)}`).all(TODAY, MICHAEL).map((r) => r.detail).join(' | ');
    assert.match(plan, /idx_actions_action_completed_date/);
  });
});
