// Run with: npm test
// Repeat rules (functions/_lib/meetrecur.ts): occurrences in Eastern wall clock, RRULE out and back, plain descriptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const R = await import('../functions/_lib/meetrecur.ts');
const et = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const rule = (o) => R.cleanRule({ interval: 1, byDay: [], monthBy: 'date', end: { kind: 'never' }, ...o });

// Tue 2026-10-20 10:00 Eastern (EDT, UTC-4)
const TUE = '2026-10-20T14:00:00.000Z';

test('every 2 weeks on Tuesday and Thursday, 5 times', () => {
  const r = rule({ freq: 'weekly', interval: 2, byDay: [2, 4], end: { kind: 'count', count: 5 } });
  assert.deepEqual(R.expand(r, TUE).map(et), ['Tue, Oct 20, 10:00 AM', 'Thu, Oct 22, 10:00 AM', 'Tue, Nov 3, 10:00 AM', 'Thu, Nov 5, 10:00 AM', 'Tue, Nov 17, 10:00 AM']);
  assert.equal(R.toRRule(r, TUE), 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5');
  assert.equal(R.describe(r, TUE), 'Every 2 weeks on Tuesday and Thursday, 5 times');
});

test('the wall clock holds across the end of daylight saving (Nov 1, 2026)', () => {
  const r = rule({ freq: 'weekly' });
  const xs = R.expand(r, TUE, { limit: 3 });
  assert.deepEqual(xs.map(et), ['Tue, Oct 20, 10:00 AM', 'Tue, Oct 27, 10:00 AM', 'Tue, Nov 3, 10:00 AM']);
  assert.equal(xs[2], '2026-11-03T15:00:00.000Z');
});

test('every weekday skips the weekend', () => {
  const xs = R.expand(rule({ freq: 'weekdays' }), '2026-10-23T13:00:00.000Z', { limit: 3 }); // Fri 9:00
  assert.deepEqual(xs.map(et), ['Fri, Oct 23, 9:00 AM', 'Mon, Oct 26, 9:00 AM', 'Tue, Oct 27, 9:00 AM']);
  assert.equal(R.toRRule(rule({ freq: 'weekdays' }), TUE), 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
});

test('monthly on the third Tuesday, on the last Friday, and on the 31st', () => {
  const third = rule({ freq: 'monthly', monthBy: 'weekday' });
  assert.deepEqual(R.expand(third, TUE, { limit: 3 }).map(et), ['Tue, Oct 20, 10:00 AM', 'Tue, Nov 17, 10:00 AM', 'Tue, Dec 15, 10:00 AM']);
  assert.equal(R.toRRule(third, TUE), 'RRULE:FREQ=MONTHLY;BYDAY=3TU');
  assert.equal(R.describe(third, TUE), 'Every month on the third Tuesday');
  const lastFri = rule({ freq: 'monthly', monthBy: 'last' });
  const fri = '2026-10-30T18:00:00.000Z'; // Fri Oct 30, 2 PM
  assert.deepEqual(R.expand(lastFri, fri, { limit: 3 }).map(et), ['Fri, Oct 30, 2:00 PM', 'Fri, Nov 27, 2:00 PM', 'Fri, Dec 25, 2:00 PM']);
  assert.equal(R.toRRule(lastFri, fri), 'RRULE:FREQ=MONTHLY;BYDAY=-1FR');
  const d31 = R.expand(rule({ freq: 'monthly' }), '2026-10-31T14:00:00.000Z', { limit: 3 }).map(et);
  assert.deepEqual(d31, ['Sat, Oct 31, 10:00 AM', 'Thu, Dec 31, 10:00 AM', 'Sun, Jan 31, 10:00 AM']);
});

test('until a date includes that day and no later', () => {
  const r = rule({ freq: 'daily', end: { kind: 'until', until: '2026-10-22' } });
  assert.equal(R.expand(r, TUE).length, 3);
  assert.match(R.toRRule(r, TUE), /UNTIL=20261023T035900Z$/);
});

test('a Google rule comes back as the same rule, with skipped dates', () => {
  const r = rule({ freq: 'weekly', interval: 2, byDay: [2, 4], end: { kind: 'until', until: '2026-12-18' } });
  const back = R.fromRRule([R.toRRule(r, TUE), 'EXDATE;TZID=America/New_York:20261103T100000'], TUE);
  assert.deepEqual(back.rule, r);
  assert.deepEqual(back.exdates, ['2026-11-03T15:00:00.000Z']);
  assert.equal(R.fromRRule(['RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2'], TUE), null);
  assert.equal(R.instanceId('abc123', '2026-11-03T15:00:00.000Z'), 'abc123_20261103T150000Z');
});

test('old repeat words still read', () => {
  assert.equal(R.cleanRule(null, 'biweekly').interval, 2);
  assert.equal(R.cleanRule(null, 'none'), null);
  assert.equal(R.cleanRule({ freq: 'hourly' }), null);
});

test('the half that follows a split keeps the right count', () => {
  const r = rule({ freq: 'weekly', end: { kind: 'count', count: 6 } });
  const rest = R.restAfter(r, TUE, '2026-11-03T15:00:00.000Z');
  assert.equal(rest.end.count, 4);
  assert.equal(R.dayBefore('2026-11-03T15:00:00.000Z'), '2026-11-02');
});
