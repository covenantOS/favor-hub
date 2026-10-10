// Run with: npm test
//
// Group A of Work Center round 3: the partner note summary rules and the tag labels on Open actions rows. Made-up values only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const edit = await import('../functions/_lib/work/edit.ts');
const board = await import('../functions/_lib/actions/board.ts');
const repo = await import('../functions/_lib/work/repo.ts');

describe('partner note summary', () => {
  it('General stays as typed, another topic leads the summary, an instruction wins', () => {
    assert.equal(edit.noteSummary('Prefers mornings', 'General', false), 'Prefers mornings');
    assert.equal(edit.noteSummary('Pray for the surgery', 'Prayer', false), 'Prayer: Pray for the surgery');
    assert.equal(edit.noteSummary('Do not call after 8 PM', 'Family', true), 'Instruction: Do not call after 8 PM');
  });
  it('a lead the person typed is not doubled, and the summary stays inside 255 characters', () => {
    assert.equal(edit.noteSummary('Prayer: Pray for the surgery', 'Prayer', false), 'Prayer: Pray for the surgery');
    assert.equal(edit.noteSummary('Instruction: no calls', 'General', true), 'Instruction: no calls');
    assert.equal(edit.noteSummary('x'.repeat(400), 'Giving', false).length, 255);
  });
});

describe('tag labels on Open actions rows', () => {
  it('lists the tags the mirror holds, with the ask in dollars and the referral count', () => {
    assert.deepEqual(board.tagLabels({ tg_thanked: 1, tg_texted: 0, tg_stew: 1, tg_pres: 1, tg_att: 'Hosted', tg_ask: 2500, tg_ref: 3 }), [
      'Thanked', 'Stewardship', 'Favor Presentation', 'Hosted Event', 'Ask $2,500', '3 referrals',
    ]);
    assert.deepEqual(board.tagLabels({ tg_att: 'Attended', tg_ref: 1 }), ['Attended Event', '1 referral']);
    assert.deepEqual(board.tagLabels({}), []);
  });
  it('the open actions query reads the tag columns and stays read-only', () => {
    const sql = repo.openActionsSql(10);
    assert.match(sql, /LEFT JOIN action_tags t ON t\.id = a\.id/);
    assert.match(sql, /tg_ask/);
  });
});
