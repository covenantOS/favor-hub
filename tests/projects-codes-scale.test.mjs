// Projects: the Blackbaud codes route (mirror read, cache, fallbacks) and the lists at 2,000 tasks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADA, DAN, NOW, VIC, call, seedProject, world } from './projects-support.mjs';

const APPEALS = [
  { code: 'L2610-FALL', description: 'Fall letter 2026' },
  { code: 'L2611-NOV', description: 'November letter 2026' },
  { code: 'L2610-FALL-WS', description: 'Fall letter, online' },
  { code: 'E2610', description: 'Fall event' },
];

function mirrorStub(rowsBySql, calls) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { sql } = JSON.parse(init.body);
    calls.push({ url: String(url), sql, auth: init.headers.Authorization });
    if (rowsBySql === 'down') throw new Error('network down');
    if (rowsBySql === 'error') return new Response('nope', { status: 500 });
    const key = Object.keys(rowsBySql).find((k) => sql.includes(k));
    return Response.json(key ? rowsBySql[key] : []);
  };
  return () => { globalThis.fetch = real; };
}

test('codes: the mirror\'s tables per kind, filtered by what is typed, cached for ten minutes', async () => {
  const { resetCodeCache } = await import('../functions/_lib/projects/codes.ts');
  resetCodeCache();
  const w = world();
  w.env.MIRROR_API_KEY = 'test-key';
  await seedProject(w);
  const calls = [];
  const restore = mirrorStub({ 'FROM appeals': APPEALS, 'FROM funds': [{ code: 'GEN', description: 'General fund' }], 'FROM campaigns': [{ code: 'C2610', description: 'Fall campaign' }] }, calls);
  try {
    const all = await call(w, VIC, 'GET', 'tasks/codes?kind=appeal');
    assert.equal(all.status, 200);
    assert.equal(all.data.from, 'mirror');
    assert.equal(all.data.typed, false);
    assert.equal(all.data.codes.length, 4);
    assert.match(calls[0].sql, /FROM appeals/);
    assert.equal(calls[0].auth, 'Bearer test-key');
    const q = await call(w, VIC, 'GET', 'tasks/codes?kind=appeal&q=fall');
    assert.deepEqual(q.data.codes.map((c) => c.code).sort(), ['E2610', 'L2610-FALL', 'L2610-FALL-WS']);
    const byCode = await call(w, VIC, 'GET', 'tasks/codes?kind=appeal&q=l2611');
    assert.deepEqual(byCode.data.codes.map((c) => c.code), ['L2611-NOV']);
    const first = await call(w, VIC, 'GET', 'tasks/codes?kind=appeal&q=e2610 fall');
    assert.equal(first.data.codes[0].code, 'E2610');
    assert.equal(calls.length, 1, 'one read of the mirror served all four');
    assert.equal((await call(w, VIC, 'GET', 'tasks/codes?kind=fund')).data.codes[0].code, 'GEN');
    assert.equal((await call(w, VIC, 'GET', 'tasks/codes?kind=campaign')).data.codes[0].description, 'Fall campaign');
    const src = await call(w, VIC, 'GET', 'tasks/codes?kind=source');
    assert.equal(src.data.codes.length, 4, 'with no appeal marked as a source, every appeal is offered');
    assert.equal((await call(w, VIC, 'GET', 'tasks/codes?kind=nope')).data.error, 'bad_kind');
    assert.equal((await call(w, VIC, 'GET', 'tasks/codes')).status, 400);
    const limited = await call(w, VIC, 'GET', 'tasks/codes?kind=appeal&limit=2');
    assert.equal(limited.data.codes.length, 2);
  } finally {
    restore();
  }
});

test('codes: a stale list stands in when the mirror stops answering; with none, codes already used on tasks are offered as typed', async () => {
  const { resetCodeCache, codesFor } = await import('../functions/_lib/projects/codes.ts');
  resetCodeCache();
  const w = world();
  w.env.MIRROR_API_KEY = 'test-key';
  await seedProject(w);
  const calls = [];
  let restore = mirrorStub({ 'FROM appeals': APPEALS }, calls);
  const t0 = Date.now();
  const fresh = await codesFor(w.env, 'appeal', '', 50, t0);
  assert.equal(fresh.from, 'mirror');
  restore();
  restore = mirrorStub('down', calls);
  try {
    const stale = await codesFor(w.env, 'appeal', 'fall', 50, t0 + 11 * 60_000);
    assert.equal(stale.from, 'cache');
    assert.equal(stale.typed, false);
    assert.equal(stale.codes.length, 3);
    resetCodeCache();
    await call(w, VIC, 'POST', 'tasks', { title: 'Used before', project_id: 'MKT', appeal_code: 'L2609-JMPC' });
    await call(w, VIC, 'POST', 'tasks', { title: 'Again', project_id: 'MKT', appeal_code: 'L2609-JMPC' });
    const typed = await call(w, VIC, 'GET', 'tasks/codes?kind=appeal');
    assert.equal(typed.status, 200, 'the route still answers');
    assert.equal(typed.data.from, 'recent');
    assert.equal(typed.data.typed, true);
    assert.deepEqual(typed.data.codes, [{ code: 'L2609-JMPC', description: '' }]);
    assert.deepEqual((await call(w, VIC, 'GET', 'tasks/codes?kind=fund')).data.codes, []);
    restore();
    restore = mirrorStub('error', calls);
    resetCodeCache();
    assert.equal((await call(w, VIC, 'GET', 'tasks/codes?kind=appeal')).data.typed, true, 'a 500 from the mirror is the same as no answer');
  } finally {
    restore();
  }
  const noKey = world();
  const { resetCodeCache: reset } = await import('../functions/_lib/projects/codes.ts');
  reset();
  const none = await call(noKey, ADA, 'GET', 'tasks/codes?kind=appeal');
  assert.equal(none.data.typed, true, 'no mirror key set: typed');
});

test('2,000 tasks in one project: every list query starts from an index and the list answers fast', async () => {
  const w = world();
  const p = await seedProject(w);
  const d = w.d1.db;
  const sec = ['s1', 's2', 's3', 's4'];
  d.prepare('BEGIN').run();
  const ins = d.prepare(`INSERT INTO hub_tasks (id, project_id, section_id, code, title, status, priority, owner_email, start_date, due_date, sort, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?)`);
  const people = [VIC.email, DAN.email, ADA.email, null];
  for (let i = 0; i < 2000; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    ins.run(`tsk_${i}`, p.id, sec[i % 4], `MKT-${String(i + 1).padStart(4, '0')}`, `Task ${i} ${'x'.repeat(i % 40)}`, i % 5 === 0 ? 'done' : 'open', people[i % 4], `2026-10-${day}`, `2026-11-${day}`, (i + 1) * 1000, ADA.email, NOW, NOW);
  }
  for (let i = 0; i < 2000; i += 7) d.prepare(`INSERT INTO hub_task_comments (id, task_id, author_email, body, created_at) VALUES (?, ?, ?, 'c', ?)`).run(`c_${i}`, `tsk_${i}`, VIC.email, NOW);
  for (let i = 0; i < 2000; i += 11) d.prepare(`INSERT INTO hub_tasks (id, project_id, parent_id, code, title, status, sort, created_by, created_at, updated_at) VALUES (?, ?, ?, NULL, 'sub', 'open', 1, ?, ?, ?)`).run(`sub_${i}`, p.id, `tsk_${i}`, ADA.email, NOW, NOW);
  d.prepare('COMMIT').run();

  const plan = (sql, ...a) => d.prepare('EXPLAIN QUERY PLAN ' + sql).all(...a).map((r) => r.detail).join(' | ');
  const mustSearch = (sql, ...a) => {
    const text = plan(sql, ...a);
    assert.ok(/USING (COVERING )?INDEX/.test(text) && !/SCAN (t|hub_tasks)\b(?! USING)/.test(text), 'uses an index: ' + text);
  };
  mustSearch(`SELECT t.* FROM hub_tasks t WHERE t.project_id = ? AND t.status NOT IN ('done','dropped') AND t.parent_id IS NULL ORDER BY t.sort, t.id LIMIT 2500`, p.id);
  mustSearch(`SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = ? AND t.status <> 'dropped' AND t.parent_id IS NULL`, p.id);
  mustSearch(`SELECT t.* FROM hub_tasks t WHERE t.owner_email = ? AND t.status NOT IN ('done','dropped') ORDER BY t.due_date`, VIC.email);
  mustSearch(`SELECT parent_id AS k, COUNT(*) FROM hub_tasks WHERE project_id = ? AND parent_id IS NOT NULL AND status <> 'dropped' GROUP BY parent_id`, p.id);
  mustSearch(`SELECT c.task_id, COUNT(*) FROM hub_task_comments c JOIN hub_tasks t ON t.id = c.task_id WHERE t.project_id = ? AND c.deleted_at IS NULL GROUP BY c.task_id`, p.id);
  mustSearch(`SELECT project_id, COUNT(*) FROM hub_tasks WHERE project_id IS NOT NULL AND parent_id IS NULL AND status <> 'dropped' GROUP BY project_id`);

  const t0 = performance.now();
  const all = await call(w, DAN, 'GET', 'tasks?project=MKT&status=all&limit=5000');
  const ms = performance.now() - t0;
  assert.equal(all.data.total, 2000);
  assert.equal(all.data.tasks.length, 2000);
  assert.ok(ms < 2500, `2,000 tasks listed in ${Math.round(ms)} ms`);
  const row = all.data.tasks.find((t) => t.id === 'tsk_77');
  assert.equal(row.comments, 1);
  assert.equal(row.subtasks.total, 1);
  assert.equal(row.section, null, 'tasks with no real section row read null');
  const open = await call(w, DAN, 'GET', 'tasks?project=MKT');
  assert.equal(open.data.total, 1600);
  assert.equal(open.data.tasks.length, 1600, 'a project list is not cut at the default page of an unscoped query');
  const mine = await call(w, VIC, 'GET', 'tasks?owner=me&limit=50');
  assert.equal(mine.data.tasks.length, 50);
  assert.equal(mine.data.total > 50, true);
  const month = await call(w, DAN, 'GET', 'tasks?project=MKT&status=all&from=2026-10-01&to=2026-10-02&limit=5000');
  assert.ok(month.data.total > 0 && month.data.total < 2000);
  const proj = await call(w, DAN, 'GET', 'projects');
  assert.equal(proj.data.projects[0].open + proj.data.projects[0].done, 2000);
  assert.equal((await call(w, DAN, 'GET', 'tasks?q=Task 19&limit=5000')).data.tasks.length > 0, true);
  const unscoped = await call(w, ADA, 'GET', 'tasks?status=all&limit=5000');
  assert.equal(unscoped.data.tasks.length, 500, 'a list across projects is capped at 500 a page; page with offset');
  assert.equal(unscoped.data.total, 2000);
});
