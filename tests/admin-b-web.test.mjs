// The rules behind the Admin settings pages in the web app (web/src/features/admin-b): which setting asks to confirm and in what words, how rows group,
// what the Gifts page converts before it sends, how the Appeal codes form fills and when its create button turns on, and what the Asana import sends.
// Made-up values only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const S = await import('../web/src/features/admin-b/settings.ts');
const G = await import('../web/src/features/admin-b/gifts.ts');
const A = await import('../web/src/features/admin-b/appeals.ts');
const P = await import('../web/src/features/admin-b/projects.ts');
const F = await import('../web/src/features/admin-b/format.ts');

const set = (o = {}) => ({ id: 'wc.release', group: '', label: 'Who can open it', hint: '', kind: 'enum', options: [{ value: 'admins', label: 'Admins only' }, { value: 'staff', label: 'Staff on the list' }], unit: '', bb: false, contact: false, spend: false, value: 'admins', saved: false, by: '', at: '', canReset: false, ...o });

test('a setting asks first when it touches Blackbaud, emails partners or can cost money', () => {
  assert.equal(S.needsConfirm(set()), false);
  assert.equal(S.needsConfirm(set({ bb: true })), true);
  assert.equal(S.needsConfirm(set({ contact: true })), true);
  assert.equal(S.needsConfirm(set({ spend: true })), true);
});

test('the confirm sentence names the reason, and values read as labels, blank or a number with its unit', () => {
  assert.match(S.confirmLead(set({ bb: true })), /changes what FavorOS sends to Blackbaud\. It is $/);
  assert.match(S.confirmLead(set({ contact: true })), /changes whether FavorOS emails partners\. It is $/);
  assert.match(S.confirmLead(set({ spend: true })), /can add model charges past the free allowance\. It is $/);
  assert.equal(S.shown(set(), 'staff'), 'Staff on the list');
  assert.equal(S.shown(set({ kind: 'text', options: [] }), ''), 'blank');
  assert.equal(S.shown(set({ kind: 'int', options: [], unit: 'days' }), '21'), '21 days');
});

test('reset says the Pages value for a meeting setting or the receipt line, the default for the rest', () => {
  assert.equal(S.resetWord(set({ id: 'meet.release' })), 'the Pages value');
  assert.equal(S.resetWord(set({ id: 'receipts.report' })), 'the Pages value');
  assert.equal(S.resetWord(set({ id: 'receipts.days' })), 'the default');
});

test('rows group in the order the groups first appear, and the control id matches the classic one', () => {
  const g = S.grouped([set({ id: 'a', group: 'One' }), set({ id: 'b', group: '' }), set({ id: 'c', group: 'One' }), set({ id: 'd', group: 'Two' })]);
  assert.deepEqual(g.map((x) => [x.group, x.rows.map((r) => r.id).join('')]), [['One', 'ac'], ['', 'b'], ['Two', 'd']]);
  assert.equal(S.controlId('wc.start.admin'), 'f-wc-start-admin');
});

test('second approval accepts dollars with or without a sign and commas, and blank is off', () => {
  assert.equal(G.secondDollars('$1,500.50'), 1500.5);
  assert.equal(G.secondDollars(' 2 500 '), 2500);
  assert.equal(G.secondDollars(''), 0);
  assert.equal(F.money(150050), '$1,500.50');
});

const appeals = { prefixes: [{ letter: 'L', label: 'Letter', hint: 'Month letter', category: 'Letters', suffix: 'K' }, { letter: 'N', label: 'Newsletter', hint: 'EMW and the week', category: 'Gone' }], categories: [{ category: 'Letters' }] };

test('an appeal kind sets its hint, date label, suffix hint, category and the online twin', () => {
  const l = A.kindFill(appeals, 'L');
  assert.deepEqual([l.dateLabel, l.placeholder, l.category, l.online], ['Start date', 'K', 'Letters', true]);
  const n = A.kindFill(appeals, 'N');
  assert.deepEqual([n.dateLabel, n.placeholder, n.category, n.online], ['Send date', 'EMW and the week, filled in for you', '', false]);
});

test('create turns on only for a built code that Blackbaud does not have, and not while one is running', () => {
  assert.equal(A.canCreate(false, [{}], []), true);
  assert.equal(A.canCreate(true, [{}], []), false);
  assert.equal(A.canCreate(false, [], []), false);
  assert.equal(A.canCreate(false, [{}], ['X']), false);
  assert.equal(A.createdText({ created: [{ ok: true, code: 'A' }, { ok: false, code: 'A-WS', error: 'Already there.' }], wiring: ['Wired.'] }), 'Created A. A-WS: Already there. Wired.');
});

test('the Asana import sends the projects picked, the options, and the address map in lower case', () => {
  assert.deepEqual(P.emailMap('Pat@Gmail.com = pat@favorintl.org\nbad line\nx@y.org,z@favorintl.org'), { 'pat@gmail.com': 'pat@favorintl.org', 'x@y.org': 'z@favorintl.org' });
  const b = P.runBody('export', 'dry', { e1: 'One' }, { ...P.DEFAULT_OPTIONS, team: 'Marketing' }, 'exp_ab');
  assert.deepEqual(b.projects, [{ ref: 'e1', name: 'One' }]);
  assert.equal(b.upload, 'exp_ab');
  assert.equal(b.options.team, 'Marketing');
  assert.equal('upload' in P.runBody('api', 'dry', {}, P.DEFAULT_OPTIONS, 'x'), false);
});

test('Import unlocks only after a dry run on the same projects and source, with no run going', () => {
  const key = P.pickedKey({ b: 'B', a: 'A' }, 'api', '');
  assert.equal(key, 'a|b|api|');
  assert.equal(P.importReady({ id: 'r', key }, key, false), true);
  assert.equal(P.importReady({ id: 'r', key }, P.pickedKey({ a: 'A' }, 'api', ''), false), false);
  assert.equal(P.importReady({ id: 'r', key }, key, true), false);
  assert.equal(P.importReady(null, key, false), false);
});

test('the admin projects address carries the part after /projects in ?p= and keeps extra query', () => {
  assert.equal(P.projectsUrl(''), '/api/admin/projects');
  assert.equal(P.projectsUrl('/settings'), '/api/admin/projects?p=settings');
  assert.equal(P.projectsUrl('/asana?archived=1'), '/api/admin/projects?p=asana&archived=1');
  assert.equal(P.projectsUrl('/runs/r1/step'), '/api/admin/projects?p=runs/r1/step');
});

test('the report totals add up tags, fields, dependencies and the tasks kept, repeated or unreadable', () => {
  const p = (n) => ({ name: 'P' + n, tasks: { create: 1, update: 2, same: 3, kept: n, subtasks: 0, alsoIn: n, errors: 1 }, sections: {}, comments: {}, files: {}, tags: n, fields: 1, deps: 2 });
  assert.deepEqual(P.reportTotals([p(1), p(2)]), { kept: 3, also: 3, err: 2, tags: 3, fields: 2, deps: 4 });
  assert.equal(P.dryTasks({ a: p(1), b: p(2) }), 6);
  assert.equal(P.dryTasks(undefined), 0);
});

test('times read in Eastern: today and yesterday by name, other days by date', () => {
  const now = Date.parse('2026-10-15T16:00:00Z');
  assert.equal(F.when('2026-10-15T13:05:00Z', now), 'Today 9:05 AM ET');
  assert.equal(F.when('2026-10-14T13:05:00Z', now), 'Yesterday 9:05 AM ET');
  assert.equal(F.when('2026-10-01T13:05:00Z', now), 'Oct 1, 9:05 AM ET');
  assert.equal(F.when('', now), 'No run on record');
  assert.equal(F.ago('2026-10-15T15:50:00Z', now), '10 min ago');
  assert.equal(F.ago('2026-10-15T15:59:30Z', now), 'just now');
});
