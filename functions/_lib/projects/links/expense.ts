// A task can carry its expense request and show the approval. The link is hub_tasks.expense_id (the expense request's id); the
// approval is read from the expense request itself each time, so a signature shows as soon as the approver signs.
import { HttpError, type Env } from '../../http';
import type { Actor } from '../access';
import { lower } from '../db';
import { patchTask, taskAccess } from '../tasks';
import { fire } from '../hooks';

export interface ExpenseCard {
  id: string;
  doc_number: string;
  status: string;
  status_label: string;
  total: string;
  reason: string;
  requester: string;
  approver: string;
  submitted_at: string;
  decided_at: string | null;
  decline_note: string | null;
  signed: boolean;
  url: string;
  new_url: string;
}

const LABEL: Record<string, string> = { pending: 'Waiting for approval', approved: 'Approved and signed', declined: 'Declined' };
const money = (c: number) => '$' + (Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = { id: string; doc_number: string; status: string; total_cents: number; reason: string; requester_name: string; requester_email: string; approver_name: string; approver_signature: string | null; submitted_at: string; decided_at: string | null; decline_note: string | null };
const COLS = 'id, doc_number, status, total_cents, reason, requester_name, requester_email, approver_name, approver_signature, submitted_at, decided_at, decline_note';

const card = (r: Row): ExpenseCard => ({
  id: r.id, doc_number: r.doc_number, status: r.status, status_label: LABEL[r.status] || r.status, total: money(r.total_cents), reason: String(r.reason || '').slice(0, 160),
  requester: r.requester_name, approver: r.approver_name, submitted_at: r.submitted_at, decided_at: r.decided_at, decline_note: r.decline_note, signed: !!r.approver_signature && r.status === 'approved',
  url: '/expenses/', new_url: '/expenses/new',
});

export async function expenseOfTask(env: Env, expenseId: string | null): Promise<ExpenseCard | null> {
  if (!expenseId) return null;
  const r = await env.DB.prepare(`SELECT ${COLS} FROM expense_requests WHERE id = ?`).bind(expenseId).first<Row>().catch(() => null);
  return r ? card(r) : null;
}

/** The person's own recent expense requests, to link one. */
export async function myExpenses(env: Env, email: string): Promise<ExpenseCard[]> {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM expense_requests WHERE lower(requester_email) = ? ORDER BY submitted_at DESC LIMIT 20`).bind(lower(email)).all<Row>().catch(() => ({ results: [] as Row[] }));
  return (r.results || []).map(card);
}

/** Links (or, with null, unlinks) an expense request. Only the requester or a hub admin may link a request, and the person must be able to edit the task. */
export async function linkExpense(env: Env, actor: Actor, taskRef: string, expenseId: string | null): Promise<ExpenseCard | null> {
  await taskAccess(env, actor, taskRef);
  let found: ExpenseCard | null = null;
  if (expenseId) {
    const r = await env.DB.prepare(`SELECT ${COLS} FROM expense_requests WHERE id = ? OR doc_number = ?`).bind(expenseId, expenseId).first<Row>().catch(() => null);
    if (!r) throw new HttpError(404, 'not_found', 'That expense request is not there.');
    if (lower(r.requester_email) !== actor.email && !actor.admin) throw new HttpError(403, 'forbidden', 'You can link your own expense requests.');
    found = card(r);
  }
  const res = await patchTask(env, actor, taskRef, { expense_id: found ? found.id : null });
  if (res.changed.length) await fire(env, { kind: 'task.updated', actor: actor.email, actorName: actor.name, task: res.task, project: res.project, detail: { fields: res.changed, expense: found?.doc_number || null }, told: res.told });
  return found;
}
