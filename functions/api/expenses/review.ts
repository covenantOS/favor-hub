import { approverEmails } from '../../_lib/expenses/auth';
import {
  addExpenseEvent,
  approverNames,
  expenseShape,
  getExpense,
  getExpenseByTokenHash,
  getSettings,
  isSignatureDataUrl,
  itemsFor,
  markDecided,
  sha256Hex,
  type ExpenseRow,
} from '../../_lib/expenses/db';
import { emailApproved, emailDeclined } from '../../_lib/expenses/email';
import { buildExpensePdf } from '../../_lib/expenses/pdf';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

async function lookup(env: Env, token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) throw new HttpError(404, 'bad_token', 'This link is not valid.');
  const row = await getExpenseByTokenHash(env, await sha256Hex(token));
  if (!row) throw new HttpError(404, 'bad_token', 'This link is not valid.');
  return row;
}

/**
 * The request, found either by the private link emailed to the approver (token) or, for an approver
 * signed in with Google, by its id from the expense log. signer is set on the second path, so the
 * decision names the person who signed.
 */
async function find(env: Env, request: Request, token: string, id: string): Promise<{ row: ExpenseRow; signer: string }> {
  if (token) return { row: await lookup(env, token), signer: '' };
  if (!/^exp_[0-9a-f]{24}$/.test(id)) throw new HttpError(404, 'not_found', 'That request is not in the log.');
  const user = hubUserOf(request);
  if (!user || user.via !== 'google') throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const row = await getExpense(env, id);
  if (!row) throw new HttpError(404, 'not_found', 'That request is not in the log.');
  if (!(await approverEmails(env, row.approver_email)).has(user.email.toLowerCase())) {
    throw new HttpError(403, 'not_approver', 'Only the approvers can sign expense requests. Ask Michael Hinton or Rachel Cox.');
  }
  return { row, signer: user.name };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const params = new URL(request.url).searchParams;
    const { row, signer } = await find(env, request, params.get('token') || '', params.get('id') || '');
    const items = await itemsFor(env, row.id);
    return json({ ok: true, request: expenseShape(row, items, { signatures: true }), signer });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const data = (await request.json()) as Record<string, unknown>;
    const token = asTrimmed(data.token, 'token', 64, false);
    const id = asTrimmed(data.id, 'id', 40, false);
    const action = asTrimmed(data.action, 'action', 20);
    if (action !== 'approve' && action !== 'decline') throw new HttpError(400, 'bad_action', 'Action must be approve or decline.');
    const { row, signer } = await find(env, request, token, id);
    if (row.status !== 'pending') {
      return errorJson('already_decided', `This request was already ${row.status}.`, 409);
    }
    const ip = clientIp(request);
    // The record and the emails name the one person who signed: the signed-in approver from the log,
    // or, from the emailed link, whoever the page says is signing when several people may approve.
    // Everyone named as an approver is still copied.
    let who = signer;
    if (!who) {
      const names = approverNames(row.approver_name);
      if (names.length > 1) {
        const picked = asTrimmed(data.signer, 'signer', 120, false);
        who = names.find((n) => n.toLowerCase() === picked.toLowerCase()) || '';
        if (!who) throw new HttpError(400, 'pick_signer', `Choose who is signing: ${names.join(' or ')}.`);
      }
    }
    if (who) {
      await env.DB.prepare('UPDATE expense_requests SET approver_name = ? WHERE id = ? AND status = ?').bind(who, row.id, 'pending').run();
    }

    if (action === 'approve') {
      if (!isSignatureDataUrl(data.signature)) throw new HttpError(400, 'missing_signature', 'Sign before approving.');
      const pdfKey = `expenses/${row.id}/FAVOR-${row.doc_number}-signed.pdf`;
      const decided = await markDecided(env, row.id, {
        status: 'approved',
        approver_signature: data.signature,
        approver_ip: ip,
        pdf_r2_key: pdfKey,
      });
      await addExpenseEvent(env, row.id, 'approved', decided.approver_name, { ip, from: signer ? 'log' : 'email link' });
      const items = await itemsFor(env, row.id);
      const settings = await getSettings(env);
      let result: { sent: boolean; to: string[]; subject: string; html: string } = { sent: false, to: [], subject: '', html: '' };
      try {
        const pdf = await buildExpensePdf(env, decided, items, new URL(request.url).origin);
        await env.UPLOADS.put(pdfKey, pdf.buffer as ArrayBuffer, { httpMetadata: { contentType: 'application/pdf' } });
        result = await emailApproved(env, decided, items, settings.distribution, pdf);
      } catch (err) {
        console.error('[expenses] pdf/email on approve', err);
      }
      await addExpenseEvent(env, row.id, 'distributed', 'system', result);
      return json({ ok: true, status: 'approved', emailed: result.sent });
    }

    if (action === 'decline') {
      const note = asTrimmed(data.note, 'note', 2000, false);
      const decided = await markDecided(env, row.id, { status: 'declined', decline_note: note, approver_ip: ip });
      await addExpenseEvent(env, row.id, 'declined', decided.approver_name, { note, ip, from: signer ? 'log' : 'email link' });
      const items = await itemsFor(env, row.id);
      let result: { sent: boolean; to: string[]; subject: string; html: string } = { sent: false, to: [], subject: '', html: '' };
      try {
        result = await emailDeclined(env, decided, items);
      } catch (err) {
        console.error('[expenses] decline email', err);
      }
      await addExpenseEvent(env, row.id, 'decline_notified', 'system', result);
      return json({ ok: true, status: 'declined', emailed: result.sent });
    }

    throw new HttpError(400, 'bad_action', 'Action must be approve or decline.');
  } catch (err) {
    return handleError(err);
  }
};
