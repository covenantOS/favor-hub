// Projects: the task list's pagination, filters and counts, and saved views. Made-up people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADA, DAN, VIC, call, read, seedProject, seedTask, world } from './projects-support.mjs';

async function setup() {
  const w = world();
  w.d1.exec(read('db/projects-views.sql'));
  await seedProject(w);
  return w;
}

test('paging: limit, offset, total, has_more, next_offset', async () => {
  const w = await setup();
  for (let i = 0; i < 7; i++) await seedTask(w, VIC, { title: 'Task ' + i });
  const a = await call(w, VIC, 'GET', 'tasks?project=MKT&limit=3');
  assert.equal(a.data.tasks.length, 3);
  assert.equal(a.data.total, 7);
  assert.equal(a.data.has_more, true);
  assert.equal(a.data.next_offset, 3);
  const c = await call(w, VIC, 'GET', 'tasks?project=MKT&limit=3&offset=6');
  assert.equal(c.data.tasks.length, 1);
  assert.equal(c.data.has_more, false);
  assert.equal(c.data.next_offset, null);
  assert.equal(c.data.counts, undefined, 'counts only come with the first page');
  assert.equal(a.data.counts.open, 7);
});

test('filters: owner none, section, code, priority, due, doing', async () => {
  const w = await setup();
  const sec = (await call(w, ADA, 'POST', 'projects/MKT/sections', { name: 'Draft' })).data.section;
  const mine = await seedTask(w, VIC, { title: 'A', owner_email: DAN.email, section_id: sec.id, appeal_code: 'L2610', priority: 'high', due_date: '2020-01-01' });
  await seedTask(w, VIC, { title: 'B' });
  const done = await seedTask(w, VIC, { title: 'C', owner_email: DAN.email });
  await call(w, VIC, 'PATCH', `tasks/${done.id}`, { done: true });
  const n = async (qs) => (await call(w, VIC, 'GET', 'tasks?project=MKT&status=all&' + qs)).data.tasks.map((t) => t.title).sort().join('');
  assert.equal(await n('owner=none'), 'B');
  assert.equal(await n('section=' + sec.id), 'A');
  assert.equal(await n('section=none'), 'BC');
  assert.equal(await n('code=l2610'), 'A');
  assert.equal(await n('priority=high'), 'A');
  assert.equal(await n('due=overdue'), 'A');
  assert.equal(await n('due=none'), 'BC');
  await call(w, VIC, 'PATCH', `tasks/${mine.id}`, { status: 'doing' });
  assert.equal((await call(w, VIC, 'GET', 'tasks?project=MKT&status=doing')).data.tasks.length, 1);
  const open = await call(w, VIC, 'GET', 'tasks?project=MKT');
  assert.equal(open.data.total, 2, 'open hides completed');
  assert.deepEqual(open.data.counts.by_section[''], { open: 1, done: 1 });
  assert.deepEqual(open.data.counts.by_section[sec.id], { open: 1, done: 0 });
});

test('saved views are per person and per project', async () => {
  const w = await setup();
  const q = { q: 'letter', owner: 'me', due: 'week', junk: 'x' };
  const made = await call(w, VIC, 'POST', 'tasks/views', { name: 'My letters', project_id: 'MKT', query: q });
  assert.equal(made.status, 201);
  assert.deepEqual(made.data.view.query, { q: 'letter', owner: 'me', due: 'week' });
  const again = await call(w, VIC, 'POST', 'tasks/views', { name: 'My letters', project_id: 'MKT', query: { due: 'today' } });
  assert.equal(again.data.view.id, made.data.view.id, 'same name updates');
  assert.equal((await call(w, VIC, 'GET', 'tasks/views?project=MKT')).data.views.length, 1);
  assert.equal((await call(w, DAN, 'GET', 'tasks/views?project=MKT')).data.views.length, 0);
  assert.equal((await call(w, VIC, 'GET', 'tasks/views')).data.views.length, 0, 'My tasks has its own');
  assert.equal((await call(w, DAN, 'DELETE', `tasks/views/${made.data.view.id}`)).status, 404);
  assert.equal((await call(w, VIC, 'DELETE', `tasks/views/${made.data.view.id}`)).status, 200);
});
