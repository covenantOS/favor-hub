import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adoptTask, matchSatisfier, parseTaskText, strictSignals } from '../../functions/_lib/actions/satisfier.ts';
import { DEFAULTS } from '../../functions/_lib/actions/params.ts';
import { buildObligations } from '../../functions/_lib/actions/obligations.ts';
import { act, gift } from './helpers.mjs';

describe('parseTaskText', () => {
  it('reads K and M amounts as thousands and millions', () => {
    assert.deepEqual(parseTaskText('TY for $10K gift on 8/19').amounts, [10000]);
    assert.deepEqual(parseTaskText('New $2k and $1.5M pledge').amounts, [2000, 1500000]);
    assert.deepEqual(parseTaskText('Gift of $1,250.00 on 8/16/2026.').amounts, [1250]);
  });
  it('does not read a dollar amount followed by letters as a K amount', () => {
    assert.deepEqual(parseTaskText('$50 kindly').amounts, [50]);
  });
  it('reads dates with and without a year', () => {
    const d = parseTaskText('ty 10/2 and 9/5/26').dates;
    assert.deepEqual(d, [{ month: 10, day: 2, year: null }, { month: 9, day: 5, year: 2026 }]);
  });
});

describe('strict wording', () => {
  it('sent is a whole word: present, consent and Presented are not thank-yous', () => {
    for (const s of ['present at the dinner', 'consent form', 'Presented the vision']) assert.deepEqual(strictSignals(act({ summary: s }), DEFAULTS), [], s);
    assert.deepEqual(strictSignals(act({ summary: 'Sent letter' }), DEFAULTS), ['summary_wording']);
    assert.deepEqual(strictSignals(act({ summary: 'TY card' }), DEFAULTS), ['summary_wording']);
  });
});

describe('matchSatisfier', () => {
  const later = (o) => act({ id: '9', completed: true, completedDate: '2026-10-02', dateAdded: '2026-10-02', ...o });
  it('an earlier completed thank-you on the partner answers a task', () => {
    const r = matchSatisfier({ partnerIds: ['100'], anchorDate: '2026-09-28', excludeIds: ['1'] }, [later({ summary: 'Thank you call' })]);
    assert.equal(r.level, 'strict');
  });
  it('a thank-you that names a different amount does not answer this gift', () => {
    const c = later({ summary: 'ty $100 10/2/26' });
    const r = matchSatisfier({ partnerIds: ['100'], anchorDate: '2026-09-28', giftAmounts: [50] }, [c]);
    assert.notEqual(r.level, 'strict');
    const same = matchSatisfier({ partnerIds: ['100'], anchorDate: '2026-09-28', giftAmounts: [100] }, [c]);
    assert.equal(same.level, 'strict');
  });
  it('a whole-dollar thank-you matches a gift with cents', () => {
    const r = matchSatisfier({ partnerIds: ['100'], anchorDate: '2026-09-28', giftAmounts: [42.49] }, [later({ summary: 'TY for $42' })]);
    assert.equal(r.level, 'strict');
  });
  it('an open action never answers, and neither does another partner', () => {
    assert.equal(matchSatisfier({ partnerIds: ['100'], anchorDate: '2026-09-28' }, [act({ id: '9', summary: 'ty', completed: false })]).level, 'none');
    assert.equal(matchSatisfier({ partnerIds: ['100'], anchorDate: '2026-09-28' }, [later({ constituentId: '200', summary: 'ty' })]).level, 'none');
  });
  it('a completed call with no thank wording is a loose answer', () => {
    const r = matchSatisfier({ partnerIds: ['100'], anchorDate: '2026-09-28' }, [later({ summary: 'Checked in', category: 'Phone call' })]);
    assert.equal(r.level, 'loose');
  });
});

describe('adoptTask', () => {
  it('links a task naming a $10K gift with a date to that gift', () => {
    const big = gift({ id: '600', amount: 10000, giftDate: '2026-08-19', enteredDate: '2026-08-20' });
    const obs = buildObligations([big]);
    const r = adoptTask(act({ summary: 'TY for $10K on 8/19', dueDate: '2026-09-30' }), obs);
    assert.equal(r.how, 'amount_date');
    assert.equal(r.giftId, '600');
  });
  it('refuses a gift when the task names a different amount', () => {
    const obs = buildObligations([gift()]);
    const r = adoptTask(act({ summary: 'ty $500', dueDate: '2026-09-28' }), obs);
    assert.equal(r.giftId, null);
  });
});
