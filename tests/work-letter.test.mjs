// Run with: npm test
//
// The letter engine (functions/_lib/work/letters.ts): salutations and addressees for individuals, couples, titled people and
// organizations, the merge fields, the HQTY letter, the one-to-one thank-you letter, and the PDF it draws. Every name and amount is
// made up: the repository is public. The wording is checked as golden text, so a change to a sentence shows up here.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../functions/_lib/work/letters.ts');
const { lettersPdf } = await import('../functions/_lib/work/letters-pdf.ts');

const couple = { kind: 'Individual', first: 'Daniel', last: 'Ellison', spouseFirst: 'Margaret', spouseLast: 'Ellison' };
const GIFT = { amount: 5000, date: '2026-10-14', fund: 'Water wells, South Sudan' };

describe('names', () => {
  it('names a couple on one line and greets both', () => {
    const n = L.nameFor(couple);
    assert.equal(n.addressee, 'Daniel and Margaret Ellison');
    assert.equal(n.greeting, 'Dear Daniel and Margaret,');
    assert.equal(n.household, true);
  });
  it('keeps both last names when they differ', () => {
    assert.equal(L.nameFor({ kind: 'Individual', first: 'Joyce', last: 'Holt', spouseFirst: 'Raymond', spouseLast: 'Cole' }).addressee, 'Joyce Holt and Raymond Cole');
  });
  it('uses the preferred name, and a title when there is no spouse', () => {
    assert.equal(L.nameFor({ kind: 'Individual', first: 'William', preferred: 'Will', last: 'Reyes' }).greeting, 'Dear Will,');
    assert.equal(L.nameFor({ kind: 'Individual', first: 'Ann', last: 'Reyes', title: 'Dr.' }).greeting, 'Dear Dr. Reyes,');
  });
  it('greets an organization as friends at it', () => {
    const n = L.nameFor({ kind: 'Organization', org: 'The Whitcomb Family Foundation' });
    assert.equal(n.greeting, 'Dear friends at The Whitcomb Family Foundation,');
    assert.equal(n.addressee, 'The Whitcomb Family Foundation');
  });
  it('falls back to Dear friend when there is no name', () => {
    assert.equal(L.nameFor({ kind: 'Individual' }).greeting, 'Dear friend,');
  });
});

describe('addresses', () => {
  const a = { lines: '1420 Bayshore Blvd\r\nSuite 4', city: 'Tampa', state: 'FL', zip: '33606', country: 'United States' };
  it('builds the mailing block and leaves the home country off', () => {
    assert.deepEqual(L.addressBlock(couple, a), ['Daniel and Margaret Ellison', '1420 Bayshore Blvd', 'Suite 4', 'Tampa, FL 33606']);
    assert.equal(L.addressBlock(couple, { ...a, country: 'Canada' }).at(-1), 'Canada');
  });
  it('says an address is usable only with a street, a city and a ZIP or state', () => {
    assert.equal(L.usableAddress(a), true);
    assert.equal(L.usableAddress({ ...a, lines: '' }), false);
    assert.equal(L.usableAddress(null), false);
  });
});

describe('the HQTY letter', () => {
  it('merges the three fields and prints a blank signature with no name', () => {
    const d = L.hqtyLetter(couple, { lines: '1 Main St', city: 'Tampa', state: 'FL', zip: '33606' }, GIFT, L.HQTY_DEFAULT, '2026-10-15');
    assert.equal(d.dateLine, 'October 15, 2026');
    assert.equal(d.greeting, 'Dear Daniel and Margaret,');
    assert.equal(d.paragraphs[0], 'Thank you for your gift of $5,000 on Oct 14. I am writing to you myself because a gift of this size changes what Favor can do this year.');
    assert.match(d.paragraphs[1], /^Your gift to Water wells, South Sudan reaches the people we serve\./);
    assert.equal(d.signerName, '');
    assert.equal(d.signerTitle, '');
    assert.equal(d.closing, 'With gratitude,');
  });
  it('says the mission when no fund is on file, and shows cents when there are some', () => {
    assert.equal(L.merge('{fund}', { ...GIFT, fund: '' }), "Favor's work");
    assert.equal(L.merge('{amount}', { ...GIFT, amount: 5250.5 }), '$5,250.50');
  });
  it('drops fields it does not know when a month text is saved', () => {
    assert.equal(L.cleanLetterText('Thank you {amount} {nonsense} for {fund}.'), 'Thank you {amount}  for {fund}.');
  });
  it('picks the month text, else the latest earlier month, else the default', async () => {
    const { textForMonth } = await import('../functions/_lib/work/hqty.ts');
    assert.equal(textForMonth({}, '2026-10'), L.HQTY_DEFAULT);
    assert.equal(textForMonth({ '2026-08': 'August text', '2026-11': 'November text' }, '2026-10'), 'August text');
    assert.equal(textForMonth({ '2026-10': 'October text' }, '2026-10'), 'October text');
  });
});

describe('the thank-you letter', () => {
  const from = { fromName: 'Jordan Reyes', fromTitle: 'Regional Development Director' };
  it('puts the gift first, then the switches the person turned on', () => {
    const d = L.thankLetter(couple, null, GIFT, { ...from, said: 'Board meets in November.', invitation: true }, '2026-10-15');
    assert.deepEqual(d.paragraphs, [
      'Thank you for your gift of $5,000 for Water wells, South Sudan on Oct 14.',
      'Because you gave toward Water wells, South Sudan, I wanted you to know the work there continues and your gift goes to it.',
      'Board meets in November.',
      'I would welcome the chance to talk with you about what your gift is doing. Call me any time.',
      'I am praying for you and your family.',
    ]);
    assert.equal(d.signerName, 'Jordan Reyes');
    assert.equal(d.signerTitle, 'Regional Development Director');
  });
  it('leaves a paragraph out when its switch is off or it has nothing to say', () => {
    const d = L.thankLetter({ kind: 'Individual', first: 'Will', last: 'Reyes' }, null, { ...GIFT, fund: '' }, { ...from, designation: false, words: false }, '2026-10-15');
    assert.deepEqual(d.paragraphs, ['Thank you for your gift of $5,000 on Oct 14.', 'I am praying for you.']);
  });
  it('closes an organization letter to the team', () => {
    const d = L.thankLetter({ kind: 'Organization', org: 'Holt Fund' }, null, GIFT, from, '2026-10-15');
    assert.equal(d.paragraphs.at(-1), 'I am praying for you and your team.');
  });
  it('writes the plain text for email', () => {
    const t = L.letterText(L.thankLetter(couple, null, GIFT, from, '2026-10-15'));
    assert.match(t, /^Dear Daniel and Margaret,\n\nThank you for your gift/);
    assert.match(t, /With gratitude,\n\nJordan Reyes\nRegional Development Director$/);
  });
  it('titles a regional development director plainly', () => {
    assert.equal(L.titleFor('Regional Development Director (RDD)'), 'Regional Development Director');
  });
});

describe('the PDF', () => {
  it('draws one page per letter, even with accents and curly quotes in the text', async () => {
    const text = 'It’s a “gift” — thank you for {amount}. '.repeat(3);
    const docs = [1, 2, 3].map((i) => L.hqtyLetter({ kind: 'Individual', first: 'José', last: `Núñez${i}` }, { lines: '9 Calle', city: 'Miami', state: 'FL', zip: '33101' }, GIFT, text, '2026-10-15'));
    const bytes = await lettersPdf(docs, 'Test');
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
  });
});
