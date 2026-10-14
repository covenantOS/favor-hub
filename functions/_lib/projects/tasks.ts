// Tasks: lists, create, change, move, delete, comments, files, people and dependencies.
// Every list query starts from an index (project, owner or due date) and reads its counts in one grouped pass, so a project with
// 2,000 tasks lists in a few statements.
import { HttpError, newId, nowIso, type Env } from '../http';
import { TESTER_REFUSAL, isTester } from '../testuser';
import { cleanBody, parseMentions } from '../chat/text';
import type { Person } from '../people';
import {
  need,
  noticeGate,
  projectStanding,
  taskStanding,
  visibleProject,
  visibleTask,
  type Actor,
  type TaskStanding,
} from './access';
import {
  FAVOR,
  PRIORITIES,
  STATUSES,
  addEvent,
  asCode,
  asDate,
  asEmail,
  asText,
  asTime,
  brief,
  chunk,
  directory,
  lower,
  oneOf,
  person,
  placeholders,
  projectOf,
  sectionsOf,
  taskById,
  todayEastern,
  type Brief,
  type ProjectRow,
  type TaskRow,
} from './db';
import { tell, type Notice } from './notices';

export interface TaskOut extends TaskRow {
  owner: Brief | null;
  project: { id: string; key: string; name: string; color: string } | null;
  section: string | null;
  /** The meeting a task came from (an action item made into a task), with its date. */
  meeting: { id: string; title: string; date: string } | null;
  subtasks: { done: number; total: number };
  comments: number;
  files: number;
  overdue: boolean;
  blocked: boolean;
}

const OPEN_SQL = `status NOT IN ('done', 'dropped')`;
const MAX_UNSCOPED = 500;
const MAX_PROJECT = 5000;

/* ------------------------------------------------------------------------------------------------ decorate */

/**
 * Adds the owner, project, section, subtask, comment and file counts, overdue and blocked to task rows. With a project scope
 * the counts come from one grouped query each; without one they come from the ids, in chunks.
 */
export async function decorate(env: Env, rows: TaskRow[], dir: Map<string, Person>, scope: string | null = null): Promise<TaskOut[]> {
  if (!rows.length) return [];
  const today = todayEastern();
  const projIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean) as string[])];
  const ids = rows.map((r) => r.id);
  const sub = new Map<string, { done: number; total: number }>();
  const com = new Map<string, number>();
  const fil = new Map<string, number>();
  const blocked = new Set<string>();
  const projects = new Map<string, { id: string; key: string; name: string; color: string }>();
  const sections = new Map<string, string>();

  const jobs: Promise<unknown>[] = [];
  for (const part of chunk(projIds, 80)) {
    jobs.push(
      env.DB.prepare(`SELECT id, key, name, color FROM hub_projects WHERE id IN (${placeholders(part.length)})`).bind(...part).all<{ id: string; key: string; name: string; color: string }>().then((r) => {
        for (const p of r.results || []) projects.set(p.id, p);
      }),
      env.DB.prepare(`SELECT id, name FROM hub_project_sections WHERE project_id IN (${placeholders(part.length)})`).bind(...part).all<{ id: string; name: string }>().then((r) => {
        for (const s of r.results || []) sections.set(s.id, s.name);
      })
    );
  }
  const subSql = `SELECT parent_id AS k, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done FROM hub_tasks`;
  if (scope) {
    jobs.push(
      env.DB.prepare(`${subSql} WHERE project_id = ? AND parent_id IS NOT NULL AND status <> 'dropped' GROUP BY parent_id`).bind(scope).all<{ k: string; total: number; done: number }>().then((r) => {
        for (const x of r.results || []) sub.set(x.k, { done: Number(x.done) || 0, total: Number(x.total) || 0 });
      }),
      env.DB.prepare(`SELECT c.task_id AS k, COUNT(*) AS n FROM hub_task_comments c JOIN hub_tasks t ON t.id = c.task_id WHERE t.project_id = ? AND c.deleted_at IS NULL GROUP BY c.task_id`).bind(scope).all<{ k: string; n: number }>().then((r) => {
        for (const x of r.results || []) com.set(x.k, Number(x.n) || 0);
      }),
      env.DB.prepare(`SELECT f.task_id AS k, COUNT(*) AS n FROM hub_task_files f JOIN hub_tasks t ON t.id = f.task_id WHERE t.project_id = ? GROUP BY f.task_id`).bind(scope).all<{ k: string; n: number }>().then((r) => {
        for (const x of r.results || []) fil.set(x.k, Number(x.n) || 0);
      }),
      env.DB.prepare(`SELECT d.task_id AS k FROM hub_task_deps d JOIN hub_tasks t ON t.id = d.task_id JOIN hub_tasks b ON b.id = d.depends_on WHERE t.project_id = ? AND b.status NOT IN ('done', 'dropped') GROUP BY d.task_id`).bind(scope).all<{ k: string }>().then((r) => {
        for (const x of r.results || []) blocked.add(x.k);
      })
    );
  } else {
    for (const part of chunk(ids, 80)) {
      const ph = placeholders(part.length);
      jobs.push(
        env.DB.prepare(`${subSql} WHERE parent_id IN (${ph}) AND status <> 'dropped' GROUP BY parent_id`).bind(...part).all<{ k: string; total: number; done: number }>().then((r) => {
          for (const x of r.results || []) sub.set(x.k, { done: Number(x.done) || 0, total: Number(x.total) || 0 });
        }),
        env.DB.prepare(`SELECT task_id AS k, COUNT(*) AS n FROM hub_task_comments WHERE task_id IN (${ph}) AND deleted_at IS NULL GROUP BY task_id`).bind(...part).all<{ k: string; n: number }>().then((r) => {
          for (const x of r.results || []) com.set(x.k, Number(x.n) || 0);
        }),
        env.DB.prepare(`SELECT task_id AS k, COUNT(*) AS n FROM hub_task_files WHERE task_id IN (${ph}) GROUP BY task_id`).bind(...part).all<{ k: string; n: number }>().then((r) => {
          for (const x of r.results || []) fil.set(x.k, Number(x.n) || 0);
        }),
        env.DB.prepare(`SELECT d.task_id AS k FROM hub_task_deps d JOIN hub_tasks b ON b.id = d.depends_on WHERE d.task_id IN (${ph}) AND b.status NOT IN ('done', 'dropped') GROUP BY d.task_id`).bind(...part).all<{ k: string }>().then((r) => {
          for (const x of r.results || []) blocked.add(x.k);
        })
      );
    }
  }
  const meetIds = [...new Set(rows.map((r) => r.meeting_id).filter(Boolean) as string[])];
  const meetings = new Map<string, { id: string; title: string; date: string }>();
  for (const part of chunk(meetIds, 80)) {
    jobs.push(
      env.DB.prepare(`SELECT id, title, COALESCE(started_at, starts_at, created_at) AS at FROM hub_meetings WHERE id IN (${placeholders(part.length)})`).bind(...part).all<{ id: string; title: string; at: string }>().then((r) => {
        for (const m of r.results || []) meetings.set(m.id, { id: m.id, title: m.title || 'Meeting', date: String(m.at || '').slice(0, 10) });
      }).catch(() => undefined)
    );
  }
  await Promise.all(jobs);
  return rows.map((t) => ({
    ...t,
    meeting: t.meeting_id ? meetings.get(t.meeting_id) || null : null,
    owner: brief(dir, t.owner_email),
    project: t.project_id ? projects.get(t.project_id) || null : null,
    section: t.section_id ? sections.get(t.section_id) || null : null,
    subtasks: sub.get(t.id) || { done: 0, total: 0 },
    comments: com.get(t.id) || 0,
    files: fil.get(t.id) || 0,
    overdue: !!t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'dropped',
    blocked: blocked.has(t.id),
  }));
}

/* ------------------------------------------------------------------------------------------------ list */

export interface ListQuery {
  project?: string;
  owner?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  parent?: string;
  limit?: string | number;
  offset?: string | number;
  sort?: string;
  /** overdue | today | week | none */
  due?: string;
  /** a section id, or none */
  section?: string;
  priority?: string;
  /** matches any of the appeal, source, fund and campaign codes */
  code?: string;
}

export interface ListCounts {
  open: number;
  done: number;
  by_section: Record<string, { open: number; done: number }>;
}

export interface ListResult {
  tasks: TaskOut[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
  counts?: ListCounts;
}

export async function listTasks(env: Env, actor: Actor, q: ListQuery): Promise<ListResult> {
  const where: string[] = [];
  const args: unknown[] = [];
  let scope: ProjectRow | null = null;
  const ownerMe = q.owner === 'me' || (!!q.owner && lower(q.owner) === actor.email);

  if (q.project) {
    scope = await projectOf(env, q.project);
    need((await projectStanding(env, actor, scope)).see, 'You do not have access to this project.');
    where.push('t.project_id = ?');
    args.push(scope.id);
  } else if (!ownerMe) {
    const v = visibleTask(actor, 't');
    where.push(v.sql);
    args.push(...v.args);
  }
  const ownerNone = lower(q.owner) === 'none';
  if (ownerNone) where.push('t.owner_email IS NULL');
  else if (q.owner) {
    where.push('t.owner_email = ?');
    args.push(ownerMe ? actor.email : lower(q.owner));
  }

  const status = lower(q.status || 'open');
  if (status === 'open') where.push(`t.${OPEN_SQL}`);
  else if (status === 'doing' || status === 'waiting') {
    where.push('t.status = ?');
    args.push(status);
  }
  else if (status === 'done') where.push(`t.status = 'done'`);
  else if (status === 'dropped') where.push(`t.status = 'dropped'`);
  else where.push(`t.status <> 'dropped'`);

  if (q.parent && q.parent !== 'any') {
    const parent = await taskById(env, q.parent);
    const ps = await taskStanding(env, actor, parent, parent.project_id ? await projectOf(env, parent.project_id) : null);
    need(ps.see, 'You do not have access to that task.');
    where.push('t.parent_id = ?');
    args.push(parent.id);
  } else if (!q.parent && (!q.owner || ownerNone)) {
    where.push('t.parent_id IS NULL');
  }

  if (q.from || q.to) {
    const from = asDate(q.from, 'from') || '0000-01-01';
    const to = asDate(q.to, 'to') || '9999-12-31';
    where.push(`COALESCE(t.start_date, t.due_date) IS NOT NULL AND COALESCE(t.start_date, t.due_date) <= ? AND COALESCE(t.due_date, t.start_date) >= ?`);
    args.push(to, from);
  }
  const text = String(q.q || '').trim().slice(0, 100);
  if (text) {
    const like = '%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    where.push(`(t.title LIKE ? ESCAPE '\\' OR t.code LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')`);
    args.push(like, like, like);
  }

  const today = todayEastern();
  const due = lower(q.due);
  if (due === 'overdue') {
    where.push(`t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN ('done', 'dropped')`);
    args.push(today);
  } else if (due === 'today') {
    where.push('t.due_date = ?');
    args.push(today);
  } else if (due === 'week') {
    where.push('t.due_date >= ? AND t.due_date <= ?');
    args.push(today, addDaysIso(today, 7));
  } else if (due === 'none') where.push('t.due_date IS NULL');
  if (q.section) {
    if (lower(q.section) === 'none') where.push('t.section_id IS NULL');
    else {
      where.push('t.section_id = ?');
      args.push(String(q.section));
    }
  }
  if (q.priority && (PRIORITIES as readonly string[]).includes(lower(q.priority))) {
    where.push('t.priority = ?');
    args.push(lower(q.priority));
  }
  const code = String(q.code || '').trim().toUpperCase().slice(0, 40);
  if (code) {
    where.push('(t.appeal_code = ? OR t.source_code = ? OR t.fund_code = ? OR t.campaign_code = ?)');
    args.push(code, code, code, code);
  }

  const cap = scope ? MAX_PROJECT : MAX_UNSCOPED;
  const limit = Math.max(1, Math.min(cap, Number(q.limit) || (scope ? 2500 : 200)));
  const offset = Math.max(0, Number(q.offset) || 0);
  const by = lower(q.sort) === 'updated' ? 't.updated_at DESC, t.id' : lower(q.sort) === 'due' || (!scope && q.owner) || q.from || q.to ? 't.due_date IS NULL, t.due_date, t.start_date, t.sort, t.id' : 't.sort, t.id';
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows, count, dir] = await Promise.all([
    env.DB.prepare(`SELECT t.* FROM hub_tasks t ${w} ORDER BY ${by} LIMIT ? OFFSET ?`).bind(...args, limit, offset).all<TaskRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM hub_tasks t ${w}`).bind(...args).first<{ n: number }>(),
    directory(env),
  ]);
  const total = Number(count?.n) || 0;
  const got = rows.results || [];
  const more = offset + got.length < total && got.length > 0;
  const out: ListResult = { tasks: await decorate(env, got, dir, scope ? scope.id : null), total, limit, offset, has_more: more, next_offset: more ? offset + got.length : null };
  if (scope && offset === 0 && !q.parent) {
    // Open and done counts per section, so a section header can show its size while its completed tasks stay hidden.
    const c = await env.DB.prepare(`SELECT section_id AS sid, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status NOT IN ('done', 'dropped') THEN 1 ELSE 0 END) AS open FROM hub_tasks WHERE project_id = ? AND parent_id IS NULL GROUP BY section_id`)
      .bind(scope.id)
      .all<{ sid: string | null; done: number; open: number }>();
    const counts: ListCounts = { open: 0, done: 0, by_section: {} };
    for (const r of c.results || []) {
      counts.open += Number(r.open) || 0;
      counts.done += Number(r.done) || 0;
      counts.by_section[r.sid || ''] = { open: Number(r.open) || 0, done: Number(r.done) || 0 };
    }
    out.counts = counts;
  }
  return out;
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Tasks on my plate for the project list header. Uses the owner index. */
export async function mineCounts(env: Env, email: string): Promise<{ open: number; overdue: number; dueToday: number }> {
  const today = todayEastern();
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS open,
            SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) AS due_today
       FROM hub_tasks WHERE owner_email = ? AND status NOT IN ('done', 'dropped')`
  )
    .bind(today, today, email)
    .first<{ open: number; overdue: number | null; due_today: number | null }>();
  return { open: Number(r?.open) || 0, overdue: Number(r?.overdue) || 0, dueToday: Number(r?.due_today) || 0 };
}

/* ------------------------------------------------------------------------------------------------ detail */

export interface CommentOut {
  id: string;
  task_id: string;
  author_email: string;
  author: Brief | null;
  body: string;
  mentions: string[];
  source: string;
  chat_message_id: string | null;
  created_at: string;
  edited_at: string | null;
}

function parseList(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function taskAccess(env: Env, actor: Actor, idOrCode: string): Promise<{ task: TaskRow; project: ProjectRow | null; st: TaskStanding }> {
  const task = await taskById(env, idOrCode);
  const project = task.project_id ? await env.DB.prepare('SELECT * FROM hub_projects WHERE id = ?').bind(task.project_id).first<ProjectRow>() : null;
  const st = await taskStanding(env, actor, task, project);
  // A task nobody may see looks like a task that is not there.
  if (!st.see) throw new HttpError(404, 'not_found', 'Task not found.');
  return { task, project, st };
}

export async function taskDetail(env: Env, actor: Actor, idOrCode: string) {
  const { task, project, st } = await taskAccess(env, actor, idOrCode);
  const dir = await directory(env);
  const [subs, comments, files, events, people, blockedBy, blocks, gate] = await Promise.all([
    env.DB.prepare(`SELECT * FROM hub_tasks WHERE parent_id = ? AND status <> 'dropped' ORDER BY sort, id`).bind(task.id).all<TaskRow>(),
    env.DB.prepare('SELECT * FROM hub_task_comments WHERE task_id = ? AND deleted_at IS NULL ORDER BY created_at, id').bind(task.id).all<Record<string, string | null>>(),
    env.DB.prepare('SELECT * FROM hub_task_files WHERE task_id = ? ORDER BY added_at, id').bind(task.id).all(),
    env.DB.prepare('SELECT * FROM hub_task_events WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(task.id).all<Record<string, string>>(),
    env.DB.prepare('SELECT email, role FROM hub_task_people WHERE task_id = ? ORDER BY role, email').bind(task.id).all<{ email: string; role: string }>(),
    env.DB.prepare(`SELECT t.id, t.code, t.title, t.status, t.due_date FROM hub_task_deps d JOIN hub_tasks t ON t.id = d.depends_on WHERE d.task_id = ? ORDER BY t.due_date`).bind(task.id).all(),
    env.DB.prepare(`SELECT t.id, t.code, t.title, t.status, t.due_date FROM hub_task_deps d JOIN hub_tasks t ON t.id = d.task_id WHERE d.depends_on = ? ORDER BY t.due_date`).bind(task.id).all(),
    noticeGate(env),
  ]);
  const [out] = await decorate(env, [task], dir, null);
  const subOut = await decorate(env, subs.results || [], dir, null);
  const who = new Map<string, string>();
  if (task.owner_email) who.set(lower(task.owner_email), 'owner');
  for (const p of people.results || []) if (!who.has(p.email)) who.set(p.email, p.role);
  const peopleOut = [...who.entries()].map(([email, role]) => ({ ...person(dir, email), role }));
  const told: Record<string, boolean> = {};
  for (const [email] of who) told[email] = gate(email);
  return {
    task: out,
    subtasks: subOut,
    comments: (comments.results || []).map(
      (c): CommentOut => ({
        id: String(c.id),
        task_id: String(c.task_id),
        author_email: String(c.author_email),
        author: brief(dir, c.author_email),
        body: String(c.body),
        mentions: parseList(String(c.mentions || '[]')),
        source: String(c.source),
        chat_message_id: c.chat_message_id,
        created_at: String(c.created_at),
        edited_at: c.edited_at,
      })
    ),
    files: files.results || [],
    events: (events.results || []).map((e) => ({ ...e, actor: brief(dir, e.actor_email), detail: safeJson(e.detail) })),
    deps: { blockedBy: blockedBy.results || [], blocks: blocks.results || [] },
    people: peopleOut,
    told,
    can: { edit: st.edit, remove: st.remove },
    project,
  };
}

function safeJson(s: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(s || '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------------------------------------ sort order */

async function endSort(env: Env, project: string | null, section: string | null, parent: string | null): Promise<number> {
  const r = await env.DB.prepare('SELECT MAX(sort) AS m FROM hub_tasks WHERE project_id IS ? AND section_id IS ? AND parent_id IS ?').bind(project, section, parent).first<{ m: number | null }>();
  return (Number(r?.m) || 0) + 1000;
}

async function renumber(env: Env, project: string | null, section: string | null, parent: string | null): Promise<void> {
  const rows = await env.DB.prepare('SELECT id FROM hub_tasks WHERE project_id IS ? AND section_id IS ? AND parent_id IS ? ORDER BY sort, id').bind(project, section, parent).all<{ id: string }>();
  const list = rows.results || [];
  for (const part of chunk(list.map((r, i) => ({ id: r.id, sort: (i + 1) * 1000 })), 50)) {
    await env.DB.batch(part.map((x) => env.DB.prepare('UPDATE hub_tasks SET sort = ? WHERE id = ?').bind(x.sort, x.id)));
  }
}

/** The sort value that puts a task just before or after a neighbour in the same list. */
async function sortNear(env: Env, t: { id: string; project_id: string | null; section_id: string | null; parent_id: string | null }, neighbour: TaskRow, where: 'before' | 'after', retry = true): Promise<number> {
  const sibs = [t.project_id, t.section_id, t.parent_id];
  if (where === 'before') {
    const prev = await env.DB.prepare('SELECT MAX(sort) AS m FROM hub_tasks WHERE project_id IS ? AND section_id IS ? AND parent_id IS ? AND sort < ? AND id <> ?').bind(...sibs, neighbour.sort, t.id).first<{ m: number | null }>();
    if (prev?.m === null || prev?.m === undefined) return neighbour.sort - 1000;
    if (neighbour.sort - Number(prev.m) < 1e-6 && retry) {
      await renumber(env, t.project_id, t.section_id, t.parent_id);
      const fresh = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ?').bind(neighbour.id).first<TaskRow>();
      return sortNear(env, t, fresh || neighbour, where, false);
    }
    return (Number(prev.m) + neighbour.sort) / 2;
  }
  const next = await env.DB.prepare('SELECT MIN(sort) AS m FROM hub_tasks WHERE project_id IS ? AND section_id IS ? AND parent_id IS ? AND sort > ? AND id <> ?').bind(...sibs, neighbour.sort, t.id).first<{ m: number | null }>();
  if (next?.m === null || next?.m === undefined) return neighbour.sort + 1000;
  if (Number(next.m) - neighbour.sort < 1e-6 && retry) {
    await renumber(env, t.project_id, t.section_id, t.parent_id);
    const fresh = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ?').bind(neighbour.id).first<TaskRow>();
    return sortNear(env, t, fresh || neighbour, where, false);
  }
  return (neighbour.sort + Number(next.m)) / 2;
}

/* ------------------------------------------------------------------------------------------------ create */

async function nextCode(env: Env, project: ProjectRow): Promise<string> {
  const r = await env.DB.prepare('UPDATE hub_projects SET next_num = next_num + 1 WHERE id = ? RETURNING next_num').bind(project.id).first<{ next_num: number }>();
  const n = (Number(r?.next_num) || 2) - 1;
  return `${project.key}-${String(n).padStart(4, '0')}`;
}

async function checkSection(env: Env, projectId: string | null, section: unknown): Promise<string | null> {
  if (section === null || section === undefined || section === '') return null;
  if (!projectId) throw new HttpError(400, 'bad_section', 'A task with no project has no sections.');
  const s = await env.DB.prepare('SELECT id FROM hub_project_sections WHERE id = ? AND project_id = ?').bind(String(section), projectId).first();
  if (!s) throw new HttpError(400, 'bad_section', 'That section is not in this project.');
  return String(section);
}

async function checkPerson(env: Env, email: string | null): Promise<string | null> {
  if (!email) return null;
  if (isTester(email)) return email;
  if (!(await directory(env)).has(email)) throw new HttpError(400, 'unknown_person', `${email} is not on the staff list.`);
  return email;
}

const LINK_FIELDS = ['request_id', 'meeting_id', 'meeting_action_idx', 'chat_message_id'] as const;

/** An existing task made from the same request, meeting action item or Chat message, so a retry never doubles it. */
async function existingFor(env: Env, b: Record<string, unknown>): Promise<TaskRow | null> {
  if (b.request_id) {
    const r = await env.DB.prepare(`SELECT * FROM hub_tasks WHERE request_id = ? AND status <> 'dropped' LIMIT 1`).bind(String(b.request_id)).first<TaskRow>();
    if (r) return r;
  }
  if (b.meeting_id && b.meeting_action_idx !== undefined && b.meeting_action_idx !== null) {
    const r = await env.DB.prepare(`SELECT * FROM hub_tasks WHERE meeting_id = ? AND meeting_action_idx = ? AND status <> 'dropped' LIMIT 1`).bind(String(b.meeting_id), Number(b.meeting_action_idx)).first<TaskRow>();
    if (r) return r;
  }
  if (b.chat_message_id) {
    const r = await env.DB.prepare(`SELECT * FROM hub_tasks WHERE chat_message_id = ? AND status <> 'dropped' LIMIT 1`).bind(String(b.chat_message_id)).first<TaskRow>();
    if (r) return r;
  }
  return null;
}

export interface Made {
  task: TaskRow;
  project: ProjectRow | null;
  told: string[];
  existing: boolean;
}

/** quiet: the caller sends its own notice (a plan makes many tasks and tells each person once). */
export async function createTask(env: Env, actor: Actor, b: Record<string, unknown>, opts: { quiet?: boolean } = {}): Promise<Made> {
  const title = asText(b.title, 'title', 300, true);
  const dup = await existingFor(env, b);
  if (dup) {
    const project = dup.project_id ? await projectOf(env, dup.project_id) : null;
    const st = await taskStanding(env, actor, dup, project);
    if (st.see) return { task: dup, project, told: [], existing: true };
  }
  let parent: TaskRow | null = null;
  if (b.parent_id) {
    parent = await taskById(env, String(b.parent_id));
  }
  let project: ProjectRow | null = null;
  const pid = b.project_id ? String(b.project_id) : parent ? parent.project_id : null;
  if (pid) {
    project = await projectOf(env, pid);
    need((await projectStanding(env, actor, project)).edit, 'Only project members can add tasks.');
  }
  if (parent && (parent.project_id || null) !== (project ? project.id : null)) throw new HttpError(400, 'bad_parent', 'A subtask belongs to the same project as its task.');
  if (parent) need((await taskStanding(env, actor, parent, project)).edit, 'You cannot add subtasks to that task.');
  const personal = !project;
  const section = parent ? parent.section_id : await checkSection(env, project ? project.id : null, b.section_id);
  const owner = b.owner_email === undefined ? (personal && FAVOR.test(actor.email) ? actor.email : null) : await checkPerson(env, asEmail(b.owner_email, 'owner_email'));
  if (isTester(actor.email) && owner && !isTester(owner)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
  const status = b.status === undefined ? 'open' : oneOf(b.status, STATUSES, 'status');
  const now = nowIso();
  const t: TaskRow = {
    id: newId('tsk'),
    project_id: project ? project.id : null,
    section_id: section,
    code: project ? await nextCode(env, project) : null,
    title,
    description: asText(b.description, 'description', 20000),
    status,
    priority: b.priority === undefined ? 'normal' : oneOf(b.priority, PRIORITIES, 'priority'),
    owner_email: owner,
    start_date: asDate(b.start_date, 'start_date'),
    due_date: asDate(b.due_date, 'due_date'),
    due_time: asTime(b.due_time),
    done_at: status === 'done' ? now : null,
    done_by: status === 'done' ? actor.email : null,
    parent_id: parent ? parent.id : null,
    sort: await endSort(env, project ? project.id : null, section, parent ? parent.id : null),
    waiting_on_email: null,
    waiting_on_task: null,
    appeal_code: asCode(b.appeal_code),
    source_code: asCode(b.source_code),
    fund_code: asCode(b.fund_code),
    campaign_code: asCode(b.campaign_code),
    request_id: b.request_id ? String(b.request_id).slice(0, 80) : null,
    meeting_id: b.meeting_id ? String(b.meeting_id).slice(0, 80) : null,
    meeting_action_idx: b.meeting_action_idx === undefined || b.meeting_action_idx === null || b.meeting_action_idx === '' ? null : Number(b.meeting_action_idx),
    chat_message_id: b.chat_message_id ? String(b.chat_message_id).slice(0, 80) : null,
    expense_id: b.expense_id ? String(b.expense_id).slice(0, 80) : null,
    created_by: actor.email,
    created_at: now,
    updated_at: now,
  };
  if (t.start_date && t.due_date && t.start_date > t.due_date) throw new HttpError(400, 'bad_dates', 'The start date comes after the due date.');
  void LINK_FIELDS;
  await env.DB.prepare(
    `INSERT INTO hub_tasks (id, project_id, section_id, code, title, description, status, priority, owner_email, start_date, due_date, due_time, done_at, done_by, parent_id, sort,
       waiting_on_email, waiting_on_task, appeal_code, source_code, fund_code, campaign_code, request_id, meeting_id, meeting_action_idx, chat_message_id, expense_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(t.id, t.project_id, t.section_id, t.code, t.title, t.description, t.status, t.priority, t.owner_email, t.start_date, t.due_date, t.due_time, t.done_at, t.done_by, t.parent_id, t.sort,
      t.appeal_code, t.source_code, t.fund_code, t.campaign_code, t.request_id, t.meeting_id, t.meeting_action_idx, t.chat_message_id, t.expense_id, t.created_by, t.created_at, t.updated_at)
    .run();
  const dir = await directory(env);
  const followers = new Set<string>();
  for (const e of Array.isArray(b.followers) ? b.followers : []) {
    const f = lower(e);
    if (dir.has(f) && f !== owner) followers.add(f);
  }
  if (followers.size) {
    await env.DB.batch([...followers].map((e) => env.DB.prepare(`INSERT OR IGNORE INTO hub_task_people (task_id, email, role) VALUES (?, ?, 'follower')`).bind(t.id, e)));
  }
  await addEvent(env, { task_id: t.id, project_id: t.project_id, actor: actor.email, kind: 'created', detail: { title } });
  const list: Notice[] = [];
  if (owner && owner !== actor.email) list.push({ email: owner, kind: 'assigned', body: title });
  for (const e of followers) list.push({ email: e, kind: 'followed', body: title });
  const told = opts.quiet ? [] : await tell(env, t.id, actor.email, list);
  return { task: t, project, told, existing: false };
}

/* ------------------------------------------------------------------------------------------------ change */

const SIMPLE = ['title', 'description', 'priority', 'owner_email', 'start_date', 'due_date', 'due_time', 'appeal_code', 'source_code', 'fund_code', 'campaign_code', 'expense_id', 'request_id', 'meeting_id', 'meeting_action_idx', 'chat_message_id'] as const;

export interface Patched {
  task: TaskRow;
  before: TaskRow;
  project: ProjectRow | null;
  changed: string[];
  told: string[];
  kinds: string[];
}

async function descendants(env: Env, id: string): Promise<string[]> {
  const r = await env.DB.prepare(
    `WITH RECURSIVE d(id) AS (SELECT id FROM hub_tasks WHERE parent_id = ? UNION SELECT t.id FROM hub_tasks t JOIN d ON t.parent_id = d.id) SELECT id FROM d LIMIT 2000`
  )
    .bind(id)
    .all<{ id: string }>();
  return (r.results || []).map((x) => x.id);
}

export async function patchTask(env: Env, actor: Actor, idOrCode: string, b: Record<string, unknown>): Promise<Patched> {
  const { task: before, project, st } = await taskAccess(env, actor, idOrCode);
  need(st.edit, 'Only people on this project or on the task can change it.');
  const next: TaskRow = { ...before };
  const changed: string[] = [];
  const kinds: string[] = [];
  const set = <K extends keyof TaskRow>(k: K, v: TaskRow[K]) => {
    if (next[k] !== v) {
      next[k] = v;
      changed.push(k as string);
    }
  };

  if ('title' in b) set('title', asText(b.title, 'title', 300, true));
  if ('description' in b) set('description', asText(b.description, 'description', 20000));
  if ('priority' in b) set('priority', oneOf(b.priority, PRIORITIES, 'priority'));
  if ('start_date' in b) set('start_date', asDate(b.start_date, 'start_date'));
  if ('due_date' in b) set('due_date', asDate(b.due_date, 'due_date'));
  if ('due_time' in b) set('due_time', asTime(b.due_time));
  if ('owner_email' in b) {
    const who = await checkPerson(env, asEmail(b.owner_email, 'owner_email'));
    if (isTester(actor.email) && who && !isTester(who)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
    set('owner_email', who);
  }
  for (const k of ['appeal_code', 'source_code', 'fund_code', 'campaign_code'] as const) if (k in b) set(k, asCode(b[k]));
  if ('expense_id' in b) set('expense_id', b.expense_id ? String(b.expense_id).slice(0, 80) : null);
  if ('request_id' in b) set('request_id', b.request_id ? String(b.request_id).slice(0, 80) : null);
  if ('meeting_id' in b) set('meeting_id', b.meeting_id ? String(b.meeting_id).slice(0, 80) : null);
  if ('meeting_action_idx' in b) set('meeting_action_idx', b.meeting_action_idx === null || b.meeting_action_idx === '' ? null : Number(b.meeting_action_idx));
  if ('chat_message_id' in b) set('chat_message_id', b.chat_message_id ? String(b.chat_message_id).slice(0, 80) : null);
  if (next.start_date && next.due_date && next.start_date > next.due_date) throw new HttpError(400, 'bad_dates', 'The start date comes after the due date.');

  // Waiting on: setting either field means the task is waiting; clearing both frees it.
  let waitMail = before.waiting_on_email;
  if ('waiting_on_email' in b) {
    waitMail = await checkPerson(env, asEmail(b.waiting_on_email, 'waiting_on_email'));
    set('waiting_on_email', waitMail);
  }
  if ('waiting_on_task' in b) {
    let wt: string | null = null;
    if (b.waiting_on_task) {
      const other = await taskById(env, String(b.waiting_on_task));
      if (other.id === before.id) throw new HttpError(400, 'bad_value', 'A task cannot wait on itself.');
      wt = other.id;
    }
    set('waiting_on_task', wt);
  }
  const waitingTouched = 'waiting_on_email' in b || 'waiting_on_task' in b;

  // Status, and done as its own switch.
  let status = before.status;
  if ('status' in b) status = oneOf(b.status, STATUSES, 'status');
  if ('done' in b) status = b.done ? 'done' : before.status === 'done' ? 'open' : before.status;
  if (waitingTouched && !('status' in b) && !('done' in b)) {
    if (next.waiting_on_email || next.waiting_on_task) {
      if (status !== 'done' && status !== 'dropped') status = 'waiting';
    } else if (status === 'waiting') status = 'open';
  }
  if (status !== 'waiting' && ('status' in b || 'done' in b) && (next.waiting_on_email || next.waiting_on_task)) {
    set('waiting_on_email', null);
    set('waiting_on_task', null);
  }
  if (status !== before.status) {
    set('status', status);
    if (status === 'done') {
      set('done_at', nowIso());
      set('done_by', actor.email);
      kinds.push('done');
    } else {
      if (before.status === 'done') kinds.push('reopened');
      set('done_at', null);
      set('done_by', null);
    }
  }

  // Moving between projects: a new code, a new section list, and the subtasks go along.
  let moved: ProjectRow | null | undefined;
  if ('project_id' in b) {
    const target = b.project_id ? await projectOf(env, String(b.project_id)) : null;
    if ((target ? target.id : null) !== before.project_id) {
      if (target) need((await projectStanding(env, actor, target)).edit, 'Only members of the other project can take this task.');
      if (before.parent_id) throw new HttpError(400, 'bad_parent', 'Move the main task; its subtasks go with it.');
      moved = target;
      set('project_id', target ? target.id : null);
      set('section_id', null);
      set('code', target ? await nextCode(env, target) : null);
      set('sort', await endSort(env, target ? target.id : null, null, null));
      kinds.push('project');
    }
  }

  // Subtask of another task.
  if ('parent_id' in b) {
    const pid = b.parent_id ? String(b.parent_id) : null;
    if (pid) {
      const par = await taskById(env, pid);
      if (par.id === before.id || (await descendants(env, before.id)).includes(par.id)) throw new HttpError(400, 'bad_parent', 'A task cannot be a subtask of itself or of its own subtask.');
      if ((par.project_id || null) !== (next.project_id || null)) throw new HttpError(400, 'bad_parent', 'A subtask belongs to the same project as its task.');
      set('parent_id', par.id);
      set('section_id', par.section_id);
    } else set('parent_id', null);
  }

  // Section and order.
  const mv = b.move && typeof b.move === 'object' ? (b.move as Record<string, unknown>) : null;
  if ('section_id' in b && !moved) set('section_id', await checkSection(env, next.project_id, b.section_id));
  if (mv) {
    if ('section_id' in mv) set('section_id', await checkSection(env, next.project_id, mv.section_id));
    const nb = mv.before ? ('before' as const) : mv.after ? ('after' as const) : null;
    if (nb) {
      const other = await taskById(env, String(mv[nb]));
      if ((other.project_id || null) !== (next.project_id || null) || (other.section_id || null) !== (next.section_id || null)) {
        throw new HttpError(400, 'bad_move', 'Drop it next to a task in the same section.');
      }
      set('sort', await sortNear(env, { id: before.id, project_id: next.project_id, section_id: next.section_id, parent_id: next.parent_id }, other, nb));
    } else if (before.section_id !== next.section_id || before.project_id !== next.project_id) {
      set('sort', await endSort(env, next.project_id, next.section_id, next.parent_id));
    }
    kinds.push('moved');
  }

  if (!changed.length) return { task: before, before, project, changed, told: [], kinds };
  const now = nowIso();
  next.updated_at = now;
  const cols = [...new Set(changed)];
  await env.DB.prepare(`UPDATE hub_tasks SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((k) => next[k as keyof TaskRow]), now, before.id)
    .run();

  if (moved !== undefined) {
    // Subtasks keep their place under the task, in the new project.
    for (const part of chunk(await descendants(env, before.id), 40)) {
      for (const id of part) {
        const child = await env.DB.prepare('SELECT id FROM hub_tasks WHERE id = ?').bind(id).first();
        if (!child) continue;
        await env.DB.prepare('UPDATE hub_tasks SET project_id = ?, section_id = ?, code = ?, updated_at = ? WHERE id = ?')
          .bind(moved ? moved.id : null, null, moved ? await nextCode(env, moved) : null, now, id)
          .run();
      }
    }
  }

  const detail: Record<string, unknown> = { fields: cols.filter((c) => c !== 'sort' || kinds.includes('moved')) };
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const c of cols) {
    if (c === 'description' || c === 'sort') continue;
    from[c] = before[c as keyof TaskRow];
    to[c] = next[c as keyof TaskRow];
  }
  detail.from = from;
  detail.to = to;
  const evKind = kinds.includes('done') ? 'done' : kinds.includes('reopened') ? 'reopened' : kinds.includes('project') ? 'project' : kinds.length && cols.every((c) => c === 'sort' || c === 'section_id') ? 'moved' : 'updated';
  await addEvent(env, { task_id: before.id, project_id: next.project_id, actor: actor.email, kind: evKind, detail });

  // Notices.
  const list: Notice[] = [];
  if (changed.includes('owner_email') && next.owner_email && next.owner_email !== actor.email) list.push({ email: next.owner_email, kind: 'assigned', body: next.title });
  if (changed.includes('waiting_on_email') && next.waiting_on_email) list.push({ email: next.waiting_on_email, kind: 'waiting', body: next.title });
  if (kinds.includes('done')) {
    const aud = await audienceOf(env, next);
    aud.add(lower(next.created_by));
    for (const e of aud) list.push({ email: e, kind: 'done', body: next.title });
  }
  const told = await tell(env, before.id, actor.email, list);
  const finalProject = moved !== undefined ? moved : project;
  return { task: next, before, project: finalProject, changed: cols, told, kinds };
}

/** The owner and everyone on the task: collaborators and followers. */
export async function audienceOf(env: Env, t: TaskRow): Promise<Set<string>> {
  const r = await env.DB.prepare('SELECT DISTINCT email FROM hub_task_people WHERE task_id = ?').bind(t.id).all<{ email: string }>();
  const out = new Set<string>((r.results || []).map((x) => lower(x.email)));
  if (t.owner_email) out.add(lower(t.owner_email));
  return out;
}

/* ------------------------------------------------------------------------------------------------ delete */

export async function deleteTask(env: Env, actor: Actor, idOrCode: string, hard: boolean): Promise<{ task: TaskRow; project: ProjectRow | null; hard: boolean }> {
  const { task, project, st } = await taskAccess(env, actor, idOrCode);
  need(st.remove, 'Only the person who made the task, the project lead or a FavorOS admin can remove it.');
  const ids = [task.id, ...(await descendants(env, task.id))];
  if (hard) {
    need(actor.admin, 'Only a FavorOS admin can delete a task for good.');
    for (const id of ids) {
      const keys = await env.DB.prepare(`SELECT ref_id FROM hub_task_files WHERE task_id = ? AND kind = 'upload' AND ref_id IS NOT NULL`).bind(id).all<{ ref_id: string }>();
      for (const k of keys.results || []) await Promise.resolve(env.UPLOADS?.delete?.(k.ref_id)).catch(() => undefined);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM hub_task_comments WHERE task_id = ?').bind(id),
        env.DB.prepare('DELETE FROM hub_task_files WHERE task_id = ?').bind(id),
        env.DB.prepare('DELETE FROM hub_task_people WHERE task_id = ?').bind(id),
        env.DB.prepare('DELETE FROM hub_task_deps WHERE task_id = ? OR depends_on = ?').bind(id, id),
        env.DB.prepare('DELETE FROM hub_task_notices WHERE task_id = ?').bind(id),
        env.DB.prepare('DELETE FROM hub_task_events WHERE task_id = ?').bind(id),
        env.DB.prepare('UPDATE hub_tasks SET waiting_on_task = NULL, status = CASE WHEN status = \'waiting\' AND waiting_on_email IS NULL THEN \'open\' ELSE status END WHERE waiting_on_task = ?').bind(id),
        env.DB.prepare('DELETE FROM hub_tasks WHERE id = ?').bind(id),
      ]);
    }
    await addEvent(env, { task_id: null, project_id: task.project_id, actor: actor.email, kind: 'deleted', detail: { code: task.code, title: task.title } });
    return { task, project, hard: true };
  }
  const now = nowIso();
  for (const part of chunk(ids, 80)) {
    await env.DB.prepare(`UPDATE hub_tasks SET status = 'dropped', updated_at = ? WHERE id IN (${placeholders(part.length)})`).bind(now, ...part).run();
  }
  await addEvent(env, { task_id: task.id, project_id: task.project_id, actor: actor.email, kind: 'dropped', detail: {} });
  return { task: { ...task, status: 'dropped' }, project, hard: false };
}

/* ------------------------------------------------------------------------------------------------ comments */

function mentionList(body: string, extra: unknown, dir: Map<string, Person>): string[] {
  const out = new Set<string>();
  for (const e of parseMentions(body).people) out.add(lower(e));
  for (const e of Array.isArray(extra) ? extra : []) out.add(lower(e));
  return [...out].filter((e) => dir.has(e));
}

export async function addComment(env: Env, actor: Actor, idOrCode: string, b: Record<string, unknown>, from: { source?: string; chat_message_id?: string | null } = {}) {
  const { task, project } = await taskAccess(env, actor, idOrCode);
  const body = cleanBody(b.body);
  if (!body) throw new HttpError(400, 'empty', 'Write a comment first.');
  const dir = await directory(env);
  const mentions = mentionList(body, b.mentions, dir);
  const c = {
    id: newId('cmt'),
    task_id: task.id,
    author_email: actor.email,
    body,
    mentions: JSON.stringify(mentions),
    source: from.source || 'hub',
    chat_message_id: from.chat_message_id || (b.chat_message_id ? String(b.chat_message_id) : null),
    created_at: nowIso(),
    edited_at: null as string | null,
  };
  await env.DB.prepare('INSERT INTO hub_task_comments (id, task_id, author_email, body, mentions, source, chat_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(c.id, c.task_id, c.author_email, c.body, c.mentions, c.source, c.chat_message_id, c.created_at)
    .run();
  // Anyone named, and the commenter, follows the task from here on.
  const audience = await audienceOf(env, task);
  const add = new Set<string>(mentions);
  if (FAVOR.test(actor.email)) add.add(actor.email);
  const ownerMail = lower(task.owner_email);
  const follow = [...add].filter((e) => e !== ownerMail && !audience.has(e));
  if (follow.length) await env.DB.batch(follow.map((e) => env.DB.prepare(`INSERT OR IGNORE INTO hub_task_people (task_id, email, role) VALUES (?, ?, 'follower')`).bind(task.id, e)));
  await env.DB.prepare('UPDATE hub_tasks SET updated_at = ? WHERE id = ?').bind(c.created_at, task.id).run();
  await addEvent(env, { task_id: task.id, project_id: task.project_id, actor: actor.email, kind: 'comment', detail: { comment: c.id } });
  const list: Notice[] = [
    ...mentions.map((e) => ({ email: e, kind: 'mentioned' as const, body })),
    ...[...audience].filter((e) => !mentions.includes(e)).map((e) => ({ email: e, kind: 'comment' as const, body })),
  ];
  const told = await tell(env, task.id, actor.email, list);
  return { comment: { ...c, mentions, author: brief(dir, actor.email) } as unknown as CommentOut, task, project, told };
}

export async function editComment(env: Env, actor: Actor, idOrCode: string, cid: string, b: Record<string, unknown>) {
  const { task } = await taskAccess(env, actor, idOrCode);
  const c = await env.DB.prepare('SELECT * FROM hub_task_comments WHERE id = ? AND task_id = ? AND deleted_at IS NULL').bind(cid, task.id).first<Record<string, string>>();
  if (!c) throw new HttpError(404, 'not_found', 'That comment is gone.');
  need(lower(c.author_email) === actor.email, 'You can edit your own comments.');
  const body = cleanBody(b.body);
  if (!body) throw new HttpError(400, 'empty', 'A comment cannot be empty. Delete it instead.');
  const dir = await directory(env);
  const mentions = mentionList(body, b.mentions, dir);
  const now = nowIso();
  await env.DB.prepare('UPDATE hub_task_comments SET body = ?, mentions = ?, edited_at = ? WHERE id = ?').bind(body, JSON.stringify(mentions), now, cid).run();
  return { ...c, body, mentions, edited_at: now, author: brief(dir, c.author_email) };
}

export async function deleteComment(env: Env, actor: Actor, idOrCode: string, cid: string): Promise<{ task: TaskRow }> {
  const { task, st } = await taskAccess(env, actor, idOrCode);
  const c = await env.DB.prepare('SELECT author_email FROM hub_task_comments WHERE id = ? AND task_id = ? AND deleted_at IS NULL').bind(cid, task.id).first<{ author_email: string }>();
  if (!c) throw new HttpError(404, 'not_found', 'That comment is gone.');
  need(lower(c.author_email) === actor.email || actor.admin || !!st.proj?.lead, 'You can delete your own comments.');
  await env.DB.prepare(`UPDATE hub_task_comments SET deleted_at = ?, body = '' WHERE id = ?`).bind(nowIso(), cid).run();
  return { task };
}

/* ------------------------------------------------------------------------------------------------ files */

const FILE_KINDS = ['upload', 'drive', 'clip', 'link'] as const;
export const MAX_UPLOAD = 25 * 1024 * 1024;

export function safeName(name: string): string {
  return String(name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
}

export async function addFile(env: Env, actor: Actor, idOrCode: string, b: Record<string, unknown>) {
  const { task, st } = await taskAccess(env, actor, idOrCode);
  need(st.edit, 'Only people on this project or on the task can attach files.');
  const kind = oneOf(b.kind, FILE_KINDS, 'kind');
  if (kind === 'upload') throw new HttpError(400, 'bad_kind', 'Upload a file with the upload route.');
  const name = asText(b.name, 'name', 200, true);
  const url = asText(b.url, 'url', 2000);
  if (kind === 'link' && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'bad_url', 'A link starts with http:// or https://.');
  if (url && !/^(https?:\/\/|\/)/i.test(url)) throw new HttpError(400, 'bad_url', 'A link starts with http://, https:// or /.');
  if ((kind === 'drive' || kind === 'clip') && !url && !b.ref_id) throw new HttpError(400, 'missing_field', 'A Drive file or clip needs a link or an id.');
  const f = {
    id: newId('fil'),
    task_id: task.id,
    kind,
    name,
    url,
    ref_id: b.ref_id ? String(b.ref_id).slice(0, 200) : null,
    mime: b.mime ? String(b.mime).slice(0, 120) : null,
    size: Number.isFinite(Number(b.size)) && b.size !== undefined && b.size !== null ? Math.max(0, Math.floor(Number(b.size))) : null,
    added_by: actor.email,
    added_at: nowIso(),
  };
  await env.DB.prepare('INSERT INTO hub_task_files (id, task_id, kind, name, url, ref_id, mime, size, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(f.id, f.task_id, f.kind, f.name, f.url, f.ref_id, f.mime, f.size, f.added_by, f.added_at)
    .run();
  await addEvent(env, { task_id: task.id, project_id: task.project_id, actor: actor.email, kind: 'file', detail: { name, kind } });
  return { file: f, task };
}

export async function uploadFile(env: Env, actor: Actor, idOrCode: string, request: Request) {
  const { task, st } = await taskAccess(env, actor, idOrCode);
  need(st.edit, 'Only people on this project or on the task can attach files.');
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'missing_field', 'Choose a file to upload.');
  const blob = file as File;
  if (blob.size > MAX_UPLOAD) throw new HttpError(413, 'too_big', 'Files up to 25 MB can be attached. Put larger ones in Drive and attach the link.');
  if (blob.size === 0) throw new HttpError(400, 'empty', 'That file is empty.');
  const fid = newId('fil');
  const name = safeName(blob.name);
  const key = `projects/${task.id}/${fid}-${name}`;
  await env.UPLOADS.put(key, await blob.arrayBuffer(), { httpMetadata: { contentType: blob.type || 'application/octet-stream' } });
  const f = { id: fid, task_id: task.id, kind: 'upload', name, url: `/api/tasks/${task.id}/files/${fid}/download`, ref_id: key, mime: blob.type || null, size: blob.size, added_by: actor.email, added_at: nowIso() };
  await env.DB.prepare('INSERT INTO hub_task_files (id, task_id, kind, name, url, ref_id, mime, size, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(f.id, f.task_id, f.kind, f.name, f.url, f.ref_id, f.mime, f.size, f.added_by, f.added_at)
    .run();
  await addEvent(env, { task_id: task.id, project_id: task.project_id, actor: actor.email, kind: 'file', detail: { name, kind: 'upload' } });
  return { file: f, task };
}

export async function downloadFile(env: Env, actor: Actor, idOrCode: string, fid: string): Promise<Response> {
  const { task } = await taskAccess(env, actor, idOrCode);
  const f = await env.DB.prepare('SELECT * FROM hub_task_files WHERE id = ? AND task_id = ?').bind(fid, task.id).first<Record<string, string | number | null>>();
  if (!f) throw new HttpError(404, 'not_found', 'File not found.');
  if (f.kind !== 'upload') return Response.redirect(String(f.url || '/'), 302);
  const obj = await env.UPLOADS.get(String(f.ref_id));
  if (!obj) throw new HttpError(404, 'not_found', 'The file is no longer stored.');
  return new Response((obj as R2ObjectBody).body, {
    headers: {
      'Content-Type': String(f.mime || 'application/octet-stream'),
      'Content-Disposition': `attachment; filename="${safeName(String(f.name))}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function deleteFile(env: Env, actor: Actor, idOrCode: string, fid: string): Promise<{ task: TaskRow }> {
  const { task, st } = await taskAccess(env, actor, idOrCode);
  const f = await env.DB.prepare('SELECT kind, ref_id, added_by FROM hub_task_files WHERE id = ? AND task_id = ?').bind(fid, task.id).first<{ kind: string; ref_id: string | null; added_by: string }>();
  if (!f) throw new HttpError(404, 'not_found', 'File not found.');
  need(st.edit || lower(f.added_by) === actor.email, 'Only people on this project or on the task can remove files.');
  if (f.kind === 'upload' && f.ref_id) await Promise.resolve(env.UPLOADS?.delete?.(f.ref_id)).catch(() => undefined);
  await env.DB.prepare('DELETE FROM hub_task_files WHERE id = ?').bind(fid).run();
  return { task };
}

/* ------------------------------------------------------------------------------------------------ people */

const PEOPLE_ROLES = ['collab', 'follower'] as const;

export async function changePeople(env: Env, actor: Actor, idOrCode: string, b: Record<string, unknown>) {
  const { task, st } = await taskAccess(env, actor, idOrCode);
  const dir = await directory(env);
  const items = (key: 'add' | 'remove') =>
    (Array.isArray(b[key]) ? (b[key] as unknown[]) : []).map((x) => {
      const o = (x && typeof x === 'object' ? x : { email: x }) as Record<string, unknown>;
      return { email: lower(o.email), role: o.role === undefined ? 'follower' : oneOf(o.role, PEOPLE_ROLES, 'role') };
    });
  const add = items('add');
  const remove = items('remove');
  // Anyone who can see a task may follow it or stop following it themselves; everything else is for editors.
  const selfFollow = [...add, ...remove].every((x) => x.email === actor.email && x.role === 'follower');
  need(st.edit || selfFollow, 'Only people on this project or on the task can change who is on it.');
  for (const x of add) {
    if (!FAVOR.test(x.email) || !dir.has(x.email)) throw new HttpError(400, 'unknown_person', `${x.email || 'That person'} is not on the staff list.`);
  }
  const statements = [
    ...add.filter((x) => x.email !== lower(task.owner_email)).map((x) => env.DB.prepare('INSERT OR IGNORE INTO hub_task_people (task_id, email, role) VALUES (?, ?, ?)').bind(task.id, x.email, x.role)),
    ...remove.map((x) => env.DB.prepare('DELETE FROM hub_task_people WHERE task_id = ? AND email = ? AND role = ?').bind(task.id, x.email, x.role)),
  ];
  if (statements.length) await env.DB.batch(statements);
  if (add.length || remove.length) await addEvent(env, { task_id: task.id, project_id: task.project_id, actor: actor.email, kind: 'people', detail: { add, remove } });
  // A collaborator is assigned; a follower added by someone else is told too (adding yourself tells nobody: tell() skips the actor).
  const told = await tell(
    env,
    task.id,
    actor.email,
    add.filter((x) => x.email !== lower(task.owner_email)).map((x) => ({ email: x.email, kind: x.role === 'collab' ? ('assigned' as const) : ('followed' as const), body: task.title }))
  );
  const rows = await env.DB.prepare('SELECT email, role FROM hub_task_people WHERE task_id = ? ORDER BY role, email').bind(task.id).all<{ email: string; role: string }>();
  return { task, people: (rows.results || []).map((r) => ({ ...person(dir, r.email), role: r.role })), added: add, removed: remove, told };
}

/* ------------------------------------------------------------------------------------------------ dependencies */

async function reaches(env: Env, from: string, target: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `WITH RECURSIVE r(id) AS (SELECT depends_on FROM hub_task_deps WHERE task_id = ? UNION SELECT d.depends_on FROM hub_task_deps d JOIN r ON d.task_id = r.id)
     SELECT 1 AS hit FROM r WHERE id = ? LIMIT 1`
  )
    .bind(from, target)
    .first();
  return !!r;
}

export async function depsOf(env: Env, id: string) {
  const [blockedBy, blocks] = await Promise.all([
    env.DB.prepare(`SELECT t.id, t.code, t.title, t.status, t.due_date FROM hub_task_deps d JOIN hub_tasks t ON t.id = d.depends_on WHERE d.task_id = ? ORDER BY t.due_date`).bind(id).all(),
    env.DB.prepare(`SELECT t.id, t.code, t.title, t.status, t.due_date FROM hub_task_deps d JOIN hub_tasks t ON t.id = d.task_id WHERE d.depends_on = ? ORDER BY t.due_date`).bind(id).all(),
  ]);
  return { blockedBy: blockedBy.results || [], blocks: blocks.results || [] };
}

export async function changeDeps(env: Env, actor: Actor, idOrCode: string, b: Record<string, unknown>) {
  const { task, st } = await taskAccess(env, actor, idOrCode);
  need(st.edit, 'Only people on this project or on the task can change what it waits on.');
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x || '')).filter(Boolean);
  for (const ref of list(b.add)) {
    const other = await taskAccess(env, actor, ref);
    if (other.task.id === task.id) throw new HttpError(400, 'cycle', 'A task cannot wait on itself.');
    if (await reaches(env, other.task.id, task.id)) throw new HttpError(400, 'cycle', 'That would make a task wait on itself, through the tasks in between.');
    await env.DB.prepare('INSERT OR IGNORE INTO hub_task_deps (task_id, depends_on) VALUES (?, ?)').bind(task.id, other.task.id).run();
  }
  for (const ref of list(b.remove)) {
    const other = await taskById(env, ref).catch(() => null);
    await env.DB.prepare('DELETE FROM hub_task_deps WHERE task_id = ? AND depends_on = ?').bind(task.id, other ? other.id : ref).run();
  }
  if (list(b.add).length || list(b.remove).length) await addEvent(env, { task_id: task.id, project_id: task.project_id, actor: actor.email, kind: 'deps', detail: { add: list(b.add), remove: list(b.remove) } });
  return { task, deps: await depsOf(env, task.id) };
}

export { sectionsOf, visibleProject };
