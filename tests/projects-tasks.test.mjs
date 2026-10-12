// Projects: tasks. Create, list, change, move, subtasks, delete, and who may do each. Made-up people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADA, DAN, FLO, OZZY, VIC, call, seedProject, seedTask, world } from './projects-support.mjs';

async function setup() {
  const w = world();
  await seedProject(w);
  return w;
}

test('a task in a project: code, order, defaults, shape', async () => {
  const w = await setup();
  const a = await seedTask(w, VIC, { title: 'Draft the fall letter', owner_email: DAN.email, due_date: '2026-10-20', priority: 'high', appeal_code: 'L2610-FALL' });
  assert.equal(a.code, 'MKT-0001');
  assert.equal(a.owner.name, DAN.name);
  assert.deepEqual(a.project, { id: a.project_id, key: 'MKT', name: 'Fall campaign', color: 'leaf' });
  assert.equal(a.status, 'open');
  assert.equal(a.priority, 'high');
  assert.equal(a.appeal_code, 'L2610-FALL');
  assert.deepEqual(a.subtasks, { done: 0, total: 0 });
  assert.equal(a.comments, 0);
  assert.equal(a.files, 0);
  assert.equal(a.overdue, false);
  assert.equal(a.blocked, false);
  assert.equal(a.created_by, VIC.email);
  const b = await seedTask(w, VIC, { title: 'Second' });
  assert.equal(b.code, 'MKT-0002');
  assert.ok(b.sort > a.sort, 'new tasks go to the end');
  assert.equal(b.owner, null, 'a project task starts unassigned');
});

test('a personal task has no project, no code, and the maker owns it', async () => {
  const w = await setup();
  const r = await call(w, OZZY, 'POST', 'tasks', { title: 'Renew parking pass', due_date: '2026-10-14' });
  assert.equal(r.status, 201);
  assert.equal(r.data.task.project, null);
  assert.equal(r.data.task.code, null);
  assert.equal(r.data.task.owner_email, OZZY.email);
  assert.equal((await call(w, VIC, 'GET', `tasks/${r.data.task.id}`)).status, 404, 'nobody else sees it');
  assert.equal((await call(w, ADA, 'GET', `tasks/${r.data.task.id}`)).status, 200, 'an admin does');
  const mine = await call(w, OZZY, 'GET', 'tasks?owner=me');
  assert.equal(mine.data.total, 1);
});

test('create rules: a title, real dates, a section of this project, only members', async () => {
  const w = await setup();
  const post = (b, u = VIC) => call(w, u, 'POST', 'tasks', { project_id: 'MKT', ...b });
  assert.equal((await post({ title: '   ' })).status, 400);
  assert.equal((await post({ title: 'x', due_date: 'tomorrow' })).data.error, 'bad_date');
  assert.equal((await post({ title: 'x', due_time: '25:00' })).data.error, 'bad_time');
  assert.equal((await post({ title: 'x', start_date: '2026-10-20', due_date: '2026-10-10' })).data.error, 'bad_dates');
  assert.equal((await post({ title: 'x', priority: 'urgent' })).data.error, 'bad_value');
  assert.equal((await post({ title: 'x', section_id: 'sec_nope' })).data.error, 'bad_section');
  assert.equal((await post({ title: 'x', owner_email: 'ghost@favorintl.org' })).data.error, 'unknown_person');
  assert.equal((await post({ title: 'x', owner_email: 'vic@gmail.com' })).data.error, 'bad_email');
  assert.equal((await post({ title: 'x' }, OZZY)).status, 403, 'not on the project');
  assert.equal((await post({ title: 'x', project_id: 'NOPE' })).status, 404);
  const long = 'L'.repeat(500);
  assert.equal((await post({ title: long })).data.task.title.length, 300, 'a long title is cut, not refused');
  assert.equal(w.rows('SELECT COUNT(*) AS n FROM hub_tasks')[0].n, 1, 'refused tasks leave nothing behind');
});

test('the same request, meeting action item or Chat message never makes a second task', async () => {
  const w = await setup();
  const a = await call(w, VIC, 'POST', 'tasks', { title: 'From a meeting', project_id: 'MKT', meeting_id: 'mtg_1', meeting_action_idx: 2 });
  const b = await call(w, VIC, 'POST', 'tasks', { title: 'From a meeting again', project_id: 'MKT', meeting_id: 'mtg_1', meeting_action_idx: 2 });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.data.existing, true);
  assert.equal(b.data.task.id, a.data.task.id);
  const c = await call(w, VIC, 'POST', 'tasks', { title: 'Other action', project_id: 'MKT', meeting_id: 'mtg_1', meeting_action_idx: 3 });
  assert.notEqual(c.data.task.id, a.data.task.id);
  const m1 = await call(w, VIC, 'POST', 'tasks', { title: 'From chat', chat_message_id: '77' });
  const m2 = await call(w, VIC, 'POST', 'tasks', { title: 'From chat', chat_message_id: '77' });
  assert.equal(m2.data.task.id, m1.data.task.id);
  const r1 = await call(w, VIC, 'POST', 'tasks', { title: 'From a request', request_id: 'req_1' });
  const r2 = await call(w, VIC, 'POST', 'tasks', { title: 'From a request', request_id: 'req_1' });
  assert.equal(r2.data.task.id, r1.data.task.id);
});

test('fetch by id or by code; a task nobody may see is not found', async () => {
  const w = await setup();
  const t = await seedTask(w, VIC, { description: 'Long text '.repeat(10) });
  const byId = await call(w, DAN, 'GET', `tasks/${t.id}`);
  const byCode = await call(w, DAN, 'GET', 'tasks/mkt-0001');
  assert.equal(byId.status, 200);
  assert.equal(byCode.data.task.id, t.id);
  for (const k of ['task', 'subtasks', 'comments', 'files', 'events', 'deps', 'people', 'told']) assert.ok(k in byId.data, k);
  assert.deepEqual(byId.data.deps, { blockedBy: [], blocks: [] });
  assert.equal(byId.data.events[0].kind, 'created');
  assert.equal((await call(w, DAN, 'GET', 'tasks/MKT-9999')).status, 404);
  // A members-only project hides its tasks from people who are not on it.
  await seedProject(w, { name: 'Private', key: 'PRV', visibility: 'members', members: [VIC.email] });
  const p = await call(w, VIC, 'POST', 'tasks', { title: 'Secret', project_id: 'PRV' });
  assert.equal((await call(w, DAN, 'GET', `tasks/${p.data.task.id}`)).status, 404);
  assert.equal((await call(w, DAN, 'GET', 'tasks?project=PRV')).status, 403);
  assert.equal((await call(w, DAN, 'GET', 'tasks?status=all&limit=500')).data.tasks.some((x) => x.code === 'PRV-0001'), false, 'not in a wide list either');
});

test('the task page of a person named on a task in a private project: owners, collaborators, followers and the mentioned still see it', async () => {
  const w = await setup();
  await seedProject(w, { name: 'Private', key: 'PRV', visibility: 'members', members: [VIC.email] });
  const t = (await call(w, VIC, 'POST', 'tasks', { title: 'Secret', project_id: 'PRV', owner_email: DAN.email })).data.task;
  assert.equal((await call(w, DAN, 'GET', `tasks/${t.id}`)).status, 200, 'the owner');
  assert.equal((await call(w, OZZY, 'GET', `tasks/${t.id}`)).status, 404);
  await call(w, VIC, 'PUT', `tasks/${t.id}/people`, { add: [{ email: OZZY.email, role: 'follower' }] });
  assert.equal((await call(w, OZZY, 'GET', `tasks/${t.id}`)).status, 200, 'a follower');
  const mine = await call(w, OZZY, 'GET', 'tasks?status=all');
  assert.ok(mine.data.tasks.some((x) => x.id === t.id), 'and it lists for them');
  const edit = await call(w, OZZY, 'PATCH', `tasks/${t.id}`, { title: 'Changed' });
  assert.equal(edit.status, 403, 'a follower reads and comments but does not edit');
  const own = await call(w, DAN, 'PATCH', `tasks/${t.id}`, { title: 'Changed by the owner' });
  assert.equal(own.status, 200, 'the owner edits even without being a member');
});

test('list filters: project, owner, status, text, parent, and the totals', async () => {
  const w = await setup();
  const a = await seedTask(w, VIC, { title: 'Draft the letter', owner_email: VIC.email });
  await seedTask(w, VIC, { title: 'Pick the photo', owner_email: DAN.email });
  const c = await seedTask(w, VIC, { title: 'Book the printer', owner_email: VIC.email });
  await call(w, VIC, 'PATCH', `tasks/${c.id}`, { done: true });
  await seedTask(w, VIC, { title: 'A subtask', parent_id: a.id });
  const list = async (qs, u = VIC) => (await call(w, u, 'GET', 'tasks' + qs)).data;
  assert.equal((await list('?project=MKT')).total, 2, 'open top-level tasks by default');
  assert.equal((await list('?project=MKT&status=all')).total, 3);
  assert.equal((await list('?project=MKT&status=done')).tasks[0].code, 'MKT-0003');
  assert.equal((await list('?owner=me')).total, 1, 'my open tasks, subtasks included');
  assert.equal((await list(`?owner=${DAN.email}`)).total, 1);
  assert.equal((await list('?project=MKT&q=photo')).tasks[0].title, 'Pick the photo');
  assert.equal((await list('?project=MKT&q=mkt-0001')).total, 1, 'a code finds it');
  assert.equal((await list('?project=MKT&q=100%25')).total, 0, 'a percent sign is text, not a wildcard');
  assert.equal((await list(`?parent=${a.id}`)).tasks[0].title, 'A subtask');
  assert.equal((await list('?project=MKT&parent=any&status=all')).total, 4);
  const page = await list('?project=MKT&status=all&limit=2&offset=2');
  assert.equal(page.tasks.length, 1);
  assert.equal(page.total, 3);
  assert.equal((await list('?project=MKT&status=all')).tasks.find((t) => t.id === a.id).subtasks.total, 1);
});

test('date range: a task shows when its start-to-due span touches the window', async () => {
  const w = await setup();
  await seedTask(w, VIC, { title: 'Span', start_date: '2026-10-05', due_date: '2026-10-20' });
  await seedTask(w, VIC, { title: 'Due only', due_date: '2026-10-12' });
  await seedTask(w, VIC, { title: 'Start only', start_date: '2026-10-15' });
  await seedTask(w, VIC, { title: 'Later', due_date: '2026-12-01' });
  await seedTask(w, VIC, { title: 'No dates' });
  const titles = async (qs) => (await call(w, VIC, 'GET', 'tasks?project=MKT' + qs)).data.tasks.map((t) => t.title).sort();
  assert.deepEqual(await titles('&from=2026-10-10&to=2026-10-14'), ['Due only', 'Span']);
  assert.deepEqual(await titles('&from=2026-10-15&to=2026-10-31'), ['Span', 'Start only']);
  assert.deepEqual(await titles('&from=2026-11-15'), ['Later']);
  assert.equal((await call(w, VIC, 'GET', 'tasks?from=nope')).data.error, 'bad_date');
});

test('overdue and blocked flags, and the counts on the project list', async () => {
  const w = await setup();
  const late = await seedTask(w, VIC, { title: 'Late', due_date: '2020-03-01', owner_email: VIC.email });
  const next = await seedTask(w, VIC, { title: 'Next' });
  await call(w, VIC, 'PUT', `tasks/${next.id}/deps`, { add: [late.id] });
  const list = (await call(w, VIC, 'GET', 'tasks?project=MKT')).data.tasks;
  assert.equal(list.find((t) => t.id === late.id).overdue, true);
  assert.equal(list.find((t) => t.id === next.id).blocked, true);
  await call(w, VIC, 'PATCH', `tasks/${late.id}`, { done: true });
  const after = (await call(w, VIC, 'GET', 'tasks?project=MKT')).data.tasks;
  assert.equal(after.find((t) => t.id === next.id).blocked, false, 'finishing the first task frees the second');
  assert.equal(after.some((t) => t.id === late.id), false);
  const proj = (await call(w, VIC, 'GET', 'projects')).data;
  assert.equal(proj.projects[0].open, 1);
  assert.equal(proj.projects[0].done, 1);
  assert.deepEqual(proj.mine, { open: 0, overdue: 0, dueToday: 0 });
});

test('change a task: fields, history, and who may', async () => {
  const w = await setup();
  const t = await seedTask(w, VIC);
  const r = await call(w, DAN, 'PATCH', `tasks/${t.id}`, { title: 'Write the fall letter', description: 'Two pages.', priority: 'low', owner_email: DAN.email, start_date: '2026-10-12', due_date: '2026-10-19', due_time: '14:30', fund_code: 'GEN', campaign_code: 'C2610', source_code: 'WEB-GIVE', appeal_code: 'L2610-FALL' });
  assert.equal(r.status, 200);
  const x = r.data.task;
  assert.equal(x.title, 'Write the fall letter');
  assert.equal(x.owner.name, DAN.name);
  assert.equal(x.due_time, '14:30');
  assert.equal(x.fund_code, 'GEN');
  const d = (await call(w, DAN, 'GET', `tasks/${t.id}`)).data;
  const ev = d.events.find((e) => e.kind === 'updated');
  assert.ok(ev.detail.fields.includes('title'));
  assert.equal(ev.detail.from.owner_email, null);
  assert.equal(ev.detail.to.owner_email, DAN.email);
  assert.equal(ev.actor.name, DAN.name);
  assert.equal((await call(w, OZZY, 'PATCH', `tasks/${t.id}`, { title: 'No' })).status, 403, 'outside the project');
  assert.equal((await call(w, DAN, 'PATCH', `tasks/${t.id}`, { priority: 'urgent' })).status, 400);
  assert.equal((await call(w, DAN, 'PATCH', `tasks/${t.id}`, { due_date: '2026-10-01' })).data.error, 'bad_dates', 'due before the start');
  const clear = await call(w, DAN, 'PATCH', `tasks/${t.id}`, { owner_email: null, due_date: null, start_date: '', appeal_code: '' });
  assert.equal(clear.data.task.owner, null);
  assert.equal(clear.data.task.due_date, null);
  assert.equal(clear.data.task.appeal_code, null);
  const same = await call(w, DAN, 'PATCH', `tasks/${t.id}`, { title: 'Write the fall letter' });
  assert.equal(same.status, 200, 'saving with no change is fine');
  assert.equal(w.rows(`SELECT COUNT(*) AS n FROM hub_task_events WHERE task_id = ? AND kind = 'updated'`, t.id)[0].n, 2, 'and writes no history');
});

test('done, reopened, and the waiting rules', async () => {
  const w = await setup();
  const t = await seedTask(w, VIC, { owner_email: VIC.email });
  const other = await seedTask(w, VIC, { title: 'Other' });
  const done = await call(w, VIC, 'PATCH', `tasks/${t.id}`, { done: true });
  assert.equal(done.data.task.status, 'done');
  assert.equal(done.data.task.done_by, VIC.email);
  assert.ok(done.data.task.done_at);
  const open = await call(w, VIC, 'PATCH', `tasks/${t.id}`, { done: false });
  assert.equal(open.data.task.status, 'open');
  assert.equal(open.data.task.done_at, null);
  assert.deepEqual((await call(w, VIC, 'GET', `tasks/${t.id}`)).data.events.map((e) => e.kind).filter((k) => k !== 'created'), ['reopened', 'done']);
  const wait = await call(w, VIC, 'PATCH', `tasks/${t.id}`, { waiting_on_email: DAN.email });
  assert.equal(wait.data.task.status, 'waiting');
  const free = await call(w, VIC, 'PATCH', `tasks/${t.id}`, { waiting_on_email: null });
  assert.equal(free.data.task.status, 'open', 'clearing it frees the task');
  const onTask = await call(w, VIC, 'PATCH', `tasks/${t.id}`, { waiting_on_task: other.code });
  assert.equal(onTask.data.task.status, 'waiting');
  assert.equal(onTask.data.task.waiting_on_task, other.id);
  assert.equal((await call(w, VIC, 'PATCH', `tasks/${t.id}`, { waiting_on_task: t.id })).status, 400);
  const doing = await call(w, VIC, 'PATCH', `tasks/${t.id}`, { status: 'doing' });
  assert.equal(doing.data.task.status, 'doing');
  assert.equal(doing.data.task.waiting_on_task, null, 'leaving waiting clears what it waited on');
  assert.equal((await call(w, VIC, 'PATCH', `tasks/${t.id}`, { status: 'stuck' })).status, 400);
});

test('move: between sections and before or after a neighbour, with order kept', async () => {
  const w = await setup();
  const s1 = (await call(w, VIC, 'POST', 'projects/MKT/sections', { name: 'One' })).data.section;
  const s2 = (await call(w, VIC, 'POST', 'projects/MKT/sections', { name: 'Two' })).data.section;
  const a = await seedTask(w, VIC, { title: 'A', section_id: s1.id });
  const b = await seedTask(w, VIC, { title: 'B', section_id: s1.id });
  const c = await seedTask(w, VIC, { title: 'C', section_id: s1.id });
  const order = async (sid) => (await call(w, VIC, 'GET', 'tasks?project=MKT')).data.tasks.filter((t) => t.section_id === sid).sort((x, y) => x.sort - y.sort).map((t) => t.title);
  assert.deepEqual(await order(s1.id), ['A', 'B', 'C']);
  await call(w, VIC, 'PATCH', `tasks/${c.id}`, { move: { section_id: s1.id, before: a.id } });
  assert.deepEqual(await order(s1.id), ['C', 'A', 'B']);
  await call(w, VIC, 'PATCH', `tasks/${c.id}`, { move: { section_id: s1.id, after: a.id } });
  assert.deepEqual(await order(s1.id), ['A', 'C', 'B']);
  const to2 = await call(w, VIC, 'PATCH', `tasks/${a.id}`, { move: { section_id: s2.id } });
  assert.equal(to2.data.task.section, 'Two');
  assert.deepEqual(await order(s1.id), ['C', 'B']);
  assert.deepEqual(await order(s2.id), ['A']);
  await call(w, VIC, 'PATCH', `tasks/${b.id}`, { move: { section_id: s2.id, before: a.id } });
  assert.deepEqual(await order(s2.id), ['B', 'A']);
  assert.equal((await call(w, VIC, 'PATCH', `tasks/${c.id}`, { move: { section_id: s2.id, before: c.id } })).status, 400, 'a neighbour must sit in the target section');
  assert.equal((await call(w, VIC, 'PATCH', `tasks/${c.id}`, { move: { section_id: 'sec_nope' } })).data.error, 'bad_section');
  const none = await call(w, VIC, 'PATCH', `tasks/${b.id}`, { move: { section_id: null } });
  assert.equal(none.data.task.section, null);
});

test('repeated drops between the same two cards keep the order and renumber when the gap closes', async () => {
  const w = await setup();
  const a = await seedTask(w, VIC, { title: 'A' });
  const z = await seedTask(w, VIC, { title: 'Z' });
  const made = [];
  for (let i = 0; i < 45; i++) {
    const t = await seedTask(w, VIC, { title: 'm' + i });
    made.push(t);
    await call(w, VIC, 'PATCH', `tasks/${t.id}`, { move: { section_id: null, after: a.id } });
  }
  const list = (await call(w, VIC, 'GET', 'tasks?project=MKT&limit=500')).data.tasks;
  const titles = list.map((t) => t.title);
  assert.equal(titles[0], 'A');
  assert.equal(titles[titles.length - 1], 'Z');
  assert.equal(titles[1], 'm44', 'the last one dropped sits right after A');
  assert.equal(new Set(list.map((t) => t.sort)).size, list.length, 'no two share a place');
  void z;
});

test('subtasks: same project, shown under the task, cannot loop, go along when a task changes project', async () => {
  const w = await setup();
  await seedProject(w, { name: 'Grants', key: 'GRT' });
  const parent = await seedTask(w, VIC, { title: 'Parent' });
  const kid = await seedTask(w, VIC, { title: 'Kid', parent_id: parent.id });
  assert.equal(kid.project_id, parent.project_id, 'a subtask joins its task\'s project');
  assert.equal(kid.code, 'MKT-0002');
  const grandkid = await seedTask(w, VIC, { title: 'Grandkid', parent_id: kid.id });
  const detail = (await call(w, VIC, 'GET', `tasks/${parent.id}`)).data;
  assert.deepEqual(detail.subtasks.map((s) => s.title), ['Kid']);
  assert.equal(detail.task.subtasks.total, 1);
  assert.equal((await call(w, VIC, 'PATCH', `tasks/${parent.id}`, { parent_id: grandkid.id })).data.error, 'bad_parent', 'no loops');
  assert.equal((await call(w, VIC, 'PATCH', `tasks/${parent.id}`, { parent_id: parent.id })).data.error, 'bad_parent');
  assert.equal((await call(w, VIC, 'POST', 'tasks', { title: 'x', project_id: 'GRT', parent_id: parent.id })).data.error, 'bad_parent');
  const moved = await call(w, ADA, 'PATCH', `tasks/${parent.id}`, { project_id: 'GRT' });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.task.code, 'GRT-0001');
  assert.equal(moved.data.task.project.key, 'GRT');
  const k = (await call(w, ADA, 'GET', `tasks/${kid.id}`)).data.task;
  assert.equal(k.project.key, 'GRT');
  assert.match(k.code, /^GRT-000[23]$/);
  assert.equal((await call(w, ADA, 'GET', `tasks/${grandkid.id}`)).data.task.project.key, 'GRT');
  assert.equal((await call(w, ADA, 'PATCH', `tasks/${kid.id}`, { project_id: 'MKT' })).data.error, 'bad_parent', 'move the main task, not its subtask');
  // Back to no project: personal, no code.
  const personal = await call(w, ADA, 'PATCH', `tasks/${parent.id}`, { project_id: null });
  assert.equal(personal.data.task.project, null);
  assert.equal(personal.data.task.code, null);
});

test('remove a task: its maker, the lead or an admin; it drops, and an admin can delete for good', async () => {
  const w = await setup();
  const t = await seedTask(w, DAN);
  const kid = await seedTask(w, DAN, { title: 'Kid', parent_id: t.id });
  assert.equal((await call(w, OZZY, 'DELETE', `tasks/${t.id}`)).status, 403, 'a stranger to the project');
  assert.equal((await call(w, VIC, 'DELETE', `tasks/${t.id}`)).status, 403, 'a member who did not make it');
  assert.equal((await call(w, DAN, 'DELETE', `tasks/${t.id}`)).status, 200, 'its maker');
  const gone = (await call(w, DAN, 'GET', 'tasks?project=MKT&status=all&parent=any')).data;
  assert.equal(gone.total, 0, 'dropped tasks and their subtasks leave the lists');
  assert.equal((await call(w, DAN, 'GET', `tasks/${kid.id}`)).data.task.status, 'dropped');
  const t2 = await seedTask(w, DAN, { title: 'Two' });
  assert.equal((await call(w, ADA, 'DELETE', `tasks/${t2.id}`)).status, 200, 'the lead is Ada');
  const t3 = await seedTask(w, DAN, { title: 'Three' });
  await call(w, DAN, 'POST', `tasks/${t3.id}/comments`, { body: 'note' });
  assert.equal((await call(w, DAN, 'DELETE', `tasks/${t3.id}?hard=1`)).status, 403, 'only an admin deletes for good');
  assert.equal((await call(w, ADA, 'DELETE', `tasks/${t3.id}?hard=1`)).data.hard, true);
  assert.equal((await call(w, ADA, 'GET', `tasks/${t3.id}`)).status, 404);
  assert.equal(w.rows('SELECT COUNT(*) AS n FROM hub_task_comments WHERE task_id = ?', t3.id)[0].n, 0, 'its comments go with it');
});

test('a task due today and one due earlier show in My tasks counts, in Eastern time', async () => {
  const w = await setup();
  const { todayEastern } = await import('../functions/_lib/projects/db.ts');
  const today = todayEastern();
  await seedTask(w, VIC, { title: 'Today', owner_email: VIC.email, due_date: today });
  await seedTask(w, VIC, { title: 'Old', owner_email: VIC.email, due_date: '2020-01-01' });
  await seedTask(w, VIC, { title: 'Later', owner_email: VIC.email, due_date: '2999-01-01' });
  await seedTask(w, VIC, { title: 'Not mine', owner_email: DAN.email, due_date: today });
  const mine = (await call(w, VIC, 'GET', 'projects')).data.mine;
  assert.deepEqual(mine, { open: 3, overdue: 1, dueToday: 1 });
  assert.equal(todayEastern(new Date('2026-11-01T02:30:00Z')), '2026-10-31', 'late evening in Eastern is still the day before in UTC');
});