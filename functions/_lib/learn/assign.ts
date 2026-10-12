// Assigning learning: a course or a path to a person, a team or everyone, with a due date. Each assignment is one row per person, a
// reminder through the notice gate, and a personal task in Projects when Projects is on. Other lanes call assignLearning() too (the
// onboarding program gives a new hire the "New hire" paths on day one).
import { HttpError, nowIso, type Env } from '../http';
import { staffDirectory, type Person } from '../people';
import type { Actor, TaskEnv } from '../requests/tasks';
import { courseByRef, lessonTotals, pathByRef, pathCoursesOf } from './content';
import { FAVOR, bad, id, lower, today, type CourseRow, type PathRow } from './db';
import { tell, type AssignmentFacts } from './notices';
import { closeTask, makeTask, moveTask, reopenTask } from './tasks';

export interface AssignInput {
  kind: 'course' | 'path';
  /** A course or path id or slug. */
  target: string;
  emails?: string[];
  team?: string;
  everyone?: boolean;
  due_date?: string | null;
  note?: string;
  source?: 'manual' | 'team' | 'everyone' | 'onboarding';
}

export interface AssignmentRow {
  id: string;
  email: string;
  kind: 'course' | 'path';
  target_id: string;
  due_date: string | null;
  source: string;
  group_label: string;
  note: string;
  assigned_by: string;
  assigned_at: string;
  task_id: string | null;
  closed_at: string | null;
  closed_why: string | null;
}

const COLS = 'id, email, kind, target_id, due_date, source, group_label, note, assigned_by, assigned_at, task_id, closed_at, closed_why';

export const hrefFor = (kind: 'course' | 'path', slug: string) => `/learn/${kind === 'path' ? 'p' : 'c'}/?${kind === 'path' ? 'p' : 'c'}=${encodeURIComponent(slug)}`;

export async function targetOf(env: Env, kind: 'course' | 'path', ref: string): Promise<(CourseRow | PathRow) & { courses: string[] }> {
  if (kind === 'path') {
    const p = await pathByRef(env, ref);
    if (!p) throw new HttpError(404, 'not_found', 'There is no learning path by that name.');
    return { ...p, courses: await pathCoursesOf(env, p.id) };
  }
  const c = await courseByRef(env, ref);
  if (!c) throw new HttpError(404, 'not_found', 'There is no course by that name.');
  return { ...c, courses: [c.id] };
}

const validDue = (d: unknown): string | null => {
  if (d === null || d === undefined || d === '') return null;
  const s = String(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T12:00:00Z'))) throw bad('Pick the due date as a day.', 'bad_due');
  return s;
};

/** Who a team, everyone or a list of addresses means. The staff directory is the only list of people. */
export async function peopleFor(env: Env, input: Pick<AssignInput, 'emails' | 'team' | 'everyone'>): Promise<{ people: string[]; label: string; source: 'manual' | 'team' | 'everyone' }> {
  const dir = await staffDirectory(env);
  if (input.everyone) return { people: dir.map((p) => p.email), label: 'Everyone', source: 'everyone' };
  if (input.team) {
    const want = lower(input.team);
    const hit = dir.filter((p: Person) => lower(p.team) === want);
    if (!hit.length) throw bad(`No one is listed on the ${input.team} team.`, 'empty_team');
    return { people: hit.map((p) => p.email), label: dir.find((p) => lower(p.team) === want)?.team || input.team, source: 'team' };
  }
  const list = [...new Set((input.emails || []).map(lower).filter((e) => FAVOR.test(e)))];
  if (!list.length) throw bad('Pick at least one person, a team or everyone.', 'nobody');
  return { people: list, label: '', source: 'manual' };
}

/** Every course in the target is complete for this person. */
async function allDone(env: Env, email: string, courses: string[]): Promise<boolean> {
  if (!courses.length) return false;
  // A draft or archived course in a path does not hold the path open.
  const live = ((await env.DB.prepare(`SELECT id FROM learn_courses WHERE status = 'published' AND id IN (${courses.map(() => '?').join(',')})`).bind(...courses).all<{ id: string }>()).results || []) as Array<{ id: string }>;
  if (!live.length) return false;
  const rows = ((await env.DB.prepare(`SELECT course_id FROM learn_completions WHERE email = ? AND course_id IN (${live.map(() => '?').join(',')})`).bind(email, ...live.map((c) => c.id)).all<{ course_id: string }>()).results || []) as Array<{ course_id: string }>;
  return new Set(rows.map((r) => r.course_id)).size === live.length;
}

export interface AssignResult {
  target: { kind: 'course' | 'path'; id: string; title: string };
  created: number;
  updated: number;
  reopened: number;
  already_done: number;
  told: number;
  tasks: number;
  people: string[];
}

export async function assignLearning(env: TaskEnv, actor: Actor, input: AssignInput): Promise<AssignResult> {
  if (input.kind !== 'course' && input.kind !== 'path') throw bad('Assign a course or a path.', 'bad_kind');
  const target = await targetOf(env, input.kind, String(input.target || ''));
  if (target.status === 'archived') throw bad('That is archived. Publish it again before you assign it.', 'archived');
  if (input.kind === 'path' && !target.courses.length) throw bad('That path has no courses yet.', 'empty_path');
  const due = validDue(input.due_date);
  if (due && due < today()) throw bad('The due date is already past.', 'past_due');
  const who = await peopleFor(env, input);
  const note = String(input.note || '').trim().slice(0, 500);
  const source = input.source || who.source;
  const totals = await lessonTotals(env);
  const lessons = input.kind === 'course' ? totals.get(target.id)?.lessons || 0 : 0;
  const minutes = target.courses.reduce((n, c) => n + (totals.get(c)?.minutes || 0), 0);
  const href = hrefFor(input.kind, target.slug);
  const out: AssignResult = { target: { kind: input.kind, id: target.id, title: target.title }, created: 0, updated: 0, reopened: 0, already_done: 0, told: 0, tasks: 0, people: [] };
  const now = nowIso();
  for (const email of who.people) {
    const prev = await env.DB.prepare(`SELECT ${COLS} FROM learn_assignments WHERE email = ? AND kind = ? AND target_id = ?`).bind(email, input.kind, target.id).first<AssignmentRow>();
    const done = await allDone(env, email, target.courses);
    const facts = (aid: string): AssignmentFacts => ({ id: aid, email, kind: input.kind, title: target.title, due_date: due, note, href, minutes, lessons });
    if (prev && !prev.closed_at) {
      // Already open: the new due date and note replace the old ones; nobody is told again unless the date moved.
      if ((prev.due_date || null) !== due || note !== prev.note) {
        await env.DB.prepare('UPDATE learn_assignments SET due_date = ?, note = ?, assigned_by = ?, group_label = ? WHERE id = ?').bind(due, note || prev.note, lower(actor.email), who.label, prev.id).run();
        await moveTask(env, prev.task_id, due);
        out.updated++;
        out.people.push(email);
      }
      continue;
    }
    if (done) {
      // Finished already: the record shows it, nobody gets a task or a notice.
      if (prev) await env.DB.prepare("UPDATE learn_assignments SET closed_at = ?, closed_why = 'complete' WHERE id = ?").bind(now, prev.id).run();
      else
        await env.DB.prepare(`INSERT INTO learn_assignments (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'complete')`)
          .bind(id('asg'), email, input.kind, target.id, due, source, who.label, note, lower(actor.email), now, now)
          .run();
      out.already_done++;
      continue;
    }
    const taskTitle = `Finish: ${target.title}`;
    let aid: string;
    if (prev) {
      aid = prev.id;
      // Given again after it was removed or finished: the same row opens again.
      await env.DB.prepare('UPDATE learn_assignments SET due_date = ?, note = ?, source = ?, group_label = ?, assigned_by = ?, assigned_at = ?, closed_at = NULL, closed_why = NULL WHERE id = ?')
        .bind(due, note, source, who.label, lower(actor.email), now, aid)
        .run();
      if (prev.task_id) await reopenTask(env, prev.task_id, due);
      else {
        const tid = await makeTask(env, { email, title: taskTitle, due, by: lower(actor.email), href, note });
        if (tid) await env.DB.prepare('UPDATE learn_assignments SET task_id = ? WHERE id = ?').bind(tid, aid).run();
      }
      out.reopened++;
    } else {
      aid = id('asg');
      const tid = await makeTask(env, { email, title: taskTitle, due, by: lower(actor.email), href, note });
      if (tid) out.tasks++;
      await env.DB.prepare(`INSERT INTO learn_assignments (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
        .bind(aid, email, input.kind, target.id, due, source, who.label, note, lower(actor.email), now, tid)
        .run();
      out.created++;
    }
    out.people.push(email);
    if (await tell(env, 'assigned', facts(aid), actor)) out.told++;
  }
  return out;
}

export async function removeAssignment(env: Env, actor: Actor, assignmentId: string): Promise<void> {
  const a = await env.DB.prepare(`SELECT ${COLS} FROM learn_assignments WHERE id = ?`).bind(assignmentId).first<AssignmentRow>();
  if (!a) throw new HttpError(404, 'not_found', 'That assignment is gone.');
  if (a.closed_at) return;
  await env.DB.prepare("UPDATE learn_assignments SET closed_at = ?, closed_why = 'removed' WHERE id = ?").bind(nowIso(), a.id).run();
  await closeTask(env, a.task_id, 'dropped', lower(actor.email));
}

export async function openAssignments(env: Env, email: string): Promise<AssignmentRow[]> {
  return ((await env.DB.prepare(`SELECT ${COLS} FROM learn_assignments WHERE email = ? AND closed_at IS NULL ORDER BY due_date IS NULL, due_date, assigned_at`).bind(lower(email)).all<AssignmentRow>()).results || []) as AssignmentRow[];
}

export async function allAssignments(env: Env, email: string): Promise<AssignmentRow[]> {
  return ((await env.DB.prepare(`SELECT ${COLS} FROM learn_assignments WHERE email = ? ORDER BY assigned_at DESC`).bind(lower(email)).all<AssignmentRow>()).results || []) as AssignmentRow[];
}

/**
 * Closes the person's open assignments whose courses are all complete, and closes their tasks. Called after every completion and
 * whenever My learning loads, so an assignment never stays open for work that is done.
 */
export async function settleAssignments(env: Env, email: string): Promise<number> {
  const me = lower(email);
  const open = await openAssignments(env, me);
  let closed = 0;
  for (const a of open) {
    const courses = a.kind === 'course' ? [a.target_id] : await pathCoursesOf(env, a.target_id);
    if (!(await allDone(env, me, courses))) continue;
    await env.DB.prepare("UPDATE learn_assignments SET closed_at = ?, closed_why = 'complete' WHERE id = ? AND closed_at IS NULL").bind(nowIso(), a.id).run();
    await closeTask(env, a.task_id, 'done', me);
    closed++;
  }
  return closed;
}
