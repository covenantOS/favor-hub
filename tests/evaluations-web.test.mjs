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

describe('plan and sharing', () => {
  const lim = { reviewersMin: 3, reviewersMax: 5, goalsMin: 2, goalsMax: 4 };
  const g = (p = {}) => ({ ...L.NEW_GOAL('Area'), goal: 'G', steps: 'S', target_date: '2027-01-01', ...p });
  it('needs the minimum finished goals and no half-written one', () => {
    assert.equal(L.goalsReady([g()], lim), false);
    assert.equal(L.goalsReady([g(), g()], lim), true);
    assert.equal(L.goalsReady([g(), g(), g({ steps: '' })], lim), false);
  });
  it('sends the plan under the names the server reads', () => {
    assert.deepEqual(L.goalsBody([g({ id: 'x', course_id: 'c' })]).goals[0], { id: 'x', area: 'Area', goal: 'G', steps: 'S', support: '', targetDate: '2027-01-01', courseId: 'c' });
  });
});

describe('tabs by role', () => {
  const base = { case: {}, next: '' };
  const names = (v) => L.tabsFor({ ...base, ...v }).map((t) => t[0]);
  it('the employee', () => assert.deepEqual(names({ role: { employee: true }, evidence: {}, summary: {} }), ['overview', 'self', 'evidence', 'reviewers', 'summary']));
  it('the supervisor, HR and admins', () => assert.deepEqual(names({ role: { raw: true }, self: {}, evidence: {} }), ['overview', 'self', 'evidence', 'feedback', 'compare', 'summary', 'signoff']));
  it('a reviewer sees only their own form, and opens it', () => {
    const v = { ...base, role: {}, mineB: {} };
    assert.deepEqual(names(v), ['overview', 'mine']);
    assert.equal(L.tabShown(v, ''), 'mine');
    assert.equal(L.tabShown(v, 'feedback'), 'mine');
    assert.equal(L.tabShown({ ...base, role: { raw: true } }, 'signoff'), 'signoff');
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
