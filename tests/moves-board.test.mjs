// Moves board: which stage each partner sits in, the totals per stage, scope, the order, and the relationship groups. Invented partners only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { compose, inScope, keyIndex, sorter, tally, matches, POOL } = await import('../functions/_lib/moves/board.ts');
const { guardTester } = await import('../functions/_lib/moves/service.ts');
const { groupOf, REL_TYPES } = await import('../functions/_lib/moves/relations.ts');

const stages = [
  { id: 'identify', label: 'Identify', sort: 10, role: '', active: 1 },
  { id: 'ask', label: 'Ask', sort: 40, role: 'ask', active: 1 },
  { id: 'steward', label: 'Steward', sort: 60, role: '', active: 1 },
  { id: 'old', label: 'Old', sort: 70, role: '', active: 0 },
];
const hh = (key, name, largest, major = true, spouse = null) => ({ key, record: key, spouse, name, city: 'Tampa', state: 'FL', largest, lifetime: largest * 2, lastGift: '2026-01-02', lastContact: null, major });
const ask = (id, cid, key, amount, owners, close = null) => ({ id, cid, key, name: 'N' + cid, place: '', amount, owners, close, date: '2026-09-01' });
const base = { stages, cards: [], holders: {}, asks: [], today: '2026-10-15' };

describe('stages', () => {
  const households = [hh('1', 'Ada Major', 5000), hh('2', 'Bo Major', 1200), hh('3', 'Cy Small', 200, false)];
  it('puts a major partner with no ask and no card in the pool, and leaves out a small giver', () => {
    const rows = compose({ ...base, households });
    assert.deepEqual(rows.map((r) => [r.key, r.stage]).sort(), [['1', POOL], ['2', POOL]]);
  });
  it('puts a partner with an open ask in the stage marked ask', () => {
    const rows = compose({ ...base, households, asks: [ask('a1', '1', '1', 10000, ['f1']), ask('a2', '3', '3', 500, ['f1'])] });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.equal(by['1'].stage, 'ask');
    assert.equal(by['3'].stage, 'ask');
    assert.equal(by['3'].major, false);
    assert.equal(by['2'].stage, POOL);
  });
  it('a stage row wins over the ask, and a card in an archived stage falls back', () => {
    const cards = [
      { key: '1', cid: '1', stage_id: 'steward', next_step: 'Thank by phone', next_due: '2026-10-10', entered_at: 'x', updated_at: 'x', updated_by: 'a' },
      { key: '2', cid: '2', stage_id: 'old', next_step: null, next_due: null, entered_at: 'x', updated_at: 'x', updated_by: 'a' },
    ];
    const rows = compose({ ...base, households, cards, asks: [ask('a1', '1', '1', 10000, ['f1'])] });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.equal(by['1'].stage, 'steward');
    assert.equal(by['1'].staged, true);
    assert.equal(by['1'].overdue, true);
    assert.equal(by['1'].asked, 10000);
    assert.equal(by['2'].stage, POOL);
    assert.equal(by['2'].staged, false);
  });
  it('sums the asks of one household and takes the earliest close date', () => {
    const rows = compose({ ...base, households, asks: [ask('a1', '1', '1', 1000, ['f1'], { date: '2026-12-01' }), ask('a2', '1', '1', 2500, ['f2'], { date: '2026-11-01' })] });
    const r = rows.find((x) => x.key === '1');
    assert.equal(r.asked, 3500);
    assert.equal(r.asks, 2);
    assert.equal(r.closeDate, '2026-11-01');
    assert.deepEqual(r.owners.sort(), ['f1', 'f2']);
  });
  it('totals per stage add up to the total of the asks given', () => {
    const asks = [ask('a1', '1', '1', 1000, ['f1']), ask('a2', '2', '2', 2500, ['f1']), ask('a3', '9', '9', 700, ['f1'])];
    const rows = compose({ ...base, households, asks });
    assert.equal(tally(rows).asked, 4200);
    const per = ['ask', 'identify', 'steward', POOL].map((s) => tally(rows.filter((r) => r.stage === s)).asked);
    assert.equal(per.reduce((a, b) => a + b, 0), 4200);
  });
});

describe('households and scope', () => {
  it('maps both spouses to the household key', () => {
    const idx = keyIndex([hh('1', 'A and B', 5000, true, '7')]);
    assert.equal(idx.get('7'), '1');
    assert.equal(idx.get('1'), '1');
  });
  it('shows a row only to a person who holds the partner, or an admin', () => {
    const [r] = compose({ ...base, households: [hh('1', 'Ada', 5000)], holders: { 1: ['f1'] } });
    assert.equal(inScope(r, null), true);
    assert.equal(inScope(r, new Set(['f1', 'f9'])), true);
    assert.equal(inScope(r, new Set(['f2'])), false);
    assert.equal(inScope(r, new Set()), false);
  });
});

describe('order and search', () => {
  const rows = compose({
    ...base,
    households: [hh('1', 'Zed', 1000), hh('2', 'Amy', 9000), hh('3', 'Bea', 4000)],
    asks: [ask('a', '1', '1', 300, ['f']), ask('b', '2', '2', 300, ['f'])],
    cards: [{ key: '3', cid: '3', stage_id: 'identify', next_step: 'Visit', next_due: '2026-11-01', entered_at: 'x', updated_at: 'x', updated_by: 'a' }],
  });
  it('sorts by amount asked then largest gift, and puts blanks last', () => {
    assert.deepEqual([...rows].sort(sorter('asked')).map((r) => r.name), ['Amy', 'Zed', 'Bea']);
    assert.deepEqual([...rows].sort(sorter('due')).map((r) => r.name), ['Bea', 'Amy', 'Zed']);
    assert.deepEqual([...rows].sort(sorter('name')).map((r) => r.name), ['Amy', 'Bea', 'Zed']);
    assert.deepEqual([...rows].sort(sorter('largest')).map((r) => r.name), ['Amy', 'Bea', 'Zed']);
  });
  it('searches the name, the place and the next step', () => {
    assert.equal(rows.filter((r) => matches(r, 'visit')).length, 1);
    assert.equal(rows.filter((r) => matches(r, 'tampa')).length, 3);
    assert.equal(rows.filter((r) => matches(r, 'zz')).length, 0);
  });
});

describe('relationships', () => {
  it('groups types for the map', () => {
    assert.equal(groupOf('Spouse'), 'family');
    assert.equal(groupOf('Pastor'), 'church');
    assert.equal(groupOf('Board Member'), 'board');
    assert.equal(groupOf('Employee'), 'work');
    assert.equal(groupOf('Funds Administrator'), 'foundation');
    assert.equal(groupOf('Friend'), 'other');
  });
  it('every type has a reciprocal that is itself a type or a plain organization role', () => {
    for (const [t, back] of Object.entries(REL_TYPES)) assert.ok(back && t !== back || ['Sibling', 'Friend'].includes(t));
    assert.equal(REL_TYPES.Pastor, 'Church');
    assert.equal(REL_TYPES.Child, 'Parent');
  });
});

describe('test accounts', () => {
  const as = (email) => ({ email });
  it('lets a test account change only the two test partners', () => {
    guardTester(as('tester@favorintl.org'), '18698');
    guardTester(as('tester2@favorintl.org'), '16269', '18698');
    assert.throws(() => guardTester(as('tester@favorintl.org'), '27202'), /test partners/);
    assert.throws(() => guardTester(as('tester@favorintl.org'), '18698', '12345'), /test partners/);
  });
  it('leaves real staff alone', () => {
    guardTester(as('someone@favorintl.org'), '27202');
  });
});
