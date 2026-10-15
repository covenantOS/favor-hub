// The pure rules of the web port of Gift entry (web/src/features/gift-entry/logic.ts): state dots, the tie-out band, list filters, the key
// moves, the money and date words, the status steps. The same rules the classic page (public/js/gift-entry.js) used.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/gift-entry/logic.ts');

const row = (o = {}) => ({
  id: 'g1', seq: 1, status: 'review', kind: 'check', partner: null, amountCents: 1000, giftDate: '2026-10-09', payer: 'A Giver',
  card: false, dup: null, blockers: [], confirmed: false, flags: [], review: { needsFix: false, comments: 0 }, images: [], ...o,
});
const tape = (o = {}) => ({ tapeCents: 3000, tapeCount: 3, cents: 3000, count: 3, diffCents: 0, diffCount: 0, needLook: 0, matches: true, ...o });
const view = (rows, o = {}) => ({
  deposit: { id: 'd1', name: 'Regular Mail 2026-10-09', status: 'open', createdBy: 'Ada', createdAt: '2026-10-09T13:00:00Z', tapeCount: 3, tapeCents: 3000, batchNumber: null, committedAt: null, lastPolledAt: null },
  rows, tape: tape(o.tape), canSend: o.canSend || { ok: false, why: ['The count is 2 and the tape says 3.'] }, steps: null, attachments: { planned: 0, done: 0, failed: 0 }, rejected: [],
});

describe('money and dates', () => {
  it('money takes cents and shows two places', () => {
    assert.equal(L.money(123456), '$1,234.56');
    assert.equal(L.money(0), '$0.00');
    assert.equal(L.money(null), '');
    assert.equal(L.moneyS(-250), '-$2.50');
  });
  it('short and day words', () => {
    assert.equal(L.short('2026-10-09'), 'Oct 9');
    assert.equal(L.short(''), '');
    assert.equal(L.short('2026-10-09T10:00:00Z'), 'Oct 9');
    assert.equal(L.dayText('2026-10-09', '2026-10-15'), 'Oct 9');
    assert.equal(L.dayText('2025-12-31', '2026-10-15'), 'Dec 31, 2025');
    assert.equal(L.longDay('2026-10-09'), 'Oct 9, 2026');
  });
  it('the breadcrumb names the deposit by its day', () => {
    assert.equal(L.crumbName('Regular Mail 2026-10-09'), 'Regular Mail, Oct 9');
    assert.equal(L.crumbName('Acquisition Mail 2026-01-02'), 'Acquisition Mail, Jan 2');
    assert.equal(L.crumbName(''), 'Deposit');
  });
  it('pickup days are Monday, Wednesday and Friday', () => {
    assert.equal(L.pickupText('2026-10-12'), 'Monday is a pickup day');
    assert.equal(L.pickupText('2026-10-14'), 'Wednesday is a pickup day');
    assert.equal(L.pickupText('2026-10-16'), 'Friday is a pickup day');
    assert.equal(L.pickupText('2026-10-15'), '');
    assert.equal(L.pickupText(''), '');
  });
  it('names come from the address', () => {
    assert.equal(L.nameOf('ada.lovelace@favorintl.org'), 'Ada Lovelace');
    assert.equal(L.nameOf('brain'), 'Favor Brain');
  });
  it('Eastern stamps', () => {
    assert.equal(L.etTime('2026-10-09T13:05:00Z'), 'Oct 9, 9:05 AM');
    assert.equal(L.etTime(null), '');
    assert.equal(L.whenText('2026-10-15T13:05:00Z', '2026-10-15'), 'Today 9:05 AM');
    assert.equal(L.whenText('2026-10-14T13:05:00Z', '2026-10-15'), 'Yesterday 9:05 AM');
    assert.equal(L.whenText('2026-10-09T13:05:00Z', '2026-10-15'), 'Oct 9 9:05 AM');
  });
  it('typed dollars become cents, and a bad cash entry is refused', () => {
    assert.equal(L.toCents('$1,234.50'), 123450);
    assert.equal(L.toCents(' 25 '), 2500);
    assert.ok(Number.isNaN(L.toCents('abc')));
    assert.equal(L.cashCents('40'), 4000);
    assert.equal(L.cashCents('abc'), 0);
    assert.equal(L.cashCents('0'), 0);
    assert.equal(L.tapeTotalParam('$11,335.00'), '11335.00');
  });
});

describe('state dots', () => {
  it('held, problem, approved and look', () => {
    assert.equal(L.stateOf(row({ status: 'held' })), 'hold');
    assert.equal(L.stateOf(row({ status: 'failed' })), 'bad');
    assert.equal(L.stateOf(row({ card: true })), 'bad');
    assert.equal(L.stateOf(row({ dup: { decision: null, message: 'x' } })), 'bad');
    assert.equal(L.stateOf(row({ dup: { decision: 'keep', message: 'x' }, confirmed: true })), 'ok');
    assert.equal(L.stateOf(row({ status: 'sent' })), 'ok');
    assert.equal(L.stateOf(row({ status: 'by_hand' })), 'ok');
    assert.equal(L.stateOf(row({ confirmed: true })), 'ok');
    assert.equal(L.stateOf(row({ confirmed: true, blockers: ['Pick the fund.'] })), 'look');
    assert.equal(L.stateOf(row()), 'look');
  });
  it('the list filters count problems under To review', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', status: 'held' }), row({ id: 'c', confirmed: true }), row({ id: 'd', card: true })];
    assert.equal(L.countFor(rows, 'all'), 4);
    assert.equal(L.countFor(rows, 'look'), 2);
    assert.equal(L.countFor(rows, 'hold'), 1);
    assert.equal(L.countFor(rows, 'ok'), 1);
    assert.deepEqual(L.filterRows(rows, 'look').map((x) => x.r.id), ['a', 'd']);
    assert.deepEqual(L.filterRows(rows, 'look').map((x) => x.i), [0, 3]);
    assert.equal(L.filterRows(rows, 'all').length, 4);
  });
});

describe('the tie-out band', () => {
  it('counts approved, to review and held, and the progress widths', () => {
    const rows = [row({ id: 'a', confirmed: true }), row({ id: 'b' }), row({ id: 'c', status: 'held' }), row({ id: 'd', confirmed: true })];
    const b = L.bandOf(view(rows), true);
    assert.equal(b.approved, 2);
    assert.equal(b.held, 1);
    assert.equal(b.look, 1);
    assert.equal(b.needs, 2);
    assert.equal(b.total, 4);
    assert.deepEqual(b.pct, { a: '50.0%', h: '25.0%', x: '25.0%' });
  });
  it('an empty deposit has 0% bars and the tape words', () => {
    const b = L.bandOf(view([], { tape: tape({ cents: 0, count: 0, diffCents: -3000, diffCount: -3, matches: false }) }), true);
    assert.deepEqual(b.pct, { a: '0%', h: '0%', x: '0%' });
    assert.equal(b.off, '3 short');
    assert.equal(b.ties, false);
  });
  it('off the tape by dollars when the count is right', () => {
    const b = L.bandOf(view([row()], { tape: tape({ diffCents: -250, diffCount: 0, matches: false }) }), true);
    assert.equal(b.off, '-$2.50');
    const over = L.bandOf(view([row()], { tape: tape({ diffCount: 2, matches: false }) }), true);
    assert.equal(over.off, '2 over');
  });
  it('Send to Blackbaud needs the server to say ok and the switch to be on', () => {
    const ok = view([row({ confirmed: true })], { canSend: { ok: true, why: [] } });
    assert.equal(L.bandOf(ok, true).canSend, true);
    assert.equal(L.bandOf(ok, true).why, '');
    assert.equal(L.bandOf(ok, false).canSend, false);
    assert.equal(L.bandOf(ok, false).why, 'Posting is not switched on for you');
    const not = view([row(), row({ id: 'b', confirmed: true })]);
    assert.equal(L.bandOf(not, true).why, 'Opens when all 2 are approved');
    const all = view([row({ confirmed: true })], { canSend: { ok: false, why: ['The count is 1 and the tape says 3.', 'x'] } });
    assert.equal(L.bandOf(all, true).why, 'The count is 1 and the tape says 3.');
  });
});

describe('moving through the queue', () => {
  const rows = [row({ id: 'a', confirmed: true }), row({ id: 'b' }), row({ id: 'c', confirmed: true }), row({ id: 'd' })];
  it('the first row that needs a look opens first', () => {
    assert.equal(L.firstRow(rows), 'b');
    assert.equal(L.firstRow([row({ id: 'x', confirmed: true })]), 'x');
    assert.equal(L.firstRow([]), '');
  });
  it('after an approval the next row that needs a look follows, then the top', () => {
    assert.equal(L.nextLook(rows, 'b'), 'd');
    assert.equal(L.nextLook(rows, 'd'), 'b');
    assert.equal(L.nextLook([row({ id: 'a', confirmed: true })], 'a'), '');
  });
  it('J and K stay inside the list', () => {
    assert.equal(L.moveTo(rows, 'a', -1), 'a');
    assert.equal(L.moveTo(rows, 'd', 1), 'd');
    assert.equal(L.moveTo(rows, 'b', 1), 'c');
    assert.equal(L.moveTo(rows, 'zzz', 1), 'b');
  });
});

describe('the approve button', () => {
  it('approve, blocked approve, undo, and the second approval', () => {
    assert.deepEqual(L.primaryOf(row(), false, 'me@x.org').act, 'approve');
    assert.equal(L.primaryOf(row({ blockers: ['Pick the fund.'] }), false, 'me@x.org').disabled, true);
    assert.equal(L.primaryOf(row({ blockers: ['Pick the fund.'] }), false, 'me@x.org').block, 'Pick the fund.');
    assert.equal(L.primaryOf(row({ blockers: ['Look it over and press Looks right.'] }), false, 'me@x.org').disabled, false);
    assert.equal(L.primaryOf(row({ confirmed: true }), false, 'me@x.org').act, 'unconfirm');
    const second = row({ confirmed: true, confirmedBy: 'First@x.org', blockers: ['A second person must approve this amount.'] });
    const mine = L.primaryOf({ ...second, confirmedBy: 'Me@X.org' }, true, 'me@x.org');
    assert.equal(mine.act, 'approve2');
    assert.equal(mine.disabled, true);
    assert.equal(L.primaryOf(second, true, 'me@x.org').disabled, false);
    assert.equal(L.primaryOf({ ...second, secondDone: true, blockers: [] }, true, 'me@x.org').act, 'unconfirm');
  });
});

describe('the month list', () => {
  const m = [{ source: 'blackbaud', status: '' }, { source: 'favoros', status: 'open' }, { source: 'favoros', status: 'committed' }];
  it('filters all, open and in Blackbaud', () => {
    assert.equal(L.filterMonth(m, 'all').length, 3);
    assert.deepEqual(L.filterMonth(m, 'open'), [m[1]]);
    assert.deepEqual(L.filterMonth(m, 'bb'), [m[0], m[2]]);
  });
  it('status pills', () => {
    assert.deepEqual(L.pillOf('open'), { text: 'Taking photos', tone: 'warn' });
    assert.deepEqual(L.pillOf('created'), { text: 'Waiting for approval in Blackbaud', tone: '' });
    assert.deepEqual(L.pillOf('weird'), { text: 'weird', tone: '' });
  });
});

describe('a sent deposit', () => {
  const sent = (status, steps, rows = [row({ status: 'sent' })], over = {}) => ({
    ...view(rows),
    deposit: { ...view(rows).deposit, status, batchNumber: 'GFT-2026-9999', ...(over.deposit || {}) },
    steps: { status, waiting: null, steps },
    attachments: over.attachments || { planned: 0, done: 0, failed: 0 },
  });
  it('batch created, gifts sent, waiting for approval', () => {
    const t = L.timelineOf(sent('created', [{ op: 'batch', status: 'done', attempts: 1 }, { op: 'gifts:1', status: 'done', attempts: 1 }]));
    assert.deepEqual(t.map((x) => x.k), ['done', 'done', 'done', 'now', '']);
    assert.equal(t[1].t, 'Batch GFT-2026-9999');
    assert.equal(t[1].s, 'Created unapproved');
    assert.equal(t[2].s, '1 of 1');
    assert.equal(t[3].s, 'Unapproved');
    assert.equal(t[4].s, 'None needed');
  });
  it('waiting for the daily limit and trying again', () => {
    const w = L.timelineOf(sent('sending', [{ op: 'batch', status: 'waiting', attempts: 1 }]));
    assert.equal(w[1].s, 'Waiting for the daily limit to reset');
    assert.equal(w[1].k, 'now');
    const r = L.timelineOf(sent('sending', [{ op: 'batch', status: 'queued', attempts: 1, next_try_at: '2026-10-09T13:05:00Z' }]));
    assert.equal(r[1].s, 'Trying again at Oct 9, 9:05 AM');
  });
  it('a failed gift marks the step and the deposit asks for a person', () => {
    const t = L.timelineOf(sent('needs_person', [{ op: 'batch', status: 'done', attempts: 1 }, { op: 'gifts:1', status: 'done', attempts: 1 }], [row({ status: 'sent' }), row({ id: 'b', status: 'failed' })]));
    assert.equal(t[2].k, 'bad');
    assert.equal(t[2].s, '1 of 2 · 1 need a person');
  });
  it('committed with photos copied', () => {
    const t = L.timelineOf(sent('committed', [{ op: 'batch', status: 'done', attempts: 1 }, { op: 'gifts:1', status: 'done', attempts: 1 }], undefined, { deposit: { committedAt: '2026-10-10T14:00:00Z' }, attachments: { planned: 2, done: 2, failed: 0 } }));
    assert.deepEqual(t.map((x) => x.k), ['done', 'done', 'done', 'done', 'done']);
    assert.equal(t[3].t, 'Approved in Blackbaud');
    assert.equal(t[3].s, 'Oct 10, 10:00 AM');
    assert.equal(t[4].s, '2 of 2');
  });
  it('who can take a batch back, and when the page asks Blackbaud again', () => {
    assert.equal(L.canUndoBatch('created', true), true);
    assert.equal(L.canUndoBatch('created', false), false);
    assert.equal(L.canUndoBatch('committed', true), false);
    assert.equal(L.polls('created'), true);
    assert.equal(L.polls('needs_person'), false);
    assert.equal(L.hasRevenue('needs_person'), true);
    assert.equal(L.hasRevenue('sending'), false);
    assert.equal(L.sentStatus('sent'), 'In the batch');
    assert.equal(L.sentStatus('review'), 'review');
  });
});

describe('photos', () => {
  it('shrink to 1600 on the long side and never enlarge', () => {
    assert.equal(L.photoScale(3200, 2400), 0.5);
    assert.equal(L.photoScale(800, 600), 1);
    assert.equal(L.MAX_SIDE, 1600);
    assert.equal(L.BLUR_MIN, 25);
  });
  it('the queue words', () => {
    assert.equal(L.queueWord({ state: 'waiting' }), 'waiting');
    assert.equal(L.queueWord({ state: 'sending' }), 'reading');
    assert.equal(L.queueWord({ state: 'error', err: 'Too big' }), 'Too big (tap to retry)');
  });
});
