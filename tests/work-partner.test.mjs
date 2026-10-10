// Run with: npm test
//
// The partner page's data (loadPartner) and the global search (searchPartners) against an in-memory copy of the mirror's tables in
// their real column layout. Every name, id and amount is made up: the repository is public. The query function refuses the same
// statement text the live mirror endpoint refuses, so a column alias that spells a banned word fails here.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { loadPartner, searchPartners, SYSTEM_ID } = await import('../functions/_lib/work/partner.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');

const TODAY = '2026-10-10';
let db;
const calls = [];
const q = async (sql, params = []) => {
  readOnly(sql);
  calls.push(sql);
  return db.prepare(sql).all(...params);
};

function gift(id, cid, amount, date, extra = {}) {
  db.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, constituent_record_id, gift_splits, soft_credits, linked_gift_id, gift_comments) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    id, amount, date + 'T00:00:00', extra.type || 'Donation', extra.status || 'Active', cid,
    JSON.stringify([{ id: id + '9', amount: { value: amount }, fund_id: extra.fund || '79' }]), extra.soft || null, extra.linked || null, extra.comment || null
  );
}

function action(id, cid, { due, done = null, category = 'Phone call', type = 'RDD Action', summary = 'A call', description = '', frs = ['501'], completed = !!done }) {
  const raw = { id, category, completed, computed_status: completed ? 'Completed' : 'Open', constituent_id: cid, date: due + 'T00:00:00', fundraisers: frs, status: completed ? 'Completed' : 'Open', summary, type };
  db.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_category, action_type, action_summary, action_description, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, due + 'T00:00:00', done ? done + 'T00:00:00' : null, category, type, summary, description, cid, JSON.stringify(raw)
  );
}

before(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_lookup_id TEXT, constituent_type TEXT, gender TEXT, title TEXT,
      first_name TEXT, middle_name TEXT, last_name TEXT, suffix TEXT, preferred_name TEXT, organization_name TEXT, primary_address_id TEXT, primary_email_id TEXT, primary_phone_id TEXT,
      primary_online_presence_id TEXT, spouse_id TEXT, spouse_first_name TEXT, spouse_last_name TEXT, spouse_is_head_of_household INTEGER DEFAULT 0, inactive INTEGER DEFAULT 0,
      deceased INTEGER DEFAULT 0, fundraiser_status TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE gifts (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, gift_amount REAL, gift_date DATETIME, gift_type TEXT, gift_status TEXT, gift_constituency TEXT,
      gift_splits TEXT, constituent_record_id TEXT, soft_credits TEXT, fundraiser_credits TEXT, gift_payment_method TEXT, linked_gift_id TEXT, receipt_status TEXT, receipt_date DATETIME,
      receipt_amount REAL, receipt_number TEXT, acknowledgment_status TEXT, acknowledgment_date DATETIME, post_status TEXT, post_date DATETIME, gift_comments TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE actions (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, action_date_due DATETIME, action_category TEXT, action_type TEXT, action_priority_level TEXT,
      action_completed_date DATETIME, action_direction TEXT, action_summary TEXT, action_description TEXT, constituent_record_id TEXT, action_fundraiser_id TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE assignments (id TEXT PRIMARY KEY UNIQUE, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_amount REAL, assignment_appeal_id TEXT,
      assignment_campaign_id TEXT, assignment_fund_id TEXT, assignment_from_date DATETIME, assignment_to_date DATETIME, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE emails (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER DEFAULT 1, do_not_email INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE phones (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, phone_type TEXT, phone_number TEXT, is_primary INTEGER DEFAULT 1, do_not_call INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE addresses (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, address_start_date DATETIME, address_end_date DATETIME, seasonal_start TEXT,
      seasonal_end TEXT, address_type TEXT, address_lines TEXT, address_city TEXT, address_state TEXT, address_suburb TEXT, address_county TEXT, address_postal_code TEXT, address_country TEXT,
      formatted_address TEXT, is_primary INTEGER DEFAULT 1, do_not_mail INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE iwave_ratings (constituent_record_id TEXT PRIMARY KEY UNIQUE, overall INTEGER, overall_date DATETIME, affinity INTEGER, affinity_date DATETIME, rfm INTEGER, rfm_date DATETIME,
      propensity INTEGER, propensity_date DATETIME, estimated_capacity INTEGER, estimated_capacity_date DATETIME, raw_json TEXT, synced_at DATETIME, capacity_low INTEGER, capacity_high INTEGER,
      capacity_band TEXT, capacity_value INTEGER, capacity_score INTEGER, capacity_source TEXT, scored_at TEXT);
    CREATE TABLE bb_iwave_ratings (constituent_record_id TEXT PRIMARY KEY, score REAL, score_date TEXT, capacity REAL, capacity_date TEXT, ratings_json TEXT, status TEXT, detail TEXT, checked_at TEXT);
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, constituent_record_id TEXT, name TEXT, purpose TEXT, status TEXT, ask_amount REAL, ask_date TEXT, expected_amount REAL, expected_date TEXT,
      funded_amount REAL, funded_date TEXT, deadline TEXT, inactive INTEGER, fundraisers TEXT, linked_gifts TEXT, date_added TEXT, date_modified TEXT, raw_json TEXT, synced_at TEXT);
    CREATE TABLE constituent_codes (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, date_modified DATETIME, constituent_record_id TEXT, code_description TEXT, raw_json TEXT, synced_at DATETIME);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY UNIQUE, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_end_date TEXT, fundraiser_active INTEGER);
    CREATE TABLE sync_log (table_name TEXT, sync_status TEXT, run_at TEXT);

    INSERT INTO constituents (id, constituent_lookup_id, constituent_type, first_name, last_name, spouse_id, inactive, deceased, date_added, raw_json) VALUES
      ('9001', '7001', 'Individual', 'Ada', 'Example', '9002', 0, 0, '2023-02-03T10:00:00', '{"name":"Ada Example","address":{"city":"Holland","state":"MI"},"email":{"address":"ada@example.org"}}'),
      ('9002', '7002', 'Individual', 'Ben', 'Example', '9001', 0, 0, '2023-02-03T10:00:00', '{"name":"Ben Example"}'),
      ('9003', '7003', 'Organization', NULL, NULL, NULL, 0, 0, '2024-01-01T10:00:00', '{"name":"Example Foundation"}'),
      ('9004', '7004', 'Individual', 'Cy', 'Nobody', NULL, 0, 1, '2020-01-01T10:00:00', '{"name":"Cy Nobody"}');
    UPDATE constituents SET organization_name = 'Example Foundation' WHERE id = '9003';
    INSERT INTO fundraisers VALUES ('501', 'Fay', 'Alpha', 'RDD', NULL, 1), ('502', 'Gus', 'Bravo', 'Partner Care', NULL, 1);
    INSERT INTO funds VALUES ('79', 'General Fund'), ('80', 'Project Alpha');
    INSERT INTO emails (id, constituent_record_id, email_address, is_primary, do_not_email) VALUES ('e1', '9001', 'ada@example.org', 1, 0), ('e2', '9001', 'old@example.org', 0, 1);
    INSERT INTO phones (id, constituent_record_id, phone_type, phone_number, is_primary, do_not_call) VALUES ('p1', '9001', 'Cell Phone', '(555) 010-1234', 1, 0);
    INSERT INTO addresses (id, constituent_record_id, address_lines, address_city, address_state, address_postal_code, address_country, is_primary) VALUES
      ('a1', '9001', '12 Maple Street', 'Holland', 'MI', '49423', 'United States', 1), ('a2', '9001', 'PO Box 4', 'Zeeland', 'MI', '49464', 'United States', 0);
    INSERT INTO assignments (id, constituent_record_id, assignment_fundraiser_id, assignment_type, assignment_from_date, assignment_to_date) VALUES
      ('s1', '9001', '501', 'RDD', '2025-01-01', NULL), ('s2', '9001', '502', 'Partner Care', '2023-01-01', '2024-12-31');
    INSERT INTO sync_log VALUES ('__complete__', 'success', '2026-10-10 09:03:18');
    INSERT INTO iwave_ratings (constituent_record_id, overall, overall_date, affinity, propensity, rfm, estimated_capacity, capacity_band) VALUES ('9001', 4, '2026-03-20', 3, 2, 5, 150000, '$100K - $250K');
    INSERT INTO opportunities (id, constituent_record_id, name, purpose, status, ask_amount, ask_date, expected_amount, funded_amount, inactive, fundraisers, date_added) VALUES
      ('o1', '9001', 'Project Alpha ask', 'Major Gift', 'Cultivation', 25000, '2026-09-01T00:00:00', 20000, 0, 0, NULL, '2026-09-01'),
      ('o2', '9001', 'Retired ask', 'Major Gift', 'Closed', 0, NULL, 0, 0, 1, NULL, '2025-01-01');
    INSERT INTO constituent_codes (id, constituent_record_id, code_description, raw_json) VALUES ('c1', '9001', NULL, '{"description":"Partner","inactive":false}'), ('c2', '9001', 'Church', '{"inactive":false}'), ('c3', '9001', 'Old', '{"inactive":true}');
  `);
  // Giving: 2024 two gifts, 2025 one big, 2026 three (one this year before today and one last-12 only), a recurring pledge with payments.
  gift('g1', '9001', 100, '2024-03-01');
  gift('g2', '9001', 50, '2024-11-20', { fund: '80', comment: 'Thanks to the team' });
  gift('g3', '9001', 5000, '2025-06-15');
  gift('g4', '9001', 200, '2026-02-10');
  gift('g5', '9001', 75, '2026-08-01', { type: 'RecurringGiftPayment', linked: 'r1' });
  gift('g6', '9001', 75, '2026-09-01', { type: 'RecurringGiftPayment', linked: 'r1' });
  gift('r1', '9001', 75, '2026-07-01', { type: 'RecurringGift' });
  gift('g7', '9001', 30, '2025-09-05'); // last year, outside the last 12 months
  gift('g8', '9003', 1000, '2026-03-03', { soft: JSON.stringify([{ id: 's', amount: { value: 400 }, constituent_id: '9001', gift_id: 'g8' }]) });
  action('x1', '9001', { due: '2026-10-20', category: 'Task/Other', type: 'RESERVED (Follow Up - New Gift Received)', summary: 'Thank for the gift' });
  action('x2', '9001', { due: '2026-09-30', category: 'Phone call', summary: 'Check in', description: 'Spoke with Ada about the Alpha project.', done: '2026-10-01' });
  action('x3', '9001', { due: '2026-06-01', category: 'Email', summary: 'Sent the newsletter', done: '2026-06-02' });
  action('x4', '9001', { due: '2026-10-25', category: 'Task/Other', summary: 'Canceled task', completed: false });
  db.prepare("UPDATE actions SET raw_json = json_set(raw_json, '$.status', 'Canceled') WHERE id = 'x4'").run();
});

describe('the partner view', () => {
  it('refuses anything that is not a system id and answers null for a missing record', async () => {
    assert.equal(SYSTEM_ID.test('9001'), true);
    assert.equal(SYSTEM_ID.test('9001; DROP'), false);
    assert.equal(await loadPartner(q, "9001' OR 1=1", TODAY), null);
    assert.equal(await loadPartner(q, '123456', TODAY), null);
  });

  it('reads identity, contact details and household', async () => {
    const p = await loadPartner(q, '9001', TODAY);
    assert.equal(p.name, 'Ada Example');
    assert.equal(p.lookup, '7001');
    assert.equal(p.place, 'Holland, MI');
    assert.equal(p.contact.address.lines, '12 Maple Street');
    assert.equal(p.contact.otherAddresses, 1);
    assert.deepEqual(p.contact.emails.map((e) => [e.address, e.primary, e.doNotEmail]), [['ada@example.org', true, false], ['old@example.org', false, true]]);
    assert.equal(p.contact.phones[0].number, '(555) 010-1234');
    assert.deepEqual(p.household.map((h) => h.name), ['Ben Example']);
    assert.deepEqual(p.codes.sort(), ['Church', 'Partner']);
    assert.equal(p.synced, '2026-10-10T09:03:18Z');
  });

  it('totals giving by year, finds the largest and last gift, and counts the year to date', async () => {
    const p = await loadPartner(q, '9001', TODAY);
    const g = p.giving;
    assert.equal(g.total, 100 + 50 + 5000 + 200 + 75 + 75 + 30);
    assert.equal(g.count, 7);
    assert.deepEqual(g.years.map((y) => [y.year, y.total, y.count, y.soft]), [['2026', 350, 3, 400], ['2025', 5030, 2, 0], ['2024', 150, 2, 0]]);
    assert.equal(g.largest.amount, 5000);
    assert.equal(g.last.date, '2026-09-01');
    assert.equal(g.ytd, 350);
    assert.equal(g.last12, 350);
    assert.equal(g.firstDate, '2024-03-01');
    assert.equal(g.recent[0].fund, 'General Fund');
    assert.equal(g.recent.find((x) => x.id === 'g2').fund, 'Project Alpha');
    assert.equal(g.soft.total, 400);
    assert.equal(g.soft.recent[0].amount, 400);
    assert.equal(g.soft.recent[0].soft, true);
  });

  it('does not count the recurring pledge row as money received', async () => {
    const p = await loadPartner(q, '9001', TODAY);
    assert.equal(p.giving.recent.some((x) => x.id === 'r1'), false);
    assert.equal(p.recurring.length, 1);
    assert.equal(p.recurring[0].lastPayment, '2026-09-01');
    assert.equal(p.recurring[0].payments, 2);
    assert.equal(p.recurring[0].lastAmount, 75);
  });

  it('lists open actions without completed or canceled ones, with recent history, notes and last contact', async () => {
    const p = await loadPartner(q, '9001', TODAY);
    assert.deepEqual(p.actions.open.map((a) => a.id), ['x1']);
    assert.equal(p.actions.openCount, 1);
    assert.deepEqual(p.actions.recent.map((a) => a.id).sort(), ['x2', 'x3', 'x4'].sort());
    assert.equal(p.actions.open[0].fundraisers[0].name, 'Fay Alpha');
    assert.deepEqual(p.notes.map((n) => n.id), ['x2']);
    assert.equal(p.lastContact.date, '2026-10-01');
    assert.equal(p.lastContact.category, 'Phone call');
    assert.equal(p.card.last_contact_kind, 'call');
  });

  it('shows who holds the partner now and who held them before, plus the iWave rating and opportunities', async () => {
    const p = await loadPartner(q, '9001', TODAY);
    assert.deepEqual(p.assignments.map((a) => [a.name, a.current]), [['Fay Alpha', true], ['Gus Bravo', false]]);
    assert.equal(p.iwave.overall, 4);
    assert.equal(p.iwave.capacity, 150000);
    assert.equal(p.iwave.capacityBand, '$100K - $250K');
    assert.deepEqual(p.opportunities.map((o) => o.id), ['o1']);
    assert.equal(p.opportunities[0].ask, 25000);
  });

  it('fills the iPhone contract card', async () => {
    const p = await loadPartner(q, '9001', TODAY);
    assert.deepEqual(p.card, {
      id: '9001', name: 'Ada Example', place: 'Holland, MI', phone: '(555) 010-1234', email: 'ada@example.org',
      last_gift_cents: 7500, last_gift_date: '2026-09-01', year_to_date_cents: 35000, last_contact_date: '2026-10-01', last_contact_kind: 'call',
    });
  });

  it('reads a partner with no gifts, rating, actions or address without failing', async () => {
    const p = await loadPartner(q, '9004', TODAY);
    assert.equal(p.deceased, true);
    assert.equal(p.giving.total, 0);
    assert.equal(p.giving.largest, null);
    assert.equal(p.giving.last, null);
    assert.equal(p.iwave, null);
    assert.equal(p.lastContact, null);
    assert.equal(p.contact.address, null);
    assert.equal(p.card.last_gift_cents, null);
    assert.equal(p.card.year_to_date_cents, 0);
  });

  it('reads an organization by its organization name and shows soft credit totals as received', async () => {
    const p = await loadPartner(q, '9003', TODAY);
    assert.equal(p.kind, 'Organization');
    assert.equal(p.name, 'Example Foundation');
    assert.equal(p.giving.total, 1000);
  });

  it('sends only read statements and binds the id as a parameter', async () => {
    calls.length = 0;
    await loadPartner(q, '9001', TODAY);
    assert.ok(calls.length > 15);
    for (const sql of calls) assert.equal(/9001/.test(sql), false);
  });
});

describe('global search', () => {
  const repo = {
    partnersByIds: async (ids) => ids.map((id) => ({ cid: id, lookup: '', name: 'by ids ' + id, place: '', holders: [], deceased: false })),
    partners: async (text) => [{ cid: 'text', lookup: '', name: 'by text ' + text, place: '', holders: [], deceased: false }],
  };
  it('finds a lookup id typed alone, and a system id', async () => {
    assert.deepEqual((await searchPartners(repo, q, '7001')).map((h) => h.cid), ['9001']);
    assert.deepEqual((await searchPartners(repo, q, '9002')).map((h) => h.cid), ['9002']);
  });
  it('finds a street address', async () => {
    assert.deepEqual((await searchPartners(repo, q, '12 Maple')).map((h) => h.cid), ['9001']);
  });
  it('hands names, emails and phone numbers to the same search the Entry type-ahead uses', async () => {
    assert.equal((await searchPartners(repo, q, 'Ada Example'))[0].cid, 'text');
    assert.equal((await searchPartners(repo, q, 'ada@example.org'))[0].cid, 'text');
    assert.equal((await searchPartners(repo, q, '555-010-1234'))[0].cid, 'text');
  });
  it('answers nothing for one letter or a number that matches no record', async () => {
    assert.deepEqual(await searchPartners(repo, q, 'a'), []);
    assert.deepEqual(await searchPartners(repo, q, '55555'), []);
  });
});
