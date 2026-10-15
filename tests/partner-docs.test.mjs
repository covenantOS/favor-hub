// Run with: npm test
// Documents on a partner record (functions/_lib/work/partner-docs.ts): the file is kept in FavorOS, copied to Blackbaud as a constituent
// attachment, listed beside the attachments Blackbaud already holds, and removed from both. Made-up ids; Blackbaud and R2 are stand-ins.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const D = await import('../functions/_lib/work/partner-docs.ts');

function d1(db) {
  return {
    prepare(sql) {
      const mk = (args) => ({
        bind: (...a) => mk(a),
        run: async () => { db.prepare(sql).run(...args); return { meta: { changes: 1 } }; },
        first: async () => db.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
      });
      return mk([]);
    },
  };
}
const bucket = () => {
  const m = new Map();
  return { m, put: async (k, v) => void m.set(k, v), get: async (k) => (m.has(k) ? { arrayBuffer: async () => m.get(k), body: m.get(k) } : null), delete: async (k) => void m.delete(k) };
};

let db, env, sent;
const admin = { all: true, role: 'admin' };
const ctxOf = (scope = admin, bbList = []) => ({
  env, actor: 'Test Person', email: 'someone@example.org', scope,
  repo: {
    send: async (calls) => {
      sent.push(...calls);
      return { results: calls.map((c) => {
        if (c.path === '/constituent/v1/documents') return { ok: true, status: 200, body: { file_id: 'f1', file_upload_request: { url: 'https://upload.example.test/x', method: 'PUT', headers: [] } } };
        if (c.path === '/constituent/v1/constituents/attachments' && c.method === 'POST') return { ok: true, status: 200, body: { id: 'att-1' } };
        if (c.method === 'GET') return { ok: true, status: 200, body: { value: bbList } };
        if (c.method === 'DELETE') return { ok: true, status: 200, body: {} };
        return { ok: false, status: 404, body: {} };
      }) };
    },
  },
});
const pdf = (name = 'loi.pdf') => new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' });
const put = async () => ({ ok: true, status: 200 });

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE act_cache (key TEXT PRIMARY KEY, value TEXT, at TEXT); CREATE TABLE act_meter (day TEXT PRIMARY KEY, calls INTEGER, route_calls INTEGER, updated_at TEXT)');
  env = { DB: d1(db), UPLOADS: bucket() };
  sent = [];
});

describe('partner documents', () => {
  it('keeps the file in FavorOS and attaches it to the Blackbaud record', async () => {
    const row = await D.addDoc(ctxOf(), '9001', pdf(), { kind: 'Letter of inquiry', name: 'LOI 2026' }, { put });
    assert.equal(row.blackbaud, 'done');
    assert.equal(row.kind, 'Letter of inquiry');
    assert.equal(env.UPLOADS.m.size, 1);
    const post = sent.find((c) => c.path === '/constituent/v1/constituents/attachments');
    assert.equal(post.body.parent_id, '9001');
    assert.equal(post.body.type, 'Physical');
    assert.equal(post.body.name, 'LOI 2026');
  });

  it('a stand-in run keeps the file and sends nothing to Blackbaud', async () => {
    const row = await D.addDoc(ctxOf(), '9001', pdf(), { kind: 'W-9' }, { standin: true });
    assert.equal(row.blackbaud, 'standin');
    assert.equal(sent.length, 0);
  });

  it('a failed copy is kept and can be sent again', async () => {
    const row = await D.addDoc(ctxOf(), '9001', pdf(), { kind: 'DAF letter' }, { put: async () => ({ ok: false, status: 500 }) });
    assert.equal(row.blackbaud, 'failed');
    assert.match(row.blackbaudError, /did not reach Blackbaud/);
    const again = await D.copyToBlackbaud(ctxOf(), row.id, put, '9001');
    assert.equal(again, 'done');
    assert.equal((await D.listDocs(ctxOf(), '9001', { readBb: false })).rows[0].blackbaud, 'done');
  });

  it('lists FavorOS copies and Blackbaud attachments together, counting the copy it made once', async () => {
    await D.addDoc(ctxOf(), '9001', pdf(), { kind: 'Award letter', date: '2026-09-01' }, { put });
    const bb = [{ id: 'att-1', name: 'Award letter', date: '2026-09-01T00:00:00' }, { id: 'att-7', name: 'Older LOI', file_name: 'old.pdf', date: '2025-03-02T00:00:00' }];
    const list = await D.listDocs(ctxOf(admin, bb), '9001', { fresh: true });
    assert.equal(list.rows.length, 2);
    assert.deepEqual(list.rows.map((r) => r.blackbaud).sort(), ['done', 'only']);
    assert.equal(list.rows.find((r) => r.blackbaud === 'only').url, '');
  });

  it('documents are per partner', async () => {
    await D.addDoc(ctxOf(), '9001', pdf(), { kind: 'Other' }, { standin: true });
    assert.equal((await D.listDocs(ctxOf(), '9002', { readBb: false })).rows.length, 0);
    const [r] = (await D.listDocs(ctxOf(), '9001', { readBb: false })).rows;
    assert.equal((await D.openDoc(ctxOf(), '9002', r.id)).status, 404, 'another partner id never opens it');
    assert.equal((await D.openDoc(ctxOf(), '9001', r.id)).status, 200);
  });

  it('refuses a bad type, a big file and a role that cannot add', async () => {
    await assert.rejects(() => D.addDoc(ctxOf(), '9001', new File(['x'], 'run.exe'), { kind: 'Other' }, { standin: true }), /PDF, Word/);
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.pdf');
    await assert.rejects(() => D.addDoc(ctxOf(), '9001', big, { kind: 'Other' }, { standin: true }), /10 MB/);
    assert.equal(D.mayDocs({ all: false, role: 'field' }), false);
    assert.equal(D.mayDocs({ all: false, role: 'grants' }), true);
  });

  it('removing a document removes Blackbaud copy and the stored file; only the owner, Support or an admin may', async () => {
    const row = await D.addDoc(ctxOf(), '9001', pdf(), { kind: 'Report' }, { put });
    const other = { ...ctxOf({ all: false, role: 'grants' }), email: 'else@example.org' };
    await assert.rejects(() => D.removeDoc(other, '9001', row.id), /Only the person/);
    await D.removeDoc(ctxOf(), '9001', row.id);
    assert.ok(sent.some((c) => c.method === 'DELETE' && c.path.endsWith('/attachments/att-1')));
    assert.equal(env.UPLOADS.m.size, 0);
    assert.equal((await D.listDocs(ctxOf(), '9001', { readBb: false })).rows.length, 0);
  });
});
