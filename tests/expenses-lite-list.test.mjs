// The expense log's list leaves the signature pictures out (?sigs=0) and says whether each exists; one picture is read on its own.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { listExpenses, getSignature, expenseShape } = await import('../functions/_lib/expenses/db.ts');
const PIC = 'data:image/png;base64,' + 'A'.repeat(5000);

function world() {
  const d1 = memoryD1();
  d1.exec(`CREATE TABLE expense_requests (id TEXT, doc_number TEXT, status TEXT, requester_name TEXT, requester_email TEXT, travel_dates TEXT, travel_city TEXT, reason TEXT, total_cents INTEGER, approver_name TEXT, approver_email TEXT, requester_signature TEXT, approver_signature TEXT, review_token_hash TEXT, decline_note TEXT, requester_ip TEXT, approver_ip TEXT, pdf_r2_key TEXT, submitted_at TEXT, decided_at TEXT, created_at TEXT, updated_at TEXT);`);
  const ins = d1.db.prepare(`INSERT INTO expense_requests (id, doc_number, status, requester_name, requester_email, approver_name, approver_email, requester_signature, approver_signature, total_cents, created_at) VALUES (?, ?, ?, 'R', 'r@x.org', 'A', 'a@x.org', ?, ?, 100, ?)`);
  ins.run('e1', 'EXP-1', 'approved', PIC, PIC, '2026-01-02');
  ins.run('e2', 'EXP-2', 'pending', PIC, null, '2026-01-01');
  return { DB: d1 };
}

describe('the expense log list without signature pictures', () => {
  it('drops the pictures, keeps a flag for each, and still returns every other column', async () => {
    const rows = await listExpenses(world(), { signatures: false });
    assert.equal(rows.length, 2);
    for (const r of rows) {
      const s = expenseShape(r, [], { admin: true, signatures: false });
      assert.equal(s.requester_signature, undefined);
      assert.equal(s.approver_signature, undefined);
      assert.equal(JSON.stringify(s).includes('AAAA'), false);
      assert.equal(s.doc_number, r.doc_number);
    }
    const flags = Object.fromEntries(rows.map((r) => [r.id, expenseShape(r, [], { admin: true }).approver_signed]));
    assert.deepEqual(flags, { e1: true, e2: false });
    assert.equal(expenseShape(rows[1], [], { admin: true }).requester_signed, true);
  });
  it('the full list still carries the pictures', async () => {
    const rows = await listExpenses(world());
    assert.equal(expenseShape(rows[0], [], { admin: true, signatures: true }).requester_signature, PIC);
  });
  it('reads one picture by request and role, and nothing for a missing one', async () => {
    const env = world();
    assert.equal(await getSignature(env, 'e1', 'approver'), PIC);
    assert.equal(await getSignature(env, 'e2', 'approver'), null);
    assert.equal(await getSignature(env, 'nope', 'requester'), null);
  });
});
