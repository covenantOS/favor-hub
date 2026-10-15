// The Projects web app's task store, filters and dates (web/src/features/projects). Pure logic, run with the network stubbed: a change
// shows at once and is put back when the server refuses it, a move works out its sort between neighbors, a new task lands in the order it
// was typed, and the page address carries the filters.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { TaskCtx, fetchAllTasks } = await import('../web/src/features/projects/lib/store.ts');
const { addDays, dueLabel, mondayOf, todayStr } = await import('../web/src/features/projects/lib/dates.ts');
const { filtersFrom, applyFilters, writeFilters, activeCount } = await import('../web/src/features/projects/project/filters.ts');

const staff = {
  me: 'me@example.org',
  personOf: (e) => (e ? { email: e, name: e.split('@')[0], picture: '' } : null),
  nameOf: (e) => (e ? e.split('@')[0] : ''),
};

let sent = [];
let reply = () => ({ status: 200, body: { ok: true } });
const realFetch = globalThis.fetch;
beforeEach(() => {
  sent = [];
  reply = () => ({ status: 200, body: { ok: true } });
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const r = reply(String(url), init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const task = (id, over = {}) => ({
  id,
  project_id: 'p1',
  section_id: 's1',
  code: 'TST-' + id,
  title: 'Task ' + id,
  description: '',
  status: 'open',
  priority: 'normal',
  owner_email: null,
  owner: null,
  start_date: null,
  due_date: null,
  due_time: null,
  parent_id: null,
  sort: Number(id) * 1000,
  appeal_code: null,
  source_code: null,
  fund_code: null,
  campaign_code: null,
  project: { id: 'p1', key: 'TST', name: 'Test', color: 'leaf' },
  section: 'First',
  subtasks: { done: 0, total: 0 },
  comments: 0,
  files: 0,
  overdue: false,
  blocked: false,
  ...over,
});
const project = { id: 'p1', key: 'TST', name: 'Test', color: 'leaf' };
const sections = [
  { id: 's1', project_id: 'p1', name: 'First', sort: 1000 },
  { id: 's2', project_id: 'p1', name: 'Second', sort: 2000 },
];
const make = (tasks) => new TaskCtx('project', staff, { project, sections, tasks });

describe('dates in Eastern time', () => {
  it('words today, tomorrow and yesterday', () => {
    const t = todayStr();
    assert.equal(dueLabel(t), 'Today');
    assert.equal(dueLabel(addDays(t, 1)), 'Tomorrow');
    assert.equal(dueLabel(addDays(t, -1)), 'Yesterday');
    assert.equal(dueLabel(null), '');
  });
  it('adds a time of day', () => {
    assert.match(dueLabel(todayStr(), '14:30'), /^Today 2:30 PM$/);
    assert.match(dueLabel(todayStr(), '09:00'), /^Today 9 AM$/);
  });
  it('finds the Monday of a week', () => {
    assert.equal(mondayOf('2026-10-14'), '2026-10-12');
    assert.equal(mondayOf('2026-10-11'), '2026-10-05');
  });
});

describe('the task list, grouped and filtered', () => {
  it('puts tasks in their sections in manual order, with no-section tasks last', () => {
    const c = make([task('2', { sort: 2000 }), task('1', { sort: 1000 }), task('3', { section_id: 's2' }), task('4', { section_id: null })]);
    const g = c.grouped();
    assert.deepEqual(g.get('s1').map((t) => t.id), ['1', '2']);
    assert.deepEqual(g.get('s2').map((t) => t.id), ['3']);
    assert.deepEqual(g.get('').map((t) => t.id), ['4']);
  });
  it('hides completed tasks until Show completed is on, but keeps one just finished', () => {
    const c = make([task('1'), task('2', { status: 'done' })]);
    assert.deepEqual(c.grouped().get('s1').map((t) => t.id), ['1']);
    c.keep.add('2');
    c.emit();
    assert.deepEqual(c.grouped().get('s1').map((t) => t.id), ['1', '2']);
  });
  it('filters by owner, due date, priority, code and every word typed', () => {
    const today = todayStr();
    const c = make([
      task('1', { owner_email: 'me@example.org', title: 'Print the flyer', due_date: addDays(today, -2), appeal_code: 'L26B' }),
      task('2', { owner_email: 'ann@example.org', title: 'Mail the flyer', due_date: today, priority: 'high' }),
      task('3', { title: 'Plan the banquet' }),
    ]);
    const ids = () => c.tasks.filter((t) => c.matches(t)).map((t) => t.id);
    c.filter.owner = 'me';
    assert.deepEqual(ids(), ['1']);
    c.filter.owner = 'none';
    assert.deepEqual(ids(), ['3']);
    c.filter.owner = '';
    c.filter.due = 'overdue';
    assert.deepEqual(ids(), ['1']);
    c.filter.due = 'today';
    assert.deepEqual(ids(), ['2']);
    c.filter.due = '';
    c.filter.priority = 'high';
    assert.deepEqual(ids(), ['2']);
    c.filter.priority = '';
    c.filter.code = 'l26b';
    assert.deepEqual(ids(), ['1']);
    c.filter.code = '';
    c.filter.q = 'the flyer';
    assert.deepEqual(ids(), ['1', '2']);
    c.filter.q = 'flyer banquet';
    assert.deepEqual(ids(), []);
  });
  it('sorts by due date with undated tasks last', () => {
    const c = make([task('1', { due_date: '2026-11-02' }), task('2'), task('3', { due_date: '2026-10-20' })]);
    c.sort = { by: 'due', dir: 1 };
    c.emit();
    assert.deepEqual(c.grouped().get('s1').map((t) => t.id), ['3', '1', '2']);
  });
});

describe('a change shows at once and is put back when the server says no', () => {
  it('keeps a saved change and sends only what changed', async () => {
    const c = make([task('1')]);
    reply = () => ({ status: 200, body: { ok: true, task: task('1', { priority: 'high' }) } });
    const ok = await c.patch('1', { priority: 'high' });
    assert.equal(ok, true);
    assert.equal(c.by.get('1').priority, 'high');
    assert.deepEqual(sent.map((s) => [s.method, s.url, s.body]), [['PATCH', '/api/tasks/1', { priority: 'high' }]]);
  });
  it('puts the row back when the change is refused', async () => {
    const c = make([task('1', { owner_email: null })]);
    reply = () => ({ status: 403, body: { ok: false, message: 'Not yours.' } });
    const seen = [];
    c.on(() => seen.push(c.by.get('1').owner_email));
    const ok = await c.patch('1', { owner_email: 'ann@example.org' }, { quiet: true });
    assert.equal(ok, false);
    assert.equal(seen[0], 'ann@example.org');
    assert.equal(c.by.get('1').owner_email, null);
    assert.equal(c.by.get('1').owner, null);
  });
  it('marks a task done and open again', async () => {
    const c = make([task('1')]);
    reply = () => ({ status: 200, body: { ok: true } });
    await c.patch('1', { done: true });
    assert.equal(c.by.get('1').status, 'done');
    assert.ok(c.keep.has('1'));
    await c.patch('1', { done: false });
    assert.equal(c.by.get('1').status, 'open');
  });
  it('a task waiting on someone shows as waiting', async () => {
    const c = make([task('1')]);
    await c.patch('1', { waiting_on_email: 'ann@example.org' });
    assert.equal(c.by.get('1').status, 'waiting');
    await c.patch('1', { waiting_on_email: null });
    assert.equal(c.by.get('1').status, 'open');
  });
});

describe('moving a task', () => {
  it('works out a sort between its new neighbors and tells the server where it went', async () => {
    const c = make([task('1', { sort: 1000 }), task('2', { sort: 2000 }), task('3', { sort: 3000 })]);
    reply = () => ({ status: 200, body: { ok: true, task: task('3', { sort: 1500 }) } });
    await c.move('3', { section_id: 's1', before: '2' });
    assert.equal(c.by.get('3').sort, 1500);
    assert.deepEqual(sent[0].body, { move: { section_id: 's1', before: '2' } });
  });
  it('moves a task into another section and renames its section', async () => {
    const c = make([task('1'), task('2', { section_id: 's2', section: 'Second' })]);
    reply = () => ({ status: 200, body: { ok: true, task: task('1', { section_id: 's2', section: 'Second', sort: 3000 }) } });
    await c.move('1', { section_id: 's2' });
    assert.equal(c.by.get('1').section, 'Second');
    assert.equal(c.by.get('1').section_id, 's2');
  });
  it('puts the task back when the move is refused', async () => {
    const c = make([task('1', { sort: 1000 }), task('2', { sort: 2000 })]);
    reply = () => ({ status: 500, body: { ok: false, message: 'Try again.' } });
    await c.move('2', { section_id: 's1', before: '1' });
    assert.equal(c.by.get('2').sort, 2000);
  });
});

describe('adding and removing', () => {
  it('shows a new task at once, then swaps in the saved one', async () => {
    const c = make([task('1', { sort: 1000 })]);
    reply = () => ({ status: 201, body: { ok: true, task: task('9', { title: 'Mail the flyer', sort: 2000 }) } });
    const p = c.create({ title: 'Mail the flyer', section_id: 's1' });
    assert.equal(c.tasks.length, 2);
    assert.ok(c.tasks[1].pending);
    assert.match(c.tasks[1].id, /^tmp-/);
    const saved = await p;
    assert.equal(saved.id, '9');
    assert.equal(c.tasks[1].id, '9');
    assert.ok(!c.tasks[1].pending);
    assert.ok(c.by.has('9'));
    assert.equal(sent[0].body.section_id, 's1');
  });
  it('takes a new task back out when the server refuses it', async () => {
    const c = make([]);
    reply = () => ({ status: 400, body: { ok: false, message: 'No.' } });
    const r = await c.create({ title: 'Never saved', section_id: 's1' });
    assert.equal(r, null);
    assert.equal(c.tasks.length, 0);
  });
  it('ignores an empty title', async () => {
    const c = make([]);
    assert.equal(await c.create({ title: '   ' }), null);
    assert.equal(c.tasks.length, 0);
    assert.equal(sent.length, 0);
  });
  it('removes tasks and puts one back when the server refuses', async () => {
    const c = make([task('1'), task('2')]);
    reply = (url) => (url.endsWith('/1') ? { status: 200, body: { ok: true } } : { status: 403, body: { ok: false, message: 'Not yours.' } });
    await c.remove(['1', '2']);
    assert.deepEqual(c.tasks.map((t) => t.id), ['2']);
  });
});

describe('sections', () => {
  it('adds, renames and deletes a section, putting tasks in no section when it goes', async () => {
    const c = make([task('1', { section_id: 's2', section: 'Second' })]);
    reply = () => ({ status: 201, body: { ok: true, section: { id: 's3', project_id: 'p1', name: 'Third', sort: 3000 } } });
    const s = await c.addSection('Third');
    assert.equal(s.id, 's3');
    await c.renameSection('s2', 'Next');
    assert.equal(c.by.get('1').section, 'Next');
    await c.deleteSection('s2');
    assert.equal(c.by.get('1').section_id, null);
    assert.equal(c.sections.length, 2);
  });
});

describe('reading every page of a long list', () => {
  it('follows next_offset until the end and drops subtasks', async () => {
    const pages = [
      { tasks: [task('1'), task('2', { parent_id: '1' })], total: 3, counts: { by_section: {} }, next_offset: 2 },
      { tasks: [task('3')], total: 3, next_offset: null },
    ];
    const seen = [];
    const r = await fetchAllTasks(async (q) => {
      seen.push(q.offset);
      return pages.shift();
    }, { project: 'TST' });
    assert.deepEqual(seen, [0, 2]);
    assert.deepEqual(r.tasks.map((t) => t.id), ['1', '3']);
    assert.equal(r.total, 3);
    assert.ok(r.counts);
  });
});

describe('the page address carries the filters', () => {
  it('reads them, drops values it does not know, and turns on Show completed for a done filter', () => {
    const f = filtersFrom(new URLSearchParams('q=flyer&owner=me&due=soon&status=done&code=L26B'));
    assert.equal(f.q, 'flyer');
    assert.equal(f.owner, 'me');
    assert.equal(f.due, '');
    assert.equal(f.status, 'done');
    assert.equal(f.done, true);
    assert.equal(filtersFrom(new URLSearchParams('status=bogus')).status, '');
    assert.equal(filtersFrom(new URLSearchParams('done=1')).done, true);
  });
  it('writes them back and removes the ones that are empty', () => {
    const c = make([]);
    applyFilters(c, filtersFrom(new URLSearchParams('owner=me&due=week')));
    const p = new URLSearchParams('view=board&q=old&status=open');
    writeFilters(c, p);
    assert.equal(p.get('owner'), 'me');
    assert.equal(p.get('due'), 'week');
    assert.equal(p.get('view'), 'board');
    assert.equal(p.has('q'), false);
    assert.equal(p.has('status'), false);
    assert.equal(p.has('done'), false);
    c.showDone = true;
    writeFilters(c, p);
    assert.equal(p.get('done'), '1');
    assert.equal(activeCount(c), 2);
  });
});
