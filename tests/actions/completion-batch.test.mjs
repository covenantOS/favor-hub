import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addFundraiser, appendLine, closeThankedStep, completeStep, holderFundraisers, reassignStep, replaceFundraiser, rescheduleStep, thankSteps, undoStep } from '../../functions/_lib/actions/completion.ts';
import { CHUNK, chunk, laneFor, plannedCalls, resetLabel, undoUntil } from '../../functions/_lib/actions/batch.ts';
import { advance, findLostCreate, idemKey, requestFor, sayWhy, verdictOf } from '../../functions/_lib/actions/outbox.ts';

const T = { id: '11', cid: '100', due: '2026-10-01', type: 'RDD Action', category: 'Task/Other', description: 'Old note', summary: 'TY for $42', fundraisers: ['9001'] };
const O = { actor: 'Grace Morris', today: '2026-10-09' };

describe('complete', () => {
  it('closes with a date and keeps the old description when there is no line', () => {
    const s = completeStep(T, { ...O, date: '2026-10-08' });
    assert.deepEqual(s.body, { completed: true, completed_date: '2026-10-08T00:00:00' });
    assert.deepEqual(s.before, { completed: false });
    assert.equal(s.op, 'patch');
  });
  it("each one's due date", () => {
    assert.equal(completeStep(T, { ...O, own: true }).body.completed_date, '2026-10-01T00:00:00');
  });
  it('the shared line goes at the end of the description with the day and the person, and Undo keeps the old text', () => {
    const s = completeStep(T, { ...O, line: ' Sent thank you letter ' });
    assert.equal(s.body.description, 'Old note\nSent thank you letter (Oct 9, 2026, Grace Morris)');
    assert.equal(s.before.description, 'Old note');
    assert.equal(appendLine('', 'Done', '2026-10-09', ''), 'Done (Oct 9, 2026)');
  });
  it('the outcome is stored as Blackbaud words and anything else is ignored', () => {
    assert.equal(completeStep(T, { ...O, outcome: 'Successful' }).body.outcome, 'Successful');
    assert.equal(completeStep(T, { ...O, outcome: 'bad' }).body.outcome, undefined);
  });
});

describe('thank-you', () => {
  it('an RDD task completes in place with the category from the chip and the Thanked tag', () => {
    const steps = thankSteps(T, { ...O, how: 'letter' });
    assert.deepEqual(steps.map((s) => s.op), ['patch', 'tag']);
    assert.equal(steps[0].body.category, 'Mailing');
    assert.equal(steps[0].before.category, 'Task/Other');
    assert.equal(steps[1].body.category, 'Thanked');
  });
  it('a text also writes the Texted tag', () => {
    assert.deepEqual(thankSteps(T, { ...O, how: 'text' }).filter((s) => s.op === 'tag').map((s) => s.body.category), ['Thanked', 'Texted']);
  });
  it("a Follow Up task posts one completed contact of the owner's type, tags it, then closes the task", () => {
    const f = { ...T, type: 'RESERVED (Follow Up - New Gift Received)' };
    const steps = thankSteps(f, { ...O, how: 'call', ownerType: 'PC Action' });
    assert.deepEqual(steps.map((s) => s.op), ['create', 'tag', 'patch']);
    assert.equal(steps[0].body.type, 'PC Action');
    assert.equal(steps[0].body.category, 'Phone call');
    assert.equal(steps[0].body.completed, true);
    assert.equal(steps[1].dep, 0);
    assert.equal(steps[2].actionId, '11');
  });
  it('in two-record mode an RDD task is also posted separately and closed', () => {
    assert.deepEqual(thankSteps(T, { ...O, how: 'letter', thankMode: 'two' }).map((s) => s.op), ['create', 'tag', 'patch']);
  });
  it('Close only is a plain close', () => {
    assert.deepEqual(thankSteps(T, { ...O, how: 'none' }).map((s) => s.op), ['patch']);
  });
  it('close as thanked takes the date of the thank-you already logged', () => {
    const s = closeThankedStep({ ...T, thankedOn: '2026-10-02' }, O);
    assert.equal(s.body.completed_date, '2026-10-02T00:00:00');
  });
});

describe('reassign and reschedule', () => {
  it('give to the current holder: the departed come off, live co-owners stay', () => {
    const live = (id) => id !== '9003';
    assert.deepEqual(holderFundraisers(['9003', '9001'], '9002', live), ['9001', '9002']);
    assert.equal(holderFundraisers(['9001'], '9001', live), null);
    assert.equal(holderFundraisers(['9001'], null, live), null);
  });
  it('replace and add', () => {
    assert.deepEqual(replaceFundraiser(['9003', '9001'], '9003', '9002'), ['9001', '9002']);
    assert.deepEqual(replaceFundraiser(['9003', '9002'], '9003', '9002'), ['9002']);
    assert.equal(replaceFundraiser(['9001'], '9003', '9002'), null);
    assert.deepEqual(addFundraiser(['9001'], '9002'), ['9001', '9002']);
    assert.equal(addFundraiser(['9001'], '9001'), null);
  });
  it('steps carry the before values', () => {
    assert.deepEqual(reassignStep(T, ['9002']).before, { fundraisers: ['9001'] });
    assert.deepEqual(rescheduleStep(T, '2026-10-16').body, { date: '2026-10-16T00:00:00' });
    assert.deepEqual(rescheduleStep(T, '2026-10-16').before, { date: '2026-10-01T00:00:00' });
  });
});

describe('undo', () => {
  it('a complete comes back with completed false and the old description', () => {
    const s = completeStep(T, { ...O, line: 'x' });
    assert.deepEqual(undoStep({ op: 'patch', action_id: '11', bb_id: null, before: s.before }).body, { completed: false, description: 'Old note' });
  });
  it('a create is removed with DELETE and a tag has nothing to undo', () => {
    assert.deepEqual(undoStep({ op: 'create', action_id: null, bb_id: '77', before: null }), { op: 'delete', actionId: '77', body: {}, label: 'undo create' });
    assert.equal(undoStep({ op: 'tag', action_id: '11', bb_id: null, before: null }), null);
    assert.equal(undoStep({ op: 'create', action_id: null, bb_id: null, before: null }), null);
  });
});

describe('batch planning', () => {
  it('chunks of 15 and one read-back per 15', () => {
    assert.deepEqual(chunk(Array.from({ length: 31 }, (_, i) => i)).map((c) => c.length), [15, 15, 1]);
    assert.equal(CHUNK, 15);
    assert.equal(plannedCalls(31, 31), 34);
    assert.equal(plannedCalls(8 * 2, 8), 17);
  });
  it('small changes go now until the route reaches 2,700; large ones wait past 2,400', () => {
    assert.equal(laneFor({ planned: 10, used: 2500 }).when, 'now');
    assert.equal(laneFor({ planned: 10, used: 2695 }).when, 'tonight');
    assert.equal(laneFor({ planned: 100, used: 2300 }).when, 'now');
    assert.equal(laneFor({ planned: 100, used: 2301 }).when, 'tonight');
    assert.equal(laneFor({ planned: 40, used: 0 }).when, 'now');
  });
  it('the reset reads as 8:00 PM in summer and 7:00 PM in winter, and Undo lasts a day', () => {
    assert.equal(resetLabel(new Date('2026-10-09T12:00:00Z')), '8:00 PM');
    assert.equal(resetLabel(new Date('2026-12-09T12:00:00Z')), '7:00 PM');
    assert.equal(undoUntil(new Date('2026-10-09T20:00:00Z')), '2026-10-10T20:00:00.000Z');
  });
});

describe('outbox', () => {
  it('reads answers from the upkeep route', () => {
    assert.equal(verdictOf({ ok: true, status: 200, body: null }), 'sent');
    assert.equal(verdictOf({ ok: false, status: 0, body: null, refused: 'no rule' }), 'refused');
    assert.equal(verdictOf({ ok: false, status: 0, body: null, wait: 'busy' }), 'wait');
    assert.equal(verdictOf({ ok: false, status: 429, body: null }), 'wait');
    assert.equal(verdictOf({ ok: false, status: 404, body: null }), 'gone');
    assert.equal(verdictOf({ ok: false, status: 400, body: [{ message: 'bad' }] }), 'failed');
    assert.equal(verdictOf(undefined), 'wait');
  });
  it('a refused tag waits in the queue and never counts as a failed try', () => {
    assert.deepEqual(advance(0, 'refused'), { state: 'queued', attempts: 0 });
    assert.deepEqual(advance(0, 'failed'), { state: 'failed', attempts: 1 });
    assert.deepEqual(advance(1, 'failed'), { state: 'needs_human', attempts: 2 });
    assert.deepEqual(advance(0, 'sent'), { state: 'sent', attempts: 1 });
  });
  it('staff wording never names a status code', () => {
    assert.match(sayWhy({ ok: false, status: 400, body: [{ message: 'The date is not valid' }] }), /^Blackbaud turned it down: The date is not valid/);
    assert.doesNotMatch(sayWhy({ ok: false, status: 500, body: null, wait: 'Blackbaud is busy. It will try again.' }), /\b500\b/);
  });
  it('the same create gives the same key, a different date a different one', async () => {
    const a = await idemKey(['100', '2026-10-01', 'RDD Action', 'Phone call', 'Called', '9001', 'grace']);
    const b = await idemKey(['100', '2026-10-01', 'rdd action', 'Phone call', ' Called ', '9001', 'grace']);
    const c = await idemKey(['100', '2026-10-02', 'RDD Action', 'Phone call', 'Called', '9001', 'grace']);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a.length, 40);
  });
  it('a lost create is found again by type, date and summary and never posted twice', () => {
    const existing = [{ id: '5', type: 'RDD Action', date: '2026-10-01T00:00:00', summary: 'Called about the gift' }, { id: '6', type: 'PC Action', date: '2026-10-01T00:00:00', summary: 'Called about the gift' }];
    assert.equal(findLostCreate(existing, { type: 'rdd action', date: '2026-10-01', summary: 'called about the gift ' }), '5');
    assert.equal(findLostCreate(existing, { type: 'RDD Action', date: '2026-10-02', summary: 'Called about the gift' }), null);
    assert.equal(findLostCreate(existing, { type: 'RDD Action', date: '2026-10-01', summary: 'Called about the gift' }, ['5']), null);
  });
  it('paths come from the row', () => {
    assert.deepEqual(requestFor({ op: 'patch', action_id: '11' }), { method: 'PATCH', path: '/constituent/v1/actions/11' });
    assert.deepEqual(requestFor({ op: 'create', action_id: null }), { method: 'POST', path: '/constituent/v1/actions' });
    assert.deepEqual(requestFor({ op: 'delete', action_id: '77' }), { method: 'DELETE', path: '/constituent/v1/actions/77' });
    assert.equal(requestFor({ op: 'tag', action_id: '11' }).path, '/constituent/v1/actions/customfields');
  });
});
