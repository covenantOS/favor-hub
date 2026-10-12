// Run with: npm test
//
// Grants: the reading of RESERVED (Grant ...) actions from the mirror, the hub's own log laid over it, and the log write (one action,
// with a file attached in the same batch) against stand-ins for Blackbaud and the hub database. Every name, id and amount is made up:
// the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const gr = await import('../functions/_lib/work/grants.ts');
const svc = await import('../functions/_lib/work/grants-svc.ts');
const up = await import('../functions/_lib/work/upload.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const fields = await import('../functions/_lib/actions/fields.ts');

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const day = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const SCHEMA = ['work.sql', 'work-gifts.sql', 'work-reminders.sql', 'work-grants.sql'].map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8')).join('\n');

describe('kinds and the Blackbaud types', () => {
  it('maps each kind to its type and back', () => {
    for (const k of gr.KINDS) assert.equal(gr.kindOfType(gr.KIND_TYPE[k]), k);
    assert.equal(gr.kindOfType('RDD Action'), null);
    assert.equal(gr.KIND_TYPE.loi, 'RESERVED (Grant LOI)');
  });
  it('records how it was sent as the category', () => {
    assert.equal(gr.HOW_CATEGORY.portal, 'Task/Other');
    assert.equal(gr.HOW_CATEGORY.email, 'Email');
    assert.equal(gr.HOW_CATEGORY.mail, 'Mailing');
  });
  it('has none of the words the mirror refuses', () => assert.doesNotThrow(() => readOnly(gr.GRANTS_SQL)));
});

let mirror;
const q = async (sql, params = []) => {
  readOnly(sql);
  return mirror.prepare(sql).all(...params);
};
function buildMirror() {
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_type TEXT, first_name TEXT, last_name TEXT, raw_json TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, constituent_record_id TEXT, action_type TEXT, action_category TEXT, action_date_due TEXT, action_completed_date TEXT, action_summary TEXT, action_description TEXT, date_added TEXT, raw_json TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_end_date TEXT, fundraiser_active INTEGER);
    INSERT INTO fundraisers VALUES ('700', 'Gwen', 'Grant', 'Staff', NULL, 1);
  `);
  const org = (id, name) => mirror.prepare('INSERT INTO constituents (id, constituent_type, raw_json) VALUES (?,?,?)').run(id, 'Organization', JSON.stringify({ name, address: { city: 'Austin', state: 'TX' } }));
  org('11', 'Example Family Foundation'); org('12', 'Sample Trust');
  const act = (id, cid, type, cat, due, done, sum, completed) => mirror.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, cid, type, cat, due + 'T00:00:00', done ? done + 'T00:00:00' : null, sum, 'Notes', (done || due) + 'T09:00:00', JSON.stringify({ completed, fundraisers: ['700'] }));
  act('201', '11', 'RESERVED (Grant Request)', 'Mailing', day(-20), day(-20), 'Request for the school program', 1);
  act('202', '11', 'RESERVED (Grant LOI)', 'Email', day(-5), day(-5), 'LOI for water wells', 1);
  act('203', '12', 'RESERVED (Grant Report)', 'Task/Other', day(10), null, 'Year-end report due', 0);
  act('204', '12', 'RDD Action', 'Phone call', day(-3), day(-3), 'Not a grant', 1);
  act('205', '12', 'RESERVED (Grant Request)', 'Mailing', day(-900), day(-900), 'Too old', 1);
}

describe('loadGrants against the mirror', () => {
  beforeEach(buildMirror);
  it('lists grant actions only, newest first, with the foundation, kind, date and fundraiser', async () => {
    const rows = await gr.loadGrants(q, TODAY, new Map());
    assert.deepEqual(rows.map((r) => r.id), ['203', '202', '201']);
    assert.equal(rows[0].open, true);
    assert.equal(rows[0].date, day(10), 'an open task shows its due date');
    assert.equal(rows[1].kind, 'loi');
    assert.equal(rows[1].foundation, 'Example Family Foundation');
    assert.equal(rows[1].place, 'Austin, TX');
    assert.deepEqual(rows[1].who, ['Gwen Grant']);
    assert.equal(rows[1].date, day(-5));
  });
  it('names the file the hub attached when it knows of one', async () => {
    const rows = await gr.loadGrants(q, TODAY, new Map([['201', 'request-letter.pdf']]));
    assert.equal(rows.find((r) => r.id === '201').file, 'request-letter.pdf');
  });
});

/* ------------------------------------------------------------------ the service */
let hub;
let calls;
let nextId;
let realFetch;
let ctx;
let putCalls;
const CODES = { ...fields.FALLBACK_CODES, types: [...fields.FALLBACK_CODES.types, ...Object.values(gr.KIND_TYPE)] };

function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args, sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { for (const s of list) db.prepare(s.sql).run(...(s.args || [])); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
}
function newCtx(scope) {
  const repo = {
    async send(list) {
      calls.push(list);
      const results = list.map((c) => {
        if (c.method === 'GET' && c.path.startsWith('/constituent/v1/actiontypes')) return { ok: true, status: 200, body: { value: CODES.types } };
        if (c.method === 'GET' && c.path.includes('/customfields/categories')) return { ok: true, status: 200, body: { value: [] } };
        if (c.method === 'GET') return { ok: true, status: 200, body: { count: 0, value: [] } };
        if (c.method === 'POST' && c.path === '/constituent/v1/documents') return { ok: true, status: 200, body: { file_id: 'f-1', file_upload_request: { url: 'https://files.test/put', method: 'PUT', headers: [{ name: 'x-ms-blob-type', value: 'BlockBlob' }] } } };
        return { ok: true, status: 200, body: { id: String(nextId++) } };
      });
      return { results, callsToday: 10 };
    },
    async refreshMirror(ids, tags) { return { ok: true, runId: 'r', maxCalls: ids.length * (tags ? 2 : 1) }; },
    async synced() { return '2026-10-10T09:00:00Z'; },
    async modifiedOf() { return new Map(); },
    async loadBoard() { return { rows: [], people: {}, synced: '', orphans: 0, today: TODAY }; },
  };
  return { env: { DB: fakeD1(hub), MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/d1/query' }, repo, actor: 'Gwen Grant', email: 'gwen@example.org', scope };
}
const GRANTS = { role: 'grants', fid: '700', fids: new Set(['700']), all: false, email: 'gwen@example.org', name: 'Gwen Grant', team: 'Grants' };
const put = async (url, init) => { putCalls.push({ url, init }); return new Response('', { status: 201 }); };
const pdf = (name = 'letter.pdf', size = 12) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

describe('logging a grant entry', () => {
  beforeEach(() => {
    buildMirror();
    hub = new DatabaseSync(':memory:');
    hub.exec(SCHEMA);
    calls = []; putCalls = []; nextId = 9000;
    ctx = newCtx(GRANTS);
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://mirror.test')) return realFetch(url, init);
      const { sql, params } = JSON.parse(init.body);
      let rows;
      if (/FROM constituents WHERE id = \?1/.test(sql) && /organization_name/.test(sql)) rows = [{ t: 'Organization', f: null, l: null, p: null, o: 'Example Family Foundation', d: 0 }];
      else if (/json_extract\(raw_json, '\$\.completed'\) = 1/.test(sql) && /id IN/.test(sql) && !/constituent_record_id/.test(sql)) rows = [];
      else rows = mirror.prepare(sql).all(...params);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const sent = () => calls.flat();
  const created = () => sent().filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
  const attached = () => sent().filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions/attachments');
  async function run(id) {
    const s = await import('../functions/_lib/work/service.ts');
    for (let i = 0; i < 10; i++) { const r = await s.runBatch(ctx, id); if (!r.left) return r; }
  }

  it('reads the list with the stats the tab shows', async () => {
    const out = await svc.grantsResponse(ctx);
    assert.equal(out.rows.length, 3);
    assert.equal(out.stats.open, 1);
    assert.equal(out.kinds.length, 5);
  });

  it('a sent request with a PDF writes one completed Grant Request and attaches the file to it', async () => {
    const out = await svc.logGrant(ctx, { cid: '11', kind: 'request', how: 'email', state: 'sent', date: day(-1), summary: 'Request for the clinic', notes: 'Amount asked: 25,000', req: 'g1', file: pdf('clinic-request.pdf') }, put);
    await run(out.batch.id);
    const c = created();
    assert.equal(c.length, 1);
    assert.equal(c[0].body.type, 'RESERVED (Grant Request)');
    assert.equal(c[0].body.category, 'Email');
    assert.equal(c[0].body.completed, true);
    assert.equal(c[0].body.direction, 'Outbound');
    assert.equal(c[0].body.constituent_id, '11');
    assert.deepEqual(c[0].body.fundraisers, ['700']);
    const a = attached();
    assert.equal(a.length, 1);
    assert.equal(a[0].body.parent_id, '9000', 'the file attaches to the action just created');
    assert.equal(a[0].body.file_id, 'f-1');
    assert.equal(a[0].body.type, 'Physical');
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].url, 'https://files.test/put');
    assert.equal(hub.prepare('SELECT file_name FROM act_grants').get().file_name, 'clinic-request.pdf');
  });

  it('a to-do with a due date and no file writes an open task', async () => {
    const out = await svc.logGrant(ctx, { cid: '12', kind: 'report', how: 'portal', state: 'todo', date: day(14), summary: 'Interim report', req: 'g2' }, put);
    await run(out.batch.id);
    const c = created()[0].body;
    assert.equal(c.type, 'RESERVED (Grant Report)');
    assert.equal(c.completed, false);
    assert.equal(c.status, 'Open');
    assert.equal(c.category, 'Task/Other');
    assert.equal(attached().length, 0);
    assert.equal(putCalls.length, 0);
  });

  it('the new entry shows at once on the list, then gives way to the mirror\'s copy', async () => {
    const out = await svc.logGrant(ctx, { cid: '11', kind: 'loi', how: 'mail', state: 'sent', date: TODAY, summary: 'LOI for the library', req: 'g3', file: pdf() }, put);
    await run(out.batch.id);
    let list = await svc.grantsResponse(ctx);
    const mine = list.rows.find((r) => r.summary === 'LOI for the library');
    assert.ok(mine && mine.local, 'shown before the mirror has it');
    assert.equal(mine.file, 'letter.pdf');
    assert.equal(list.stats.local, 1);
    mirror.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?,?)').run('9000', '11', 'RESERVED (Grant LOI)', 'Mailing', TODAY + 'T00:00:00', TODAY + 'T00:00:00', 'LOI for the library', '', TODAY + 'T09:00:00', JSON.stringify({ completed: 1, fundraisers: ['700'] }));
    list = await svc.grantsResponse(ctx);
    assert.equal(list.rows.filter((r) => r.summary === 'LOI for the library').length, 1);
    assert.ok(!list.rows.find((r) => r.summary === 'LOI for the library').local);
    assert.equal(list.rows.find((r) => r.summary === 'LOI for the library').file, 'letter.pdf', 'the hub still knows the file it attached');
  });

  it('Undo takes the entry off the list', async () => {
    const out = await svc.logGrant(ctx, { cid: '11', kind: 'task', state: 'todo', date: day(3), summary: 'Call the program officer', req: 'g4' }, put);
    await run(out.batch.id);
    assert.ok((await svc.grantsResponse(ctx)).rows.some((r) => r.summary === 'Call the program officer'));
    hub.prepare("UPDATE act_batches SET state = 'undone' WHERE id = ?").run(out.batch.id);
    assert.ok(!(await svc.grantsResponse(ctx)).rows.some((r) => r.summary === 'Call the program officer'));
  });

  it('refuses what cannot be logged: no foundation, no summary, a future date sent, a bad kind, a file type, a big file', async () => {
    await assert.rejects(svc.logGrant(ctx, { kind: 'request', summary: 'x' }, put), /foundation/);
    await assert.rejects(svc.logGrant(ctx, { cid: '11', kind: 'request', summary: '  ' }, put), /summary/);
    await assert.rejects(svc.logGrant(ctx, { cid: '11', kind: 'request', state: 'sent', date: day(1), summary: 'x' }, put), /future/);
    await assert.rejects(svc.logGrant(ctx, { cid: '11', kind: 'gift', summary: 'x' }, put), /Pick request/);
    await assert.rejects(svc.logGrant(ctx, { cid: '11', kind: 'request', summary: 'x', file: pdf('run.exe') }, put), /PDF, Word, Excel or image/);
    await assert.rejects(svc.logGrant(ctx, { cid: '11', kind: 'request', summary: 'x', file: pdf('big.pdf', up.MAX_FILE + 1) }, put), /10 MB/);
    assert.equal(created().length, 0);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_grants').get().n, 0);
  });

  it('a file that cannot reach Blackbaud logs nothing', async () => {
    const bad = async () => new Response('', { status: 500 });
    await assert.rejects(svc.logGrant(ctx, { cid: '11', kind: 'request', summary: 'x', file: pdf(), req: 'g5' }, bad), /did not reach Blackbaud/);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_batches').get().n, 0);
  });

  it('the same press twice saves one entry', async () => {
    const a = await svc.logGrant(ctx, { cid: '11', kind: 'task', state: 'todo', date: day(3), summary: 'Follow up', req: 'same' }, put);
    await svc.logGrant(ctx, { cid: '11', kind: 'task', state: 'todo', date: day(3), summary: 'Follow up', req: 'same' }, put).catch(() => null);
    await run(a.batch.id);
    assert.equal(created().length, 1);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_grants').get().n, 1);
  });

  it('only the grants team, the Support Team and admins use the tab', async () => {
    const dir = { ...ctx, scope: { role: 'director', fid: '501', fids: new Set(['501']), all: false, email: 'a@b.c', name: 'A', team: 'RDD' } };
    await assert.rejects(svc.grantsResponse(dir), /grants team/);
    await assert.rejects(svc.logGrant(dir, { cid: '11', kind: 'request', summary: 'x' }, put), /grants team/);
    const pc = { ...ctx, scope: { ...GRANTS, role: 'partner_care' } };
    await assert.rejects(svc.grantsResponse(pc), /grants team/);
  });

  it('a role test may log only on its one test record', async () => {
    const t = { ...ctx, testCid: '27202' };
    const ok = await svc.logGrant(t, { cid: '27202', kind: 'task', state: 'todo', date: day(2), summary: 'Test entry', req: 'g6' }, put);
    ctx = t;
    await run(ok.batch.id);
    assert.equal(created()[0].body.constituent_id, '27202');
    await assert.rejects(svc.logGrant(t, { cid: '11', kind: 'task', state: 'todo', date: day(2), summary: 'Test entry', req: 'g7' }, put), /test record/);
  });
});
