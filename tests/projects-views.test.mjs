import test from 'node:test';
import assert from 'node:assert/strict';
import { dn, ymd, span, startOfWeek, dayOfWeek, isOverdue, fmtRange, mkDn, parts } from '../public/js/projects/views-common.js';

test('day numbers round trip and ignore time zones', () => {
  assert.equal(ymd(dn('2026-10-11')), '2026-10-11');
  assert.equal(dn('2026-10-12') - dn('2026-10-11'), 1);
  assert.equal(dn('2026-03-09') - dn('2026-03-08'), 1);
  assert.ok(Number.isNaN(dn(null)));
  assert.ok(Number.isNaN(dn('')));
});

test('weeks start on Sunday', () => {
  assert.equal(dayOfWeek(dn('2026-10-11')), 0);
  assert.equal(ymd(startOfWeek(dn('2026-10-14'))), '2026-10-11');
  assert.equal(ymd(mkDn(2026, 12, 1)), '2027-01-01');
  assert.equal(parts(dn('2026-02-28')).m, 1);
});

test('span orders dates and handles one date or none', () => {
  const a = span({ start_date: '2026-10-05', due_date: '2026-10-09' });
  assert.deepEqual([a.s, a.d, a.both], [dn('2026-10-05'), dn('2026-10-09'), true]);
  const b = span({ start_date: '2026-10-09', due_date: '2026-10-05' });
  assert.ok(b.s < b.d);
  const c = span({ due_date: '2026-10-05' });
  assert.equal(c.s, c.d);
  assert.equal(c.both, false);
  assert.ok(Number.isNaN(span({}).s));
});

test('a done task is never overdue', () => {
  assert.equal(isOverdue({ status: 'done', due_date: '2000-01-01' }), false);
  assert.equal(isOverdue({ status: 'open', due_date: '2000-01-01' }), true);
  assert.equal(isOverdue({ status: 'open' }), false);
});

test('range text', () => {
  assert.equal(fmtRange(dn('2026-10-05'), dn('2026-10-09')), 'Oct 5 to 9');
  assert.equal(fmtRange(dn('2026-10-30'), dn('2026-11-02')), 'Oct 30 to Nov 2');
  assert.equal(fmtRange(dn('2026-10-05'), dn('2026-10-05')), 'Oct 5');
});
