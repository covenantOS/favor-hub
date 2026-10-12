// Run with: npm test
//
// What a gift is for, from the record: a check with no slip and no note matches a partner whose director logged a call saying a gift
// for the Chad wells was coming. The fund and the appeal are suggested with the reason line; a person still confirms the row.
// Rules only, no model. Every name, id and amount is made up; the tables follow the mirror's column layout.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const code = await import('../functions/_lib/gifts/code.ts');
const match = await import('../functions/_lib/gifts/match.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');

const FUNDS = [
  { id: '79', code: 'WNM', name: 'Where Needed Most' },
  { id: '171', code: 'CWM', name: '2025/2026 Chad Wells Match' },
  { id: '198', code: 'WEL', name: 'Wells' },
  { id: '126', code: 'CHD', name: 'Nation of Chad' },
  { id: '177', code: 'CRD', name: 'Chad Radio' },
  { id: '133', code: 'SSW', name: 'South Sudan Wells' },
  { id: '102', code: 'EDU', name: 'Education' },
];
const APPEALS = [
  { id: '2243', code: 'C200-DRPC', name: 'Gift due to personal contact, Dana Rivers', category: 'Director - Dana Rivers' },
  { id: '2085', code: 'C200-PCPC-DANA', name: 'Gift due to Partner Care personal contact, Dana Rivers', category: 'Personal Contact' },
  { id: '2230', code: 'E25A-BAWB', name: 'Event, October 2025, Turning Nations Webinar', category: 'Event' },
  { id: '2185', code: 'W200-UNID', name: 'White Mail, Unidentified Motivation', category: 'White Mail' },
  { id: '2186', code: 'W200-UNMG', name: 'White Mail, Unidentified Motivation, Major Gift', category: 'White Mail' },
  { id: '2188', code: 'W200-CH', name: 'White Mail, Unidentified Motivation, Church Gift', category: 'White Mail' },
];
const base = { slipAppeal: null, slipDesignation: null, letterAppeal: null, letterPurpose: null, memo: null, lastGift: null, expected: [], funds: FUNDS, appeals: APPEALS, partnerName: 'Mara and Ben Okoro', payer: 'Mara Okoro', amountCents: 500000, recentGifts: 1 };

describe('reading a note for a gift that is coming', () => {
  it('finds the sentence that says so', () => {
    assert.equal(code.comingGift('Good call with Mara. She said a gift for the Chad wells is on its way. Praying for her son.'), 'She said a gift for the Chad wells is on its way');
    assert.equal(code.comingGift('Ben plans to send $5,000 for wells next month'), 'Ben plans to send $5,000 for wells next month');
    assert.equal(code.comingGift('They pledged toward the radio tower.'), 'They pledged toward the radio tower');
  });
  it('leaves a note about a past gift or no gift alone', () => {
    assert.equal(code.comingGift('Thanked her for the gift. Talked about her garden.'), null);
    assert.equal(code.comingGift('Left a voicemail.'), null);
    assert.equal(code.comingGift(''), null);
  });
});

describe('the fund a note describes', () => {
  it('reads "the Chad wells" as the Chad wells fund, not Wells or Nation of Chad', () => {
    assert.equal(code.fundByWords(FUNDS, 'a gift for the Chad wells is on its way').id, '171');
    assert.equal(code.fundByWords(FUNDS, 'a check for wells in South Sudan').id, '133');
    assert.equal(code.fundByWords(FUNDS, 'a gift for a well').id, '198');
  });
  it('names no fund when the words fit none', () => {
    assert.equal(code.fundByWords(FUNDS, 'a gift is coming next week'), null);
    assert.equal(code.fundByWords(FUNDS, 'Chad'), null);
  });
});

describe('the appeal a note points to', () => {
  it("is the caller's personal contact appeal, never the Partner Care one of the same name", () => {
    assert.equal(code.personalContactAppeal(APPEALS, 'Dana Rivers').id, '2243');
    assert.equal(code.personalContactAppeal(APPEALS, 'Someone Else'), null);
    assert.equal(code.personalContactAppeal(APPEALS, ''), null);
  });
  it('is an appeal whose title is written in the note', () => {
    assert.equal(code.appealNamedIn(APPEALS, 'She watched the Turning Nations Webinar and will send a gift').id, '2230');
    assert.equal(code.appealNamedIn(APPEALS, 'a church gift is coming'), null);
  });
});

describe('a check with no slip and no note, after a logged call', () => {
  const call = { id: 'a1', kind: 'action', date: '2026-09-28', amountCents: null, purpose: null, category: 'Phone call', who: 'Dana Rivers', text: 'Call with Mara. She said a gift for the Chad wells is on its way.', said: 'She said a gift for the Chad wells is on its way' };
  it('suggests the fund and the appeal with the reason line, and the appeal stays White Mail until a person decides', () => {
    const c = code.proposeCoding({ ...base, expected: [call] });
    assert.equal(c.fund.id, '171');
    assert.equal(c.fundSource, 'expected');
    assert.equal(c.fundReason, 'Sep 28 call: She said a gift for the Chad wells is on its way');
    assert.equal(c.appealSource, 'white_mail');
    assert.equal(c.needsCoding, true);
    assert.deepEqual(c.suggestions.map((x) => [x.code, x.source, x.reason]), [['C200-DRPC', 'expected', 'Sep 28 call: She said a gift for the Chad wells is on its way']]);
  });
  it('a reply slip still decides over the call', () => {
    const c = code.proposeCoding({ ...base, appeals: [...APPEALS, { id: '9', code: 'L26B-AD', name: 'Direct Mail, November 2026 Appeal', category: 'Direct Mail Appeal' }], slipAppeal: 'L26B-AD', slipDesignation: 'Education', expected: [call] });
    assert.equal(c.appealSource, 'slip');
    assert.equal(c.fund.id, '102');
    assert.equal(c.needsCoding, false);
  });
  it("an opportunity's purpose names the fund", () => {
    const c = code.proposeCoding({ ...base, expected: [{ id: 'o1', kind: 'opportunity', date: '2026-10-10', amountCents: 500000, purpose: 'South Sudan wells', text: 'Okoro 2026 ask' }] });
    assert.equal(c.fund.id, '133');
    assert.match(c.fundReason, /Oct 10: an expected gift of \$5,000\.00 was logged for South Sudan wells/);
  });
});

describe('expectedFor reads the mirror', () => {
  let db;
  const q = async (sql, params = []) => {
    readOnly(sql);
    return db.prepare(sql).all(...params);
  };
  before(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE opportunities (id TEXT, constituent_record_id TEXT, name TEXT, purpose TEXT, status TEXT, expected_amount REAL, expected_date TEXT, inactive INTEGER);
      CREATE TABLE actions (id TEXT, constituent_record_id TEXT, action_date_due TEXT, action_completed_date TEXT, date_added TEXT, action_category TEXT, action_summary TEXT, action_description TEXT, raw_json TEXT);
      CREATE TABLE fundraisers (id TEXT, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
      INSERT INTO fundraisers VALUES ('501', 'Dana', 'Rivers');
    `);
    const act = (id, cid, d, cat, s, t) => db.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?)').run(id, cid, d + 'T00:00:00', d + 'T00:00:00', d + 'T10:00:00', cat, s, t, JSON.stringify({ fundraisers: ['501'] }));
    act('a1', '900', '2026-09-28', 'Phone call', 'Call with Mara', 'She said a gift for the Chad wells is on its way. Praying for her son.');
    act('a2', '900', '2026-10-02', 'Email', 'Sent the newsletter', 'Shared the October update with photos.');
    act('a3', '900', '2026-05-01', 'Phone call', 'Old call', 'A gift is coming soon for the radio.');
    act('a4', '901', '2026-10-01', 'Phone call', 'Other partner', 'A check is in the mail for Education.');
  });
  it('returns the call that said a gift was coming, with who made it, and nothing older than two months or from another partner', async () => {
    const out = await match.expectedFor(q, '900', '2026-10-12', 500000);
    assert.deepEqual(out.map((e) => [e.id, e.kind, e.date, e.category, e.who, e.said]), [['a1', 'action', '2026-09-28', 'Phone call', 'Dana Rivers', 'She said a gift for the Chad wells is on its way']]);
    const c = code.proposeCoding({ ...base, expected: out });
    assert.equal(c.fund.name, '2025/2026 Chad Wells Match');
    assert.equal(c.suggestions[0].code, 'C200-DRPC');
  });
});

describe('the amount a note states', () => {
  it('reads dollars, thousands and millions', () => {
    assert.equal(code.amountIn('two checks totalling $50k for the wells'), 5000000);
    assert.equal(code.amountIn('plans to send $5,000 next month'), 500000);
    assert.equal(code.amountIn('a gift of $1.5 million'), 150000000);
    assert.equal(code.amountIn('a gift is coming'), null);
  });
  it('a note fits one of two checks toward the amount it said, and not a gift far over it', () => {
    const e = { id: 'a', kind: 'action', date: '2026-08-25', amountCents: 5000000, purpose: null, text: '' };
    assert.equal(code.expectedFits(e, 2500000, '2026-10-12'), true);
    assert.equal(code.expectedFits(e, 9000000, '2026-10-12'), false);
    assert.equal(code.expectedFits(e, 2500000, '2026-11-30'), false);
  });
});
