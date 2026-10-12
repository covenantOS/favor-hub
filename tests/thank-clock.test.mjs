// Run with: npm test
//
// The 24-hour thank-you clock: weekday hours in Eastern time from the moment Blackbaud had the gift, the order the lists use, and the
// words on each row. Pure functions, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { thankDue, clockOf, byClock, clockLabel } = await import('../functions/_lib/work/thank-clock.ts');
const at = (s) => Date.parse(s);
const iso = (ms) => new Date(ms).toISOString();

describe('thankDue', () => {
  it('a Monday gift is due 24 hours later', () => {
    assert.equal(iso(thankDue(at('2026-10-12T09:00:00-04:00'))), iso(at('2026-10-13T09:00:00-04:00')));
  });
  it('a Friday afternoon gift is due Monday afternoon (the weekend does not count)', () => {
    assert.equal(iso(thankDue(at('2026-10-09T14:00:00-04:00'))), iso(at('2026-10-12T14:00:00-04:00')));
  });
  it('a Saturday online gift is due at the end of Monday', () => {
    assert.equal(iso(thankDue(at('2026-10-10T11:00:00-04:00'))), iso(at('2026-10-13T00:00:00-04:00')));
  });
  it('holds across the change back to standard time', () => {
    assert.equal(iso(thankDue(at('2026-11-02T10:00:00-05:00'))), iso(at('2026-11-03T10:00:00-05:00')));
  });
});

describe('clockOf and byClock', () => {
  const now = at('2026-10-12T10:00:00-04:00'); // a Monday
  const row = (key, added, amount = 100) => ({ key, amount, clock: clockOf(at(added), now) });
  it('sorts the gifts on the clock by due day, then the late ones, then Older', () => {
    const rows = [
      row('old', '2026-10-01T09:00:00-04:00', 9000),
      row('late', '2026-10-09T08:00:00-04:00'),
      row('fresh', '2026-10-12T09:30:00-04:00', 5000),
      row('soon', '2026-10-09T15:00:00-04:00'),
    ];
    assert.deepEqual(rows.map((r) => r.clock.state), ['older', 'late', 'due', 'due']);
    assert.deepEqual(rows.sort(byClock).map((r) => r.key), ['soon', 'fresh', 'late', 'old']);
  });
  it('the largest gift goes first among gifts due on the same day', () => {
    const rows = [row('small', '2026-10-12T08:00:00-04:00', 50), row('weekend', '2026-10-10T11:00:00-04:00', 25), row('big', '2026-10-12T09:10:00-04:00', 5000)];
    assert.deepEqual(rows.sort(byClock).map((r) => r.key), ['big', 'small', 'weekend']);
  });
});

describe('clockLabel', () => {
  const now = at('2026-10-12T10:00:00-04:00');
  it('reads in hours on the day it is due', () => {
    assert.equal(clockLabel('2026-10-12T20:00:00.000Z', now), 'Due in 6 h');
    assert.equal(clockLabel('2026-10-12T14:40:00.000Z', now), 'Due in 40 min');
    assert.equal(clockLabel('2026-10-13T03:30:00.000Z', now), 'Due today');
  });
  it('reads tomorrow, a weekday, then overdue', () => {
    assert.equal(clockLabel('2026-10-13T13:30:00.000Z', now), 'Due tomorrow');
    assert.equal(clockLabel('2026-10-15T13:30:00.000Z', now), 'Due Thu');
    assert.equal(clockLabel('2026-10-12T09:00:00.000Z', now), 'Overdue 5 h');
    assert.equal(clockLabel('2026-10-09T09:00:00.000Z', now), 'Overdue 3d');
  });
});
