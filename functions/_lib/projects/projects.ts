// Projects, their sections and their members.
import { HttpError, newId, nowIso, type Env } from '../http';
import type { Person } from '../people';
import { need, projectStanding, visibleProject, type Actor } from './access';
import {
  COLORS,
  addEvent,
  asDate,
  asEmail,
  asText,
  brief,
  directory,
  lower,
  membersOf,
  oneOf,
  person,
  projectOf,
  sectionsOf,
  todayEastern,
  type ProjectRow,
} from './db';

const KEY = /^[A-Z]{2,5}$/;
const VISIBILITY = ['staff', 'members'] as const;
const PROJECT_STATUS = ['active', 'paused', 'done', 'archived'] as const;

export interface ProjectOut extends ProjectRow {
  open: number;
  done: number;
  overdue: number;
  lead: { email: string; name: string; picture: string } | null;
}

/** Open, done and overdue counts for each project, from the status index alone. Top-level tasks only; dropped ones do not count. */
export async function countsFor(env: Env, ids: string[], today = todayEastern()): Promise<Map<string, { open: number; done: number; overdue: number }>> {
  const out = new Map<string, { open: number; done: number; overdue: number }>();
  if (!ids.length) return out;
  const r = await env.DB.prepare(
    `SELECT project_id,
            SUM(CASE WHEN status NOT IN ('done', 'dropped') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status NOT IN ('done', 'dropped') AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
       FROM hub_tasks WHERE project_id IS NOT NULL AND parent_id IS NULL AND status <> 'dropped' GROUP BY project_id`
  )
    .bind(today)
    .all<{ project_id: string; open: number; done: number; overdue: number }>();
  const want = new Set(ids);
  for (const row of r.results || []) if (want.has(row.project_id)) out.set(row.project_id, { open: Number(row.open) || 0, done: Number(row.done) || 0, overdue: Number(row.overdue) || 0 });
  return out;
}

export async function listProjects(env: Env, actor: Actor): Promise<ProjectOut[]> {
  const v = visibleProject(actor, 'p');
  const rows = await env.DB.prepare(`SELECT p.* FROM hub_projects p WHERE ${v.sql} ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, p.name COLLATE NOCASE`)
    .bind(...v.args)
    .all<ProjectRow>();
  const list = rows.results || [];
  const [counts, dir] = await Promise.all([countsFor(env, list.map((p) => p.id)), directory(env)]);
  return list.map((p) => shapeProject(p, counts.get(p.id), dir));
}

export function shapeProject(p: ProjectRow, c: { open: number; done: number; overdue: number } | undefined, dir: Map<string, Person>): ProjectOut {
  return { ...p, open: c?.open || 0, done: c?.done || 0, overdue: c?.overdue || 0, lead: brief(dir, p.lead_email) };
}

/** Eight bare letters from the name, then a number, until one is free. An explicit key that is taken is a 409. */
async function freeKey(env: Env, wanted: string, name: string): Promise<string> {
  const taken = async (k: string) => !!(await env.DB.prepare('SELECT 1 AS ok FROM hub_projects WHERE key = ?').bind(k).first());
  if (wanted) {
    const k = wanted.toUpperCase();
    if (!KEY.test(k)) throw new HttpError(400, 'bad_key', 'A key is 2 to 5 capital letters, like MKT.');
    if (await taken(k)) throw new HttpError(409, 'key_taken', `The key ${k} is already used by another project.`);
    return k;
  }
  const letters = name.toUpperCase().replace(/[^A-Z ]/g, '');
  const words = letters.split(/\s+/).filter(Boolean);
  const base = (words.length > 1 ? words.map((w) => w[0]).join('') : letters.replace(/ /g, '')).slice(0, 5).padEnd(2, 'X');
  const tries = [base, letters.replace(/ /g, '').slice(0, 3).padEnd(2, 'X'), letters.replace(/ /g, '').slice(0, 4).padEnd(2, 'X')];
  for (const t of tries) if (KEY.test(t) && !(await taken(t))) return t;
  for (let i = 0; i < 26 * 26; i++) {
    const t = base.slice(0, 3) + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    if (KEY.test(t) && !(await taken(t))) return t;
  }
  throw new HttpError(409, 'key_taken', 'Pick a key for this project.');
}

export async function createProject(env: Env, actor: Actor, b: Record<string, unknown>): Promise<ProjectRow> {
  const name = asText(b.name, 'name', 120, true);
  const dir = await directory(env);
  const lead = asEmail(b.lead_email, 'lead_email') || (actor.email.includes('@') ? actor.email : null);
  if (!lead) throw new HttpError(400, 'missing_field', 'lead_email is required.');
  const key = await freeKey(env, typeof b.key === 'string' ? b.key.trim() : '', name);
  const now = nowIso();
  const p: ProjectRow = {
    id: newId('prj'),
    key,
    name,
    description: asText(b.description, 'description', 4000),
    team: asText(b.team, 'team', 60),
    lead_email: lead,
    visibility: b.visibility === undefined ? 'staff' : oneOf(b.visibility, VISIBILITY, 'visibility'),
    status: 'active',
    color: b.color === undefined ? 'leaf' : oneOf(b.color, COLORS, 'color'),
    start_date: asDate(b.start_date, 'start_date'),
    due_date: asDate(b.due_date, 'due_date'),
    chat_channel_id: null,
    drive_folder_id: null,
    next_num: 1,
    created_by: actor.email,
    created_at: now,
    updated_at: now,
  };
  const members = new Set<string>([lead]);
  if (actor.email.endsWith('@favorintl.org')) members.add(actor.email);
  for (const e of Array.isArray(b.members) ? b.members : []) {
    const m = asEmail(e, 'members');
    if (m && (dir.has(m) || m === lead)) members.add(m);
  }
  await env.DB.prepare(
    `INSERT INTO hub_projects (id, key, name, description, team, lead_email, visibility, status, color, start_date, due_date, next_num, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  )
    .bind(p.id, p.key, p.name, p.description, p.team, p.lead_email, p.visibility, p.status, p.color, p.start_date, p.due_date, p.created_by, now, now)
    .run();
  await env.DB.batch(
    [...members].map((e) =>
      env.DB.prepare('INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, ?, ?)').bind(p.id, e, e === lead ? 'lead' : 'member', now)
    )
  );
  await addEvent(env, { project_id: p.id, actor: actor.email, kind: 'project_created', detail: { key } });
  return p;
}

const EDITABLE = ['name', 'description', 'team', 'lead_email', 'visibility', 'status', 'color', 'start_date', 'due_date', 'chat_channel_id', 'drive_folder_id'] as const;

export async function patchProject(env: Env, actor: Actor, idOrKey: string, b: Record<string, unknown>): Promise<{ project: ProjectRow; changed: string[] }> {
  const p = await projectOf(env, idOrKey);
  const st = await projectStanding(env, actor, p);
  need(st.manage, 'Only the project lead or a FavorOS admin can change a project.');
  const next: Record<string, unknown> = { ...p };
  const changed: string[] = [];
  const set = (k: string, v: unknown) => {
    if (next[k] !== v) {
      next[k] = v;
      changed.push(k);
    }
  };
  if ('name' in b) set('name', asText(b.name, 'name', 120, true));
  if ('description' in b) set('description', asText(b.description, 'description', 4000));
  if ('team' in b) set('team', asText(b.team, 'team', 60));
  if ('lead_email' in b) {
    const e = asEmail(b.lead_email, 'lead_email');
    if (!e) throw new HttpError(400, 'missing_field', 'A project needs a lead.');
    set('lead_email', e);
  }
  if ('visibility' in b) set('visibility', oneOf(b.visibility, VISIBILITY, 'visibility'));
  if ('status' in b) set('status', oneOf(b.status, PROJECT_STATUS, 'status'));
  if (b.archive === true) set('status', 'archived');
  if ('color' in b) set('color', oneOf(b.color, COLORS, 'color'));
  if ('start_date' in b) set('start_date', asDate(b.start_date, 'start_date'));
  if ('due_date' in b) set('due_date', asDate(b.due_date, 'due_date'));
  if ('chat_channel_id' in b) set('chat_channel_id', b.chat_channel_id ? String(b.chat_channel_id).slice(0, 80) : null);
  if ('drive_folder_id' in b) set('drive_folder_id', b.drive_folder_id ? String(b.drive_folder_id).slice(0, 120) : null);
  if (!changed.length) return { project: p, changed };
  const now = nowIso();
  const cols = EDITABLE.filter((k) => changed.includes(k));
  await env.DB.prepare(`UPDATE hub_projects SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((k) => next[k]), now, p.id)
    .run();
  if (changed.includes('lead_email')) {
    await env.DB.prepare(`INSERT INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, 'lead', ?) ON CONFLICT(project_id, email) DO UPDATE SET role = 'lead'`)
      .bind(p.id, next.lead_email, now)
      .run();
    await env.DB.prepare(`UPDATE hub_project_members SET role = 'member' WHERE project_id = ? AND role = 'lead' AND email <> ?`).bind(p.id, next.lead_email).run();
  }
  await addEvent(env, { project_id: p.id, actor: actor.email, kind: 'project_updated', detail: { fields: changed } });
  return { project: { ...(next as unknown as ProjectRow), updated_at: now }, changed };
}

export async function projectDetail(env: Env, actor: Actor, idOrKey: string) {
  const p = await projectOf(env, idOrKey);
  const st = await projectStanding(env, actor, p);
  need(st.see, 'You do not have access to this project.');
  const [sections, mem, dir, counts] = await Promise.all([sectionsOf(env, p.id), membersOf(env, p.id), directory(env), countsFor(env, [p.id])]);
  const c = counts.get(p.id) || { open: 0, done: 0, overdue: 0 };
  return {
    project: shapeProject(p, c, dir),
    sections,
    members: mem.map((m) => ({ ...person(dir, m.email), role: m.role })),
    counts: c,
    row: p,
    standing: st,
  };
}

/* ------------------------------------------------------------------------------------------------ sections */

export async function addSection(env: Env, actor: Actor, idOrKey: string, nameRaw: unknown) {
  const p = await projectOf(env, idOrKey);
  need((await projectStanding(env, actor, p)).edit, 'Only project members can add sections.');
  const name = asText(nameRaw, 'name', 80, true);
  const mx = await env.DB.prepare('SELECT MAX(sort) AS m FROM hub_project_sections WHERE project_id = ?').bind(p.id).first<{ m: number | null }>();
  const s = { id: newId('sec'), project_id: p.id, name, sort: (Number(mx?.m) || 0) + 1000 };
  await env.DB.prepare('INSERT INTO hub_project_sections (id, project_id, name, sort) VALUES (?, ?, ?, ?)').bind(s.id, s.project_id, s.name, s.sort).run();
  return s;
}

async function sectionOf(env: Env, p: ProjectRow, sid: string) {
  const s = await env.DB.prepare('SELECT id, project_id, name, sort FROM hub_project_sections WHERE id = ? AND project_id = ?').bind(sid, p.id).first<{ id: string; project_id: string; name: string; sort: number }>();
  if (!s) throw new HttpError(404, 'not_found', 'Section not found.');
  return s;
}

export async function patchSection(env: Env, actor: Actor, idOrKey: string, sid: string, b: Record<string, unknown>) {
  const p = await projectOf(env, idOrKey);
  need((await projectStanding(env, actor, p)).edit, 'Only project members can change sections.');
  const s = await sectionOf(env, p, sid);
  const name = 'name' in b ? asText(b.name, 'name', 80, true) : s.name;
  let sort = s.sort;
  if ('sort' in b) {
    sort = Number(b.sort);
    if (!Number.isFinite(sort)) throw new HttpError(400, 'bad_value', 'sort must be a number.');
  }
  await env.DB.prepare('UPDATE hub_project_sections SET name = ?, sort = ? WHERE id = ?').bind(name, sort, sid).run();
  return { ...s, name, sort };
}

/** Deleting a section keeps its tasks; they fall to "no section". */
export async function deleteSection(env: Env, actor: Actor, idOrKey: string, sid: string): Promise<void> {
  const p = await projectOf(env, idOrKey);
  need((await projectStanding(env, actor, p)).edit, 'Only project members can remove sections.');
  await sectionOf(env, p, sid);
  await env.DB.batch([
    env.DB.prepare('UPDATE hub_tasks SET section_id = NULL, updated_at = ? WHERE project_id = ? AND section_id = ?').bind(nowIso(), p.id, sid),
    env.DB.prepare('DELETE FROM hub_project_sections WHERE id = ?').bind(sid),
  ]);
}

/* ------------------------------------------------------------------------------------------------ members */

export async function changeMembers(env: Env, actor: Actor, idOrKey: string, b: Record<string, unknown>) {
  const p = await projectOf(env, idOrKey);
  need((await projectStanding(env, actor, p)).manage, 'Only the project lead or a FavorOS admin can change who is on a project.');
  const dir = await directory(env);
  const role = b.role === undefined ? 'member' : oneOf(b.role, ['member', 'lead'] as const, 'role');
  const now = nowIso();
  const add = (Array.isArray(b.add) ? b.add : []).map((e) => lower(e)).filter(Boolean);
  const remove = (Array.isArray(b.remove) ? b.remove : []).map((e) => lower(e)).filter(Boolean);
  for (const e of add) {
    asEmail(e, 'add');
    if (!dir.has(e)) throw new HttpError(400, 'unknown_person', `${e} is not on the staff list.`);
  }
  if (remove.includes(lower(p.lead_email))) throw new HttpError(409, 'lead', 'The project lead stays on the project. Change the lead first.');
  const statements = [
    ...add.map((e) => env.DB.prepare('INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, ?, ?)').bind(p.id, e, role === 'lead' ? 'member' : role, now)),
    ...remove.map((e) => env.DB.prepare('DELETE FROM hub_project_members WHERE project_id = ? AND email = ?').bind(p.id, e)),
  ];
  if (statements.length) await env.DB.batch(statements);
  if (role === 'lead' && add.length === 1) await patchProject(env, actor, p.id, { lead_email: add[0] });
  if (add.length || remove.length) await addEvent(env, { project_id: p.id, actor: actor.email, kind: 'members', detail: { add, remove } });
  const mem = await membersOf(env, p.id);
  return { project: p, added: add, removed: remove, members: mem.map((m) => ({ ...person(dir, m.email), role: m.role })) };
}
