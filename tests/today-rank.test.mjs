// Run with: npm test
// The rules behind Today's Needs you list (web/src/features/today/rank.ts): rank order, what folds into a group, and that the
// status line count and the heading count come from the same function. Made-up people only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const R = await import('../web/src/features/today/rank.ts');
const NOW = Date.parse('2026-10-15T15:00:00Z');
const base = { today: null, inbox: [], waiting: [], brief: null, gifts: null, home: null, gone: new Set(), now: NOW };
const inbox = (id, kind, at = '2026-10-15T14:00:00Z') => ({ id, kind, title: id, at, href: '/x/', app: 'Chat' });

describe('Needs you ranking', () => {
  it('ranks Approval over Review over Chat over Task over Mail', () => {
    const { items } = R.buildItems({ ...base, inbox: [inbox('m', 'mail'), inbox('t', 'task'), inbox('c', 'dm'), inbox('r', 'review'), inbox('a', 'expense')] });
    assert.deepEqual(items.map((x) => x.id), ['a', 'r', 'c', 't', 'm']);
  });
  it('a question waiting on you ranks 88; what you wait on folds into one Waiting group ranked 20', () => {
    const waiting = [
      { id: 'w1', dir: 'in', title: 'Q', since: '2026-10-14T12:00:00Z', days: 1, app: 'Mail', who: { name: 'Ada' }, href: '/m/' },
      { id: 'w2', dir: 'out', title: 'A', since: '2026-10-13T12:00:00Z', days: 2, app: 'Mail', who: { name: 'Bo' }, href: '/m/' },
      { id: 'w3', dir: 'out', title: 'B', since: '2026-10-12T12:00:00Z', days: 3, app: 'Mail', who: { name: 'Cy' }, href: '/m/' },
    ];
    const { items } = R.buildItems({ ...base, waiting });
    assert.equal(items[0].rank, 88);
    const g = items.find((x) => x.id === 'grp:waiting');
    assert.equal(g.rank, 20);
    assert.equal(g.rows.length, 2);
  });
  it('the heading and status count leave out only the Waiting group', () => {
    const waiting = [{ id: 'w2', dir: 'out', title: 'A', since: '2026-10-13T12:00:00Z', days: 2, app: 'Mail', href: '/m/' }];
    const { items } = R.buildItems({ ...base, inbox: [inbox('a', 'dm')], waiting });
    assert.equal(items.length, 2);
    assert.equal(R.needCount(items), 1);
  });
  it('a hub count that repeats an Inbox kind is dropped', () => {
    const today = { cards: [{ id: 'requests', n: 3, what: 'requests to review', href: '/r/' }, { id: 'evals', n: 1, what: 'evaluation', href: '/e/' }] };
    const { items } = R.buildItems({ ...base, today, inbox: [inbox('r', 'review')] });
    assert.deepEqual(items.map((x) => x.id).sort(), ['card:evals', 'r']);
  });
  it('a card with warn ranks 84', () => {
    const today = { cards: [{ id: 'learn', n: 2, what: 'courses', href: '/l/', warn: true }] };
    assert.equal(R.buildItems({ ...base, today }).items[0].rank, 84);
  });
  it('three or fewer gifts get their own rows, more than three fold into one group', () => {
    const g = (i, due) => ({ giftId: String(i), cid: 'c' + i, name: 'P' + i, amount: 100 + i, date: '2026-10-14', due });
    const few = R.buildItems({ ...base, brief: { thanks: { rows: [g(1, '2026-10-16T12:00:00Z'), g(2, '2026-10-14T12:00:00Z')], older: [] } } });
    assert.equal(few.items.length, 2);
    assert.equal(few.items[0].rank, 92);
    const many = R.buildItems({ ...base, brief: { thanks: { rows: [1, 2, 3, 4].map((i) => g(i, '2026-10-16T12:00:00Z')), older: [] } } });
    assert.equal(many.items.length, 1);
    assert.equal(many.items[0].id, 'grp:thank');
    assert.equal(many.items[0].count, 4);
  });
  it('a DAF gift reads through the fund name, and a gift from both sources counts once', () => {
    const brief = { thanks: { rows: [{ giftId: '9', cid: 'c', name: 'P', amount: 50, date: '2026-10-14', due: '2026-10-16T12:00:00Z' }], older: [] } };
    const gifts = { gifts: [{ giftId: '9', cid: 'c', name: 'P', amount: 50, date: '2026-10-14', thank: { state: 'owed', due: '2026-10-16T12:00:00Z' } }, { giftId: '10', cid: 'd', name: 'Q', amount: 75, date: '2026-10-14', soft: true, through: 'Fidelity Charitable', thank: { state: 'owed', due: '2026-10-16T12:00:00Z' } }] };
    const { items, thanks } = R.buildItems({ ...base, brief, gifts });
    assert.equal(thanks.length, 2);
    assert.match(items.find((x) => x.id === 'gift:10').sub, /through Fidelity Charitable/);
  });
  it('a cleared row stays off the list', () => {
    const { items } = R.buildItems({ ...base, inbox: [inbox('a', 'dm')], gone: new Set(['a']) });
    assert.equal(items.length, 0);
  });
  it('actions due rank 82 when late, 72 when only due today', () => {
    const home = (o) => ({ work: { due: { overdue: o, today: 1, rows: [] } } });
    assert.equal(R.buildItems({ ...base, home: home(2) }).items[0].rank, 82);
    assert.equal(R.buildItems({ ...base, home: home(0) }).items[0].rank, 72);
  });
  it('the thank clock words match the classic page', () => {
    assert.equal(R.thankClock('2026-10-15T14:00:00Z', NOW).label, 'Overdue 1 h');
    assert.equal(R.thankClock('2026-10-15T17:00:00Z', NOW).label, 'Due in 2 h');
  });
});
