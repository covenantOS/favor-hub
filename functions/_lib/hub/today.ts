// What the Today page and the sidebar show the person signed in: what is waiting on them, their own
// requests, and recent activity they are allowed to see. Read from the hub's own tables only.
import { approverEmails, isExpenseAdmin } from '../expenses/auth';
import type { Env } from '../http';
import type { HubUser } from '../session';
import { workAccessFor } from '../work/gate';
import { requireWork } from '../work/gate';
import { blackbaudRepo } from '../work/repo';
import { currentBoard, type Ctx } from '../work/service';
import { effective, mayRecordClips } from '../admin/settings';
import { chatMode, mayUse } from '../chat/gate';
import { unreadMentionCount } from '../chat/db';
import { mayHear, noticesFor } from '../requests/tasks';
import { projectsFlag } from '../projects/access';
import { openActionsWithoutTask, projectCards, projectsMineCount } from '../projects/links/today'; // projects hook
import { waitingOn } from '../evals/service';

export interface Access {
  admin: boolean;
  kpi: boolean;
  approver: boolean;
  expenseLog: boolean;
  /** The Work Center page: admins until Will releases it to the Support Team (hub tables act_settings and act_staff). */
  workCenter: boolean;
  /** Every signed-in person records clips and has a clip library of their own. */
  clips: boolean;
  /** Meetings: admins until MEET_RELEASE is "staff" (or the answer an admin saved on Admin > Meetings). */
  meetings: boolean;
  /** May start a recording (Admin > Clips). Every signed-in person does until an admin narrows it. */
  clipsRecord: boolean;
  /** Favor Chat: hub admins until Admin > Chat opens it to staff (hub setting chat.enabled). */
  chat: boolean;
  /** Projects: hub admins until Admin > Projects opens it to staff (hub setting projects.enabled). */
  projects: boolean;
  /** On at least one request: its owner, sent it, named on it or following it. Shows the bell for request notices. */
  tasks: boolean;
  /** The bell in the top bar: Work Center reminders, Chat and request notices. */
  bell: boolean;
}

/** True when this person is on any request (db/request-tasks.sql). False before the tables exist. */
async function onAnyRequest(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM request_followers WHERE email = ? AND muted = 0 LIMIT 1').bind(email).first().catch(() => null);
  return !!row;
}

export async function accessOf(env: Env, request: Request, user: HubUser): Promise<Access> {
  const email = user.email.toLowerCase();
  const approver = user.via === 'google' && (await approverEmails(env)).has(email);
  const work = await workAccessFor(env, email, user.role === 'admin').catch(() => null);
  const tasks = user.role === 'admin' || (await onAnyRequest(env, email));
  return {
    admin: user.role === 'admin',
    kpi: user.kpi,
    approver,
    expenseLog: approver || (await isExpenseAdmin(env, request)),
    workCenter: !!work && work.ok,
    clips: true,
    meetings: user.role === 'admin' || (await effective(env, 'meet.release', 'MEET_RELEASE', 'admin')).toLowerCase() === 'staff',
    clipsRecord: await mayRecordClips(env, email, user.role === 'admin').catch(() => true),
    chat: mayUse(await chatMode(env), user),
    projects: await projectsFlag(env, user).catch(() => false),
    tasks,
    bell: (!!work && work.ok) || tasks,
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
  /** Support: contacts waiting to be entered in Blackbaud. */
  /** Open actions on the Work Center board in this person's scope: what its Open actions tab counts. */
  workOpen: number;
  /** Meetings running right now that this person can open. */
  meetingsNow: number;
  /** Chat: messages that mention this person, direct messages and thread replies they have not read. */
  chatMentions: number;
  /** The Requests page in the menu: the inbox for an admin, plus this person's unread request notices. */
  board: number;
  /** Evaluations: things waiting on this person (their own forms, feedback they owe, summaries to write, signatures). */
  evals: number;
  /** Request board: unread notices (sent to them, named, comments, Waiting on, done) on requests they are on. */
  tasks: number;
  /** Projects hook: tasks due today or late plus unread task notices. The Projects menu entry and the phone bar show it. */
  projectsMine: number;
}

/** The Work Center's open actions, counted from the same board its Open actions tab reads, so every badge that links there agrees with it. */
async function workOpenCount(env: Env, request: Request): Promise<number> {
  const wu = await requireWork(env, request);
  const ctx: Ctx = { env, repo: blackbaudRepo(env), actor: wu.actor, email: wu.email, scope: wu.scope, testCid: wu.testCid };
  return (await currentBoard(ctx)).rows.length;
}

export async function navCounts(env: Env, user: HubUser, access: Access, request?: Request): Promise<Counts> {
  const [inbox, exp, file, brain, notes, waiting, meetingsNow, chatMentions, tasks, projectsMine, evals] = await Promise.all([
    access.admin ? env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'inbox'").first<{ n: number }>() : null,
    access.approver ? env.DB.prepare("SELECT COUNT(*) AS n FROM expense_requests WHERE status = 'pending'").first<{ n: number }>() : null,
    openPrintFile(env),
    access.admin ? brainPending(env) : null,
    feedbackWaiting(env, user, access),
    access.workCenter && request ? workOpenCount(env, request).catch(() => 0) : 0,
    // Meetings with someone in the room now (a heartbeat in the last 20 seconds), so the count drops when the last person goes.
    access.meetings ? env.DB.prepare("SELECT COUNT(*) AS n FROM hub_meetings m WHERE m.status = 'live' AND EXISTS (SELECT 1 FROM hub_meeting_presence p WHERE p.meeting_id = m.id AND p.left_at = 0 AND p.removed = 0 AND p.waiting = 0 AND p.seen > ?)").bind(Date.now() - 20_000).first<{ n: number }>().catch(() => null) : null,
    access.chat ? unreadMentionCount(env, user.email).catch(() => 0) : 0,
    access.tasks ? mayHear(env, user.email).then((ok) => (ok ? noticesFor(env, user.email, 1).then((n) => n.count) : 0)).catch(() => 0) : 0,
    projectsMineCount(env, user), // projects hook
    waitingOn(env, { email: user.email, name: user.name, role: user.role }).then((w) => w.n).catch(() => 0),
  ]);
  return {
    inbox: Number(inbox?.n) || 0,
    expensesWaiting: Number(exp?.n) || 0,
    receiptsLeft: file && fileIsMine(file, user, access) ? Math.max(0, file.gifts - file.marked) : 0,
    brainRequests: Number(brain?.n) || 0,
    feedback: Number(notes?.n) || 0,
    workOpen: Number(waiting) || 0,
    meetingsNow: Number(meetingsNow?.n) || 0,
    chatMentions: Number(chatMentions) || 0,
    tasks: Number(tasks) || 0,
    evals: Number(evals) || 0,
    board: (Number(inbox?.n) || 0) + (Number(tasks) || 0),
    projectsMine: Number(projectsMine) || 0, // projects hook
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

const KIND_WORD: Record<string, string> = { sent: 'sent you', mention: 'mentioned you on', comment: 'commented on', waiting: 'is waiting on you for', done: 'finished', due: 'due' };
const short = (t: string, n = 60) => (t.length > n ? t.slice(0, n - 2) + '...' : t);

/**
 * The request board on Today, for a person notices can reach:
 *   Sent to you      the open requests they own
 *   Waiting on you   open requests someone marked as waiting on them
 *   Mentions         requests with a mention, comment or finish they have not opened
 * Each number is a count of requests and opens exactly those requests. A hand-off the person was never told about (made while
 * notices were off) stays off Today until someone presses Tell, so the panel and Today always agree.
 */
export async function taskCards(env: Env, emailRaw: string): Promise<Card[]> {
  const email = emailRaw.toLowerCase();
  if (!(await mayHear(env, email).catch(() => false))) return [];
  const rows =
    (
      await env.DB.prepare(
        `SELECT q.id, q.title, t.owner_email, t.waiting_on, t.due_date, COALESCE(d.name, u.name, t.sent_by, '') AS from_name
           FROM request_tasks t JOIN requests q ON q.id = t.request_id
           LEFT JOIN meet_directory d ON lower(d.email) = t.sent_by LEFT JOIN hub_users u ON lower(u.email) = t.sent_by
          WHERE (t.owner_email = ?1 OR t.waiting_on = ?1) AND q.status NOT IN ('done', 'declined')
            AND EXISTS (SELECT 1 FROM request_notices n WHERE n.request_id = t.request_id AND n.email = ?1) ORDER BY COALESCE(t.sent_at, q.updated_at) DESC`
      )
        .bind(email)
        .all<{ id: string; title: string; owner_email: string | null; waiting_on: string | null; due_date: string | null; from_name: string }>()
        .catch(() => ({ results: [] as never[] }))
    ).results || [];
  const mine = rows.filter((r) => r.owner_email === email);
  const waiting = rows.filter((r) => r.waiting_on === email);
  const cards: Card[] = [];
  const link = (list: Array<{ id: string }>, view: string) => (list.length === 1 ? `/requests/?r=${encodeURIComponent(list[0].id)}` : `/requests/?view=${view}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (mine.length) {
    const late = mine.filter((r) => r.due_date && r.due_date < today).length;
    cards.push({
      id: 'tasks',
      label: 'Sent to you',
      n: mine.length,
      what: mine.length === 1 ? 'request sent to you' : 'requests sent to you',
      note: late ? `${late} past the due date` : `${mine[0].from_name ? mine[0].from_name + ': ' : ''}${short(mine[0].title)}`,
      warn: late > 0,
      href: link(mine, 'mine'),
      cta: mine.length === 1 ? 'Open the request' : 'Open them',
    });
  }
  if (waiting.length) {
    cards.push({
      id: 'tasks-waiting',
      label: 'Waiting on you',
      n: waiting.length,
      what: waiting.length === 1 ? 'request waiting on you' : 'requests waiting on you',
      note: short(waiting[0].title),
      warn: false,
      href: link(waiting, 'onme'),
      cta: waiting.length === 1 ? 'Open the request' : 'Open them',
    });
  }
  const n = await noticesFor(env, email, 30);
  const news = n.items.filter((i) => i.kind === 'mention' || i.kind === 'comment' || i.kind === 'done');
  const ids = [...new Set(news.map((i) => i.request_id))];
  if (ids.length) {
    const top = news[0];
    const mentions = news.every((i) => i.kind === 'mention');
    cards.push({
      id: 'tasks-news',
      label: mentions ? 'Mentions' : 'Request news',
      n: ids.length,
      what: mentions ? (ids.length === 1 ? 'request that mentions you' : 'requests that mention you') : ids.length === 1 ? 'request with something new' : 'requests with something new',
      note: `${top.actor_name || 'Someone'} ${KIND_WORD[top.kind] || 'updated'} ${short(top.title, 48)}`,
      warn: false,
      href: ids.length === 1 ? `/requests/?r=${encodeURIComponent(ids[0])}` : '/requests/?view=new',
      cta: ids.length === 1 ? 'Open the request' : 'Open them',
    });
  }
  return cards;
}

/** The Sent to you card alone (the open requests this person owns). */
export async function sentToYouCard(env: Env, email: string): Promise<Card | null> {
  return (await taskCards(env, email)).find((c) => c.id === 'tasks') || null;
}

function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** Evaluation steps waiting on this person, one card. Gated like every other notice. */
export async function evalCards(env: Env, user: HubUser): Promise<Card[]> {
  if (!(await mayHear(env, user.email).catch(() => false))) return [];
  const w = await waitingOn(env, { email: user.email, name: user.name, role: user.role }).catch(() => ({ n: 0, items: [] as Array<{ text: string; href: string; due: string }> }));
  if (!w.n) return [];
  const top = w.items[0];
  const late = w.items.filter((i) => i.due && i.due < new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })).length;
  return [
    {
      id: 'evals',
      label: 'Evaluations',
      n: w.n,
      what: w.n === 1 ? 'evaluation step waiting on you' : 'evaluation steps waiting on you',
      note: late ? `${late} past the due date` : top.text,
      warn: late > 0,
      href: w.n === 1 ? top.href : '/evaluations/',
      cta: w.n === 1 ? 'Open it' : 'Open Evaluations',
    },
  ];
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
  if (access.tasks) {
    cards.push(...(await taskCards(env, user.email).catch(() => [] as Card[])));
  }
  // projects hook: tasks due, given to you and with news.
  cards.push(...(await projectCards(env, user).catch(() => [] as Card[])));
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
  if (access.meetings) {
    // projects hook: items that already became tasks are counted in the task cards, not here.
    const mine = (await openActionsWithoutTask(env, user.email)) || (await env.DB.prepare(
      `SELECT COUNT(*) AS n, (SELECT text FROM hub_meeting_actions WHERE owner_email = ?1 AND done = 0 ORDER BY meeting_id DESC, idx LIMIT 1) AS first FROM hub_meeting_actions WHERE owner_email = ?1 AND done = 0`
    ).bind(user.email.toLowerCase()).first<{ n: number; first: string | null }>().catch(() => null));
    const mn = Number(mine?.n) || 0;
    if (mn) {
      cards.push({
        id: 'meetings',
        label: 'Meetings',
        n: mn,
        what: mn === 1 ? 'action item from your meetings' : 'action items from your meetings',
        note: mine?.first ? `Next: ${mine.first.length > 80 ? mine.first.slice(0, 78) + '...' : mine.first}` : '',
        warn: false,
        href: '/meet/library/',
        cta: 'Open your items',
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
  cards.push(...(await evalCards(env, user)));
  const file = await openPrintFile(env);
  if (file && fileIsMine(file, user, access)) {
    const left = Math.max(0, file.gifts - file.marked);
    const marking = file.status === 'marking';
    cards.push({
      id: 'receipts',
      label: 'Receipts',
      n: marking ? left : file.letters,
      what: marking ? 'printed gifts not yet marked thanked' : 'receipts in the open print file',
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
