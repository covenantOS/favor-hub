// The Evaluations screens in the web app: the pure rules behind them (progress, what is left before a form can be submitted, tabs by role,
// the term picker's groups and shift-click range, dates and the address).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/evaluations/logic.ts');
const { WEB_ROUTES } = await import('../shared/web.ts');

const form = {
  id: 'A',
  sections: [
    { id: 's1', title: 'One', questions: [{ id: 'n', kind: 'auto', text: 'Name', auto: 'name' }, { id: 'r1', n: 1, kind: 'rating', text: 'Rate' }, { id: 't1', n: 2, kind: 'text', req: true, text: 'Say' }, { id: 't2', n: 3, kind: 'text', text: 'Optional' }] },
    { id: 's2', title: 'Two', questions: [{ id: 'c1', kind: 'choice', text: 'Pick', options: ['a', 'b'] }] },
  ],
};
const a = (qid, p = {}) => ({ qid, rating: null, text: '', example: '', ...p });

describe('progress and gaps', () => {
  it('counts ratings, choices and required text; Not Observed (0) is an answer', () => {
    const m = L.byId([a('r1', { rating: 0 }), a('t1', { text: 'x' })]);
    assert.deepEqual(L.secProgress(form.sections[0], m), { done: 2, total: 2 });
    assert.deepEqual(L.secProgress(form.sections[1], m), { done: 0, total: 1 });
    assert.deepEqual(L.totalsOf(form, m), { done: 2, total: 3 });
  });
  it('a 1 or 2 needs an example before it counts', () => {
    const m = L.byId([a('r1', { rating: 2 }), a('t1', { text: 'x' }), a('c1', { text: 'a' })]);
    assert.equal(L.totalsOf(form, m).done, 2);
    const g = L.gapsOf(form, m);
    assert.deepEqual(g.map((x) => x.why), ['Add an example']);
    assert.equal(L.gapsOf(form, L.byId([a('r1', { rating: 2, example: 'e' }), a('t1', { text: 'x' }), a('c1', { text: 'a' })])).length, 0);
  });
  it('lists gaps in form order with the page wording', () => {
    const g = L.gapsOf(form, {});
    assert.deepEqual(g.map((x) => x.why), ['Rate this', 'Answer this', 'Choose one']);
    assert.equal(L.gapLabel(g[0]), 'Rate this: 1. Rate');
    assert.equal(L.gapLabel({ si: 0, why: 'Answer this', q: { id: 'z', kind: 'text', text: 'x'.repeat(80) } }), 'Answer this: ' + 'x'.repeat(70) + '...');
  });
  it('unsaved edits sit on top of saved answers', () => {
    const m = L.merged([a('t1', { text: 'old' })], { t1: a('t1', { text: 'new' }) });
    assert.equal(m.t1.text, 'new');
    assert.equal(L.percent(1, 3), 33);
    assert.equal(L.percent(0, 0), 0);
  });
});

describe('reviewers and times', () => {
  const lim = { reviewersMin: 2, reviewersMax: 3 };
  it('puts the supervisor first when the chosen list lacks them, and leaves a full list alone', () => {
    assert.deepEqual(L.withSupervisor(['b', 'c'], 'a'), ['a', 'b', 'c']);
    assert.deepEqual(L.withSupervisor(['a', 'c'], 'a'), ['a', 'c']);
    assert.deepEqual(L.withSupervisor(['b'], ''), ['b']);
  });
  it('says what is wrong with the count', () => {
    assert.match(L.askHint(1, lim), /at least 2/);
    assert.equal(L.askHint(2, lim), '');
    assert.match(L.askHint(4, lim), /No more than 3/);
  });
  it('writes a clock time in Eastern words', () => {
    assert.equal(L.timeWord('14:30'), '2:30 PM Eastern');
    assert.equal(L.timeWord('09:05'), '9:05 AM Eastern');
    assert.equal(L.timeWord(''), '');
  });
  it('two steps: feedback stays in week 1 until its date passes', () => {
    assert.equal(L.STEPS({ w1: 'a', w2: 'b', w3: 'b' }).length, 2);
    assert.equal(L.stepNow('feedback', '2026-01-12', '2026-01-10').cur, 1);
    assert.equal(L.stepNow('feedback', '2026-01-12', '2026-01-13').cur, 2);
    assert.equal(L.stepNow('meeting').cur, 2);
    assert.equal(L.stepNow('done').done, true);
  });
});

describe('tabs by role', () => {
  const base = { case: {}, next: '' };
  const names = (v) => L.tabsFor({ ...base, ...v }).map((t) => t[0]);
  it('the employee', () => assert.deepEqual(names({ role: { employee: true }, evidence: {}, case: { meetingOn: '2026-01-14' } }), ['overview', 'self', 'evidence', 'reviewers', 'final']));
  it('the supervisor, HR and admins', () => assert.deepEqual(names({ role: { raw: true }, self: {}, evidence: {} }), ['overview', 'self', 'evidence', 'feedback', 'compare', 'final']));
  it('a reviewer sees only their own form, and opens it', () => {
    const v = { ...base, role: {}, mineB: {} };
    assert.deepEqual(names(v), ['overview', 'mine']);
    assert.equal(L.tabShown(v, ''), 'mine');
    assert.equal(L.tabShown(v, 'feedback'), 'mine');
    assert.equal(L.tabShown({ ...base, role: { raw: true } }, 'final'), 'final');
  });
});

describe('the term picker', () => {
  const P = (email, startDate, open = false) => ({ email, name: email, title: '', team: 'T', startDate, hasSupervisor: true, open });
  const people = [P('a', '2025-02-01'), P('b', '2025-08-01'), P('c', ''), P('d', '2025-03-01', true), P('e', '2025-04-01')];
  it('groups by start month', () => {
    assert.deepEqual(people.map(L.groupOf), ['first', 'second', 'unknown', 'first', 'first']);
  });
  it('picks the January to June starters with no open evaluation first', () => {
    assert.deepEqual(Object.keys(L.firstPicked(people)), ['a', 'e']);
  });
  it('filters by name or team and hides empty groups', () => {
    assert.deepEqual(L.visiblePeople(people, 'b').map((x) => [x[0], x[2].length]), [['second', 1]]);
  });
  it('shift-click takes every live box between, skipping people already open', () => {
    const out = L.rangeSelect(people, 'a', 'e', true, {});
    assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c', 'e']);
    assert.equal(L.pickedCount(out), 4);
  });
});

describe('dates and addresses', () => {
  it('writes a day the way the page did', () => {
    assert.equal(L.dateWord('2026-10-06'), 'Oct 6');
    assert.equal(L.dateWord('2026-10-06T00:00:00Z', true), 'Tuesday, Oct 6');
    assert.equal(L.dateWord(''), '');
  });
  it('keeps ?c, ?v and ?s, drops the rest', () => {
    assert.deepEqual(L.validateEvalSearch({ c: 'x', v: 'summary', s: '2', z: 1 }), { c: 'x', v: 'summary', s: 2 });
    assert.deepEqual(L.validateEvalSearch({}), {});
    assert.deepEqual(L.validateAdminSearch({ t: 'abc' }), { t: 'abc' });
    assert.equal(L.caseHref('id', 'signoff'), '/evaluations/?c=id&v=signoff');
  });
  it('the web app owns /evaluations/', () => assert.ok(WEB_ROUTES.includes('/evaluations/')));
});
