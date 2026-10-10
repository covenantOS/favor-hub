import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LANES, applyOverlay, bigGift, countsOf, facetsOf, matches, shapeBoard, sortRows, thankGroups, thankLanes, thankOwners } from '../../functions/_lib/actions/board.ts';
import { validateAction } from '../../functions/_lib/actions/validate.ts';
import { TODAY, openRow, people, slimGift } from './helpers.mjs';

const later = (o) => ({ id: '90', cid: '100', due: '2026-10-03T00:00:00', added: '2026-10-03T10:00:00', modified: null, type: 'RDD Action', category: 'Phone call', summary: '', description: '', completed: 1, completed_date: '2026-10-03T00:00:00', status: 'Completed', computed: 'Completed', frs: '["9001"]', ...o });
const shape = (open, extra = {}) => shapeBoard({ today: TODAY, open, later: [], gifts: [], assigns: [], funds: { 7: 'General Fund' }, people, ...extra });

describe('shapeBoard', () => {
  it('thank-you tasks, Recurring Gift tasks and plain tasks are told apart', () => {
    const rows = shape([
      openRow({ id: '1', summary: 'TY for $42 on 9/27' }),
      openRow({ id: '2', type: 'RESERVED (Follow Up - New Gift Received)', summary: 'New gift' }),
      openRow({ id: '3', type: 'RESERVED (Follow Up - New Gift Received)', summary: 'CTG Recurring Gift' }),
      openRow({ id: '4', summary: 'Call about the vision trip' }),
    ]);
    assert.deepEqual(rows.map((r) => [r.id, r.ty, r.ctg]), [['1', true, false], ['2', true, false], ['3', false, true], ['4', false, false]]);
    assert.equal(rows[1].type, 'Follow Up - New Gift');
  });
  it('a task is linked to its gift by the amount and date in its text, with the fund name', () => {
    const [r] = shape([openRow({ summary: 'TY for $42 on 9/27' })], { gifts: [slimGift()] });
    assert.equal(r.gift.id, '500');
    assert.equal(r.gift.fund, 'General Fund');
    assert.equal(r.gift.amount, 42.49);
  });
  it('two open tasks about one gift show as one group', () => {
    const rows = shape([openRow({ id: '1', summary: 'TY for $42 on 9/27' }), openRow({ id: '2', summary: 'Thank you $42.49 gift' })], { gifts: [slimGift()] });
    assert.deepEqual(rows[0].group, ['1', '2']);
    assert.deepEqual(rows[1].group, ['1', '2']);
    assert.equal(thankGroups(rows, '').length, 1);
  });
  it('a later thank-you on the partner marks the task Thanked already, a plain call marks it Probably done', () => {
    const t = shape([openRow({ summary: 'TY for $42 on 9/27' })], { gifts: [slimGift()], later: [later({ summary: 'Sent thank you letter' })] })[0];
    assert.equal(t.later.strength, 'thanked');
    assert.equal(t.later.date, '2026-10-03');
    const p = shape([openRow({ summary: 'TY for $42 on 9/27' })], { gifts: [slimGift()], later: [later({ summary: 'Checked in' })] })[0];
    assert.equal(p.later.strength, 'contact');
    const none = shape([openRow({ summary: 'TY for $42 on 9/27' })], { gifts: [slimGift()] })[0];
    assert.equal(none.later, null);
  });
  it('a later thank-you that names a different amount never counts as Thanked already', () => {
    const t = shape([openRow({ summary: 'TY for $42 on 9/27' })], { gifts: [slimGift()], later: [later({ summary: 'ty $100 10/2/26', category: 'Task/Other', type: 'RESERVED (Other)' })] })[0];
    assert.equal(t.later, null);
  });
  it('holders are the current live holders in team order and the departed are left out', () => {
    const [r] = shape([openRow()], { assigns: [{ cid: '100', fid: '9002' }, { cid: '100', fid: '9003' }, { cid: '100', fid: '9001' }, { cid: '100', fid: '9001' }] });
    assert.deepEqual(r.holders, ['9001', '9002']);
  });
  it('the place reads city and state and the summary is cut at 255', () => {
    const [r] = shape([openRow({ summary: 'x'.repeat(300) })]);
    assert.equal(r.place, 'Tampa, FL');
    assert.equal(r.summary.length, 255);
  });
});

describe('filters, counts, sort', () => {
  const rows = shape([
    openRow({ id: '1', due: '2026-10-20T00:00:00', frs: '["9001"]', summary: 'Visit' }),
    openRow({ id: '2', due: '2026-09-01T00:00:00', frs: '["9003"]', summary: 'Old one', partner: 'Bo Sample' }),
    openRow({ id: '3', due: '2025-09-01T00:00:00', frs: '[]', summary: 'Ancient', category: 'Phone call' }),
    openRow({ id: '4', due: '2026-10-09T00:00:00', frs: '["9002"]', summary: 'Today' }),
  ], { assigns: [{ cid: '100', fid: '9001' }] });
  const ids = (f) => rows.filter((r) => matches(r, f, TODAY, people)).map((r) => r.id);
  it('due windows', () => {
    assert.deepEqual(ids({ due: 'past' }), ['2', '3']);
    assert.deepEqual(ids({ due: 'today' }), ['4']);
    assert.deepEqual(ids({ due: 'week' }), ['4']);
    assert.deepEqual(ids({ due: 'l90' }), ['3']);
    assert.deepEqual(ids({ due: 'l365' }), ['3']);
  });
  it('fundraiser, with and without their partners, and no fundraiser', () => {
    assert.deepEqual(ids({ fr: '9001' }), ['1']);
    assert.deepEqual(ids({ fr: '9001', theirs: true }).sort(), ['1', '2', '3', '4']);
    assert.deepEqual(ids({ fr: '_none' }), ['3']);
  });
  it('search looks at the partner, summary, id and fundraiser names', () => {
    assert.deepEqual(ids({ q: 'bo sample' }), ['2']);
    assert.deepEqual(ids({ q: 'gus bravo' }), ['4']);
    assert.deepEqual(ids({ q: 'ancient' }), ['3']);
  });
  it('counts and facets respect the other filters', () => {
    assert.deepEqual(countsOf(rows, TODAY), { open: 4, past: 2, ty: 0, done: 0, ctg: 0 });
    const f = facetsOf(rows, { cat: 'Phone call' }, TODAY, people);
    assert.equal(f.noOwner, 1);
    assert.deepEqual(f.cat.map((c) => c.v), ['Phone call', 'Task/Other']);
    assert.equal(facetsOf(rows, {}, TODAY, people).fr.find((x) => x.id === '9003').live, false);
  });
  it('sort by due, partner and fundraiser', () => {
    assert.deepEqual(sortRows(rows, 'due', -1, people).map((r) => r.id), ['1', '4', '2', '3']);
    assert.deepEqual(sortRows(rows, 'due', 1, people).map((r) => r.id), ['3', '2', '4', '1']);
    assert.deepEqual(sortRows(rows, 'fr', 1, people).map((r) => r.id)[0], '1');
  });
});

describe('stale lanes', () => {
  const rows = shape([
    openRow({ id: '1', frs: '["9003"]' }),
    openRow({ id: '2', frs: '["9001","9003"]' }),
    openRow({ id: '3', frs: '[]' }),
    openRow({ id: '4', due: '2025-01-01T00:00:00' }),
    openRow({ id: '5', due: '2026-04-01T00:00:00' }),
    openRow({ id: '6', due: '2026-08-15T00:00:00' }),
    openRow({ id: '7', type: 'RESERVED (Follow Up - New Gift Received)', summary: 'Recurring Gift' }),
    openRow({ id: '8', frs: '["9004"]' }),
  ]);
  const lane = (k) => rows.filter((r) => LANES.find((l) => l.k === k).test(r, TODAY, people)).map((r) => r.id);
  it('each lane holds the tasks its name says', () => {
    assert.deepEqual(lane('left'), ['1', '2', '8']);
    assert.deepEqual(lane('none'), ['3']);
    assert.deepEqual(lane('year'), ['4']);
    assert.deepEqual(lane('90'), ['5']);
    assert.deepEqual(lane('30'), ['6']);
    assert.deepEqual(lane('ctg'), ['7']);
  });
  it('a task about a gift of $1,000 or more is never swept up by Select all', () => {
    const [big] = shape([openRow({ summary: 'TY for $2K 9/27' })], { gifts: [slimGift({ amount: 2000 })] });
    assert.equal(bigGift(big), true);
    const [small] = shape([openRow({ summary: 'TY for $42 9/27' })], { gifts: [slimGift()] });
    assert.equal(bigGift(small), false);
  });
});

describe('thank-you lanes', () => {
  it('three lanes, owners with counts', () => {
    const rows = shape(
      [openRow({ id: '1', cid: '100', summary: 'TY for $42 on 9/27' }), openRow({ id: '2', cid: '101', summary: 'TY card', frs: '["9002"]' }), openRow({ id: '3', cid: '102', summary: 'TY please', frs: '["9002"]' })],
      { gifts: [slimGift()], later: [later({ summary: 'Thank you call' }), later({ id: '91', cid: '101', summary: 'Left voicemail', category: 'Phone call', added: '2026-10-05T10:00:00' })] }
    );
    const lanes = thankLanes(thankGroups(rows, ''));
    assert.deepEqual([lanes.thanked.length, lanes.probably.length, lanes.owed.length], [1, 1, 1]);
    assert.deepEqual(thankOwners(rows, people).map((o) => [o.id, o.n]), [['9002', 2], ['9001', 1]]);
  });
});

describe('the hub remembers what it did until the mirror catches up', () => {
  const rows = shape([openRow({ id: '1' }), openRow({ id: '2' }), openRow({ id: '3' }), openRow({ id: '4' })]);
  const SYNC = '2026-10-09T17:04:00Z';
  it('a completed action leaves the list, a tonight batch shows as saved for tonight', () => {
    const out = applyOverlay(rows, [
      { actionId: '1', op: 'complete', state: 'sent', at: '2026-10-09T21:00:00Z', tonight: false, body: {} },
      { actionId: '2', op: 'complete', state: 'queued', at: '2026-10-09T21:00:00Z', tonight: true, body: {} },
    ], SYNC);
    assert.deepEqual(out.map((r) => r.id), ['2', '3', '4']);
    assert.equal(out[0].pending.label, 'Marked complete · goes to Blackbaud tonight');
  });
  it('reschedule and reassign replace the values', () => {
    const out = applyOverlay(rows, [
      { actionId: '3', op: 'reschedule', state: 'verified', at: '2026-10-09T21:00:00Z', tonight: false, body: { date: '2026-10-16T00:00:00' } },
      { actionId: '4', op: 'reassign', state: 'verified', at: '2026-10-09T21:00:00Z', tonight: false, body: { fundraisers: ['9002'] } },
    ], SYNC);
    assert.equal(out.find((r) => r.id === '3').due, '2026-10-16');
    assert.deepEqual(out.find((r) => r.id === '4').fundraisers, ['9002']);
  });
  it('once the mirror is newer than the write the overlay drops, and a task still open is flagged as reopened', () => {
    const out = applyOverlay(rows, [{ actionId: '1', op: 'complete', state: 'verified', at: '2026-10-09T12:00:00Z', tonight: false, body: {} }], SYNC);
    assert.equal(out.length, 4);
    assert.equal(out.find((r) => r.id === '1').reopened, true);
    const quiet = applyOverlay(rows, [{ actionId: '3', op: 'reschedule', state: 'verified', at: '2026-10-09T12:00:00Z', tonight: false, body: { date: '2026-10-16T00:00:00' } }], SYNC);
    assert.equal(quiet.find((r) => r.id === '3').due, '2026-10-01');
  });
});

describe('validation strictness', () => {
  const base = { category: 'Phone call', type: 'RDD Action', status: 'completed', dueDate: '2026-10-07', fundraisers: ['9001'] };
  it('a bare channel word is an error with no note and only a warning when a note is filled in', () => {
    assert.equal(validateAction({ ...base, summary: 'Email' }).ok, false);
    const v = validateAction({ ...base, summary: 'Email', description: 'Wrote about the trip and asked for a visit.' });
    assert.equal(v.ok, true);
    assert.ok(v.warnings.some((w) => w.code === 'summary_bare_channel'));
  });
  it('the owner message does not name the old tool', () => {
    const v = validateAction({ ...base, summary: 'Called about the trip', fundraisers: [] });
    assert.match(v.warnings.find((w) => w.code === 'owner_missing').message, /nobody's list/);
  });
});
