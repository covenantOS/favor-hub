// Run with: npm test
// Group B of Work Center round 3: the weekly goal counts, the giving line and the report draft. Made-up names, ids and amounts only.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const wk = await import('../functions/_lib/work/week.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
await import('../public/js/work-week-report.js');
const R = globalThis.WCWeekReport;

const TODAY = '2026-10-14'; // a Wednesday; the week is Oct 12 to 18
let db;
const q = async (sql, params = []) => {
  readOnly(sql);
  return db.prepare(sql).all(...params);
};

let n = 100;
function act({ cid = '9001', cat = 'Phone call', typ = 'RDD Action', due, done = null, fid = '501', summary = 'A call', descr = '', status = 'Open', tags = {}, loc = null }) {
  const id = String(++n);
  const completed = !!done;
  const raw = { id, category: cat, completed, computed_status: completed ? 'Completed' : 'Open', status: status === 'Canceled' ? 'Canceled' : completed ? 'Completed' : 'Open', location: loc, fundraisers: [fid] };
  db.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_category, action_type, action_summary, action_description, constituent_record_id, action_fundraiser_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    id, due + 'T00:00:00', done ? done + 'T00:00:00' : null, cat, typ, summary, descr, cid, JSON.stringify([fid]), JSON.stringify(raw)
  );
  if (Object.keys(tags).length) {
    db.prepare('INSERT INTO action_tags (id, action_ask_amount, action_referrals, attended_Hosted, presented, scheduling, stewardship, texted, thanked) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id, tags.ask || 0, tags.refs || 0, tags.ah || null, tags.pres || 0, tags.sched || 0, tags.stew || 0, tags.txt || 0, tags.thx || 0
    );
  }
  return id;
}

before(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, raw_json TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due TEXT, action_completed_date TEXT, action_category TEXT, action_type TEXT, action_summary TEXT, action_description TEXT, constituent_record_id TEXT, action_fundraiser_id TEXT, raw_json TEXT);
    CREATE TABLE action_tags (id TEXT PRIMARY KEY, action_ask_amount REAL, action_referrals REAL, attended_Hosted TEXT, presented INTEGER, scheduling INTEGER, stewardship INTEGER, texted INTEGER, thanked INTEGER);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, annual_goal REAL, fundraiser_start_date TEXT, fundraiser_end_date TEXT);
    CREATE TABLE fundraiser_totals (id TEXT PRIMARY KEY, totals_data TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, constituent_record_id TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    INSERT INTO constituents (id, first_name, last_name, raw_json) VALUES
      ('9001', 'Ada', 'Example', '{"name":"Ada Example"}'), ('9002', 'Ben', 'Sample', '{"name":"Ben Sample"}'), ('9003', 'Cy', 'Demo', '{"name":"Cy Demo"}'),
      ('9004', 'Di', 'Test', '{"name":"Di Test"}'), ('9005', 'Eli', 'Mock', '{"name":"Eli Mock"}');
    INSERT INTO fundraisers VALUES ('501', 'Fay', 'Alpha', 'Regional Development Director (RDD)', 600000, '2025-01-01', NULL),
      ('502', 'Gus', 'Bravo', 'Regional Development Director (RDD)', 1000000, '2026-05-11', NULL);
    INSERT INTO assignments VALUES ('s1', '9001', '501', 'Regional Development Director (RDD)', NULL), ('s2', '9002', '501', 'Regional Development Director (RDD)', NULL);
    INSERT INTO gifts VALUES ('g1', 500, '2026-10-13T00:00:00', 'Donation', '9001'), ('g2', 250, '2026-10-05T00:00:00', 'Donation', '9002'), ('g3', 100, '2026-10-14T00:00:00', 'RecurringGift', '9001');
  `);
  const months = [['2025-12', 50000], ['2026-01', 100000], ['2026-02', 200000], ['2026-09', 112000]].map(([m, a]) => ({ year_month: m, portfolio_amount: a, portfolio_gift_ct: 3 }));
  db.prepare('INSERT INTO fundraiser_totals VALUES (?, ?)').run('501', JSON.stringify(months));
  db.prepare('INSERT INTO fundraiser_totals VALUES (?, ?)').run('502', JSON.stringify([{ year_month: '2026-09', portfolio_amount: 30000 }]));

  // Counted: Sunday Oct 18 is inside the week, Monday Oct 12 is the first day.
  act({ cid: '9001', cat: 'Phone call', due: '2026-10-12', done: '2026-10-12', summary: 'Check in', descr: 'Spoke about the well report.' }); // connection 1
  act({ cid: '9001', cat: 'Email', due: '2026-10-13', done: '2026-10-13', summary: 'Sent the report' }); // same partner, still one connection
  act({ cid: '9002', cat: 'Meeting', due: '2026-10-13', done: '2026-10-13', summary: 'Coffee', descr: 'Coffee with Ben.', tags: { ask: 5000, stew: 1 } }); // connection 2, one-on-one
  act({ cid: '9003', cat: 'Meeting', due: '2026-10-14', done: '2026-10-14', summary: 'Church lunch', tags: { ah: 'Attended' } }); // connection 3, meeting, no one-on-one
  act({ cid: '9004', cat: 'Mailing', due: '2026-10-14', done: '2026-10-14', summary: 'Thank you letter', tags: { thx: 1 } }); // connection 4 (thank-you letter)
  act({ cid: '9005', cat: 'Mailing', due: '2026-10-14', done: '2026-10-14', summary: 'Newsletter' }); // a mailing without Thanked: not a connection
  // Not counted.
  act({ cid: '9001', cat: 'Phone call', due: '2026-10-11', done: '2026-10-11', summary: 'Sunday before the week' }); // outside the week
  act({ cid: '9001', cat: 'Phone call', due: '2026-10-19', done: '2026-10-19', summary: 'Next Monday' });
  act({ cid: '9001', cat: 'Phone call', typ: 'RESERVED (Information Update)', due: '2026-10-13', done: '2026-10-13' }); // staff data work
  act({ cid: '9001', cat: 'Phone call', due: '2026-10-13', summary: 'Open call, not done yet' }); // open, not completed
  act({ cid: '9002', cat: 'Phone call', due: '2026-10-13', done: '2026-10-13', status: 'Canceled' }); // canceled
  act({ cid: '9002', cat: 'Phone call', fid: '502', due: '2026-10-13', done: '2026-10-13' }); // another director's
  act({ cid: '777', cat: 'Phone call', due: '2026-10-13', done: '2026-10-13', summary: 'A partner the mirror dropped' }); // deleted or merged partner
  // Dated by the completed date: due in November, done Oct 18 (Sunday).
  act({ cid: '9003', cat: 'Meeting', due: '2026-11-02', done: '2026-10-18', summary: 'Sunday visit', tags: { refs: 2 } }); // connection (9003 already counted), one-on-one
  // An event the director scheduled and an open follow-up next week.
  act({ cid: '9002', cat: 'Task/Other', due: '2026-10-16', summary: 'Plan the Tampa vision event' });
  act({ cid: '9001', cat: 'Phone call', due: '2026-10-22', summary: 'Call about the dinner' });
});

describe('the week', () => {
  it('runs Monday to Sunday in Eastern dates', () => {
    assert.deepEqual(wk.weekSpan('2026-10-11'), { offset: 0, start: '2026-10-05', end: '2026-10-11', range: 'Oct 5 to 11' });
    assert.equal(wk.weekSpan('2026-10-12').start, '2026-10-12');
    assert.equal(wk.weekSpan('2026-10-14', 1).start, '2026-10-05');
    assert.equal(wk.weekSpan('2026-09-30').range, 'Sep 28 to Oct 4');
  });

  it('counts connections, meetings, the event and one-on-ones by the rules', async () => {
    const d = await wk.loadWeek(q, '501', TODAY);
    assert.deepEqual(d.counts, { conn: 4, mtg: 1, ev: 1, oo: 2 });
    assert.deepEqual(d.goals, { conn: 20, mtg: 3, ev: 1, oo: 3 });
    // 9001 twice counts once; the Sunday action counts by its completed date; the dropped partner, canceled, reserved, open and other-director rows do not.
    const names = d.rows.map((r) => r.name);
    assert.equal(names.includes('A partner the mirror dropped'), false);
    assert.equal(d.rows.some((r) => r.date === '2026-10-11' || r.date === '2026-10-19'), false);
    assert.equal(d.rows.find((r) => r.date === '2026-10-18').refs, 2);
    assert.equal(d.rows[0].date, '2026-10-18');
  });

  it('reads the calendar and the week after from open actions, and the gifts on held partners', async () => {
    const d = await wk.loadWeek(q, '501', TODAY);
    assert.deepEqual(d.calendar.map((x) => x.date), ['2026-10-13', '2026-10-16']);
    assert.deepEqual(d.next.map((x) => x.date), ['2026-10-22']);
    assert.deepEqual(d.gifts, { n: 1, total: 500 });
    assert.equal(d.asks.length, 1);
    assert.equal(d.asks[0].amount, 5000);
  });

  it('last week covers the days before', async () => {
    const d = await wk.loadWeek(q, '501', TODAY, 1);
    assert.equal(d.week.start, '2026-10-05');
    assert.equal(d.counts.conn, 1);
    assert.deepEqual(d.gifts, { n: 1, total: 250 });
  });
});

describe('giving to goal', () => {
  it('ties to the portfolio credit the KPI RDD tab sums for the year', async () => {
    const d = await wk.loadWeek(q, '501', TODAY);
    // The KPI route sums portfolio_amount over fundraiser_totals for the current year: 100,000 + 200,000 + 112,000 = 412,000 (2025 left out).
    const kpi = db.prepare("SELECT SUM(CAST(json_extract(td.value, '$.portfolio_amount') AS REAL)) AS a FROM fundraiser_totals ft JOIN json_each(ft.totals_data) td WHERE ft.id = '501' AND substr(json_extract(td.value, '$.year_month'), 1, 4) = '2026'").get().a;
    assert.equal(d.giving.ytd, kpi);
    assert.equal(d.giving.ytd, 412000);
    assert.equal(d.giving.goal, 600000);
  });

  it('paces the goal over the year and says how much a week closes the gap', () => {
    const g = wk.givingOf('2026-10-14', 412000, 600000, '2025-01-01', null);
    assert.equal(g.pace, Math.round((600000 * 287) / 365));
    assert.equal(g.behind, g.pace - 412000);
    assert.equal(g.weeks, 12);
    assert.equal(g.perWeek, Math.round(188000 / 12));
    assert.equal(g.pct.toFixed(1), '68.7');
  });

  it('prorates a part-year director the way the KPI tab does', async () => {
    const w = wk.yearWindow('2026-10-14', '2026-05-11', null);
    assert.equal(w.from, '2026-05-11');
    assert.equal(w.share.toFixed(4), (235 / 365).toFixed(4));
    const d = await wk.loadWeek(q, '502', TODAY);
    assert.equal(d.giving.goal, Math.round(1000000 * (235 / 365)));
    assert.equal(d.giving.ytd, 30000);
    // Ends before the year starts or a goal of zero: no division by zero.
    assert.equal(wk.givingOf('2026-10-14', 0, 0, null, null).pct, 0);
    assert.equal(wk.yearWindow('2026-10-14', null, '2025-12-31').share, 0);
  });
});

describe('the report draft', () => {
  const base = {
    week: { range: 'Oct 12 to 18' }, goals: { conn: 20, mtg: 3, ev: 1, oo: 3 }, counts: { conn: 13, mtg: 2, ev: 0, oo: 2 },
    rows: [
      { date: '2026-10-14', how: 'Visit', name: 'Thomas Sample', said: 'Coffee about the year-end gift.', ask: 25000, refs: 0 },
      { date: '2026-10-13', how: 'Call', name: 'Naomi Example', said: 'Asked about the clinic.', ask: 0, refs: 3 },
    ],
    moreRows: 11, giving: { ytd: 412000, goal: 600000, behind: 61000 }, gifts: { n: 3, total: 4200 },
    calendar: [{ date: '2026-10-19', how: 'Call', text: 'Call Naomi Example' }], next: [{ date: '2026-10-22', how: 'Visit', text: 'Visit Gerald Demo' }],
    quiet: [{ name: 'Cy Demo', last: '2026-03-30' }], asks: [{ name: 'Thomas Sample', amount: 25000, date: '2026-10-14' }],
  };
  const all = { give: true, asks: true, refs: true, next: true };

  it('writes the Friday update', () => {
    assert.equal(R.text(base, 'Fay Alpha', 'update', all), [
      'Weekly update, Oct 12 to 18', 'Fay Alpha, Regional Development Director', '',
      'Goals', 'Connections 13 of 20', 'Meetings attended or hosted 2 of 3', 'Event scheduled 0 of 1', 'One-on-ones 2 of 3', '',
      'What happened', 'Oct 14 · Visit · Thomas Sample: Coffee about the year-end gift.', 'Oct 13 · Call · Naomi Example: Asked about the clinic.', 'Plus 11 more actions', '',
      'Asks', 'Thomas Sample, $25,000, Oct 14', '',
      'Number of Referrals', 'Naomi Example: 3 referrals, Oct 13', '',
      'Gifts on my partners', '3 gifts, $4,200 this week.', 'Credited to me: $412,000 of $600,000 credited this year, $61,000 behind pace.', '',
      'Next', 'Thu, Oct 22 · Visit · Visit Gerald Demo',
    ].join('\n'));
  });

  it('writes the Monday goals and leaves out what is unticked', () => {
    const t = R.text(base, 'Fay Alpha', 'goals', { give: false, asks: false, refs: false, next: false });
    assert.equal(t, [
      'Goals for the week of Oct 12 to 18', 'Fay Alpha, Regional Development Director', '',
      'Goals', 'Connect with 20 partners or prospects', 'Attend 3 meetings', 'Schedule 1 Favor event', 'Hold 3 one-on-one appointments', '',
      'Partners I plan to reach this week', 'Cy Demo, last contact Mar 30, 2026',
    ].join('\n'));
    const full = R.text(base, 'Fay Alpha', 'goals', all);
    assert.ok(full.includes('On the calendar\nMon, Oct 19 · Call · Call Naomi Example'));
    assert.ok(full.includes('Open asks I am following\nThomas Sample, $25,000, asked Oct 14'));
  });

  it('names no recipient, uses no em dash and bolds only the headings for WhatsApp', () => {
    const t = R.text(base, 'Fay Alpha', 'update', all);
    assert.equal(/—|–/.test(t), false);
    assert.equal(/\bTo:|Stephanie|Michael|Rachel|donor/i.test(t), false);
    const wa = R.whatsapp(t);
    assert.ok(wa.includes('\n*What happened*\n'));
    assert.ok(wa.includes('\nOct 14 · Visit'));
    assert.equal(R.subject(base, 'Fay Alpha', 'update'), 'Weekly update, Oct 12 to 18, Fay Alpha');
  });
});
