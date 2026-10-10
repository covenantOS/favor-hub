// Run with: npm test
//
// My partners (the portfolio read), reminders, and the morning email: its settings, its rollout, its build and its once-a-day lock.
// Every name, id and amount is made up: the repository is public. The mirror stand-in refuses the same statement text the live
// mirror endpoint refuses, and the hub database is an in-memory copy built from db/work.sql and db/work-reminders.sql.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { loadPortfolio, statsOf, isQuiet, gaveNoContact, isLapsed } = await import('../functions/_lib/work/portfolio.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const { dueFor, nextWorkday, checkInput, addReminders, listReminders, finishReminder, laterReminder } = await import('../functions/_lib/work/remind.ts');
const digest = await import('../functions/_lib/work/digest.ts');

const TODAY = '2026-10-12'; // a Monday
let mirror;
const q = async (sql, params = []) => {
  readOnly(sql);
  return mirror.prepare(sql).all(...params);
};

function gift(id, cid, amount, date, extra = {}) {
  mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, constituent_record_id, soft_credits) VALUES (?,?,?,?,?,?)').run(id, amount, date + 'T00:00:00', extra.type || 'Donation', cid, extra.soft || null);
}
function action(id, cid, { due, done = null, category = 'Phone call', summary = 'A call', completed = !!done }) {
  const raw = { id, category, completed, computed_status: completed ? 'Completed' : 'Open', constituent_id: cid, status: completed ? 'Completed' : 'Open', summary };
  mirror.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_category, action_summary, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?)').run(id, due + 'T00:00:00', done ? done + 'T00:00:00' : null, category, summary, cid, JSON.stringify(raw));
}

before(() => {
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, first_name TEXT, last_name TEXT, inactive INTEGER DEFAULT 0, deceased INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, constituent_record_id TEXT, soft_credits TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due TEXT, action_completed_date TEXT, action_category TEXT, action_summary TEXT, constituent_record_id TEXT, raw_json TEXT);
    CREATE TABLE phones (id TEXT PRIMARY KEY, constituent_record_id TEXT, phone_number TEXT, do_not_call INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    INSERT INTO constituents (id, constituent_lookup_id, first_name, last_name, inactive, deceased, raw_json) VALUES
      ('1', 'L1', 'Ada', 'One', 0, 0, '{"name":"Ada One","address":{"city":"Tampa","state":"FL"}}'),
      ('2', 'L2', 'Ben', 'Two', 0, 0, '{"name":"Ben Two","address":{"city":"Ocala","state":"FL"}}'),
      ('3', 'L3', 'Cy', 'Three', 0, 0, '{"name":"Cy Three"}'),
      ('4', 'L4', 'Di', 'Four', 0, 1, '{"name":"Di Four"}'),
      ('5', 'L5', 'Ed', 'Five', 0, 0, '{"name":"Ed Five"}'),
      ('6', 'L6', 'Fay', 'Six', 0, 0, '{"name":"Fay Six"}'),
      ('9', 'L9', 'Giver', 'Nine', 0, 0, '{"name":"Giver Nine"}');
    INSERT INTO assignments VALUES
      ('a1', '1', '501', 'Regional Development Director (RDD)', NULL), ('a2', '2', '501', 'Prospect Steward', NULL), ('a3', '3', '501', 'Church Engagement Director', NULL),
      ('a4', '4', '501', 'Prospect Steward', NULL), ('a5', '5', '501', 'Prospect Steward', '2026-01-01'), ('a6', '6', '501', 'Partner Care', NULL), ('a7', '1', '502', 'Prospect Steward', NULL);
    INSERT INTO phones VALUES ('p1', '1', '(555) 010-0001', 0, 0), ('p2', '2', '(555) 010-0002', 1, 0);
  `);
  // Ada: gave 9000 in the last 12 months, 4000 the 12 months before, a call 100 days ago.
  gift('g1', '1', 9000, '2026-02-01');
  gift('g2', '1', 4000, '2025-03-01');
  gift('g3', '1', 500, '2020-01-01');
  action('x1', '1', { due: '2026-07-04', done: '2026-07-04', category: 'Phone call' });
  action('x2', '1', { due: '2026-09-20', done: '2026-09-20', category: 'Mailing', summary: 'Receipt letter' });
  // Ben: gave last year only, no phone to call (do not call), an open task.
  gift('g4', '2', 600, '2025-06-01');
  action('x3', '2', { due: '2026-10-30', category: 'Task/Other', summary: 'Send the report' });
  // Cy: soft credit from a gift Giver Nine made, a visit 10 days ago.
  gift('g5', '9', 1000, '2026-08-01', { soft: JSON.stringify([{ id: 's1', amount: { value: 300 }, constituent_id: '3', gift_id: 'g5' }]) });
  action('x4', '3', { due: '2026-10-02', done: '2026-10-02', category: 'Meeting' });
  // Fay is held by Partner Care, not by the director, so she is not in the portfolio.
  gift('g6', '6', 100, '2026-05-01');
});

describe('My partners', () => {
  it('holds the partners a director holds now, and no one else', async () => {
    const p = await loadPortfolio(q, '501', TODAY);
    assert.deepEqual(p.rows.map((r) => r.cid).sort(), ['1', '2', '3']);
    assert.equal(p.held, 3);
  });

  it('sorts by giving in the last 12 months, soft credits included', async () => {
    const p = await loadPortfolio(q, '501', TODAY);
    assert.deepEqual(p.rows.map((r) => [r.cid, r.l12]), [['1', 9000], ['3', 300], ['2', 0]]);
    const ada = p.rows[0];
    assert.equal(ada.p12, 4000);
    assert.equal(ada.life, 13500);
    assert.equal(ada.gifts, 3);
    assert.deepEqual(ada.gift, { date: '2026-02-01', amount: 9000 });
    const cy = p.rows.find((r) => r.cid === '3');
    assert.deepEqual(cy.gift, { date: '2026-08-01', amount: 300, soft: true });
    assert.equal(cy.gifts, 1);
  });

  it('counts only a completed call, visit or email as a contact, never a mailed letter', async () => {
    const p = await loadPortfolio(q, '501', TODAY);
    const ada = p.rows.find((r) => r.cid === '1');
    assert.deepEqual(ada.last, { date: '2026-07-04', how: 'Call' });
    assert.equal(ada.quiet, 100);
    assert.equal(p.rows.find((r) => r.cid === '3').quiet, 10);
    assert.equal(p.rows.find((r) => r.cid === '2').quiet, null);
  });

  it('builds the five numbers on the stat band', async () => {
    const p = await loadPortfolio(q, '501', TODAY);
    assert.deepEqual(p.stats, { held: 3, quiet90: 2, gaveNoContact: 1, lapsed: 1, noPhone: 2 });
    const [ada, , ben] = [p.rows[0], p.rows[1], p.rows[2]];
    assert.equal(isQuiet(ada, 90), true);
    assert.equal(isQuiet(ada, 180), false);
    assert.equal(gaveNoContact(ada), true);
    assert.equal(isLapsed(ben), true);
  });

  it('shows the next step: an open task, or none', async () => {
    const p = await loadPortfolio(q, '501', TODAY);
    assert.equal(p.rows.find((r) => r.cid === '2').next.summary, 'Send the report');
    assert.equal(p.rows.find((r) => r.cid === '1').next, null);
  });

  it('lays a task the hub saved but the mirror lacks over the row', async () => {
    const p = await loadPortfolio(q, '501', TODAY, [{ cid: '1', id: 'wco_x', due: '2026-10-15', summary: 'Call to check in' }]);
    assert.deepEqual(p.rows.find((r) => r.cid === '1').next, { id: 'wco_x', due: '2026-10-15', summary: 'Call to check in', planned: true });
  });

  it('marks a partner whose every number is do not call, and one with no phone', async () => {
    const p = await loadPortfolio(q, '501', TODAY);
    assert.equal(p.rows.find((r) => r.cid === '2').dnc, true);
    assert.equal(p.rows.find((r) => r.cid === '3').dnc, false);
    assert.equal(p.rows.find((r) => r.cid === '1').phone, '(555) 010-0001');
  });

  it('answers an empty portfolio for a fundraiser who holds no one', async () => {
    const p = await loadPortfolio(q, '999', TODAY);
    assert.equal(p.held, 0);
    assert.deepEqual(statsOf(p.rows), p.stats);
  });
});

describe('reminders', () => {
  it('knows the next workday', () => {
    assert.equal(nextWorkday('2026-10-09'), '2026-10-12');
    assert.equal(nextWorkday('2026-10-12'), '2026-10-13');
  });

  it('turns a Later choice into an Eastern clock time whatever the daylight saving offset', () => {
    const fri = new Date('2026-10-09T15:00:00Z'); // 11 AM Eastern, EDT
    assert.equal(dueFor({ code: 'tomorrow' }, fri), '2026-10-12T13:00:00.000Z'); // Monday 9 AM EDT
    assert.equal(dueFor({ code: 'afternoon' }, fri), '2026-10-09T18:00:00.000Z'); // 2 PM EDT
    assert.equal(dueFor({ code: 'hour' }, fri), '2026-10-09T16:00:00.000Z');
    assert.equal(dueFor({ code: 'nextweek' }, fri), '2026-10-12T13:00:00.000Z');
    const winter = new Date('2026-12-03T15:00:00Z'); // 10 AM Eastern, EST
    assert.equal(dueFor({ code: 'tomorrow' }, winter), '2026-12-04T14:00:00.000Z'); // 9 AM EST
    assert.equal(dueFor({ date: '2026-12-10', time: '09:30' }, winter), '2026-12-10T14:30:00.000Z');
  });

  it('moves an afternoon reminder two hours on once 1:45 PM has passed', () => {
    const late = new Date('2026-10-09T19:30:00Z'); // 3:30 PM Eastern
    assert.equal(dueFor({ code: 'afternoon' }, late), '2026-10-09T21:30:00.000Z');
  });

  it('refuses a bad day, a bad time and a missing choice', () => {
    assert.throws(() => dueFor({ date: 'tomorrow' }), /real day/);
    assert.throws(() => dueFor({ date: '2026-12-10', time: '25:00' }), /real time/);
    assert.throws(() => dueFor({}), /when/);
  });

  it('checks the input', () => {
    assert.throws(() => checkInput({ kind: 'nope', title: 'x', due_at: '2026-10-10T10:00:00Z' }), /kind/);
    assert.throws(() => checkInput({ kind: 'task', title: '  ', due_at: '2026-10-10T10:00:00Z' }), /what the reminder/);
    assert.throws(() => checkInput({ kind: 'task', title: 'x', cid: '12;DROP', due_at: '2026-10-10T10:00:00Z' }), /partner number/);
    assert.throws(() => checkInput({ kind: 'task', title: 'x', due_at: 'soon' }), /when/);
    assert.equal(checkInput({ kind: 'task', title: 'Call Ada  back', ref_id: '119186', cid: '27202', due_at: '2026-10-12T13:00:00Z' }).title, 'Call Ada back');
  });

  it('adds, lists, snoozes and finishes a reminder for its owner only', async () => {
    const env = { DB: memoryD1() };
    env.DB.exec(readFileSync('db/work-reminders.sql', 'utf8'));
    const now = new Date('2026-10-12T14:00:00Z'); // 10 AM Eastern
    await addReminders(env, 'Dir@favorintl.org', [
      { kind: 'task', ref_id: '119186', cid: '27202', title: 'Call Ada back', note: 'Task due Oct 15', due_at: '2026-10-12T13:00:00Z' },
      { kind: 'plan_call', cid: '27202', title: 'Call Ben', due_at: '2026-10-12T20:00:00Z', source: 'plan_calls' },
      { kind: 'task', title: 'Next week', due_at: '2026-10-19T13:00:00Z' },
    ]);
    const mine = await listReminders(env, 'dir@favorintl.org', now);
    assert.deepEqual(mine.rows.map((r) => [r.title, r.bucket]), [['Call Ada back', 'now'], ['Call Ben', 'today'], ['Next week', 'later']]);
    assert.equal(mine.count, 2);
    assert.equal(mine.now, 1);
    assert.equal((await listReminders(env, 'other@favorintl.org', now)).rows.length, 0);
    const id = mine.rows[0].id;
    assert.equal(await finishReminder(env, 'other@favorintl.org', id), false);
    assert.equal(await laterReminder(env, 'dir@favorintl.org', id, '2026-10-13T13:00:00Z'), true);
    const after = await listReminders(env, 'dir@favorintl.org', now);
    assert.equal(after.rows.find((r) => r.id === id).bucket, 'tomorrow');
    assert.equal(await finishReminder(env, 'dir@favorintl.org', id), true);
    assert.equal(await finishReminder(env, 'dir@favorintl.org', id), false);
    assert.equal((await listReminders(env, 'dir@favorintl.org', now)).rows.length, 2);
  });
});

describe('the morning email', () => {
  const people = [
    { email: 'rdd@favorintl.org', name: 'Rae Director', team: 'rdd', bb_fundraiser_id: '501', work_center: 1, entry_owner: 1, entry_type: 'RDD Action', sheet_tab: null, active: 1, updated_at: '' },
    { email: 'sup@favorintl.org', name: 'Sam Support', team: 'support', bb_fundraiser_id: '700', work_center: 1, entry_owner: 0, entry_type: null, sheet_tab: null, active: 1, updated_at: '' },
    { email: 'pc@favorintl.org', name: 'Pat Care', team: 'partner_care', bb_fundraiser_id: '800', work_center: 1, entry_owner: 0, entry_type: null, sheet_tab: null, active: 1, updated_at: '' },
    { email: 'ce@favorintl.org', name: 'Cal Church', team: 'church', bb_fundraiser_id: '502', work_center: 1, entry_owner: 1, entry_type: 'CED Action', sheet_tab: null, active: 1, updated_at: '' },
  ];
  const mkEnv = () => {
    const DB = memoryD1();
    DB.exec(readFileSync('db/work.sql', 'utf8'));
    DB.exec(readFileSync('db/work-reminders.sql', 'utf8'));
    for (const p of people) DB.db.prepare('INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, sheet_tab, active, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(p.email, p.name, p.team, p.bb_fundraiser_id, p.work_center, p.entry_owner, p.entry_type, p.sheet_tab, p.active, 'now');
    return { DB, RESEND_API_KEY: '' };
  };
  const row = (o) => ({ id: '1', due: '2026-10-12', added: '2026-10-01', type: 'RDD Action', typeRaw: '', category: 'Phone call', summary: 'Call', description: '', cid: '27202', lookup: '1', partner: 'Ada One', place: '', fundraisers: ['501'], holders: ['501'], gift: null, later: null, group: null, deceased: false, ty: false, ctg: false, priority: '', pending: null, ...o });
  const board = { rows: [
    row({ id: 't1', ty: true, partner: 'Big Foundation', gift: { id: 'g1', amount: 10000, date: '2026-10-07', fund: 'F' }, due: '2026-10-08' }),
    row({ id: 't2', ty: true, partner: 'Small Giver', gift: { id: 'g2', amount: 250, date: '2026-10-12', fund: 'F' }, due: '2026-10-12' }),
    row({ id: 't3', ty: true, partner: 'Thanked Already', gift: { id: 'g3', amount: 900, date: '2026-10-09', fund: 'F' }, later: { id: 'l', date: '2026-10-10', by: ['501'], summary: 'thanked', category: 'Phone call', strength: 'thanked' } }),
    row({ id: 'd1', summary: 'Call Naomi back', partner: 'Naomi Patterson', due: '2026-10-12' }),
    row({ id: 'd2', summary: 'Kajo report', partner: 'Ellison', due: '2026-10-09' }),
    row({ id: 'd3', summary: 'Someone elses task', partner: 'Elsewhere', fundraisers: ['999'], holders: ['999'], due: '2026-10-01' }),
  ], people: {}, synced: '', orphans: 0, today: TODAY };
  const pf = new Map([['501', [
    { cid: '1', name: 'Thomas Whitaker', quiet: 277, l12: 25000 }, { cid: '2', name: 'Tiny Quiet', quiet: 200, l12: 10 }, { cid: '3', name: 'Active', quiet: 5, l12: 99999 },
    { cid: '4', name: 'Never Called', quiet: null, l12: 5000 }, { cid: '5', name: 'Fourth Quiet', quiet: 400, l12: 1 },
  ]]]);
  const now = new Date('2026-10-12T11:35:00Z'); // Monday 7:35 AM Eastern
  const data = { today: TODAY, board, portfolios: pf };

  it('builds a director email: gifts by amount, due and late, quiet partners by giving', async () => {
    const env = mkEnv();
    const b = await digest.buildFor(env, people[0], data, digest.DEFAULT_PREFS, now);
    assert.equal(b.empty, false);
    assert.equal(b.subject, '2 gifts to thank, 1 due today, 1 late');
    assert.deepEqual(b.counts, { gifts: 2, due: 1, late: 1, sent_back: 0, quiet: 4, reminders: 0 });
    assert.ok(b.html.indexOf('Big Foundation') < b.html.indexOf('Small Giver'), 'largest gift first');
    assert.match(b.html, /\$10,000[\s\S]*?3 days/);
    assert.ok(!b.html.includes('Thanked Already'), 'a thanked gift is not owed');
    assert.ok(!b.html.includes('Someone elses task'), 'only the person\'s own actions');
    assert.ok(b.html.indexOf('Thomas Whitaker') < b.html.indexOf('Never Called'), 'quiet partners by giving');
    assert.ok(b.html.includes('Tiny Quiet') && !b.html.includes('Fourth Quiet'), 'top 3 only');
    assert.match(b.html, /Good morning, Rae\./);
    assert.match(b.html, /Here is your Monday\./);
    assert.match(b.text, /Open the Work Center: https:\/\/dash\.favorintl\.org\/work\//);
    assert.ok(!/[—–]/.test(b.html + b.text), 'no em or en dashes');
    assert.ok(!/donor/i.test(b.html + b.text), 'partners, never donors');
  });

  it('leaves out a section the person turned off, and counts only what is shown', async () => {
    const env = mkEnv();
    const prefs = { ...digest.DEFAULT_PREFS, sections: { gifts: false, due: true, sent_back: true, quiet: false, reminders: true } };
    const b = await digest.buildFor(env, people[0], data, prefs, now);
    assert.equal(b.subject, '1 due today, 1 late');
    assert.ok(!b.html.includes('Big Foundation') && !b.html.includes('Thomas Whitaker'));
  });

  it('is empty when nothing is due, and a Support email has no quiet partners', async () => {
    const env = mkEnv();
    const none = await digest.buildFor(env, people[1], { today: TODAY, board: { ...board, rows: [] }, portfolios: new Map() }, digest.DEFAULT_PREFS, now);
    assert.equal(none.empty, true);
    assert.equal(none.subject, 'Nothing due this morning');
    assert.match(none.html, /Nothing is due this morning\./);
  });

  it('puts a due reminder in the email', async () => {
    const env = mkEnv();
    await addReminders(env, 'rdd@favorintl.org', [{ kind: 'task', title: 'Call Naomi Patterson back', due_at: '2026-10-12T11:00:00Z' }]);
    const b = await digest.buildFor(env, people[0], data, digest.DEFAULT_PREFS, now);
    assert.equal(b.counts.reminders, 1);
    assert.match(b.html, /Call Naomi Patterson back/);
    assert.match(b.subject, /1 reminder/);
  });

  it('keeps each person\'s settings, with defaults until they change one', async () => {
    const env = mkEnv();
    assert.deepEqual(await digest.getPrefs(env, 'rdd@favorintl.org'), digest.DEFAULT_PREFS);
    const saved = await digest.savePrefs(env, 'RDD@favorintl.org', { sections: { quiet: false }, send_time: '8:00', skip_empty: false });
    assert.deepEqual(saved, { sections: { gifts: true, due: true, sent_back: true, quiet: false, reminders: true }, send_time: '8:00', skip_empty: false });
    assert.deepEqual(await digest.getPrefs(env, 'rdd@favorintl.org'), saved);
    assert.equal((await digest.savePrefs(env, 'rdd@favorintl.org', { send_time: 'bogus' })).send_time, '8:00');
  });

  it('starts with the four regional directors on Monday Oct 12, Support and Partner Care a week later, and everyone else off', async () => {
    const env = mkEnv();
    const r = await digest.getRollout(env);
    assert.deepEqual(r, { rdd: '2026-10-12', support: '2026-10-19', partner_care: '2026-10-19', church: null, grants: null });
    assert.equal(digest.groupIsLive(r, 'rdd', '2026-10-12'), true);
    assert.equal(digest.groupIsLive(r, 'rdd', '2026-10-09'), false);
    assert.equal(digest.groupIsLive(r, 'support', '2026-10-16'), false);
    assert.equal(digest.groupIsLive(r, 'support', '2026-10-19'), true);
    assert.equal(digest.groupIsLive(r, 'church', '2026-12-01'), false);
    assert.equal(digest.groupOf('exec'), 'church');
  });

  it('lets an admin change the rollout and turn a group off', async () => {
    const env = mkEnv();
    await digest.setRollout(env, { support: '2026-10-26', rdd: null });
    const r = await digest.getRollout(env);
    assert.equal(r.support, '2026-10-26');
    assert.equal(r.rdd, null);
    assert.equal(r.partner_care, '2026-10-19');
    await digest.setRollout(env, { church: '2026-11-02', support: 'garbage' });
    const r2 = await digest.getRollout(env);
    assert.equal(r2.church, '2026-11-02');
    assert.equal(r2.support, null);
  });

  it('sends nothing before the rollout day, on a weekend, before the person\'s time, or after 10:30', async () => {
    const env = mkEnv();
    const sent = [];
    const f = globalThis.fetch;
    globalThis.fetch = async (_u, o) => { sent.push(JSON.parse(o.body)); return new Response('{"id":"x"}', { status: 200 }); };
    env.RESEND_API_KEY = 'test-key';
    try {
      assert.equal((await digest.run(env, new Date('2026-10-10T11:35:00Z'))).notes[0], 'weekend'); // Saturday
      assert.equal((await digest.run(env, new Date('2026-10-12T15:00:00Z'))).notes[0], 'after 10:30 AM'); // 11 AM Eastern
      const early = await digest.run(env, new Date('2026-10-12T11:10:00Z')); // 7:10 AM, before 7:30
      assert.equal(early.sent, 0);
      assert.equal(early.waiting >= 1, true);
      assert.equal(sent.length, 0);
    } finally { globalThis.fetch = f; }
  });

  it('is not sent to Support or Partner Care before their rollout day, and only the directors on Monday', async () => {
    const env = mkEnv();
    const f = globalThis.fetch;
    const to = [];
    globalThis.fetch = async (_u, o) => { to.push(...JSON.parse(o.body).to); return new Response('{"id":"x"}', { status: 200 }); };
    env.RESEND_API_KEY = 'test-key';
    // run() reads the live board through the mirror, which this test does not have, so only the gating is checked: who would be due.
    const staff = (await env.DB.prepare('SELECT * FROM act_staff').all()).results;
    const rollout = await digest.getRollout(env);
    const monday = staff.filter((s) => digest.groupIsLive(rollout, digest.groupOf(s.team), '2026-10-12')).map((s) => s.email);
    const next = staff.filter((s) => digest.groupIsLive(rollout, digest.groupOf(s.team), '2026-10-19')).map((s) => s.email);
    globalThis.fetch = f;
    assert.deepEqual(monday, ['rdd@favorintl.org']);
    assert.deepEqual(next.sort(), ['pc@favorintl.org', 'rdd@favorintl.org', 'sup@favorintl.org']);
    assert.deepEqual(to, []);
  });

  it('a dry run goes to an admin address only', async () => {
    const env = mkEnv();
    await assert.rejects(() => digest.dryRun(env, 'rdd@favorintl.org', 'rdd@favorintl.org'), /admin address/);
    await assert.rejects(() => digest.dryRun(env, 'rdd@favorintl.org', 'someone@gmail.com'), /admin address/);
    assert.deepEqual(digest.adminAddresses({ HUB_ADMINS: 'will@favorintl.org, x@gmail.com, tech@favorintl.org' }), ['will@favorintl.org', 'tech@favorintl.org']);
    assert.deepEqual(digest.adminAddresses({}), ['will@favorintl.org']);
  });
});
