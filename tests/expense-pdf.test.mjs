// Download PDF on expense requests: who may open it, what a waiting request's PDF says, what a decided one serves.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';
import { memoryR2 } from './support/r2.mjs';

const { expensePdfResponse } = await import('../functions/_lib/expenses/pdfroute.ts');
const { pdfStatusLabel } = await import('../functions/_lib/expenses/pdf.ts');

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

function world() {
  const d1 = memoryD1();
  d1.exec(`CREATE TABLE expense_requests (id TEXT, doc_number TEXT, status TEXT, requester_name TEXT, requester_email TEXT, travel_dates TEXT, travel_city TEXT, reason TEXT, total_cents INTEGER, approver_name TEXT, approver_email TEXT, requester_signature TEXT, approver_signature TEXT, review_token_hash TEXT, decline_note TEXT, requester_ip TEXT, approver_ip TEXT, pdf_r2_key TEXT, submitted_at TEXT, decided_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE expense_items (id TEXT, request_id TEXT, position INTEGER, description TEXT, item TEXT, amount_cents INTEGER);
    CREATE TABLE expense_settings (id INTEGER, approver_name TEXT, approver_email TEXT, distribution TEXT, viewers TEXT, updated_at TEXT);
    CREATE TABLE expense_approver_overrides (id TEXT, start_date TEXT, end_date TEXT, name TEXT, email TEXT);
    CREATE TABLE expense_admin_sessions (token TEXT, created_at TEXT, expires_at TEXT);
    INSERT INTO expense_settings VALUES (1, 'Rachel Cox', 'rachel@favorintl.org', '', 'viewer@favorintl.org', 'x');`);
  const add = (id, status, extra = {}) => {
    const r = { doc_number: `EXP-${id}`, requester_email: 'req@favorintl.org', approver_signature: null, pdf_r2_key: null, decided_at: null, ...extra };
    d1.db.prepare(`INSERT INTO expense_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, r.doc_number, status, 'Pat Requester', r.requester_email, 'Oct 1', 'Tampa, FL', 'Conference', 12500, 'Rachel Cox', 'rachel@favorintl.org', SIG, r.approver_signature, 'h', null, null, null, r.pdf_r2_key, '2026-10-01T12:00:00Z', r.decided_at, 'c', 'u');
    d1.db.prepare(`INSERT INTO expense_items VALUES (?,?,?,?,?,?)`).run('i' + id, id, 0, 'Hotel', 'Lodging', 12500);
  };
  const uploads = memoryR2();
  const env = { DB: d1, UPLOADS: uploads, ASSETS: { fetch: async () => new Response('', { status: 404 }) }, HUB_SIGNIN: 'on' };
  return { env, add, uploads };
}

const as = (email, role = 'staff') =>
  new Request('https://dash.favorintl.org/api/expenses/x/pdf', { headers: email ? { 'X-Hub-Email': email, 'X-Hub-Role': role, 'X-Hub-Via': 'google' } : {} });
const text = async (res) => Buffer.from(await res.arrayBuffer()).toString('latin1');

test('a waiting request is built on the fly, labeled, filed under its status, and nothing is stored', async () => {
  const w = world();
  w.add('p1', 'pending');
  const res = await expensePdfResponse(w.env, as('req@favorintl.org'), 'p1');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="FAVOR-EXP-p1-pending.pdf"');
  assert.ok((await text(res)).startsWith('%PDF'));
  assert.equal(pdfStatusLabel('pending'), 'Pending approval');
  assert.equal(pdfStatusLabel('draft'), 'Draft');
  assert.equal(pdfStatusLabel('approved'), '');
  assert.equal(w.uploads.log?.filter((l) => String(l).includes('put')).length ?? 0, 0);
});

test('an approved request serves the stored signed file', async () => {
  const w = world();
  w.add('a1', 'approved', { pdf_r2_key: 'expenses/a1/signed.pdf', approver_signature: SIG, decided_at: '2026-10-02T12:00:00Z' });
  await w.uploads.put('expenses/a1/signed.pdf', new TextEncoder().encode('%PDF-STORED'));
  const res = await expensePdfResponse(w.env, as('rachel@favorintl.org'), 'a1');
  assert.equal(res.status, 200);
  assert.equal(await text(res), '%PDF-STORED');
  assert.match(res.headers.get('Content-Disposition'), /FAVOR-EXP-a1-approved\.pdf/);
});

test('a declined request with no stored file is built with its label', async () => {
  const w = world();
  w.add('d1', 'declined', { decided_at: '2026-10-02T12:00:00Z' });
  const res = await expensePdfResponse(w.env, as('rachel@favorintl.org'), 'd1');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Disposition'), /FAVOR-EXP-d1-declined\.pdf/);
});

test('the requester, an approver, a log viewer and an admin get it; other staff and signed-out callers get 404', async () => {
  const w = world();
  w.add('p2', 'pending');
  for (const [who, role] of [['req@favorintl.org'], ['rachel@favorintl.org'], ['viewer@favorintl.org'], ['boss@favorintl.org', 'admin']]) {
    assert.equal((await expensePdfResponse(w.env, as(who, role), 'p2')).status, 200, who);
  }
  assert.equal((await expensePdfResponse(w.env, as('other@favorintl.org'), 'p2')).status, 404);
  assert.equal((await expensePdfResponse(w.env, as(null), 'p2')).status, 404);
  assert.equal((await expensePdfResponse(w.env, as('REQ@favorintl.org'), 'nope')).status, 404);
});
