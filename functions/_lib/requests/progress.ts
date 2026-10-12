// What the person who asked sees after they send a request: where it is, who has it, when it is due and what moved last.
// The same shape feeds the done screen of Make a request and the "Your requests" card beside it, so the status is the board's own.
import type { Env } from '../http';
import { staffDirectory } from '../people';

const parseJson = (text: string | null): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const STATUS_WORD: Record<string, string> = { inbox: 'Waiting for review', approved: 'Approved', in_progress: 'In progress', done: 'Done', declined: 'Declined' };

export interface Step {
  key: 'sent' | 'approved' | 'in_progress' | 'done';
  label: string;
  at: string | null;
  state: 'done' | 'now' | 'next';
}

export interface Move {
  at: string;
  text: string;
}

export interface MyRequest {
  id: string;
  title: string;
  status: string;
  statusWord: string;
  steps: Step[];
  owner: { email: string; name: string } | null;
  due_date: string | null;
  waiting_on: { email: string; name: string } | null;
  declined_reason: string | null;
  updated_at: string;
  created_at: string;
  moves: Move[];
  href: string;
}

interface Row {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  declined_reason: string | null;
  owner_email: string | null;
  due_date: string | null;
  waiting_on: string | null;
}

/** The four stops a request passes, with the one it is at. A declined request stops after Sent. */
export function stepsOf(r: Pick<Row, 'status' | 'created_at' | 'approved_at' | 'started_at' | 'completed_at'>): Step[] {
  const at: Record<Step['key'], string | null> = { sent: r.created_at, approved: r.approved_at, in_progress: r.started_at, done: r.completed_at };
  const order: Step['key'][] = ['sent', 'approved', 'in_progress', 'done'];
  const label: Record<Step['key'], string> = { sent: 'Sent', approved: 'Approved', in_progress: 'In progress', done: 'Done' };
  const reached = r.status === 'done' ? 3 : r.status === 'in_progress' ? 2 : r.status === 'approved' ? 1 : 0;
  return order.map((key, i) => ({
    key,
    label: label[key],
    at: i <= reached ? at[key] : null,
    state: i < reached || (i === reached && r.status === 'done') ? 'done' : i === reached ? 'now' : 'next',
  }));
}

/** One history line in words, or '' for an event that says nothing to the person who asked. */
export function moveText(kind: string, actor: string, payload: unknown): string {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const who = /^agent$/i.test(actor || '') ? '' : String(actor || '').split(/\s+/)[0];
  if (kind === 'status') {
    const to = String(p.to || '');
    const word = STATUS_WORD[to] || to;
    if (to === 'declined') return `${who ? who + ' declined it' : 'Declined'}${p.declined_reason ? `: ${String(p.declined_reason)}` : ''}`;
    return who ? `${who} moved it to ${word}` : `Moved to ${word}`;
  }
  if (kind === 'sent') return `Sent to ${String(p.to_name || 'a teammate')}`;
  if (kind === 'due') return p.to ? `Due date set to ${dayWord(String(p.to))}` : 'Due date cleared';
  if (kind === 'waiting') return p.name ? `Waiting on ${String(p.name)}` : '';
  return '';
}

function dayWord(d: string): string {
  const dt = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/** The person's own requests: everything still open, and what finished in the last 21 days. */
export async function myRequests(env: Env, emailRaw: string, now = new Date()): Promise<MyRequest[]> {
  const email = lower(emailRaw);
  if (!email) return [];
  const since = new Date(now.getTime() - 21 * 86400000).toISOString();
  let rows: Row[] = [];
  const cols = 'q.id, q.title, q.status, q.created_at, q.updated_at, q.approved_at, q.started_at, q.completed_at, q.declined_reason';
  const where = `WHERE lower(q.submitter_email) = ? AND (q.status NOT IN ('done', 'declined') OR COALESCE(q.completed_at, q.updated_at) > ?) ORDER BY q.created_at DESC LIMIT 12`;
  try {
    rows = (await env.DB.prepare(`SELECT ${cols}, t.owner_email, t.due_date, t.waiting_on FROM requests q LEFT JOIN request_tasks t ON t.request_id = q.id ${where}`).bind(email, since).all<Row>()).results || [];
  } catch {
    rows = (await env.DB.prepare(`SELECT ${cols}, NULL AS owner_email, NULL AS due_date, NULL AS waiting_on FROM requests q ${where}`).bind(email, since).all<Row>()).results || [];
  }
  if (!rows.length) return [];
  const dir = new Map((await staffDirectory(env).catch(() => [])).map((p) => [p.email, p]));
  const person = (e: string | null) => (e ? { email: e, name: dir.get(e)?.name || e.split('@')[0] } : null);
  const marks = rows.map(() => '?').join(',');
  const ev = (await env.DB.prepare(`SELECT request_id, kind, actor, payload, created_at FROM events WHERE request_id IN (${marks}) AND kind IN ('status', 'sent', 'due', 'waiting') ORDER BY created_at DESC, rowid DESC`).bind(...rows.map((r) => r.id)).all<{ request_id: string; kind: string; actor: string; payload: string | null; created_at: string }>().catch(() => ({ results: [] as never[] }))).results || [];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    statusWord: STATUS_WORD[r.status] || r.status,
    steps: stepsOf(r),
    owner: person(r.owner_email),
    due_date: r.due_date,
    waiting_on: person(r.waiting_on),
    declined_reason: r.status === 'declined' ? r.declined_reason : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    moves: ev
      .filter((e) => e.request_id === r.id)
      .map((e) => ({ at: e.created_at, text: moveText(e.kind, e.actor, parseJson(e.payload)) }))
      .filter((m) => m.text)
      .slice(0, 4),
    href: `/requests/?r=${encodeURIComponent(r.id)}`,
  }));
}

