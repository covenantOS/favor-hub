// The deposit screen's history panel: gifts before this one, lifetime total, last gift, and a first gift.
import test from 'node:test';
import assert from 'node:assert/strict';

const { historyOf } = await import('../functions/api/gift-entry/history.ts');

test('history counts earlier gifts, totals them in cents and finds the newest', () => {
  const h = historyOf([{ amt: 50, d: '2025-12-01' }, { amt: 5000, d: '2026-03-04' }, { amt: 12.5, d: '2024-01-09' }]);
  assert.equal(h.count, 3);
  assert.equal(h.lifetimeCents, 506250);
  assert.deepEqual(h.last, { cents: 500000, date: '2026-03-04' });
  assert.equal(h.first, false);
});

test('a partner with no earlier gift reads as a first gift; zero and empty rows do not count', () => {
  const h = historyOf([{ amt: 0, d: '2026-01-01' }, { amt: null, d: '2026-01-02' }, { amt: 20, d: null }]);
  assert.equal(h.count, 0);
  assert.equal(h.first, true);
  assert.equal(h.last, null);
});
