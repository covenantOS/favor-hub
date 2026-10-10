// Run with: npm test
//
// The two-minute meeting nudge: which meetings count, when they are due, and that each one shows once.
// Made-up meetings only: the repository is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const { toNudgeList, dueNow, minutesLeft, LEAD_MS } = await import('../src/scripts/nudge-core.ts');

const NOW = Date.parse('2026-10-12T14:00:00.000Z');
const at = (ms) => new Date(NOW + ms).toISOString();

test('a meeting is due when it starts within two minutes, and not before the window', () => {
  const list = toNudgeList([{ id: 'a1', title: 'Foundation call', startsAt: at(LEAD_MS), endsAt: at(LEAD_MS + 3600_000) }], []);
  assert.equal(dueNow(list, NOW, new Set()).length, 1);
  const later = toNudgeList([{ id: 'a2', title: 'Later', startsAt: at(LEAD_MS + 1000), endsAt: at(7200_000) }], []);
  assert.equal(dueNow(later, NOW, new Set()).length, 0);
});

test('a meeting that has started, or has ended, is not due', () => {
  const list = toNudgeList([{ id: 'b1', title: 'Started', startsAt: at(-1000), endsAt: at(3600_000) }], []);
  assert.equal(dueNow(list, NOW, new Set()).length, 0);
  const ended = toNudgeList([{ id: 'b2', title: 'Over', startsAt: at(60000), endsAt: at(120000), status: 'ended' }], []);
  assert.equal(ended.length, 0);
});

test('each meeting shows once: a shown key is left out', () => {
  const list = toNudgeList([{ id: 'c1', title: 'Once', startsAt: at(60000), endsAt: at(3600_000) }], []);
  assert.equal(dueNow(list, NOW, new Set([list[0].key])).length, 0);
});

test('calendar meetings keep their Join link, and meetings without a start are dropped', () => {
  const list = toNudgeList([{ id: 'd1', title: 'Room with no time', startsAt: null }], [
    { eventId: 'ev1', title: 'Zoom sync', startsAt: at(90000), endsAt: at(1800_000), joinUrl: 'https://zoom.us/j/123' },
    { eventId: 'ev2', title: 'No link', startsAt: at(90000), endsAt: at(1800_000), joinUrl: '' },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].join, 'https://zoom.us/j/123');
  assert.equal(dueNow(list, NOW, new Set()).length, 1);
});

test('a Favor room links to its room page', () => {
  const list = toNudgeList([{ id: 'e 1', title: 'Room', startsAt: at(60000), endsAt: at(3600_000) }], []);
  assert.equal(list[0].join, '/meet/room/?m=e%201');
});

test('the minutes text is never zero', () => {
  assert.equal(minutesLeft(NOW + 90000, NOW), 2);
  assert.equal(minutesLeft(NOW + 20000, NOW), 1);
});
