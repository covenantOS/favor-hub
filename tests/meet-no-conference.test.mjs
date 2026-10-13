import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const { eventBody } = await import('../functions/_lib/meetcal.ts');

test('the calendar insert never asks Google for a Meet link', () => {
  for (const repeat of ['none', 'weekly', 'monthly']) {
    const b = eventBody({ title: 'Sync', agenda: '', roomUrl: 'https://dash.favorintl.org/meet/room/?m=a', guestUrl: 'https://dash.favorintl.org/meet/g/?m=a&k=b', startsAt: '2026-10-14T14:00:00.000Z', endsAt: '2026-10-14T15:00:00.000Z', attendees: ['a@favorintl.org'], recording: 'notes', repeat });
    assert.equal('conferenceData' in b, false);
    assert.equal(b.location, 'https://dash.favorintl.org/meet/room/?m=a');
    assert.match(String(b.description), /meet\/g\/\?m=a&k=b/);
  }
});
