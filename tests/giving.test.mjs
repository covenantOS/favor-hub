// Run with: npm test
//
// Partner giving (shared/giving.ts): the KPI dashboard's rule for one household, the words staff see, and the copy of the term meanings
// in public/js/favor-ui.js. Made-up gifts only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, before } from 'node:test';
import './support/resolve-ts.mjs';

let G;
before(async () => {
  G = await import('../shared/giving.ts');
});

const gift = (id, amount, date, giver, soft = null, type = 'Donation') => ({ id, amount, date, type, giver, soft: soft ? JSON.stringify(soft) : null });
const sc = (cid, value) => (value === undefined ? { constituent_id: cid } : { constituent_id: cid, amount: { value } });
const names = new Map([['900', { name: 'National Christian Foundation', kind: 'daf' }], ['901', { name: 'Hope Family Foundation', kind: 'foundation' }]]);

describe('the credit rule', () => {
  it('a soft-credited gift counts for the partner it names and never for the DAF', () => {
    const rows = [gift('a', 1000, '2026-10-13', '900', [sc('1', 1000)])];
    const lowell = G.givingOf(rows, new Set(['1']), names, '2026-10-14');
    assert.equal(lowell.total, 1000);
    assert.equal(lowell.count, 1);
    assert.equal(lowell.through[0].name, 'National Christian Foundation');
    const daf = G.givingOf(rows, new Set(['900']), names, '2026-10-14');
    assert.equal(daf.total, 0);
    assert.equal(daf.passedOn.count, 1);
    assert.equal(G.lifetimeLine(daf), 'None of its own (it passes gifts on for others)');
  });

  it('a soft entry with no amount gives the full gift; an entry of 0 gives nothing', () => {
    assert.equal(G.creditTo(gift('a', 500, '2026-01-01', '900', [sc('1')]), new Set(['1'])), 500);
    assert.equal(G.creditTo(gift('a', 500, '2026-01-01', '900', [sc('1', 0)]), new Set(['1'])), 0);
  });

  it('a household never gets more than the gift, and two spouses on one gift count once', () => {
    const g = gift('a', 100, '2026-01-01', '900', [sc('1', 100), sc('2', 100)]);
    assert.equal(G.creditTo(g, new Set(['1', '2'])), 100);
    const out = G.givingOf([g, g], new Set(['1', '2']), names, '2026-10-14');
    assert.equal(out.count, 1, 'the same gift read twice counts once');
  });

  it('a recurring gift schedule is not a gift; its payments are', () => {
    const rows = [gift('s', 50, '2025-01-01', '1', null, 'RecurringGift'), gift('p', 50, '2025-02-01', '1', null, 'RecurringGiftPayment')];
    assert.equal(G.givingOf(rows, new Set(['1']), names, '2026-10-14').count, 1);
  });

  it('active, LYBUNT and lapsed follow the KPI dashboard windows', () => {
    assert.equal(G.statusOf('2026-01-01', '2026-10-14'), 'active');
    assert.equal(G.statusOf('2025-10-14', '2026-10-14'), 'lybunt', 'exactly 12 months ago is no longer active');
    assert.equal(G.statusOf('2024-10-15', '2026-10-14'), 'lybunt');
    assert.equal(G.statusOf('2024-10-14', '2026-10-14'), 'lapsed');
    assert.equal(G.statusOf(null, '2026-10-14'), 'none');
  });

  it('a major partner has one credited gift of $1,000 or more', () => {
    const out = G.givingOf([gift('a', 1000, '2020-01-01', '900', [sc('1', 1000)])], new Set(['1']), names, '2026-10-14');
    assert.equal(out.major, true);
    assert.equal(G.givingOf([gift('a', 999.99, '2020-01-01', '1')], new Set(['1']), names, '2026-10-14').major, false);
  });
});

describe('the words', () => {
  it('says where the giving came from', () => {
    const all = G.givingOf([gift('a', 1000, '2026-10-13', '900', [sc('1', 1000)])], new Set(['1']), names, '2026-10-14');
    assert.equal(G.lifetimeLine(all), '$1,000 in 1 gift');
    assert.equal(G.sourceLine(all), 'All through National Christian Foundation (DAF)');
    assert.equal(G.lastGiftLine(all), '$1,000 on Oct 13, 2026 through National Christian Foundation');
    const mixed = G.givingOf([gift('a', 1000, '2026-10-13', '900', [sc('1', 1000)]), gift('b', 250.5, '2026-03-01', '1'), gift('c', 300, '2026-04-01', '901', [sc('1', 300)])], new Set(['1']), names, '2026-10-14');
    assert.equal(G.sourceLine(mixed), '$251 given directly, $1,000 through National Christian Foundation (DAF), $300 through Hope Family Foundation');
    assert.equal(G.lifetimeLine(G.givingOf([], new Set(['1']), names, '2026-10-14')), 'No gifts yet');
  });

  it('money keeps cents only when there are some; totals are whole dollars', () => {
    assert.equal(G.money(1000), '$1,000');
    assert.equal(G.money(52.5), '$52.50');
    assert.equal(G.whole(76500.4), '$76,500');
  });

  it('the term meanings say partner, use no em dash, and match the copy in favor-ui.js', () => {
    for (const [k, t] of Object.entries(G.TERMS)) {
      assert.ok(!/—/.test(t.tip + t.label), `${k} has an em dash`);
      assert.ok(!/\bdonors?\b(?!-advised)/i.test(t.tip), `${k} says donor`);
    }
    const w = { addEventListener() {} };
    vm.runInNewContext(readFileSync(new URL('../public/js/favor-ui.js', import.meta.url), 'utf8'), { window: w, document: { addEventListener() {} }, fetch() {} });
    assert.deepEqual(JSON.parse(JSON.stringify(w.FavorUI.TERMS)), JSON.parse(JSON.stringify(G.TERMS)), 'run data-pass-tools/add_terms.py logic: copy TERMS into favor-ui.js');
    assert.match(w.FavorUI.term('soft'), /data-term="Someone else/);
  });
});

describe('household members', () => {
  it('each member keeps their own figure and the household counts a shared gift once', async () => {
    const P = await import('../functions/_lib/gifts/partner-giving.ts');
    const rows = [
      gift('a', 100, '2026-01-01', '900', [sc('1', 100), sc('2', 100)]),
      gift('b', 40, '2025-05-01', '1'),
      gift('c', 60, '2025-06-01', '2'),
      gift('d', 25, '2025-07-01', '1', [sc('900', 25)]),
    ];
    const hh = G.givingOf(rows, new Set(['1', '2']), names, '2026-10-14');
    const one = G.givingOf(rows, new Set(['1']), names, '2026-10-14');
    const two = G.givingOf(rows, new Set(['2']), names, '2026-10-14');
    assert.equal(hh.total, 200);
    assert.equal(one.total, 140);
    assert.equal(two.total, 160);
    assert.equal(one.total + two.total - hh.total, 100, 'the gift credited to both counts once in the household');
    assert.equal(hh.passedOn.count, 1, 'a gift passed on to another partner never counts for the household');
    assert.ok(typeof P.partnerGiving === 'function');
  });

  it('partnerGiving adds byMember for a couple and leaves it off for a single record', async () => {
    const P = await import('../functions/_lib/gifts/partner-giving.ts');
    const gifts = [
      { id: 'a', amount: 100, date: '2026-01-01', type: 'Donation', giver: '900', soft: JSON.stringify([sc('1', 100), sc('2', 100)]) },
      { id: 'b', amount: 40, date: '2025-05-01', type: 'Donation', giver: '1', soft: null },
    ];
    const people = { 1: { id: '1', sid: '2', name: 'Ann Test' }, 2: { id: '2', sid: '1', name: 'Bo Test' }, 3: { id: '3', sid: null, name: 'Cy Test' }, 900: { id: '900', sid: null, name: 'NCF' } };
    const q = async (sql, params = []) => {
      if (/FROM constituents WHERE id = \?1/.test(sql) && /spouse_id AS sid/.test(sql) && !/IN/.test(sql)) return [people[params[0]]].filter(Boolean);
      if (/FROM constituents WHERE id IN/.test(sql) && /OR spouse_id IN/.test(sql)) return Object.values(people).filter((p) => params.includes(p.id) || params.includes(p.sid));
      if (/FROM gifts/.test(sql)) return gifts.map((g) => ({ ...g, soft: g.soft }));
      return [];
    };
    const two = await P.partnerGiving(q, '1', '2026-10-14');
    assert.equal(two.total, 140);
    assert.deepEqual(two.byMember.map((b) => [b.id, b.giving.total]), [['1', 140], ['2', 100]]);
    const solo = await P.partnerGiving(q, '3', '2026-10-14');
    assert.equal(solo.byMember, undefined);
  });
});
