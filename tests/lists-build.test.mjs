// Builds the snapshot from the invented mirror, then runs real list specs against it: statuses, gifts, holders, tags, scope, tie-out,
// and the promise that nothing a person types ever lands in the SQL text.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { emptySpec, normalizeSpec, plan, summarize, windowsFor } from '../functions/_lib/lists/criteria.ts';
import { allRows, bindFor, countList, menus, pageOf, tieOut } from '../functions/_lib/lists/run.ts';
import { buildSnapshot, bulkInsert } from '../functions/_lib/lists/snapshot.ts';
import { AS_OF, ioOf, makeHub, makeMirror, qOf } from './support/lists-fixture.mjs';

let hub;
let q;
const ALL = { all: true, fids: [] };
const spec = (o) => normalizeSpec(o);
const n = async (o, scope = ALL) => (await countList(q, spec(o), AS_OF, scope)).n;

before(async () => {
  hub = makeHub();
  q = qOf(hub);
  const r = await buildSnapshot(ioOf(makeMirror(), hub), AS_OF);
  assert.equal(r.households, 9);
});

describe('snapshot', () => {
  it('stores households, gifts, holders and tags', async () => {
    assert.equal((await q('SELECT COUNT(*) n FROM lr_hh', []))[0].n, 9);
    assert.equal((await q('SELECT COUNT(*) n FROM lr_gift', []))[0].n, 11);
    assert.equal((await q("SELECT COUNT(*) n FROM lr_tag WHERE kind='solicit'", []))[0].n, 1);
  });

  it('keeps a solicit code that has ended out of the current codes', async () => {
    const t = await q("SELECT household_id FROM lr_tag WHERE kind='solicit' AND value='Do Not Mail'", []);
    assert.deepEqual(t.map((r) => r.household_id), ['103']);
  });

  it('puts a spouse who never gave under the household (event and last contact)', async () => {
    assert.equal((await q("SELECT household_id FROM lr_tag WHERE kind='event'", []))[0].household_id, '101');
    assert.equal((await q("SELECT last_contact FROM lr_hh WHERE household_id='101'", []))[0].last_contact, '2026-09-02');
  });

  it('leaves out an assignment that ended before the as-of day', async () => {
    assert.equal((await q("SELECT fundraiser_id FROM lr_holder WHERE household_id='104'", [])).length, 0);
  });

  it('writes in chunks under the size limit', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [String(i), 'x'.repeat(200)]);
    const stmts = bulkInsert('t', ['a', 'b'], rows);
    assert.ok(stmts.length > 2);
    for (const s of stmts) assert.ok(s.params[0].length < 400_000);
  });
});

describe('statuses and the KPI windows', () => {
  it('counts each status', async () => {
    assert.equal(await n({ partner: { status: ['active'] } }), 4);
    assert.equal(await n({ partner: { status: ['lybunt'] } }), 3);
    assert.equal(await n({ partner: { status: ['lapsed'] } }), 1);
    assert.equal(await n({ partner: { status: ['lybunt', 'lapsed'] } }), 4);
  });

  it('includes deceased households only when asked', async () => {
    assert.equal(await n({ partner: { status: ['lapsed'], deceased: 'include' } }), 2);
    assert.equal(await n({ partner: { deceased: 'only' } }), 1);
  });

  it('uses today for the windows', async () => {
    const later = windowsFor('2027-06-01');
    assert.equal(later.t12, '2026-06-01');
    const c = await countList(q, spec({ partner: { status: ['active'] } }), '2027-06-01', ALL);
    assert.equal(c.n, 3);
  });

  it('flags major, came in through, holder and place', async () => {
    assert.equal(await n({ partner: { major: 'yes' } }), 1);
    assert.equal(await n({ partner: { cameIn: 'acquisition' } }), 3);
    assert.equal(await n({ partner: { states: ['FL'] } }), 2);
    assert.equal(await n({ partner: { zips: ['3360'] } }), 2);
    assert.equal(await n({ partner: { holders: ['5001'] } }), 2);
    assert.equal(await n({ partner: { holder: 'none' } }), 5);
  });

  it('filters by team through the staff list', async () => {
    assert.equal(await n({ partner: { teams: ['partner_care'] } }), 2);
  });

  it('ranges and periods', async () => {
    assert.equal(await n({ partner: { lifetime: { min: 100 } } }), 4);
    assert.equal(await n({ partner: { giving: [{ from: '2026-01-01', to: '2026-12-31', min: 1 }] } }), 4);
    assert.equal(await n({ partner: { giving: [{ from: '2025-01-01', to: '2025-12-31', min: 1 }, { from: '2026-01-01', to: '2026-12-31', max: 0 }] } }), 2);
  });

  it('solicit codes, constituent codes, attributes, relationships, events', async () => {
    assert.equal(await n({ partner: { solicitHas: ['Do Not Mail'] } }), 1);
    assert.equal(await n({ partner: { solicitNot: ['Do Not Mail'] } }), 7);
    assert.equal(await n({ partner: { codesHas: ['Church'] } }), 1);
    assert.equal(await n({ partner: { attrsHas: ['Online Express Email Signup'] } }), 1);
    assert.equal(await n({ partner: { relsHas: ['Pastor'] } }), 1);
    assert.equal(await n({ partner: { eventsHas: ['Test Dinner'] } }), 1);
  });

  it('last contact', async () => {
    assert.equal(await n({ partner: { neverContacted: true } }), 7);
    assert.equal(await n({ partner: { contactBefore: '2026-10-01' } }), 8);
  });
});

describe('gift lists', () => {
  it('lists the gifts credited to the partners that pass', async () => {
    assert.equal(await n({ kind: 'gifts', partner: { deceased: 'include' } }), 11);
    assert.equal(await n({ kind: 'gifts', gift: { kinds: ['recurring'] } }), 2);
    assert.equal(await n({ kind: 'gifts', gift: { from: '2026-01-01' } }), 6);
    assert.equal(await n({ kind: 'gifts', gift: { appealCats: ['Acquisition'] } }), 3);
    assert.equal(await n({ kind: 'gifts', gift: { funds: ['80'] } }), 2);
    assert.equal(await n({ kind: 'gifts', gift: { creditedTo: ['5002'] } }), 1);
    assert.equal(await n({ kind: 'gifts', gift: { soft: 'yes' } }), 1);
    assert.equal(await n({ kind: 'gifts', partner: { status: ['lybunt'] }, gift: { min: 100 } }), 2);
  });

  it('a partner list can ask for partners who have a matching gift', async () => {
    assert.equal(await n({ kind: 'partners', gift: { funds: ['80'] } }), 2);
  });

  it('totals the credited dollars', async () => {
    const c = await countList(q, spec({ kind: 'gifts', gift: { kinds: ['recurring'] } }), AS_OF, ALL);
    assert.equal(c.total, 50);
  });

  it('a page and an export hold the same rows', async () => {
    const s = spec({ kind: 'gifts', partner: { deceased: 'include' }, columns: ['gift_id', 'partner', 'credited'], sort: { key: 'gift_id', dir: 'asc' } });
    const page = await pageOf(q, s, AS_OF, ALL, 1, 5);
    const all = await allRows(q, s, AS_OF, ALL);
    assert.equal(page.rows.length, 5);
    assert.deepEqual(page.rows.map((r) => r.gift_id), all.rows.slice(0, 5).map((r) => r.gift_id));
    assert.equal(all.rows.length, 11);
  });
});

describe('who sees which partners', () => {
  it('a scoped person sees only partners their fundraisers hold', async () => {
    assert.equal(await n({}, { all: false, fids: ['5002'] }), 2);
    assert.equal(await n({}, { all: false, fids: ['5001'] }), 2);
    assert.equal(await n({}, { all: false, fids: ['5001', '5002'] }), 3);
  });

  it('a person with no fundraisers sees nothing, and a filter cannot widen the scope', async () => {
    assert.equal(await n({}, { all: false, fids: [] }), 0);
    assert.equal(await n({ partner: { holder: 'none' } }, { all: false, fids: ['5002'] }), 0);
    assert.equal(await n({ kind: 'gifts' }, { all: false, fids: ['5002'] }), 4);
  });
});

describe('tie-out', () => {
  it('ties a status-only list to the dashboard and says so when it does not', async () => {
    const kpi = { active: 4, lybunt: 3, lapsed: 1 };
    assert.equal((await tieOut(q, spec({ partner: { status: ['active'] } }), AS_OF, kpi)).status, 'match');
    assert.equal((await tieOut(q, spec({ partner: { status: ['active'] } }), AS_OF, { ...kpi, active: 9 })).status, 'differs');
    assert.equal((await tieOut(q, spec({ partner: { status: ['lapsed'] } }), AS_OF, null)).status, 'unavailable');
    assert.equal((await tieOut(q, spec({ partner: { status: ['lybunt'] } }), AS_OF, kpi)).status, 'match');
  });

  it('has no tie-out once anything else narrows the list', async () => {
    const kpi = { active: 4, lybunt: 3, lapsed: 1 };
    assert.equal(await tieOut(q, spec({ partner: { status: ['lybunt'], states: ['TX'] } }), AS_OF, kpi), null);
    assert.equal(await tieOut(q, spec({ kind: 'gifts', partner: { status: ['lybunt'] } }), AS_OF, kpi), null);
  });
});

describe('the compiled SQL', () => {
  it('never contains a value a person typed', () => {
    const evil = "x'); DROP TABLE lr_hh; --";
    const s = normalizeSpec({ partner: { cities: [evil], zips: [evil], states: [evil], solicitHas: [evil], codesNot: [evil], attrsHas: [evil], relsHas: [evil], eventsHas: [evil], firstCats: [evil], holderTypes: [evil], teams: [evil] }, gift: { appealCats: [evil], methods: [evil], fundCats: [evil], funds: [evil], appeals: [evil] }, columns: [evil, 'partner'], sort: { key: evil, dir: 'asc' } });
    const p = plan(s, AS_OF, ALL, { limit: 10, offset: 0 });
    for (const sql of [p.countSql, p.listSql]) {
      assert.ok(!sql.includes('DROP'));
      assert.ok(!sql.includes("x')"));
    }
  });

  it('turns away malformed input instead of guessing', () => {
    const s = normalizeSpec({ kind: 'nonsense', partner: { status: ['active', 'bogus'], lifetime: { min: 'abc', max: '5' }, giving: [{ from: 'yesterday' }], contactBefore: '2026-13-45', states: ['Florida', 'fl'] } });
    assert.equal(s.kind, 'partners');
    assert.deepEqual(s.partner.status, ['active']);
    assert.equal(s.partner.lifetime.min, null);
    assert.equal(s.partner.lifetime.max, 5);
    assert.equal(s.partner.giving.length, 0);
    assert.equal(s.partner.contactBefore, '');
    assert.deepEqual(s.partner.states, ['FL']);
  });

  it('binds exactly the parameters a statement uses', () => {
    const p = plan(spec({ partner: { giving: [{ from: '2026-01-01', min: 1 }] } }), AS_OF, ALL, { limit: 10, offset: 0 });
    assert.ok(bindFor(p.countSql, p.params).length <= p.params.length);
  });

  it('describes a list in short labels', () => {
    assert.deepEqual(summarize(spec({ partner: { status: ['lybunt', 'lapsed'], cameIn: 'acquisition', states: ['FL'] } })), ['LYBUNT or Lapsed', 'Came in through acquisition', 'State: FL']);
  });

  it('an empty spec is every living partner', async () => {
    assert.equal(await n({}), 8);
    assert.equal(JSON.stringify(emptySpec('partners').partner.status), '[]');
  });
});

describe('menus', () => {
  it('lists what the builder offers', async () => {
    const m = await menus(q);
    assert.deepEqual(m.states, ['CO', 'FL', 'GA', 'ID', 'NV', 'TX']);
    assert.equal(m.funds.length, 2);
    assert.ok(m.holders.some((h) => h.name === 'Rita Director' && h.team === 'rdd'));
    assert.deepEqual(m.solicit, ['Do Not Mail']);
  });
});

describe('mail house and contact columns', () => {
  it('mail-ready leaves out Do Not Mail and no valid address, and says how many', async () => {
    const { mailLeftOut } = await import('../functions/_lib/lists/run.ts');
    assert.equal(await n({ partner: { mailReady: true } }), 6);
    assert.equal(await mailLeftOut(q, spec({ partner: { mailReady: true } }), AS_OF, ALL), 2);
    assert.equal(await mailLeftOut(q, spec({}), AS_OF, ALL), 0);
  });

  it('fills addressee, salutation and address from the mirror, never from the snapshot', async () => {
    const mirror = qOf(makeMirror());
    const s = spec({ partner: { mailReady: true }, columns: ['addressee', 'salutation', 'address', 'city', 'state', 'zip'] });
    const page = await pageOf(q, s, AS_OF, ALL, 1, 50, { mirror, contacts: false });
    const alice = page.rows.find((r) => r._hid === '101');
    assert.equal(alice.addressee, 'Alice Tester');
    assert.equal(alice.salutation, 'Dear Alice');
    assert.equal(alice.address, '101 Test Street');
    assert.equal(alice.zip, '33601');
    assert.ok(!page.rows.some((r) => r._hid === '103' || r._hid === '105'));
    const cols = (await q("SELECT sql FROM sqlite_master WHERE name='lr_hh'", []))[0].sql;
    assert.ok(!/address_lines|email|phone/.test(cols));
  });

  it('email and phone need contact access, skip do-not-email and do-not-call addresses', async () => {
    const mirror = qOf(makeMirror());
    const s = spec({ columns: ['partner', 'email', 'phone'] });
    const denied = await pageOf(q, s, AS_OF, ALL, 1, 50, { mirror, contacts: false });
    assert.deepEqual(denied.columns.map((c) => c.key), ['partner']);
    const ok = await pageOf(q, s, AS_OF, ALL, 1, 50, { mirror, contacts: true });
    assert.deepEqual(ok.columns.map((c) => c.key), ['partner', 'email', 'phone']);
    assert.equal(ok.rows.find((r) => r._hid === '101').email, 'alice@example.test');
    assert.equal(ok.rows.find((r) => r._hid === '101').phone, '555-0101');
    assert.equal(ok.rows.find((r) => r._hid === '103').email, undefined);
  });

  it('contact access defaults to admins, Support and Partner Care, and follows the setting', async () => {
    const { contactAccess } = await import('../functions/_lib/lists/service.ts');
    const { d1Of } = await import('./support/lists-fixture.mjs');
    const h = makeHub();
    h.exec("CREATE TABLE act_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); INSERT INTO act_staff (email, name, team, work_center) VALUES ('sue@favorintl.org', 'Sue Support', 'support', 1)");
    const env = { DB: d1Of(h) };
    assert.equal(await contactAccess(env, 'x@favorintl.org', true), true);
    assert.equal(await contactAccess(env, 'sue@favorintl.org', false), true);
    assert.equal(await contactAccess(env, 'rita@favorintl.org', false), false);
    h.exec("INSERT INTO act_settings VALUES ('lists:contacts', 'rita@favorintl.org', 'x')");
    assert.equal(await contactAccess(env, 'rita@favorintl.org', false), true);
    assert.equal(await contactAccess(env, 'sue@favorintl.org', false), false);
  });
});
