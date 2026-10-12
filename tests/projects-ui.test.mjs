// The projects UI data layer (public/js/projects/ui-data.js) against lane CORE's in-memory fixture (?mock=1): grouping, ordering,
// optimistic adds and moves, and the rollback when the server refuses. No browser; the few globals the modules read are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.location = { search: '?mock=1', href: 'http://localhost/projects/p/?p=MKT&mock=1', origin: 'http://localhost', pathname: '/projects/p/' };
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.document = { addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, querySelector: () => null }), body: { appendChild() {} }, documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } }, activeElement: null };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => {};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.visualViewport = null;
globalThis.innerHeight = 800;

const { Ctx, api, loadStaff, personOf } = await import('../public/js/projects/ui-data.js');
const core = (await import('../public/js/projects/api.js')).api;
const U = await import('../public/js/projects/ui-util.js');

const fresh = async (key = 'MKT') => { const c = new Ctx('project'); await c.load(key); return c; };

test('a project loads its sections and every task, subtasks left out', async () => {
  const c = await fresh();
  assert.ok(c.sections.length >= 2);
  assert.ok(c.tasks.length > 5);
  assert.ok(c.tasks.every((t) => !t.parent_id));
  assert.equal(c.error, '');
});

test('grouped() splits by section, keeps manual order, and honors the filter and the sort', async () => {
  const c = await fresh();
  const g = c.grouped();
  for (const s of c.sections) { const rows = g.get(s.id); assert.deepEqual(rows.map((t) => t.sort), rows.map((t) => t.sort).sort((a, b) => a - b)); }
  c.filter.hideDone = true;
  c.sectionTasks = null;
  assert.ok([...c.grouped().values()].flat().every((t) => t.status !== 'done'));
  c.filter.hideDone = false; c.filter.q = 'zzzzzz-no-such'; c.sectionTasks = null;
  assert.equal([...c.grouped().values()].flat().length, 0);
  c.filter.q = ''; c.sort = { by: 'due', dir: 1 }; c.sectionTasks = null;
  const rows = c.grouped().get(c.sections[0].id).filter((t) => t.due_date);
  assert.deepEqual(rows.map((t) => t.due_date), rows.map((t) => t.due_date).sort());
});

test('create() shows the row at once, then swaps in the saved task', async () => {
  const c = await fresh();
  const sid = c.sections[0].id;
  const n = c.tasks.length;
  const p = c.create({ title: '  Call the printer  ', section_id: sid });
  assert.equal(c.tasks.length, n + 1);
  const tmp = c.tasks[c.tasks.length - 1];
  assert.equal(tmp.title, 'Call the printer');
  assert.ok(tmp.pending);
  const saved = await p;
  assert.ok(saved.code && /^MKT-\d+$/.test(saved.code));
  assert.equal(c.tasks.length, n + 1);
  assert.ok(!c.tasks.some((t) => t.pending));
});

test('rows typed one after another land in the order typed', async () => {
  const c = await fresh();
  const sid = c.sections[0].id;
  const ps = ['one', 'two', 'three'].map((title) => c.create({ title, section_id: sid }));
  await Promise.all(ps);
  const titles = c.rawSection(sid).map((t) => t.title);
  assert.deepEqual(titles.slice(-3), ['one', 'two', 'three']);
});

test('create() rolls the row back and says so when the server refuses', async () => {
  const c = await fresh();
  const was = core.createTask;
  core.createTask = async () => { throw new Error('No connection.'); };
  const n = c.tasks.length;
  const r = await c.create({ title: 'Will fail', section_id: c.sections[0].id });
  core.createTask = was;
  assert.equal(r, null);
  assert.equal(c.tasks.length, n);
});

test('patch() applies at once and restores the old values on failure', async () => {
  const c = await fresh();
  const t = c.tasks.find((x) => x.status !== 'done');
  const was = core.patchTask;
  core.patchTask = async () => { throw new Error('nope'); };
  const p = c.patch(t.id, { done: true });
  assert.equal(t.status, 'done');
  assert.equal(await p, false);
  core.patchTask = was;
  assert.notEqual(t.status, 'done');
  assert.equal(t.done_at ?? null, null);
});

test('move() puts a task between neighbours, across sections, and keeps the order after the round trip', async () => {
  const c = await fresh();
  const [a, b] = c.sections;
  const target = c.rawSection(b.id)[1];
  const t = c.rawSection(a.id)[0];
  assert.equal(await c.move(t.id, { section_id: b.id, before: target.id }), true);
  await new Promise((r) => setTimeout(r, 300)); // the fixture renumbers a list, so the client reads the order back
  const ids = c.rawSection(b.id).map((x) => x.id);
  assert.equal(ids.indexOf(t.id) + 1, ids.indexOf(target.id));
  assert.equal(t.section_id, b.id);
  assert.ok(!c.rawSection(a.id).some((x) => x.id === t.id));
});

test('move() rolls back when the server refuses', async () => {
  const c = await fresh();
  const [a, b] = c.sections;
  const t = c.rawSection(a.id)[0];
  const sort = t.sort;
  const was = core.patchTask;
  core.patchTask = async () => { throw new Error('refused'); };
  assert.equal(await c.move(t.id, { section_id: b.id }), false);
  core.patchTask = was;
  assert.equal(t.section_id, a.id);
  assert.equal(t.sort, sort);
});

test('remove() takes tasks out at once and puts them back if the server refuses', async () => {
  const c = await fresh();
  const t = c.tasks[0];
  const was = core.deleteTask;
  core.deleteTask = async () => { throw new Error('refused'); };
  await c.remove([t.id]);
  core.deleteTask = was;
  assert.ok(c.by.has(t.id));
});

test('sections: add, rename, delete (tasks keep existing with no section)', async () => {
  const c = await fresh();
  const s = await c.addSection('Review');
  assert.ok(s.id && !String(s.id).startsWith('tmp-'));
  await c.renameSection(s.id, 'Final review');
  assert.equal(c.sections.find((x) => x.id === s.id).name, 'Final review');
  const first = c.sections[0];
  const had = c.rawSection(first.id).length;
  assert.ok(had > 0);
  await c.deleteSection(first.id);
  assert.ok(!c.sections.some((x) => x.id === first.id));
  assert.ok(c.tasks.every((t) => t.section_id !== first.id));
});

test('staff and codes come through the same client', async () => {
  const st = await loadStaff();
  assert.ok(st.me && st.list.length > 3);
  assert.equal(personOf(st.me).email, st.me);
  const codes = await api.codes('appeal', '');
  assert.ok(codes.codes.length > 0 && codes.codes[0].code);
});

test('dates read the way people say them', () => {
  const t = U.todayStr();
  assert.equal(U.dueLabel(t), 'Today');
  assert.equal(U.dueLabel(U.addDays(t, 1)), 'Tomorrow');
  assert.equal(U.dueLabel(U.addDays(t, -1)), 'Yesterday');
  assert.equal(U.dueLabel(U.addDays(t, 20)).includes('Tomorrow'), false);
  assert.equal(U.dueLabel(t, '14:30'), 'Today 2:30 PM');
  assert.equal(U.mondayOf('2026-10-14'), '2026-10-12');
  assert.equal(U.esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});
