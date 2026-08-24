import { hitRateLimit, isAdmin } from '../../_lib/auth';
import {
  addExpenseEvent,
  expenseShape,
  getSettings,
  insertExpense,
  isSignatureDataUrl,
  itemsFor,
  listExpenses,
  newToken,
  resolveApprover,
  sha256Hex,
} from '../../_lib/expenses/db';
import { emailApprover } from '../../_lib/expenses/email';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, type Env } from '../../_lib/http';
import { isEmail } from '../../_lib/notify';

const MAX_ITEMS = 40;
const MAX_AMOUNT_CENTS = 9_999_999; // $99,999.99 per line

function parseItems(raw: unknown): Array<{ description: string; item: string; amount_cents: number }> {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'missing_items', 'Add at least one expense line.');
  if (raw.length > MAX_ITEMS) throw new HttpError(400, 'too_many_items', `Up to ${MAX_ITEMS} expense lines.`);
  const items = raw.map((entry) => {
    const rec = (entry || {}) as Record<string, unknown>;
    const description = asTrimmed(rec.description, 'description', 200, false);
    const item = asTrimmed(rec.item, 'item', 80, false);
    const amount = typeof rec.amount === 'number' ? rec.amount : Number(String(rec.amount ?? '').replace(/[$,]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'bad_amount', 'Amounts must be numbers.');
    const cents = Math.round(amount * 100);
    if (cents > MAX_AMOUNT_CENTS) throw new HttpError(400, 'bad_amount', 'One of the amounts is too large.');
    return { description, item, amount_cents: cents };
  });
  const kept = items.filter((it) => it.description || it.item || it.amount_cents > 0);
  if (!kept.length || kept.every((it) => it.amount_cents === 0)) {
    throw new HttpError(400, 'missing_items', 'Add at least one expense line with an amount.');
  }
  return kept;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const ip = clientIp(request);
    if (await hitRateLimit(env, `expense:${ip}`, 10, 3600)) {
      return errorJson('rate_limited', 'Slow down a moment. You can submit again shortly.', 429);
    }
    const data = (await request.json()) as Record<string, unknown>;
    if (asTrimmed(data.company, 'company', 80, false)) return json({ ok: true, ignored: true });

    const name = asTrimmed(data.name, 'name', 80);
    const email = asTrimmed(data.email, 'email', 120);
    if (!isEmail(email)) throw new HttpError(400, 'bad_email', 'A real email is required.');
    const travel_dates = asTrimmed(data.travel_dates, 'travel_dates', 120, false);
    const travel_city = asTrimmed(data.travel_city, 'travel_city', 120, false);
    const reason = asTrimmed(data.reason, 'reason', 4000);
    if (data.affirm !== true) throw new HttpError(400, 'missing_affirmation', 'Check the affirmation box.');
    if (!isSignatureDataUrl(data.signature)) throw new HttpError(400, 'missing_signature', 'Sign before submitting.');
    const items = parseItems(data.items);

    const approver = await resolveApprover(env);
    const token = newToken();
    const row = await insertExpense(env, {
      requester_name: name,
      requester_email: email,
      travel_dates,
      travel_city,
      reason,
      items,
      requester_signature: data.signature,
      requester_ip: ip,
      approver,
      review_token_hash: await sha256Hex(token),
    });
    await addExpenseEvent(env, row.id, 'submitted', name, { total_cents: row.total_cents, ip });
    await addExpenseEvent(env, row.id, 'approver_resolved', 'system', approver);

    const reviewUrl = `${new URL(request.url).origin}/expenses/review/?token=${token}`;
    if (!env.RESEND_API_KEY) console.log('[expenses] review link (no RESEND_API_KEY):', reviewUrl);
    const saved = await itemsFor(env, row.id);
    waitUntil(
      emailApprover(env, row, saved, reviewUrl)
        .then((sent) => addExpenseEvent(env, row.id, 'approver_notified', 'system', { sent }))
        .catch((err) => console.error('[expenses] approver email', err))
    );
    return json({ ok: true, doc_number: row.doc_number, approver_name: approver.name }, 201);
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!(await isAdmin(env, request))) return errorJson('unauthorized', 'Unlock first.', 401);
    const rows = await listExpenses(env);
    const settings = await getSettings(env);
    const shaped = [];
    for (const row of rows) {
      shaped.push(expenseShape(row, await itemsFor(env, row.id), { admin: true }));
    }
    return json({ ok: true, requests: shaped, settings });
  } catch (err) {
    return handleError(err);
  }
};
