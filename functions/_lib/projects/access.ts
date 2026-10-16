// Who may use Projects and what each person may do.
//   Setting projects.enabled (hub_settings): admins (default) | staff | off. The gate and nav payloads carry access.projects.
//   A person sees a project when its visibility is staff, or they are a member, the lead or a hub admin.
//   Any member edits its tasks; the lead and admins edit the project and its members.
//   A person always sees a task they own, collaborate on, follow or are mentioned in, even in a project they cannot open.
import { HttpError, type Env } from '../http';
import type { HubUser } from '../session';
import { effective } from '../admin/settings';
import { actorOf, noticeGate, type Actor } from '../requests/tasks';
import { lower, type ProjectRow, type TaskRow } from './db';
import { isTester, TESTERS } from '../testuser';
import { isEarly } from '../early';
import { isMarketing } from '../hub/today';

export { actorOf, noticeGate };
export type { Actor };

export type ProjectsMode = 'admins' | 'staff' | 'off';

export async function projectsMode(env: Env): Promise<ProjectsMode> {
  const v = lower(await effective(env, 'projects.enabled', undefined, 'admins').catch(() => 'admins'));
  return v === 'staff' || v === 'off' ? v : 'admins';
}

export function modeAllows(mode: ProjectsMode, who: { admin: boolean } | null): boolean {
  if (!who || mode === 'off') return false;
  return mode === 'staff' ? true : who.admin;
}

/** The flag the gate and nav answers carry. The agent key counts as an admin; an act-as test counts as that staff member. */
export async function projectsFlag(env: Env, user: HubUser): Promise<boolean> {
  return modeAllows(await projectsMode(env), { admin: user.role === 'admin' });
}

/** The person acting, or the 401 or 403 the route returns as is. */
export async function projectsActor(env: Env, request: Request, user: HubUser | null): Promise<Actor> {
  const actor = actorOf(request, user);
  if (!actor) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const mode = await projectsMode(env);
  if (!modeAllows(mode, actor)) throw new HttpError(403, 'forbidden', mode === 'off' ? 'Projects is switched off.' : 'Projects is open to FavorOS admins for now.');
  const wide = actor.admin || (await isEarly(env, user).catch(() => false)) || (actor.email !== 'agent' && (await isMarketing(env, actor.email).catch(() => false)));
  return { ...actor, wide: wide || user?.via === 'agent' };
}

/**
 * A SQL condition (and its values) for the projects this person can open, written for a query on hub_projects aliased p.
 * Admins see all of them.
 */
export function visibleProject(actor: Actor, p = 'p'): { sql: string; args: unknown[] } {
  const tester = isTester(actor.email);
  // A test project (its lead is a FavorOS Tester) is seen by the testers alone, admins included in the "alone".
  const notTest = tester ? '' : ` AND lower(${p}.lead_email) NOT IN (${TEST_LIST})`;
  if (actor.admin) return { sql: `(1 = 1${notTest})`, args: [] };
  const wideSql = actor.wide !== false ? `${p}.visibility = 'staff' OR ` : '';
  return {
    sql: `((${wideSql}${p}.lead_email = ? OR EXISTS (SELECT 1 FROM hub_project_members m WHERE m.project_id = ${p}.id AND m.email = ?))${notTest})`,
    args: [actor.email, actor.email],
  };
}

const TEST_LIST = TESTERS.map((e) => `'${e}'`).join(', ');

/** A test project: its lead is a FavorOS Tester (the privacy canaries, the Asana sync test). */
export function isTestProject(p: { lead_email?: string | null } | null | undefined): boolean {
  return !!p && isTester(p.lead_email);
}

/** A condition for tasks on hub_tasks aliased t: in a project the person can open, or one they are on. */
export function visibleTask(actor: Actor, t = 't'): { sql: string; args: unknown[] } {
  // Test tasks (in a test project, or made by or given to a tester) are seen by the testers alone.
  const notTest = isTester(actor.email)
    ? ''
    : ` AND lower(COALESCE(${t}.created_by, '')) NOT IN (${TEST_LIST}) AND lower(COALESCE(${t}.owner_email, '')) NOT IN (${TEST_LIST})
        AND NOT EXISTS (SELECT 1 FROM hub_projects xp WHERE xp.id = ${t}.project_id AND lower(xp.lead_email) IN (${TEST_LIST}))`;
  if (actor.admin) return { sql: `(1 = 1${notTest})`, args: [] };
  const vp = visibleProject(actor, 'p');
  return {
    sql: `((${t}.owner_email = ? OR ${t}.created_by = ? OR EXISTS (SELECT 1 FROM hub_task_people tp WHERE tp.task_id = ${t}.id AND tp.email = ?)
      OR (${t}.project_id IS NOT NULL AND EXISTS (SELECT 1 FROM hub_projects p WHERE p.id = ${t}.project_id AND ${vp.sql})))${notTest})`,
    args: [actor.email, actor.email, actor.email, ...vp.args],
  };
}

export interface ProjectStanding {
  see: boolean;
  member: boolean;
  lead: boolean;
  /** Edits the project itself and its members. */
  manage: boolean;
  /** Adds and edits tasks in it. */
  edit: boolean;
}

export async function projectStanding(env: Env, actor: Actor, p: ProjectRow): Promise<ProjectStanding> {
  if (isTestProject(p) && !isTester(actor.email)) return { see: false, member: false, lead: false, manage: false, edit: false };
  const lead = lower(p.lead_email) === actor.email;
  const member = lead || !!(await env.DB.prepare('SELECT 1 AS ok FROM hub_project_members WHERE project_id = ? AND email = ?').bind(p.id, actor.email).first());
  return {
    see: actor.admin || (actor.wide !== false && p.visibility === 'staff') || member,
    member,
    lead,
    manage: actor.admin || lead,
    edit: actor.admin || member,
  };
}

export interface TaskStanding {
  see: boolean;
  /** Changes the task's fields, moves it, adds people and files. */
  edit: boolean;
  /** Deletes it: its creator, the project lead or an admin. */
  remove: boolean;
  project: ProjectRow | null;
  proj: ProjectStanding | null;
}

export async function taskStanding(env: Env, actor: Actor, t: TaskRow, project: ProjectRow | null): Promise<TaskStanding> {
  const roles = await env.DB.prepare('SELECT role FROM hub_task_people WHERE task_id = ? AND email = ?').bind(t.id, actor.email).all<{ role: string }>();
  const mine = (roles.results || []).map((r) => r.role);
  const owner = lower(t.owner_email) === actor.email;
  const collab = mine.includes('collab');
  const on = owner || collab || mine.length > 0 || lower(t.created_by) === actor.email;
  const proj = project ? await projectStanding(env, actor, project) : null;
  if (!isTester(actor.email) && (isTester(t.created_by) || isTester(t.owner_email) || isTestProject(project))) return { see: false, edit: false, remove: false, project, proj };
  if (!proj) {
    return { see: actor.admin || on, edit: actor.admin || owner || collab || lower(t.created_by) === actor.email, remove: actor.admin || lower(t.created_by) === actor.email, project: null, proj: null };
  }
  return {
    see: proj.see || on,
    edit: proj.edit || owner || collab,
    remove: actor.admin || proj.lead || lower(t.created_by) === actor.email,
    project,
    proj,
  };
}

export function need(ok: boolean, message = 'You do not have access to that.'): void {
  if (!ok) throw new HttpError(403, 'forbidden', message);
}
