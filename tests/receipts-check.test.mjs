// Run with: npm test
// The check before printing: addresses that will not deliver, greetings that print badly, and two records that look like one
// partner. Made-up partners only. Nothing here calls Blackbaud, marks a gift or makes a print file.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const C = await import('../functions/_lib/receipts/check.ts');
const R = await import('../functions/_lib/receipts/rules.ts');

let n = 0;
const gift = (over = {}) => {
  n++;
  const g = {
    id: `g${n}`,
    lookup: `G-${n}`,
    date: '2026-10-05',
    amount: 50,
    type: 'One-Time Gift',
    constituency: 'Individual',
    constituentLookup: String(1000 + n),
    name: `Pat Example${'abcdefghijklmnopqrstuvwxyz'[n % 26]}${'qrstuvwxyzabcdefghijklmnop'[(n * 7) % 26]}`,
    sortName: 'Example, Pat',
    organization: false,
    deceased: false,
    inactive: false,
    addressee: undefined,
    salutation: 'Pat',
    solicitCodes: [],
    addressLines: ['12 Maple Street'],
    city: 'Tampa',
    state: 'FL',
    zip: '33601',
    country: 'United States',
    sendMail: true,
    funds: ['Where Needed Most'],
    softCredits: [],
    ...over,
  };
  return { ...g, addressee: over.addressee === undefined ? g.name : over.addressee };
};
const codes = (flags, g) => (flags.get(g.id) || []).map((i) => i.code).sort();

test('a clean record gets no flags', () => {
  const g = gift();
  assert.equal(R.verdict(g).letter, true);
  assert.deepEqual(codes(C.checkGifts([g]), g), []);
});

test('addresses: a short ZIP, a state that is not one, no house number and a city with digits', () => {
  const zip = gift({ zip: '3360' });
  const st = gift({ state: 'Floridda' });
  const street = gift({ addressLines: ['Maple Street'] });
  const box = gift({ addressLines: ['PO Box 88'] });
  const city = gift({ city: 'Tampa 33' });
  const nine = gift({ zip: '33601-1234' });
  const flags = C.checkGifts([zip, st, street, box, city, nine]);
  assert.deepEqual(codes(flags, zip), ['bad_zip']);
  assert.deepEqual(codes(flags, st), ['bad_state']);
  assert.deepEqual(codes(flags, street), ['street_no_number']);
  assert.deepEqual(codes(flags, box), [], 'a PO box needs no house number');
  assert.deepEqual(codes(flags, city), ['bad_city']);
  assert.deepEqual(codes(flags, nine), [], 'ZIP plus four is fine');
  assert.match(flags.get(zip.id)[0].fix, /ZIP/);
});

test('greetings: a blank or placeholder addressee always flags; a missing salutation only when the wording uses first names', () => {
  const blank = gift({ addressee: '', name: '' });
  const holder = gift({ addressee: 'Unknown', name: 'Unknown' });
  const caps = gift({ addressee: 'PAT EXAMPLE', name: 'PAT EXAMPLE' });
  const noSal = gift({ salutation: '' });
  const church = gift({ organization: true, constituency: 'Church', addressee: 'First Baptist Church', name: 'First Baptist Church', salutation: '' });
  const all = [blank, holder, caps, noSal, church];
  const full = C.checkGifts(all, 'full');
  assert.deepEqual(codes(full, blank), ['no_name']);
  assert.deepEqual(codes(full, holder), ['name_looks_wrong']);
  assert.deepEqual(codes(full, caps), ['name_looks_wrong']);
  assert.deepEqual(codes(full, noSal), [], 'the full-name greeting never reads the salutation');
  const first = C.checkGifts(all, 'first');
  assert.deepEqual(codes(first, noSal), ['no_salutation']);
  assert.deepEqual(codes(first, church), [], 'an organization has no first name to fall back from');
});

test('duplicates: the same name on two records, and one name inside the other at one address; a household is left alone', () => {
  const a = gift({ constituentLookup: '2001', addressee: 'Jordan Rivers', name: 'Jordan Rivers', addressLines: ['5 Oak Lane'], zip: '30301' });
  const b = gift({ constituentLookup: '2002', addressee: 'Jordan  Rivers', name: 'Jordan Rivers', addressLines: ['9 Pine Court'], zip: '30302' });
  const c = gift({ constituentLookup: '2003', addressee: 'Sam Lee', name: 'Sam Lee', addressLines: ['1 Elm Road'], zip: '40001' });
  const d = gift({ constituentLookup: '2004', addressee: 'Sam and Kim Lee', name: 'Sam and Kim Lee', addressLines: ['1 Elm Rd.'], zip: '40001' });
  const e = gift({ constituentLookup: '2005', addressee: 'Kim Lee', name: 'Kim Lee', addressLines: ['1 Elm Road'], zip: '40001' });
  const f = gift({ constituentLookup: '2006', addressee: 'Alex Fox', name: 'Alex Fox', addressLines: ['3 Birch Way'], zip: '50001' });
  const g = gift({ constituentLookup: '2007', addressee: 'Dana Fox', name: 'Dana Fox', addressLines: ['3 Birch Way'], zip: '50001' });
  const flags = C.checkGifts([a, b, c, d, e, f, g]);
  assert.deepEqual(codes(flags, a), ['duplicate']);
  assert.equal(flags.get(a.id)[0].other.lookup, '2002');
  assert.deepEqual(codes(flags, b), ['duplicate']);
  assert.deepEqual(codes(flags, c), ['duplicate'], 'Sam Lee sits inside Sam and Kim Lee at one address');
  assert.deepEqual(codes(flags, d), ['duplicate', 'duplicate'], 'one flag for each of the two records inside it');
  assert.deepEqual(codes(flags, e), ['duplicate'], 'Kim Lee sits inside Sam and Kim Lee too');
  assert.deepEqual(codes(flags, f), [], 'two people at one address with different names are a household');
  assert.deepEqual(codes(flags, g), []);
});

test('a partner with two gifts carries the same flags on each, and the summary counts partners', () => {
  const one = gift({ constituentLookup: '3001', zip: '12' });
  const two = gift({ constituentLookup: '3001', zip: '12', amount: 25 });
  const ok = gift({ constituentLookup: '3002' });
  const flags = C.checkGifts([one, two, ok]);
  assert.deepEqual(codes(flags, one), ['bad_zip']);
  assert.deepEqual(codes(flags, two), ['bad_zip']);
  const s = C.summarize([one, two, ok], flags);
  assert.deepEqual(s, { address: 1, greeting: 0, duplicate: 0, partners: 1 });
});

test('the check changes nothing: gifts come back as they went in', () => {
  const g = gift({ zip: '12' });
  const before = JSON.stringify(g);
  C.checkGifts([g]);
  assert.equal(JSON.stringify(g), before);
});
