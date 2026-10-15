// The rules behind the Receipts page in the web app (web/src/features/receipts/logic.ts and format.ts): how gifts group into receipts, the
// counts over them, which flags show, and the dates built by hand. Made-up partners only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/receipts/logic.ts');
const F = await import('../web/src/features/receipts/format.ts');

const gift = (o = {}) => ({ id: 'g1', lookup: 'L1', date: '2026-10-01', amount: 50, type: 'One-Time Gift', segment: 'regular', addressee: 'Sam Sample', sortName: 'Sample, Sam', place: 'Tampa, FL', fund: '', constituentLookup: '901', addressKey: '12 maple|33601', reason: '', key: '', canAdd: false, ...o });
const view = (letters, held = []) => ({ ok: true, asOf: '', days: 90, appealCode: 'Y26K-TY', letters, held, check: { partners: 0, address: 0, greeting: 0, duplicate: 0 } });

test('gifts of one partner print on one receipt, and a gift already in a file stays with that file', () => {
  const g = L.groupLetters([gift({ id: 'a' }), gift({ id: 'b', amount: 20 }), gift({ id: 'c', batch: { id: 'f1', letterDate: '2026-10-02' } })]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].gifts.map((x) => x.id), ['a', 'b']);
  assert.equal(g[1].batch.id, 'f1');
});

test('a receipt is monthly with only recurring payments, $200 and up from one gift of 200, otherwise regular', () => {
  assert.equal(L.segmentOfGifts([gift({ type: 'Recurring Gift Payment' })]), 'recurring');
  assert.equal(L.segmentOfGifts([gift({ amount: 200 })]), 'major');
  assert.equal(L.segmentOfGifts([gift({ amount: 199.99 }), gift({ id: 'x', amount: 5000, type: 'Recurring Gift Payment' })]), 'regular');
});

test('unticked gifts and gifts in a file leave the print list, and added held-back gifts join it', () => {
  const v = view([gift({ id: 'a' }), gift({ id: 'b', constituentLookup: '902' }), gift({ id: 'c', constituentLookup: '903', batch: { id: 'f', letterDate: '2026-10-02' } })], [gift({ id: 'h', constituentLookup: '904', canAdd: true })]);
  assert.deepEqual(L.printableOf(v, new Set(['b']), new Set(['h'])).map((x) => x.id), ['a', 'h']);
  const c = L.countsOf(L.printableOf(v, new Set(), new Set()));
  assert.equal(c.letters, 2);
  assert.equal(c.gifts, 2);
});

test('two records at one street address are named, and one record is not', () => {
  const v = view([gift({ id: 'a' }), gift({ id: 'b', constituentLookup: '902', addressee: 'Kim Sample' }), gift({ id: 'c', constituentLookup: '903', addressKey: 'elsewhere' })]);
  const shared = L.sharedAddresses(v, new Set());
  assert.equal(shared.size, 1);
  assert.equal(shared.get('12 maple|33601').size, 2);
});

test('the Needs a look filter keeps flagged receipts that are not in a file, and the search matches name, place and IDs', () => {
  const issue = { code: 'zip', group: 'address', text: 't', fix: 'f' };
  const v = view([gift({ id: 'a', issues: [issue] }), gift({ id: 'b', constituentLookup: '902', addressee: 'Pat Other', place: 'Ocala, FL' }), gift({ id: 'c', constituentLookup: '903', issues: [issue], batch: { id: 'f', letterDate: '2026-10-02' } })]);
  assert.deepEqual(L.filteredLetters(v, 'check', '').map((g) => g.first.id), ['a']);
  assert.deepEqual(L.filteredLetters(v, 'all', 'ocala').map((g) => g.first.id), ['b']);
  assert.deepEqual(L.filteredLetters(v, 'all', '903').map((g) => g.first.id), ['c']);
  assert.equal(L.flaggedGoing(v, L.printableOf(v, new Set(), new Set())), 1);
});

test('the open print file is a new one that is printing or marking', () => {
  assert.equal(L.openBatchOf([{ kind: 'reprint', status: 'printing' }, { kind: 'new', status: 'done' }]), undefined);
  assert.equal(L.openBatchOf([{ kind: 'new', status: 'done' }, { kind: 'new', status: 'marking', id: 'm' }]).id, 'm');
});

test('dates are built by hand: Eastern stamps, short days and the reply code', () => {
  assert.equal(F.day('2026-10-05'), 'Oct 5, 2026');
  assert.equal(F.shortDay('2026-10-05T14:00:00Z'), 'Oct 5');
  assert.equal(F.stamp('2026-10-05T19:45:00Z'), 'Oct 5, 3:45 PM');
  assert.equal(F.stamp('2026-01-05T05:05:00Z'), 'Jan 5, 12:05 AM');
  assert.equal(F.etDay('2026-10-06T02:30:00Z'), '2026-10-05');
  assert.equal(F.codeFor('2026-01-15'), 'Y261-TY');
  assert.equal(F.codeFor('2026-12-01'), 'Y26C-TY');
  assert.equal(F.plural(1, 'gift'), '1 gift');
  assert.equal(F.plural(1200, 'address', 'addresses'), '1,200 addresses');
  assert.equal(F.money(-5), '-$5.00');
});
