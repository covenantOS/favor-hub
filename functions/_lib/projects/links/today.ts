// Projects on Today, the bell, the menu badge and the search palette. All reads; nothing here writes except marking notices read
// through the Projects routes. A person with no Projects access sees none of it.
import type { Env } from '../../http';
import type { HubUser } from '../../session';
import { actorOf, projectsFlag, visibleTask, visibleProject } from '../access';
import { lower } from '../db';
import { intakeWaitingCount } from '../../intake/views';
import { STATUS_WORD, ORIGIN, dirMap, nameOf, plain, short, taskUrl, todayEt, dueLabel } from './shared';

export interface TodayCard {
  id: string;
  label: string;
  n: number;
  what: string;
  note: string;
  warn: boolean;
  href: string;
  cta: string;
}

const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the person has due, what was just given to them, and what is new on tasks they are on. */
export async function projectCards(env: Env, user: HubUser): Promise<TodayCard[]> {
  if (!(await projectsFlag(env, user).catch(() => false))) return [];
  const me = lower(user.email);
  const today = todayEt();
  const cards: TodayCard[] = [];
  try {
    const due = (await env.DB.prepare(
      `SELECT t.id, t.code, t.title, t.due_date, p.key AS pkey FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id
        WHERE t.owner_email = ? AND t.status NOT IN ('done', 'dropped') AND t.due_date IS NOT NULL AND t.due_date <= ? ORDER BY t.due_date, t.id LIMIT 5000`
    ).bind(me, today).all<{ id: string; code: string | null; title: string; due_date: string; pkey: string | null }>()).results || [];
    if (due.length) {
      const late = due.filter((d) => d.due_date < today).length;
      cards.push({
        id: 'projects-due',
        label: 'Tasks due',
        n: due.length,
        what: pl(due.length, 'task due today or late', 'tasks due today or late'),
        note: late ? `${late} ${pl(late, 'is', 'are')} past the due date. Oldest: ${short(due[0].title, 50)}` : short(due[0].title, 70),
        warn: late > 0,
        href: due.length === 1 ? taskUrl(due[0], due[0].pkey ? { key: due[0].pkey } : null) : '/projects/',
        cta: due.length === 1 ? 'Open the task' : 'Open My tasks',
      });
    }
    const dir = await dirMap(env);
    const notes = (await env.DB.prepare(
      `SELECT n.kind, n.actor_email, n.body, n.task_id, t.title, t.code, p.key AS pkey FROM hub_task_notices n JOIN hub_tasks t ON t.id = n.task_id LEFT JOIN hub_projects p ON p.id = t.project_id
        WHERE n.email = ? AND n.read_at IS NULL ORDER BY n.created_at DESC, n.id DESC LIMIT 5000`
    ).bind(me).all<{ kind: string; actor_email: string; body: string; task_id: string; title: string; code: string | null; pkey: string | null }>()).results || [];
    const assigned = notes.filter((n) => n.kind === 'assigned');
    const ids = (list: typeof notes) => [...new Set(list.map((n) => n.task_id))];
    if (assigned.length) {
      const top = assigned[0];
      const a = ids(assigned);
      cards.push({
        id: 'projects-assigned',
        label: 'Given to you',
        n: a.length,
        what: pl(a.length, 'task given to you', 'tasks given to you'),
        note: `${nameOf(dir, top.actor_email) || 'Someone'}: ${short(top.title, 54)}`,
        warn: false,
        href: a.length === 1 ? taskUrl({ id: top.task_id, code: top.code }, top.pkey ? { key: top.pkey } : null) : '/projects/',
        cta: a.length === 1 ? 'Open the task' : 'Open My tasks',
      });
    }
    const news = notes.filter((n) => n.kind !== 'assigned' && n.kind !== 'due_soon');
    if (news.length) {
      const top = news[0];
      const a = ids(news);
      const named = news.every((n) => n.kind === 'mentioned');
      cards.push({
        id: 'projects-news',
        label: named ? 'Mentions' : 'Task news',
        n: a.length,
        what: named ? pl(a.length, 'task that mentions you', 'tasks that mention you') : pl(a.length, 'task with something new', 'tasks with something new'),
        note: `${nameOf(dir, top.actor_email) || 'Someone'} on ${short(top.title, 48)}`,
        warn: false,
        href: a.length === 1 ? taskUrl({ id: top.task_id, code: top.code }, top.pkey ? { key: top.pkey } : null) : '/projects/',
        cta: a.length === 1 ? 'Open the task' : 'Open them',
      });
    }
  } catch {
    // Tables not applied yet: no cards.
  }
  // Requests waiting in Intake or Triage for a person who triages a team. The rail badge adds this card with the others.
  const waiting = await intakeWaitingCount(env, { email: me, name: user.name || me, admin: user.role === 'admin' }).catch(() => 0);
  if (waiting) {
    cards.push({
      id: 'requests',
      label: 'Requests',
      n: waiting,
      what: pl(waiting, 'request waiting in Intake or Triage', 'requests waiting in Intake or Triage'),
      note: 'Accept, ask a question or decline',
      warn: false,
      href: '/projects/?tab=intake',
      cta: 'Open Intake',
    });
  }
  return cards;
}

/**
 * The number on the Projects menu entry and the phone bar: the sum of the Projects cards on Today. Tasks due today or late (the Overdue and Due today
 * tiles on My tasks), plus tasks given to the person and tasks with something new, each task counted once, plus the requests waiting in
 * Intake or Triage for a person who triages a team (the Intake tab's number, intake/views.ts intakeWaitingCount).
 */
export async function projectsMineCount(env: Env, user: HubUser): Promise<number> {
  try {
    if (!(await projectsFlag(env, user))) return 0;
    const me = lower(user.email);
    const r = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM hub_tasks WHERE owner_email = ?1 AND status NOT IN ('done', 'dropped') AND due_date IS NOT NULL AND due_date <= ?2) +
              (SELECT COUNT(DISTINCT n.task_id) FROM hub_task_notices n JOIN hub_tasks t ON t.id = n.task_id WHERE n.email = ?1 AND n.read_at IS NULL AND n.kind = 'assigned') +
              (SELECT COUNT(DISTINCT n.task_id) FROM hub_task_notices n JOIN hub_tasks t ON t.id = n.task_id WHERE n.email = ?1 AND n.read_at IS NULL AND n.kind NOT IN ('assigned', 'due_soon')) AS n`
    ).bind(me, todayEt()).first<{ n: number }>();
    const waiting = await intakeWaitingCount(env, { email: me, name: user.name || me, admin: user.role === 'admin' });
    return (Number(r?.n) || 0) + waiting;
  } catch {
    return 0;
  }
}

/** Meeting action items still open for a person that have no task yet (the Meetings card on Today counts only these). */
export async function openActionsWithoutTask(env: Env, email: string): Promise<{ n: number; first: string | null } | null> {
  try {
    return await env.DB.prepare(
      `SELECT COUNT(*) AS n, (SELECT a2.text FROM hub_meeting_actions a2 WHERE a2.owner_email = ?1 AND a2.done = 0 AND EXISTS (SELECT 1 FROM hub_meetings m2 WHERE m2.id = a2.meeting_id) AND NOT EXISTS (SELECT 1 FROM hub_tasks t WHERE t.meeting_id = a2.meeting_id AND t.meeting_action_idx = a2.idx AND t.status <> 'dropped') ORDER BY a2.meeting_id DESC, a2.idx LIMIT 1) AS first
         FROM hub_meeting_actions a JOIN hub_meetings m ON m.id = a.meeting_id WHERE a.owner_email = ?1 AND a.done = 0 AND NOT EXISTS (SELECT 1 FROM hub_tasks t WHERE t.meeting_id = a.meeting_id AND t.meeting_action_idx = a.idx AND t.status <> 'dropped')`
    ).bind(lower(email)).first<{ n: number; first: string | null }>();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------ the bell */

const WORD: Record<string, string> = { assigned: 'gave you', mentioned: 'tagged you in', followed: 'added you to', unseen: 'Not opened yet:', comment: 'commented on', waiting: 'is waiting on you for', done: 'finished', due_soon: 'Due soon:' };

export interface BellItem {
  id: string;
  task_id: string;
  kind: string;
  head: string;
  title: string;
  txt: string;
  code: string | null;
  created_at: string;
  url: string;
}

export async function bellFor(env: Env, user: HubUser): Promise<{ count: number; items: BellItem[] }> {
  const empty = { count: 0, items: [] as BellItem[] };
  if (!(await projectsFlag(env, user).catch(() => false))) return empty;
  const me = lower(user.email);
  try {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_task_notices WHERE email = ? AND read_at IS NULL').bind(me).first<{ n: number }>();
    const rows = (await env.DB.prepare(
      `SELECT n.id, n.task_id, n.kind, n.actor_email, n.body, n.created_at, t.title, t.code, p.key AS pkey FROM hub_task_notices n JOIN hub_tasks t ON t.id = n.task_id LEFT JOIN hub_projects p ON p.id = t.project_id
        WHERE n.email = ? AND n.read_at IS NULL ORDER BY n.created_at DESC, n.id DESC LIMIT 20`
    ).bind(me).all<{ id: string; task_id: string; kind: string; actor_email: string; body: string; created_at: string; title: string; code: string | null; pkey: string | null }>()).results || [];
    const dir = await dirMap(env);
    return {
      count: Number(c?.n) || 0,
      items: rows.map((r) => ({
        id: r.id,
        task_id: r.task_id,
        kind: r.kind,
        head: r.kind === 'due_soon' ? 'Due soon:' : r.kind === 'unseen' ? 'Not opened yet:' : `${nameOf(dir, r.actor_email) || 'Someone'} ${WORD[r.kind] || 'updated'}`,
        title: r.title,
        txt: r.kind === 'due_soon' || r.kind === 'assigned' || r.kind === 'followed' || r.kind === 'done' ? '' : plain(r.body, dir).slice(0, 110),
        code: r.code,
        created_at: r.created_at,
        url: taskUrl({ id: r.task_id, code: r.code }, r.pkey ? { key: r.pkey } : null),
      })),
    };
  } catch {
    return empty;
  }
}

/* ------------------------------------------------------------------------------------------------ search */

export interface Hit {
  kind: 'project' | 'task';
  title: string;
  desc: string;
  url: string;
}

const like = (q: string) => '%' + q.toLowerCase().replace(/[%_\\]/g, ' ').trim().replace(/\s+/g, '%') + '%';

/** Projects by name, key or team, and tasks by code, title or description, among what this person may open. */
export async function searchFor(env: Env, request: Request, user: HubUser | null, qRaw: string): Promise<Hit[]> {
  const actor = actorOf(request, user);
  const q = String(qRaw || '').trim().slice(0, 100);
  if (!actor || !user || q.length < 2 || !(await projectsFlag(env, user).catch(() => false))) return [];
  const p = like(q);
  const vp = visibleProject(actor, 'p');
  const vt = visibleTask(actor, 't');
  const dir = await dirMap(env);
  const hits: Hit[] = [];
  try {
    const projects = (await env.DB.prepare(
      `SELECT p.key, p.name, p.team, p.status, (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status NOT IN ('done', 'dropped')) AS open
         FROM hub_projects p WHERE p.status <> 'archived' AND ${vp.sql} AND (lower(p.name) LIKE ? OR lower(p.key) LIKE ? OR lower(p.team) LIKE ?) ORDER BY p.name LIMIT 5`
    ).bind(...vp.args, p, p, p).all<{ key: string; name: string; team: string; status: string; open: number }>()).results || [];
    for (const r of projects) hits.push({ kind: 'project', title: r.name, desc: ['Project', r.key, r.team, `${r.open} open`].filter(Boolean).join(' · '), url: `/projects/p/?p=${encodeURIComponent(r.key)}` });
    const tasks = (await env.DB.prepare(
      `SELECT t.id, t.code, t.title, t.status, t.owner_email, t.due_date, t.due_time, p.key AS pkey FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id
        WHERE t.status <> 'dropped' AND ${vt.sql} AND (lower(t.title) LIKE ? OR lower(COALESCE(t.code, '')) LIKE ? OR lower(t.description) LIKE ?)
        ORDER BY CASE WHEN t.status IN ('done') THEN 1 ELSE 0 END, t.updated_at DESC LIMIT 8`
    ).bind(...vt.args, p, p, p).all<{ id: string; code: string | null; title: string; status: string; owner_email: string | null; due_date: string | null; due_time: string | null; pkey: string | null }>()).results || [];
    for (const r of tasks) {
      hits.push({
        kind: 'task',
        title: r.title,
        desc: ['Task', r.code, STATUS_WORD[r.status] || r.status, r.owner_email ? `Owner ${nameOf(dir, r.owner_email)}` : '', r.due_date ? `Due ${dueLabel(r.due_date, r.due_time)}` : ''].filter(Boolean).join(' · '),
        url: taskUrl(r, r.pkey ? { key: r.pkey } : null),
      });
    }
  } catch {
    return [];
  }
  return hits;
}

export { ORIGIN };
