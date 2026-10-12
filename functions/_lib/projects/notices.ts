// Task notices for Today, the bell, the Chat card and email. They go out only when the hub setting requests.notify is on, or the
// recipient is listed in requests.notify.only (the request board's own switch, on purpose). The actor is never told.
import { newId, nowIso, type Env } from '../http';
import { noticeGate } from '../requests/tasks';
import { chunk, lower, placeholders } from './db';
import { modeAllows, projectsMode } from './access';
import { isAdminEmail } from '../session';

export type NoticeKind = 'assigned' | 'mentioned' | 'comment' | 'waiting' | 'due_soon' | 'done';

export interface Notice {
  email: string;
  kind: NoticeKind;
  body?: string;
}

/** Saves the notices the gate allows, once per person (the first listed kind wins). Returns who was told. */
export async function tell(env: Env, taskId: string, actorEmail: string, list: Notice[]): Promise<string[]> {
  if (!list.length) return [];
  const gate = await noticeGate(env);
  const seen = new Set<string>();
  const keep = list.filter((n) => {
    const e = lower(n.email);
    if (!e || e === lower(actorEmail) || seen.has(e) || !gate(e)) return false;
    seen.add(e);
    return true;
  });
  if (!keep.length) return [];
  const now = nowIso();
  await env.DB.batch(
    keep.map((n) =>
      env.DB.prepare('INSERT INTO hub_task_notices (id, email, task_id, kind, actor_email, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
        newId('ntc'),
        lower(n.email),
        taskId,
        n.kind,
        lower(actorEmail),
        String(n.body || '').slice(0, 600),
        now
      )
    )
  );
  return keep.map((n) => lower(n.email));
}

export interface NoticeOut {
  id: string;
  task_id: string;
  kind: string;
  actor_email: string;
  body: string;
  created_at: string;
  read_at: string | null;
  code: string | null;
  title: string;
  status: string;
  project_key: string | null;
}

export async function noticesFor(env: Env, email: string, limit = 30): Promise<{ notices: NoticeOut[]; unread: number }> {
  const me = lower(email);
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_task_notices WHERE email = ? AND read_at IS NULL').bind(me).first<{ n: number }>();
  const rows = await env.DB.prepare(
    `SELECT n.id, n.task_id, n.kind, n.actor_email, n.body, n.created_at, n.read_at, t.code, t.title, t.status, p.key AS project_key
       FROM hub_task_notices n JOIN hub_tasks t ON t.id = n.task_id LEFT JOIN hub_projects p ON p.id = t.project_id
      WHERE n.email = ? AND (n.read_at IS NULL OR n.created_at > ?) ORDER BY n.created_at DESC, n.id DESC LIMIT ?`
  )
    .bind(me, new Date(Date.now() - 7 * 86400000).toISOString(), Math.max(1, Math.min(100, limit)))
    .all<NoticeOut>();
  return { notices: rows.results || [], unread: Number(c?.n) || 0 };
}

/** Marks notices read: the ids given, or all of this person's. */
export async function readNotices(env: Env, email: string, opts: { ids?: string[]; all?: boolean; task_id?: string }): Promise<void> {
  const me = lower(email);
  const now = nowIso();
  if (opts.all) {
    await env.DB.prepare('UPDATE hub_task_notices SET read_at = ? WHERE email = ? AND read_at IS NULL').bind(now, me).run();
    return;
  }
  if (opts.task_id) {
    await env.DB.prepare('UPDATE hub_task_notices SET read_at = ? WHERE email = ? AND task_id = ? AND read_at IS NULL').bind(now, me, opts.task_id).run();
  }
  const ids = (opts.ids || []).map(String).filter(Boolean);
  for (const part of chunk(ids, 80)) {
    await env.DB.prepare(`UPDATE hub_task_notices SET read_at = ? WHERE email = ? AND read_at IS NULL AND id IN (${placeholders(part.length)})`).bind(now, me, ...part).run();
  }
}

/**
 * Tells each owner about tasks due tomorrow or today that they have not been told about. Meant for a morning schedule; it is
 * safe to run twice in a day (an owner hears about a task once in any 20 hours). Returns how many notices were saved.
 */
export async function dueSoonSweep(env: Env, today: string, tomorrow: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 20 * 3600 * 1000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT t.id, t.owner_email, t.title FROM hub_tasks t
      WHERE t.due_date IN (?, ?) AND t.status NOT IN ('done', 'dropped') AND t.owner_email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM hub_task_notices n WHERE n.task_id = t.id AND n.email = t.owner_email AND n.kind = 'due_soon' AND n.created_at >= ?)`
  )
    .bind(today, tomorrow, since)
    .all<{ id: string; owner_email: string; title: string }>();
  // Nobody hears about a due date in a tool they cannot open yet: with Projects admins only, only admins get these; off, nobody.
  const mode = await projectsMode(env);
  if (mode === 'off') return 0;
  const adminRows = await env.DB.prepare("SELECT email FROM hub_users WHERE role = 'admin' AND lower(email) NOT IN ('tester@favorintl.org', 'tester2@favorintl.org')").all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }));
  const admins = new Set((adminRows.results || []).map((r) => lower(r.email)));
  let n = 0;
  for (const r of rows.results || []) {
    if (!modeAllows(mode, { admin: admins.has(lower(r.owner_email)) || isAdminEmail(env, r.owner_email) })) continue;
    n += (await tell(env, r.id, 'system', [{ email: r.owner_email, kind: 'due_soon', body: r.title }])).length;
  }
  return n;
}
