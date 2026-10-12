// Blackbaud writes a gift of type Amendment (receipt amount $0) whenever a recurring gift is amended. It never reaches a Receipts list or count.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const R = await import('../functions/_lib/receipts/rules.ts');

const row = (id, type, amount = '25') => ({
  QRECID: id, 'Gift ID': `G-${id}`, 'Gift Date': '10/12/2026 12:00:00 AM', 'Gift Amount': amount, 'Gift Type': type, 'Gift Constituency': 'Individual',
  'Constituent ID': '1001', Name: 'Pat Example', 'Sort Name': 'Example, Pat', 'Key Indicator': 'Individual', 'Preferred Address Lines': '12 Maple Street',
  'Preferred City': 'Tampa', 'Preferred State': 'FL', 'Preferred ZIP': '33601', 'Preferred Country': 'United States', 'Preferred Send Mail To This Address': 'Yes',
  'Fund Description': 'Where Needed Most',
});

test('a gift whose type reads Amendment is left out of the waiting list, however many rows it comes in', () => {
  const rows = [row('1', 'One-Time Gift'), row('2', 'Amendment', '0'), { ...row('2', 'Amendment', '0'), 'Fund Description': 'Wells' }, row('3', 'Recurring Gift Payment'), row('4', 'Amendment', '25')];
  const gifts = R.giftsFromRows(rows);
  assert.deepEqual(gifts.map((g) => g.id), ['1', '3']);
  assert.equal(gifts.filter((g) => R.verdict(g).letter).length, 2);
  assert.equal(gifts.filter((g) => !R.verdict(g).letter).length, 0, 'no held row, so no count of held gifts either');
});

test('isAmendment reads the type and nothing else', () => {
  assert.equal(R.isAmendment('Amendment'), true);
  assert.equal(R.isAmendment('amendment'), true);
  assert.equal(R.isAmendment('Recurring Gift Amendment'), true);
  assert.equal(R.isAmendment('One-Time Gift'), false);
  assert.equal(R.isAmendment(''), false);
});
