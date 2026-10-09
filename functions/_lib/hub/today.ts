// What the Today page and the sidebar show the person signed in: what is waiting on them, their own
// requests, and recent activity they are allowed to see. Read from the hub's own tables only.
import { approverEmails, isExpenseAdmin } from '../expenses/auth';
import type { Env } from '../http';
import type { HubUser } from '../session';

export interface Access {
  admin: boolean;
  kpi: boolean;
  approver: boolean;
  expenseLog: boolean;
}

export async function accessOf(env: Env, request: Request, user: HubUser): Promise<Access> {
  const email = user.email.toLowerCase();
  const approver = user.via === 'google' && (await approverEmails(env)).has(email);
  return {
    admin: user.role === 'admin',
    kpi: user.kpi,
    approver,
    expenseLog: approver || (await isExpenseAdmin(env, request)),
  };
}

export interface OpenFile {
  id: string;
  letterDate: string;
  letters: number;
  gifts: number;
  marked: number;
  status: string;
  createdBy: string;
  createdAt: string;
}

export async function openPrintFile(env: Env): Promise<OpenFile | null> {
  const row = await env.DB.prepare(
    `SELECT id, letter_date, count, gifts, marked, status, created_by, created_at FROM rcp_batches
      WHERE kind = 'new' AND status IN ('printing', 'marking') ORDER BY created_at LIMIT 1`
  ).first<{ id: string; letter_date: string; count: number; gifts: number; marked: number; status: string; created_by: string; created_at: string }>();
  if (!row) return null;
  return {
    id: row.id,
    letterDate: row.letter_date,
    letters: row.count,
    gifts: row.gifts || row.count,
    marked: row.marked || 0,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** True when the print file is this person's to finish: they made it, or they run the hub. */
function fileIsMine(file: OpenFile, user: HubUser, access: Access): boolean {
  if (access.admin) return true;
  const by = file.createdBy.trim().toLowerCase();
  const name = user.name.trim().toLowerCase();
  return Boolean(by) && (by === name || by === name.split(' ')[0]);
}

export interface Counts {
  inbox: number;
  expensesWaiting: number;
  receiptsLeft: number;
  brainRequests: number;
  /** Will: notes not yet looked at. Everyone else: answers to their notes they have not read. */
  feedback: number;
}

export async function navCounts(env: Env, user: HubUser, access: Access): Promise<Counts> {
  const [inbox, exp, file, brain, notes] = await Promise.all([
    access.admin ? env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'inbox'").first<{ n: number }>() : null,
    access.approver ? env.DB.prepare("SELECT COUNT(*) AS n FROM expense_requests WHERE status = 'pending'").first<{ n: number }>() : null,
    openPrintFile(env),
    access.admin ? brainPending(env) : null,
    feedbackWaiting(env, user, access),
  ]);
  return {
    inbox: Number(inbox?.n) || 0,
    expensesWaiting: Number(exp?.n) || 0,
    receiptsLeft: file && fileIsMine(file, user, access) ? Math.max(0, file.gifts - file.marked) : 0,
    brainRequests: Number(brain?.n) || 0,
    feedback: Number(notes?.n) || 0,
  };
}

/** Feedback notes for Will to read, or answers from him this person has not opened yet. */
async function feedbackWaiting(env: Env, user: HubUser, access: Access) {
  const q = access.admin
    ? env.DB.prepare("SELECT COUNT(*) AS n, MIN(at) AS oldest FROM brain_feedback WHERE status = 'new'")
    : env.DB.prepare('SELECT COUNT(*) AS n, MIN(at) AS oldest FROM brain_feedback WHERE email = ? AND reply IS NOT NULL AND reply_seen_at IS NULL').bind(user.email.toLowerCase());
  return q.first<{ n: number; oldest: string | null }>().catch(() => null);
}

/** Favor Brain access requests waiting for a decision (the Brain writes them to this database). */
async function brainPending(env: Env) {
  return env.DB.prepare("SELECT COUNT(*) AS n, MIN(at) AS oldest FROM brain_requests WHERE status = 'pending'")
    .first<{ n: number; oldest: string | null }>()
    .catch(() => null);
}

export interface Card {
  id: string;
  label: string;
  n: number;
  amount?: number;
  what: string;
  note: string;
  warn: boolean;
  href: string;
  cta: string;
}

export interface Mine {
  kind: 'request' | 'expense';
  title: string;
  status: string;
  at: string;
  href: string;
}

export interface Activity {
  at: string;
  app: 'Requests' | 'Expenses' | 'Receipts' | 'Foundations';
  text: string;
}

const DAY = 86400000;

function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export async function waitingCards(env: Env, user: HubUser, access: Access): Promise<Card[]> {
  const cards: Card[] = [];
  if (access.admin) {
    const inbox = await env.DB.prepare(
      "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM requests WHERE status = 'inbox'"
    ).first<{ n: number; oldest: string | null }>();
    const first = await env.DB.prepare(
      "SELECT title, submitter_name, created_at FROM requests WHERE status = 'inbox' ORDER BY created_at LIMIT 1"
    ).first<{ title: string; submitter_name: string; created_at: string }>();
    const n = Number(inbox?.n) || 0;
    if (n) {
      cards.push({
        id: 'requests',
        label: 'Requests',
        n,
        what: n === 1 ? 'request waiting for your review' : 'requests waiting for your review',
        note: first ? `Oldest: ${first.title}, from ${first.submitter_name}` : '',
        warn: false,
        href: '/requests/',
        cta: 'Review the board',
      });
    }
  }
  if (access.admin) {
    const brain = await brainPending(env);
    const n = Number(brain?.n) || 0;
    if (n) {
      const first = await env.DB.prepare("SELECT name, email, package FROM brain_requests WHERE status = 'pending' ORDER BY id LIMIT 1")
        .first<{ name: string; email: string; package: string }>()
        .catch(() => null);
      cards.push({
        id: 'brain',
        label: 'Favor Brain',
        n,
        what: n === 1 ? 'access request to decide' : 'access requests to decide',
        note: first ? `Oldest: ${first.name || first.email}, ${first.package}` : '',
        warn: false,
        href: '/brain/admin/',
        cta: 'Decide',
      });
    }
  }
  const notes = await feedbackWaiting(env, user, access);
  const nn = Number(notes?.n) || 0;
  if (nn && access.admin) {
    const first = await env.DB.prepare("SELECT name, email, source, comment FROM brain_feedback WHERE status = 'new' ORDER BY id LIMIT 1")
      .first<{ name: string; email: string; source: string; comment: string | null }>()
      .catch(() => null);
    const from = first ? first.name || first.email : '';
    const said = first?.comment ? `: "${first.comment.length > 70 ? first.comment.slice(0, 68) + '...' : first.comment}"` : '';
    cards.push({
      id: 'feedback',
      label: 'Feedback',
      n: nn,
      what: nn === 1 ? 'note from staff to read' : 'notes from staff to read',
      note: first ? `Oldest from ${from}${said}` : '',
      warn: false,
      href: '/feedback/',
      cta: 'Read them',
    });
  } else if (nn) {
    cards.push({
      id: 'feedback',
      label: 'Feedback',
      n: nn,
      what: nn === 1 ? 'answer to your feedback' : 'answers to your feedback',
      note: 'Will answered a note you sent',
      warn: false,
      href: '/feedback/',
      cta: 'Read the answer',
    });
  }
  if (access.approver) {
    const exp = await env.DB.prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS cents, MIN(submitted_at) AS oldest FROM expense_requests WHERE status = 'pending'"
    ).first<{ n: number; cents: number; oldest: string | null }>();
    const n = Number(exp?.n) || 0;
    if (n) {
      const days = exp?.oldest ? Math.floor((Date.now() - Date.parse(exp.oldest)) / DAY) : 0;
      cards.push({
        id: 'expenses',
        label: 'Expenses',
        n,
        amount: (Number(exp?.cents) || 0) / 100,
        what: n === 1 ? 'expense request waiting for your signature' : 'expense requests waiting for your signature',
        note: days >= 7 ? `The oldest has waited ${plural(days, 'day')}` : 'Sign each one from the expense log',
        warn: days >= 7,
        href: '/expenses/',
        cta: 'Open the expense log',
      });
    }
  }
  const file = await openPrintFile(env);
  if (file && fileIsMine(file, user, access)) {
    const left = Math.max(0, file.gifts - file.marked);
    const marking = file.status === 'marking';
    cards.push({
      id: 'receipts',
      label: 'Thank-you receipts',
      n: marking ? left : file.letters,
      what: marking ? 'printed gifts not yet marked thanked' : 'letters in the open print file',
      note: marking ? `Marking stopped at ${file.marked} of ${file.gifts}; opening the page finishes it` : `Made by ${file.createdBy}. Print it, then mark it thanked`,
      warn: true,
      href: '/receipts/',
      cta: marking ? 'Finish marking' : 'Open the print file',
    });
  }
  return cards;
}

export async function mineFor(env: Env, user: HubUser): Promise<Mine[]> {
  if (user.via !== 'google') return [];
  const email = user.email.toLowerCase();
  const since = new Date(Date.now() - 21 * DAY).toISOString();
  const [reqs, exps] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, status, created_at, completed_at FROM requests
        WHERE lower(submitter_email) = ? AND (status NOT IN ('done', 'declined') OR COALESCE(completed_at, created_at) > ?)
        ORDER BY created_at DESC LIMIT 8`
    )
      .bind(email, since)
      .all<{ id: string; title: string; status: string; created_at: string; completed_at: string | null }>(),
    env.DB.prepare(
      `SELECT doc_number, status, total_cents, submitted_at, decided_at FROM expense_requests
        WHERE lower(requester_email) = ? AND (status = 'pending' OR COALESCE(decided_at, submitted_at) > ?)
        ORDER BY submitted_at DESC LIMIT 6`
    )
      .bind(email, since)
      .all<{ doc_number: string; status: string; total_cents: number; submitted_at: string; decided_at: string | null }>(),
  ]);
  const status = { inbox: 'Waiting for review', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' } as Record<string, string>;
  const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    ...reqs.results.map((r) => ({ kind: 'request' as const, title: r.title, status: status[r.status] || r.status, at: r.completed_at || r.created_at, href: '/requests/' })),
    ...exps.results.map((e) => ({
      kind: 'expense' as const,
      title: `${e.doc_number}, ${money(e.total_cents)}`,
      status: e.status === 'pending' ? 'Waiting for approval' : e.status === 'approved' ? 'Approved' : 'Declined',
      at: e.decided_at || e.submitted_at,
      href: '/expenses/new',
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

export async function activityFor(env: Env, access: Access): Promise<Activity[]> {
  const since = new Date(Date.now() - 14 * DAY).toISOString();
  const out: Activity[] = [];
  const [made, done, files, contacts] = await Promise.all([
    env.DB.prepare('SELECT title, submitter_name, created_at FROM requests WHERE created_at > ? ORDER BY created_at DESC LIMIT 8')
      .bind(since)
      .all<{ title: string; submitter_name: string; created_at: string }>(),
    env.DB.prepare("SELECT title, submitter_name, completed_at FROM requests WHERE status = 'done' AND completed_at > ? ORDER BY completed_at DESC LIMIT 8")
      .bind(since)
      .all<{ title: string; submitter_name: string; completed_at: string }>(),
    env.DB.prepare("SELECT at, actor, kind, detail FROM rcp_log WHERE at > ? AND kind IN ('print_file', 'marked', 'cancel') ORDER BY at DESC LIMIT 6")
      .bind(since)
      .all<{ at: string; actor: string; kind: string; detail: string }>(),
    env.DB.prepare(
      `SELECT c.created_at, c.created_by, c.how, f.name FROM fnd_contacts c JOIN fnd_foundations f ON f.id = c.foundation_id
        WHERE c.created_at > ? AND c.created_by NOT IN ('', 'Blackbaud') ORDER BY c.created_at DESC LIMIT 6`
    )
      .bind(since)
      .all<{ created_at: string; created_by: string; how: string; name: string }>(),
  ]);
  for (const r of made.results) out.push({ at: r.created_at, app: 'Requests', text: `${r.submitter_name} asked: ${r.title}` });
  for (const r of done.results) out.push({ at: r.completed_at, app: 'Requests', text: `Done: ${r.title}` });
  for (const r of files.results) {
    const count = (r.detail.match(/^(\d[\d,]*) letters for (\d[\d,]*) gifts/) || []) as string[];
    const marked = (r.detail.match(/^(\d[\d,]*) gifts/) || []) as string[];
    const text =
      r.kind === 'print_file'
        ? `${r.actor} made a print file of ${count[1] || 'the'} letters${count[2] ? ` for ${count[2]} gifts` : ''}`
        : r.kind === 'marked'
          ? `${r.actor} marked ${marked[1] || 'the'} gifts thanked`
          : `${r.actor} threw a print file away`;
    out.push({ at: r.at, app: 'Receipts', text });
  }
  for (const r of contacts.results) out.push({ at: r.created_at, app: 'Foundations', text: `${r.created_by} logged a ${String(r.how || 'contact').toLowerCase()} with ${r.name}` });
  if (access.expenseLog) {
    const exps = await env.DB.prepare(
      `SELECT doc_number, requester_name, total_cents, status, submitted_at, decided_at, approver_name FROM expense_requests
        WHERE submitted_at > ? OR decided_at > ? ORDER BY COALESCE(decided_at, submitted_at) DESC LIMIT 8`
    )
      .bind(since, since)
      .all<{ doc_number: string; requester_name: string; total_cents: number; status: string; submitted_at: string; decided_at: string | null; approver_name: string }>();
    for (const e of exps.results) {
      const amount = '$' + (e.total_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (e.submitted_at > since) out.push({ at: e.submitted_at, app: 'Expenses', text: `${e.requester_name} sent ${e.doc_number} for ${amount}` });
      if (e.decided_at && e.decided_at > since && e.status !== 'pending') out.push({ at: e.decided_at, app: 'Expenses', text: `${e.approver_name} ${e.status} ${e.doc_number}` });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
}
