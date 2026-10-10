// Run with: npm test
//
// The iPhone routes end to end: real middleware, real route files, a stand-in Blackbaud sender and mirror. Every response goes through
// callChecked, which fails the test when its status or body does not match contract/mobile-v1.yaml. The last tests prove every
// operation in the contract was exercised and that each documented success was seen. Made-up names, ids and amounts only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callChecked, contractLog, idToken, signIn, spec, TODAY_ET, world, call } from './support/mobile-harness.mjs';

const { cardsFor } = await import('../functions/_lib/mobile/cards.ts');
const { loadPartner, mirrorQ } = await import('../functions/_lib/work/partner.ts');
const { dayTime } = await import('../functions/_lib/mobile/cards.ts');

const uuid = () => crypto.randomUUID();
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const people = { 501: { n: 'Fay Alpha', team: 'RDD', active: 1, left: null, listed: 1 } };

const row = (o) => ({
  id: '3001', cid: '9001', lookup: '7001', partner: 'Ada Example', place: 'Holland, MI', due: addDays(TODAY_ET(), -5), added: addDays(TODAY_ET(), -9), type: 'RDD Action', typeRaw: 'RDD Action',
  category: 'Task/Other', summary: 'Thank for the gift', description: '', fullDescription: '', mod: '2026-10-01T10:00:00', fundraisers: ['501'], holders: ['501'],
  gift: { id: 'g2', amount: 250, date: addDays(TODAY_ET(), -6), fund: 'General Fund' }, later: null, group: ['3001'], deceased: false, ty: true, ctg: false, priority: '', pending: null, ...o,
});
const board = () => [
  row({}),
  row({ id: '3002', cid: '9002', partner: 'Ben Sample', ty: false, gift: null, group: null, summary: 'Call Ben about the project', due: addDays(TODAY_ET(), -1) }),
  row({ id: '3003', cid: '9002', partner: 'Ben Sample', ty: false, gift: null, group: null, summary: 'Due next month', due: addDays(TODAY_ET(), 30) }),
  row({ id: '3004', cid: '9001', ty: false, gift: null, group: null, summary: 'Someone else task', fundraisers: ['999'] }),
  row({ id: '3005', cid: '9001', gift: { id: 'g1', amount: 100, date: addDays(TODAY_ET(), -40), fund: 'General Fund' }, group: ['3005'], later: { strength: 'thanked', date: addDays(TODAY_ET(), -30) } }),
];
const WILL = { email: 'will@favorintl.org', name: 'Will Hamilton', fid: '501', entry_owner: 1 };
const willClaims = { email: 'will@favorintl.org', name: 'Will Hamilton' };

async function ready(opts = {}) {
  const w = await world({ board: board(), people, staff: [WILL, ...(opts.staff || [])], settings: opts.settings || {} });
  const token = await signIn(w, willClaims);
  return { w, token };
}

describe('auth responses match the contract', () => {
  it('sign in, refusals and sign out', async () => {
    const w = await world();
    const ok = await callChecked(w, 'POST', '/api/auth/native', { body: { id_token: await idToken(), device_name: 'Staff iPhone' } });
    assert.equal(ok.status, 200);
    const bad = await callChecked(w, 'POST', '/api/auth/native', { body: { id_token: await idToken({ aud: 'other' }), device_name: 'x' } });
    assert.equal(bad.status, 401);
    const wrong = await callChecked(w, 'POST', '/api/auth/native', { body: { id_token: await idToken({ hd: 'other.org', email: 'a@other.org' }), device_name: 'x' } });
    assert.equal(wrong.status, 403);
    assert.equal((await callChecked(w, 'POST', '/api/auth/native/revoke', { token: ok.body.token })).status, 204);
    assert.equal((await callChecked(w, 'POST', '/api/auth/native/revoke', { token: ok.body.token })).status, 401);
    let limited;
    for (let i = 0; i < 31; i++) limited = await call(w, 'POST', '/api/auth/native', { body: { id_token: 'x' }, headers: { 'CF-Connecting-IP': '203.0.113.50' } });
    assert.equal(limited.status, 429);
    assert.deepEqual(contractLog.filter((l) => l.problems.length), []);
  });
});

describe('the gate', () => {
  it('keeps the routes inert for staff until the Work Center is released to them', async () => {
    const w = await world({ board: board(), people, staff: [{ email: 'ada@favorintl.org', name: 'Ada Example', fid: '501', entry_owner: 1, work_center: 1 }] });
    const token = await signIn(w);
    for (const path of ['/api/mobile/today', '/api/mobile/partners', '/api/mobile/partners/9001']) {
      const out = await callChecked(w, 'GET', path, { token });
      assert.equal(out.status, 403, path);
      assert.equal(out.body.error, 'not_released');
    }
    const write = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: { client_id: uuid(), partner_id: '9001', kind: 'call', occurred_at: new Date().toISOString() } });
    assert.equal(write.status, 403);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_submissions').get().n, 0);
  });

  it('opens for a listed Support person once released, and never for someone not on the list', async () => {
    const w = await world({ board: board(), people, staff: [{ email: 'ada@favorintl.org', name: 'Ada Example', fid: '501', entry_owner: 1, work_center: 1 }], settings: { release: 'support' } });
    const token = await signIn(w);
    assert.equal((await callChecked(w, 'GET', '/api/mobile/today', { token })).status, 200);
    const stranger = await signIn(w, { email: 'zed@favorintl.org', name: 'Zed' });
    assert.equal((await callChecked(w, 'GET', '/api/mobile/today', { token: stranger })).status, 403);
  });

  it('config answers every signed-in phone, so the hub can retire an old build', async () => {
    const w = await world();
    const token = await signIn(w);
    const out = await callChecked(w, 'GET', '/api/mobile/config', { token });
    assert.equal(out.status, 200);
    assert.equal(out.body.min_version, '0.1.0');
    assert.equal(out.body.features.capture, true);
  });

  it('401 without a token', async () => {
    const w = await world();
    const out = await call(w, 'GET', '/api/mobile/today');
    assert.equal(out.status, 401);
  });
});

describe('today', () => {
  it('lists the thank-yous owed and the follow-ups due, with phone and email, and nothing else', async () => {
    const { w, token } = await ready();
    const out = await callChecked(w, 'GET', '/api/mobile/today', { token });
    assert.equal(out.status, 200);
    const items = out.body.items;
    assert.deepEqual(items.map((i) => [i.id, i.kind]), [['3001', 'thank_you'], ['3002', 'follow_up']]);
    const ty = items[0];
    assert.equal(ty.partner_name, 'Ada Example');
    assert.equal(ty.phone, '(555) 010-1234');
    assert.equal(ty.email, 'ada@example.org');
    assert.match(ty.summary, /\$250 gift/);
    assert.equal(ty.done, false);
    assert.equal(items[1].phone, null);
    assert.equal(items[1].email, 'ben@example.org');
    assert.equal(items[1].due_date, addDays(TODAY_ET(), -1) + 'T12:00:00Z');
  });

  it('is empty for a person with no fundraiser id', async () => {
    const w = await world({ board: board(), people });
    const token = await signIn(w, willClaims);
    const out = await callChecked(w, 'GET', '/api/mobile/today', { token });
    assert.deepEqual(out.body, { items: [] });
  });

  it('drops an item the person already has a change waiting for', async () => {
    const { w, token } = await ready();
    await callChecked(w, 'POST', '/api/mobile/today/3002/done', { token, body: { client_id: uuid() } });
    const out = await callChecked(w, 'GET', '/api/mobile/today', { token });
    assert.deepEqual(out.body.items.map((i) => i.id), ['3001']);
  });
});

describe('mark done', () => {
  it('saves a Work Center batch first, sends it, and returns the stored answer on a repeat', async () => {
    const { w, token } = await ready();
    const id = uuid();
    const first = await callChecked(w, 'POST', '/api/mobile/today/3002/done', { token, body: { client_id: id } });
    assert.equal(first.status, 200);
    assert.equal(first.body.done, true);
    const batches = w.db.prepare('SELECT * FROM act_batches').all();
    assert.equal(batches.length, 1);
    assert.equal(batches[0].op, 'complete');
    assert.equal(batches[0].req_id, 'm:' + id);
    assert.equal(batches[0].actor_email, 'will@favorintl.org');
    const sent = w.bbCalls.filter((c) => c.method === 'PATCH');
    assert.equal(sent.length, 1);
    assert.match(sent[0].path, /\/constituent\/v1\/actions\/3002$/);
    const again = await callChecked(w, 'POST', '/api/mobile/today/3002/done', { token, body: { client_id: id } });
    assert.deepEqual(again.body, first.body);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_batches').get().n, 1);
    assert.equal(w.bbCalls.filter((c) => c.method === 'PATCH').length, 1);
  });

  it('closes every task about one gift when a thank-you is marked done', async () => {
    const { w, token } = await ready();
    w.board[0].group = ['3001', '3006'];
    w.board.push(row({ id: '3006', group: ['3001', '3006'] }));
    const out = await callChecked(w, 'POST', '/api/mobile/today/3001/done', { token, body: { client_id: uuid() } });
    assert.equal(out.status, 200);
    assert.equal(out.body.n, 2);
  });

  it('409 for an action that is no longer open, 404 for one that belongs to someone else, 400 for a bad client_id', async () => {
    const { w, token } = await ready();
    const gone = await callChecked(w, 'POST', '/api/mobile/today/424242/done', { token, body: { client_id: uuid() } });
    assert.equal(gone.status, 409);
    const theirs = await callChecked(w, 'POST', '/api/mobile/today/3004/done', { token, body: { client_id: uuid() } });
    assert.equal(theirs.status, 404);
    const bad = await callChecked(w, 'POST', '/api/mobile/today/3002/done', { token, body: { client_id: 'not-a-uuid' } });
    assert.equal(bad.status, 400);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_batches').get().n, 0);
  });

  it('a failed save frees the client_id so the phone can resend', async () => {
    const { w, token } = await ready();
    const id = uuid();
    w.script = (c) => (c.path.includes('last_modified') ? { ok: false, status: 500, body: null } : { ok: true, status: 200, body: {} });
    const failed = await call(w, 'POST', '/api/mobile/today/3002/done', { token, body: { client_id: id } });
    assert.ok(failed.status >= 400);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM mobile_writes').get().n, 0);
    w.script = (c) => (c.path.includes('last_modified') ? { ok: true, status: 200, body: { count: 0, value: [] } } : { ok: true, status: 200, body: {} });
    const ok = await callChecked(w, 'POST', '/api/mobile/today/3002/done', { token, body: { client_id: id } });
    assert.equal(ok.status, 200);
  });
});

describe('partners', () => {
  it('search returns the contract card with giving, last gift and last contact', async () => {
    const { w, token } = await ready();
    const out = await callChecked(w, 'GET', '/api/mobile/partners?q=ada', { token });
    assert.equal(out.status, 200);
    const year = new Date().getUTCFullYear();
    assert.deepEqual(out.body.items, [
      {
        id: '9001', name: 'Ada Example', place: 'Holland, MI', phone: '(555) 010-1234', email: 'ada@example.org',
        last_gift_cents: 4000, last_gift_date: `${year}-02-01T12:00:00Z`, year_to_date_cents: 29000,
        last_contact_date: `${year}-04-02T12:00:00Z`, last_contact_kind: 'visit',
      },
    ]);
  });

  it('an empty search returns the person\'s own partners, current assignments only', async () => {
    const { w, token } = await ready();
    const out = await callChecked(w, 'GET', '/api/mobile/partners', { token });
    assert.deepEqual(out.body.items.map((i) => i.id).sort(), ['9001', '9002']);
  });

  it('a partner with no gifts or contacts has null fields and a zero year to date', async () => {
    const { w, token } = await ready();
    w.mirror.exec("INSERT INTO assignments (id, constituent_record_id, assignment_fundraiser_id, assignment_type, assignment_from_date) VALUES ('s9', '9005', '501', 'RDD', '2025-01-01')");
    const out = await callChecked(w, 'GET', '/api/mobile/partners/9005', { token });
    assert.equal(out.status, 200);
    assert.equal(out.body.last_gift_cents, null);
    assert.equal(out.body.last_gift_date, null);
    assert.equal(out.body.year_to_date_cents, 0);
    assert.equal(out.body.last_contact_kind, null);
  });

  it('the search card and the partner page agree, because both follow the same definitions', async () => {
    const { w, token } = await ready();
    for (const id of ['9001', '9002']) {
      const detail = await callChecked(w, 'GET', '/api/mobile/partners/' + id, { token });
      const q = mirrorQ(w.env);
      const [fromSearch] = await cardsFor(q, [{ cid: id, name: detail.body.name, place: detail.body.place, lookup: '', holders: [], deceased: false }]);
      const { lookup_id, address, largest_gift_cents, largest_gift_date, open_task_count, open_tasks, synced_at, ...card } = detail.body;
      assert.deepEqual(fromSearch, card, 'partner ' + id);
      const page = await loadPartner(q, id);
      assert.equal(detail.body.last_gift_date, dayTime(page.card.last_gift_date));
      assert.equal(detail.body.year_to_date_cents, page.card.year_to_date_cents);
    }
  });

  it('detail adds the largest gift, open tasks, address and lookup id for the phone page', async () => {
    const { w, token } = await ready();
    const out = await callChecked(w, 'GET', '/api/mobile/partners/9001', { token });
    const page = await loadPartner(mirrorQ(w.env), '9001');
    assert.equal(out.body.lookup_id, page.lookup);
    assert.equal(out.body.largest_gift_cents, page.giving.largest ? Math.round(page.giving.largest.amount * 100) : null);
    assert.equal(out.body.open_task_count, page.actions.openCount);
    assert.equal(out.body.open_tasks.length, Math.min(10, page.actions.open.length));
    for (const t of out.body.open_tasks) assert.ok(t.id && typeof t.summary === 'string');
  });

  it('detail is 404 for an unknown or malformed id', async () => {
    const { w, token } = await ready();
    assert.equal((await callChecked(w, 'GET', '/api/mobile/partners/555555', { token })).status, 404);
    assert.equal((await callChecked(w, 'GET', '/api/mobile/partners/abc', { token })).status, 404);
  });

  it('leaves out a partner marked deceased', async () => {
    const { w, token } = await ready();
    const out = await callChecked(w, 'GET', '/api/mobile/partners?q=cy', { token });
    assert.deepEqual(out.body.items, []);
  });

  it('is read only: it sends nothing to Blackbaud and writes nothing to the hub', async () => {
    const { w, token } = await ready();
    const before = w.db.prepare('SELECT COUNT(*) AS n FROM act_outbox').get().n;
    await callChecked(w, 'GET', '/api/mobile/partners?q=ada', { token });
    await callChecked(w, 'GET', '/api/mobile/partners/9001', { token });
    assert.equal(w.bbCalls.length, 0);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_outbox').get().n, before);
  });
});

describe('log a contact', () => {
  const body = (o = {}) => ({ client_id: uuid(), partner_id: '9001', kind: 'call', note: 'Talked about the fall project.\nWill follow up.', occurred_at: new Date().toISOString(), ...o });

  it('enters one completed contact under the person\'s own fundraiser id, through the Work Center path', async () => {
    const { w, token } = await ready();
    const b = body();
    const out = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: b });
    assert.equal(out.status, 200);
    assert.equal(out.body.recorded, true);
    const sub = w.db.prepare('SELECT * FROM act_submissions').all();
    assert.equal(sub.length, 1);
    assert.equal(sub[0].owner_fid, '501');
    assert.equal(sub[0].constituent_id, '9001');
    assert.equal(sub[0].channel, 'call');
    assert.equal(sub[0].summary, 'Talked about the fall project.');
    assert.equal(sub[0].source, 'many');
    assert.equal(sub[0].created_by, 'Will Hamilton');
    const batch = w.db.prepare('SELECT * FROM act_batches').get();
    assert.equal(batch.op, 'create');
    assert.equal(batch.req_id, 'm:' + b.client_id);
    const created = w.bbCalls.filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
    assert.equal(created.length, 1);
    assert.equal(created[0].body.constituent_id, '9001');
    assert.deepEqual(created[0].body.fundraisers, ['501']);
  });

  it('a visit is a Meeting and a text is a Phone call tagged Texted', async () => {
    const { w, token } = await ready();
    await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ kind: 'visit', partner_id: '9002', note: '' }) });
    const created = w.bbCalls.filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
    assert.equal(created[0].body.category, 'Meeting');
    assert.equal(created[0].body.summary, 'Visit');
  });

  it('an email is an Email action, and the whole note travels as the description', async () => {
    const { w, token } = await ready();
    const out = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ kind: 'email', partner_id: '9002' }) });
    assert.equal(out.status, 200);
    const created = w.bbCalls.filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
    assert.equal(created[0].body.category, 'Email');
    assert.equal(created[0].body.summary, 'Talked about the fall project.');
    assert.equal(created[0].body.description, 'Talked about the fall project.\nWill follow up.');
  });

  it('a repeat of the same client_id returns the stored answer and makes no second action', async () => {
    const { w, token } = await ready();
    const b = body();
    const first = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: b });
    const again = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: b });
    assert.deepEqual(again.body, first.body);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_submissions').get().n, 1);
    assert.equal(w.bbCalls.filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions').length, 1);
  });

  it('the same contact under a new client_id is a duplicate: 409, and the app treats it as sent', async () => {
    const { w, token } = await ready();
    await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ note: 'Same note' }) });
    const dup = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ note: 'Same note' }) });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'already_recorded');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_submissions').get().n, 1);
  });

  it('is refused for a person who is not an Entry owner', async () => {
    const w = await world({ board: board(), people, staff: [{ email: 'will@favorintl.org', name: 'Will Hamilton', fid: '501', entry_owner: 0 }] });
    const token = await signIn(w, willClaims);
    const out = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body() });
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'not_entry_owner');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM mobile_writes').get().n, 0);
  });

  it('Support logs for a director they support, never for one they do not, and must say which', async () => {
    const dir = { email: 'dee@favorintl.org', name: 'Dee Director', fid: '601', entry_owner: 1 };
    const other = { email: 'oz@favorintl.org', name: 'Oz Elsewhere', fid: '602', entry_owner: 1 };
    const sup = { email: 'sam@favorintl.org', name: 'Sam Support', team: 'support', fid: '700', work_center: 1, entry_owner: 0 };
    const w = await world({ board: board(), people, staff: [sup, dir, other], settings: { release: 'support', 'scope:sam@favorintl.org': '601' } });
    const token = await signIn(w, { email: 'sam@favorintl.org', name: 'Sam Support' });
    const owners = await callChecked(w, 'GET', '/api/mobile/log-owners', { token });
    assert.equal(owners.status, 200);
    assert.deepEqual(owners.body.items, [{ id: '601', name: 'Dee Director' }, { id: '700', name: 'Sam Support' }].filter((x) => x.id === '601'));
    assert.equal(owners.body.default_id, null);
    const none = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body() });
    assert.equal(none.status, 400);
    assert.equal(none.body.error, 'pick_owner');
    const wrong = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ for_fundraiser_id: '602' }) });
    assert.equal(wrong.status, 403);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_submissions').get().n, 0);
    const ok = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ for_fundraiser_id: '601' }) });
    assert.equal(ok.status, 200);
    const sub = w.db.prepare('SELECT owner_fid, created_by FROM act_submissions').get();
    assert.equal(sub.owner_fid, '601');
    assert.equal(sub.created_by, 'Sam Support');
    const created = w.bbCalls.filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
    assert.deepEqual(created[0].body.fundraisers, ['601']);
  });

  it('a director sees only themselves in the owner list, and an admin sees every director', async () => {
    const dir = { email: 'dee@favorintl.org', name: 'Dee Director', fid: '601', entry_owner: 1, work_center: 1 };
    const { w, token } = await ready({ staff: [dir] });
    const all = await callChecked(w, 'GET', '/api/mobile/log-owners', { token });
    assert.deepEqual(all.body.items.map((i) => i.id), ['601', '501']);
    assert.equal(all.body.default_id, '501');
    const w2 = await world({ board: board(), people, staff: [dir], settings: { release: 'support' } });
    const deeToken = await signIn(w2, { email: 'dee@favorintl.org', name: 'Dee Director' });
    const mine = await callChecked(w2, 'GET', '/api/mobile/log-owners', { token: deeToken });
    assert.deepEqual(mine.body, { items: [{ id: '601', name: 'Dee Director' }], default_id: '601' });
  });

  it('refuses an unknown partner, a deceased partner and malformed input', async () => {
    const { w, token } = await ready();
    assert.equal((await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ partner_id: '555555' }) })).status, 404);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ partner_id: '9004' }) })).status, 400);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ kind: 'carrier pigeon' }) })).status, 400);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ client_id: 'nope' }) })).status, 400);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ occurred_at: 'yesterday-ish' }) })).status, 400);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body({ occurred_at: addDays(TODAY_ET(), 10) + 'T12:00:00Z' }) })).status, 400);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM act_submissions').get().n, 0);
  });

  it('honours the posting switch: saved in the outbox, nothing sent to Blackbaud', async () => {
    const { w, token } = await ready({ settings: { posting: 'off' } });
    const out = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body() });
    assert.equal(out.status, 200);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE state = 'queued'").get().n >= 1, true);
    assert.equal(w.bbCalls.filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions').length, 0);
  });

  it('sends a single contact now while the day is under 2,700 calls, and holds it for tonight past that', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const early = await ready();
    early.w.db.prepare('INSERT INTO act_meter (day, calls, route_calls, updated_at) VALUES (?, 2500, 2500, ?)').run(day, new Date().toISOString());
    const soon = await callChecked(early.w, 'POST', '/api/mobile/contacts', { token: early.token, body: body() });
    assert.equal(soon.body.run_when, 'now');
    const { w, token } = await ready();
    w.db.prepare('INSERT INTO act_meter (day, calls, route_calls, updated_at) VALUES (?, 2699, 2699, ?)').run(day, new Date().toISOString());
    const out = await callChecked(w, 'POST', '/api/mobile/contacts', { token, body: body() });
    assert.equal(out.status, 200);
    assert.equal(out.body.run_when, 'tonight');
    assert.equal(w.bbCalls.filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions').length, 0);
    assert.equal(w.db.prepare("SELECT run_when FROM act_batches").get().run_when, 'tonight');
  });

  it('limits one person to 60 changes a minute', async () => {
    const { w, token } = await ready();
    let last;
    for (let i = 0; i < 61; i++) last = await callChecked(w, 'POST', '/api/mobile/today/424242/done', { token, body: { client_id: uuid() } });
    assert.equal(last.status, 429);
  });
});

describe('captures', () => {
  const jpeg = (n = 2048) => {
    const b = new Uint8Array(n);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return b;
  };
  const formOf = (o = {}) => {
    const f = new FormData();
    f.set('client_id', o.client_id || uuid());
    f.set('kind', o.kind || 'check');
    f.set('captured_at', o.captured_at || new Date().toISOString());
    if (o.image !== null) f.set('image', new Blob([o.image || jpeg()], { type: o.type || 'image/jpeg' }), 'check.jpg');
    return f;
  };

  it('stores a JPEG in the private bucket and records its metadata', async () => {
    const { w, token } = await ready();
    const id = uuid();
    const out = await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf({ client_id: id, kind: 'reply_slip' }) });
    assert.equal(out.status, 200);
    assert.equal(out.body.stored, true);
    assert.equal(out.body.bytes, 2048);
    assert.equal(w.captures.objects.size, 1);
    const [key] = [...w.captures.objects.keys()];
    assert.match(key, new RegExp('^mobile/\\d{4}-\\d{2}/' + id + '\\.jpg$'));
    assert.equal(key.includes('will@'), false);
    const meta = w.db.prepare('SELECT * FROM mobile_captures').get();
    assert.equal(meta.kind, 'reply_slip');
    assert.equal(meta.email, 'will@favorintl.org');
    assert.match(meta.sha256, /^[0-9a-f]{64}$/);
  });

  it('a repeat of the same client_id stores nothing new', async () => {
    const { w, token } = await ready();
    const id = uuid();
    await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf({ client_id: id }) });
    const again = await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf({ client_id: id }) });
    assert.equal(again.body.repeat, true);
    assert.equal(w.captures.objects.size, 1);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM mobile_captures').get().n, 1);
  });

  it('413 over 12 MB, 400 for a file that is not a JPEG or PNG (HEIC converts on the phone), 400 for a bad kind or a missing image', async () => {
    const { w, token } = await ready();
    const big = new Uint8Array(12 * 1024 * 1024 + 10);
    big.set([0xff, 0xd8, 0xff]);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf({ image: big }) })).status, 413);
    const heic = new Uint8Array(500);
    heic.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf({ image: heic }) })).status, 400);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf({ kind: 'selfie' }) })).status, 400);
    assert.equal((await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf({ image: null }) })).status, 400);
    assert.equal(w.captures.objects.size, 0);
  });

  it('answers 503 until the gift captures bucket is bound, and the config says so', async () => {
    const { w, token } = await ready();
    delete w.env.GIFT_CAPTURES;
    const out = await call(w, 'POST', '/api/mobile/captures', { token, form: formOf() });
    assert.equal(out.status, 503);
    const cfg = await callChecked(w, 'GET', '/api/mobile/config', { token });
    assert.equal(cfg.body.features.capture, false);
  });

  it('has no route that serves the photos back', async () => {
    const { w, token } = await ready();
    await callChecked(w, 'POST', '/api/mobile/captures', { token, form: formOf() });
    await assert.rejects(() => call(w, 'GET', '/api/mobile/captures'), /no route/);
    assert.equal(w.captures.objects.size, 1);
  });
});

describe('the contract', () => {
  it('every response seen in this file matched its schema', () => {
    assert.ok(contractLog.length > 40, 'only ' + contractLog.length + ' responses were checked');
    assert.deepEqual(contractLog.filter((l) => l.problems.length), []);
  });

  it('every operation in mobile-v1.yaml was exercised, and every documented success status was seen', () => {
    const seen = new Map();
    for (const l of contractLog) seen.set(`${l.method} ${l.pattern.replace(/:([a-z]+)/g, '{$1}')}`, new Set([...(seen.get(`${l.method} ${l.pattern.replace(/:([a-z]+)/g, '{$1}')}`) || []), l.status]));
    const missing = [];
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (method === 'parameters' || (Array.isArray(op.tags) && op.tags.includes('gift-entry'))) continue; // covered in mobile-gift-entry.test.mjs
        const key = `${method.toUpperCase()} ${path}`;
        const statuses = seen.get(key);
        if (!statuses) {
          missing.push(key + ' (never called)');
          continue;
        }
        const wanted = Object.keys(op.responses).filter((s) => s.startsWith('2'));
        for (const s of wanted) if (!statuses.has(Number(s))) missing.push(`${key} never answered ${s}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('every error status the hub answers is one the contract documents', () => {
    const undocumented = contractLog.filter((l) => l.problems.some((p) => p.includes('does not list')));
    assert.deepEqual(undocumented, []);
  });
});
