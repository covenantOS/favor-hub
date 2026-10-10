// Run with: npm test
//
// Add a partner from Entry: the duplicate scorer, the lock on "None of these is the same person", the calls the create step makes (checked
// against the stand-in, never a real record) and the hub's own list of new partners. Made-up people only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const pm = await import('../functions/_lib/actions/partner-match.ts');
const ap = await import('../functions/_lib/work/addpartner.ts');
const np = await import('../functions/_lib/work/newpartners.ts');

const SCHEMA = readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8');
const probe = (o) => pm.probeOf({ kind: 'individual', ...o });
const cand = (o) => ({ cid: '1', lookup: '10', type: 'Individual', first: '', last: '', org: '', city: '', state: '', zip: '', phones: [], emails: [], deceased: false, inactive: false, since: '2020-01-01', gifts: 0, lastGift: '', lastAmount: 0, holders: [], ...o });

describe('the duplicate scorer', () => {
  it('matches on phone and email whatever the name says', () => {
    const p = probe({ first: 'Tom', last: 'Bradford', phone: '(727) 555-0119', email: 'TB@example.com' });
    const r = pm.reasonsFor(p, cand({ first: 'Thomas', last: 'Bradford', phones: ['7275550119'], emails: ['tb@example.com'] }));
    assert.deepEqual(r.slice(0, 2), ['Same phone', 'Same email']);
    assert.deepEqual(pm.reasonsFor(probe({ first: 'Ann', last: 'Zed', phone: '7275550119' }), cand({ first: 'Bo', last: 'Yu', phones: ['7275550119'] })), ['Same phone']);
  });
  it('treats Tom and Thomas as one first name, and a different last name as no match', () => {
    assert.equal(pm.sameFirst('Tom', 'Thomas'), true);
    assert.equal(pm.sameFirst('Will', 'William'), true);
    assert.equal(pm.sameFirst('Tom', 'Tim'), false);
    assert.deepEqual(pm.reasonsFor(probe({ first: 'Tom', last: 'Bradford', city: 'Clearwater' }), cand({ first: 'Tom', last: 'Brady', city: 'Clearwater' })), []);
  });
  it('same name and city outranks same name, which outranks same last name and city', () => {
    const p = probe({ first: 'Ellen', last: 'Bradford', city: 'Clearwater' });
    assert.deepEqual(pm.reasonsFor(p, cand({ first: 'Ellen', last: 'Bradford', city: 'Clearwater' })), ['Same name and city']);
    assert.deepEqual(pm.reasonsFor(p, cand({ first: 'Ellen', last: 'Bradford', city: 'Largo' })), ['Same name']);
    assert.deepEqual(pm.reasonsFor(p, cand({ first: 'Carl', last: 'Bradford', city: 'Clearwater' })), ['Same last name and city']);
  });
  it('checks the spouse of a household too', () => {
    const p = probe({ kind: 'household', first: 'Tom', last: 'Bradford', spouse_first: 'Ellen', spouse_last: 'Bradford', city: 'Clearwater' });
    assert.deepEqual(pm.reasonsFor(p, cand({ first: 'Ellen', last: 'Bradford', city: 'Clearwater' })), ['Same name and city']);
  });
  it('never matches an organization on its name alone', () => {
    const p = probe({ kind: 'organization', org: 'Grace Fellowship Church', city: 'Tampa' });
    assert.deepEqual(pm.reasonsFor(p, cand({ type: 'Organization', org: 'Grace Fellowship Church', city: 'Dallas' })), []);
    assert.deepEqual(pm.reasonsFor(p, cand({ type: 'Organization', org: 'Grace Fellowship Church', city: 'Tampa' })), ['Same name and city']);
    const web = probe({ kind: 'organization', org: 'Grace Fellowship', email: 'office@gracefellowship.org' });
    assert.deepEqual(pm.reasonsFor(web, cand({ type: 'Organization', org: 'GFC Tampa', emails: ['info@gracefellowship.org'] })), ['Same web domain']);
  });
  it('a free mail domain is not a web domain', () => {
    assert.equal(pm.domainOf('a@gmail.com'), '');
    assert.equal(pm.domainOf('a@gracefellowship.org'), 'gracefellowship.org');
    const web = probe({ kind: 'organization', org: 'Grace Fellowship', email: 'office@gmail.com' });
    assert.deepEqual(pm.reasonsFor(web, cand({ type: 'Organization', org: 'Other Church', emails: ['x@gmail.com'] })), ['Same email'].slice(1));
  });
  it('drops inactive records and ranks the strongest first', () => {
    const p = probe({ first: 'Tom', last: 'Bradford', phone: '7275550119', city: 'Clearwater' });
    const out = pm.rankCandidates(p, [
      cand({ cid: '1', first: 'Carl', last: 'Bradford', city: 'Clearwater' }),
      cand({ cid: '2', first: 'Thomas', last: 'Bradford', phones: ['7275550119'] }),
      cand({ cid: '3', first: 'Tom', last: 'Bradford', city: 'Clearwater', inactive: true }),
    ]);
    assert.deepEqual(out.map((m) => m.cid), ['2', '1']);
  });
});

describe("folding in Blackbaud's own search", () => {
  const p = probe({ first: 'Tom', last: 'Bradford', city: 'Clearwater' });
  const mirrorHits = pm.rankCandidates(p, [cand({ cid: '1', first: 'Tom', last: 'Bradford', city: 'Clearwater' }), cand({ cid: '2', first: 'Tom', last: 'Bradford', city: 'Clearwater' })]);
  it('marks a record both found, drops a name-only mirror record Blackbaud no longer has, and adds a high-ranked record the mirror lacks', () => {
    const live = [
      { id: '1', rank: '0.95', display_name: 'Tom Bradford' },
      { id: '7', rank: '0.9', display_name: 'Thomas Bradford', formatted_address: '5 Elm\r\nClearwater, FL  33755' },
      { id: '8', rank: '0.5', display_name: 'T Bradley' },
    ];
    const out = pm.mergeLive(p, mirrorHits, live);
    assert.deepEqual(out.map((m) => m.cid).sort(), ['1', '7']);
    assert.equal(out.find((m) => m.cid === '1').live, true);
    assert.deepEqual(out.find((m) => m.cid === '7').reasons, ['Same name and city']);
  });
  it("keeps a phone match even when Blackbaud's name search does not return it", () => {
    const withPhone = pm.rankCandidates(probe({ first: 'Zed', last: 'Q', phone: '7275550000' }), [cand({ cid: '9', first: 'Al', last: 'B', phones: ['7275550000'] })]);
    assert.deepEqual(pm.mergeLive(p, withPhone, []).map((m) => m.cid), ['9']);
  });
  it('builds the search query with the required name and no empty filters', () => {
    assert.equal(pm.liveQuery(probe({ first: '', last: '' })), null);
    const q = new URLSearchParams(pm.liveQuery(probe({ first: 'Tom', last: 'Bradford', city: 'Clearwater', phone: '(727) 555-0119' })));
    assert.equal(q.get('last_org_name'), 'Bradford');
    assert.equal(q.get('first_name'), 'Tom');
    assert.equal(q.get('phone'), '7275550119');
    assert.equal(q.get('state'), null);
    const o = new URLSearchParams(pm.liveQuery(probe({ kind: 'organization', org: 'Grace Fellowship' })));
    assert.equal(o.get('search_individuals'), 'false');
  });
});

function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args,
    sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) db.prepare(s.sql).run(...(s.args || [])); return []; } };
}

function world(over = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const staff = db.prepare("INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, active, updated_at) VALUES (?,?,?,?,1,1,?,1,'x')");
  staff.run('jo@favorintl.org', 'Jo Dir', 'rdd', '10', 'RDD Action');
  staff.run('ce@favorintl.org', 'Ce Dir', 'church', '11', 'CED Action');
  const sent = [];
  let n = 500;
  const repo = {
    async send(calls) {
      sent.push(...calls);
      return { results: calls.map((c) => (c.method === 'POST' ? { ok: true, status: 200, body: { id: String(++n) } } : { ok: true, status: 200, body: { value: [], lookup_id: '777' } })), callsToday: 10 };
    },
    async partnersByIds() {
      return [];
    },
  };
  const ctx = { env: { DB: fakeD1(db) }, repo, actor: 'Sam Support', email: 'sam@favorintl.org', scope: { role: 'support', all: false, fids: new Set(['10', '11']), fid: null, team: 'Support', email: 'sam@favorintl.org', name: 'Sam' }, ...over };
  return { db, ctx, sent };
}
const form = (o = {}) => ({ kind: 'individual', first: 'Tom', last: 'Bradford', phone: '(727) 555-0119', email: 'tb@example.com', street: '1 Elm St', city: 'Clearwater', state: 'FL', zip: '33755', code: 'Prospect', holder: '10', none_same: true, ...o });

describe('adding a partner', () => {
  it('stays locked until the box is ticked, on the server too', async () => {
    const { ctx, sent } = world();
    await assert.rejects(() => ap.addPartner(ctx, form({ none_same: false }), { standin: false }), (e) => e.status === 400 && e.code === 'not_confirmed');
    assert.equal(sent.length, 0);
  });
  it('only Support and admins add partners', async () => {
    const { ctx } = world();
    ctx.scope = { ...ctx.scope, role: 'director' };
    await assert.rejects(() => ap.addPartner(ctx, form(), { standin: true }), (e) => e.status === 403);
    await assert.rejects(() => ap.findMatches(ctx, form(), { live: false }), (e) => e.status === 403);
  });
  it('a role test never makes a real record', async () => {
    const { ctx, sent } = world({ testCid: '27202' });
    await assert.rejects(() => ap.addPartner(ctx, form(), { standin: false }), (e) => e.status === 403 && e.code === 'test_only');
    assert.equal(sent.length, 0);
  });
  it('the stand-in builds every call, sends none, and makes no list entry or link', async () => {
    const { ctx, sent, db } = world();
    const out = await ap.addPartner(ctx, form({ kind: 'household', spouse_first: 'Ellen', spouse_last: 'Bradford' }), { standin: true });
    // The duplicate search is the only call that reaches Blackbaud, and it only reads.
    assert.equal(sent.length, 1);
    assert.match(sent[0].path, /duplicatesearch/);
    assert.equal(out.standin, true);
    const paths = out.calls.map((c) => `${c.method} ${c.path}`);
    assert.deepEqual(paths, [
      'POST /constituent/v1/constituents',
      'POST /constituent/v1/constituents',
      'POST /constituent/v1/constituentcodes',
      'POST /constituent/v1/constituentcodes',
      'POST /constituent/v1/relationships',
      'POST /fundraising/v1/fundraisers/assignments',
      `GET /constituent/v1/constituents/${out.cid}`,
    ]);
    assert.equal(out.calls[0].body.first, 'Tom');
    assert.equal(out.calls[0].body.phone.number, '(727) 555-0119');
    assert.equal(out.calls[1].body.first, 'Ellen');
    assert.equal(out.calls[1].body.phone, undefined);
    assert.equal(out.calls[5].body.type, 'Prospect Steward');
    assert.deepEqual(out.warnings, []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM act_new_partners').get().n, 0);
  });
  it('picks the assignment type from the code and the holder', () => {
    assert.equal(ap.assignmentType('Prospect', 'church'), 'Church Engagement Director');
    assert.equal(ap.assignmentType('Partner', 'rdd'), 'Regional Development Director (RDD)');
    assert.equal(ap.assignmentType('Prospect', 'rdd'), 'Prospect Steward');
  });
  it('an organization is one record with a business address and phone', async () => {
    const { ctx } = world();
    const out = await ap.addPartner(ctx, form({ kind: 'organization', org: 'Grace Fellowship Church', first: '', last: '', code: 'Church', holder: '11' }), { standin: true });
    assert.equal(out.calls[0].body.type, 'Organization');
    assert.equal(out.calls[0].body.name, 'Grace Fellowship Church');
    assert.equal(out.calls[0].body.address.type, 'Business');
    assert.equal(out.calls[0].body.phone.type, 'Business Phone');
    assert.equal(out.calls.find((c) => c.path.includes('assignments')).body.type, 'Church Engagement Director');
  });
  it('a real add records the partner for the hub, takes the claim, and a second press is refused', async () => {
    const { ctx, db } = world();
    const out = await ap.addPartner(ctx, form(), { standin: false, send: async (calls) => ({ results: calls.map((c) => (c.method === 'POST' ? { ok: true, status: 200, body: { id: '601' } } : { ok: true, status: 200, body: { lookup_id: '777' } })) }) });
    assert.equal(out.standin, false);
    assert.equal(out.lookup, '777');
    const row = db.prepare('SELECT * FROM act_new_partners WHERE cid = ?').get(out.cid);
    assert.equal(row.name, 'Tom Bradford');
    assert.equal(row.holder, '10');
    await assert.rejects(() => ap.addPartner(ctx, form(), { standin: false }), (e) => e.status === 409);
    const hits = await np.partnersWithNew(ctx.env, ctx.repo, [out.cid]);
    assert.equal(hits[0].name, 'Tom Bradford');
    assert.deepEqual(hits[0].holders, ['10']);
  });
  it('a refusal on the first call leaves nothing behind and frees the claim', async () => {
    const { ctx, db } = world();
    const send = async (calls) => ({ results: calls.map(() => ({ ok: false, status: 0, body: { refused: 'no write rule' }, refused: 'no write rule' })) });
    await assert.rejects(() => ap.addPartner(ctx, form(), { standin: false, send }), (e) => e.status === 502);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM act_cache WHERE key LIKE 'addp:%'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM act_new_partners').get().n, 0);
  });
  it('a step after the record that fails comes back as a warning, and the record still counts', async () => {
    const { ctx } = world();
    const send = async (calls) => ({ results: calls.map((c) => (c.path.includes('assignments') ? { ok: false, status: 400, body: [{ message: 'bad type' }] } : c.method === 'POST' ? { ok: true, status: 200, body: { id: '911' } } : { ok: true, status: 200, body: { lookup_id: '55' } })) });
    const out = await ap.addPartner(ctx, form(), { standin: false, send });
    assert.equal(out.warnings.length, 1);
    assert.match(out.warnings[0], /holder/);
  });
  it('validates names, phone, email, code and household', async () => {
    const { ctx } = world();
    for (const bad of [{ first: '' }, { phone: '555' }, { email: 'nope' }, { code: 'Donor' }, { kind: 'household' }]) {
      await assert.rejects(() => ap.addPartner(ctx, form(bad), { standin: true }), (e) => e.status === 400);
    }
  });
  it('the live check counts one call, and a person is limited per minute', async () => {
    const { ctx, sent } = world();
    const out = await ap.findMatches(ctx, form(), { live: true });
    assert.equal(out.live, 'ran');
    assert.equal(out.calls, 1);
    assert.equal(sent.length, 1);
    for (let i = 0; i < 11; i++) await ap.findMatches(ctx, form(), { live: true });
    await assert.rejects(() => ap.findMatches(ctx, form(), { live: true }), (e) => e.status === 429);
    const quiet = await ap.findMatches(ctx, { kind: 'individual', last: '' }, { live: false });
    assert.equal(quiet.ready, false);
  });
});
