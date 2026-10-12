// The Asana importer, proved against a stand-in for the documented API and against export files. Invented people and tasks only; the
// live database and the real Asana are never touched (an in-memory D1 built from the repository's own schema files).
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAsana } from './support/asana-fake.mjs';
import './support/resolve-ts.mjs';

import { world } from './support/asana-world.mjs';
import { readFileSync } from 'node:fs';
const read2 = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
const one = (w, sql, ...a) => w.d1.db.prepare(sql).get(...a);

async function lib() {
  return { imp: await import('../functions/_lib/projects/asana-import.ts'), asana: await import('../functions/_lib/projects/asana.ts') };
}

/** Runs a whole run to the end, the way the Admin page does: step after step until done. */
async function drive(w, fake, { mode = 'import', picks = [{ ref: 'P1', name: 'Marketing Daily' }], options = {}, budget = {}, fromDry = null, steps = 80, clock } = {}) {
  const { imp, asana } = await lib();
  const run = await imp.createRun(w.env, { mode, source: 'api', selection: picks, options, by: 'ada@favorintl.org', fromDry });
  let now = clock || (() => Date.now());
  let last = run;
  let n = 0;
  while ((last.status === 'running' || last.status === 'waiting') && n++ < steps) {
    last = await imp.stepRun(w.env, run.id, {
      now,
      uploads: w.env.UPLOADS,
      ...budget,
      makeSource: async (_r, b) =>
        new asana.AsanaApiSource({ token: 'test-token', baseUrl: 'https://app.asana.example/api/1.0', fetch: fake.fetch, sleep: async () => {}, deadline: b.deadline, now }),
    });
    if (last.status === 'waiting') {
      const resume = Date.parse(last.resume_at);
      const base = now();
      now = () => Math.max(base, resume) + 1;
    }
  }
  return last;
}

test('a dry run reads everything and writes nothing but its own report', async () => {
  const w = world();
  const fake = makeAsana();
  const run = await drive(w, fake, { mode: 'dry' });
  assert.equal(run.status, 'done');
  assert.equal(rows(w, 'SELECT id FROM hub_projects').length, 0);
  assert.equal(rows(w, 'SELECT id FROM hub_tasks').length, 0);
  assert.equal(rows(w, 'SELECT gid FROM hub_asana_map').length, 0);
  assert.equal(w.stored.size, 0);
  const p = run.report.projects.P1;
  assert.equal(p.tasks.create, 47); // 45 tasks and 2 subtasks
  assert.equal(p.tasks.subtasks, 2);
  assert.equal(p.expected, 45);
  assert.equal(p.comments.create, 2);
  assert.deepEqual(p.sections, { create: 4, update: 0, same: 0 });
  assert.ok(fake.requests.every((r) => r.method === 'GET'), 'only GET requests reach Asana');
});

test('the dry run names the people it cannot match and the files it cannot copy', async () => {
  const w = world();
  const run = await drive(w, makeAsana(), { mode: 'dry' });
  const un = Object.values(run.report.people.unmatched);
  const zed = un.find((u) => u.email === 'zed@outside.example');
  assert.ok(zed, 'the outside contractor is listed');
  assert.match(zed.reason, /not on FavorOS staff list/);
  assert.ok(zed.assigned >= 1 && zed.comments === 1);
  const names = run.report.files.problems.map((f) => f.name);
  assert.deepEqual(names, ['raw-footage.mov']);
  assert.match(run.report.files.problems[0].reason, /Larger than 60 MB/);
});

test('an import writes the project, sections, tasks, subtasks, comments, files, tags and fields', async () => {
  const w = world();
  const dry = await drive(w, makeAsana(), { mode: 'dry' });
  const run = await drive(w, makeAsana(), { fromDry: dry.id });
  assert.equal(run.status, 'done');
  const project = one(w, 'SELECT * FROM hub_projects');
  assert.match(project.key, /^[A-Z]{2,5}$/);
  assert.equal(project.lead_email, 'dan@favorintl.org');
  assert.equal(project.next_num, 48);
  const secs = rows(w, 'SELECT name FROM hub_project_sections ORDER BY sort').map((s) => s.name);
  assert.deepEqual(secs, ['Needs To Be Assigned', 'Open Projects', 'Closed Projects', 'Vacation']);
  assert.equal(rows(w, 'SELECT id FROM hub_tasks').length, 47);
  const t1 = one(w, "SELECT * FROM hub_tasks WHERE title = 'Task number 1'");
  assert.match(t1.code, new RegExp('^' + project.key + '-\\d{4}$'));
  assert.equal(t1.owner_email, 'dan@favorintl.org');
  assert.equal(t1.priority, 'low');
  assert.match(t1.description, /Tags: Print, Rush/);
  assert.equal(rows(w, 'SELECT id FROM hub_tasks WHERE parent_id = ?', t1.id).length, 2);
  assert.deepEqual(rows(w, 'SELECT kind, name FROM hub_task_fields WHERE task_id = ? AND kind = ? ORDER BY name', t1.id, 'tag').map((r) => r.name), ['Print', 'Rush']);
  // done tasks keep their completion
  const t7 = one(w, "SELECT * FROM hub_tasks WHERE title = 'Task number 7'");
  assert.equal(t7.status, 'done');
  assert.equal(t7.done_by, 'vic@favorintl.org');
  assert.ok(t7.done_at.startsWith('2026-09-0'));
  // a timed due date becomes an Eastern date and time
  const t2 = one(w, "SELECT * FROM hub_tasks WHERE title = 'Task number 2'");
  assert.equal(t2.due_date, '2026-10-03');
  assert.equal(t2.due_time, '18:30');
  // Status field and Requester
  assert.equal(one(w, "SELECT status FROM hub_tasks WHERE title = 'Task number 4'").status, 'doing');
  assert.equal(one(w, "SELECT status FROM hub_tasks WHERE title = 'Task number 5'").status, 'waiting');
  assert.ok(rows(w, 'SELECT email FROM hub_task_people WHERE task_id = ?', t1.id).some((r) => r.email === 'dan@favorintl.org'));
  // the unmatched assignee is kept in the words
  const t44 = one(w, "SELECT * FROM hub_tasks WHERE title = 'Task number 44'");
  assert.equal(t44.owner_email, null);
  assert.match(t44.description, /Assigned in Asana to Zed Contractor/);
  // comments: system stories skipped, the outside author's words carry their name
  const cm = rows(w, 'SELECT * FROM hub_task_comments WHERE task_id = ? ORDER BY created_at', t1.id);
  assert.equal(cm.length, 2);
  assert.equal(cm[0].author_email, 'vic@favorintl.org');
  assert.equal(cm[0].source, 'asana');
  assert.match(cm[1].body, /^Zed Contractor wrote in Asana:/);
  // files: the small one copied, the external one linked, the huge one reported
  const fl = rows(w, 'SELECT * FROM hub_task_files WHERE task_id = ? ORDER BY name', t1.id);
  assert.deepEqual(fl.map((f) => [f.name, f.kind]), [['Brand folder', 'link'], ['flyer-proof.pdf', 'upload'], ['raw-footage.mov', 'link']]);
  assert.equal(w.stored.size, 1);
  assert.match([...w.stored.keys()][0], new RegExp('^projects/' + t1.id + '/'));
  assert.equal(run.report.projects.P1.files.failed, 1);
  // nothing was announced
  assert.equal(rows(w, 'SELECT id FROM hub_task_notices').length, 0);
});

test('a second run updates and never duplicates; counts come back unchanged', async () => {
  const w = world();
  await drive(w, makeAsana());
  const before = { tasks: rows(w, 'SELECT id, code FROM hub_tasks ORDER BY id'), comments: rows(w, 'SELECT id FROM hub_task_comments').length, files: rows(w, 'SELECT id FROM hub_task_files').length };
  const again = await drive(w, makeAsana());
  assert.equal(again.status, 'done');
  assert.deepEqual(rows(w, 'SELECT id, code FROM hub_tasks ORDER BY id'), before.tasks);
  assert.equal(rows(w, 'SELECT id FROM hub_task_comments').length, before.comments);
  assert.equal(rows(w, 'SELECT id FROM hub_task_files').length, before.files);
  assert.equal(rows(w, 'SELECT id FROM hub_projects').length, 1);
  assert.equal(rows(w, 'SELECT id FROM hub_project_sections').length, 4);
  const p = again.report.projects.P1;
  assert.equal(p.tasks.create, 0);
  assert.equal(p.tasks.update, 0);
  assert.equal(p.project, 'same');
  // a task unchanged in Asana is not read again: far fewer calls than the first pass
  const first = await drive(world(), makeAsana());
  assert.ok(again.calls < first.calls / 2, `${again.calls} calls on the second run, ${first.calls} on the first`);
});

test('a change in Asana is picked up; a hub edit made after the import is kept', async () => {
  const w = world();
  await drive(w, makeAsana());
  const fake = makeAsana();
  fake.tasks[0].name = 'Task number 1, renamed in Asana';
  fake.tasks[0].modified_at = '2026-10-01T00:00:00.000Z';
  fake.tasks[1].name = 'Task number 2, renamed in Asana';
  fake.tasks[1].modified_at = '2026-10-01T00:00:00.000Z';
  // someone edits task 2 in the hub after the import
  w.d1.db.prepare("UPDATE hub_tasks SET description = 'edited in FavorOS', updated_at = '2999-01-01T00:00:00.000Z' WHERE title = 'Task number 2'").run();
  const run = await drive(w, fake);
  assert.equal(run.report.projects.P1.tasks.update, 1);
  assert.equal(run.report.projects.P1.tasks.kept, 1);
  assert.equal(rows(w, "SELECT id FROM hub_tasks WHERE title = 'Task number 1, renamed in Asana'").length, 1);
  assert.equal(rows(w, "SELECT id FROM hub_tasks WHERE title = 'Task number 2, renamed in Asana'").length, 0);
  const over = await drive(w, fake, { options: { overwrite: true } });
  assert.equal(over.report.projects.P1.tasks.update, 1);
  assert.equal(rows(w, "SELECT id FROM hub_tasks WHERE title = 'Task number 2, renamed in Asana'").length, 1);
});

test('a run is resumable: a tiny budget takes many steps and ends with the same rows', async () => {
  const a = world();
  await drive(a, makeAsana());
  const b = world();
  const run = await drive(b, makeAsana(), { budget: { maxCalls: 12 }, steps: 400 });
  assert.equal(run.status, 'done');
  assert.equal(rows(b, 'SELECT id FROM hub_tasks').length, rows(a, 'SELECT id FROM hub_tasks').length);
  assert.equal(rows(b, 'SELECT id FROM hub_task_comments').length, rows(a, 'SELECT id FROM hub_task_comments').length);
  assert.equal(rows(b, 'SELECT id FROM hub_task_files').length, rows(a, 'SELECT id FROM hub_task_files').length);
  assert.equal(rows(b, 'SELECT code FROM hub_tasks WHERE code IS NOT NULL GROUP BY code HAVING COUNT(*) > 1').length, 0, 'no code is used twice');
});

test('a rate limit pauses the run and it carries on by itself', async () => {
  const w = world();
  const fake = makeAsana({ rateLimitOnce: ['GET /tasks'] });
  const { imp, asana } = await lib();
  const run = await imp.createRun(w.env, { mode: 'import', source: 'api', selection: [{ ref: 'P1', name: 'Marketing Daily' }], options: {}, by: 'ada@favorintl.org' });
  let t = Date.now();
  const make = async (_r, b) => new asana.AsanaApiSource({ token: 'test-token', baseUrl: 'https://app.asana.example/api/1.0', fetch: fake.fetch, sleep: async () => {}, deadline: b.deadline, now: () => t });
  // the wait Asana asks for (2 s) is longer than what is left of the step, so the step ends and the run waits
  const first = await imp.stepRun(w.env, run.id, { now: () => t, budgetMs: 1000, uploads: w.env.UPLOADS, makeSource: make });
  assert.equal(first.status, 'waiting');
  assert.ok(Date.parse(first.resume_at) >= t + 2000);
  // asking again too early changes nothing
  const early = await imp.stepRun(w.env, run.id, { now: () => t + 500, makeSource: make, uploads: w.env.UPLOADS });
  assert.equal(early.status, 'waiting');
  t += 3000;
  let last = early;
  for (let i = 0; i < 80 && last.status !== 'done'; i++) last = await imp.stepRun(w.env, run.id, { now: () => t, uploads: w.env.UPLOADS, makeSource: make });
  assert.equal(last.status, 'done');
  assert.equal(rows(w, 'SELECT id FROM hub_tasks').length, 47);
});

test('a short rate limit is waited out inside the step', async () => {
  const w = world();
  const fake = makeAsana({ rateLimitOnce: ['GET /tasks'] });
  const slept = [];
  const { imp, asana } = await lib();
  const run = await imp.createRun(w.env, { mode: 'dry', source: 'api', selection: [{ ref: 'P1', name: 'x' }], options: {}, by: 'ada@favorintl.org' });
  const out = await imp.stepRun(w.env, run.id, {
    budgetMs: 60000, makeSource: async (_r, b) => new asana.AsanaApiSource({ token: 'test-token', baseUrl: 'https://app.asana.example/api/1.0', fetch: fake.fetch, sleep: async (ms) => { slept.push(ms); }, deadline: b.deadline }),
  });
  assert.ok(slept.includes(2000));
  assert.notEqual(out.status, 'waiting');
});

test('a token Asana refuses fails the run with a plain message', async () => {
  const w = world();
  const { imp, asana } = await lib();
  const fake = makeAsana();
  const run = await imp.createRun(w.env, { mode: 'dry', source: 'api', selection: [{ ref: 'P1', name: 'x' }], options: {}, by: 'ada@favorintl.org' });
  const out = await imp.stepRun(w.env, run.id, { makeSource: async () => new asana.AsanaApiSource({ token: 'wrong', baseUrl: 'https://app.asana.example/api/1.0', fetch: fake.fetch, sleep: async () => {} }) });
  assert.equal(out.status, 'failed');
  assert.match(out.error, /did not accept the token/);
});

test('dependencies link once both ends exist; a loop and an outside task are reported, not linked', async () => {
  const w = world();
  const run = await drive(w, makeAsana());
  const id = (title) => one(w, 'SELECT id FROM hub_tasks WHERE title = ?', title).id;
  const dep = rows(w, 'SELECT task_id, depends_on FROM hub_task_deps');
  assert.ok(dep.some((d) => d.task_id === id('Task number 2') && d.depends_on === id('Task number 3')));
  assert.ok(dep.some((d) => d.task_id === id('Task number 8') && d.depends_on === id('Task number 3')));
  assert.equal(run.report.deps.outside, 1);
  assert.equal(run.report.deps.cycles, 1);
  assert.equal(dep.length, 3);
  await drive(w, makeAsana());
  assert.equal(rows(w, 'SELECT task_id FROM hub_task_deps').length, 3);
});

test('a task in two projects is made once, in the first, and the second project says so', async () => {
  const w = world();
  const run = await drive(w, makeAsana(), { picks: [{ ref: 'P1', name: 'Marketing Daily' }, { ref: 'P2', name: 'Site Work' }] });
  assert.equal(run.status, 'done');
  assert.equal(rows(w, "SELECT id FROM hub_tasks WHERE title = 'Task number 6'").length, 1);
  assert.equal(run.report.projects.P2.tasks.alsoIn, 1);
  assert.equal(run.report.projects.P2.tasks.create, 2);
  assert.match(one(w, "SELECT description FROM hub_tasks WHERE title = 'Task number 6'").description, /Also in Asana project: Site Work/);
  // the untitled section is no section; Drafts is a section
  assert.equal(one(w, "SELECT section_id FROM hub_tasks WHERE title = 'Site task one'").section_id, null);
  assert.ok(one(w, "SELECT section_id FROM hub_tasks WHERE title = 'Site task two'").section_id);
  const keys = rows(w, 'SELECT key FROM hub_projects').map((p) => p.key);
  assert.equal(new Set(keys).size, 2);
});

test('the email map matches a person whose Asana address differs', async () => {
  const w = world();
  await drive(w, makeAsana(), { options: { emailMap: { 'zed@outside.example': 'vic@favorintl.org' } } });
  assert.equal(one(w, "SELECT owner_email FROM hub_tasks WHERE title = 'Task number 44'").owner_email, 'vic@favorintl.org');
});

test('project keys avoid each other', async () => {
  const { imp } = await lib();
  const c = imp.projectKeyCandidates('Marketing Daily');
  assert.equal(c[0], 'MD');
  assert.ok(c.includes('MAR'));
  assert.ok(c.every((k) => /^[A-Z]{2,5}$/.test(k)));
});

test('Asana colors become hub tokens', async () => {
  const { asana } = await lib();
  assert.equal(asana.hubColor('green'), 'leaf');
  assert.equal(asana.hubColor('dark-purple'), 'dusk');
  assert.equal(asana.hubColor(''), 'leaf');
});

test('an expired page marker restarts the list and skips what is done, so a dry run counts each task once', async () => {
  const w = world();
  const run = await drive(w, makeAsana({ expireOffsets: ['20', '40'] }), { mode: 'dry', budget: { maxCalls: 20 }, steps: 300 });
  assert.equal(run.status, 'done');
  const p = run.report.projects.P1;
  assert.equal(p.tasks.create, 47);
  assert.equal(p.comments.create, 2);
});

test('sections are counted once and never re-sorted, however many steps the run takes', async () => {
  const dryW = world();
  const dry = await drive(dryW, makeAsana(), { mode: 'dry', budget: { maxCalls: 12 }, steps: 400 });
  assert.deepEqual(dry.report.projects.P1.sections, { create: 4, update: 0, same: 0 });
  const w = world();
  await drive(w, makeAsana(), { budget: { maxCalls: 12 }, steps: 400 });
  assert.deepEqual(rows(w, 'SELECT name, sort FROM hub_project_sections ORDER BY sort').map((s) => [s.name, s.sort]), [
    ['Needs To Be Assigned', 1024], ['Open Projects', 2048], ['Closed Projects', 3072], ['Vacation', 4096],
  ]);
});

test('an import is silent: no notice, hook, Chat card, email or calendar call, even with notices switched on', async () => {
  const w = world();
  w.d1.exec(read2('db/favor-chat.sql'));
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'on', 't', 'x')").run();
  const channelsBefore = rows(w, 'SELECT id FROM chat_channels').length;
  const hooks = await import('../functions/_lib/projects/hooks.ts');
  const seen = [];
  hooks.onProjectEvent((_e, ev) => { seen.push(ev.kind); });
  const realFetch = globalThis.fetch;
  const outside = [];
  globalThis.fetch = (u) => { outside.push(String(u)); throw new Error('no network call is allowed during an import'); };
  try {
    const run = await drive(w, makeAsana(), { picks: [{ ref: 'P1', name: 'Marketing Daily' }, { ref: 'P2', name: 'Site Work' }], options: { visibility: 'members' } });
    assert.equal(run.status, 'done');
    assert.ok(rows(w, 'SELECT id FROM hub_tasks WHERE owner_email IS NOT NULL').length > 20, 'tasks were assigned');
    assert.ok(rows(w, 'SELECT id FROM hub_task_comments').length > 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(rows(w, 'SELECT id FROM hub_task_notices').length, 0);
  assert.deepEqual(seen, []);
  assert.deepEqual(outside, []);
  assert.equal(rows(w, 'SELECT id FROM chat_messages').length, 0);
  assert.equal(rows(w, 'SELECT id FROM chat_channels').length, channelsBefore, 'no channel was made');
  assert.deepEqual([...new Set(rows(w, 'SELECT kind FROM hub_task_events').map((e) => e.kind))], ['imported']);
  // the project: members only, the Asana owner leads, the assignees are members
  const p = one(w, "SELECT * FROM hub_projects WHERE name = 'Marketing Daily'");
  assert.equal(p.visibility, 'members');
  assert.equal(p.lead_email, 'dan@favorintl.org');
  const mem = rows(w, 'SELECT email FROM hub_project_members WHERE project_id = ?', p.id).map((m) => m.email).sort();
  assert.deepEqual(mem, ['dan@favorintl.org', 'vic@favorintl.org']);
});
