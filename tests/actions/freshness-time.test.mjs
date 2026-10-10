import test from 'node:test';
import assert from 'node:assert/strict';
import { etParts } from '../../functions/_lib/actions/intake.ts';

// Blackbaud reads last_modified as Eastern clock time. Proved on the test record 2026-10-09: the Eastern time found a new
// action, the same moment written in UTC found nothing.
test('a UTC sync time converts to the Eastern clock before it goes in last_modified', () => {
  const e = etParts(new Date('2026-10-10T01:29:37Z'));
  assert.equal(e.date, '2026-10-09');
  assert.equal(e.hour, 21);
  assert.equal(e.minute, 29);
});
