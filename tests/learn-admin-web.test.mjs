// Learn admin in the web app: the pure rules behind Manage and the course editor, and the route registration.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/learn-admin/logic.ts');
const { WEB_ROUTES } = await import('../shared/web.ts');

describe('words and dates', () => {
  it('plural, minutes and day words', () => {
    assert.equal(L.plural(1, 'lesson'), '1 lesson');
    assert.equal(L.plural(2, 'person', 'people'), '2 people');
    assert.equal(L.mins(45), '45 min');
    assert.equal(L.mins(90), '1 hr 30 min');
    assert.equal(L.mins(120), '2 hr');
    assert.equal(L.dayWord('2026-10-09T12:00:00Z'), 'Oct 9');
    assert.equal(L.addDays('2026-10-30', 3), '2026-11-02');
  });
});

describe('lessons', () => {
  const ls = ['a', 'b', 'c'].map((id) => ({ id, kind: 'page', title: id, ref: '', minutes: 0, body: '' }));
  it('drop and arrows reorder', () => {
    assert.deepEqual(L.dropOrder(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
    assert.deepEqual(L.dropOrder(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
    assert.deepEqual(L.swapOrder(['a', 'b', 'c'], 1, 0), ['b', 'a', 'c']);
    assert.deepEqual(L.reorderLessons(ls, ['c', 'a', 'b']).map((l) => l.id), ['c', 'a', 'b']);
  });
  it('meta line', () => {
    assert.equal(L.lessonMeta({ ...ls[0], kind: 'link', ref: 'https://example.org/x' }), 'Link · example.org/x');
    assert.equal(L.lessonMeta({ ...ls[0], kind: 'quiz', quiz: { pass: 80, questions: [{}, {}] } }), 'Quiz · 2 questions');
  });
  it('urls become documents or links', () => {
    assert.equal(L.urlKind('https://docs.google.com/document/d/1'), 'doc');
    assert.deepEqual(L.urlLessonBody(' https://example.org ', ''), { kind: 'link', ref: 'https://example.org', title: 'Link' });
  });
  it('help search caps results', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ kind: 'video', url: `/help/videos/v${i}/`, title: 'Video ' + i, summary: '', text: 'giving' }));
    const items = L.helpItems(raw);
    assert.equal(items[0].ref, 'v0');
    assert.equal(L.helpHits(items, '', 'video').length, 8);
    assert.equal(L.helpHits(items, 'giving', 'video').length, 12);
    assert.equal(L.helpHits(items, 'zzz', 'video').length, 0);
  });
});

describe('assign', () => {
  const o = { courses: [{ id: 'c1', title: 'C', status: 'published' }, { id: 'c2', title: 'D', status: 'draft' }], paths: [{ id: 'p1', title: 'P', status: 'published' }] };
  it('targets list published paths then courses', () => {
    assert.deepEqual(L.assignTargets(o), [['path:p1', 'Path: P'], ['course:c1', 'Course: C']]);
    assert.equal(L.targetFromSearch({ course: 'c1', path: 'p1' }), 'path:p1');
  });
  it('checks in order and builds the body', () => {
    const a = { ...L.blankAssign(), target: 'course:c1' };
    assert.equal(L.assignProblem(a, false), 'Choose a course or a path.');
    assert.equal(L.assignProblem(a, true), 'Pick at least one person.');
    assert.equal(L.assignProblem({ ...a, who: 'team' }, true), 'Choose a team.');
    assert.equal(L.assignProblem({ ...a, who: 'everyone' }, true), '');
    assert.deepEqual(L.assignBody({ ...a, emails: ['a@b.org'], due: '2026-11-01', note: 'Hi' }), { kind: 'course', target: 'c1', emails: ['a@b.org'], team: undefined, everyone: false, due_date: '2026-11-01', note: 'Hi' });
  });
  it('summary sentence', () => {
    assert.equal(L.assignSummary({}), 'Nothing changed.');
    assert.equal(L.assignSummary({ created: 2, already_done: 1, told: 2, tasks: 1 }), '2 people assigned, 1 had already finished it. 2 told, 1 task added in Projects.');
  });
});

describe('report', () => {
  it('query string, learning menu and csv', () => {
    const f = { ...L.blankFilters(), team: 'A B', status: 'done' };
    assert.equal(L.reportQs(f), 'team=A%20B&status=done');
    const p = L.pickLearning(f, 'p:slug');
    assert.equal(p.path, 'slug');
    assert.equal(L.learningValue(p), 'p:slug');
    const csv = L.reportCsv([{ name: 'Ada "A" Example', team: 'T', title: 'X', kind: 'course', due_date: null, status: 'overdue', pct: 40, best_score: null, last_at: '2026-10-01T10:00:00Z', completed_at: null }]);
    assert.equal(csv.split('\r\n')[1], '"Ada ""A"" Example","T","X","course","","Late","40","","2026-10-01",""');
  });
});

describe('quiz editor', () => {
  it('switching kinds and removing answers', () => {
    const q = { id: 'q1', kind: 'choice', text: '', options: ['a', 'b', 'c'], answer: 2, explain: '' };
    assert.deepEqual(L.changeKind(q, 'tf').options, ['True', 'False']);
    assert.equal(L.changeKind(q, 'tf').answer, 1);
    assert.equal(L.removeOption(q, 0).answer, 1);
    assert.equal(L.removeOption(q, 2).answer, 0);
  });
  it('saving drops blanks and keeps the right answer on its text', () => {
    const q = { pass: 80, questions: [{ id: 'x', kind: 'choice', text: 'T', options: ['', 'a', ' b '], answer: 2, explain: '' }] };
    const c = L.cleanQuizForSave(q, '0');
    assert.equal(c.pass, 80);
    assert.deepEqual(c.questions[0].options, ['a', 'b']);
    assert.equal(c.questions[0].answer, 1);
    assert.equal(c.questions[0].id, 'q1');
  });
});

describe('route', () => {
  it('owns /learn/admin/ and not /learn/', () => {
    assert.ok(WEB_ROUTES.includes('/learn/admin/'));
    assert.ok(!WEB_ROUTES.includes('/learn/'));
  });
});
