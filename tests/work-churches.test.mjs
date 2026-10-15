// Run with: npm test
//
// Churches view: which records count as churches, what counts as church giving (the pledge row stays out), the quarterly call date,
// the regions and the side panel, read from an in-memory copy of the mirror's tables. Every name and amount is made up: the repository
// is public. Nothing here talks to Blackbaud.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const ch = await import('../functions/_lib/work/churches.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');

const TODAY = '2026-10-14';
let m;
const q = async (sql, params = []) => {
  readOnly(sql);
  return m.prepare(sql).all(...params);
};

function build() {
  m = new DatabaseSync(':memory:');
  m.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, organization_name TEXT, first_name TEXT, last_name TEXT, inactive INTEGER DEFAULT 0, deceased INTEGER DEFAULT 0, requests_no_email INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE constituent_codes (id TEXT PRIMARY KEY, constituent_record_id TEXT, code_description TEXT, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_constituency TEXT, acknowledgment_status TEXT, constituent_record_id TEXT);
    CREATE TABLE emails (id TEXT PRIMARY KEY, constituent_record_id TEXT, email_address TEXT);
    CREATE TABLE constituent_relationships (id TEXT PRIMARY KEY, constituent_id TEXT, name TEXT, type TEXT, position TEXT, end_date TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due TEXT, action_completed_date TEXT, action_category TEXT, action_type TEXT, action_summary TEXT, constituent_record_id TEXT, raw_json TEXT);
  `);
  const org = (id, name, city, st, code = 'Church') => {
    m.prepare('INSERT INTO constituents (id, constituent_lookup_id, organization_name, raw_json) VALUES (?,?,?,?)').run(id, 'L' + id, name, JSON.stringify({ address: { city, state: st } }));
    m.prepare('INSERT INTO constituent_codes (id, constituent_record_id, code_description) VALUES (?,?,?)').run('k' + id, id, code);
  };
  const gift = (id, cid, amt, date, type = 'Donation', cons = 'Church', ack = 'Acknowledged') =>
    m.prepare('INSERT INTO gifts VALUES (?,?,?,?,?,?,?)').run(id, amt, date + 'T00:00:00', type, cons, ack, cid);
  org('1', 'Grace Test Church', 'Naples', 'FL');
  org('2', 'Hill Test Chapel', 'Austin', 'TX');
  org('3', 'Quiet Test Church', 'Boise', 'ID');
  org('4', 'Not A Church Co', 'Tampa', 'FL', 'Business');
  gift('g1', '1', 1000, '2026-10-12');
  gift('g2', '1', 500, '2025-03-01');
  gift('g3', '1', 250, '2026-04-01', 'RecurringGift');
  gift('g4', '2', 300, '2026-02-02', 'Donation', 'Church', 'NotAcknowledged');
  gift('g5', '3', 80, '2025-06-01');
  gift('g6', '4', 9999, '2026-05-05', 'Donation', 'Business');
  m.prepare('INSERT INTO emails VALUES (?,?,?)').run('e1', '1', 'office@grace.test');
  m.prepare('INSERT INTO emails VALUES (?,?,?)').run('e2', '4', 'x@biz.test');
  m.prepare('INSERT INTO constituent_relationships VALUES (?,?,?,?,?,?)').run('r1', '1', 'Pat Pastor', 'Pastor', 'Lead Pastor', null);
  m.prepare('INSERT INTO constituent_relationships VALUES (?,?,?,?,?,?)').run('r2', '1', 'Ed Employee', 'Employee', null, null);
  m.prepare('INSERT INTO constituent_relationships VALUES (?,?,?,?,?,?)').run('r3', '1', 'Gone Pastor', 'Pastor', null, '2020-01-01');
  m.prepare('INSERT INTO fundraisers VALUES (?,?,?)').run('600', 'Jo', 'Director');
  m.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run('a1', '1', '600', 'Church Engagement Director', null);
  m.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run('a2', '2', '600', 'Regional Development Director (RDD)', null);
  m.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?)').run('x1', '2026-10-13T00:00:00', '2026-10-13T00:00:00', 'Phone call', 'CED Action', 'Called the pastor', '1', JSON.stringify({ completed: true }));
  m.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?)').run('x2', '2026-12-01T00:00:00', null, 'Meeting', 'CED Action', 'Visit', '1', '{}');
  m.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?)').run('x3', '2026-05-01T00:00:00', '2026-05-01T00:00:00', 'Mailing', 'Letter', 'Letter', '3', JSON.stringify({ completed: true }));
}

beforeEach(build);

describe('regions', () => {
  it('maps a state to its region and leaves the rest as Other', () => {
    assert.equal(ch.regionOf('FL'), 'Southeast');
    assert.equal(ch.regionOf('tx'), 'South');
    assert.equal(ch.regionOf('ID'), 'West');
    assert.equal(ch.regionOf(''), 'Other');
  });
});

describe('loadChurches', () => {
  it('counts only church-coded records and church gifts, and never the pledge row', async () => {
    const r = await ch.loadChurches(q, TODAY);
    assert.deepEqual(r.rows.map((x) => x.name), ['Grace Test Church', 'Hill Test Chapel', 'Quiet Test Church']);
    assert.equal(r.stats.churchesOnFile, 3);
    assert.equal(r.stats.givingYtd, 1300);
    assert.equal(r.stats.giftsYtd, 2);
    assert.equal(r.stats.churchesGave, 2);
    assert.equal(r.stats.newsletter, 1);
  });
  it('reads years, pastor, holder and the quarterly call date', async () => {
    const r = await ch.loadChurches(q, TODAY);
    const g = r.rows[0];
    assert.equal(g.ytd, 1000);
    assert.equal(g.lastYear, 500);
    assert.equal(g.pastor, 'Pat Pastor');
    assert.equal(g.holder, 'Jo Director');
    assert.equal(g.lastContact, '2026-10-13');
    assert.deepEqual(g.call, { by: '2027-01-11', overdue: false, soon: false });
    assert.equal(g.region, 'Southeast');
  });
  it('a church nobody has spoken to is timed from its last gift, and a mailing is not a contact', async () => {
    const r = await ch.loadChurches(q, TODAY);
    const hill = r.rows.find((x) => x.cid === '2');
    assert.equal(hill.lastContact, null);
    assert.equal(hill.call.by, '2026-05-03');
    assert.equal(hill.call.overdue, true);
    assert.equal(hill.toThank, 1);
    const quiet = r.rows.find((x) => x.cid === '3');
    assert.equal(quiet.lastContact, null);
    assert.equal(r.stats.dueSoon, 2);
    assert.equal(r.stats.quiet90, 2);
  });
});

describe('loadChurchDetail', () => {
  it('returns giving by year, people and recent actions for a church', async () => {
    const d = await ch.loadChurchDetail(q, '1', TODAY);
    assert.deepEqual(d.years.map((y) => y.year), [2023, 2024, 2025, 2026]);
    assert.equal(d.years[3].total, 1000);
    assert.equal(d.years[2].total, 500);
    assert.equal(d.people[0].name, 'Pat Pastor');
    assert.equal(d.people.length, 2);
    assert.equal(d.recent[0].summary, 'Visit');
    assert.equal(d.openTasks, 1);
  });
  it('refuses a record that is not a church', async () => {
    assert.equal(await ch.loadChurchDetail(q, '4', TODAY), null);
  });
});
