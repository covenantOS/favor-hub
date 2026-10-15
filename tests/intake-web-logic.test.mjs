// The rules behind the request screens in Projects (web/src/features/projects/intake/logic.ts): which tabs a person gets, how My
// requests is ordered, how a team's cards fall into the five columns, what the composer sends, and what its footer says.
// Pure functions with made-up people; nothing here touches a network or a database.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/projects/intake/logic.ts');
const P = await import('../shared/request-parse.ts');

const TODAY = '2026-10-12';
const PEOPLE = [
  { email: 'ada@favorintl.org', name: 'Ada Admin', team: 'Tech', title: 'Lead Developer' },
  { email: 'dan@favorintl.org', name: 'Dan Design', team: 'Marketing', title: 'Creative Director' },
  { email: 'vic@favorintl.org', name: 'Vic Video', team: 'Marketing', title: 'Videographer' },
];
const item = (o = {}) => ({ id: 'r1', status: 'inbox', created_at: '2026-10-10T12:00:00.000Z', question: null, owner: null, team_name: 'Tech', moves: [], ...o });

test('everyone gets My requests, and only people who triage a team get Intake before it', () => {
  assert.deepEqual(L.intakeTabs([], []).map((t) => t.id), ['requests']);
  assert.deepEqual(L.intakeTabs([{ counts: { intake: 2 } }], []).map((t) => t.id), ['intake', 'requests']);
});

test('the Intake count adds every team, and the My requests count is the open ones only', () => {
  const tabs = L.intakeTabs([{ counts: { intake: 2 } }, { counts: { intake: 3 } }], [item({ status: 'inbox' }), item({ status: 'in_progress' }), item({ status: 'done' }), item({ status: 'declined' })]);
  assert.equal(tabs[0].count, 5);
  assert.equal(tabs[1].count, 2);
  assert.equal(tabs[1].label, 'My requests');
});

test('the Intake address shows My requests for a person who triages no team', () => {
  assert.equal(L.resolveTab('intake', false), 'requests');
  assert.equal(L.resolveTab('intake', true), 'intake');
  assert.equal(L.resolveTab('requests', false), 'requests');
  assert.equal(L.resolveTab('mine', true), null, 'other tabs are the home page\'s own');
  assert.equal(L.resolveTab(null, true), null);
});

test('My requests puts a question waiting on the person first, then open ones, then finished ones, each newest first', () => {
  const q = { by: { name: 'Ada Admin' }, body: 'Which page?', at: '2026-10-09T00:00:00Z' };
  const list = [
    item({ id: 'a', status: 'done', created_at: '2026-10-12T00:00:00.000Z' }),
    item({ id: 'b', status: 'inbox', created_at: '2026-10-01T00:00:00.000Z' }),
    item({ id: 'c', status: 'in_progress', created_at: '2026-10-05T00:00:00.000Z' }),
    item({ id: 'd', status: 'inbox', created_at: '2026-09-20T00:00:00.000Z', question: q }),
    item({ id: 'e', status: 'declined', created_at: '2026-10-13T00:00:00.000Z' }),
  ];
  assert.deepEqual(L.orderMine(list).map((r) => r.id), ['d', 'c', 'b', 'e', 'a']);
  assert.deepEqual(list.map((r) => r.id), ['a', 'b', 'c', 'd', 'e'], 'the list it was given is not reordered');
});

test('a question on a request that is already closed does not hold it at the top', () => {
  const q = { by: { name: 'Ada Admin' }, body: 'Which page?', at: '2026-10-09T00:00:00Z' };
  const list = [item({ id: 'x', status: 'declined', question: q, created_at: '2026-10-12T00:00:00.000Z' }), item({ id: 'y', status: 'inbox', created_at: '2026-10-01T00:00:00.000Z' })];
  assert.deepEqual(L.orderMine(list).map((r) => r.id), ['y', 'x']);
});

test('the line under a request says who has it, what it waits on, or that it is closed', () => {
  const q = { by: { name: 'Ada Admin' }, body: 'x', at: '2026-10-09T00:00:00Z' };
  assert.equal(L.standingLine(item()), 'Waiting for Tech to look at it');
  assert.equal(L.standingLine(item({ team_name: 'Marketing' })), 'Waiting for Marketing to look at it');
  assert.equal(L.standingLine(item({ question: q })), 'Waiting for your answer');
  assert.equal(L.standingLine(item({ status: 'approved', owner: { email: 'a@x.org', name: 'Ada Admin' } })), 'Ada Admin has it');
  assert.equal(L.standingLine(item({ status: 'declined' })), 'Closed');
  assert.equal(L.standingLine(item({ status: 'done' })), 'Finished');
  assert.equal(L.lastMove(item({ moves: [{ at: 'x', text: 'one' }, { at: 'y', text: 'two' }] })), 'two');
  assert.equal(L.lastMove(item()), '');
});

const SECTIONS = ['Intake', 'Triage', 'In progress', 'Review', 'Done'].map((name, i) => ({ id: 's' + i, name }));
const task = (id, section, o = {}) => ({ id, section_id: section, status: 'open', sort: 1000, title: id, ...o });

test('cards fall into the five columns by their section, in order, with the stage and the word the asker reads', () => {
  const tasks = [task('t1', 's0', { sort: 2000 }), task('t2', 's0', { sort: 1000 }), task('t3', 's1'), task('t4', 's2'), task('x', 's9')];
  const cols = L.columnsFor(SECTIONS, tasks, []);
  assert.deepEqual(cols.map((c) => c.name), ['Intake', 'Triage', 'In progress', 'Review', 'Done']);
  assert.deepEqual(cols.map((c) => c.cards.length), [2, 1, 1, 0, 0]);
  assert.deepEqual(cols[0].cards.map((c) => c.task.id), ['t2', 't1'], 'manual order inside a column');
  assert.deepEqual(cols.map((c) => c.word), ['Sent', 'Approved', 'In progress', 'In progress', 'Done']);
  assert.deepEqual(cols.map((c) => c.stage), ['Intake', 'Triage', 'In progress', 'Review', 'Done']);
});

test('a card carries the request behind it when the queue has one, and a dropped card is left out', () => {
  const tasks = [task('t1', 's0'), task('t2', 's0', { status: 'dropped' }), task('t3', 's1')];
  const items = [{ id: 'r1', task: { id: 't1', code: 'TRQ-0001', url: '' }, title: 'One' }];
  const cols = L.columnsFor(SECTIONS, tasks, items);
  assert.equal(cols[0].cards.length, 1);
  assert.equal(cols[0].cards[0].item.id, 'r1');
  assert.equal(cols[1].cards[0].item, null, 'a card with no open request behind it is still drawn');
});

test('Done shows the latest finished cards first and only as many as asked, with the full count kept', () => {
  const done = Array.from({ length: 5 }, (_, i) => task('d' + i, 's4', { status: 'done', done_at: `2026-10-0${i + 1}T00:00:00Z` }));
  const cols = L.columnsFor(SECTIONS, done, [], { doneLimit: 3, counts: { s4: { done: 9 } } });
  assert.deepEqual(cols[4].cards.map((c) => c.task.id), ['d4', 'd3', 'd2']);
  assert.equal(cols[4].total, 9);
});

test('a card whose question is open reads Waiting on the person who asked', () => {
  assert.equal(L.waitingOn({ question: { body: 'x' }, submitter: { name: 'Vic Video' } }), 'Waiting on Vic');
  assert.equal(L.waitingOn({ question: null, submitter: { name: 'Vic Video' } }), '');
});

test('the chips show what the words say until the person changes one', () => {
  const p = P.parseRequest('We need a flyer for the church banquet by October 30, ask Dan', TODAY, { people: PEOPLE });
  const v = L.effective(p, {});
  assert.equal(v.team, 'marketing');
  assert.equal(v.place, 'print');
  assert.equal(v.audience, 'Churches');
  assert.equal(v.due, '2026-10-30');
  assert.equal(v.ask, 'dan@favorintl.org');
  const e = L.effective(p, { kind: 'change', due: '', ask: '' });
  assert.equal(e.kind, 'change');
  assert.equal(e.due, '', 'a cleared date stays cleared');
  assert.equal(e.ask, '', 'Nobody in particular stays chosen');
});

test('changing the team resets Where and Who sees it to that team\'s choices', () => {
  const p = P.parseRequest('We need a flyer for the church banquet by October 30', TODAY, { people: PEOPLE });
  let edits = L.applyEdit({}, 'place', 'social');
  assert.equal(L.effective(p, edits).place, 'social');
  edits = L.applyEdit(edits, 'team', 'tech');
  assert.equal(edits.place, undefined);
  const v = L.effective(p, edits);
  assert.equal(v.team, 'tech');
  assert.equal(v.place, 'website');
  assert.equal(v.audience, 'Not sure who sees it');
});

test('the request sent holds the chips as shown, and a suggested owner nobody confirmed is not sent', () => {
  const text = 'We need a flyer for the church banquet by October 30';
  const guess = { email: 'vic@favorintl.org', name: 'Vic Video', why: 'took the last 3' };
  const p = P.parseRequest(text, TODAY, { people: PEOPLE, ownerGuess: guess });
  assert.equal(p.assignee.guess, true);
  const body = L.submitBody(`  ${text}  `, p, {});
  assert.deepEqual(body, { text, team: 'marketing', kind: 'add', place: 'print', audience: 'Churches', due_date: '2026-10-30' });
  assert.equal('assignee' in body, false);
  assert.equal(L.submitBody(text, p, { ask: 'vic@favorintl.org' }).assignee, 'vic@favorintl.org');
  assert.equal(L.submitBody(text, p, { ask: '' }).assignee, null);
  const named = P.parseRequest(text + ', ask Dan', TODAY, { people: PEOPLE });
  assert.equal(L.submitBody(text + ', ask Dan', named, {}).assignee, 'dan@favorintl.org', 'a person named in the words is sent');
});

test('a request about money is read as the expense team, which the composer sends to the expense form', () => {
  const p = P.parseRequest('Please reimburse my hotel for the conference', TODAY, { people: PEOPLE });
  assert.equal(L.effective(p, {}).team, 'expense');
  assert.equal(L.whereLands('expense', null), 'Goes to the expense form, not to a board.');
});

test('the footer names the board and who triages it', () => {
  assert.equal(L.whereLands('marketing', 'Dan Design'), 'Marketing requests, Intake. Dan Design triages it.');
  assert.equal(L.whereLands('tech', 'Ada Admin'), 'Tech requests, Intake. Ada Admin triages it.');
  assert.equal(L.whereLands('tech', null), 'Tech requests, Intake. Tech triages it.');
  assert.equal(L.whereLands(null, null), "Lands in Intake on the owning team's board.");
  assert.deepEqual(L.whereParts('tech', 'Ada Admin'), { strong: 'Tech requests', rest: ', Intake. Ada Admin triages it.' });
});

test('the triager is read from the staff list the way the server picks a pipeline lead', () => {
  assert.equal(L.triagerOf('tech', PEOPLE).name, 'Ada Admin');
  assert.equal(L.triagerOf('marketing', PEOPLE).name, 'Dan Design');
  assert.equal(L.triagerOf('tech', []), null);
});

test('files: pictures, PDF, Word and text under 4 MB, up to six, and the rest are counted as refused', () => {
  const f = (name, type, size = 1000) => ({ name, type, size });
  assert.equal(L.fileAllowed(f('a.png', 'image/png')), true);
  assert.equal(L.fileAllowed(f('a.PDF', '')), true);
  assert.equal(L.fileAllowed(f('a.docx', '')), true);
  assert.equal(L.fileAllowed(f('a.exe', 'application/octet-stream')), false);
  assert.equal(L.fileAllowed(f('big.png', 'image/png', 5 * 1024 * 1024)), false);
  const six = Array.from({ length: 6 }, (_, i) => f(i + '.png', 'image/png'));
  const r = L.addFiles(six.slice(0, 5), [f('x.png', 'image/png'), f('y.png', 'image/png'), f('z.exe', '')]);
  assert.equal(r.files.length, 6);
  assert.equal(r.refused, 2);
});

test('dates and times read the way the cards show them', () => {
  assert.equal(L.fullDate('2026-10-30'), 'Fri, Oct 30');
  assert.equal(L.fullDate(null), '');
  const now = Date.parse('2026-10-15T12:00:00Z');
  assert.equal(L.when('2026-10-15T11:59:30Z', now), 'just now');
  assert.equal(L.when('2026-10-15T11:55:00Z', now), '5 min ago');
  assert.equal(L.when('2026-10-15T10:00:00Z', now), '2 hours ago');
  assert.equal(L.when('2026-10-14T09:00:00Z', now), 'yesterday');
  assert.equal(L.when('2026-10-10T12:00:00Z', now), '5 days ago');
  assert.equal(L.when('2026-09-01T12:00:00Z', now), 'on Sep 1');
});
