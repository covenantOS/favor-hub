import { HttpError, newId, nowIso, type Env } from '../http';

export type ExpenseStatus = 'pending' | 'approved' | 'declined';

export interface ExpenseRow {
  id: string;
  doc_number: string;
  status: ExpenseStatus;
  requester_name: string;
  requester_email: string;
  travel_dates: string | null;
  travel_city: string | null;
  reason: string;
  total_cents: number;
  approver_name: string;
  approver_email: string;
  requester_signature: string;
  approver_signature: string | null;
  review_token_hash: string;
  decline_note: string | null;
  requester_ip: string | null;
  approver_ip: string | null;
  pdf_r2_key: string | null;
  submitted_at: string;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseItemRow {
  id: string;
  request_id: string;
  position: number;
  description: string;
  item: string;
  amount_cents: number;
}

export interface ExpenseSettings {
  approver_name: string;
  approver_email: string;
  distribution: string[];
}

export interface ApproverOverrideRow {
  id: string;
  start_date: string;
  end_date: string;
  name: string;
  email: string;
  created_at: string;
}

const COLS = `id, doc_number, status, requester_name, requester_email, travel_dates, travel_city, reason, total_cents,
  approver_name, approver_email, requester_signature, approver_signature, review_token_hash, decline_note,
  requester_ip, approver_ip, pdf_r2_key, submitted_at, decided_at, created_at, updated_at`;

const FALLBACK_APPROVER = { name: 'Stephanie Maier', email: 'stephanie@favorintl.org' };

export function money(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
  return `${s} ET`;
}

export function todayEt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getSettings(env: Env): Promise<ExpenseSettings> {
  const row = await env.DB.prepare(
    'SELECT approver_name, approver_email, distribution FROM expense_settings WHERE id = 1'
  ).first<{ approver_name: string; approver_email: string; distribution: string }>();
  if (!row) {
    return { ...splitApprover(FALLBACK_APPROVER), distribution: [] };
  }
  return {
    approver_name: row.approver_name,
    approver_email: row.approver_email,
    distribution: row.distribution.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function splitApprover(a: { name: string; email: string }) {
  return { approver_name: a.name, approver_email: a.email };
}

export async function saveSettings(env: Env, next: ExpenseSettings): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO expense_settings (id, approver_name, approver_email, distribution, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET approver_name = excluded.approver_name, approver_email = excluded.approver_email,
       distribution = excluded.distribution, updated_at = excluded.updated_at`
  )
    .bind(next.approver_name, next.approver_email, next.distribution.join(','), nowIso())
    .run();
}

export async function listOverrides(env: Env): Promise<ApproverOverrideRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, start_date, end_date, name, email, created_at FROM expense_approver_overrides ORDER BY start_date ASC'
  ).all<ApproverOverrideRow>();
  return results;
}

export async function addOverride(env: Env, o: { start_date: string; end_date: string; name: string; email: string }): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO expense_approver_overrides (id, start_date, end_date, name, email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(newId('ovr'), o.start_date, o.end_date, o.name, o.email, nowIso())
    .run();
}

export async function removeOverride(env: Env, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM expense_approver_overrides WHERE id = ?').bind(id).run();
}

/** Whoever should approve today: an active dated override wins, then the default. */
export async function resolveApprover(env: Env): Promise<{ name: string; email: string }> {
  const today = todayEt();
  const override = await env.DB.prepare(
    'SELECT name, email FROM expense_approver_overrides WHERE start_date <= ? AND end_date >= ? ORDER BY created_at DESC LIMIT 1'
  )
    .bind(today, today)
    .first<{ name: string; email: string }>();
  if (override) return override;
  const settings = await getSettings(env);
  if (settings.approver_email) return { name: settings.approver_name, email: settings.approver_email };
  return FALLBACK_APPROVER;
}

export async function nextDocNumber(env: Env): Promise<string> {
  const year = Number(todayEt().slice(0, 4));
  const row = await env.DB.prepare(
    'INSERT INTO expense_counters (year, n) VALUES (?, 1) ON CONFLICT(year) DO UPDATE SET n = n + 1 RETURNING n'
  )
    .bind(year)
    .first<{ n: number }>();
  const n = row?.n ?? 1;
  return `EXP-${year}-${String(n).padStart(4, '0')}`;
}

export async function addExpenseEvent(env: Env, requestId: string, kind: string, actor: string, payload?: unknown): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO expense_events (id, request_id, kind, actor, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(newId('exe'), requestId, kind, actor, payload ? JSON.stringify(payload) : null, nowIso())
    .run();
}

export async function insertExpense(
  env: Env,
  input: {
    requester_name: string;
    requester_email: string;
    travel_dates: string;
    travel_city: string;
    reason: string;
    items: Array<{ description: string; item: string; amount_cents: number }>;
    requester_signature: string;
    requester_ip: string;
    approver: { name: string; email: string };
    review_token_hash: string;
  }
): Promise<ExpenseRow> {
  const id = newId('exp');
  const ts = nowIso();
  const doc = await nextDocNumber(env);
  const total = input.items.reduce((s, it) => s + it.amount_cents, 0);
  await env.DB.prepare(
    `INSERT INTO expense_requests (id, doc_number, status, requester_name, requester_email, travel_dates, travel_city,
       reason, total_cents, approver_name, approver_email, requester_signature, review_token_hash, requester_ip,
       submitted_at, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, doc, input.requester_name, input.requester_email, input.travel_dates || null, input.travel_city || null,
      input.reason, total, input.approver.name, input.approver.email, input.requester_signature,
      input.review_token_hash, input.requester_ip, ts, ts, ts
    )
    .run();
  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    await env.DB.prepare(
      'INSERT INTO expense_items (id, request_id, position, description, item, amount_cents) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(newId('exi'), id, i, it.description, it.item, it.amount_cents)
      .run();
  }
  const row = await getExpense(env, id);
  if (!row) throw new HttpError(500, 'insert_failed', 'Could not save the expense request');
  return row;
}

export async function getExpense(env: Env, id: string): Promise<ExpenseRow | null> {
  return env.DB.prepare(`SELECT ${COLS} FROM expense_requests WHERE id = ?`).bind(id).first<ExpenseRow>();
}

export async function getExpenseByTokenHash(env: Env, hash: string): Promise<ExpenseRow | null> {
  return env.DB.prepare(`SELECT ${COLS} FROM expense_requests WHERE review_token_hash = ?`).bind(hash).first<ExpenseRow>();
}

export async function listExpenses(env: Env): Promise<ExpenseRow[]> {
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM expense_requests ORDER BY created_at DESC`).all<ExpenseRow>();
  return results;
}

export async function itemsFor(env: Env, requestId: string): Promise<ExpenseItemRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, request_id, position, description, item, amount_cents FROM expense_items WHERE request_id = ? ORDER BY position ASC'
  )
    .bind(requestId)
    .all<ExpenseItemRow>();
  return results;
}

export async function markDecided(
  env: Env,
  id: string,
  decision: {
    status: 'approved' | 'declined';
    approver_signature?: string;
    decline_note?: string;
    approver_ip: string;
    pdf_r2_key?: string;
  }
): Promise<ExpenseRow> {
  const ts = nowIso();
  await env.DB.prepare(
    `UPDATE expense_requests SET status = ?, approver_signature = ?, decline_note = ?, approver_ip = ?,
       pdf_r2_key = ?, decided_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      decision.status, decision.approver_signature || null, decision.decline_note || null,
      decision.approver_ip, decision.pdf_r2_key || null, ts, ts, id
    )
    .run();
  const row = await getExpense(env, id);
  if (!row) throw new HttpError(500, 'update_failed', 'Could not update the expense request');
  return row;
}

/** Shape sent to the review page and admin list. Token hash and IPs stay server-side. */
export function expenseShape(row: ExpenseRow, items: ExpenseItemRow[], opts: { signatures?: boolean; admin?: boolean } = {}) {
  return {
    id: row.id,
    doc_number: row.doc_number,
    status: row.status,
    requester_name: row.requester_name,
    requester_email: row.requester_email,
    travel_dates: row.travel_dates,
    travel_city: row.travel_city,
    reason: row.reason,
    total_cents: row.total_cents,
    approver_name: row.approver_name,
    approver_email: row.approver_email,
    decline_note: row.decline_note,
    submitted_at: row.submitted_at,
    decided_at: row.decided_at,
    requester_signature: opts.signatures ? row.requester_signature : undefined,
    pdf: opts.admin && row.pdf_r2_key ? `/api/expenses/${row.id}/pdf` : undefined,
    items: items.map((it) => ({ description: it.description, item: it.item, amount_cents: it.amount_cents })),
  };
}

export function isSignatureDataUrl(s: unknown): s is string {
  return typeof s === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= 400_000;
}
