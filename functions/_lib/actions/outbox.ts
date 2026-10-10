// The outbox: every Blackbaud change is saved first, then sent, then verified. Pure helpers for its states and for the one
// thing Blackbaud cannot do for us, idempotency. A PATCH is safe to send twice. A create never is, because Blackbaud has no
// idempotency keys, so a lost answer triggers a read of the partner's actions and a match before any second POST.

export type OutboxState = 'queued' | 'sent' | 'verified' | 'failed' | 'needs_human' | 'undone';
export type Verdict = 'sent' | 'wait' | 'refused' | 'failed' | 'gone';

export interface CallResult {
  ok: boolean;
  status: number;
  body: any;
  refused?: string;
  wait?: string;
}

/** What one answer from the upkeep route means for its outbox row. */
export function verdictOf(r: CallResult | undefined): Verdict {
  if (!r) return 'wait'; // the route stopped before this call, so it did not run
  if (r.wait) return 'wait';
  if (r.refused) return 'refused';
  if (r.ok) return 'sent';
  if (r.status === 404) return 'gone';
  if (r.status === 429 || r.status >= 500) return 'wait';
  return 'failed';
}

/** A plain sentence for a staff member about why a call did not go through. */
export function sayWhy(r: CallResult | undefined): string {
  if (!r) return 'Blackbaud did not answer. It will try again.';
  if (r.wait) return r.wait;
  if (r.refused) return 'The Blackbaud connection does not allow this change yet.';
  if (r.status === 404) return 'Blackbaud no longer has this action.';
  const b = r.body;
  const detail = !b ? '' : typeof b === 'string' ? b : Array.isArray(b) && b[0] ? String(b[0].message || b[0].error_name || '') : String(b.message || b.title || b.error || '');
  return detail ? `Blackbaud turned it down: ${detail.slice(0, 160)}` : 'Blackbaud turned it down.';
}

/** The next state after a call, and whether the attempt count passes the two-tries line. */
export function advance(attempts: number, v: Verdict): { state: OutboxState; attempts: number } {
  const n = attempts + 1;
  if (v === 'sent') return { state: 'sent', attempts: n };
  if (v === 'gone') return { state: 'needs_human', attempts: n };
  if (v === 'wait') return { state: 'queued', attempts };
  if (v === 'refused') return { state: 'queued', attempts };
  return { state: n >= 2 ? 'needs_human' : 'failed', attempts: n };
}

/** Hash of what makes two creates the same create. Stored under a unique index so a double click never posts twice. */
export async function idemKey(parts: (string | number | null | undefined)[]): Promise<string> {
  const data = new TextEncoder().encode(parts.map((p) => String(p ?? '').trim().toLowerCase()).join('|'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export interface ExistingAction {
  id: string;
  type?: string | null;
  date?: string | null;
  summary?: string | null;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** After a create whose answer was lost: did it land? Matches the partner's actions on type, date and summary. */
export function findLostCreate(existing: ExistingAction[], want: { type: string; date: string; summary: string }, skipIds: string[] = []): string | null {
  const skip = new Set(skipIds);
  const hit = existing.find(
    (a) => !skip.has(String(a.id)) && norm(a.type) === norm(want.type) && String(a.date ?? '').slice(0, 10) === want.date.slice(0, 10) && norm(a.summary) === norm(want.summary)
  );
  return hit ? String(hit.id) : null;
}

/** Path and method for an outbox row. The payload holds only the body. */
export function requestFor(row: { op: string; action_id: string | null }, bbIdForParent?: string | null): { method: string; path: string } {
  if (row.op === 'create') return { method: 'POST', path: '/constituent/v1/actions' };
  if (row.op === 'tag') return { method: 'POST', path: '/constituent/v1/actions/customfields' };
  if (row.op === 'delete') return { method: 'DELETE', path: `/constituent/v1/actions/${row.action_id}` };
  return { method: 'PATCH', path: `/constituent/v1/actions/${row.action_id ?? bbIdForParent}` };
}
