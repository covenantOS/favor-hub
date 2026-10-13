import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// views.js is a classic browser script. Run it in a sandbox the way a page would.
const box = { Intl, Date, Math, String, Array, Object, JSON };
box.window = box;
vm.createContext(box);
vm.runInContext(readFileSync(new URL('../public/js/meet/views.js', import.meta.url), 'utf8'), box);
const MV = box.MeetViews;
const { summarize, plain } = await import('../functions/_lib/meetprovider.ts');
const plainArr = (a) => Array.from(a);

test('days are Eastern days, across the daylight saving change', () => {
  assert.equal(MV.etKey(Date.parse('2026-10-13T03:59:00Z')), '2026-10-12');
  assert.equal(MV.etKey(Date.parse('2026-10-13T04:00:00Z')), '2026-10-13');
  assert.equal(MV.etKey(Date.parse('2026-11-02T04:59:00Z')), '2026-11-01');
  assert.equal(MV.etKey(Date.parse('2026-11-02T05:00:00Z')), '2026-11-02');
  assert.equal(MV.etStart('2026-10-13'), Date.parse('2026-10-13T04:00:00Z'));
  assert.equal(MV.etStart('2026-12-01'), Date.parse('2026-12-01T05:00:00Z'));
  assert.equal(MV.etStart('2026-11-01'), Date.parse('2026-11-01T04:00:00Z'));
  const hm = MV.etHM(Date.parse('2026-10-13T18:30:00Z'));
  assert.equal(hm.h, 14);
  assert.equal(hm.m, 30);
});

test('a week starts on Sunday and holds seven days', () => {
  assert.equal(MV.weekStart('2026-10-13'), '2026-10-11');
  assert.equal(MV.weekStart('2026-10-11'), '2026-10-11');
  assert.equal(MV.weekStart('2026-10-17'), '2026-10-11');
  assert.deepEqual(plainArr(MV.weekDays('2026-10-13')), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.equal(MV.title('week', '2026-10-13'), 'Oct 11 to 17');
  assert.equal(MV.title('week', '2026-10-29'), 'Oct 25 to 31');
  assert.equal(MV.title('week', '2026-11-02'), 'Nov 1 to 7');
  assert.equal(MV.title('week', '2026-09-30'), 'Sep 27 to Oct 3');
});

test('the month grid has full Sunday-first weeks with the month edges marked', () => {
  const g = MV.monthGrid('2026-10-13');
  assert.equal(g.length, 5);
  assert.ok(g.every((r) => r.length === 7));
  assert.equal(g[0][0].key, '2026-09-27');
  assert.equal(g[0][0].inMonth, false);
  assert.equal(g[0][4].key, '2026-10-01');
  assert.equal(g[0][4].inMonth, true);
  assert.equal(g[4][6].key, '2026-10-31');
  assert.equal(g[4][6].inMonth, true);
  const feb = MV.monthGrid('2026-02-10');
  assert.equal(feb.length, 4);
  assert.ok(feb.flat().every((c) => c.inMonth));
  assert.equal(MV.monthGrid('2026-08-05').length, 6);
  assert.equal(MV.title('month', '2026-10-13'), 'October 2026');
});

test('arrows move by the current unit and clamp at month ends', () => {
  assert.equal(MV.step('day', '2026-10-31', 1), '2026-11-01');
  assert.equal(MV.step('week', '2026-10-13', 1), '2026-10-20');
  assert.equal(MV.step('week', '2026-10-13', -1), '2026-10-06');
  assert.equal(MV.step('month', '2026-10-13', 1), '2026-11-13');
  assert.equal(MV.step('month', '2026-01-31', 1), '2026-02-28');
  assert.equal(MV.step('month', '2026-03-31', -1), '2026-02-28');
  assert.equal(MV.step('month', '2026-12-15', 1), '2027-01-15');
  assert.equal(MV.step('month', '2026-01-15', -1), '2025-12-15');
});

test('the day strip starts today, the week view starts Sunday', () => {
  const today = '2026-10-13';
  assert.equal(MV.addDays(today, 0), '2026-10-13');
  assert.notEqual(today, MV.weekDays(today)[0]);
  assert.ok(plainArr(MV.weekDays(today)).includes(today));
});

test('meetings land on their Eastern start day and month cells cap at three chips', () => {
  const evs = [
    { id: 'a', start: Date.parse('2026-10-13T03:30:00Z') },
    { id: 'b', start: Date.parse('2026-10-13T13:00:00Z') },
    { id: 'c', start: Date.parse('2026-10-13T15:00:00Z') },
    { id: 'd', start: Date.parse('2026-10-13T17:00:00Z') },
    { id: 'e', start: Date.parse('2026-10-13T19:00:00Z') },
  ];
  const by = MV.bucket(evs);
  assert.deepEqual(plainArr(by['2026-10-12'].map((e) => e.id)), ['a']);
  assert.equal(by['2026-10-13'].length, 4);
  const c = MV.chips(by['2026-10-13'], 3);
  assert.equal(c.shown.length, 2);
  assert.equal(c.more, 2);
  const three = MV.chips(by['2026-10-13'].slice(0, 3), 3);
  assert.equal(three.shown.length, 3);
  assert.equal(three.more, 0);
});

test('range lists the days each view shows', () => {
  assert.deepEqual(plainArr(MV.range('day', '2026-10-13')), ['2026-10-13']);
  assert.equal(MV.range('week', '2026-10-13').length, 7);
  assert.equal(MV.range('month', '2026-10-13').length, 35);
});

const ev = (over = {}) => ({ id: 'e1', summary: 'Weekly sync', description: '<p>Agenda:<br>1. Budget</p>Join https://us02web.zoom.us/j/123?pwd=a now', start: { dateTime: '2026-10-14T15:00:00Z' }, end: { dateTime: '2026-10-14T16:00:00Z' }, organizer: { email: 'me@favorintl.org', self: true }, attendees: [{ email: 'me@favorintl.org', self: true }, { email: 'ann@favorintl.org', displayName: 'Ann Lee' }], hangoutLink: 'https://meet.google.com/abc-defg-hij', ...over });

test('the detail panel gets the agenda text, organizer and move rights from the calendar event', () => {
  const m = summarize(ev(), 'me@favorintl.org', true);
  assert.equal(m.description, 'Agenda:\n1. Budget\nJoin  now');
  assert.equal(m.organizerName, 'You');
  assert.equal(m.canEdit, true);
  const other = summarize(ev({ organizer: { email: 'ann.lee@favorintl.org' } }), 'me@favorintl.org', true);
  assert.equal(other.organizerName, 'ann lee');
  assert.equal(other.canEdit, false);
  assert.equal(plain('A &amp; B<br/>C'), 'A & B\nC');
});

const day = readFileSync(new URL('../public/js/meet/day.js', import.meta.url), 'utf8');
test('Move to FavorOS posts the same route and fields as Today', () => {
  assert.ok(day.includes("api('../hub/day-move', { method: 'POST', body: body })"));
  assert.ok(day.includes('var body = { eventId: e.cal.eventId, writeLink: state.moveWrite, emailInvitees: invited(e).length > 0 && state.moveMail }'));
  const today = readFileSync(new URL('../app/src/features/today/day.tsx', import.meta.url), 'utf8');
  assert.ok(today.includes("send('/api/hub/day-move', { eventId: e.id, writeLink: write, emailInvitees: n > 0 && mail })"));
  for (const line of ['Add the FavorOS link to this event on my Google Calendar', 'FavorOS sends no email.', 'FavorOS emails them the link.', 'Emailed the link to', 'Share the room link with them.', 'Email the ', 'It is not recorded. The host can change that in the meeting.', 'Your calendar event is not changed.', 'Only the organizer can add the FavorOS link to this calendar event, so the event stays as it is.']) {
    assert.ok(day.includes(line) && today.includes(line), line);
  }
});

test('host actions use the existing meeting routes and the URL is shareable', () => {
  assert.ok(day.includes("body: { rec: t.dataset.rec }"));
  assert.ok(day.includes("{ status: 'cancelled' }"));
  assert.ok(day.includes("'/guestlink'"));
  assert.ok(day.includes('/meet/book/?edit='));
  assert.ok(day.includes('history.pushState'));
  assert.ok(day.includes("'ext:' + id.slice(2)"));
  assert.ok(day.includes("window.addEventListener('popstate', onPop)"));
});

test('the calendar window: explicit dates are capped at 130 days, span=month keeps the old reach, nothing asked keeps 14 days', async () => {
  const { calWindow } = await import('../functions/_lib/meetroute.ts');
  const D = 86400000;
  const w = calWindow(new URLSearchParams({ from: '2026-10-01T04:00:00Z', to: '2027-06-01T04:00:00Z' }));
  assert.equal(w.from, Date.parse('2026-10-01T04:00:00Z'));
  assert.equal(w.to - w.from, 130 * D);
  const n = calWindow(new URLSearchParams({ from: '2026-10-01T04:00:00Z', to: '2026-11-01T04:00:00Z' }));
  assert.equal(n.to, Date.parse('2026-11-01T04:00:00Z'));
  assert.equal(calWindow(new URLSearchParams({ from: 'x', to: 'y' })), undefined);
  assert.equal(calWindow(new URLSearchParams()), undefined);
  assert.ok(calWindow(new URLSearchParams({ span: 'month' })).to - calWindow(new URLSearchParams({ span: 'month' })).from > 70 * D);
});

// Opening or closing the meeting panel must not reload the page or draw the grid again (2026-10-13 flicker fix).
test('the shell leaves the Meetings page its own history moves', () => {
  const swap = readFileSync(new URL('../public/js/hub-swap.js', import.meta.url), 'utf8');
  const day = readFileSync(new URL('../public/js/meet/day.js', import.meta.url), 'utf8');
  assert.match(swap, /__hubPopOwn && window\.__hubPopOwn\(\)\) return/);
  assert.match(day, /window\.__hubPopOwn = function/);
  const open = day.slice(day.indexOf('function openEv'), day.indexOf('function closePanel'));
  assert.ok(!/\bdraw\(\)/.test(open), 'openEv must not draw the grid');
  const close = day.slice(day.indexOf('function closePanel'), day.indexOf('function onPop'));
  assert.ok(!/\bdraw\(\)/.test(close), 'closePanel must not draw the grid');
});
