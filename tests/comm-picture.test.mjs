// Run with: npm test
//
// Communication picture: what counts as a thank-you, how touches from Blackbaud, FavorOS and the Receipts page merge without counting
// twice, the count against the target of seven, and the No texts flag on Cadence rows. All names and ids are made up.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const comm = await import('../functions/_lib/work/comm.ts');

const act = (o) => ({ d: '2026-09-01', cat: 'Email', type: 'PC Action', summary: '', outcome: null, texted: 0, thanked: 0, ...o });
const TODAY = '2026-10-13';

describe('what counts as a thank-you', () => {
  it('TY in the summary, a New Gift Received follow-up, an HQTY letter and the Thanked tag count', () => {
    assert.equal(comm.isThanks({ type: 'PC Action', summary: 'TY email June 2026' }), true);
    assert.equal(comm.isThanks({ type: 'RESERVED (Follow Up - New Gift Received)', summary: 'Mailed card' }), true);
    assert.equal(comm.isThanks({ type: 'RESERVED (HQTY Letter)', summary: 'Letter' }), true);
    assert.equal(comm.isThanks({ type: 'PC Action', summary: 'Call', thanked: 1 }), true);
  });
  it('a check-in call and a words-only match do not', () => {
    assert.equal(comm.isThanks({ type: 'PC Action', summary: 'Quarterly check in' }), false);
    assert.equal(comm.isThanks({ type: 'RDD Action', summary: 'Pastry order' }), false);
  });
});

describe('fromAction', () => {
  it('maps categories to kinds, a text by tag or word, and leaves Task/Other out', () => {
    assert.equal(comm.fromAction(act({ cat: 'Phone call', texted: 1 })).kind, 'text');
    assert.equal(comm.fromAction(act({ cat: 'Phone call', summary: 'Texted about the trip' })).kind, 'text');
    assert.equal(comm.fromAction(act({ cat: 'Phone call', summary: 'Called' })).kind, 'call');
    assert.equal(comm.fromAction(act({ cat: 'Mailing' })).kind, 'card');
    assert.equal(comm.fromAction(act({ cat: 'Mailing', type: 'RESERVED (HQTY Letter)' })).kind, 'letter');
    assert.equal(comm.fromAction(act({ cat: 'Task/Other' })), null);
  });
  it('a call that left a message shows and never counts', () => {
    const t = comm.fromAction(act({ cat: 'Phone call', summary: 'TY call', outcome: 'Unsuccessful' }));
    assert.equal(t.left, true);
    assert.equal(t.thanks, false);
  });
});

describe('merge and tally', () => {
  const mirror = [comm.fromAction(act({ d: '2026-06-15', summary: 'TY email June 2026' })), comm.fromAction(act({ d: '2026-03-13', cat: 'Mailing', summary: 'TY card Mar 2026' })), comm.fromAction(act({ d: '2025-12-01', cat: 'Phone call', summary: 'Called' }))];
  const receipts = [{ date: '2026-09-18', kind: 'receipt', what: 'Receipt for 1 gift', source: 'Receipts', by: '', thanks: true }, { date: '2026-02-01', kind: 'receipt', what: 'Receipt for 1 gift', source: 'Receipts', by: '', thanks: true }];
  it('a FavorOS step the mirror already has on the same day and kind is not listed twice', () => {
    const hub = [{ date: '2026-06-15', kind: 'email', what: 'Emailed', by: 'A', thanks: true }, { date: '2026-10-01', kind: 'call', what: 'Called', by: 'A', thanks: false }];
    const out = comm.merge(mirror, hub, receipts, '2025-10-13');
    assert.equal(out.filter((t) => t.date === '2026-06-15').length, 1);
    assert.equal(out[0].date, '2026-10-01');
    assert.equal(out[0].source, 'FavorOS');
  });
  it('counts thank-yous in the calendar year against seven, with the kinds and the last 12 months', () => {
    const out = comm.merge(mirror, [], receipts, '2025-10-13');
    const t = comm.tally(out, TODAY);
    assert.equal(t.count, 4);
    assert.equal(t.target, 7);
    assert.deepEqual(t.byKind.find((k) => k.kind === 'receipt').n, 2);
    assert.equal(t.last12, 4);
  });
  it('an old touch outside the window is dropped', () => {
    assert.equal(comm.merge(mirror, [], [], '2026-01-01').length, 2);
  });
});

describe('No texts on Cadence rows', () => {
  const row = (cid) => ({ cid, blocked: false, steps: [{ k: 'text', state: 'next', off: null }, { k: 'email', state: 'todo', off: null }, { k: 'call', state: 'todo', off: null }, { k: 'card', state: 'todo', off: null }] });
  it('switches the text step off with the reason and moves next to the first open step', () => {
    const [r, other] = comm.applyNoText([row('1'), row('2')], new Map([['1', 'Replied STOP']]));
    assert.equal(r.steps[0].off, 'Replied STOP');
    assert.equal(r.steps.find((s) => s.state === 'next').k, 'email');
    assert.equal(other.steps[0].off, null);
  });
  it('leaves a row alone with no flag', () => {
    const rows = [row('3')];
    assert.equal(comm.applyNoText(rows, new Map()), rows);
  });
});
