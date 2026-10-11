// Run with: npm test
//
// Record maintenance in the partner drawer: contact rows (addresses with seasonal windows, phones, emails with their primary marks),
// the three record flags, constituent and solicit codes, and the deceased and inactive marks. A real SQLite copy of db/work.sql stands
// in for D1, a script stands in for Blackbaud (its lists, its quirks and the "200 and nothing kept" trap), and a stub answers the
// mirror. Made-up ids and names only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const rec = await import('../functions/_lib/work/records.ts');
const svc = await import('../functions/_lib/work/service.ts');

const SCHEMA = readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8');

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
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        for (const s of list) db.prepare(s.sql).run(...(s.args || []));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
}

let db;
let calls;
let ctx;
let bb; // the stand-in Blackbaud: one partner, 100
let realFetch;
let nextId;
let ignore; // paths whose PATCH answers 200 and keeps nothing

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

function fresh() {
  return {
    constituent: { id: '100', type: 'Individual', name: 'Ann Partner', first: 'Ann', last: 'Partner', inactive: false, deceased: false, gives_anonymously: false, requests_no_email: false, no_valid_address: false },
    addresses: [{ id: '1', constituent_id: '100', type: 'Home', address_lines: '1 Main St', city: 'Tampa', state: 'FL', postal_code: '33606', country: 'United States', preferred: true, do_not_mail: false, inactive: false, date_added: '2020-01-01T00:00:00' }],
    phones: [{ id: '10', constituent_id: '100', type: 'Cell Phone', number: '(813) 555-0100', primary: true, do_not_call: false, inactive: false }],
    emails: [{ id: '20', constituent_id: '100', type: 'Email', address: 'ann@example.org', primary: true, do_not_email: false, inactive: false }],
    codes: [
      { id: '30', constituent_id: '100', description: 'Partner', start: { d: 1, m: 2, y: 2015 } },
      { id: '31', constituent_id: '100', description: 'Church', start: { d: 1, m: 3, y: 2016 } },
    ],
    prefs: [{ id: '40', constituent_id: '100', solicit_code: 'Has no valid email' }],
  };
}

const TABLE = ['Home', 'Business', 'Seasonal', 'Estate', 'Previous address'];

function bbScript(c) {
  const ok = (body) => ({ ok: true, status: 200, body });
  const m = c.path.match(/^\/constituent\/v1\/(addresses|phones|emailaddresses|constituentcodes|communicationpreferences)(?:\/(\d+))?(?:\?.*)?$/);
  const key = { addresses: 'addresses', phones: 'phones', emailaddresses: 'emails', constituentcodes: 'codes', communicationpreferences: 'prefs' };
  const list = c.path.match(/^\/constituent\/v1\/constituents\/100\/(addresses|phones|emailaddresses|constituentcodes|communicationpreferences)/);
  if (c.method === 'GET' && list) return ok({ count: bb[key[list[1]]].length, value: bb[key[list[1]]].map((x) => ({ ...x })) });
  if (c.method === 'GET' && c.path === '/constituent/v1/constituents/100') return ok({ ...bb.constituent });
  if (c.method === 'GET' && c.path.startsWith('/constituent/v1/addresstypes')) return ok({ value: TABLE });
  if (c.method === 'GET' && c.path.startsWith('/constituent/v1/phonetypes')) return ok({ value: ['Home Phone', 'Cell Phone', 'Business Phone', 'International Phone'] });
  if (c.method === 'GET' && c.path.startsWith('/constituent/v1/communicationpreferences')) return ok({ value: rec.TABLES_FALLBACK.solicitCodes });
  if (c.method === 'GET' && c.path.startsWith('/constituent/v1/constituentcodetypes')) return ok({ value: ['Partner', 'Prospect', 'Church', 'DAF Provider'] });
  if (c.method === 'GET') return ok({ value: [] });
  if (m && m[1] && c.method === 'POST') {
    const id = String(nextId++);
    const row = { id, ...c.body };
    const list2 = bb[key[m[1]]];
    // Blackbaud puts the mark on the newest row and clears the old one itself.
    if (row.preferred === true) list2.forEach((x) => (x.preferred = false));
    if (row.primary === true) list2.forEach((x) => (x.primary = false));
    list2.push(row);
    return ok({ id });
  }
  if (m && m[2] && c.method === 'PATCH') {
    if (ignore.has(c.path)) return ok(null);
    const row = bb[key[m[1]]].find((x) => x.id === m[2]);
    if (!row) return { ok: false, status: 404, body: null };
    // Blackbaud refuses to unmark a preferred address (found on record 27202, 2026-10-11).
    if (m[1] === 'addresses' && row.preferred === true && c.body.preferred === false) return { ok: false, status: 400, body: [{ message: 'The address is marked as Preferred and that cannot be changed.' }] };
    if (c.body.preferred === true) bb[key[m[1]]].forEach((x) => (x.preferred = false));
    if (c.body.primary === true) bb[key[m[1]]].forEach((x) => (x.primary = false));
    for (const [k, v] of Object.entries(c.body)) {
      if (v === null) delete row[k];
      else row[k] = v;
    }
    if (m[1] === 'addresses' && row.end && String(row.end).slice(0, 10) <= TODAY) row.inactive = true;
    if (m[1] === 'addresses' && !row.end) row.inactive = false;
    return ok(null);
  }
  if (m && m[2] && c.method === 'DELETE') {
    const gone = bb[key[m[1]]].find((x) => x.id === m[2].split('?')[0]);
    if (m[1] === 'addresses' && gone && gone.preferred === true) return { ok: false, status: 400, body: [{ message: 'The address is a preferred address and cannot be deleted.' }] };
    bb[key[m[1]]] = bb[key[m[1]]].filter((x) => x.id !== m[2].split('?')[0]);
    return ok(null);
  }
  if (c.method === 'PATCH' && c.path === '/constituent/v1/constituents/100') {
    if (ignore.has(c.path)) return ok(null);
    const b = { ...c.body };
    // The trap: {deceased:false} alone answers 200 and keeps the mark.
    if (b.deceased === false && !Object.prototype.hasOwnProperty.call(b, 'deceased_date')) delete b.deceased;
    for (const [k, v] of Object.entries(b)) {
      if (v === null) delete bb.constituent[k];
      else bb.constituent[k] = v;
    }
    return ok(null);
  }
  if (c.method === 'PATCH' && /^\/fundraising\/v1\/fundraisers\/assignments\/\d+$/.test(c.path)) return ok(null);
  if (c.method === 'PATCH' && /^\/constituent\/v1\/actions\/\d+$/.test(c.path)) return ok(null);
  if (c.method === 'POST' && c.path === '/constituent/v1/notes') return ok({ id: String(nextId++) });
  return ok({});
}

function newCtx(scope) {
  const repo = {
    async send(list) {
      calls.push(list);
      const results = list.map((c) => bbScript(c));
      return { results, callsToday: 10 };
    },
    async refreshMirror(ids, tags) {
      return { ok: true, runId: 'r', maxCalls: ids.length * (tags ? 2 : 1) };
    },
    async synced() {
      return '2026-10-10T09:00:00Z';
    },
    async modifiedOf() {
      return new Map();
    },
  };
  return { env: { DB: fakeD1(db), MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/d1/query' }, repo, actor: 'Pat Smith', email: 'pat@example.org', scope };
}

let giftRows;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  calls = [];
  nextId = 9000;
  ignore = new Set();
  bb = fresh();
  giftRows = [];
  ctx = newCtx();
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://mirror.test')) return realFetch(url, init);
    const { sql, params } = JSON.parse(init.body);
    let rows = [];
    if (/FROM constituents WHERE id = \?1/.test(sql)) rows = [{ t: 'Individual', f: 'Ann', l: 'Partner', p: null, o: null }];
    else if (/FROM actions WHERE constituent_record_id/.test(sql)) rows = [{ id: '700', summary: 'Call about the year-end gift', category: 'Phone call', due: '2026-10-20' }];
    else if (/FROM assignments WHERE constituent_record_id = \?1 AND \(assignment_to_date IS NULL OR substr\(assignment_to_date, 1, 10\) > \?2\)/.test(sql)) rows = [{ id: '800' }];
    else if (/FROM assignments WHERE constituent_record_id/.test(sql)) rows = [{ fid: '10', type: 'Regional Development Director (RDD)', id: '800' }];
    else if (/FROM gifts WHERE constituent_record_id/.test(sql)) rows = giftRows;
    else if (/FROM constituents WHERE id IN/.test(sql)) rows = [{ id: '555', t: 'Organization', o: 'Latimer Family Foundation' }];
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const sent = () => calls.flat().filter((c) => c.method !== 'GET');
async function runAll(id) {
  for (let i = 0; i < 10; i++) {
    const r = await svc.runBatch(ctx, id);
    if (!r.left) return r;
  }
  throw new Error('batch never finished');
}
const rows = (batch) => db.prepare('SELECT * FROM act_outbox WHERE batch_id = ? ORDER BY rowid').all(batch);

describe('input checks', () => {
  it('an address needs a type and a place, and a seasonal one needs both days of its season', () => {
    const tables = rec.TABLES_FALLBACK;
    assert.throws(() => rec.checkAddress({ lines: '1 Test Rd' }, tables, { create: true }), /address type/);
    assert.throws(() => rec.checkAddress({ type: 'Home' }, tables, { create: true }), /street, a city or a ZIP/);
    assert.throws(() => rec.checkAddress({ type: 'Seasonal', lines: 'x', seasonalStart: { m: 5, d: 1 } }, tables, { create: true }), /month and day/);
    assert.throws(() => rec.checkAddress({ type: 'Seasonal', lines: 'x', seasonalStart: { m: 2, d: 31 }, seasonalEnd: { m: 10, d: 15 } }, tables, { create: true }), /month and day/);
    const ok = rec.checkAddress({ type: 'seasonal', lines: ' 1 Test  Rd ', city: 'Tampa', state: 'FL', zip: '33606', seasonalStart: { m: 5, d: 1 }, seasonalEnd: { m: 10, d: 15 }, preferred: false }, tables, { create: true });
    assert.deepEqual(ok, { type: 'Seasonal', address_lines: '1 Test Rd', city: 'Tampa', state: 'FL', postal_code: '33606', country: 'United States', preferred: false, seasonal_start: { m: 5, d: 1 }, seasonal_end: { m: 10, d: 15 } });
    assert.equal(rec.windowWords({ m: 5, d: 1 }, { m: 10, d: 15 }), 'Every year May 1 to October 15');
    assert.throws(() => rec.checkAddress({ start: '2026-10-10', end: '2026-10-01' }, tables), /before the start/);
  });
  it('phones and emails are checked the way Blackbaud would', () => {
    assert.throws(() => rec.checkPhone({ number: '123' }, rec.TABLES_FALLBACK, { create: true }), /too short/);
    assert.equal(rec.checkPhone({ number: '(813) 555-0199' }, rec.TABLES_FALLBACK, { create: true }).type, 'Cell Phone');
    assert.throws(() => rec.checkEmail({ address: 'nope' }, { create: true }), /does not look right/);
    assert.deepEqual(rec.checkEmail({ address: 'a@b.co', primary: true, doNotEmail: true }, { create: true }), { address: 'a@b.co', type: 'Email', primary: true, do_not_email: true });
  });
  it('a conflict is a field someone else changed to something new', () => {
    const live = { city: 'Orlando', state: 'FL' };
    assert.deepEqual(rec.conflictsOf(live, { city: 'Tampa' }, { city: 'Lakeland' }), [{ key: 'city', theirs: 'Orlando' }]);
    assert.deepEqual(rec.conflictsOf(live, { city: 'Tampa' }, { city: 'Orlando' }), []);
    assert.deepEqual(rec.conflictsOf(live, undefined, { city: 'x' }), []);
  });
  it('the read-back finds a value Blackbaud kept differently, and forgives the formatting it changes', () => {
    assert.equal(rec.mismatch({ number: '813-555-0199', primary: true }, { number: '(813) 555-0199', primary: true }), null);
    assert.equal(rec.mismatch({ preferred: false }, { preferred: true }), 'preferred');
    assert.equal(rec.mismatch({ end: '2026-10-10T00:00:00' }, { end: '2026-10-10T00:00:00' }), null);
    assert.equal(rec.mismatch({ deceased: true }, { deceased: false }), 'deceased');
    assert.equal(rec.mismatch({ deceased: false }, { deceased_date: null }), null);
    assert.equal(rec.mismatch({ seasonal_start: { d: 1, m: 5 } }, { seasonal_start: { m: 5, d: 1 } }), null);
  });
});

describe('contact rows', () => {
  it('adds a seasonal address, reads it back, and Undo removes the row', async () => {
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'add', set: { type: 'Seasonal', lines: '41 Harbor Rd', city: 'Asheville', state: 'NC', zip: '28801', seasonalStart: { m: 5, d: 1 }, seasonalEnd: { m: 10, d: 15 }, preferred: false }, req: 'a1' });
    assert.ok(out.batch.id);
    await runAll(out.batch.id);
    const post = sent().find((c) => c.method === 'POST');
    assert.equal(post.path, '/constituent/v1/addresses');
    assert.equal(post.body.constituent_id, '100');
    assert.deepEqual(post.body.seasonal_start, { m: 5, d: 1 });
    const made = bb.addresses.find((a) => a.address_lines === '41 Harbor Rd');
    assert.ok(made);
    assert.equal(rows(out.batch.id)[0].state, 'verified');
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.ok(sent().some((c) => c.method === 'DELETE' && c.path === `/constituent/v1/addresses/${made.id}?constituent=100`));
    assert.equal(bb.addresses.length, 1);
  });
  it('a new preferred address is made unmarked, then marked, exactly one stays preferred, and Undo marks the old one before it removes the new one', async () => {
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'add', set: { type: 'Home', lines: '9 New Ave', city: 'Tampa', state: 'FL', zip: '33606', preferred: true }, req: 'a2' });
    await runAll(out.batch.id);
    assert.ok(rows(out.batch.id).every((r) => r.state === 'verified'), JSON.stringify(rows(out.batch.id).map((r) => [r.state, r.last_error])));
    const writes = sent();
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].body.preferred, false);
    assert.equal(writes[1].method, 'PATCH');
    assert.deepEqual(writes[1].body, { preferred: true });
    assert.equal(bb.addresses.filter((a) => a.preferred).length, 1);
    assert.equal(bb.addresses.find((a) => a.preferred).address_lines, '9 New Ave');
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.equal(rows(undo.batch.id).filter((r) => r.state === 'failed').length, 0);
    assert.equal(bb.addresses.length, 1);
    assert.equal(bb.addresses[0].preferred, true);
  });
  it('an address marked Preferred cannot be unmarked: the person is told to mark another one', async () => {
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'edit', id: '1', set: { preferred: false }, req: 'a2b' }), /Mark the other address preferred/);
  });
  it('marking another existing address preferred moves the mark, and Undo moves it back', async () => {
    bb.addresses.push({ id: '2', constituent_id: '100', type: 'Business', address_lines: '5 Work St', city: 'Tampa', state: 'FL', preferred: false, inactive: false });
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'edit', id: '2', set: { preferred: true }, req: 'a2c' });
    await runAll(out.batch.id);
    assert.deepEqual(bb.addresses.map((a) => [a.id, a.preferred]), [['1', false], ['2', true]]);
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.deepEqual(bb.addresses.map((a) => [a.id, a.preferred]), [['1', true], ['2', false]]);
  });
  it('ends an address with an end date, which makes it inactive, and Undo reopens it', async () => {
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'end', id: '1', set: { end: TODAY }, req: 'a3' });
    await runAll(out.batch.id);
    assert.equal(bb.addresses[0].inactive, true);
    assert.equal(bb.addresses[0].end, `${TODAY}T00:00:00`);
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.equal(bb.addresses[0].inactive, false);
    assert.equal(bb.addresses[0].end, undefined);
  });
  it('stops when someone changed the same field in Blackbaud after the form was opened', async () => {
    bb.addresses[0].city = 'Orlando';
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'edit', id: '1', set: { city: 'Lakeland' }, base: { city: 'Tampa' }, req: 'a4' });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'conflict');
    assert.deepEqual(out.conflict, [{ key: 'city', theirs: 'Orlando' }]);
    assert.equal(sent().length, 0);
  });
  it('a seasonal address keeps its type, and an edit sends only what changed', async () => {
    bb.addresses.push({ id: '2', constituent_id: '100', type: 'Seasonal', address_lines: '2 Shore Rd', city: 'Bar Harbor', state: 'ME', preferred: false, inactive: false, seasonal_start: { m: 6, d: 1 }, seasonal_end: { m: 9, d: 1 } });
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'edit', id: '2', set: { type: 'Home' }, req: 'a5' }), /cannot change its type/);
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'address', mode: 'edit', id: '2', set: { city: 'Bar Harbor', state: 'ME', seasonalEnd: { m: 9, d: 15 }, seasonalStart: { m: 6, d: 1 } }, req: 'a6' });
    await runAll(out.batch.id);
    const patch = sent().find((c) => c.method === 'PATCH');
    assert.deepEqual(Object.keys(patch.body).sort(), ['seasonal_end']);
    assert.deepEqual(bb.addresses[1].seasonal_end, { m: 9, d: 15 });
  });
  it('a new primary phone with do-not-call unmarks the old primary, and Undo removes it', async () => {
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'phone', mode: 'add', set: { number: '(813) 555-0199', type: 'Home Phone', primary: true, doNotCall: true }, req: 'p1' });
    await runAll(out.batch.id);
    assert.equal(bb.phones.filter((p) => p.primary).length, 1);
    const made = bb.phones.find((p) => p.number === '(813) 555-0199');
    assert.equal(made.do_not_call, true);
    assert.equal(made.type, 'Home Phone');
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.equal(bb.phones.length, 1);
    assert.equal(bb.phones[0].primary, true);
  });
  it('an email edit marks do-not-email, deactivating keeps the row, and a duplicate is refused', async () => {
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'email', mode: 'edit', id: '20', set: { doNotEmail: true }, base: { do_not_email: false }, req: 'e1' });
    await runAll(out.batch.id);
    assert.equal(bb.emails[0].do_not_email, true);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'email', mode: 'add', set: { address: 'ANN@example.org' }, req: 'e2' }), /already has that email/);
    const end = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'email', mode: 'end', id: '20', req: 'e3' });
    await runAll(end.batch.id);
    assert.equal(bb.emails[0].inactive, true);
    assert.equal(bb.emails[0].primary, false);
  });
  it('a change Blackbaud answers 200 and does not keep is marked failed, in plain words', async () => {
    ignore.add('/constituent/v1/phones/10');
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'phone', mode: 'edit', id: '10', set: { number: '(813) 555-0111' }, req: 'p2' });
    await runAll(out.batch.id);
    const r = rows(out.batch.id)[0];
    assert.equal(r.state, 'failed');
    assert.match(r.last_error, /Blackbaud kept a different number/);
  });
});

describe('record flags and status', () => {
  it('the three flags change together and Undo puts them back', async () => {
    const out = await svc.createBatch(ctx, { op: 'pflags', cid: '100', flags: { givesAnonymously: true, requestsNoEmail: true, noValidAddress: false }, req: 'f1' });
    await runAll(out.batch.id);
    assert.equal(bb.constituent.gives_anonymously, true);
    assert.equal(bb.constituent.requests_no_email, true);
    const patch = sent().find((c) => c.method === 'PATCH');
    assert.deepEqual(patch.body, { gives_anonymously: true, requests_no_email: true });
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.equal(bb.constituent.gives_anonymously, false);
    assert.equal(bb.constituent.requests_no_email, false);
  });
  it('marks deceased with its date and runs the ticked effects, then Undo reverses them all', async () => {
    const out = await svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'deceased', date: '2026-10-08', effects: { endPartner: true, endAssignments: true, doNotSolicit: true }, closeIds: ['700'], req: 's1' });
    await runAll(out.batch.id);
    assert.equal(bb.constituent.deceased, true);
    assert.deepEqual(bb.constituent.deceased_date, { d: 8, m: 10, y: 2026 });
    assert.deepEqual(bb.codes.find((c) => c.description === 'Partner').end, { d: 8, m: 10, y: 2026 });
    assert.equal(bb.codes.find((c) => c.description === 'Church').end, undefined);
    assert.ok(bb.prefs.some((p) => p.solicit_code === 'Do Not Solicit'));
    const w = sent();
    assert.ok(w.some((c) => c.path === '/fundraising/v1/fundraisers/assignments/800' && c.body.end === '2026-10-08T00:00:00'));
    assert.ok(w.some((c) => c.path === '/constituent/v1/actions/700' && c.body.status === 'Canceled'));
    assert.ok(rows(out.batch.id).filter((r) => r.state === 'failed').length === 0);
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.equal(bb.constituent.deceased, false);
    assert.equal(bb.constituent.deceased_date, undefined);
    assert.equal(bb.codes.find((c) => c.description === 'Partner').end, undefined);
    assert.ok(!bb.prefs.some((p) => p.solicit_code === 'Do Not Solicit'));
  });
  it('marking active sends the deceased date as null, because {deceased:false} alone is ignored, and reopens what ended with it', async () => {
    const out = await svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'deceased', date: '2026-10-08', effects: { endPartner: true, endAssignments: false, doNotSolicit: true }, req: 's2' });
    await runAll(out.batch.id);
    const back = await svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'active', req: 's3' });
    await runAll(back.batch.id);
    const patch = sent().filter((c) => c.method === 'PATCH' && c.path === '/constituent/v1/constituents/100').pop();
    assert.deepEqual(patch.body, { deceased: false, deceased_date: null });
    assert.equal(bb.constituent.deceased, false);
    assert.equal(bb.codes.find((c) => c.description === 'Partner').end, undefined);
    assert.ok(bb.prefs.find((p) => p.solicit_code === 'Do Not Solicit').end);
    assert.equal(rows(back.batch.id).filter((r) => r.state === 'failed').length, 0);
  });
  it('inactive is a flag and nothing else unless the person ticks more', async () => {
    const out = await svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'inactive', effects: { endPartner: false, endAssignments: false, doNotSolicit: false }, req: 's4' });
    await runAll(out.batch.id);
    assert.equal(bb.constituent.inactive, true);
    assert.equal(sent().length, 1);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'inactive', req: 's5' }), /already inactive/);
  });
  it('an organization is never marked deceased, and a household note goes to the other person', async () => {
    bb.constituent.type = 'Organization';
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'deceased', req: 's6' }), /inactive, not deceased/);
    bb.constituent.type = 'Individual';
    const out = await svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'deceased', date: '2026-10-08', effects: { endPartner: false, endAssignments: false, doNotSolicit: false, noteOther: true }, alsoNote: '101', req: 's7' });
    await runAll(out.batch.id);
    const note = sent().find((c) => c.path === '/constituent/v1/notes');
    assert.equal(note.body.constituent_id, '101');
    assert.match(note.body.text, /passed away on 2026-10-08/);
  });
});

describe('constituent codes and solicit codes', () => {
  it('adds a Church code, ends it, reopens it, and Undo removes the add', async () => {
    const out = await svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'add', code: 'DAF Provider', date: '2026-10-01', req: 'c1' });
    await runAll(out.batch.id);
    const made = bb.codes.find((c) => c.description === 'DAF Provider');
    assert.deepEqual(made.start, { d: 1, m: 10, y: 2026 });
    const end = await svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'end', id: made.id, date: '2026-10-05', req: 'c2' });
    await runAll(end.batch.id);
    assert.deepEqual(bb.codes.find((c) => c.id === made.id).end, { d: 5, m: 10, y: 2026 });
    const undo = await svc.undoBatch(ctx, end.batch.id);
    await runAll(undo.batch.id);
    assert.equal(bb.codes.find((c) => c.id === made.id).end, undefined);
    const undoAdd = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undoAdd.batch.id);
    assert.ok(!bb.codes.some((c) => c.description === 'DAF Provider'));
  });
  it('Partner and Prospect belong to the morning run, here and everywhere in this panel', async () => {
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'add', code: 'Prospect', req: 'c3' }), /morning run/);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'end', id: '30', req: 'c4' }), /morning run/);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'add', code: 'Made Up', req: 'c5' }), /from the list/);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'add', code: 'Church', req: 'c6' }), /already has the Church code/);
  });
  it('a record whose gifts are all soft-credited to someone else is a pass-through and stays a Prospect', async () => {
    giftRows = [{ id: '1', soft: JSON.stringify([{ constituent_id: '555', amount: 50 }]) }, { id: '2', soft: JSON.stringify([{ constituent_id: '555', amount: 25 }]) }];
    const pt = await rec.passThrough(ctx.env, '100');
    assert.deepEqual([pt.gifts, pt.passed, pt.blocked, pt.to], [2, 2, true, ['Latimer Family Foundation']]);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'add', code: 'Partner', req: 'c7' }), /only passes money along|soft-credited/);
    giftRows = [{ id: '3', soft: null }];
    assert.equal((await rec.passThrough(ctx.env, '100')).blocked, false);
  });
  it('adds a solicit code through communication preferences, ends it with an end date, and Undo removes the add', async () => {
    const out = await svc.createBatch(ctx, { op: 'psolicit', cid: '100', mode: 'add', code: 'No Event Invitations', date: '2026-10-01', req: 'sc1' });
    await runAll(out.batch.id);
    const post = sent().find((c) => c.method === 'POST');
    assert.equal(post.path, '/constituent/v1/communicationpreferences');
    assert.deepEqual(post.body, { constituent_id: '100', solicit_code: 'No Event Invitations', start: '2026-10-01T00:00:00' });
    const made = bb.prefs.find((p) => p.solicit_code === 'No Event Invitations');
    const end = await svc.createBatch(ctx, { op: 'psolicit', cid: '100', mode: 'end', id: made.id, date: '2026-10-05', req: 'sc2' });
    await runAll(end.batch.id);
    assert.equal(bb.prefs.find((p) => p.id === made.id).end, '2026-10-05T00:00:00');
    assert.equal(rows(end.batch.id)[0].state, 'verified');
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.ok(sent().some((c) => c.method === 'DELETE' && c.path === `/constituent/v1/communicationpreferences/${made.id}?constituent=100`));
    await assert.rejects(() => svc.createBatch(ctx, { op: 'psolicit', cid: '100', mode: 'add', code: 'Has no valid email', req: 'sc3' }), /already has/);
  });
});

describe('who may change what', () => {
  const director = { role: 'director', email: 'd@example.org', name: 'Dee', fid: '10', team: 'RDD', all: false, fids: new Set(['10']) };
  const support = { role: 'support', email: 's@example.org', name: 'Sam', fid: null, team: 'Support', all: false, fids: new Set(['10']) };
  it('a director may not change codes or mark a record deceased, Support may', async () => {
    ctx = newCtx(director);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'inactive', req: 'w1' }), /Admins and the Support Team/);
    await assert.rejects(() => svc.createBatch(ctx, { op: 'pcode', cid: '100', mode: 'add', code: 'Church', req: 'w2' }), /Admins and the Support Team/);
    ctx = newCtx(support);
    const out = await svc.createBatch(ctx, { op: 'pstatus', cid: '100', status: 'inactive', effects: { endPartner: false, endAssignments: false }, req: 'w3' });
    assert.ok(out.batch.id);
  });
  it('contact rows follow the contact-details rule: a holder may change them', async () => {
    ctx = newCtx(director);
    const out = await svc.createBatch(ctx, { op: 'pcontact', cid: '100', kind: 'phone', mode: 'edit', id: '10', set: { doNotCall: true }, req: 'w4' });
    assert.ok(out.batch.id);
  });
});
