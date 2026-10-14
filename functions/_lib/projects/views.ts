// Saved views: a named filter, kept per person. Reading and writing touch only the caller's own rows.
import { HttpError, newId, nowIso, type Env } from '../http';
import { projectStanding, need, type Actor } from './access';
import { projectOf } from './db';

export interface SavedView {
  id: string;
  project_id: string | null;
  name: string;
  query: Record<string, unknown>;
  created_at: string;
}

const KEYS = ['q', 'owner', 'due', 'status', 'code', 'priority', 'show_done', 'view'];
const MAX_PER_PERSON = 50;

type Row = { id: string; project_id: string | null; name: string; query: string; created_at: string };

const shape = (r: Row): SavedView => {
  let query: Record<string, unknown> = {};
  try {
    query = JSON.parse(r.query || '{}');
  } catch {
    query = {};
  }
  return { id: r.id, project_id: r.project_id, name: r.name, query, created_at: r.created_at };
};

async function ready(env: Env): Promise<void> {
  try {
    await env.DB.prepare('SELECT id FROM hub_task_views LIMIT 1').first();
  } catch {
    throw new HttpError(503, 'not_ready', 'Saved views are not switched on yet.');
  }
}

/** The caller's views for one project (project given) or for My tasks (no project). */
export async function listViews(env: Env, actor: Actor, project?: string): Promise<SavedView[]> {
  await ready(env);
  let pid: string | null = null;
  if (project) {
    const p = await projectOf(env, project);
    need((await projectStanding(env, actor, p)).see, 'You do not have access to this project.');
    pid = p.id;
  }
  const r = await env.DB.prepare('SELECT id, project_id, name, query, created_at FROM hub_task_views WHERE email = ? AND project_id IS ? ORDER BY name').bind(actor.email, pid).all<Row>();
  return (r.results || []).map(shape);
}

export async function saveView(env: Env, actor: Actor, b: Record<string, unknown>): Promise<SavedView> {
  await ready(env);
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'missing_field', 'Name the view.');
  let pid: string | null = null;
  if (b.project_id) {
    const p = await projectOf(env, String(b.project_id));
    need((await projectStanding(env, actor, p)).see, 'You do not have access to this project.');
    pid = p.id;
  }
  const src = b.query && typeof b.query === 'object' && !Array.isArray(b.query) ? (b.query as Record<string, unknown>) : {};
  const query: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = src[k];
    if (typeof v === 'string' && v) query[k] = v.slice(0, 120);
    else if (typeof v === 'boolean' && v) query[k] = v;
  }
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_task_views WHERE email = ?').bind(actor.email).first<{ n: number }>();
  const same = await env.DB.prepare('SELECT id FROM hub_task_views WHERE email = ? AND project_id IS ? AND name = ?').bind(actor.email, pid, name).first<{ id: string }>();
  if (same) {
    await env.DB.prepare('UPDATE hub_task_views SET query = ? WHERE id = ?').bind(JSON.stringify(query), same.id).run();
    const row = await env.DB.prepare('SELECT id, project_id, name, query, created_at FROM hub_task_views WHERE id = ?').bind(same.id).first<Row>();
    return shape(row as Row);
  }
  if ((Number(n?.n) || 0) >= MAX_PER_PERSON) throw new HttpError(400, 'too_many', 'You have 50 saved views. Delete one first.');
  const row: Row = { id: newId('vw'), project_id: pid, name, query: JSON.stringify(query), created_at: nowIso() };
  await env.DB.prepare('INSERT INTO hub_task_views (id, email, project_id, name, query, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, actor.email, row.project_id, row.name, row.query, row.created_at).run();
  return shape(row);
}

export async function deleteView(env: Env, actor: Actor, id: string): Promise<void> {
  await ready(env);
  const r = await env.DB.prepare('DELETE FROM hub_task_views WHERE id = ? AND email = ?').bind(id, actor.email).run();
  if (!r.meta || !r.meta.changes) throw new HttpError(404, 'not_found', 'View not found.');
}
