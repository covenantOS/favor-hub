// Run with: npm test
//
// The full new-partner form: names with title, middle and suffix, a household whose second person has their own phone and email, an
// organization with a type code and a main contact joined with is_organization_contact, and links to partners already in Blackbaud.
// The calls are checked against the stand-in (the same checks as the upkeep route's key lists), never a real record. Made-up people only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const ap = await import('../functions/_lib/work/addpartner.ts');
const SCHEMA = readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8');

function fakeD1(db) {
  const stmt = (sql, args = []) => ({ args, sql, bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }) });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) db.prepare(s.sql).run(...(s.args || [])); return []; } };
}
function world() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const staff = db.prepare("INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, active, updated_at) VALUES (?,?,?,?,1,1,?,1,'x')");
  staff.run('jo@favorintl.org', 'Jo Dir', 'rdd', '10', 'RDD Action');
  staff.run('ce@favorintl.org', 'Ce Dir', 'church', '11', 'CED Action');
  const repo = { async send(calls) { return { results: calls.map((c) => ({ ok: true, status: 200, body: c.method === 'POST' ? { id: '500' } : { value: [], lookup_id: '777' } })), callsToday: 10 }; }, async partnersByIds() { return []; } };
  return { ctx: { env: { DB: fakeD1(db) }, repo, actor: 'Sam Support', email: 'sam@favorintl.org', scope: { role: 'support', all: false, fids: new Set(['10', '11']), fid: null, team: 'Support', email: 'sam@favorintl.org', name: 'Sam' } } };
}
const person = (o = {}) => ({ kind: 'individual', first: 'Tom', last: 'Bradford', street: '1 Elm St', city: 'Clearwater', state: 'FL', zip: '33755', code: 'Prospect', holder: '10', none_same: true, ...o });
const stand = (ctx, b) => ap.addPartner(ctx, b, { standin: true });
const paths = (out) => out.calls.map((c) => `${c.method} ${c.path}`);

describe('names and reach', () => {
  it('title, middle and suffix go on the person, the phone type is the one picked', async () => {
    const { ctx } = world();
    const out = await stand(ctx, person({ title: 'dr.', middle: 'Q', suffix: ', jr.', phone: '(727) 555-0119', phone_type: 'home phone' }));
    const b = out.calls[0].body;
    assert.deepEqual([b.title, b.middle, b.suffix], ['Dr.', 'Q', ', Jr.']);
    assert.equal(b.phone.type, 'Home Phone');
    assert.equal(b.address.type, 'Home');
  });
  it('a title that is not in the table is refused in plain words', async () => {
    const { ctx } = world();
    await assert.rejects(() => stand(ctx, person({ title: 'Lord High' })), (e) => e.status === 400 && /title from the list/.test(e.message));
    await assert.rejects(() => stand(ctx, person({ phone: '(727) 555-0119', phone_type: 'Fax' })), (e) => e.status === 400 && /phone type/.test(e.message));
  });
  it('a household gives both people the address and the second person an optional phone and email of their own', async () => {
    const { ctx } = world();
    const out = await stand(ctx, person({ kind: 'household', spouse_first: 'Ellen', spouse_last: 'Bradford', spouse_title: 'Mrs.', spouse_phone: '(727) 555-0120', spouse_email: 'EB@example.com', phone: '(727) 555-0119', email: 'tb@example.com' }));
    const [one, two] = out.calls;
    assert.equal(one.body.phone.number, '(727) 555-0119');
    assert.equal(two.body.phone.number, '(727) 555-0120');
    assert.equal(two.body.email.address, 'eb@example.com');
    assert.equal(two.body.title, 'Mrs.');
    assert.deepEqual(one.body.address, two.body.address);
    const rel = out.calls.find((c) => c.path.endsWith('/relationships'));
    assert.deepEqual(rel.body, { constituent_id: out.cid, relation_id: out.cid2, type: 'Spouse', reciprocal_type: 'Spouse', is_spouse: true });
  });
});

describe('an organization with a type and a main contact', () => {
  it('makes the organization, the contact as a second record, both codes, and joins them with is_organization_contact', async () => {
    const { ctx } = world();
    const out = await stand(ctx, { kind: 'organization', org: 'ZZ Test Church', code: 'Prospect', type_code: 'church', holder: '11', street: '5 Palm Way', city: 'Tampa', state: 'FL', zip: '33606', none_same: true, phone: '(813) 555-0100', contact: { first: 'Paul', last: 'Mendez', position: 'Pastor', role: 'Pastor', phone: '(813) 555-0101', email: 'pm@example.com' } });
    assert.equal(out.cid3 !== null, true);
    assert.deepEqual(paths(out), [
      'POST /constituent/v1/constituents',
      'POST /constituent/v1/constituents',
      'POST /constituent/v1/constituentcodes',
      'POST /constituent/v1/constituentcodes',
      'POST /constituent/v1/relationships',
      'POST /fundraising/v1/fundraisers/assignments',
      `GET /constituent/v1/constituents/${out.cid}`,
    ]);
    assert.equal(out.calls[0].body.type, 'Organization');
    assert.equal(out.calls[1].body.first, 'Paul');
    assert.equal(out.calls[1].body.phone.type, 'Cell Phone');
    assert.equal(out.calls[1].body.address, undefined);
    assert.deepEqual(out.calls[2].body, { constituent_id: out.cid, description: 'Prospect' });
    assert.deepEqual(out.calls[3].body, { constituent_id: out.cid, description: 'Church' });
    assert.deepEqual(out.calls[4].body, { constituent_id: out.cid, relation_id: out.cid3, type: 'Pastor', reciprocal_type: 'Church', is_organization_contact: true, position: 'Pastor' });
    assert.equal(out.calls[5].body.type, 'Church Engagement Director');
  });
  it('refuses Prospect or Partner as the type, a contact with no last name, and a role it cannot file', async () => {
    const { ctx } = world();
    const org = { kind: 'organization', org: 'ZZ Test Church', code: 'Prospect', none_same: true };
    await assert.rejects(() => stand(ctx, { ...org, type_code: 'Partner' }), (e) => e.status === 400 && /status, not the type/.test(e.message));
    await assert.rejects(() => stand(ctx, { ...org, contact: { first: 'Paul', last: '' } }), (e) => e.status === 400);
    await assert.rejects(() => stand(ctx, { ...org, contact: { first: 'Paul', last: 'Mendez', role: 'Cousin' } }), (e) => e.status === 400 && /to the organization/.test(e.message));
  });
});

describe('links to partners already in Blackbaud', () => {
  it('each link is one relationship with the reciprocal Blackbaud files on the other side', async () => {
    const { ctx } = world();
    const out = await stand(ctx, person({ relations: [{ id: '4242', type: 'Parent' }, { id: '4343', type: 'Friend' }] }));
    const rels = out.calls.filter((c) => c.path.endsWith('/relationships')).map((c) => c.body);
    assert.deepEqual(rels, [
      { constituent_id: out.cid, relation_id: '4242', type: 'Parent', reciprocal_type: 'Child' },
      { constituent_id: out.cid, relation_id: '4343', type: 'Friend', reciprocal_type: 'Friend' },
    ]);
  });
  it('a type that has no reciprocal is refused', async () => {
    const { ctx } = world();
    await assert.rejects(() => stand(ctx, person({ relations: [{ id: '4242', type: 'Cousin' }] })), (e) => e.status === 400 && /from the list/.test(e.message));
  });
  it('a failed link comes back as a warning that names what to finish', async () => {
    const { ctx } = world();
    let n = 800;
    const send = async (calls) => ({ results: calls.map((c) => (c.path.endsWith('/relationships') ? { ok: false, status: 400, body: [{ message: 'no such record' }] } : c.method === 'POST' ? { ok: true, status: 200, body: { id: String(++n) } } : { ok: true, status: 200, body: { lookup_id: '5' } })) });
    const out = await ap.addPartner(ctx, person({ relations: [{ id: '4242', type: 'Sibling' }] }), { standin: false, send });
    assert.equal(out.warnings.length, 1);
    assert.match(out.warnings[0], /The sibling link was not saved/);
  });
});

describe('the holder from the state', () => {
  const table = [
    ['US Regions', '', '', '', '', 'WW Regions'],
    ['9/6/2026', '9/6/2026', '9/6/2026', '', '', '10/24/2025'],
    ['East Region', 'Midwest Region', 'West Region', 'Pacific NW Region', 'Northeast', 'Down Under Region'],
    ['Richard Brown', 'Stephanie Brady', 'Brian Carr', '', '', 'Celeste Paul'],
    ['AL', 'AZ', 'WA', '', '', 'AU'],
    ['Alabama', 'Arizona', 'Washington', '', '', 'NZ'],
    ['RI', 'NM', 'OR'],
    ['Rhode Island', 'New Mexico', 'Oregon'],
  ];
  it('reads each state to the regional director on the Regions tab', () => {
    const m = ap.regionMap(table);
    assert.equal(m.get('AL'), 'Richard Brown');
    assert.equal(m.get('RI'), 'Richard Brown');
    assert.equal(m.get('NM'), 'Stephanie Brady');
    assert.equal(m.get('OR'), 'Brian Carr');
    assert.equal(m.has('AK'), false);
  });
  it('a listed state goes to its director, and a blank state or Alaska goes to Partner Care', async () => {
    const { ctx } = world();
    const db = ctx.env.DB;
    await db.prepare("INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, active, updated_at) VALUES ('rb@favorintl.org','Richard Brown','rdd','77',1,1,'RDD Action',1,'x')").run();
    await db.prepare("INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, active, updated_at) VALUES ('pc@favorintl.org','Pat Care','partner_care','88',1,0,NULL,1,'x')").run();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://mirror.test')) return realFetch(url, init);
      return new Response(JSON.stringify([{ json: JSON.stringify(table) }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      ctx.env.MIRROR_API_KEY = 'k';
      ctx.env.MIRROR_QUERY_URL = 'https://mirror.test/d1/query';
      assert.deepEqual(await ap.holderForState(ctx.env, 'al'), { fid: '77', name: 'Richard Brown', source: 'territory' });
      assert.deepEqual(await ap.holderForState(ctx.env, 'AK'), { fid: '88', name: 'Pat Care', source: 'partner_care' });
      assert.deepEqual(await ap.holderForState(ctx.env, ''), { fid: '88', name: 'Pat Care', source: 'partner_care' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it('a Partner Care holder is allowed for a new partner and gets the Partner Care assignment type', async () => {
    const { ctx } = world();
    await ctx.env.DB.prepare("INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, active, updated_at) VALUES ('pc@favorintl.org','Pat Care','partner_care','88',1,0,NULL,1,'x')").run();
    const out = await stand(ctx, person({ holder: '88' }));
    assert.equal(out.calls.find((c) => c.path.includes('assignments')).body.type, 'Partner Care');
  });
});
