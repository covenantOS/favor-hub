// Standard reports on the invented snapshot: totals, splits, drill specs and tie-outs.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { REPORTS, periodOf, reportOf, runReport } from '../functions/_lib/lists/reports.ts';
import { countList } from '../functions/_lib/lists/run.ts';
import { buildSnapshot } from '../functions/_lib/lists/snapshot.ts';
import { AS_OF, ioOf, makeHub, makeMirror, qOf } from './support/lists-fixture.mjs';

let q;
const ALL = { all: true, fids: [] };
const run = (id, asked = {}, kpi = null, mirror) => runReport(reportOf(id), q, AS_OF, asked, kpi, mirror);

before(async () => {
  const hub = makeHub();
  q = qOf(hub);
  await buildSnapshot(ioOf(makeMirror(), hub), AS_OF);
});

describe('periods', () => {
  it('turns a word into dates', () => {
    assert.deepEqual(periodOf('ytd', AS_OF), { from: '2026-01-01', to: AS_OF });
    assert.deepEqual(periodOf('lastmonth', AS_OF), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(periodOf('lastyear', AS_OF), { from: '2025-01-01', to: '2025-12-31' });
    assert.deepEqual(periodOf('custom', AS_OF, '2026-02-01', '2026-01-01'), { from: '2026-01-01', to: AS_OF });
  });
});

describe('giving', () => {
  it('totals the year to date and ties to the dashboard', async () => {
    const all = await run('giving', { period: 'ytd', by: 'kind' });
    const total = all.tiles[0].value;
    assert.ok(total > 0);
    const ok = await run('giving', { period: 'ytd' }, { monthlyGiving: [], ytdRevenue: total, status: null });
    assert.equal(ok.ties[0].status, 'match');
    const bad = await run('giving', { period: 'ytd' }, { monthlyGiving: [], ytdRevenue: 1, status: null });
    assert.equal(bad.ties[0].status, 'differs');
  });

  it('a month row drills to that month of gifts, and the drill count equals the row', async () => {
    const r = await run('giving', { period: 'ytd', by: 'month' });
    const row = r.rows.find((x) => x.k === '2026-08');
    assert.equal(row.gifts, 1);
    assert.equal((await countList(q, row._drill, AS_OF, ALL)).n, row.gifts);
  });
});

describe('credit by fundraiser', () => {
  it('splits one-time and recurring and counts gifts with no credit', async () => {
    const r = await run('credit', { period: 'ytd' });
    const pam = r.rows.find((x) => x.fid === '5002');
    assert.equal(pam.recurring, 25);
    assert.equal(pam.one_time, 0);
    assert.equal((await countList(q, pam._drill, AS_OF, ALL)).n, pam.gifts);
    assert.ok(r.tiles.find((t) => t.label === 'Gifts with no credit').value > 0);
  });
});

describe('status with the acquisition split', () => {
  it('ties to the dashboard and the split adds up', async () => {
    const r = await run('status', {}, { monthlyGiving: [], ytdRevenue: null, status: { active: 4, lybunt: 3, lapsed: 1 } });
    assert.ok(r.ties.length === 2 && r.ties.every((t) => t.status === 'match'));
    for (const s of ['LYBUNT', 'Lapsed']) {
      const rows = r.rows.filter((x) => x.k === s);
      assert.equal(rows.find((x) => x.group === 'All').now, rows.find((x) => x.group === 'Acquisition').now + rows.find((x) => x.group === 'Other').now);
    }
    const row = r.rows.find((x) => x.k === 'LYBUNT' && x.group === 'Acquisition');
    assert.equal((await countList(q, row._drill, AS_OF, ALL)).n, row.now);
  });
});

describe('other reports', () => {
  it('portfolio, new and lost, first-time, retention run and drill', async () => {
    const p = await run('portfolio');
    const rita = p.rows.find((x) => x.fid === '5001');
    assert.equal(rita.held, 2);
    assert.equal((await countList(q, rita._drill, AS_OF, ALL)).n, rita.held);
    const f = await run('first-time', { period: 'custom', from: '2025-01-01', to: '2026-12-31' });
    for (const row of f.rows) assert.equal((await countList(q, row._drill, AS_OF, ALL)).n, row.n);
    assert.equal((await run('new-lost')).tiles.length, 3);
    assert.equal((await run('retention', { period: 'ytd' })).rows.length, 3);
  });

  it('every report has a unique id and runs without the mirror', async () => {
    assert.equal(new Set(REPORTS.map((r) => r.id)).size, REPORTS.length);
    for (const r of REPORTS) await run(r.id);
  });

  it('a drill spec is cleaned like any list', async () => {
    const r = await run('giving', { period: 'ytd', by: 'month' });
    for (const row of r.rows) if (row._drill) assert.equal(row._drill.kind, 'gifts');
  });
});
