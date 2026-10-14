import { approverEmails, isExpenseAdmin } from './auth';
import { getExpense, itemsFor, type ExpenseRow } from './db';
import { buildExpensePdf } from './pdf';
import { errorJson, type Env } from '../http';
import { hubUserOf } from '../session';

/** The requester, the approvers on the request or in the settings, and anyone who can open the log. */
export async function canOpenExpensePdf(env: Env, request: Request, row: ExpenseRow): Promise<boolean> {
  const user = hubUserOf(request);
  const me = user && user.via === 'google' ? user.email.trim().toLowerCase() : '';
  if (me && me === row.requester_email.trim().toLowerCase()) return true;
  if (me && (await approverEmails(env, row.approver_email)).has(me)) return true;
  return isExpenseAdmin(env, request);
}

/**
 * A decided request serves its stored signed PDF. Anything else (waiting, or declined with no stored file)
 * is built on the spot, labeled at the top, with the approver line blank. Nothing is written to R2.
 * A caller with no access gets the same 404 as a missing request.
 */
export async function expensePdfResponse(env: Env, request: Request, id: string): Promise<Response> {
  const notFound = () => errorJson('not_found', 'No PDF for that request.', 404);
  const row = id ? await getExpense(env, id) : null;
  if (!row || !(await canOpenExpensePdf(env, request, row))) return notFound();
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="FAVOR-${row.doc_number}-${row.status}.pdf"`,
    'Cache-Control': 'no-store',
  };
  if (row.status === 'approved' && row.pdf_r2_key) {
    const obj = await env.UPLOADS.get(row.pdf_r2_key);
    if (obj) return new Response(obj.body, { headers });
  }
  const bytes = await buildExpensePdf(env, row, await itemsFor(env, row.id), new URL(request.url).origin);
  return new Response(bytes, { headers });
}
