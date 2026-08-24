import {
  addExpenseEvent,
  expenseShape,
  getExpenseByTokenHash,
  getSettings,
  isSignatureDataUrl,
  itemsFor,
  markDecided,
  sha256Hex,
} from '../../_lib/expenses/db';
import { emailApproved, emailDeclined } from '../../_lib/expenses/email';
import { buildExpensePdf } from '../../_lib/expenses/pdf';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, type Env } from '../../_lib/http';

async function lookup(env: Env, token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) throw new HttpError(404, 'bad_token', 'This link is not valid.');
  const row = await getExpenseByTokenHash(env, await sha256Hex(token));
  if (!row) throw new HttpError(404, 'bad_token', 'This link is not valid.');
  return row;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = new URL(request.url).searchParams.get('token') || '';
    const row = await lookup(env, token);
    const items = await itemsFor(env, row.id);
    return json({ ok: true, request: expenseShape(row, items, { signatures: true }) });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const data = (await request.json()) as Record<string, unknown>;
    const token = asTrimmed(data.token, 'token', 64);
    const action = asTrimmed(data.action, 'action', 20);
    const row = await lookup(env, token);
    if (row.status !== 'pending') {
      return errorJson('already_decided', `This request was already ${row.status}.`, 409);
    }
    const ip = clientIp(request);

    if (action === 'approve') {
      if (!isSignatureDataUrl(data.signature)) throw new HttpError(400, 'missing_signature', 'Sign before approving.');
      const pdfKey = `expenses/${row.id}/FAVOR-${row.doc_number}-signed.pdf`;
      const decided = await markDecided(env, row.id, {
        status: 'approved',
        approver_signature: data.signature,
        approver_ip: ip,
        pdf_r2_key: pdfKey,
      });
      await addExpenseEvent(env, row.id, 'approved', decided.approver_name, { ip });
      const items = await itemsFor(env, row.id);
      const settings = await getSettings(env);
      let emailed = false;
      try {
        const pdf = await buildExpensePdf(env, decided, items, new URL(request.url).origin);
        await env.UPLOADS.put(pdfKey, pdf.buffer as ArrayBuffer, { httpMetadata: { contentType: 'application/pdf' } });
        emailed = await emailApproved(env, decided, items, settings.distribution, pdf);
      } catch (err) {
        console.error('[expenses] pdf/email on approve', err);
      }
      await addExpenseEvent(env, row.id, 'distributed', 'system', {
        emailed,
        recipients: [decided.requester_email, decided.approver_email, ...settings.distribution],
      });
      return json({ ok: true, status: 'approved', emailed });
    }

    if (action === 'decline') {
      const note = asTrimmed(data.note, 'note', 2000, false);
      const decided = await markDecided(env, row.id, { status: 'declined', decline_note: note, approver_ip: ip });
      await addExpenseEvent(env, row.id, 'declined', decided.approver_name, { note, ip });
      const items = await itemsFor(env, row.id);
      let emailed = false;
      try {
        emailed = await emailDeclined(env, decided, items);
      } catch (err) {
        console.error('[expenses] decline email', err);
      }
      return json({ ok: true, status: 'declined', emailed });
    }

    throw new HttpError(400, 'bad_action', 'Action must be approve or decline.');
  } catch (err) {
    return handleError(err);
  }
};
