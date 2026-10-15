// Run with: npm test
//
// Reporting: goal pacing, the "what is in it" answer, weekly highlights, the routes that serve them and My dashboard pins.
// Invented people and figures only. The KPI dashboard and the Favor Brain are stubbed with fixtures that follow the shapes
// of their real answers, and the database is an in-memory copy.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const M = await import('../functions/_lib/hub/reporting-math.ts');

describe('pace', () => {
  const ly = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  it('follows last year when it gives a pattern, as a range', () => {
    const p = M.pace({ key: 'x', name: 'X', raised: 700, goal: 1200, asOf: '2026-07-01', lastYearMonthly: ly });
    assert.equal(p.basis, 'last-year');
    assert.ok(Math.abs(p.lyToDate - 603.2) < 0.1, String(p.lyToDate));
    // same remainder: 700 + (1200 - 603.2) = 1296.8. same pace: 700 / (603.2 / 1200) = 1392.5.
    assert.ok(Math.abs(p.projectedLow - 1296.8) < 0.1, String(p.projectedLow));
    assert.ok(Math.abs(p.projectedHigh - 1392.5) < 0.1, String(p.projectedHigh));
    assert.equal(p.status, 'ahead');
    assert.equal(p.toGo, 500);
    assert.ok(p.perWeekNeeded > 0);
  });
  it('uses a straight line when last year is empty and for awards', () => {
    const a = M.pace({ key: 'x', name: 'X', raised: 100, goal: 1000, asOf: '2026-07-02', lastYearMonthly: Array(12).fill(null) });
    assert.equal(a.basis, 'straight-line');
    assert.equal(a.projectedLow, a.projectedHigh);
    const g = M.pace({ key: 'g', name: 'Grants', measure: 'awarded', raised: 500, goal: 1000, asOf: '2026-07-02', lastYearMonthly: ly });
    assert.equal(g.basis, 'straight-line');
  });
  it('marks behind and close', () => {
    assert.equal(M.pace({ key: 'x', name: 'X', raised: 100, goal: 1000, asOf: '2026-07-02', lastYearMonthly: Array(12).fill(null) }).status, 'behind');
    assert.equal(M.pace({ key: 'x', name: 'X', raised: 960, goal: 1000, asOf: '2026-12-31' }).status, 'close');
  });
  it('writes the sentence and the method with the same figures', () => {
    const p = M.pace({ key: 'x', name: 'X', raised: 700, goal: 1200, asOf: '2026-07-01', lastYearMonthly: ly });
    assert.match(M.paceSentence(p), /between \$1,297 and \$1,393/);
    assert.match(M.paceMethod(p), /\$500 is left to the goal/);
  });
  it('builds no em dashes into any sentence', () => {
    const p = M.pace({ key: 'x', name: 'X', raised: 700, goal: 1200, asOf: '2026-07-01', lastYearMonthly: ly });
    const all = [M.paceSentence(p), M.paceMethod(p), ...Object.values(M.STATUS_LABEL)].join(' ');
    assert.ok(!/—|–/.test(all));
  });
});

// ---- fixtures for the routes --------------------------------------------------------------------------

const ASOF = '2026-10-12';
const gift = (date, partner, amount) => ({ date, partner, amount, gift_amount: amount });
const SLICE_ROWS = {
  'rdds|2026-10': [gift('2026-10-11', 'Ann Example', 300), gift('2026-10-06', 'Bob Sample', 200)],
  'rdds|2026-09': [gift('2026-09-20', 'Cy Invented', 1000)],
  'pc|2026-10': [gift('2026-10-10', 'Dee Made', 50)],
  'pc|2026-09': [gift('2026-09-02', 'Dee Made', 40)],
};
const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);
const leaked = [];

const KPI = {
  '/api/cf/ytd': {
    annualGoal: 100000,
    teamTotals: [
      { team: 'RDDs', portfolio_amount: 4000 },
      { team: 'Partner Care', portfolio_amount: 900 },
      { team: 'Grants Team', portfolio_amount: 0 },
      { team: 'Marketing', portfolio_amount: 0 },
      { team: 'Church Engagement', portfolio_amount: 0 },
    ],
    totals: { allSources: { giving: [0, 0, 0, 0, 0, 0, 0, 0, 1000, 550, null, null] } },
    donorKpis: {
      current: { as_of: ASOF, ytd_revenue: 6000 },
      lastYear: { ytd_revenue: 5000 },
      trend: [
        { asOf: '2025-12-31', ytdRevenue: 20000 },
        { asOf: '2026-09-30', ytdRevenue: 5450 },
        { asOf: ASOF, ytdRevenue: 6000 },
      ],
    },
  },
  '/api/cf/freshness': { lastUpdated: '2026-10-12T09:00:00Z' },
  '/api/cf/rdd': {
    goals: { annualGoal: 40000 },
    totals: { lastYear: { portfolio: { giving: Array(12).fill(500) } } },
    monthly: [
      { month: '2026-09', now: 1000, reported: 900 },
      { month: '2026-10', now: 500, reported: null },
    ],
  },
  '/api/cf/ce': { goals: { annualGoal: 10000 }, totals: {}, monthly: [] },
  '/api/cf/pc': {
    goals: { annualGoal: 5000 },
    totals: { lastYear: { portfolio: { giving: Array(12).fill(50) } } },
    monthly: [
      { month: '2026-09', now: 40, reported: 40 },
      { month: '2026-10', now: 50, reported: null },
    ],
  },
  '/api/cf/grants': {
    goals: { annualGoal: 30000 },
    awards: {
      awarded: 12000,
      received: 8000,
      toCome: 4000,
      count: 3,
      enteredThrough: '2026-10-02',
      months: [
        { month: '2026-03', awarded: 10000, awards: 2, received: 6000 },
        { month: '2026-09', awarded: 2000, awards: 1, received: 2000 },
        { month: '2026-10', awarded: 0, awards: 0, received: 0 },
      ],
      open: [{ name: 'Example Foundation', awarded: 6000, received: 2000, toCome: 4000 }],
    },
  },
  '/api/cf/marketing': { goals: { annualGoal: 8000 }, totals: {}, monthly: [] },
};
let teamsAnswer = ['rdd', 'pc'];
const realFetch = globalThis.fetch;

const env = (db) => ({ DB: db, KPI_JWT_SECRET: 'test-secret', KPI_URL: 'https://kpi.test', BRAIN_HUB_KEY: 'test-brain', BRAIN_URL: 'https://brain.test' });
const staff = { 'X-Hub-Email': 'staff@favorintl.org', 'X-Hub-Name': 'Staff Person', 'X-Hub-Via': 'google', 'X-Hub-Kpi': '1' };

let routes;
before(async () => {
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const u = new URL(req.url);
    if (u.host === 'kpi.test') {
      if (u.pathname === '/auth/verify') return Response.json({ ok: true, teams: teamsAnswer });
      return KPI[u.pathname] ? Response.json(KPI[u.pathname]) : new Response('no', { status: 404 });
    }
    if (u.host === 'brain.test' && u.pathname === '/hub/drill') {
      const b = JSON.parse(await req.text());
      const rows = SLICE_ROWS[`${b.slice}|${b.month}`] || [];
      return Response.json({ ok: true, rows, total: sum(rows), count: rows.length });
    }
    if (u.host === 'brain.test' && u.pathname === '/hub/ask') {
      const b = JSON.parse(await req.text());
      leaked.push(b.conv);
      return Response.json({ ok: true, blocks: [{ type: 'text', text: 'Refreshed answer for ' + b.question }] });
    }
    return new Response('unexpected ' + u.href, { status: 500 });
  };
  routes = {
    report: await import('../functions/api/hub/reporting/index.ts'),
    explain: await import('../functions/api/hub/reporting/explain.ts'),
    pins: await import('../functions/api/reporting/pins/index.ts'),
    pin: await import('../functions/api/reporting/pins/[id].ts'),
    refresh: await import('../functions/api/reporting/pins/[id]/refresh.ts'),
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

const get = (mod, path, headers = staff, e = env(memoryD1())) => mod.onRequestGet({ request: new Request('https://hub.test' + path, { headers }), env: e });

describe('GET /api/hub/reporting', () => {
  it('asks for a sign-in and KPI access', async () => {
    assert.equal((await get(routes.report, '/api/hub/reporting', {})).status, 401);
    assert.equal((await get(routes.report, '/api/hub/reporting', { 'X-Hub-Email': 'a@favorintl.org' })).status, 403);
  });
  it('returns pace for the year and only the teams the person may open', async () => {
    teamsAnswer = ['rdd', 'pc'];
    const d = await (await get(routes.report, '/api/hub/reporting')).json();
    assert.equal(d.ok, true);
    assert.deepEqual(Object.keys(d.pace).sort(), ['pc', 'rdd', 'year']);
    assert.equal(d.pace.year.raised, 6000);
    assert.equal(d.pace.year.goal, 100000);
    assert.equal(d.pace.rdd.raised, 4000);
    assert.deepEqual(d.highlights.teams.map((t) => t.key).sort(), ['pc', 'rdd']);
    assert.equal(d.giftsAvailable, true);
  });
  it('shows the Grants measure as awarded', async () => {
    teamsAnswer = ['grants'];
    const d = await (await get(routes.report, '/api/hub/reporting')).json();
    assert.equal(d.pace.grants.measure, 'awarded');
    assert.equal(d.pace.grants.raised, 12000);
    assert.ok(d.highlights.teams[0].lines.some((l) => /awarded this year/.test(l)));
  });
});

describe('GET /api/hub/reporting/explain', () => {
  it('rejects an unknown key and a team the person cannot open', async () => {
    teamsAnswer = ['rdd'];
    assert.equal((await get(routes.explain, '/api/hub/reporting/explain?key=bogus')).status, 400);
    assert.equal((await get(routes.explain, '/api/hub/reporting/explain?key=pc')).status, 403);
  });
  it('explains the year: the change since last month, and the tie to the dashboard month', async () => {
    teamsAnswer = ['rdd'];
    const d = await (await get(routes.explain, '/api/hub/reporting/explain?key=year')).json();
    assert.equal(d.ok, true);
    const c = d.change;
    assert.equal(c.shown, 6000);
    assert.equal(c.from.amount, 5450);
    assert.equal(c.delta, 550);
    assert.match(c.headline, /Up \$550 since Sep 30, from \$5,450 to \$6,000/);
    // This month's gifts across the slices are 300 + 200 + 50 = 550, the dashboard's October figure.
    assert.deepEqual(c.tie, { gifts: 550, kpi: 550, ok: true });
    assert.equal(c.top[0].amount, 300);
    assert.ok(d.paceSentence.length > 20);
  });
  it('explains a team and reports a restated month', async () => {
    teamsAnswer = ['rdd'];
    const d = await (await get(routes.explain, '/api/hub/reporting/explain?key=rdd')).json();
    assert.equal(d.change.shown, 4000);
    assert.equal(d.change.tie.ok, true);
    assert.ok(d.change.story.some((t) => /reported at \$900 when it closed and reads \$1,000 now/.test(t)));
    assert.deepEqual(d.change.lines.map((l) => l.label), ['RDDs']);
  });
  it('says so when the gifts and the dashboard month differ', async () => {
    const saved = SLICE_ROWS['rdds|2026-10'];
    SLICE_ROWS['rdds|2026-10'] = [gift('2026-10-11', 'Ann Example', 250)];
    teamsAnswer = ['rdd'];
    const d = await (await get(routes.explain, '/api/hub/reporting/explain?key=rdd')).json();
    SLICE_ROWS['rdds|2026-10'] = saved;
    assert.equal(d.change.tie.ok, false);
    assert.equal(d.change.tie.gifts, 250);
    assert.equal(d.change.tie.kpi, 500);
  });
  it('explains Grants from awards', async () => {
    teamsAnswer = ['grants'];
    const d = await (await get(routes.explain, '/api/hub/reporting/explain?key=grants')).json();
    assert.equal(d.change.shown, 12000);
    assert.equal(d.change.awards[0].name, 'Example Foundation');
    assert.equal(d.change.tie.ok, true);
  });
});

describe('My dashboard pins', () => {
  const db = memoryD1();
  db.exec(`CREATE TABLE report_pins (id TEXT PRIMARY KEY, email TEXT NOT NULL, title TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, asked_at TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE brain_threads (id TEXT PRIMARY KEY, email TEXT, title TEXT, pinned INTEGER DEFAULT 0, made_at TEXT, changed_at TEXT, source TEXT);
    CREATE TABLE brain_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT);`);
  const e = env(db);
  const post = (body, headers = staff) => routes.pins.onRequestPost({ request: new Request('https://hub.test/api/reporting/pins', { method: 'POST', headers, body: JSON.stringify(body) }), env: e });
  const other = { ...staff, 'X-Hub-Email': 'other@favorintl.org' };
  let id;

  it('pins an answer, keeps a table to its preview and drops download links and confirm cards', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ name: 'Person ' + i }));
    const res = await post({ question: 'How did RDDs do?', title: 'RDDs', answer: { blocks: [{ type: 'text', text: 'hi' }, { type: 'table', title: 'T', rows, preview: 8, csv: 'https://x/expiring', tokens: ['t'] }, { type: 'confirm', x: 1 }] } });
    const d = await res.json();
    assert.equal(d.ok, true);
    id = d.pin.id;
    assert.equal(d.pin.answer.blocks.length, 2);
    assert.equal(d.pin.answer.blocks[1].rows.length, 8);
    assert.equal(d.pin.answer.blocks[1].count, 60);
    assert.equal(d.pin.answer.blocks[1].csv, undefined);
  });
  it('pinning the same question again replaces the answer, not adds a pin', async () => {
    const d = await (await post({ question: 'How did RDDs do?', answer: { blocks: [{ type: 'text', text: 'newer' }] } })).json();
    assert.equal(d.pin.id, id);
    const list = await (await get(routes.pins, '/api/reporting/pins', staff, e)).json();
    assert.equal(list.pins.length, 1);
    assert.equal(list.pins[0].answer.blocks[0].text, 'newer');
  });
  it('refuses an empty answer and keeps pins private to their owner', async () => {
    assert.equal((await post({ question: 'q', answer: { blocks: [] } })).status, 400);
    assert.equal((await post({ question: '', answer: { blocks: [{ type: 'text' }] } })).status, 400);
    const theirs = await (await get(routes.pins, '/api/reporting/pins', other, e)).json();
    assert.equal(theirs.pins.length, 0);
    const del = await routes.pin.onRequestDelete({ request: new Request('https://hub.test/x', { method: 'DELETE', headers: other }), env: e, params: { id } });
    assert.equal(del.status, 404);
    assert.equal((await post({ question: 'sign in?', answer: { blocks: [{ type: 'text' }] } }, {})).status, 401);
  });
  it('renames, moves and refreshes, and leaves no chat behind', async () => {
    await post({ question: 'Second question', answer: { blocks: [{ type: 'text', text: 'two' }] } });
    const patch = (body) => routes.pin.onRequestPatch({ request: new Request('https://hub.test/x', { method: 'PATCH', headers: staff, body: JSON.stringify(body) }), env: e, params: { id } });
    assert.equal((await patch({ title: '  New   name ' })).status, 200);
    assert.equal((await patch({ move: 'down' })).status, 200);
    const list = (await (await get(routes.pins, '/api/reporting/pins', staff, e)).json()).pins;
    assert.equal(list[1].id, id);
    assert.equal(list[1].title, 'New name');
    const res = await routes.refresh.onRequestPost({ request: new Request('https://hub.test/x', { method: 'POST', headers: staff }), env: e, params: { id } });
    const d = await res.json();
    assert.equal(d.ok, true);
    assert.match(d.pin.answer.blocks[0].text, /Refreshed answer for How did RDDs do/);
    assert.equal(leaked.length, 1);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM brain_threads').get().n, 0);
  });
  it('unpins', async () => {
    const del = await routes.pin.onRequestDelete({ request: new Request('https://hub.test/x', { method: 'DELETE', headers: staff }), env: e, params: { id } });
    assert.equal(del.status, 200);
    const list = (await (await get(routes.pins, '/api/reporting/pins', staff, e)).json()).pins;
    assert.equal(list.length, 1);
  });
});

describe('snapshot', () => {
  it('serves the stored copy at once, rebuilds an old one in the background, and builds on first read', async () => {
    const db = memoryD1();
    db.exec('CREATE TABLE report_snapshots (key TEXT PRIMARY KEY, data TEXT NOT NULL, built_at TEXT NOT NULL, refreshing_at TEXT)');
    const e = env(db);
    teamsAnswer = ['rdd'];
    const first = await (await get(routes.report, '/api/hub/reporting', staff, e)).json();
    assert.equal(first.pace.year.raised, 6000);
    const row = db.db.prepare('SELECT data, built_at FROM report_snapshots').get();
    assert.equal(JSON.parse(row.data).year.raised, 6000);
    // Make the stored copy old and different: the old copy is what comes back, and a rebuild is queued.
    const old = JSON.parse(row.data);
    old.year.raised = 1;
    db.db.prepare('UPDATE report_snapshots SET data = ?, built_at = ?').run(JSON.stringify(old), '2020-01-01T00:00:00.000Z');
    const queued = [];
    const res = await routes.report.onRequestGet({ request: new Request('https://hub.test/api/hub/reporting', { headers: staff }), env: e, waitUntil: (p) => queued.push(p) });
    assert.equal((await res.json()).pace.year.raised, 1);
    assert.equal(queued.length, 1);
    await Promise.all(queued);
    assert.equal(JSON.parse(db.db.prepare('SELECT data FROM report_snapshots').get().data).year.raised, 6000);
    assert.equal(db.db.prepare('SELECT refreshing_at FROM report_snapshots').get().refreshing_at, null);
  });
  it('explains a gap as a gift entered after the dashboard rebuilt', async () => {
    const saved = SLICE_ROWS['rdds|2026-10'];
    SLICE_ROWS['rdds|2026-10'] = [...saved, gift('2026-10-12', 'Late Gift', 51.75)];
    teamsAnswer = ['rdd'];
    const d = await (await get(routes.explain, '/api/hub/reporting/explain?key=rdd')).json();
    SLICE_ROWS['rdds|2026-10'] = saved;
    assert.equal(d.change.tie.ok, false);
    assert.match(d.change.tie.note, /The \$51\.75 difference is a gift entered in Blackbaud after the dashboard last rebuilt/);
  });
});

describe('weekly highlight cards', () => {
  const rows = [
    { date: '2026-10-14', partner: 'Ada Lovelace', cid: '101', amount: 500 },
    { date: '2026-10-09', partner: 'Grace Hopper', cid: '102', amount: 1200 },
    { date: '2026-10-03', partner: 'Alan Turing', cid: '103', amount: 300 },
    { date: '2026-09-20', partner: 'Ada Lovelace', cid: '101', amount: 50 },
    { date: '2026-08-30', partner: 'Old Gift', cid: '104', amount: 75 },
  ];
  const pace = M.pace({ key: 'year', name: 'Raised this year', raised: 7000, goal: 10000, asOf: '2026-10-14' });
  const h = M.weeklyHighlight({ key: 'year', name: 'All of Favor', asOf: '2026-10-14', rows, rowsFrom: '2026-08-01', pace, monthSoFar: 2000, lastMonthTotal: 3500 });
  it('carries the same figures the sentences say', () => {
    assert.equal(h.amount, 1700);
    assert.equal(h.gifts, 2);
    assert.deepEqual(h.largest, { partner: 'Grace Hopper', cid: '102', amount: 1200, date: '2026-10-09' });
    assert.ok(h.lines.some((l) => l.includes('$1,200 from Grace Hopper on Oct 9')));
    assert.deepEqual(h.month, { key: '2026-10', soFar: 2000, lastKey: '2026-09', last: 3500 });
    assert.equal(h.goal.toGo, pace.toGo);
    assert.ok(h.lines.some((l) => l.includes(`${M.money0(pace.toGo)} is left`)));
  });
  it('lists eight weeks ending on the card week, oldest first, and leaves out weeks the rows do not reach', () => {
    assert.equal(h.weeks.length, 8);
    assert.equal(h.weeks[7].to, '2026-10-14');
    assert.equal(h.weeks[7].amount, 1700);
    assert.equal(h.weeks[0].from, '2026-08-20');
    const short = M.weeklyHighlight({ key: 'x', name: 'X', asOf: '2026-10-14', rows, rowsFrom: '2026-09-01', pace: null });
    assert.ok(short.weeks.every((w) => w.from >= '2026-09-01'));
    assert.equal(short.weeks.length, 6);
  });
});
