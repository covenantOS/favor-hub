import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const { providerOf, summarize, mayMove } = await import('../functions/_lib/meetprovider.ts');

const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const ev = (over = {}) => ({ id: 'e1', summary: 'Weekly sync', start: { dateTime: soon(1) }, end: { dateTime: soon(2) }, organizer: { email: 'me@favorintl.org', self: true }, attendees: [{ email: 'me@favorintl.org', self: true }, { email: 'ann@favorintl.org', displayName: 'Ann Lee' }], hangoutLink: 'https://meet.google.com/abc-defg-hij', ...over });

test('provider comes from the link in conference data, location or notes', () => {
  assert.equal(providerOf({ hangoutLink: 'https://meet.google.com/abc-defg-hij' }).provider, 'meet');
  assert.equal(providerOf({ description: 'Join <a href="https://us02web.zoom.us/j/123?pwd=a&amp;b=1">here</a>' }).url, 'https://us02web.zoom.us/j/123?pwd=a&b=1');
  assert.equal(providerOf({ location: 'https://teams.microsoft.com/l/meetup-join/xyz' }).provider, 'teams');
  assert.equal(providerOf({ location: 'Room 4' }).provider, null);
  assert.equal(providerOf({ location: 'https://dash.favorintl.org/meet/room/?m=abc' }).provider, 'favor');
});

test('an internal Zoom or Meet event the person organizes can move, only with the write scope', () => {
  assert.equal(summarize(ev(), 'me@favorintl.org', true).canSwitch, true);
  const noScope = summarize(ev(), 'me@favorintl.org', false);
  assert.equal(noScope.canSwitch, false);
  assert.equal(noScope.needsConsent, true);
});

test('nobody but the organizer sees the switch', () => {
  const e = ev({ organizer: { email: 'ann@favorintl.org' }, attendees: [{ email: 'me@favorintl.org', self: true }, { email: 'ann@favorintl.org' }] });
  const m = summarize(e, 'me@favorintl.org', true);
  assert.equal(m.organizer, false);
  assert.equal(m.canSwitch, false);
  assert.equal(m.needsConsent, false);
  assert.equal(mayMove(e, 'me@favorintl.org'), false);
});

test('one outside address, Teams, or an ended event never offers the switch', () => {
  assert.equal(summarize(ev({ attendees: [{ email: 'me@favorintl.org', self: true }, { email: 'x@gmail.com' }] }), 'me@favorintl.org', true).canSwitch, false);
  assert.equal(summarize(ev({ hangoutLink: undefined, location: 'https://teams.microsoft.com/l/meetup-join/xyz' }), 'me@favorintl.org', true).canSwitch, false);
  assert.equal(mayMove(ev({ start: { dateTime: soon(-3) }, end: { dateTime: soon(-2) } }), 'me@favorintl.org'), false);
});

test('events without a video link, all-day events and declined ones are left out', () => {
  assert.equal(summarize(ev({ hangoutLink: undefined }), 'me@favorintl.org', true), null);
  assert.equal(summarize(ev({ start: { date: '2026-10-12' }, end: { date: '2026-10-13' } }), 'me@favorintl.org', true), null);
  assert.equal(summarize(ev({ attendees: [{ email: 'me@favorintl.org', self: true, responseStatus: 'declined' }] }), 'me@favorintl.org', true), null);
});

test('people are the other attendees, with a name', () => {
  const m = summarize(ev(), 'me@favorintl.org', true);
  assert.deepEqual(m.people, [{ email: 'ann@favorintl.org', name: 'Ann Lee' }]);
  assert.equal(m.joinUrl, 'https://meet.google.com/abc-defg-hij');
});
