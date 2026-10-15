import { hitRateLimit } from '../../_lib/auth';
import { approverEmails, requireExpenseAdmin } from '../../_lib/expenses/auth';
import { hubUserOf } from '../../_lib/session';
import {
  addExpenseEvent,
  expenseShape,
  getSettings,
  insertExpense,
  isSignatureDataUrl,
  itemsFor,
  listEventsFor,
  listExpenses,
  newToken,
  resolveApprover,
  sha256Hex,
  splitEmails,
  eitherApprover,
  getExpense,
  linesAndEvents,
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
    // A signed-in person files as themselves: the email on the request is their own Favor address.
    const user = hubUserOf(request);
    const email = user && user.via === 'google' ? user.email : asTrimmed(data.email, 'email', 120);
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
    await addExpenseEvent(env, row.id, 'submitted', name, { total_cents: row.total_cents, ip, by: user ? user.email : '' });
    await addExpenseEvent(env, row.id, 'approver_resolved', 'system', approver);

    const reviewUrl = `${new URL(request.url).origin}/expenses/review/?token=${token}`;
    if (!env.RESEND_API_KEY) console.log('[expenses] no RESEND_API_KEY, approver not emailed for', row.doc_number);
    const saved = await itemsFor(env, row.id);
    waitUntil(
      emailApprover(env, row, saved, reviewUrl)
        // The email body holds the private review link, so only who it went to is kept.
        .then((result) => addExpenseEvent(env, row.id, 'approver_notified', 'system', { sent: result.sent, to: result.to, subject: result.subject }))
        .catch((err) => console.error('[expenses] approver email', err))
    );
    return json({ ok: true, doc_number: row.doc_number, approver_name: eitherApprover(approver.name) }, 201);
  } catch (err) {
    return handleError(err);
  }
};

/** Every signed-in staff member sees their own requests, matched on the Google email, and nothing else. */
async function myRequests(env: Env, request: Request) {
  const user = hubUserOf(request);
  if (!user || user.via !== 'google') throw new HttpError(401, 'signin', 'Sign in with your Favor Google account.');
  const { results } = await env.DB.prepare(
    `SELECT id FROM expense_requests WHERE lower(trim(requester_email)) = ? ORDER BY created_at DESC LIMIT 200`
  )
    .bind(user.email.trim().toLowerCase())
    .all<{ id: string }>();
  const out = [];
  for (const { id } of results) {
    const row = await getExpense(env, id);
    if (!row) continue;
    const shape = expenseShape(row, await itemsFor(env, row.id), { admin: true, signatures: true });
    // The timeline carries kind, actor and time only. Event payloads hold approver emails and review links.
    const events = (await listEventsFor(env, row.id))
      .filter((ev) => ['submitted', 'approved', 'declined', 'approver_reassigned'].includes(ev.kind))
      .map((ev) => ({ kind: ev.kind, actor: ev.actor, created_at: ev.created_at }));
    out.push({ ...shape, approver_email: undefined, events });
  }
  return out;
}

/** The addresses a logged email went to, or null when the event has none. */
function eventTo(payload: string | null): string[] | null {
  try {
    const to = payload ? (JSON.parse(payload) as { to?: unknown }).to : null;
    return Array.isArray(to) && to.length ? to.map(String) : null;
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (new URL(request.url).searchParams.get('mine') === '1') {
      return json({ ok: true, requests: await myRequests(env, request) });
    }
    await requireExpenseAdmin(env, request);
    // An approver signed in with Google signs waiting requests from the log.
    const user = hubUserOf(request);
    const me = user && user.via === 'google' ? user.email.toLowerCase() : '';
    // ?sigs=0: the log leaves the signature pictures out (2 MB of the answer) and fetches one from /api/expenses/signature when a row opens.
    const lite = new URL(request.url).searchParams.get('sigs') === '0';
    const [rows, settings, approvers, all] = await Promise.all([listExpenses(env, { signatures: !lite }), getSettings(env), me ? approverEmails(env) : Promise.resolve(new Set<string>()), linesAndEvents(env)]);
    const shaped = [];
    for (const row of rows) {
      const shape = expenseShape(row, all.items.get(String(row.id)) || [], { admin: true, signatures: !lite });
      const mine = Boolean(me) && (approvers.has(me) || splitEmails(row.approver_email).some((e) => e.toLowerCase() === me));
      // Event payloads can hold approver emails and decline notes. The log gets kind, actor, time and who a mail went to.
      const events = (all.events.get(String(row.id)) || []).map((ev) => {
        const to = eventTo(ev.payload);
        return { kind: ev.kind, actor: ev.actor, created_at: ev.created_at, ...(to ? { payload: JSON.stringify({ to }) } : {}) };
      });
      shaped.push({ ...shape, can_review: row.status === 'pending' && mine, events });
    }
    return json({ ok: true, requests: shaped, settings });
  } catch (err) {
    return handleError(err);
  }
};
