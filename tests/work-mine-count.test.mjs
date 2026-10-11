// Run with: npm test
// "Mine" has one definition. The Work Center chip (board counts) and the Work Overview due card both call mineRows,
// so the same made-up board must give both the same number. Made-up names and ids only: the repository is public.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const board = await import('../functions/_lib/actions/board.ts');
const home = await import('../functions/_lib/work/home.ts');

const TODAY = '2026-10-11';
const row = (id, fundraisers, o = {}) => ({
  id, due: '2026-10-01', added: '2026-09-01', type: 'Call', typeRaw: 'Call', category: 'Task/Other', summary: 'Call back',
  description: '', cid: `c${id}`, lookup: '', partner: `Partner ${id}`, place: 'Springfield', fundraisers, holders: [],
  gift: null, later: null, group: null, deceased: false, ty: false, ctg: false, priority: '', pending: null, ...o,
});
const rows = [
  row('1', ['501']),
  row('2', ['501', '502']),
  row('3', ['502']),
  row('4', ['501'], { due: '2026-12-01' }),
  row('5', ['501'], { ty: true, later: null }),
  row('6', []),
  row('7', ['501'], { deceased: true }),
  row('8', ['501'], { pending: { op: 'reassign', state: 'saving', label: 'Saving' } }),
];
const ctx = (fid) => ({ scope: { role: 'director', email: 'pat@example.org', name: 'Pat', fid, team: 'RDD', all: false, fids: new Set([fid]) } });

describe('Mine: one definition', () => {
  it('mineRows is the open actions that list the signed-in fundraiser', () => {
    assert.deepEqual(board.mineRows(rows, '501').map((r) => r.id), ['1', '2', '4', '5', '7', '8']);
    assert.deepEqual(board.mineRows(rows, '502').map((r) => r.id), ['2', '3']);
    assert.deepEqual(board.mineRows(rows, '').map((r) => r.id), []);
  });

  it('the board counts (Work Center chip) and the Work Overview card report the same Mine number', () => {
    const mine = board.countsOf(rows, TODAY, '501').mine;
    const b = { rows, people: {}, synced: '', orphans: 0, today: TODAY };
    const due = home.duePool(ctx('501'), b);
    assert.equal(mine, 6);
    assert.equal(due.mine, mine);
    assert.equal(due.pool.length, mine, 'the due card lists the same rows when the person holds actions');
  });

  it('a person with no actions sees Mine 0, and the card falls back to the portfolio only for its own list', () => {
    const b = { rows, people: {}, synced: '', orphans: 0, today: TODAY };
    assert.equal(board.countsOf(rows, TODAY, '999').mine, 0);
    const due = home.duePool(ctx('999'), b);
    assert.equal(due.mine, 0);
    assert.equal(due.portfolio, true);
  });

  it('counts Mine as 0 when no fundraiser id is known', () => {
    assert.equal(board.countsOf(rows, TODAY).mine, 0);
  });
});
