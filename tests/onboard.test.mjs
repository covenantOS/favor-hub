// Onboarding and offboarding: a run's checklist, owners and due dates, tasks in Projects, the HR file, what FavorOS does on its own
// when an admin confirms, the offboarding run, the template, the first-day page and the morning reminder. Invented people only; the
// live database is never touched (an in-memory D1 built from the repository's own schema files).
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { BOSS, DIRECT, HR, NEWBIE, PLAIN, WILL, call, onboardWorld, rows } from './support/onboard-world.mjs';

const START = { kind: 'onboard', name: 'Nia Newhire', email: 'newt@favorintl.org', title: 'Associate', team: 'Support Team', supervisor_email: BOSS.email, date: '2026-10-19' };

async function begin(w, user = WILL, extra = {}) {
  const r = await call(w, user, 'POST', 'runs', { ...START, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

test('only hub admins and HR start a run; plain staff are refused', async () => {
  const w = onboardWorld();
  assert.equal((await call(w, PLAIN, 'POST', 'runs', START)).status, 403);
  assert.equal((await call(w, HR, 'POST', 'runs', START)).status, 201, 'a person marked HR may');
  assert.equal((await call(w, WILL, 'POST', 'runs', { ...START, email: 'other@favorintl.org', name: 'Otto Other' })).status, 201);
});

test('the checklist: owners by duty, due dates counted from the start date, weekends move off', async () => {
  const w = onboardWorld();
  const { run, steps } = await begin(w);
  assert.equal(run.status, 'active');
  const by = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(by.email.owner_email, HR.email, 'the Favor email is the HR duty');
  assert.equal(by.directory.owner_email, DIRECT.email);
  assert.equal(by.whatsapp.owner_email, DIRECT.email);
  assert.equal(by.blackbaud.owner_email, WILL.email, 'technical access');
  assert.equal(by.trainbb.owner_email, BOSS.email);
  assert.equal(by.welcome.owner_email, BOSS.email, 'the supervisor');
  assert.equal(by.paperwork.owner_email, 'newt@favorintl.org', 'the new hire');
  assert.equal(by.hubadd.owner_email, WILL.email, 'whoever started the run');
  // 2026-10-19 is a Monday. Seven days before is Monday the 12th; two days before is Saturday, so it moves to Friday the 16th.
  assert.equal(by.email.due_date, '2026-10-12');
  assert.equal(by.directory.due_date, '2026-10-16');
  assert.equal(by.welcome.due_date, '2026-10-19');
  assert.equal(by.checkin.due_date, '2026-11-18');
  assert.ok(steps.every((s) => s.status === 'open'));
});

test('every step a person does becomes a task in the Onboarding project, with the owner and due date', async () => {
  const w = onboardWorld();
  const { steps } = await begin(w);
  const proj = rows(w, 'SELECT * FROM hub_projects');
  assert.equal(proj.length, 1);
  assert.equal(proj[0].key, 'ONB');
  const tasks = rows(w, 'SELECT * FROM hub_tasks ORDER BY code');
  assert.equal(tasks.length, steps.length);
  assert.equal(tasks[0].code, 'ONB-0001');
  assert.equal(tasks.at(-1).code, `ONB-${String(steps.length).padStart(4, '0')}`);
  const email = tasks.find((t) => t.title.startsWith('Create the Favor email'));
  assert.equal(email.owner_email, HR.email);
  assert.equal(email.due_date, '2026-10-12');
  assert.match(email.title, /\(Nia Newhire\)/);
  // A second run reuses the project and keeps counting.
  await begin(w, WILL, { email: 'two@favorintl.org', name: 'Tess Two' });
  assert.equal(rows(w, 'SELECT * FROM hub_projects').length, 1);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks')[0].n, steps.length * 2);
});

test('notices and email obey the gate: nothing goes out while requests.notify is off, and the starter gets none', async () => {
  const off = onboardWorld({ notify: 'off' });
  await begin(off);
  assert.equal(rows(off, 'SELECT * FROM hub_task_notices').length, 0);
  assert.equal(off.mail.length, 0);

  const on = onboardWorld({ notify: 'on' });
  await begin(on);
  const to = new Set(rows(on, 'SELECT email FROM hub_task_notices').map((n) => n.email));
  assert.ok(to.has(HR.email) && to.has(DIRECT.email) && to.has(BOSS.email));
  assert.ok(!to.has(WILL.email), 'the person who started the run is not told about their own steps');
  const mailed = on.mail.map((m) => m.to).sort();
  assert.deepEqual(mailed, [HR.email, DIRECT.email, BOSS.email].sort(), 'one email per owner, none to the starter or the new hire');
  assert.match(on.mail[0].subject, /starts October 19/);

  // Testing mode: only the listed address hears anything.
  const only = onboardWorld({ notify: 'off' });
  only.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify.only', ?, 'test', '2026-10-11T12:00:00.000Z')").run(BOSS.email);
  await begin(only);
  assert.deepEqual(only.mail.map((m) => m.to), [BOSS.email]);
});

test('without the Projects tables the run still works, with no tasks', async () => {
  const w = onboardWorld({ projects: false });
  const { steps } = await begin(w);
  assert.ok(steps.length > 10);
  assert.ok(steps.every((s) => s.task_id === null));
  const d = await call(w, WILL, 'GET', `runs/${steps[0].run_id}`);
  assert.equal(d.data.tasks, false);
});

test('a step owner marks their own step; the task follows; a stranger cannot; a task finished in Projects closes the step', async () => {
  const w = onboardWorld();
  const { run, steps } = await begin(w);
  const email = steps.find((s) => s.key === 'email');
  assert.equal((await call(w, PLAIN, 'PATCH', `runs/${run.id}/steps/${email.id}`, { status: 'done' })).status, 403);
  assert.equal((await call(w, DIRECT, 'PATCH', `runs/${run.id}/steps/${email.id}`, { status: 'done' })).status, 403, 'another step owner cannot close it');
  const ok = await call(w, HR, 'PATCH', `runs/${run.id}/steps/${email.id}`, { status: 'done' });
  assert.equal(ok.status, 200);
  assert.equal(rows(w, 'SELECT status, done_by FROM hub_tasks WHERE id = ?', email.task_id)[0].status, 'done');
  assert.equal(ok.data.progress.done, 1);
  // The directory owner finishes the task from Projects; the step follows on the next read.
  const dir = steps.find((s) => s.key === 'directory');
  w.d1.db.prepare(`UPDATE hub_tasks SET status = 'done', done_by = ?, done_at = ? WHERE id = ?`).run(DIRECT.email, '2026-10-12T15:00:00.000Z', dir.task_id);
  const d = await call(w, WILL, 'GET', `runs/${run.id}`);
  const after = d.data.steps.find((s) => s.key === 'directory');
  assert.equal(after.status, 'done');
  assert.equal(after.done_by, DIRECT.email);
  // Reopening puts the task back.
  await call(w, HR, 'PATCH', `runs/${run.id}/steps/${email.id}`, { status: 'open' });
  assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE id = ?', email.task_id)[0].status, 'open');
});

test('HR changes an owner or a date; the task and a notice follow; others cannot', async () => {
  const w = onboardWorld();
  const { run, steps } = await begin(w);
  const s = steps.find((x) => x.key === 'drive');
  assert.equal((await call(w, DIRECT, 'PATCH', `runs/${run.id}/steps/${s.id}`, { owner_email: DIRECT.email })).status, 403);
  const r = await call(w, HR, 'PATCH', `runs/${run.id}/steps/${s.id}`, { owner_email: DIRECT.email, due_date: '2026-10-14' });
  assert.equal(r.status, 200);
  const t = rows(w, 'SELECT owner_email, due_date FROM hub_tasks WHERE id = ?', s.task_id)[0];
  assert.equal(t.owner_email, DIRECT.email);
  assert.equal(t.due_date, '2026-10-14');
  assert.equal((await call(w, HR, 'PATCH', `runs/${run.id}/steps/${s.id}`, { due_date: 'soon' })).status, 400);
});

test('the HR file: documents are marks only, kept by HR, and nothing from a form is stored', async () => {
  const w = onboardWorld();
  const { run } = await begin(w);
  const d = (await call(w, HR, 'GET', `runs/${run.id}`)).data;
  assert.equal(d.docs.length, 16);
  assert.ok(d.docs.every((x) => x.got === false));
  assert.equal((await call(w, PLAIN, 'PUT', `runs/${run.id}/docs/${d.docs[0].key}`, { got: true })).status, 403);
  const r = await call(w, HR, 'PUT', `runs/${run.id}/docs/${d.docs[0].key}`, { got: true });
  assert.equal(r.data.docs[0].got, true);
  assert.equal((await call(w, HR, 'PUT', `runs/${run.id}/docs/nope`, { got: true })).status, 404);
  const cols = rows(w, 'PRAGMA table_info(onb_docs)').map((c) => c.name).sort();
  assert.deepEqual(cols, ['got', 'got_at', 'got_by', 'key', 'label', 'run_id', 'sort'], 'no document content column exists');
});

test('Add to FavorOS: account, staff list, supervisor and start date, Chat, Learn paths with due dates, first-day email', async () => {
  const w = onboardWorld();
  const { run } = await begin(w);
  assert.equal((await call(w, PLAIN, 'POST', `runs/${run.id}/hub`, { action: 'add', confirm: true })).status, 403);
  assert.equal((await call(w, WILL, 'POST', `runs/${run.id}/hub`, { action: 'add' })).status, 400, 'it needs a confirmation');
  const r = await call(w, WILL, 'POST', `runs/${run.id}/hub`, { action: 'add', confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const u = rows(w, 'SELECT * FROM hub_users WHERE email = ?', 'newt@favorintl.org')[0];
  assert.equal(u.role, 'staff');
  assert.equal(u.blocked, 0);
  assert.equal(rows(w, 'SELECT * FROM meet_directory WHERE email = ?', 'newt@favorintl.org')[0].active, 1);
  const rep = rows(w, 'SELECT * FROM hub_reporting WHERE email = ?', 'newt@favorintl.org')[0];
  assert.equal(rep.supervisor_email, BOSS.email);
  assert.equal(rep.start_date, '2026-10-19');
  const asg = rows(w, 'SELECT a.due_date, p.slug FROM learn_assignments a JOIN learn_paths p ON p.id = a.target_id WHERE a.email = ? ORDER BY p.slug', 'newt@favorintl.org');
  assert.deepEqual(asg.map((x) => [x.slug, x.due_date]), [['new-hire-favor', '2026-11-02'], ['new-hire-favoros', '2026-10-26']]);
  assert.ok(r.data.result.items.every((i) => i.state !== 'failed'), JSON.stringify(r.data.result.items));
  const welcome = w.mail.find((m) => m.to === 'newt@favorintl.org');
  assert.ok(welcome, 'the first-day email went to the new hire');
  assert.match(welcome.html, /dash\.favorintl\.org\/welcome\//);
  assert.equal(r.data.run.hub_done, 1);
  assert.equal(r.data.steps.find((s) => s.key === 'hubadd').status, 'done');
  // Again: nothing doubles.
  await call(w, WILL, 'POST', `runs/${run.id}/hub`, { action: 'add', confirm: true, emailWelcome: false });
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM learn_assignments')[0].n, 2);
});

test('Add to FavorOS with email off for staff sends nothing and says so; a missing path is reported, not hidden', async () => {
  const w = onboardWorld({ notify: 'off' });
  w.d1.db.prepare("DELETE FROM learn_paths WHERE slug = 'new-hire-favor'").run();
  const { run } = await begin(w);
  const r = await call(w, WILL, 'POST', `runs/${run.id}/hub`, { action: 'add', confirm: true });
  assert.equal(w.mail.length, 0);
  const items = r.data.result.items;
  assert.equal(items.find((i) => i.what === 'First-day email').state, 'skipped');
  assert.match(items.find((i) => i.what === 'New hire: Favor').note, /not written in Learn/);
  assert.equal(items.find((i) => i.what === 'New hire: FavorOS').state, 'done');
});

test('a finished Learn path closes its step', async () => {
  const w = onboardWorld();
  const { run } = await begin(w);
  await call(w, WILL, 'POST', `runs/${run.id}/hub`, { action: 'add', confirm: true, emailWelcome: false });
  w.d1.db.prepare(`UPDATE learn_assignments SET closed_at = '2026-10-23T12:00:00.000Z', closed_why = 'complete' WHERE target_id = 'p_os'`).run();
  const d = (await call(w, WILL, 'GET', `runs/${run.id}`)).data;
  assert.equal(d.steps.find((s) => s.key === 'ospath').status, 'done');
  assert.equal(d.steps.find((s) => s.key === 'favpath').status, 'open');
});

test('a run closes itself when every step is done or skipped', async () => {
  const w = onboardWorld();
  const { run, steps } = await begin(w);
  for (const s of steps) {
    const r = await call(w, WILL, 'PATCH', `runs/${run.id}/steps/${s.id}`, { status: s.key === 'book' ? 'skipped' : 'done' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const d = (await call(w, WILL, 'GET', `runs/${run.id}`)).data;
  assert.equal(d.run.status, 'done');
  assert.ok(d.run.completed_at);
  assert.equal(rows(w, `SELECT COUNT(*) AS n FROM hub_tasks WHERE status = 'dropped'`)[0].n, 1, 'the skipped step dropped its task');
});

test('one active run per person and kind; bad input is refused with a plain message', async () => {
  const w = onboardWorld();
  await begin(w);
  assert.equal((await call(w, WILL, 'POST', 'runs', START)).status, 409);
  assert.equal((await call(w, WILL, 'POST', 'runs', { ...START, email: 'nia@gmail.com' })).status, 400);
  assert.equal((await call(w, WILL, 'POST', 'runs', { ...START, email: 'x@favorintl.org', date: 'next week' })).status, 400);
  assert.equal((await call(w, WILL, 'POST', 'runs', { ...START, email: 'x@favorintl.org', name: '' })).status, 400);
});

test('the list shows HR everything, the supervisor and step owners their runs, nobody else, never the new hire', async () => {
  const w = onboardWorld();
  await begin(w);
  assert.equal((await call(w, HR, 'GET', '')).data.runs.length, 1);
  assert.equal((await call(w, BOSS, 'GET', '')).data.runs.length, 1);
  assert.equal((await call(w, PLAIN, 'GET', '')).data.runs.length, 0);
  assert.equal((await call(w, PLAIN, 'GET', '')).data.can.manage, false);
  const nobody = { email: 'newt@favorintl.org', name: 'Nia', picture: '', role: 'staff', via: 'google', kpi: true };
  assert.equal((await call(w, nobody, 'GET', '')).data.runs.length, 0, 'the new hire sees the first-day page, not the HR run');
  const run = (await call(w, WILL, 'GET', '')).data.runs[0];
  assert.equal((await call(w, PLAIN, 'GET', `runs/${run.id}`)).status, 403);
});

test('hub_reporting supplies the supervisor when none is picked', async () => {
  const w = onboardWorld();
  w.d1.db.prepare(`INSERT INTO hub_reporting (email, supervisor_email) VALUES ('newt@favorintl.org', ?)`).run(BOSS.email);
  const r = await call(w, WILL, 'POST', 'runs', { ...START, supervisor_email: '' });
  assert.equal(r.data.run.supervisor_email, BOSS.email);
});

test('offboarding: its own list, a volunteer who stays keeps accounts, a person who leaves has every door closed', async () => {
  const w = onboardWorld();
  const leave = { kind: 'offboard', name: 'Nia Newhire', email: NEWBIE.email, supervisor_email: BOSS.email, date: '2026-10-30' };
  w.d1.db.prepare("INSERT INTO hub_sessions (token_hash, email, created_at, expires_at, last_seen) VALUES ('h1', ?, 'a', 'b', 'c')").run(NEWBIE.email);
  w.d1.db.prepare("INSERT INTO hub_google (email, refresh_enc, connected_at) VALUES (?, 'x', 'a')").run(NEWBIE.email);
  w.d1.db.prepare("INSERT INTO learn_assignments (id, email, kind, target_id, assigned_at) VALUES ('a1', ?, 'path', 'p_os', 'a')").run(NEWBIE.email);
  const { data } = await call(w, WILL, 'POST', 'runs', leave).then((r) => ({ data: r.data }));
  const keys = data.steps.map((s) => s.key);
  for (const k of ['exit', 'handover', 'hubclose', 'google', 'blackbaud', 'kpi', 'brain', 'website', 'ghl', 'directory', 'logins', 'files', 'roster']) assert.ok(keys.includes(k), k);
  assert.equal(data.steps.find((s) => s.key === 'blackbaud').owner_email, WILL.email);
  assert.equal(data.steps.find((s) => s.key === 'google').owner_email, HR.email);
  // Closing needs a confirmation and is for HR and admins.
  assert.equal((await call(w, PLAIN, 'POST', `runs/${data.run.id}/hub`, { action: 'close', confirm: true })).status, 403);
  assert.equal((await call(w, WILL, 'POST', `runs/${data.run.id}/hub`, { action: 'close' })).status, 400);
  const r = await call(w, WILL, 'POST', `runs/${data.run.id}/hub`, { action: 'close', confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const u = rows(w, 'SELECT blocked, note FROM hub_users WHERE email = ?', NEWBIE.email)[0];
  assert.equal(u.blocked, 1);
  assert.match(u.note, /Left Favor 2026-10-30/);
  assert.equal(rows(w, 'SELECT * FROM hub_sessions WHERE email = ?', NEWBIE.email).length, 0);
  assert.equal(rows(w, 'SELECT * FROM hub_google WHERE email = ?', NEWBIE.email).length, 0);
  assert.equal(rows(w, 'SELECT active FROM meet_directory WHERE email = ?', NEWBIE.email)[0].active, 0);
  assert.equal(rows(w, 'SELECT closed_why FROM learn_assignments WHERE id = ?', 'a1')[0].closed_why, 'removed');
  // The person disappears from the staff pickers.
  const people = (await call(w, WILL, 'GET', 'people')).data.people;
  assert.ok(!people.some((p) => p.email === NEWBIE.email));
});

test('offboarding refuses your own access, a hub admin from the site settings, and a volunteer who stays', async () => {
  const w = onboardWorld();
  assert.equal((await call(w, WILL, 'POST', 'runs', { kind: 'offboard', name: 'Will', email: WILL.email, date: '2026-10-30' })).status, 400, 'no offboarding of yourself');
  const envAdmin = { kind: 'offboard', name: 'Ada Admin', email: 'ada@favorintl.org', date: '2026-10-30' };
  const a = await call(w, HR, 'POST', 'runs', envAdmin);
  assert.equal(a.status, 201);
  w.env.HUB_ADMINS = 'ada@favorintl.org';
  const refused = await call(w, HR, 'POST', `runs/${a.data.run.id}/hub`, { action: 'close', confirm: true });
  assert.equal(refused.status, 400);
  assert.match(refused.data.message, /hub admin/);
  assert.equal(rows(w, 'SELECT blocked FROM hub_users WHERE email = ?', 'ada@favorintl.org')[0].blocked, 0);
  const v = await call(w, WILL, 'POST', 'runs', { kind: 'offboard', name: 'Vic Volunteer', email: 'vic@favorintl.org', date: '2026-10-30', stays: true });
  assert.equal(v.status, 201);
  assert.ok(!v.data.steps.some((s) => s.key === 'hubclose' || s.key === 'google' || s.key === 'blackbaud'));
  assert.equal((await call(w, WILL, 'POST', `runs/${v.data.run.id}/hub`, { action: 'close', confirm: true })).status, 400);
});

test('hand over: open tasks, request cards and direct reports move to the new owner; the onboarding project is left alone', async () => {
  const w = onboardWorld();
  const now = '2026-10-11T12:00:00.000Z';
  w.d1.db.prepare(`INSERT INTO hub_projects (id, key, name, lead_email, created_by, created_at, updated_at) VALUES ('pm', 'MKT', 'Marketing', ?, ?, ?, ?)`).run(WILL.email, WILL.email, now, now);
  for (const [i, st] of [['t1', 'open'], ['t2', 'doing'], ['t3', 'done']]) w.d1.db.prepare(`INSERT INTO hub_tasks (id, project_id, code, title, status, owner_email, created_by, created_at, updated_at) VALUES (?, 'pm', ?, ?, ?, ?, ?, ?, ?)`).run(i, 'MKT-' + i, 'Task ' + i, st, NEWBIE.email, WILL.email, now, now);
  w.d1.db.prepare(`INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at) VALUES ('rq1', 'Banner', 'x', 'website', 'inbox', 'A', 'a@favorintl.org', 'form', ?, ?)`).run(now, now);
  w.d1.db.prepare(`INSERT INTO request_tasks (request_id, owner_email, updated_at) VALUES ('rq1', ?, ?)`).run(NEWBIE.email, now);
  w.d1.db.prepare(`INSERT INTO hub_reporting (email, supervisor_email) VALUES (?, ?)`).run(PLAIN.email, NEWBIE.email);
  const { data } = await call(w, WILL, 'POST', 'runs', { kind: 'offboard', name: 'Nia Newhire', email: NEWBIE.email, supervisor_email: BOSS.email, date: '2026-10-30' });
  const owned = (await call(w, WILL, 'GET', `runs/${data.run.id}/owned`)).data.owned;
  assert.equal(owned.counts.tasks, 2);
  assert.equal(owned.counts.requests, 1);
  assert.equal(owned.counts.reports, 1);
  assert.equal((await call(w, PLAIN, 'GET', `runs/${data.run.id}/owned`)).status, 403);
  assert.equal((await call(w, WILL, 'POST', `runs/${data.run.id}/handover`, { to: NEWBIE.email })).status, 400, 'not to the person who is leaving');
  const r = await call(w, WILL, 'POST', `runs/${data.run.id}/handover`, { to: BOSS.email });
  assert.deepEqual(r.data.moved, { tasks: 2, requests: 1, reports: 1 });
  assert.equal(rows(w, `SELECT owner_email FROM hub_tasks WHERE id = 't1'`)[0].owner_email, BOSS.email);
  assert.equal(rows(w, `SELECT owner_email FROM hub_tasks WHERE id = 't3'`)[0].owner_email, NEWBIE.email, 'a finished task keeps its owner');
  assert.equal(rows(w, `SELECT supervisor_email FROM hub_reporting WHERE email = ?`, PLAIN.email)[0].supervisor_email, BOSS.email);
  assert.equal(r.data.steps.find((s) => s.key === 'handover').status, 'done');
});

test('the template: HR edits a step, new runs use it, a reset brings the default back; plain staff cannot edit', async () => {
  const w = onboardWorld();
  assert.equal((await call(w, PLAIN, 'GET', 'template?kind=onboard')).status, 403);
  const def = (await call(w, HR, 'GET', 'template?kind=onboard')).data.steps;
  assert.ok(def.length > 15);
  assert.equal(def.find((s) => s.key === 'paycom').edited, false);
  const put = await call(w, HR, 'PUT', 'template', { kind: 'onboard', key: 'paycom', title: 'Set up payroll', offset_days: -3 });
  assert.equal(put.status, 200);
  assert.equal(put.data.steps.find((s) => s.key === 'paycom').title, 'Set up payroll');
  assert.ok(put.data.steps.length >= def.length, 'the first edit copies the whole default list');
  await call(w, HR, 'PUT', 'template', { kind: 'onboard', key: 'book', active: false });
  await call(w, HR, 'PUT', 'template', { kind: 'onboard', title: 'Order the desk chair', duty: 'hr', offset_days: -4, grp: 'before' });
  const { steps } = await begin(w);
  const keys = steps.map((s) => s.key);
  assert.ok(!keys.includes('book'), 'a switched-off step is left out');
  assert.equal(steps.find((s) => s.key === 'paycom').title, 'Set up payroll');
  assert.ok(steps.some((s) => s.title === 'Order the desk chair' && s.owner_email === HR.email));
  assert.equal((await call(w, HR, 'PUT', 'template', { kind: 'onboard', key: 'paycom', duty: 'nobody' })).status, 400);
  const reset = await call(w, HR, 'POST', 'template/reset', { kind: 'onboard' });
  assert.equal(reset.data.steps.find((s) => s.key === 'paycom').title, 'Set up Paycom');
});

test('a person who works remotely gets no door code step; an unset duty falls back to the starter and is flagged', async () => {
  const w = onboardWorld({ owners: false });
  const r = await begin(w, WILL, { hq: false });
  assert.ok(!r.steps.some((s) => s.key === 'equipment'));
  assert.ok(r.unset.includes('hr') && r.unset.includes('tech'));
  assert.equal(r.steps.find((s) => s.key === 'directory').owner_email, WILL.email);
  const d = (await call(w, WILL, 'GET', `runs/${r.run.id}`)).data;
  assert.equal(d.steps.find((s) => s.key === 'directory').fallback, true);
  assert.equal(d.steps.find((s) => s.key === 'welcome').fallback, false);
  const set = await call(w, HR, 'PUT', 'owners', { duty: 'hr', email: HR.email });
  assert.equal(set.data.owners.hr, HR.email);
  assert.equal((await call(w, PLAIN, 'PUT', 'owners', { duty: 'hr', email: PLAIN.email })).status, 403);
  assert.equal((await call(w, HR, 'PUT', 'owners', { duty: 'hr', email: 'x@gmail.com' })).status, 400);
});

test('the first-day page: my steps, my supervisor first, owners by role, teammates, the first week by day', async () => {
  const w = onboardWorld();
  const { run } = await begin(w);
  w.d1.db.prepare(`INSERT OR IGNORE INTO hub_users (email, name, role, created_at, updated_at) VALUES ('newt@favorintl.org', 'Nia Newhire', 'staff', '2026-10-11T12:00:00.000Z', '2026-10-11T12:00:00.000Z')`).run();
  const newt = { email: 'newt@favorintl.org', name: 'Nia Newhire', picture: '', role: 'staff', via: 'google', kpi: true };
  const r = await call(w, newt, 'GET', 'welcome');
  assert.equal(r.status, 200);
  assert.equal(r.data.run.id, run.id);
  assert.ok(r.data.steps.length >= 4);
  assert.ok(r.data.steps.every((s) => s.owner_email === 'newt@favorintl.org'));
  assert.equal(r.data.meet[0].email, BOSS.email);
  assert.equal(r.data.meet[0].why, 'Your supervisor');
  assert.ok(r.data.meet.some((m) => m.why === 'HR file and shared drive'));
  assert.ok(r.data.week.length >= 2);
  assert.ok(r.data.week.every((d) => d.items.every((i) => ['You', 'Your supervisor', 'Training'].includes(i.who))));
  // A person with no run still gets the page, with nothing of someone else's in it.
  const none = await call(w, PLAIN, 'GET', 'welcome');
  assert.equal(none.data.run, null);
  assert.deepEqual(none.data.steps, []);
  // The new hire can mark their own form step, nothing else.
  const mine = r.data.steps.find((s) => s.key === 'paperwork');
  assert.equal((await call(w, newt, 'PATCH', `runs/${run.id}/steps/${mine.id}`, { status: 'done' })).status, 200, 'the supervisor-created run lets the owner mark it');
});

test('the morning pass: each owner gets one email for steps due tomorrow, today or late, once a day, never on a weekend', async () => {
  const w = onboardWorld();
  await begin(w);
  w.mail.length = 0;
  const { reminderPass } = await import('../functions/_lib/onboard/mail.ts');
  // 2026-10-12 is a Monday, 9:00 AM Eastern. The Favor email step (HR) is due that day.
  const monday = new Date('2026-10-12T13:00:00.000Z');
  const sat = await reminderPass(w.env, new Date('2026-10-17T14:00:00.000Z'));
  assert.deepEqual(sat.notes, ['weekend']);
  assert.equal((await reminderPass(w.env, new Date('2026-10-12T10:00:00.000Z'))).notes[0], 'before 8:00 AM');
  const r = await reminderPass(w.env, monday);
  assert.ok(r.mailed >= 1);
  const to = w.mail.map((m) => m.to);
  assert.ok(to.includes(HR.email));
  assert.ok(!to.includes(BOSS.email), 'the supervisor has nothing due yet');
  const hrMail = w.mail.find((m) => m.to === HR.email);
  assert.match(hrMail.text, /Create the Favor email/);
  const again = await reminderPass(w.env, monday);
  assert.equal(again.mailed, 0, 'not twice in a day');
  // Next day: the same step is late and is listed again.
  w.mail.length = 0;
  await reminderPass(w.env, new Date('2026-10-13T13:00:00.000Z'));
  assert.match(w.mail.find((m) => m.to === HR.email).text, /late/);
});

test('the morning pass sends nothing while requests.notify is off', async () => {
  const w = onboardWorld({ notify: 'off' });
  await begin(w);
  const { reminderPass } = await import('../functions/_lib/onboard/mail.ts');
  const r = await reminderPass(w.env, new Date('2026-10-12T13:00:00.000Z'));
  assert.equal(r.mailed, 0);
  assert.equal(w.mail.length, 0);
});

test('cancelling a run drops its open tasks and keeps the record', async () => {
  const w = onboardWorld();
  const { run, steps } = await begin(w);
  await call(w, HR, 'PATCH', `runs/${run.id}/steps/${steps[0].id}`, { status: 'done' });
  const r = await call(w, WILL, 'PATCH', `runs/${run.id}`, { status: 'cancelled' });
  assert.equal(r.data.run.status, 'cancelled');
  assert.equal(rows(w, `SELECT COUNT(*) AS n FROM hub_tasks WHERE status = 'dropped'`)[0].n, steps.length - 1);
  assert.equal(rows(w, `SELECT COUNT(*) AS n FROM hub_tasks WHERE status = 'done'`)[0].n, 1);
  assert.equal((await call(w, WILL, 'GET', '')).data.runs.length, 0, 'it leaves the active list');
  assert.equal((await call(w, WILL, 'GET', '?status=all')).data.runs.length, 1);
});

test('before the tables are applied every route says so and nothing breaks', async () => {
  const w = onboardWorld();
  w.d1.exec('DROP TABLE onb_runs');
  const r = await call(w, WILL, 'GET', '');
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'not_ready');
  const wl = await call(w, PLAIN, 'GET', 'welcome');
  assert.equal(wl.status, 200);
  assert.equal(wl.data.ready, false);
});

test('a cross-site change is refused', async () => {
  const w = onboardWorld();
  const r = await call(w, WILL, 'POST', 'runs', START, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});
