// Projects: who may use them, projects, sections, members and the rules around them. Made-up people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADA, AGENT, DAN, FLO, OZZY, VIC, call, read, seedProject, seedTask, world } from './projects-support.mjs';

test('the mode setting: admins by default, then all staff, then nobody', async () => {
  const w = world({ mode: null });
  assert.equal((await call(w, VIC, 'GET', 'projects')).status, 403, 'staff wait while the default is admins');
  assert.equal((await call(w, ADA, 'GET', 'projects')).status, 200);
  w.set('projects.enabled', 'staff');
  assert.equal((await call(w, VIC, 'GET', 'projects')).status, 200);
  w.d1.db.prepare(`UPDATE hub_settings SET value = 'off' WHERE key = 'projects.enabled'`).run();
  const off = await call(w, ADA, 'GET', 'projects');
  assert.equal(off.status, 403);
  assert.equal(off.data.ok, false);
  assert.match(off.data.message, /switched off/);
});

test('no sign-in is a 401; tables that are not applied yet answer 503', async () => {
  const w = world();
  const r = await call(w, null, 'GET', 'projects');
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'signin');
  const bare = world({ tables: false });
  const n = await call(bare, ADA, 'GET', 'tasks');
  assert.equal(n.status, 503);
  assert.equal(n.data.error, 'not_ready');
});

test('make a project: key from the name, lead and maker are members, task codes count from 1', async () => {
  const w = world();
  const r = await call(w, VIC, 'POST', 'projects', { name: 'Grant calendar', members: [DAN.email, 'stranger@favorintl.org'] });
  assert.equal(r.status, 201);
  assert.equal(r.data.project.key, 'GC');
  assert.equal(r.data.project.lead_email, VIC.email);
  assert.equal(r.data.project.lead.name, VIC.name);
  assert.equal(r.data.project.visibility, 'staff');
  const members = w.rows('SELECT email, role FROM hub_project_members ORDER BY email');
  assert.deepEqual(members.map((m) => m.email), [DAN.email, VIC.email], 'a name not on the staff list is not added');
  assert.equal(members.find((m) => m.email === VIC.email).role, 'lead');
  const a = await call(w, VIC, 'POST', 'tasks', { title: 'First', project_id: 'GC' });
  const b = await call(w, VIC, 'POST', 'tasks', { title: 'Second', project_id: r.data.project.id });
  assert.equal(a.data.task.code, 'GC-0001');
  assert.equal(b.data.task.code, 'GC-0002');
});

test('keys: capital letters, 2 to 5, unique; a name with no free initials still gets one', async () => {
  const w = world();
  await seedProject(w);
  assert.equal((await call(w, ADA, 'POST', 'projects', { name: 'Second', key: 'MKT' })).status, 409);
  assert.equal((await call(w, ADA, 'POST', 'projects', { name: 'Second', key: 'm' })).data.error, 'bad_key');
  assert.equal((await call(w, ADA, 'POST', 'projects', { name: 'Second', key: 'TOOLONG' })).data.error, 'bad_key');
  const lower = await call(w, ADA, 'POST', 'projects', { name: 'Lowercase key', key: 'abc' });
  assert.equal(lower.status, 201, 'a lowercase key is stored in capitals');
  assert.equal(lower.data.project.key, 'ABC');
  const auto = await call(w, ADA, 'POST', 'projects', { name: 'Mail Kit Tests' });
  assert.equal(auto.status, 201);
  assert.match(auto.data.project.key, /^[A-Z]{2,5}$/);
  const a2 = await call(w, ADA, 'POST', 'projects', { name: 'Mail Kit Tests' });
  assert.notEqual(a2.data.project.key, auto.data.project.key, 'a taken key moves on');
  assert.equal((await call(w, ADA, 'POST', 'projects', { name: '' })).status, 400);
});

test('who sees a project: staff projects everyone, members-only projects members, leads and admins', async () => {
  const w = world();
  await seedProject(w);
  await seedProject(w, { name: 'Leadership notes', key: 'LDR', visibility: 'members', lead_email: FLO.email, members: [] });
  const ids = async (u) => (await call(w, u, 'GET', 'projects')).data.projects.map((p) => p.key).sort();
  assert.deepEqual(await ids(VIC), ['MKT']);
  assert.deepEqual(await ids(FLO), ['LDR', 'MKT']);
  assert.deepEqual(await ids(ADA), ['LDR', 'MKT']);
  assert.equal((await call(w, VIC, 'GET', 'projects/LDR')).status, 403);
  assert.equal((await call(w, FLO, 'GET', 'projects/LDR')).status, 200);
  assert.equal((await call(w, ADA, 'GET', 'projects/LDR')).status, 200);
  assert.equal((await call(w, VIC, 'GET', 'projects/NOPE')).status, 404);
  const r = await call(w, OZZY, 'GET', 'projects/MKT');
  assert.equal(r.status, 200, 'a staff project opens for anyone');
  assert.equal(r.data.can.edit, false);
  assert.equal(r.data.can.manage, false);
});

test('project detail: sections in order, members with names, counts', async () => {
  const w = world();
  await seedProject(w);
  await call(w, ADA, 'POST', 'projects/MKT/sections', { name: 'Planning' });
  await call(w, ADA, 'POST', 'projects/MKT/sections', { name: 'Writing' });
  const t = await seedTask(w, ADA, { due_date: '2020-01-01' });
  await seedTask(w, ADA, { title: 'Other' });
  await call(w, ADA, 'PATCH', `tasks/${t.id}`, { done: true });
  await seedTask(w, ADA, { title: 'Late', due_date: '2020-01-02' });
  const r = await call(w, VIC, 'GET', 'projects/mkt');
  assert.equal(r.status, 200, 'the key works in lower case');
  assert.deepEqual(r.data.sections.map((s) => s.name), ['Planning', 'Writing']);
  assert.deepEqual(r.data.members.map((m) => m.email).sort(), [ADA.email, DAN.email, VIC.email]);
  assert.equal(r.data.members.find((m) => m.email === ADA.email).name, 'Ada Admin');
  assert.deepEqual(r.data.counts, { open: 2, done: 1, overdue: 1 });
  assert.equal(r.data.project.open, 2);
});

test('change a project: the lead and admins only; archive; a new lead becomes a member', async () => {
  const w = world();
  await seedProject(w, { lead_email: VIC.email });
  assert.equal((await call(w, DAN, 'PATCH', 'projects/MKT', { name: 'Hijack' })).status, 403, 'a member is not the lead');
  assert.equal((await call(w, OZZY, 'PATCH', 'projects/MKT', { name: 'Hijack' })).status, 403);
  const ok = await call(w, VIC, 'PATCH', 'projects/MKT', { name: 'Fall 2026', color: 'sky', status: 'paused', due_date: '2026-12-31' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.project.name, 'Fall 2026');
  assert.equal(ok.data.project.color, 'sky');
  assert.equal((await call(w, VIC, 'PATCH', 'projects/MKT', { color: 'neon' })).status, 400);
  assert.equal((await call(w, VIC, 'PATCH', 'projects/MKT', { due_date: '31/12/2026' })).data.error, 'bad_date');
  const handoff = await call(w, ADA, 'PATCH', 'projects/MKT', { lead_email: FLO.email });
  assert.equal(handoff.data.project.lead.name, FLO.name);
  const roles = Object.fromEntries(w.rows('SELECT email, role FROM hub_project_members').map((m) => [m.email, m.role]));
  assert.equal(roles[FLO.email], 'lead');
  assert.equal(roles[VIC.email], 'member', 'the old lead stays on as a member');
  const arch = await call(w, FLO, 'PATCH', 'projects/MKT', { archive: true });
  assert.equal(arch.data.project.status, 'archived');
});

test('sections: members add, rename and reorder; deleting one keeps its tasks', async () => {
  const w = world();
  await seedProject(w);
  const s1 = (await call(w, VIC, 'POST', 'projects/MKT/sections', { name: 'Planning' })).data.section;
  const s2 = (await call(w, VIC, 'POST', 'projects/MKT/sections', { name: 'Writing' })).data.section;
  assert.ok(s2.sort > s1.sort);
  assert.equal((await call(w, OZZY, 'POST', 'projects/MKT/sections', { name: 'Nope' })).status, 403);
  assert.equal((await call(w, VIC, 'POST', 'projects/MKT/sections', { name: '  ' })).status, 400);
  const ren = await call(w, VIC, 'PATCH', `projects/MKT/sections/${s2.id}`, { name: 'Drafting', sort: 500 });
  assert.equal(ren.data.section.name, 'Drafting');
  assert.deepEqual((await call(w, VIC, 'GET', 'projects/MKT')).data.sections.map((s) => s.name), ['Drafting', 'Planning']);
  const t = await seedTask(w, VIC, { section_id: s1.id });
  assert.equal(t.section, 'Planning');
  assert.equal((await call(w, VIC, 'DELETE', `projects/MKT/sections/${s1.id}`)).status, 200);
  const after = (await call(w, VIC, 'GET', `tasks/${t.id}`)).data.task;
  assert.equal(after.section_id, null);
  assert.equal(after.status, 'open', 'the task is still there');
  assert.equal((await call(w, VIC, 'DELETE', `projects/MKT/sections/${s1.id}`)).status, 404);
});

test('members: the lead and admins add and remove; the lead cannot be removed; strangers to the staff list are refused', async () => {
  const w = world();
  await seedProject(w);
  const add = await call(w, ADA, 'PUT', 'projects/MKT/members', { add: [OZZY.email] });
  assert.equal(add.status, 200);
  assert.ok(add.data.members.some((m) => m.email === OZZY.email));
  assert.equal((await call(w, VIC, 'PUT', 'projects/MKT/members', { add: [FLO.email] })).status, 403, 'a plain member cannot invite');
  assert.equal((await call(w, ADA, 'PUT', 'projects/MKT/members', { add: ['nobody@favorintl.org'] })).data.error, 'unknown_person');
  assert.equal((await call(w, ADA, 'PUT', 'projects/MKT/members', { remove: [ADA.email] })).status, 409);
  const rm = await call(w, ADA, 'PUT', 'projects/MKT/members', { remove: [OZZY.email] });
  assert.ok(!rm.data.members.some((m) => m.email === OZZY.email));
  // Taken off the project, Ozzy can still read it (staff project) but not add tasks.
  assert.equal((await call(w, OZZY, 'POST', 'tasks', { title: 'x', project_id: 'MKT' })).status, 403);
});

test('the agent key acts as an admin; with X-Act-As it acts as that staff member', async () => {
  const w = world();
  await seedProject(w, { visibility: 'members', members: [VIC.email] });
  assert.equal((await call(w, AGENT, 'GET', 'projects/MKT')).status, 200);
  assert.equal((await call(w, AGENT, 'GET', 'projects/MKT', undefined, { 'X-Act-As': OZZY.email })).status, 403, 'acting as Ozzy it is a member-only project');
  assert.equal((await call(w, AGENT, 'GET', 'projects/MKT', undefined, { 'X-Act-As': VIC.email })).status, 200);
});

test('the nav entry, the gate flag, the settings and the page shells are in place', async () => {
  const { AREAS } = await import('../src/data/areas.ts');
  const entry = AREAS.find((a) => a.id === 'projects').pages.find((p) => p.id === 'projects');
  assert.equal(entry.href, '/projects/');
  assert.equal(entry.need, 'projectsNav');
  assert.equal(entry.label, 'Projects');
  const w = world({ mode: 'admins' });
  const { projectsFlag } = await import('../functions/_lib/projects/access.ts');
  assert.equal(await projectsFlag(w.env, ADA), true);
  assert.equal(await projectsFlag(w.env, VIC), false);
  w.d1.db.prepare(`UPDATE hub_settings SET value = 'staff' WHERE key = 'projects.enabled'`).run();
  assert.equal(await projectsFlag(w.env, VIC), true);
  const { readArea } = await import('../functions/_lib/admin/settings.ts');
  const ids = (await readArea(w.env, 'projects')).map((v) => v.id);
  assert.deepEqual(ids, ['projects.enabled', 'projects.marketing_key']);
  for (const f of ['src/pages/projects/index.astro', 'src/pages/projects/p.astro']) {
    const src = read(f);
    assert.match(src, /id="pj-root"/);
    assert.match(src, /src="\/js\/projects\/app\.js"/);
    assert.match(src, /nav="projects"/);
  }
  assert.match(read('functions/api/projects/[[path]].ts'), /path: \['projects'/);
  assert.match(read('functions/api/tasks/[[path]].ts'), /path: \['tasks'/);
});

test('the client wrapper has one function per route and a mock that answers the same shapes', async () => {
  globalThis.location = { search: '?mock=1' };
  const { api } = await import('../public/js/projects/api.js?mock');
  assert.equal(api.mock, true);
  const list = await api.projects();
  assert.equal(list.projects.length, 3);
  const all = await api.tasks({ status: 'all', limit: 1000 });
  assert.ok(all.total >= 60);
  const t = await api.createTask({ title: 'New', project_id: 'MKT' });
  assert.match(t.task.code, /^MKT-\d{4}$/);
  const done = await api.patchTask(t.task.id, { done: true });
  assert.equal(done.task.status, 'done');
  const detail = await api.task(t.task.code);
  assert.equal(detail.task.id, t.task.id);
  assert.equal((await api.codes('appeal', 'fall')).codes[0].code, 'L2610-FALL');
  for (const fn of ['projects', 'project', 'createProject', 'patchProject', 'createSection', 'patchSection', 'deleteSection', 'members', 'tasks', 'task', 'createTask', 'patchTask', 'deleteTask', 'comment', 'patchComment', 'deleteComment', 'addFile', 'deleteFile', 'upload', 'people', 'deps', 'codes', 'notices', 'readNotices', 'directory']) {
    assert.equal(typeof api[fn], 'function', fn);
  }
  delete globalThis.location;
});

test('hooks: every write fires one event for other lanes, and a hook that throws changes nothing', async () => {
  const w = world();
  const { onProjectEvent } = await import('../functions/_lib/projects/hooks.ts');
  const seen = [];
  onProjectEvent((env, ev) => { seen.push(ev.kind + ':' + (ev.task?.code || ev.project?.key)); });
  onProjectEvent(() => { throw new Error('a broken hook'); });
  await seedProject(w);
  const t = await seedTask(w, ADA);
  await call(w, ADA, 'PATCH', `tasks/${t.id}`, { due_date: '2026-11-01' });
  await call(w, ADA, 'PATCH', `tasks/${t.id}`, { done: true });
  await call(w, ADA, 'POST', `tasks/${t.id}/comments`, { body: 'hello' });
  assert.deepEqual(seen, ['project.created:MKT', 'task.created:MKT-0001', 'task.updated:MKT-0001', 'task.done:MKT-0001', 'task.comment:MKT-0001']);
});
