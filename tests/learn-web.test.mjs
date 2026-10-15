// The learner pages in the web app (web/src/features/learn): addresses, card lines, what a saved lesson does to the course copy, video
// resume, the written-page Markdown, the quiz notes and the Practice record's merged lists. Made-up data only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/learn/logic.ts');
const F = await import('../web/src/features/learn/shared/format.ts');
const M = await import('../web/src/features/learn/shared/parse.ts');

const lesson = (id, state = 'new', extra = {}) => ({ id, kind: 'video', title: id, ref: id, minutes: 5, body: '', state, position: 0, ...extra });
const course = (over = {}) => ({
  kind: 'course', id: 'c1', slug: 'basics', title: 'Basics', summary: '', audience: '', color: 'leaf', status: 'published', href: '/learn/c/?c=basics',
  lessons: 3, minutes: 15, done: 0, total: 3, pct: 0, state: 'new', completed_at: null, last_at: null,
  lesson_list: [lesson('a'), lesson('b'), lesson('c')], next_id: 'a', assignment: null, paths: [], ...over,
});

describe('addresses', () => {
  it('keep the old query-string shapes', () => {
    assert.equal(L.courseHref('gift entry'), '/learn/c/?c=gift%20entry');
    assert.equal(L.courseHref('basics', 'l1'), '/learn/c/?c=basics&l=l1');
    assert.equal(L.pathHref('rdd'), '/learn/p/?p=rdd');
    assert.equal(L.certHref('basics'), '/learn/certificate/?c=basics');
    assert.equal(L.slugOf(undefined), '');
    assert.equal(L.slugOf(7), '7');
  });
});

describe('formatters', () => {
  it('dates and lengths read the same on the server and in the browser', () => {
    assert.equal(F.dayWord('2026-10-05'), 'Oct 5');
    assert.equal(F.longDay('2026-10-15T16:00:00Z'), 'October 15, 2026');
    assert.equal(F.mins(45), '45 min');
    assert.equal(F.mins(125), '2 hr 5 min');
    assert.equal(F.clockTime(125), '2:05');
    assert.equal(F.plural(1, 'try', 'tries'), '1 try');
    assert.equal(F.plural(2, 'try', 'tries'), '2 tries');
  });
});

describe('cards', () => {
  it('due chips', () => {
    assert.equal(L.dueChip({ due_date: null, overdue: false, days_left: null }), null);
    assert.equal(L.dueChip({ due_date: '2026-10-10', overdue: true, days_left: -5 }).text, 'Late, was due Oct 10');
    assert.equal(L.dueChip({ due_date: '2026-10-15', overdue: false, days_left: 0 }).text, 'Due today');
    assert.equal(L.dueChip({ due_date: '2026-10-16', overdue: false, days_left: 1 }).text, 'Due tomorrow');
    assert.equal(L.dueChip({ due_date: '2026-10-20', overdue: false, days_left: 5 }).text, 'Due Oct 20');
  });
  it('size and progress lines', () => {
    assert.equal(L.sizeLine({ kind: 'course', lessons: 1, minutes: 0 }), '1 lesson');
    assert.equal(L.sizeLine({ kind: 'path', courses: 3, minutes: 90 }), '3 courses · about 1 hr 30 min');
    assert.equal(L.progLine({ state: 'done', completed_at: '2026-10-01T10:00:00Z', total: 3, done: 3 }), 'Completed Oct 1');
    assert.equal(L.progLine({ state: 'started', completed_at: null, total: 3, done: 1 }), '1 of 3 lessons done');
  });
  it('the catalog filter and search', () => {
    const c = { title: 'Gift entry', summary: 'Enter a check', audience: 'Admin desk', state: 'new' };
    assert.ok(L.catalogHit(c, 'all', ''));
    assert.ok(L.catalogHit(c, 'new', 'CHECK'));
    assert.ok(!L.catalogHit(c, 'done', ''));
    assert.ok(!L.catalogHit(c, 'all', 'grants'));
  });
});

describe('course page', () => {
  it('Start, Continue and Review open the right lesson', () => {
    assert.deepEqual(L.courseStart(course()), { cta: 'Start', startId: 'a' });
    assert.deepEqual(L.courseStart(course({ state: 'started', next_id: 'b' })), { cta: 'Continue', startId: 'b' });
    assert.deepEqual(L.courseStart(course({ state: 'done' })), { cta: 'Review', startId: 'a' });
  });
  it('a lesson line says where a video stopped and the best quiz score', () => {
    assert.equal(L.lessonSub(lesson('a', 'started', { position: 125 })), 'Video · stopped at 2:05');
    assert.equal(L.lessonSub(lesson('q', 'new', { kind: 'quiz', best: 80 })), 'Quiz · best 80%');
  });
  it('finishing a lesson updates the copy in hand and the last one completes the course', () => {
    const c = course();
    const one = L.applyAnswer(c, { course: { done: 1, total: 3, pct: 33, completed: null } }, 'a', 'done');
    assert.equal(one.lesson_list[0].state, 'done');
    assert.equal(one.state, 'started');
    assert.equal(one.done, 1);
    assert.equal(c.lesson_list[0].state, 'new', 'the old copy is untouched');
    const all = L.applyAnswer(one, { course: { done: 3, total: 3, pct: 100, completed: { at: 'x' } } }, 'c', 'done');
    assert.equal(all.state, 'done');
    assert.ok(all.completed);
    assert.equal(L.applyAnswer(c, { preview: true, course: { done: 3, total: 3, pct: 100, completed: {} } }, 'a', 'done'), c, 'a draft preview records nothing');
  });
});

describe('video resume', () => {
  it('resumes where the person stopped, but not at the very start, near the end or when done', () => {
    assert.equal(L.resumeAt({ state: 'started', position: 90 }, 600), 90);
    assert.equal(L.resumeAt({ state: 'started', position: 2 }, 600), 0);
    assert.equal(L.resumeAt({ state: 'started', position: 598 }, 600), 0);
    assert.equal(L.resumeAt({ state: 'done', position: 90 }, 600), 0);
  });
  it('media addresses carry the cut version', () => {
    assert.equal(L.mediaSrc('intro', 'mp4', 'v2'), '/api/videos/intro.mp4?v=v2');
    assert.equal(L.mediaSrc('intro', 'vtt'), '/api/videos/intro.vtt');
  });
  it('Drive links get a preview frame; other links do not', () => {
    assert.equal(L.driveInfo('https://docs.google.com/document/d/abc_123/edit').preview, 'https://docs.google.com/document/d/abc_123/preview');
    assert.equal(L.driveInfo('https://drive.google.com/file/d/xyz/view').preview, 'https://drive.google.com/file/d/xyz/preview');
    assert.equal(L.driveInfo('https://example.com/x'), null);
    assert.equal(L.safeUrl('javascript:alert(1)'), '#');
  });
});

describe('quiz notes', () => {
  it('explain wrong answers always and right answers once passed', () => {
    assert.equal(L.whyLine({ correct: false, explain: 'Because.' }, false), 'Not quite. Because.');
    assert.equal(L.whyLine({ correct: true, explain: 'Because.' }, false), '');
    assert.equal(L.whyLine({ correct: true, explain: 'Because.' }, true), 'Right. Because.');
    assert.equal(L.whyLine(undefined, true), '');
  });
});

describe('written pages', () => {
  it('headings, lists, emphasis and https links', () => {
    const b = M.parseMarkdown('## Title\n\nA **bold** and *soft* word with [a link](https://example.com/x).\n\n- one\n- two\n\n1. first\n2. second\n\n### Small');
    assert.deepEqual(b.map((x) => x.t), ['h2', 'p', 'ul', 'ol', 'h3']);
    const p = b[1].lines[0];
    assert.deepEqual(p.map((x) => x.t), ['text', 'b', 'text', 'i', 'text', 'a', 'text']);
    assert.equal(p[5].href, 'https://example.com/x');
    assert.equal(b[2].items.length, 2);
  });
  it('a link that is not https stays text and markup stays text', () => {
    const b = M.parseMarkdown('[bad](javascript:alert(1)) <script>x</script>');
    assert.ok(b[0].lines[0].every((x) => x.t === 'text'));
  });
});

describe('practice record', () => {
  const D = {
    partner: { history: [{ date: '2026-08-14', amount: 50, fund: 'Wells', type: 'One-time gift' }], notes: [{ date: '2026-08-15', text: 'Thanked.' }] },
    entries: [
      { id: '1', kind: 'gift', ok: true, at: '2026-10-12T10:00:00Z', fields: { date: '2026-10-12', amount: '75', fund: 'Wells' } },
      { id: '2', kind: 'gift', ok: false, at: '2026-10-12T10:01:00Z', fields: { date: '2026-10-13', amount: '5', fund: 'Wells' } },
      { id: '3', kind: 'task', ok: true, at: '2026-10-12T11:00:00Z', fields: { due: '2026-10-19', what: 'Send receipt' } },
    ],
  };
  it('merges the entries that passed into the history and the notes, newest first', () => {
    const h = L.practiceHistory(D);
    assert.equal(h.length, 2);
    assert.equal(h[0].mine, true);
    assert.equal(h[0].amount, 75);
    const n = L.practiceNotes(D);
    assert.equal(n[0].text, 'Task, due 10/19/2026. Send receipt');
    assert.equal(n[1].mine, false);
  });
  it('money, dates and the receipt line', () => {
    assert.equal(L.practiceMoney(75), '$75.00');
    assert.equal(L.us('2026-10-12'), '10/12/2026');
    assert.equal(L.plusDays('2026-10-12', 7), '2026-10-19');
    assert.equal(L.receiptAmount('$1,075'), '$1075');
    assert.equal(L.receiptAmount(''), '$0.00');
  });
});
