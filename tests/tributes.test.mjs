// Run with: npm test
// Tributes: the comment parser, and the tribute fields on an Other gifts row. Made-up names only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { parseTribute } = await import('../functions/_lib/tributes/parse.ts');
const { cleanEdit, blockers } = await import('../functions/_lib/other-gifts/rules.ts');

describe('parseTribute', () => {
  const cases = [
    ['In memory of Albert Example', 'memorial', 'Albert Example'],
    ['In loving memory of my son - Albert "Bert" Example', 'memorial', 'Albert "Bert" Example'],
    ['Given in memory of my daughter, Kay Example. #LiveLikeKay', 'memorial', 'my daughter, Kay Example'],
    ['Donated in loving memory of Mary W. Example. ', 'memorial', 'Mary W. Example'],
    ['Donation in memory of Pat Example', 'memorial', 'Pat Example'],
    ['Abe Example Memorial Fund', 'memorial', 'Abe Example'],
    ['In Honor of Jo Example of your staff.', 'honor', 'Jo Example'],
    ['In honor of Greg and Pam Example', 'honor', 'Greg and Pam Example'],
    ['Tribute to Chris Example', 'honor', 'Chris Example'],
    ['I wanted to support you to honor Gabe Example and his wonderful wife, Terese.', 'honor', 'Gabe Example and his wonderful wife, Terese'],
    ['Letter states "...check is in honor of Dan Example\'s birthday, which will be on April 27. Please send an acknowledgment of this gift in his honor to his home address."', 'honor', 'Dan Example'],
    ['Online gift via favorintl.org | Designation: Education | Donor note: To honor Jo Example in his continuing work in Jesus’ name.', 'honor', 'Jo Example'],
    ['Online gift via favorintl.org | Donor covered processing fees | Donor note: In memory of Avery Example', 'memorial', 'Avery Example'],
  ];
  for (const [text, kind, honoree] of cases) {
    it(text.slice(0, 50), () => assert.deepEqual(parseTribute(text), { kind, honoree }));
  }
  it('leaves out a comment that only mentions honor', () => {
    assert.equal(parseTribute('Thank You Father God for Your Glory to honor The Name of Yeshua'), null);
    assert.equal(parseTribute('HARDREJECT: Your bank requested that we do not honor this card'), null);
    assert.equal(parseTribute(''), null);
  });
});

describe('tribute fields on an Other gifts row', () => {
  it('keeps honor and memorial and drops anything else', () => {
    assert.deepEqual(cleanEdit({ tribute_kind: 'memorial', tribute_name: 'Pat Example', tribute_notify: 'Sam Example' }, '2026-10-15'), { tribute_kind: 'memorial', tribute_name: 'Pat Example', tribute_notify: 'Sam Example' });
    assert.deepEqual(cleanEdit({ tribute_kind: 'birthday' }, '2026-10-15'), {});
  });
  it('clearing the kind clears the name and who to notify', () => {
    assert.deepEqual(cleanEdit({ tribute_kind: null }, '2026-10-15'), { tribute_kind: null, tribute_name: null, tribute_notify: null });
  });
  it('a tribute needs a name before the batch can go', () => {
    const g = { status: 'draft', kind: 'phone', partner_id: '1', amount_cents: 100, gift_date: '2026-10-15', fund_id: '1', appeal_id: '1', soft_partner_id: null, no_soft: 1, tribute_kind: 'honor', tribute_name: '' };
    assert.ok(blockers(g).includes('Enter who the tribute is for.'));
    assert.ok(!blockers({ ...g, tribute_name: 'Pat Example' }).includes('Enter who the tribute is for.'));
  });
});
