// Run with: npm test
//
// The Reports core (functions/_lib/reports): filter checks, the read-only lock on report SQL, CSV, Sheets spec,
// the tie-out compare, who sees which report, the engine run with a stand-in mirror and KPI answer, and the API
// routes. Made-up figures only: the repository is public and no test touches a live database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const engine = await import('../functions/_lib/reports/engine.ts');
const csv = await import('../functions/_lib/reports/csv.ts');
const tie = await import('../functions/_lib/reports/tieout.ts');
const reg = await import('../functions/_lib/reports/registry.ts');
const sheets = await import('../functions/_lib/reports/sheets.ts');
const byId = await import('../functions/api/reports/[id].ts');
const listRoute = await import('../functions/api/reports/index.ts');
const editRoute = await import('../functions/api/reports/edit.ts');

const filters = [
  { id: 'mode', label: 'Dates', type: 'seg', def: 'day', options: [['day', 'A day'], ['week', 'A week']] },
  { id: 'day', label: 'Day', type: 'date', def: '2026-01-02' },
  { id: 'month', label: 'Month', type: 'month', def: '' },
  { id: 'who', label: 'Who', type: 'text', def: '' },
];

const fakeDef = {
  id: 'fake',
  filters,
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount', type: 'money', total: true },
    { key: 'n', label: 'Gifts', type: 'int', total: true },
  ],
  async load(ctx) {
    const rows = await ctx.sql('SELECT name, amount, n FROM gifts WHERE day = ?', ['2026-01-02']);
    return { rows };
  },
  async tie(ctx, rows) {
    const k = await ctx.kpi();
    return tie.compare('KPI, YTD revenue', rows.reduce((s, r) => s + r.amount, 0), k ? k.ytdRevenue : null);
  },
  post: (rows) => `Total ${rows.length}`,
  tiles: (rows) => [{ label: 'Gifts', value: rows.length, kind: 'int' }],
};

describe('filters', () => {
  it('keep valid values and fall back to the default for anything else', () => {
    const v = engine.normalizeFilters(filters, { mode: 'week', day: '2026-02-30', month: '2026-13', who: '  Ann  ', extra: 'x' });
    assert.deepEqual(v, { mode: 'week', day: '2026-01-02', month: '', who: 'Ann' });
    assert.equal(engine.normalizeFilters(filters, { mode: 'nope' }).mode, 'day');
    assert.equal(engine.normalizeFilters(filters, { day: '2026-03-04', month: '2026-03' }).month, '2026-03');
    assert.equal(engine.normalizeFilters(filters, { who: 'x'.repeat(200) }).who.length, 80);
  });
});

describe('the read-only lock', () => {
  it('lets SELECT and WITH through', () => {
    engine.assertReadOnly('SELECT a FROM t WHERE x = ?');
    engine.assertReadOnly("with a as (select 1) select * from a where n = 'drop table'");
    engine.assertReadOnly('SELECT 1;');
  });
  it('refuses everything else', () => {
    for (const s of ['UPDATE t SET a = 1', 'DELETE FROM t', 'INSERT INTO t VALUES (1)', 'select 1; drop table t', 'PRAGMA table_info(t)', 'select * from t where a in (select 1) -- x\n; delete from t']) {
      assert.throws(() => engine.assertReadOnly(s), /read|one statement/i, s);
    }
  });
});

describe('csv', () => {
  const cols = [{ key: 'a', label: 'Name' }, { key: 'm', label: 'Amount', type: 'money' }, { key: 'p', label: 'Rate', type: 'pct' }];
  it('writes a byte order mark, CRLF, two-place money and quotes', () => {
    const out = csv.toCsv(cols, [{ a: 'Smith, Ann', m: 5, p: 0.256 }, { a: 'Say "hi"', m: null, p: null }], { m: 5 });
    assert.equal(out, '﻿Name,Amount,Rate\r\n"Smith, Ann",5.00,25.6%\r\n"Say ""hi""",,\r\nTotal,5.00,\r\n');
  });
  it('keeps a formula-looking text cell as text', () => {
    assert.equal(csv.csvCell('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(csv.csvCell('+1'), "'+1");
    assert.equal(csv.csvCell(-4), '-4');
  });
  it('names the file', () => {
    assert.equal(csv.csvFileName('daily-revenue', '2026-10-09', '2026-10-10'), 'daily-revenue-2026-10-09-2026-10-10.csv');
  });
});

describe('tie-out', () => {
  it('matches money to the cent and counts exactly', () => {
    assert.equal(tie.compare('x', 100.004, 100).status, 'match');
    const d = tie.compare('x', 100.02, 100);
    assert.equal(d.status, 'differs');
    assert.equal(d.diff, 0.02);
    assert.equal(tie.compare('x', 5, 5, 'count').status, 'match');
    assert.equal(tie.compare('x', 5, 6, 'count').diff, 1);
    assert.equal(tie.compare('x', 5, null).status, 'unavailable');
    assert.equal(tie.noTie().status, 'none');
  });
  it('takes the KPI figures, including the donor status counts and windows, straight from the dashboard answer', () => {
    const f = tie.figuresFrom({
      totals: { allSources: { giving: [10, 20.5], gifts: [1, 2] }, recurring: { giving: [3], gifts: [1] } },
      donorKpis: { current: { as_of: '2026-10-09', ytd_revenue: 30.5, ytd_gifts: 3, active_donors: 7, lybunt_donors: 4, lapsed_donors: 9, window: { active_after: '2025-10-09', lapsed_on_or_before: '2024-10-09' } } },
    });
    assert.equal(f.ytdRevenue, 30.5);
    assert.deepEqual(f.monthlyGiving.slice(0, 3), [10, 20.5, null]);
    assert.deepEqual(f.status, { active: 7, lybunt: 4, lapsed: 9, activeAfter: '2025-10-09', lapsedOnOrBefore: '2024-10-09' });
    assert.equal(tie.figuresFrom({}).status, null);
  });
});

describe('the engine', () => {
  const rows = [{ name: 'A', amount: 10.1, n: 1 }, { name: 'B', amount: 20.2, n: 2 }];
  const opts = (o = {}) => ({ user: { email: 'a@x.org', name: 'A' }, asked: {}, name: 'Fake', today: '2026-10-10', sql: async () => rows, kpi: async () => ({ ytdRevenue: 30.3, status: null }), ...o });
  it('returns rows, totals, tiles, tie-out and post text from one run', async () => {
    const r = await engine.runReport({}, fakeDef, opts());
    assert.equal(r.count, 2);
    assert.deepEqual(r.totals, { amount: 30.3, n: 3 });
    assert.equal(r.tie.status, 'match');
    assert.equal(r.post, 'Total 2');
    assert.equal(r.tiles[0].value, 2);
    assert.equal(r.asOf, '2026-10-10');
  });
  it('shows Differs when the KPI figure is not the same, and unavailable when the dashboard is down', async () => {
    assert.equal((await engine.runReport({}, fakeDef, opts({ kpi: async () => ({ ytdRevenue: 31 }) }))).tie.status, 'differs');
    assert.equal((await engine.runReport({}, fakeDef, opts({ kpi: async () => null }))).tie.status, 'unavailable');
  });
  it('turns a write away even when a definition tries one', async () => {
    const bad = { ...fakeDef, load: async (ctx) => ({ rows: await ctx.sql('DELETE FROM gifts') }) };
    await assert.rejects(() => engine.runReport({}, bad, opts()), /only read/);
  });
  it('caps the rows and says so', async () => {
    const many = Array.from({ length: engine.MAX_ROWS + 5 }, (_, i) => ({ name: String(i), amount: 1, n: 1 }));
    const r = await engine.runReport({}, fakeDef, opts({ sql: async () => many }));
    assert.equal(r.rows.length, engine.MAX_ROWS);
    assert.equal(r.count, engine.MAX_ROWS + 5);
    assert.equal(r.more, true);
  });
  it('gives typed-in rows a key', async () => {
    const d = { ...fakeDef, editable: { keyOf: (r) => r.name, columns: ['amount'] } };
    const r = await engine.runReport({}, d, opts({ edits: {} }));
    assert.deepEqual(r.rows.map((x) => x.__key), ['A', 'B']);
    assert.deepEqual(r.editable, ['amount']);
  });
  it('builds a Sheets request that adds the totals row', async () => {
    const r = await engine.runReport({}, fakeDef, opts());
    const spec = sheets.toSheetSpec(r, 'Day: x');
    assert.equal(spec.mode, 'rows');
    assert.equal(spec.tabs[0].rows.length, 3);
    assert.equal(spec.tabs[0].rows[2].name, 'Total');
    assert.equal(spec.tabs[0].columns[1].type, 'money');
    assert.equal(spec.provenance.filters, 'Day: x');
  });
  it('writes the filters in words', () => {
    assert.equal(engine.filtersInWords(fakeDef, { mode: 'week', day: '2026-01-02', month: '', who: '' }), 'Dates: A week');
  });
});

describe('who sees which report', () => {
  const mine = (...a) => new Set(a);
  it('shows a report only to the audiences that use it, and everything to an admin', () => {
    assert.deepEqual(reg.listFor(mine('marketing'), false).map((r) => r.id).sort(), ['appeal-results', 'carole-list', 'mailing', 'packets']);
    assert.deepEqual(reg.listFor(mine('admin_desk'), false).map((r) => r.id).sort(), ['daily-revenue', 'deposit', 'month-to-month', 'tax', 'weekly-recurring', 'ytd-income']);
    assert.equal(reg.listFor(mine(), false).length, 0);
    assert.equal(reg.listFor(mine(), true).length, reg.CATALOG.length);
  });
  it('lists a report as coming soon until its definition exists, and the query map as ready', () => {
    assert.equal(reg.isReady('query-map'), true);
    for (const r of reg.listFor(mine(), true)) assert.equal(r.ready, reg.isReady(r.id));
  });
  it('has 16 reports in four groups and no repeated id', () => {
    assert.equal(reg.CATALOG.length, 16);
    assert.equal(new Set(reg.CATALOG.map((r) => r.id)).size, 16);
    for (const r of reg.CATALOG) assert.ok(reg.GROUPS.some((g) => g.id === r.group));
  });
});

function env() {
  const d1 = memoryD1();
  d1.exec(`
    CREATE TABLE act_staff (email TEXT PRIMARY KEY, name TEXT, team TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE rpt_people (email TEXT NOT NULL, audience TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (email, audience));
    CREATE TABLE rpt_edits (report_id TEXT, row_key TEXT, col TEXT, value TEXT, updated_by TEXT, updated_at TEXT, PRIMARY KEY (report_id, row_key, col));
    CREATE TABLE rpt_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT, email TEXT, format TEXT, row_count INTEGER, ran_at TEXT);
    INSERT INTO act_staff VALUES ('dir@x.org', 'Dir', 'rdd', 1);
    INSERT INTO rpt_people VALUES ('desk@x.org', 'admin_desk', '2026-10-10');
  `);
  return { DB: d1 };
}
const req = (path, who, init = {}) => new Request('https://hub.test' + path, { ...init, headers: { 'X-Hub-Email': who.email, 'X-Hub-Role': who.role || 'staff', 'X-Hub-Via': 'google', ...(init.headers || {}) } });
const call = (mod, verb, request, params = {}, e = env()) => mod[verb]({ request, env: e, params });

describe('the routes', () => {
  it('turn away a request with no signed-in person', async () => {
    const res = await listRoute.onRequestGet({ request: new Request('https://hub.test/api/reports'), env: env() });
    assert.equal(res.status, 401);
  });
  it('list only what the person uses', async () => {
    const e = env();
    const d = await (await call(listRoute, 'onRequestGet', req('/api/reports', { email: 'desk@x.org' }), {}, e)).json();
    assert.ok(d.reports.every((r) => r.audience.includes('admin_desk')));
    assert.equal(d.reports.some((r) => r.id === 'daily-revenue' && r.ready === false), true);
    assert.equal(d.queryMap.ready, true);
    const rdd = await (await call(listRoute, 'onRequestGet', req('/api/reports', { email: 'dir@x.org' }), {}, e)).json();
    assert.deepEqual(rdd.reports.map((r) => r.id).sort(), ['portfolio', 'status']);
  });
  it('refuse a report to someone who does not use it, and say coming soon to someone who does', async () => {
    const e = env();
    assert.equal((await call(byId, 'onRequestGet', req('/api/reports/daily-revenue', { email: 'dir@x.org' }), { id: 'daily-revenue' }, e)).status, 403);
    const soon = await call(byId, 'onRequestGet', req('/api/reports/daily-revenue', { email: 'desk@x.org' }), { id: 'daily-revenue' }, e);
    assert.equal(soon.status, 404);
    assert.equal((await soon.json()).error, 'coming_soon');
    assert.equal((await call(byId, 'onRequestGet', req('/api/reports/nothing', { email: 'desk@x.org' }), { id: 'nothing' }, e)).status, 404);
  });
  it('serve the query map to everyone as JSON, CSV and a Sheets request, and filter it', async () => {
    const e = env();
    const who = { email: 'nobody@x.org' };
    const j = await (await call(byId, 'onRequestGet', req('/api/reports/query-map', who), { id: 'query-map' }, e)).json();
    assert.equal(j.report.count, 105);
    assert.equal(j.report.tie.status, 'none');
    assert.equal(j.report.note, null);
    const f = await (await call(byId, 'onRequestGet', req('/api/reports/query-map?now=machine', who), { id: 'query-map' }, e)).json();
    assert.ok(f.report.count > 0 && f.report.count < 105);
    const c = await call(byId, 'onRequestGet', req('/api/reports/query-map?format=csv', who), { id: 'query-map' }, e);
    assert.match(c.headers.get('Content-Disposition'), /^attachment; filename="query-map-/);
    assert.equal((await c.text()).split('\r\n').length, 107);
    const s = await (await call(byId, 'onRequestGet', req('/api/reports/query-map?format=sheet', who), { id: 'query-map' }, e)).json();
    assert.equal(s.spec.tabs[0].rows.length, 105);
    assert.equal(e.DB.db.prepare('SELECT COUNT(*) AS n FROM rpt_runs').get().n, 4);
  });
  it('refuse a typed-in cell for a report with none', async () => {
    const res = await call(editRoute, 'onRequestPost', req('/api/reports/edit', { email: 'desk@x.org' }, { method: 'POST', body: JSON.stringify({ report: 'query-map', key: 'a', col: 'b', value: '1' }) }));
    assert.equal(res.status, 400);
  });
});
