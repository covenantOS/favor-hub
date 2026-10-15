// Data care scoring: which shared-email pairs reach the review list and how they read. Invented names only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { scorePair, nameMatch, pairId, MIN_SCORE } = await import('../functions/_lib/datacare/score.ts');
const { whyOf, yearBefore } = await import('../functions/_lib/datacare/scan.ts');

const p = (first, last) => ({ first, last });

describe('names', () => {
  it('reads nicknames, initials and swapped names', () => {
    assert.equal(nameMatch(p('Kathleen', 'Taylor'), p('Kathy', 'Taylor')), 'nickname');
    assert.equal(nameMatch(p('Anthony Mwangi', 'Okello'), p('Okello', 'Mwangi')), 'swapped');
    assert.equal(nameMatch(p('Lori', 'Riddle'), p('T', 'Riddle')), 'last');
    assert.equal(nameMatch(p('Asher', 'Roberts'), p('Asher', 'R')), 'same');
    assert.equal(nameMatch(p('Joe', "O'Boyle"), p('Joe', 'Boyle')), 'same');
    assert.equal(nameMatch(p('Sam', 'Neelam'), p('Prabhu', 'Neelam')), 'last');
    assert.equal(nameMatch(p('Ann', 'Young'), p('Ben', 'Hall')), 'none');
  });
});

describe('score', () => {
  it('puts the same person above a couple on one inbox', () => {
    const same = scorePair({ a: p('Gilford', 'Rogers'), b: p('Gil', 'Rogers'), group: 2, sameZip: true });
    const couple = scorePair({ a: p('Chris', 'Lema'), b: p('Melissa', 'Lema'), group: 2, sameZip: true });
    assert.ok(same.score > couple.score);
    assert.ok(same.score >= 60);
    assert.match(couple.why, /different first names/);
  });
  it('drops an office inbox shared by strangers', () => {
    const s = scorePair({ a: p('Ann', 'Young'), b: p('Ben', 'Hall'), group: 2, sameZip: false });
    assert.ok(s.score < MIN_SCORE);
  });
  it('lowers a pair as the inbox is shared by more records', () => {
    const two = scorePair({ a: p('Jo', 'Reed'), b: p('Jo', 'Reed'), group: 2, sameZip: false }).score;
    const four = scorePair({ a: p('Jo', 'Reed'), b: p('Jo', 'Reed'), group: 4, sameZip: false }).score;
    assert.ok(four < two);
  });
  it('orders ids so a pair has one name', () => {
    assert.equal(pairId('900', '12'), '12-900');
    assert.equal(pairId('12', '900'), '12-900');
  });
});

describe('scan helpers', () => {
  it('names the reason for a missing address', () => {
    assert.equal(whyOf('dnm,no_street'), 'dnm');
    assert.equal(whyOf('no_street'), 'no_street');
    assert.equal(whyOf('inactive'), 'inactive');
    assert.equal(whyOf(null), 'none');
  });
  it('counts 12 months back from the day', () => {
    assert.equal(yearBefore('2026-10-14'), '2025-10-14');
  });
});
