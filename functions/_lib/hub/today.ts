// What the Today page and the sidebar show the person signed in: what is waiting on them, their own
// requests, and recent activity they are allowed to see. Read from the hub's own tables only.
import { isHr } from '../people-dev';
import { REAL_NOTE_SQL } from './feedback-notes';
import { approverEmails, isExpenseAdmin } from '../expenses/auth';
import type { Env } from '../http';
import type { HubUser } from '../session';
import { workAccessFor } from '../work/gate';
import { requireWork } from '../work/gate';
import { blackbaudRepo } from '../work/repo';
import { currentBoard, type Ctx } from '../work/service';
import { badgeRows, ownerIds } from '../work/mine';
import { giftsResponse, mayGifts } from '../work/gifts-svc';
import { effective, mayRecordClips } from '../admin/settings';
import { chatMode, mayUse } from '../chat/gate';
import { groupMembers } from '../access';
import { unreadMentionCount } from '../chat/db';
import { mayHear, noticesFor } from '../requests/tasks';
// learn: begin
import { learnAccess, learnCards, learnCount } from '../learn/today';
// learn: end
import { projectsFlag } from '../projects/access';
import { openActionsWithoutTask, projectCards, projectsMineCount } from '../projects/links/today'; // projects hook
import { waitingOn } from '../evals/service';
import { mailMode, mailUnreadCount, mayUseMail } from '../mail/route';
import { mayOpen as mayOpenGiftEntry } from '../gifts/perm';
import { mayUseOther } from '../other-gifts/access';

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
  /** Learn: open to this person (hub setting learn.enabled), and authoring (a hub admin or a person marked HR). */
  learn: boolean;
  learnAdmin: boolean;
  /** People tools (Onboarding, and the other people areas): hub admins and people an admin marked HR in Admin > People. */
  hr: boolean;
  /** Gift entry from a photo: admins, and the people an admin gave access (the admin desk and Partner Care). */
  giftEntry: boolean;
  /** Other gifts (DAF, foundation, wire, stock and phone gifts in a batch a second person approves): off for staff until Will turns on hub setting gifts.other. */
  otherGifts: boolean;
  /** Mail in FavorOS (the person's own Gmail): hub admins until Admin > Chat > Mail opens it to staff (hub setting mail.enabled). */
  mail: boolean;
}

/** True when this person is on any request (db/request-tasks.sql). False before the tables exist. */
async function onAnyRequest(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM request_followers WHERE email = ? AND muted = 0 LIMIT 1').bind(email).first().catch(() => null);
  return !!row;
}

export async function accessOf(env: Env, request: Request, user: HubUser): Promise<Access> {
  const email = user.email.toLowerCase();
  const admin = user.role === 'admin';
  // Every check reads on its own, all at once: the menu and the bell call this on every page, and one after another it was about a dozen
  // D1 round trips before either could start its own reads.
  const [approverSet, work, anyRequest, learn, expenseAdmin, meetRelease, clipsRecord, chatM, projects, hr, giftEntry, mailM, otherGifts] = await Promise.all([
    user.via === 'google' ? approverEmails(env) : Promise.resolve(new Set<string>()),
    workAccessFor(env, email, admin).catch(() => null),
    admin ? Promise.resolve(true) : onAnyRequest(env, email),
    learnAccess(env, user),
    isExpenseAdmin(env, request),
    admin ? Promise.resolve('staff') : effective(env, 'meet.release', 'MEET_RELEASE', 'admin'),
    mayRecordClips(env, email, admin).catch(() => true),
    chatMode(env),
    projectsFlag(env, user).catch(() => false),
    admin ? Promise.resolve(true) : isHr(env, email),
    mayOpenGiftEntry(env, user),
    mailMode(env),
    mayUseOther(env, user).catch(() => false),
  ]);
  // The access groups (functions/_lib/access.ts): read only when a feature is in group mode.
  const [chatMembers, mailMembers] = await Promise.all([chatM === 'group' ? groupMembers(env, 'chat') : null, mailM === 'group' ? groupMembers(env, 'mail') : null]);
  const approver = user.via === 'google' && approverSet.has(email);
  return {
    admin,
    kpi: user.kpi,
    approver,
    expenseLog: approver || expenseAdmin,
    workCenter: !!work && work.ok,
    clips: true,
    meetings: admin || String(meetRelease).toLowerCase() === 'staff',
    clipsRecord,
    chat: mayUse(chatM, user, chatMembers),
    projects,
    tasks: anyRequest,
    bell: true,
    learn: learn.learn,
    learnAdmin: learn.learnAdmin,
    hr,
    giftEntry,
    otherGifts,
    mail: mayUseMail(mailM, user, mailMembers),
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

/** True when the print file is this person's to finish: the person who made it. An admin who did not make it is not asked to print it. */
function fileIsMine(file: OpenFile, user: HubUser, _access: Access): boolean {
  const by = file.createdBy.trim().toLowerCase();
  const name = user.name.trim().toLowerCase();
  return Boolean(by) && Boolean(name) && (by === name || by === name.split(' ')[0]);
}

/** The number on the Receipts menu entry and on Today's Receipts card: gifts left to mark once marking started, otherwise receipts in the file. */
export function receiptsFigure(file: OpenFile): number {
  return file.status === 'marking' ? Math.max(0, file.gifts - file.marked) : file.letters;
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
  /** Learn: courses and paths assigned to this person and not finished. */
  learn: number;
  /** Projects hook: tasks due today or late plus unread task notices. The Projects menu entry and the phone bar show it. */
  projectsMine: number;
  /** Mail: unread conversations in the person's Gmail inbox (0 until they connect Google). */
  mailUnread: number;
}

/**
 * The Work badge: the open actions assigned to this person plus the gifts owed a thank-you on their own partners (mine.ts has the rule).
 * An admin who holds no book of their own sees 0; the Work Center's Everyone filter still lists the whole board for them.
 */
async function workOpenCount(env: Env, request: Request): Promise<number> {
  const wu = await requireWork(env, request);
  const ctx: Ctx = { env, repo: blackbaudRepo(env), actor: wu.actor, email: wu.email, scope: wu.scope, testCid: wu.testCid };
  const sc = ctx.scope;
  if (!sc || (!sc.fid && sc.role !== 'support' && sc.role !== 'partner_care')) return 0;
  const board = await currentBoard(ctx);
  const mine = badgeRows(sc, board.rows).length;
  const owed = mayGifts(sc) && ownerIds(sc).size ? Number((await giftsResponse(ctx, '', { mine: true }).catch(() => null))?.stats?.owed) || 0 : 0;
  return mine + owed;
}

/** Pending expense requests that name this person as an approver (or a substitute whose dates cover today), with their total and the oldest. */
export async function expensesWaitingFor(env: Env, email: string): Promise<{ n: number; cents: number; oldest: string | null }> {
  const me = email.toLowerCase();
  const rows = (await env.DB.prepare("SELECT approver_email, total_cents, submitted_at FROM expense_requests WHERE status = 'pending'").all<{ approver_email: string; total_cents: number; submitted_at: string }>().catch(() => ({ results: [] as { approver_email: string; total_cents: number; submitted_at: string }[] }))).results || [];
  const memo = new Map<string, boolean>();
  let n = 0;
  let cents = 0;
  let oldest: string | null = null;
  for (const r of rows) {
    const k = r.approver_email || '';
    if (!memo.has(k)) memo.set(k, (await approverEmails(env, k).catch(() => new Set<string>())).has(me));
    if (!memo.get(k)) continue;
    n++;
    cents += Number(r.total_cents) || 0;
    if (!oldest || r.submitted_at < oldest) oldest = r.submitted_at;
  }
  return { n, cents, oldest };
}

export async function navCounts(env: Env, user: HubUser, access: Access, request?: Request): Promise<Counts> {
  // Each count is named, so a count can never land under the wrong badge (the list was positional once, and Evaluations read the Projects number).
  const jobs = {
    inbox: access.admin ? env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'inbox'").first<{ n: number }>() : null,
    exp: access.approver ? expensesWaitingFor(env, user.email) : null,
    file: openPrintFile(env),
    brain: access.admin ? brainPending(env) : null,
    notes: feedbackWaiting(env, user, access),
    workOpen: access.workCenter && request ? workOpenCount(env, request).catch(() => 0) : 0,
    // Meetings with someone in the room now (a heartbeat in the last 20 seconds) that this person can open, so the count drops when the last person goes.
    meetingsNow: access.meetings ? liveMeetingsFor(env, user.email).catch(() => 0) : 0,
    chatMentions: access.chat ? unreadMentionCount(env, user.email).catch(() => 0) : 0,
    tasks: access.tasks ? mayHear(env, user.email).then((ok) => (ok ? unreadRequestCount(env, user.email, access.admin) : 0)).catch(() => 0) : 0,
    learn: learnCount(env, user, access).catch(() => 0),
    projectsMine: projectsMineCount(env, user), // projects hook
    evals: evalWaitingCount(env, user),
    // Gmail answers in about 150 ms; a slow answer never holds the menu back (the badge waits for the next page).
    mailUnread: access.mail ? Promise.race([mailUnreadCount(env, user.email).catch(() => 0), new Promise<number>((r) => setTimeout(() => r(0), 1200))]) : 0,
  };
  const keys = Object.keys(jobs) as Array<keyof typeof jobs>;
  const got = await Promise.all(Object.values(jobs));
  const r = Object.fromEntries(keys.map((k, i) => [k, got[i]])) as Record<keyof typeof jobs, any>;
  const tasks = Number(r.tasks) || 0;
  return {
    inbox: Number(r.inbox?.n) || 0,
    expensesWaiting: Number(r.exp?.n) || 0,
    receiptsLeft: r.file && fileIsMine(r.file, user, access) ? receiptsFigure(r.file) : 0,
    brainRequests: Number(r.brain?.n) || 0,
    feedback: Number(r.notes?.n) || 0,
    workOpen: Number(r.workOpen) || 0,
    meetingsNow: Number(r.meetingsNow) || 0,
    chatMentions: Number(r.chatMentions) || 0,
    tasks,
    learn: Number(r.learn) || 0,
    evals: Number(r.evals) || 0,
    board: (Number(r.inbox?.n) || 0) + tasks,
    projectsMine: Number(r.projectsMine) || 0, // projects hook
    mailUnread: Number(r.mailUnread) || 0,
  };
}

/** Meetings in progress with someone in the room that this person hosts, co-hosts or is invited to. A room open to all staff is on the Meetings page but is not counted for everyone. */
export async function liveMeetingsFor(env: Env, email: string): Promise<number> {
  const me = email.toLowerCase();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM hub_meetings m WHERE m.status = 'live'
        AND (lower(m.host_email) = ?1 OR instr(lower(m.invitees), '"' || ?1 || '"') > 0 OR instr(lower(m.cohosts), '"' || ?1 || '"') > 0)
        AND EXISTS (SELECT 1 FROM hub_meeting_presence p WHERE p.meeting_id = m.id AND p.left_at = 0 AND p.removed = 0 AND p.waiting = 0 AND p.seen > ?2)`
  ).bind(me, Date.now() - 20_000).first<{ n: number }>();
  return Number(row?.n) || 0;
}

/**
 * Requests this person has unread notices on: the number the board's New filter shows. A request is counted once however many notices it has,
 * and one the person cannot see on the board (declined, for anyone but an admin) is left out.
 */
export async function unreadRequestCount(env: Env, email: string, admin: boolean): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT n.request_id) AS n FROM request_notices n JOIN requests q ON q.id = n.request_id WHERE n.email = ? AND n.read_at IS NULL${admin ? '' : " AND q.status != 'declined'"}`
  ).bind(email.toLowerCase()).first<{ n: number }>();
  return Number(row?.n) || 0;
}

/** Evaluation steps waiting on this person: the Evaluations menu number and Today's Evaluations card, one rule, gated like every request notice. */
export async function evalWaitingCount(env: Env, user: HubUser): Promise<number> {
  if (!(await mayHear(env, user.email).catch(() => false))) return 0;
  return (await waitingOn(env, { email: user.email, name: user.name, role: user.role }).catch(() => ({ n: 0 }))).n;
}

/** Feedback notes for Will to read, or answers from him this person has not opened yet. */
async function feedbackWaiting(env: Env, user: HubUser, access: Access) {
  const q = access.admin
    ? env.DB.prepare(`SELECT COUNT(*) AS n, MIN(at) AS oldest FROM brain_feedback WHERE status = 'new' AND ${REAL_NOTE_SQL}`)
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
  /** Where the row opens inside FavorOS. */
  href: string;
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

// Each section reads on its own, all at once (they were read one after another, about 15 D1 round trips in a row on every page's bell
// and on Today). The cards keep their order, and a section that fails drops only its own card.
export async function waitingCards(env: Env, user: HubUser, access: Access): Promise<Card[]> {
  const section = (fn: (cards: Card[]) => Promise<void>): Promise<Card[]> => {
    const cards: Card[] = [];
    return fn(cards).then(() => cards, (err) => { console.error('[today] card', err); return cards.length ? cards : []; });
  };
  const parts = await Promise.all([
  // Requests waiting for review are the Projects "projects-intake" card now (projects/links/today.ts), for everyone who triages a team.
  access.tasks ? taskCards(env, user.email).catch(() => [] as Card[]) : Promise.resolve([] as Card[]),
  // learn: begin
  learnCards(env, user, access).catch(() => [] as Card[]),
  // learn: end
  // projects hook: tasks due, given to you and with news.
  projectCards(env, user).catch(() => [] as Card[]),
  section(async (cards) => { if (access.admin) {
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
  } }),
  section(async (cards) => { if (access.meetings) {
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
  } }),
  section(async (cards) => {
  const notes = await feedbackWaiting(env, user, access);
  const nn = Number(notes?.n) || 0;
  if (nn && access.admin) {
    const first = await env.DB.prepare(`SELECT id, name, email, source, comment FROM brain_feedback WHERE status = 'new' AND ${REAL_NOTE_SQL} ORDER BY id LIMIT 1`)
      .first<{ id: number; name: string; email: string; source: string; comment: string | null }>()
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
      href: first ? `/feedback/?item=${first.id}` : '/feedback/',
      cta: 'Read them',
    });
  } else if (nn) {
    const mineFb = await env.DB.prepare('SELECT id FROM brain_feedback WHERE email = ? AND reply IS NOT NULL AND reply_seen_at IS NULL ORDER BY id LIMIT 1').bind(user.email.toLowerCase()).first<{ id: number }>().catch(() => null);
    cards.push({
      id: 'feedback',
      label: 'Feedback',
      n: nn,
      what: nn === 1 ? 'answer to your feedback' : 'answers to your feedback',
      note: 'Will answered a note you sent',
      warn: false,
      href: mineFb ? `/feedback/?item=${mineFb.id}` : '/feedback/',
      cta: 'Read the answer',
    });
  }
  }),
  section(async (cards) => { if (access.approver) {
    const exp = await expensesWaitingFor(env, user.email);
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
  } }),
  evalCards(env, user).catch((err) => { console.error('[today] evals', err); return [] as Card[]; }),
  section(async (cards) => {
  const file = await openPrintFile(env);
  if (file && fileIsMine(file, user, access)) {
    const left = Math.max(0, file.gifts - file.marked);
    const marking = file.status === 'marking';
    cards.push({
      id: 'receipts',
      label: 'Receipts',
      n: receiptsFigure(file),
      what: marking ? 'printed gifts not yet marked thanked' : 'receipts in the open print file',
      note: marking ? `Marking stopped at ${file.marked} of ${file.gifts}; opening the page finishes it` : `Made by ${file.createdBy}. Print it, then mark it thanked`,
      warn: true,
      href: '/receipts/',
      cta: marking ? 'Finish marking' : 'Open the print file',
    });
  }
  }),
  ]);
  return parts.flat();
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
    ...reqs.results.map((r) => ({ kind: 'request' as const, title: r.title, status: status[r.status] || r.status, at: r.completed_at || r.created_at, href: `/requests/?r=${encodeURIComponent(r.id)}` })),
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
    // Declined requests are hidden from non-admins on the board, so the feed leaves them out too.
    env.DB.prepare(`SELECT id, title, submitter_name, created_at FROM requests WHERE created_at > ?${access.admin ? '' : " AND status != 'declined'"} ORDER BY created_at DESC LIMIT 8`)
      .bind(since)
      .all<{ id: string; title: string; submitter_name: string; created_at: string }>(),
    env.DB.prepare("SELECT id, title, submitter_name, completed_at FROM requests WHERE status = 'done' AND completed_at > ? ORDER BY completed_at DESC LIMIT 8")
      .bind(since)
      .all<{ id: string; title: string; submitter_name: string; completed_at: string }>(),
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
  for (const r of made.results) out.push({ at: r.created_at, app: 'Requests', text: `${r.submitter_name} asked: ${r.title}`, href: `/requests/?r=${encodeURIComponent(r.id)}` });
  for (const r of done.results) out.push({ at: r.completed_at, app: 'Requests', text: `Done: ${r.title}`, href: `/requests/?r=${encodeURIComponent(r.id)}` });
  for (const r of files.results) {
    const count = (r.detail.match(/^(\d[\d,]*) (?:receipts|letters) for (\d[\d,]*) gifts/) || []) as string[];
    const marked = (r.detail.match(/^(\d[\d,]*) gifts/) || []) as string[];
    const text =
      r.kind === 'print_file'
        ? `${r.actor} made a print file of ${count[1] || 'the'} receipts${count[2] ? ` for ${count[2]} gifts` : ''}`
        : r.kind === 'marked'
          ? `${r.actor} marked ${marked[1] || 'the'} gifts thanked`
          : `${r.actor} threw a print file away`;
    out.push({ at: r.at, app: 'Receipts', text, href: '/receipts/' });
  }
  for (const r of contacts.results) out.push({ at: r.created_at, app: 'Foundations', text: `${r.created_by} logged a ${String(r.how || 'contact').toLowerCase()} with ${r.name}`, href: '/foundations/' });
  if (access.expenseLog) {
    const exps = await env.DB.prepare(
      `SELECT doc_number, requester_name, total_cents, status, submitted_at, decided_at, approver_name FROM expense_requests
        WHERE submitted_at > ? OR decided_at > ? ORDER BY COALESCE(decided_at, submitted_at) DESC LIMIT 8`
    )
      .bind(since, since)
      .all<{ doc_number: string; requester_name: string; total_cents: number; status: string; submitted_at: string; decided_at: string | null; approver_name: string }>();
    for (const e of exps.results) {
      const amount = '$' + (e.total_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (e.submitted_at > since) out.push({ at: e.submitted_at, app: 'Expenses', text: `${e.requester_name} sent ${e.doc_number} for ${amount}`, href: '/expenses/' });
      if (e.decided_at && e.decided_at > since && e.status !== 'pending') out.push({ at: e.decided_at, app: 'Expenses', text: `${e.approver_name} ${e.status} ${e.doc_number}`, href: '/expenses/' });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
}
