// Run with: npm test
//
// Gifts to thank (loadGifts, shapeGifts) and the call-prep brief (briefFor, prayerOf, stepsOf) against an in-memory copy of the
// mirror's tables in their real column layout. Every name, id and amount is made up: the repository is public. The query function
// refuses the same statement text the live mirror endpoint refuses.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { loadGifts, shapeGifts, weekStart } = await import('../functions/_lib/work/gifts.ts');
const { briefFor, prayerOf, stepsOf } = await import('../functions/_lib/work/prep.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const { lastWorkday } = await import('../functions/_lib/work/gifts-svc.ts');

const TODAY = '2026-10-10';
let db;
const q = async (sql, params = []) => {
  readOnly(sql);
  return db.prepare(sql).all(...params);
};
const env = { DB: null };

function gift(id, cid, amount, date, extra = {}) {
  db.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, constituent_record_id, gift_splits, soft_credits, linked_gift_id, gift_payment_method, date_added) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id, amount, date + 'T00:00:00', extra.type || 'Donation', 'Active', cid,
    JSON.stringify([{ id: id + '9', amount: { value: amount }, fund_id: extra.fund || '79' }]), extra.soft || null, extra.linked || null, extra.pm || 'PersonalCheck', extra.added || date + 'T09:00:00-04:00'
  );
}
function action(id, cid, { done, category = 'Phone call', thanked = 0, ask = null, summary = 'A call', description = '' }) {
  const raw = { id, category, completed: true, status: 'Completed', constituent_id: cid, fundraisers: ['501'] };
  db.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_category, action_type, action_summary, action_description, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?)').run(id, done + 'T00:00:00', done + 'T00:00:00', category, 'RDD Action', summary, description, cid, JSON.stringify(raw));
  db.prepare('INSERT INTO action_tags (id, thanked, action_ask_amount) VALUES (?,?,?)').run(id, thanked, ask);
}

before(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, constituent_lookup_id TEXT, constituent_type TEXT, first_name TEXT, last_name TEXT, preferred_name TEXT, organization_name TEXT,
      spouse_id TEXT, spouse_first_name TEXT, spouse_last_name TEXT, title TEXT, inactive INTEGER DEFAULT 0, deceased INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY UNIQUE, date_added DATETIME, gift_amount REAL, gift_date DATETIME, gift_type TEXT, gift_status TEXT, gift_splits TEXT, constituent_record_id TEXT,
      soft_credits TEXT, fundraiser_credits TEXT, gift_payment_method TEXT, linked_gift_id TEXT, gift_comments TEXT, raw_json TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY UNIQUE, action_date_due DATETIME, action_category TEXT, action_type TEXT, action_completed_date DATETIME, action_summary TEXT, action_description TEXT,
      action_direction TEXT, constituent_record_id TEXT, raw_json TEXT, date_added DATETIME, date_modified DATETIME, action_priority_level TEXT);
    CREATE TABLE action_tags (id TEXT PRIMARY KEY UNIQUE, action_ask_amount REAL, thanked INTEGER DEFAULT 0);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_from_date DATETIME, assignment_to_date DATETIME);
    CREATE TABLE phones (id TEXT PRIMARY KEY, constituent_record_id TEXT, phone_type TEXT, phone_number TEXT, is_primary INTEGER DEFAULT 1, do_not_call INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE emails (id TEXT PRIMARY KEY, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER DEFAULT 1, do_not_email INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE addresses (id TEXT PRIMARY KEY, constituent_record_id TEXT, address_lines TEXT, address_city TEXT, address_state TEXT, address_postal_code TEXT, address_country TEXT, do_not_mail INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 1, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE iwave_ratings (constituent_record_id TEXT PRIMARY KEY, overall INTEGER, overall_date TEXT, affinity INTEGER, propensity INTEGER, rfm INTEGER, estimated_capacity INTEGER, capacity_band TEXT, capacity_low INTEGER, capacity_high INTEGER, scored_at TEXT);
    CREATE TABLE bb_iwave_ratings (constituent_record_id TEXT PRIMARY KEY, score REAL, score_date TEXT, capacity REAL, ratings_json TEXT);
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, constituent_record_id TEXT, name TEXT, purpose TEXT, status TEXT, ask_amount REAL, ask_date TEXT, expected_amount REAL, expected_date TEXT,
      funded_amount REAL, funded_date TEXT, deadline TEXT, inactive INTEGER, fundraisers TEXT, date_added TEXT);
    CREATE TABLE constituent_codes (id TEXT PRIMARY KEY, constituent_record_id TEXT, code_description TEXT, raw_json TEXT);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_end_date TEXT, fundraiser_active INTEGER);
    CREATE TABLE sync_log (table_name TEXT, sync_status TEXT, run_at TEXT);
    INSERT INTO fundraisers VALUES ('501', 'Fay', 'Alpha', 'RDD', NULL, 1), ('502', 'Gus', 'Bravo', 'RDD', NULL, 1), ('600', 'Pat', 'Care', 'Partner Care', NULL, 1), ('999', 'Old', 'Hand', 'RDD', NULL, 0);
    INSERT INTO funds VALUES ('79', 'General Fund'), ('80', 'Clinics, Uganda');
    INSERT INTO constituents (id, constituent_lookup_id, constituent_type, first_name, last_name, organization_name, deceased, date_added, raw_json) VALUES
      ('1', '101', 'Individual', 'Ada', 'Example', NULL, 0, '2012-02-03T10:00:00', '{"name":"Ada Example","address":{"city":"Holland","state":"MI"}}'),
      ('2', '102', 'Individual', 'Ben', 'Sample', NULL, 0, '2024-01-03T10:00:00', '{"name":"Ben Sample","address":{"city":"Tampa","state":"FL"}}'),
      ('3', '103', 'Organization', NULL, NULL, 'Example Family Foundation', 0, '2020-01-01T10:00:00', '{"name":"Example Family Foundation","address":{"city":"Naples","state":"FL"}}'),
      ('4', '104', 'Individual', 'Cy', 'Care', NULL, 0, '2020-01-01T10:00:00', '{"name":"Cy Care"}'),
      ('5', '105', 'Individual', 'Di', 'Quiet', NULL, 0, '2019-01-01T10:00:00', '{"name":"Di Quiet"}'),
      ('6', '106', 'Individual', 'Ed', 'Former', NULL, 0, '2019-01-01T10:00:00', '{"name":"Ed Former"}');
    INSERT INTO assignments (id, constituent_record_id, assignment_fundraiser_id, assignment_type, assignment_from_date, assignment_to_date) VALUES
      ('a1', '1', '501', 'Regional Development Director (RDD)', '2020-01-01', NULL), ('a2', '2', '501', 'Prospect Steward', '2024-01-01', NULL),
      ('a3', '3', '502', 'Church Engagement Director', '2023-01-01', NULL), ('a4', '4', '600', 'Partner Care', '2020-01-01', NULL),
      ('a5', '5', '501', 'Regional Development Director (RDD)', '2020-01-01', NULL), ('a6', '6', '501', 'Regional Development Director (RDD)', '2019-01-01', '2025-01-01'),
      ('a7', '5', '600', 'Partner Care', '2020-01-01', NULL);
    INSERT INTO phones (id, constituent_record_id, phone_type, phone_number, is_primary, do_not_call) VALUES ('p1', '1', 'Mobile', '(555) 010-0001', 1, 0), ('p2', '5', 'Mobile', '(555) 010-0005', 1, 1);
    INSERT INTO emails (id, constituent_record_id, email_address, is_primary, do_not_email) VALUES ('e1', '1', 'ada@example.org', 1, 0);
    INSERT INTO sync_log VALUES ('__complete__', 'success', '2026-10-10 09:03:18');
  `);
  // Ada (1): a partner of long standing with a gift to thank, an older gift thanked by a tagged action, and a soft credit from the foundation.
  gift('g1', '1', 100, '2020-03-01');
  gift('g2', '1', 5000, '2025-06-15', { fund: '80' });
  gift('g3', '1', 500, '2026-10-07');
  gift('g4', '1', 50, '2026-10-02');
  action('t1', '1', { done: '2026-10-03', category: 'Mailing', thanked: 1, summary: 'Thank you letter' });
  // Ben (2): a first monthly gift with its pledge; a later payment of the same pledge must not be owed.
  gift('g5', '2', 100, '2026-10-09', { type: 'RecurringGiftPayment', linked: 'r1', pm: 'CreditCard', added: '2026-10-10T06:00:00-04:00' });
  gift('r1', '2', 100, '2026-10-09', { type: 'RecurringGift', pm: 'CreditCard' });
  // The foundation (3): a $10,000 gift soft-credited to Ada.
  gift('g6', '3', 10000, '2026-10-08', { fund: '80', soft: JSON.stringify([{ id: 's1', amount: { value: 10000 }, constituent_id: '1', gift_id: 'g6' }]) });
  // A Partner Care partner (4): not on a director's list.
  gift('g7', '4', 300, '2026-10-09');
  // Di (5): held by an RDD and Partner Care, do not call; her gift was thanked by a plain phone call after it.
  gift('g8', '5', 75, '2026-10-06');
  action('t2', '5', { done: '2026-10-08', category: 'Phone call', summary: 'Called to say thanks' });
  // Ed (6): the RDD assignment ended in 2025, so no director holds him now.
  gift('g9', '6', 40, '2026-10-05');
  // Outside the window, and a later payment of the pledge.
  gift('g10', '1', 80, '2026-08-01');
  gift('g11', '2', 100, '2026-11-01', { type: 'RecurringGiftPayment', linked: 'r1' });
  // Notes for the brief.
  action('t3', '1', { done: '2026-04-27', category: 'Phone call', summary: 'Check in', description: 'Retired nurse. She asked us to pray for her sister Anne during chemo. Asked how the Gulu clinic uses the solar fridge.' });
  action('t4', '1', { done: '2026-09-01', category: 'Email', summary: 'Asked for $1,500 for the well', ask: 1500 });
});

describe('weekStart and lastWorkday', () => {
  it('finds Monday and the workday before today', () => {
    assert.equal(weekStart('2026-10-10'), '2026-10-05');
    assert.equal(weekStart('2026-10-05'), '2026-10-05');
    assert.equal(lastWorkday('2026-10-12'), '2026-10-09');
    assert.equal(lastWorkday('2026-10-13'), '2026-10-12');
    assert.equal(lastWorkday('2026-10-10'), '2026-10-09');
  });
});

describe('gifts to thank', () => {
  let out;
  before(async () => {
    out = await loadGifts(env, q, { today: TODAY, nowMs: Date.parse('2026-10-10T14:00:00-04:00'), days: 21 });
  });
  const keys = () => out.rows.map((r) => r.key);

  it('lists gifts on partners a director holds, soft credits included, oldest first', () => {
    assert.deepEqual(keys().slice().sort(), ['g3:1', 'g5:2', 'g6:1', 'g6:3']);
    const dates = out.rows.map((r) => r.date);
    assert.deepEqual(dates, dates.slice().sort());
  });

  it('leaves out Partner Care partners, partners no director holds, thanked gifts, old gifts and later payments of a pledge', () => {
    assert.ok(!keys().some((k) => k.endsWith(':4')), 'a Partner Care partner is not on a director list');
    assert.ok(!keys().some((k) => k.startsWith('g9')), 'the assignment ended');
    assert.ok(!keys().includes('g4:1'), 'a Thanked action dated after the gift');
    assert.ok(!keys().includes('g8:5'), 'a completed phone call after the gift');
    assert.ok(!keys().some((k) => k.startsWith('g10')), 'outside the 21 day window');
    assert.ok(!keys().some((k) => k.startsWith('g11')), 'a later payment of the same pledge');
    assert.ok(!keys().some((k) => k.startsWith('r1')), 'the pledge itself is not a gift received');
  });

  it('credits the soft-credit partner the credited amount and names who gave', () => {
    const r = out.rows.find((x) => x.key === 'g6:1');
    assert.equal(r.amount, 10000);
    assert.equal(r.soft.giver, 'Example Family Foundation');
    assert.ok(r.badges.includes('Soft credit') && r.badges.includes('$1,000 and up'));
    assert.deepEqual(r.owners, ['501']);
    const own = out.rows.find((x) => x.key === 'g6:3');
    assert.equal(own.soft, null);
    assert.deepEqual(own.owners, ['502']);
  });

  it('sets the badges, the age and the call link', () => {
    const ben = out.rows.find((x) => x.key === 'g5:2');
    assert.ok(ben.badges.includes('First gift'));
    assert.equal(ben.pay, 'Monthly, card');
    assert.equal(ben.ageDays, 1);
    const ada = out.rows.find((x) => x.key === 'g3:1');
    assert.equal(ada.partner.phone, '(555) 010-0001');
    assert.equal(ada.partner.place, 'Holland, MI');
    assert.equal(ada.ageDays, 3);
    assert.ok(ada.hours >= 24);
    assert.equal(ada.fund, 'General Fund');
    assert.equal(ada.partner.lifetime, 100 + 5000 + 500 + 50 + 80);
  });

  it('counts what was thanked this week for the director', () => {
    // g8 was thanked Oct 8, inside the week that began Monday Oct 5. g4 was thanked Oct 3, the week before.
    assert.equal(out.thankedWeek['501'], 1);
  });

  it('lays the hub thank-yous over the mirror at once, and a left message keeps the gift owed', () => {
    const base = { gifts: [], holds: [], evidence: [], facts: [], stats: [], last: [], phones: [], monthly: [], funds: [], thanks: [], fundraisers: [{ id: '501', first: 'F', last: 'A', active: 1 }] };
    const raw = {
      ...base,
      gifts: [{ id: 'x1', giver: '1', amount: 200, gdate: '2026-10-09', added: '2026-10-10T06:00:00-04:00', gtype: 'Donation', pm: 'Cash', splits: null, soft: null, link: null, comment: null }],
      holds: [{ cid: '1', fid: '501', type: 'RDD' }],
      facts: [{ id: '1', name: 'Ada Example', kind: 'Individual', city: 'Holland', st: 'MI', deceased: 0, inactive: 0 }],
    };
    const o = { today: TODAY, nowMs: Date.parse('2026-10-10T14:00:00-04:00') };
    assert.equal(shapeGifts(raw, o).rows.length, 1);
    const left = shapeGifts({ ...raw, thanks: [{ gift_id: 'x1', cid: '1', how: 'call', outcome: 'left', created_at: '2026-10-10T15:00:00Z', actor: 'Fay Alpha', remind_on: '2026-10-11' }] }, o);
    assert.equal(left.rows.length, 1);
    assert.equal(left.rows[0].left.remind, '2026-10-11');
    const done = shapeGifts({ ...raw, thanks: [{ gift_id: 'x1', cid: '1', how: 'letter', outcome: 'sent', created_at: '2026-10-10T15:00:00Z', actor: 'Fay Alpha', remind_on: null }] }, o);
    assert.equal(done.rows.length, 0);
    assert.equal(done.today.length, 1);
    assert.equal(done.today[0].how, 'letter');
  });

  it('only asks the mirror read-only questions', async () => {
    const seen = [];
    const spy = async (sql, p) => {
      seen.push(sql);
      return q(sql, p);
    };
    await loadGifts(env, spy, { today: TODAY, days: 21 });
    assert.ok(seen.length >= 8);
    for (const s of seen) assert.doesNotThrow(() => readOnly(s));
  });

  it('reads one partner for the drawer card and the brief', async () => {
    const one = await loadGifts(env, q, { today: TODAY, days: 21, cid: '1' });
    // The read carries every row of the gifts that touch the partner; the service keeps the rows whose partner is this one.
    assert.deepEqual(one.rows.filter((r) => r.cid === '1').map((r) => r.key).sort(), ['g3:1', 'g6:1']);
    assert.ok(!one.rows.some((r) => r.giftId === 'g5'), 'a gift that does not touch the partner is not read');
  });
});

describe('the call-prep brief', () => {
  it('finds the last prayer request in a note or a contact, newest first', () => {
    const p = prayerOf([
      { date: '2026-04-27', summary: 'Check in', text: 'Retired nurse. She asked us to pray for her sister Anne during chemo. Asked about the clinic.', source: 'Contact' },
      { date: '2025-01-02', summary: 'Prayer request', text: 'Pray for her job.', source: 'Note' },
    ]);
    assert.equal(p.date, '2026-04-27');
    assert.match(p.text, /pray for her sister Anne/);
    assert.equal(prayerOf([{ date: '2026-01-01', summary: 'Sent letter', text: 'Mailed the letter.', source: 'Note' }]), null);
  });

  it('sets the call in the script order from the records', async () => {
    const b = await briefFor(env, '1', { q, today: TODAY, notes: [], owed: [{ giftId: 'g3', amount: 500, date: '2026-10-07', fund: 'General Fund', ageDays: 3 }] });
    assert.equal(b.name, 'Ada Example');
    assert.deepEqual(b.steps.map((s) => s.title), ['Thank', 'Pray', 'Report', 'Ask', 'Thank', 'Pray']);
    assert.match(b.steps[0].post, /to General Fund on Oct 7/);
    assert.equal(b.steps[0].strong, '$500');
    assert.match(b.steps[1].post, /pray for her sister Anne/);
    assert.equal(b.steps[3].strong, '$1,500');
    assert.equal(b.ask.amount, 1500);
    assert.equal(b.call.number, '(555) 010-0001');
    assert.equal(b.giving.largest.amount, 5000);
    assert.ok(b.gives && b.gives.fund);
    assert.equal(b.notesLive, true);
  });

  it('says so when a step has nothing on record, and hides the call when the partner asked not to be called', async () => {
    const b = await briefFor(env, '5', { q, today: TODAY, notes: null, owed: [] });
    assert.equal(b.call, null);
    assert.ok(b.flags.includes('Do not call'));
    assert.match(b.steps[1].post, /No prayer request on record/);
    assert.match(b.steps[3].post, /No ask on record/);
    assert.equal(b.notesLive, false);
  });

  it('writes several owed gifts as one thank step', () => {
    const steps = stepsOf({ owed: [{ giftId: 'a', amount: 100, date: '2026-10-01', fund: 'General Fund', ageDays: 9 }, { giftId: 'b', amount: 400, date: '2026-10-05', fund: 'Clinics', ageDays: 5 }], giving: { last: null }, gives: null, monthly: [], ask: null, prayer: null, since: '2020' }, TODAY);
    assert.equal(steps[0].strong, '2 gifts, $500');
    assert.match(steps[0].post, /largest is \$400 to Clinics/);
  });

  it('returns null for a record that is not in the mirror', async () => {
    assert.equal(await briefFor(env, '999999', { q, today: TODAY, notes: null, owed: [] }), null);
  });
});
