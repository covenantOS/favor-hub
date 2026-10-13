import { approverEmails } from '../../_lib/expenses/auth';
import { accessOf, activityFor, expensesWaitingFor, mineFor, navCounts } from '../../_lib/hub/today';
import { openActionsWithoutTask } from '../../_lib/projects/links/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf, type HubUser } from '../../_lib/session';
import { mayHear } from '../../_lib/requests/tasks';
import { blackbaudRepo } from '../../_lib/work/repo';
import { requireWork } from '../../_lib/work/gate';
import { workHome } from '../../_lib/work/home';
import type { Ctx } from '../../_lib/work/service';

// The Work Overview page: one answer with the person's tools, what is due, gifts to thank, requests, their week, recent activity and,
// for admins, the team. Work Center parts come back null for people the Work Center is not open to.
const DAY = 86400000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);

interface Waiting {
  kind: 'request' | 'expense' | 'meeting';
  title: string;
  sub: string;
  at: string;
  href: string;
}

async function waitingFor(env: Env, email: string, admin: boolean, approver: boolean) {
  const out: Waiting[] = [];
  const totals = { requests: 0, expenses: 0, meetings: 0, tasks: 0 };
  const jobs: Promise<unknown>[] = [];
  if (admin) {
    jobs.push(
      (async () => {
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'inbox'").first<{ n: number }>();
        totals.requests = Number(n?.n) || 0;
        const r = await env.DB.prepare("SELECT title, submitter_name, created_at FROM requests WHERE status = 'inbox' ORDER BY created_at LIMIT 4").all<{ title: string; submitter_name: string; created_at: string }>();
        for (const x of r.results) out.push({ kind: 'request', title: clip(x.title, 80), sub: `From ${x.submitter_name}`, at: x.created_at, href: '/requests/' });
      })()
    );
  }
  if (approver) {
    jobs.push(
      (async () => {
        totals.expenses = (await expensesWaitingFor(env, email)).n;
        const r = await env.DB.prepare("SELECT doc_number, requester_name, total_cents, submitted_at, approver_email FROM expense_requests WHERE status = 'pending' ORDER BY submitted_at").all<{ doc_number: string; requester_name: string; total_cents: number; submitted_at: string; approver_email: string }>();
        const memo = new Map<string, boolean>();
        for (const x of r.results) if (!memo.has(x.approver_email)) memo.set(x.approver_email, (await approverEmails(env, x.approver_email).catch(() => new Set<string>())).has(email));
        r.results = r.results.filter((x) => memo.get(x.approver_email)).slice(0, 4);
        for (const x of r.results) out.push({ kind: 'expense', title: `${x.doc_number}, $${(x.total_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: `From ${x.requester_name}`, at: x.submitted_at, href: '/expenses/' });
      })()
    );
  }
  // Requests sent to this person, or waiting on them (db/request-tasks.sql; nothing before it is applied).
  jobs.push(
    (async () => {
      // Nothing shows until request notices reach this person (the same gate as Today and the bell).
      if (!(await mayHear(env, email).catch(() => false))) return;
      const r = await env.DB.prepare(
        `SELECT q.id, q.title, t.owner_email, t.waiting_on, t.sent_by, t.sent_at, q.created_at, COALESCE(d.name, u.name, t.sent_by) AS from_name
           FROM request_tasks t JOIN requests q ON q.id = t.request_id
           LEFT JOIN meet_directory d ON lower(d.email) = t.sent_by LEFT JOIN hub_users u ON lower(u.email) = t.sent_by
          WHERE (t.owner_email = ?1 OR t.waiting_on = ?1) AND q.status NOT IN ('done', 'declined') AND EXISTS (SELECT 1 FROM request_notices n WHERE n.request_id = t.request_id AND n.email = ?1) ORDER BY COALESCE(t.sent_at, q.created_at) LIMIT 500`
      ).bind(email).all<{ id: string; title: string; owner_email: string | null; waiting_on: string | null; sent_by: string | null; sent_at: string | null; created_at: string; from_name: string | null }>().catch(() => ({ results: [] as never[] }));
      // The chip reads "sent to you" and opens the Mine filter, so it counts the requests this person owns (Today's Sent to you card), not the ones they wait on.
      totals.tasks = r.results.filter((x) => x.owner_email === email).length;
      for (const x of r.results.slice(0, 4)) {
        const sub = x.waiting_on === email && x.owner_email !== email ? 'Waiting on you' : x.from_name ? `From ${x.from_name}` : 'Yours';
        out.push({ kind: 'request', title: clip(x.title, 80), sub, at: x.sent_at || x.created_at, href: `/requests/?r=${encodeURIComponent(x.id)}` });
      }
    })()
  );
  jobs.push(
    (async () => {
      // Items that already became tasks are counted with Projects, so this is the number on Today's Meetings card and the Notes page list.
      const n = await openActionsWithoutTask(env, email);
      totals.meetings = Number(n?.n) || 0;
      const r = await env.DB.prepare(
        `SELECT a.text, a.due, m.title, m.starts_at AS started_at FROM hub_meeting_actions a JOIN hub_meetings m ON m.id = a.meeting_id WHERE a.owner_email = ? AND a.done = 0
          AND NOT EXISTS (SELECT 1 FROM hub_tasks t WHERE t.meeting_id = a.meeting_id AND t.meeting_action_idx = a.idx AND t.status <> 'dropped') ORDER BY a.meeting_id DESC, a.idx LIMIT 4`
      ).bind(email).all<{ text: string; due: string; title: string; started_at: string }>().catch(() => ({ results: [] as { text: string; due: string; title: string; started_at: string }[] }));
      for (const x of r.results) out.push({ kind: 'meeting', title: clip(x.text, 80), sub: x.title ? `From ${clip(x.title, 40)}` : 'From a meeting', at: x.started_at || '', href: '/meet/library/' });
    })()
  );
  await Promise.all(jobs);
  return { rows: out.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 8), totals };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    // A role test by the agent key sees the page as that person does.
    const actAs = user.via === 'agent' ? (request.headers.get('X-Act-As') || '').trim().toLowerCase() : '';
    const email = (actAs || user.email).toLowerCase();
    const admin = user.role === 'admin' && !actAs;
    const me: HubUser = actAs ? { ...user, email, name: actAs, role: 'staff', via: 'google', kpi: false } : user;

    // Only the Work Center part (the slow one) is kept for a moment. Every count, the request and meeting numbers and the activity are read live, so this page
    // never shows a number the menu and Today have already moved past.
    const cacheKey = `home:${email}`;
    let cached: { name?: string; work?: Awaited<ReturnType<typeof workHome>> | null } | null = null;
    if (new URL(request.url).searchParams.get('fresh') !== '1') {
      const hit = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(cacheKey).first<{ value: string; at: string }>().catch(() => null);
      if (hit && Date.now() - Date.parse(hit.at) < 30000) {
        try {
          cached = JSON.parse(hit.value);
        } catch {
          cached = null;
        }
      }
    }

    const access = await accessOf(env, request, me).catch(() => null);
    let name = cached && cached.name ? cached.name : me.name;
    const workP: Promise<Awaited<ReturnType<typeof workHome>> | null> =
      cached && 'work' in cached
        ? Promise.resolve(cached.work ?? null)
        : access && access.workCenter
          ? requireWork(env, request)
              .then((wu) => {
                const ctx: Ctx = { env, repo: blackbaudRepo(env), actor: wu.actor, email: wu.email, scope: wu.scope, testCid: wu.testCid };
                name = wu.scope && wu.scope.name ? wu.scope.name : name;
                return workHome(ctx);
              })
              .catch((err) => {
                console.error('[work-home]', err);
                return null;
              })
          : Promise.resolve(null);
    const approverP = me.via === 'google' ? approverEmails(env).then((s) => s.has(email)).catch(() => false) : Promise.resolve(false);
    const [work, counts, waiting, mine, activity] = await Promise.all([
      workP,
      access ? navCounts(env, me, access, request).catch(() => null) : null,
      approverP.then((approver) => waitingFor(env, email, admin, approver)).catch(() => ({ rows: [], totals: { requests: 0, expenses: 0, meetings: 0, tasks: 0 } })),
      mineFor(env, me).catch(() => []),
      access ? activityFor(env, access).catch(() => []) : [],
    ]);
    const since = ago(7);
    const at = new Date().toISOString();
    const body = JSON.stringify({
      ok: true,
      at,
      name,
      email,
      access,
      counts,
      waiting,
      mine: mine.filter((m) => (m.kind === 'request' ? m.status !== 'Done' && m.status !== 'Declined' : m.status === 'Waiting for approval')).slice(0, 6),
      activity: activity.filter((a) => a.at > since).slice(0, 8),
      work,
    });
    if (!cached) {
      waitUntil(
        env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
          .bind(cacheKey, JSON.stringify({ name, work }), at)
          .run()
          .then(() => undefined, () => undefined)
      );
    }
    return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleError(err);
  }
};
