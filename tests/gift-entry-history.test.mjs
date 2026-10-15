// The deposit screen's history panel: gifts before this one, lifetime total, last gift, and a first gift.
// The numbers are the household's credited giving (shared/giving.ts), so a gift sent through a DAF counts and a spouse's gift counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const { historyOf } = await import('../functions/_lib/gifts/history.ts');
const { givingOf } = await import('../shared/giving.ts');

const row = (id, amount, date, extra = {}) => ({ id, amount, date, type: 'Donation', giver: '1', soft: null, ...extra });
const names = new Map([['900', { name: 'National Christian Foundation', kind: 'daf' }]]);
const house = (rows, members = ['1']) => historyOf(givingOf(rows, new Set(members), names, '2026-10-13'));

test('history counts earlier gifts, totals them in cents and finds the newest', () => {
  const h = house([row('a', 50, '2025-12-01'), row('b', 5000, '2026-03-04'), row('c', 12.5, '2024-01-09')]);
  assert.equal(h.count, 3);
  assert.equal(h.lifetimeCents, 506250);
  assert.deepEqual(h.last, { cents: 500000, date: '2026-03-04', through: '' });
  assert.equal(h.first, false);
  assert.equal(h.line, '$5,063 in 3 gifts');
});

test('a partner with no earlier gift reads as a first gift; zero and recurring schedules do not count', () => {
  const h = house([row('a', 0, '2026-01-01'), row('b', 100, '2026-01-02', { type: 'RecurringGift' })]);
  assert.equal(h.count, 0);
  assert.equal(h.first, true);
  assert.equal(h.last, null);
});

test('a gift sent through a DAF and soft-credited to the partner is history, not a first gift', () => {
  const soft = JSON.stringify([{ constituent_id: '1', amount: { value: 2500 } }]);
  const h = house([row('d', 2500, '2026-05-01', { giver: '900', soft })]);
  assert.equal(h.count, 1);
  assert.equal(h.first, false);
  assert.equal(h.last.through, 'National Christian Foundation (DAF)');
  assert.equal(h.source, 'All through National Christian Foundation (DAF)');
});

test('a spouse who gave before makes the household history', () => {
  const h = house([row('s', 75, '2025-01-01', { giver: '2' })], ['1', '2']);
  assert.equal(h.count, 1);
  assert.equal(h.first, false);
});

test('a record that only passes gifts on for others is not a first gift and not "none"', () => {
  const soft = JSON.stringify([{ constituent_id: '77', amount: { value: 400 } }]);
  const h = house([row('p', 400, '2026-02-02', { giver: '1', soft })]);
  assert.equal(h.count, 0);
  assert.equal(h.first, false);
  assert.equal(h.passesOn, true);
});
