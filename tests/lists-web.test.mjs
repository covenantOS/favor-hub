// The Lists pages in the web app (web/src/features/lists): the pure rules (criteria data, section counts, the address form of a spec, words and
// dates) and the route registration. The pages themselves are checked against the classic pages by the QA scripts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';

const S = await import('../web/src/features/lists/spec.ts');
const F = await import('../web/src/features/lists/fmt.ts');
const { WEB_ROUTES, webServes } = await import('../shared/web.ts');
const { normalizeSpec } = await import('../functions/_lib/lists/criteria.ts');

describe('the blank list', () => {
  it('has the same shape the server normalizes to', () => {
    for (const kind of ['partners', 'gifts']) {
      const b = S.blank(kind);
      assert.deepEqual(normalizeSpec(b), normalizeSpec(JSON.parse(JSON.stringify(b))));
      assert.equal(b.kind, kind);
    }
    assert.equal(S.blank('nonsense').kind, 'partners');
  });
  it('a saved list opens over the blank one, so a criterion added later has its default', () => {
    const s = S.fromSaved({ kind: 'gifts', gift: { funds: ['120'] }, partner: { lifetime: { min: 5 } } });
    assert.equal(s.kind, 'gifts');
    assert.deepEqual(s.gift.funds, ['120']);
    assert.equal(s.gift.soft, 'any');
    assert.deepEqual(s.partner.lifetime, { min: 5 });
    assert.equal(s.partner.deceased, 'exclude');
    assert.deepEqual(S.fromSaved(null), S.blank());
  });
  it('merge never changes what it was given', () => {
    const base = S.blank();
    const before = JSON.stringify(base);
    S.merge(base, { partner: { status: ['active'] } });
    assert.equal(JSON.stringify(base), before);
  });
});

describe('setting a value by its path', () => {
  it('replaces one value and leaves the original alone', () => {
    const a = S.blank();
    const b = S.setIn(a, 'partner.lifetime.min', 1000);
    assert.equal(S.getIn(b, 'partner.lifetime.min'), 1000);
    assert.equal(S.getIn(a, 'partner.lifetime.min'), undefined);
    assert.equal(S.getIn(b, 'gift.soft'), 'any');
  });
  it('steps into a giving period by its number', () => {
    const a = S.setIn(S.blank(), 'partner.giving', [{ from: '', to: '', min: null, max: null }]);
    const b = S.setIn(a, 'partner.giving.0.from', '2025-01-01');
    assert.equal(b.partner.giving[0].from, '2025-01-01');
    assert.equal(a.partner.giving[0].from, '');
    assert.ok(Array.isArray(b.partner.giving));
  });
  it('typed amounts and comma lists', () => {
    assert.equal(S.parseAmount('$1,200'), 1200);
    assert.equal(S.parseAmount(' 12.5 '), 12.5);
    assert.equal(S.parseAmount(''), null);
    assert.equal(S.parseAmount('lots'), null);
    assert.deepEqual(S.parseList('Tampa, Austin,, '), ['Tampa', 'Austin']);
    assert.deepEqual(S.parseList(''), []);
  });
});

describe('criteria counts', () => {
  it('a blank list counts nothing', () => {
    const c = S.sectionCounts(S.blank());
    assert.equal(c.total, 0);
    for (const k of S.SECTIONS) assert.equal(c[k], 0);
  });
  it('counts each section the way the classic page does', () => {
    let s = S.blank();
    s = S.setIn(s, 'partner.status', ['active', 'lybunt']);
    s = S.setIn(s, 'partner.major', 'yes');
    s = S.setIn(s, 'partner.deceased', 'include');
    s = S.setIn(s, 'partner.holders', ['1']);
    s = S.setIn(s, 'partner.states', ['FL', 'GA']);
    s = S.setIn(s, 'partner.lifetime', { min: 100 });
    s = S.setIn(s, 'partner.giving', [{ from: '2025-01-01', to: '', min: null, max: null }]);
    s = S.setIn(s, 'gift', { ...s.gift, from: '2025-01-01', min: 5, funds: ['1', '2'], soft: 'no' });
    s = S.setIn(s, 'partner.neverContacted', true);
    s = S.setIn(s, 'partner.contactBefore', '2025-06-01');
    const c = S.sectionCounts(s);
    assert.deepEqual([c.status, c.held, c.place, c.giving, c.gifts, c.records], [4, 1, 2, 2, 5, 2]);
    assert.equal(c.total, 16);
  });
  it('a range with only a zero minimum still counts', () => {
    assert.equal(S.sectionCounts(S.setIn(S.blank(), 'partner.gifts', { min: 0 })).giving, 1);
  });
});

describe('the address form of a spec', () => {
  it('round-trips, including non-Latin text', () => {
    const o = { kind: 'partners', partner: { cities: ['San José', '北京'] } };
    const s = S.encodeSpec(o);
    assert.match(s, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(S.decodeSpec(s), o);
  });
  it('reads what the classic page wrote', () => {
    const o = { kind: 'gifts', gift: { funds: ['1'] } };
    const classic = Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(S.encodeSpec(o), classic);
    assert.deepEqual(S.decodeSpec(classic), o);
  });
  it('junk is nothing', () => {
    assert.equal(S.decodeSpec('%%%'), null);
    assert.equal(S.decodeSpec('e30x'), null);
  });
  it('the count word is singular for one', () => {
    assert.equal(S.unitWord('partners', 1), 'partner');
    assert.equal(S.unitWord('partners', 2), 'partners');
    assert.equal(S.unitWord('gifts', 1), 'gift');
    assert.equal(S.unitWord('gifts', 0), 'gifts');
  });
});

describe('money and dates read as FavorUI writes them', () => {
  const now = new Date('2026-10-15T14:00:00Z');
  it('money drops cents only from whole numbers', () => {
    assert.equal(F.money(3050), '$3,050');
    assert.equal(F.money(1637.9), '$1,637.90');
    assert.equal(F.money(-5), '-$5');
    assert.equal(F.money(null), '');
    assert.equal(F.money(''), '');
    assert.equal(F.money(0), '$0');
  });
  it('a day carries its year only when it is not this year', () => {
    assert.equal(F.day('2026-10-14', now), 'Oct 14');
    assert.equal(F.day('2025-12-31', now), 'Dec 31, 2025');
    assert.equal(F.day('nope', now), '');
    assert.equal(F.day('2026-10-14T03:30:00Z', now), 'Oct 13');
  });
  it('when says Today and Yesterday in Eastern time', () => {
    assert.equal(F.when('2026-10-15T09:44:00Z', now), 'Today 5:44 AM');
    assert.equal(F.when('2026-10-14T20:15:00Z', now), 'Yesterday 4:15 PM');
    assert.equal(F.when('2026-10-11T16:00:00Z', now), 'Oct 11 12:00 PM');
    assert.equal(F.when('2026-10-15T04:05:00Z', now), 'Today 12:05 AM');
  });
  it('num groups thousands', () => assert.equal(F.num(6074), '6,074'));
});

describe('reports', () => {
  it('the ids read ahead are the ids the server has', async () => {
    const A = await import('../web/src/features/lists/api.ts');
    const { REPORTS } = await import('../functions/_lib/lists/reports.ts');
    assert.deepEqual([...A.REPORT_IDS].sort(), REPORTS.map((r) => r.id).sort());
  });
  it('the address names the report first and leaves out empty values', async () => {
    const A = await import('../web/src/features/lists/api.ts');
    assert.equal(A.reportPath('giving', { period: 'custom', from: '2026-01-01', by: '' }), '/api/lists/report?id=giving&period=custom&from=2026-01-01');
  });
});

describe('the routes', () => {
  it('are registered and own only their own paths', () => {
    for (const r of ['/lists/', '/lists/credit/', '/lists/reports/']) {
      assert.ok(WEB_ROUTES.includes(r), r);
      assert.ok(webServes(r, WEB_ROUTES), r);
    }
  });
  it('carry the nav ids the menu uses', () => {
    const nav = { '/lists/': 'lists', '/lists/credit/': 'list-credit', '/lists/reports/': 'list-reports' };
    for (const [route, id] of Object.entries(nav)) {
      const src = readFileSync(new URL('../web/src/routes' + route + 'index.tsx', import.meta.url), 'utf8');
      assert.match(src, new RegExp(`nav: '${id}'`));
    }
  });
});
