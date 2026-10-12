// Admin > Projects: the sealed token, settings, the confirm gate on an import, runs driven through the routes, export files, archive and
// restore, and the Make a request switch. Invented people only; fetch is a stand-in for Asana.
import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryD1 } from './support/d1.mjs';
import { makeAsana } from './support/asana-fake.mjs';
import { world } from './support/asana-world.mjs';
import './support/resolve-ts.mjs';

const KEY = 'a'.repeat(64);
const TOKEN = 'test-token';
const ADMIN = { 'X-Hub-Email': 'ada@favorintl.org', 'X-Hub-Role': 'admin', 'X-Hub-Name': 'Ada Admin', 'X-Hub-Request': '1' };
const STAFF = { 'X-Hub-Email': 'vic@favorintl.org', 'X-Hub-Role': 'staff', 'X-Hub-Name': 'Vic Video', 'X-Hub-Request': '1' };

function setup() {
  const w = world();
  w.env.GOOGLE_TOKEN_KEY = KEY;
  return w;
}

function toQuery(path) {
  const m = String(path).match(/^\/?([^?]*)\??(.*)$/);
  return m[1] ? '?p=' + m[1] + (m[2] ? '&' + m[2] : '') : m[2] ? '?' + m[2] : '';
}

async function call(w, who, method, path, body) {
  const mod = await import('../functions/api/admin/projects.ts');
  const init = { method, headers: { 'Content-Type': 'application/json', ...who } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const handler = method === 'GET' ? mod.onRequestGet : mod.onRequestPost;
  const res = await handler({ request: new Request('https://dash.favorintl.org/api/admin/projects' + toQuery(path), init), env: w.env, waitUntil: () => {} });
  return { status: res.status, data: await res.json() };
}

const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
const withAsana = async (fake, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = (u, i) => {
    const url = String(u);
    return fake.fetch(url.startsWith('https://app.asana.com/api/1.0') ? url.replace('https://app.asana.com/api/1.0', 'https://app.asana.example/api/1.0') : url, i);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
};

async function saveTokenOk(w) {
  const r = await call(w, ADMIN, 'POST', '/token', { token: TOKEN + '-0123456789' });
  assert.equal(r.status, 200);
}

test('only admins reach the page, and a change must come from the page', async () => {
  const w = setup();
  assert.equal((await call(w, STAFF, 'GET', '')).status, 403);
  assert.equal((await call(w, {}, 'GET', '')).status, 401);
  const r = await call(w, { ...ADMIN, 'X-Hub-Request': '' }, 'POST', '/settings', { enabled: 'staff' });
  assert.equal(r.status, 403);
});

test('the token is sealed: not in clear text in the database, the answers, or the audit log', async () => {
  const w = setup();
  const secret = 'asana-secret-token-9876543210';
  const saved = await call(w, ADMIN, 'POST', '/token', { token: secret });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.token.saved, true);
  const all = JSON.stringify(rows(w, 'SELECT * FROM hub_settings')) + JSON.stringify(rows(w, 'SELECT * FROM hub_audit')) + JSON.stringify(saved) + JSON.stringify(await call(w, ADMIN, 'GET', ''));
  assert.ok(!all.includes(secret), 'the token appears nowhere in clear text');
  const row = rows(w, "SELECT value FROM hub_settings WHERE key = 'projects.asana.token'")[0];
  assert.match(row.value, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  const { readToken } = await import('../functions/_lib/projects/asana-admin.ts');
  assert.equal(await readToken(w.env), secret);
  const gone = await call(w, ADMIN, 'POST', '/token', { remove: true });
  assert.equal(gone.data.settings.token.saved, false);
  assert.equal(await readToken(w.env), null);
});

test('a copy without the sealing key refuses to keep a token, and a bad token is refused', async () => {
  const w = world();
  assert.equal((await call(w, ADMIN, 'POST', '/token', { token: 'x'.repeat(40) })).data.error, 'no_key');
  w.env.GOOGLE_TOKEN_KEY = KEY;
  assert.equal((await call(w, ADMIN, 'POST', '/token', { token: 'short' })).data.error, 'bad_token');
});

test('Connect and test says who the token belongs to; a wrong token says Asana refused it', async () => {
  const w = setup();
  const fake = makeAsana();
  await saveTokenOk(w);
  // the stand-in only accepts "test-token", which is shorter than a real token, so seal it directly
  const { seal } = await import('../functions/_lib/hub/google.ts');
  w.d1.db.prepare("UPDATE hub_settings SET value = ? WHERE key = 'projects.asana.token'").run(await seal(w.env, TOKEN));
  await withAsana(fake, async () => {
    const ok = await call(w, ADMIN, 'POST', '/test', {});
    assert.equal(ok.data.who.email, 'ada@favorintl.org');
    assert.equal(ok.data.settings.token.who.workspaces[0].name, 'favorintl.org');
    w.d1.db.prepare("UPDATE hub_settings SET value = ? WHERE key = 'projects.asana.token'").run(await seal(w.env, 'not-the-token'));
    const bad = await call(w, ADMIN, 'POST', '/test', {});
    assert.equal(bad.data.error, 'asana_refused');
  });
});

test('settings: who can open Projects is validated and audited; the Marketing request target must be a live project', async () => {
  const w = setup();
  assert.equal((await call(w, ADMIN, 'POST', '/settings', { enabled: 'everyone' })).data.error, 'bad_value');
  const ok = await call(w, ADMIN, 'POST', '/settings', { enabled: 'staff' });
  assert.equal(ok.data.settings.enabled, 'staff');
  assert.equal(rows(w, "SELECT value FROM hub_settings WHERE key = 'projects.enabled'")[0].value, 'staff');
  assert.ok(rows(w, "SELECT * FROM hub_audit WHERE key = 'projects.enabled'").length === 1);
  assert.equal((await call(w, ADMIN, 'POST', '/settings', { marketing_project: 'nope' })).data.error, 'no_project');
});

test('an import is refused without a confirm, and without a fresh dry run on the same projects', async () => {
  const w = setup();
  await saveTokenOk(w);
  const picks = [{ ref: 'P1', name: 'Marketing Daily' }];
  const noConfirm = await call(w, ADMIN, 'POST', '/runs', { source: 'api', mode: 'import', projects: picks });
  assert.equal(noConfirm.data.error, 'confirm');
  const noDry = await call(w, ADMIN, 'POST', '/runs', { source: 'api', mode: 'import', projects: picks, confirm: true });
  assert.equal(noDry.data.error, 'dry_first');
  assert.equal((await call(w, ADMIN, 'POST', '/runs', { source: 'api', mode: 'dry', projects: [] })).data.error, 'no_projects');
});

test('dry run then import through the routes, driven step by step like the page does', async () => {
  const w = setup();
  const fake = makeAsana();
  await saveTokenOk(w);
  const { seal } = await import('../functions/_lib/hub/google.ts');
  w.d1.db.prepare("UPDATE hub_settings SET value = ? WHERE key = 'projects.asana.token'").run(await seal(w.env, TOKEN));
  await withAsana(fake, async () => {
    const list = await call(w, ADMIN, 'GET', '/asana');
    assert.deepEqual(list.data.projects.map((p) => p.name), ['Marketing Daily', 'Site Work']);
    const arch = await call(w, ADMIN, 'GET', '/asana?archived=1');
    assert.deepEqual(arch.data.projects.map((p) => p.name), ['Old Appeals 2022']);
    const picks = [{ ref: 'P1', name: 'Marketing Daily' }];
    const drive = async (body) => {
      let v = await call(w, ADMIN, 'POST', '/runs', body);
      assert.equal(v.status, 200, JSON.stringify(v.data));
      let n = 0;
      let after = 0;
      while (['running', 'waiting'].includes(v.data.run.status) && n++ < 100) {
        v = await call(w, ADMIN, 'POST', `/runs/${v.data.run.id}/step`, { after });
        for (const l of v.data.log) after = Math.max(after, l.id);
      }
      return v.data;
    };
    const dry = await drive({ source: 'api', mode: 'dry', projects: picks, options: { team: 'Marketing' } });
    assert.equal(dry.run.status, 'done');
    assert.equal(rows(w, 'SELECT id FROM hub_projects').length, 0);
    // a dry run on other projects does not unlock this import
    const wrong = await call(w, ADMIN, 'POST', '/runs', { source: 'api', mode: 'import', projects: [{ ref: 'P2', name: 'x' }], confirm: true, from_dry_run: dry.run.id });
    assert.equal(wrong.data.error, 'dry_first');
    const done = await drive({ source: 'api', mode: 'import', projects: picks, confirm: true, from_dry_run: dry.run.id, options: { team: 'Marketing' } });
    assert.equal(done.run.status, 'done');
    assert.equal(done.report.projects.P1.hubCount, 47);
    const p = rows(w, 'SELECT * FROM hub_projects')[0];
    assert.equal(p.team, 'Marketing');
    assert.equal(done.progress.total, 45);
    // the log is readable and carries no token
    assert.ok(done.log.length > 0);
    assert.ok(!JSON.stringify(done).includes(TOKEN + '-0123456789'));
    // one run at a time
    const again = await call(w, ADMIN, 'POST', '/runs', { source: 'api', mode: 'dry', projects: picks });
    assert.equal(again.status, 200);
    const busy = await call(w, ADMIN, 'POST', '/runs', { source: 'api', mode: 'dry', projects: picks });
    assert.equal(busy.data.error, 'busy');
    const cancelled = await call(w, ADMIN, 'POST', `/runs/${again.data.run.id}/cancel`, {});
    assert.equal(cancelled.data.run.status, 'cancelled');
  });
  assert.ok(fake.requests.filter((r) => r.path.startsWith('/api') || true).every((r) => r.method === 'GET'));
});

const CSV = [
  'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task,Blocked By (Dependencies),Blocking (Dependencies),Priority,Requester',
  '101,2026-08-01,,2026-09-01,"Flyer, front and back",Open Projects,Vic Video,vic@favorintl.org,2026-09-01,2026-09-20,"Print, Rush","Line one\nline two ""quoted""",Fall Mailers,,,,High,Dan Design',
  '102,2026-08-02,2026-09-02,2026-09-02,Proof the flyer,Open Projects,Dan Design,dan@favorintl.org,,2026-09-10,,,Fall Mailers,"Flyer, front and back",,,Low,',
  '103,2026-08-03,,2026-09-03,Order paper,Closed Projects,Nobody Known,nobody@outside.example,,,,,Fall Mailers,,"Flyer, front and back",,Medium,',
].join('\n');

test('a CSV export is read: quotes, line breaks, subtasks, dependencies and custom fields', async () => {
  const { parseExport } = await import('../functions/_lib/projects/asana.ts');
  const [p] = parseExport(CSV, 'Fall Mailers.csv');
  assert.equal(p.project.name, 'Fall Mailers');
  assert.deepEqual(p.project.sections.map((s) => s.name), ['Open Projects', 'Closed Projects']);
  assert.equal(p.tasks.length, 2);
  const t = p.tasks[0];
  assert.equal(t.name, 'Flyer, front and back');
  assert.equal(t.notes, 'Line one\nline two "quoted"');
  assert.deepEqual(t.tags, ['Print', 'Rush']);
  assert.equal(t.inline.subtasks.length, 1);
  assert.equal(t.inline.subtasks[0].completed, true);
  assert.deepEqual(p.tasks[1].inline.deps, ['101']);
  assert.deepEqual(t.fields.map((f) => [f.name, f.value]), [['Priority', 'High'], ['Requester', 'Dan Design']]);
});

const JSON_EXPORT = JSON.stringify({
  data: {
    gid: 'J1', name: 'Fall Video', notes: 'Video work', color: 'purple', owner: { name: 'Dan Design', email: 'dan@favorintl.org' }, members: [{ name: 'Vic Video', email: 'vic@favorintl.org' }],
    sections: [{ gid: 'JS1', name: 'Shooting' }],
    tasks: [
      {
        gid: 'JT1', name: 'Shoot the interview', notes: 'Bring the lights', completed: false, assignee: { name: 'Vic Video', email: 'vic@favorintl.org' }, due_on: '2026-10-05',
        memberships: [{ project: { gid: 'J1' }, section: { gid: 'JS1', name: 'Shooting' } }], tags: [{ name: 'Video' }],
        custom_fields: [{ name: 'Priority', type: 'enum', display_value: 'High' }],
        stories: [{ gid: 'JC1', resource_subtype: 'comment_added', created_by: { name: 'Vic Video', email: 'vic@favorintl.org' }, created_at: '2026-09-20T10:00:00.000Z', text: 'Booked the room.' }],
        attachments: [{ gid: 'JA1', name: 'shotlist.pdf', host: 'asana', size: 20, download_url: 'https://files.invalid/A1', permanent_url: 'https://app.asana.example/att/JA1' }],
        subtasks: [{ gid: 'JT2', name: 'Charge batteries', completed: true, completed_at: '2026-09-21T10:00:00.000Z' }],
        dependencies: [],
      },
    ],
  },
});

for (const [label, text, name, project] of [['CSV', CSV, 'Fall Mailers.csv', 'Fall Mailers'], ['JSON', JSON_EXPORT, 'Fall Video.json', 'Fall Video']]) {
  test(`${label} export: upload, dry run, import, and a second import changes nothing`, async () => {
    const w = setup();
    const fake = makeAsana();
    const up = await call(w, ADMIN, 'POST', '/export', { name, text });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.projects[0].name, project);
    const picks = up.data.projects.map((p) => ({ ref: p.ref, name: p.name }));
    const drive = async (body) => {
      let v = await call(w, ADMIN, 'POST', '/runs', body);
      assert.equal(v.status, 200, JSON.stringify(v.data));
      for (let n = 0; ['running', 'waiting'].includes(v.data.run.status) && n < 60; n++) v = await call(w, ADMIN, 'POST', `/runs/${v.data.run.id}/step`, {});
      return v.data;
    };
    await withAsana(fake, async () => {
      const dry = await drive({ source: 'export', upload: up.data.upload, mode: 'dry', projects: picks });
      assert.equal(dry.run.status, 'done', JSON.stringify(dry.run));
      const run = await drive({ source: 'export', upload: up.data.upload, mode: 'import', projects: picks, confirm: true, from_dry_run: dry.run.id });
      assert.equal(run.run.status, 'done');
      const tasks = rows(w, 'SELECT title, parent_id FROM hub_tasks');
      assert.ok(tasks.length >= 2);
      const counts = JSON.stringify([tasks.length, rows(w, 'SELECT id FROM hub_task_comments').length, rows(w, 'SELECT id FROM hub_task_files').length]);
      await drive({ source: 'export', upload: up.data.upload, mode: 'import', projects: picks, confirm: true, from_dry_run: dry.run.id });
      assert.equal(JSON.stringify([rows(w, 'SELECT id FROM hub_tasks').length, rows(w, 'SELECT id FROM hub_task_comments').length, rows(w, 'SELECT id FROM hub_task_files').length]), counts);
      assert.equal(rows(w, 'SELECT id FROM hub_projects').length, 1);
      if (label === 'JSON') {
        assert.equal(rows(w, 'SELECT id FROM hub_task_comments').length, 1);
        assert.equal(rows(w, "SELECT kind FROM hub_task_files")[0].kind, 'upload');
        assert.equal(rows(w, "SELECT name FROM hub_project_sections")[0].name, 'Shooting');
      } else {
        assert.equal(rows(w, "SELECT status FROM hub_tasks WHERE title = 'Proof the flyer'")[0].status, 'done');
        assert.equal(rows(w, 'SELECT task_id FROM hub_task_deps').length, 1);
        assert.equal(rows(w, "SELECT owner_email FROM hub_tasks WHERE title = 'Order paper'")[0].owner_email, null);
      }
    });
  });
}

test('a file that is not an Asana export is refused with a plain message', async () => {
  const w = setup();
  assert.equal((await call(w, ADMIN, 'POST', '/export', { name: 'a.csv', text: 'a,b\n1,2\n' })).data.error, 'bad_file');
  assert.equal((await call(w, ADMIN, 'POST', '/export', { name: 'a.json', text: '{nope' })).data.error, 'bad_file');
});

test('archive and restore a hub project; archiving the Marketing request target switches the setting off', async () => {
  const w = setup();
  w.d1.db.prepare(`INSERT INTO hub_projects (id, key, name, lead_email, created_by, created_at, updated_at) VALUES ('p1','MKT','Marketing','ada@favorintl.org','ada@favorintl.org','x','x')`).run();
  assert.equal((await call(w, ADMIN, 'POST', '/settings', { marketing_project: 'mkt' })).data.settings.marketing_project, 'MKT');
  const a = await call(w, ADMIN, 'POST', '/hub/p1', { action: 'archive' });
  assert.equal(a.data.status, 'archived');
  assert.equal((await call(w, ADMIN, 'GET', '')).data.settings.marketing_project, '');
  assert.equal((await call(w, ADMIN, 'POST', '/settings', { marketing_project: 'MKT' })).data.error, 'archived');
  const r = await call(w, ADMIN, 'POST', '/hub/p1', { action: 'restore' });
  assert.equal(r.data.status, 'active');
  const list = (await call(w, ADMIN, 'GET', '')).data.projects;
  assert.equal(list[0].status, 'active');
});

async function mkt(w, who, method, body) {
  const mod = await import('../functions/api/requests/marketing.ts');
  const init = { method, headers: { 'Content-Type': 'application/json', ...who } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await (method === 'GET' ? mod.onRequestGet : mod.onRequestPost)({ request: new Request('https://dash.favorintl.org/api/requests/marketing', init), env: w.env });
  return { status: res.status, data: await res.json() };
}

test('Make a request: off by default it answers asana; on, a Marketing request becomes a task in the chosen project', async () => {
  const w = setup();
  w.d1.db.prepare(`INSERT INTO hub_projects (id, key, name, lead_email, created_by, created_at, updated_at) VALUES ('p1','MKT','Marketing','ada@favorintl.org','ada@favorintl.org','x','x')`).run();
  assert.equal((await mkt(w, STAFF, 'GET')).data.mode, 'asana');
  assert.equal((await mkt(w, STAFF, 'POST', { text: 'A flyer for the gala' })).data.mode, 'asana');
  assert.equal(rows(w, 'SELECT id FROM hub_tasks').length, 0);
  await call(w, ADMIN, 'POST', '/settings', { marketing_project: 'MKT' });
  const g = await mkt(w, STAFF, 'GET');
  assert.deepEqual(g.data.project, { key: 'MKT', name: 'Marketing' });
  const made = await mkt(w, STAFF, 'POST', { text: 'A flyer for the gala\nFront and back, 8.5 by 11' });
  assert.equal(made.data.mode, 'project');
  assert.equal(made.data.task.code, 'MKT-0001');
  assert.equal(made.data.task.href, '/projects/p/?p=MKT&t=MKT-0001');
  const t = rows(w, 'SELECT * FROM hub_tasks')[0];
  assert.equal(t.title, 'A flyer for the gala');
  assert.equal(t.owner_email, 'ada@favorintl.org');
  assert.equal(t.created_by, 'vic@favorintl.org');
  assert.match(t.description, /Front and back/);
  assert.deepEqual(rows(w, 'SELECT email, role FROM hub_task_people').map((r) => r.email), ['vic@favorintl.org']);
  assert.equal(rows(w, 'SELECT next_num FROM hub_projects')[0].next_num, 2);
  assert.equal(rows(w, 'SELECT id FROM hub_task_notices').length, 0, 'notices stay off until requests.notify is on');
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'on', 't', 'x')").run();
  await mkt(w, STAFF, 'POST', { text: 'A second ask' });
  assert.deepEqual(rows(w, 'SELECT email, kind FROM hub_task_notices').map((r) => [r.email, r.kind]), [['ada@favorintl.org', 'assigned']]);
  assert.equal((await mkt(w, {}, 'POST', { text: 'x y' })).status, 401);
  // Projects switched off falls back to the Asana form
  await call(w, ADMIN, 'POST', '/settings', { enabled: 'off' });
  assert.equal((await mkt(w, STAFF, 'GET')).data.mode, 'asana');
});
