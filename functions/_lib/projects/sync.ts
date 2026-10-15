// Two-way Asana sync for Projects. Admin > Projects picks the Asana projects that sync and holds the off switch (projects.asana.sync).
//
// One operation does the work in both directions: syncTask() reads the Asana task, compares it field by field with the FavorOS task and
// with the last values both sides agreed on (hub_asana_snap), sends a field changed only in FavorOS to Asana, writes a field changed only
// in Asana into FavorOS, and settles a field changed on both by the later edit (Asana modified_at against hub updated_at), logging it.
// Because both sides end equal to the new snapshot, the webhook echo of our own write finds nothing to do: that is the loop protection,
// with the Asana modified_at check in front of it so an echo costs no extra call.
//
// Ways in: Asana webhooks (POST /api/asana/hook/<project gid>, X-Hook-Secret handshake, HMAC signature) queue task gids in
// hub_asana_inbox; FavorOS changes queue rows in hub_asana_outbox through the project event hook; the drain cron (job asana-sync,
// every 5 minutes) sends both queues and reads anything Asana changed since the last pass (modified_since), so a missed webhook is
// picked up within minutes.
//
// Notices: a change read in from Asana is written straight to the tables. It calls no tell(), so FavorOS sends no notice, email or nudge
// for it: Asana already told the person. A change made in FavorOS is told by FavorOS as always and also lands in Asana.
import { isPipelineProject } from '../intake/pipeline';
import { HttpError, newId, nowIso, type Env } from '../http';
import { hubGet, hubPut, audit } from '../admin/settings';
import { open, seal } from '../hub/google';
import { AsanaApiSource, RateLimited, TASK_FIELDS, taskFromApi, type ATask } from './asana';
import { readToken } from './asana-admin';
import { easternParts, loadPeople, matchPerson, projectKeyCandidates, type PeopleIndex } from './asana-import';
import type { TaskRow } from './db';
import { tokenFor } from './sync-oauth';

export const SYNC_KEY = 'projects.asana.sync';
const WAIT_KEY = 'projects.asana.wait_until';
const HUB_URL = 'https://dash.favorintl.org';
const API = 'https://app.asana.com/api/1.0';
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
const TRAILER = /\n*From Asana:\n[\s\S]*$/;

/* -------------------------------------------------------------------------------------------- settings, log */

export async function syncOn(env: Env): Promise<boolean> {
  return ((await hubGet(env, SYNC_KEY).catch(() => null))?.value || 'off') === 'on';
}

export async function setSync(env: Env, actor: string, on: boolean): Promise<void> {
  const before = (await hubGet(env, SYNC_KEY).catch(() => null))?.value || 'off';
  await hubPut(env, SYNC_KEY, on ? 'on' : 'off', actor);
  await audit(env, { actor, area: 'projects', key: SYNC_KEY, label: 'Asana sync', before, after: on ? 'on' : 'off' });
}

type LogRow = { dir: string; gid?: string; hub?: string; text: string };
async function writeLog(env: Env, rows: LogRow[]) {
  if (!rows.length) return;
  const at = nowIso();
  await env.DB.batch(rows.map((r) => env.DB.prepare('INSERT INTO hub_asana_sync_log (at, dir, gid, hub_id, text) VALUES (?, ?, ?, ?, ?)').bind(at, r.dir, r.gid || '', r.hub || '', r.text.slice(0, 1000)))).catch(() => null);
}

/* ----------------------------------------------------------------------------------------------- the client */

export class AsanaError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

/** Reads and writes with one token. Counts calls; a 429 records the wait in hub settings so every pass holds off until then. */
export class Asana {
  calls = 0;
  env: Env;
  token: string;
  via: 'pat' | 'oauth';
  f: typeof fetch;
  constructor(env: Env, token: string, via: 'pat' | 'oauth' = 'pat', f: typeof fetch = (i, init) => fetch(i, init)) {
    this.env = env;
    this.token = token;
    this.via = via;
    this.f = f;
  }
  async req(method: string, path: string, body?: unknown, form?: FormData): Promise<any> {
    this.calls++;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    let payload: BodyInit | undefined;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify({ data: body });
    }
    const res = await this.f(API + path, { method, headers, body: payload });
    if (res.status === 429) {
      const wait = Math.max(5, Number(res.headers.get('Retry-After')) || 60);
      await hubPut(this.env, WAIT_KEY, new Date(Date.now() + wait * 1000).toISOString(), 'system').catch(() => null);
      throw new RateLimited(wait);
    }
    const text = await res.text();
    let j: any = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      j = null;
    }
    if (!res.ok) throw new AsanaError(res.status, `${method} ${path.split('?')[0]} answered ${res.status}: ${(j?.errors?.[0]?.message || text).slice(0, 200)}`);
    return j ? (j.next_page !== undefined ? { data: j.data, next: j.next_page?.offset || null } : j.data) : null;
  }
  async task(gid: string, projectGid = ''): Promise<ATask | null> {
    try {
      const r = await this.req('GET', `/tasks/${gid}?opt_fields=${TASK_FIELDS}`);
      return taskFromApi(r, projectGid);
    } catch (err) {
      if (err instanceof AsanaError && err.status === 404) return null;
      throw err;
    }
  }
}

async function patClient(env: Env): Promise<Asana> {
  const t = await readToken(env);
  if (!t) throw new HttpError(409, 'no_token', 'Save an Asana token in Admin > Projects first.');
  return new Asana(env, t, 'pat');
}

/** The client a change made by this person goes out with: their own Asana connection when they made one, Will's token otherwise. */
async function clientFor(env: Env, email: string, pat: Asana): Promise<Asana> {
  const own = email ? await tokenFor(env, email).catch(() => null) : null;
  return own ? new Asana(env, own, 'oauth') : pat;
}

async function waiting(env: Env): Promise<boolean> {
  const w = (await hubGet(env, WAIT_KEY).catch(() => null))?.value;
  return !!w && w > nowIso();
}

/* ------------------------------------------------------------------------------------------- the mapping */

export interface SyncProject {
  project_gid: string;
  hub_project_id: string;
  name: string;
  enabled: number;
  webhook_gid: string | null;
  webhook_secret: string | null;
  webhook_at: string | null;
  last_event_at: string | null;
  last_reconcile: string | null;
  sub_cursor: number;
}

export async function syncRows(env: Env): Promise<SyncProject[]> {
  const r = await env.DB.prepare('SELECT * FROM hub_asana_sync_projects ORDER BY name').all<SyncProject>().catch(() => ({ results: [] as SyncProject[] }));
  return r.results || [];
}

/** The Asana project a FavorOS project syncs with, when its sync is on. */
export async function syncedProject(env: Env, hubProjectId: string | null): Promise<SyncProject | null> {
  if (!hubProjectId) return null;
  return env.DB.prepare('SELECT * FROM hub_asana_sync_projects WHERE hub_project_id = ? AND enabled = 1').bind(hubProjectId).first<SyncProject>().catch(() => null);
}

async function mapGid(env: Env, kind: string, hubId: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT gid FROM hub_asana_map WHERE kind = ? AND hub_id = ? LIMIT 1').bind(kind, hubId).first<{ gid: string }>();
  return r?.gid || null;
}
async function mapHub(env: Env, kind: string, gid: string): Promise<{ hub_id: string; asana_modified: string; synced_at: string; project_gid: string } | null> {
  return env.DB.prepare('SELECT hub_id, asana_modified, synced_at, project_gid FROM hub_asana_map WHERE kind = ? AND gid = ?').bind(kind, gid).first();
}
function mapPut(env: Env, kind: string, gid: string, hubId: string, projectGid: string, modified = '') {
  return env.DB.prepare(
    `INSERT INTO hub_asana_map (kind, gid, hub_id, project_gid, hash, asana_modified, synced_at, first_run) VALUES (?, ?, ?, ?, 'sync', ?, ?, 'sync')
     ON CONFLICT(kind, gid) DO UPDATE SET hub_id = excluded.hub_id, asana_modified = CASE WHEN excluded.asana_modified <> '' THEN excluded.asana_modified ELSE hub_asana_map.asana_modified END, synced_at = excluded.synced_at`
  ).bind(kind, gid, hubId, projectGid, modified, nowIso());
}

/** Asana's link to a FavorOS task, for the "Open in Asana" label. */
export async function asanaUrlFor(env: Env, taskId: string): Promise<string | null> {
  const r = await env.DB.prepare(
    `SELECT m.gid, m.project_gid FROM hub_asana_map m JOIN hub_tasks t ON t.id = m.hub_id JOIN hub_asana_sync_projects s ON s.hub_project_id = t.project_id AND s.enabled = 1
      WHERE m.kind = 'task' AND m.hub_id = ? LIMIT 1`
  ).bind(taskId).first<{ gid: string; project_gid: string }>().catch(() => null);
  return r ? `https://app.asana.com/0/${r.project_gid || '0'}/${r.gid}` : null;
}

/* ------------------------------------------------------------------------------------------------ fields */

interface Fields {
  name: string;
  notes: string;
  assignee: string;
  due_on: string;
  due_time: string;
  start_on: string;
  completed: boolean;
  section: string;
}
const KEYS: (keyof Fields)[] = ['name', 'notes', 'assignee', 'due_on', 'due_time', 'start_on', 'completed', 'section'];

function fromHub(t: TaskRow, sectionGid: string): Fields {
  return {
    name: String(t.title || '').trim(),
    notes: String(t.description || '').replace(TRAILER, '').trimEnd(),
    assignee: lower(t.owner_email),
    due_on: t.due_date || '',
    due_time: t.due_date ? t.due_time || '' : '',
    start_on: t.start_date || '',
    completed: t.status === 'done',
    section: t.parent_id ? '' : sectionGid,
  };
}

function fromAsana(a: ATask, people: PeopleIndex, isSub: boolean): Fields {
  const due = a.due_at ? easternParts(a.due_at) : null;
  const start = a.start_at ? easternParts(a.start_at) : null;
  return {
    name: a.name.trim() || '(untitled)',
    notes: a.notes.trimEnd(),
    assignee: matchPerson(people, a.assignee).email || '',
    due_on: due?.date || a.due_on || '',
    due_time: due?.time || '',
    start_on: start?.date || a.start_on || '',
    completed: a.completed,
    section: isSub ? '' : a.section?.gid || '',
  };
}

/** Eastern date and time to a UTC ISO time. */
function easternToIso(date: string, time: string): string {
  for (const off of ['-04:00', '-05:00']) {
    const iso = new Date(`${date}T${time}:00${off}`).toISOString();
    const p = easternParts(iso);
    if (p && p.date === date && p.time === time) return iso;
  }
  return new Date(`${date}T${time}:00-05:00`).toISOString();
}

/** The body for a PUT or POST to Asana from the fields that changed. */
function asanaBody(f: Partial<Fields>, all: Fields): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if ('name' in f) b.name = f.name;
  if ('notes' in f) b.notes = f.notes;
  if ('assignee' in f) b.assignee = f.assignee || null;
  if ('completed' in f) b.completed = f.completed;
  if ('due_on' in f || 'due_time' in f) {
    if (!all.due_on) {
      b.due_on = null;
      b.due_at = null;
    } else if (all.due_time) b.due_at = easternToIso(all.due_on, all.due_time);
    else b.due_on = all.due_on;
  }
  if ('start_on' in f || ('due_on' in f && all.start_on)) b.start_on = all.due_on && all.start_on && all.start_on <= all.due_on ? all.start_on : null;
  return b;
}

/* ------------------------------------------------------------------------------------------- one task, both ways */

export interface SyncCtx {
  env: Env;
  pat: Asana;
  people: PeopleIndex;
  log: LogRow[];
  calls: () => number;
}

export async function newCtx(env: Env): Promise<SyncCtx> {
  const pat = await patClient(env);
  const extra: Asana[] = [];
  return { env, pat, people: await loadPeople(env), log: [], calls: () => pat.calls + extra.reduce((n, a) => n + a.calls, 0) };
}

async function hubSection(c: SyncCtx, sp: SyncProject, gid: string, name: string): Promise<string | null> {
  if (!gid) return null;
  const m = await mapHub(c.env, 'section', gid);
  if (m) return m.hub_id;
  const id = newId('sec');
  const n = await c.env.DB.prepare('SELECT COALESCE(MAX(sort), 0) + 1024 AS s FROM hub_project_sections WHERE project_id = ?').bind(sp.hub_project_id).first<{ s: number }>();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO hub_project_sections (id, project_id, name, sort) VALUES (?, ?, ?, ?)').bind(id, sp.hub_project_id, name || 'Section', n?.s || 1024),
    mapPut(c.env, 'section', gid, id, sp.project_gid),
  ]);
  return id;
}

async function asanaSection(c: SyncCtx, client: Asana, sp: SyncProject, hubSectionId: string | null): Promise<string> {
  if (!hubSectionId) return '';
  const g = await mapGid(c.env, 'section', hubSectionId);
  if (g) return g;
  const s = await c.env.DB.prepare('SELECT name FROM hub_project_sections WHERE id = ?').bind(hubSectionId).first<{ name: string }>();
  if (!s) return '';
  const made = await client.req('POST', `/projects/${sp.project_gid}/sections`, { name: s.name });
  await mapPut(c.env, 'section', made.gid, hubSectionId, sp.project_gid).run();
  return made.gid as string;
}

/**
 * Brings one task level on both sides. Give the Asana gid (an inbound change, with the task already read when a list gave it), or the
 * hub task (an outbound change, made by actor). Returns what it did.
 */
export async function syncTask(
  c: SyncCtx,
  sp: SyncProject,
  o: { gid?: string; prefetched?: ATask | null; hub?: TaskRow; actor?: string; deleted?: boolean }
): Promise<string> {
  const env = c.env;
  let gid = o.gid || (o.hub ? await mapGid(env, 'task', o.hub.id) : null) || '';
  let hub: TaskRow | null = o.hub || null;
  const m = gid ? await mapHub(env, 'task', gid) : null;
  if (!hub && m) hub = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ?').bind(m.hub_id).first<TaskRow>();
  const client = o.actor ? await clientFor(env, o.actor, c.pat) : c.pat;

  // A FavorOS task Asana has not seen: make it there.
  if (hub && !gid) {
    if (hub.project_id !== sp.hub_project_id) return 'other project';
    let parentGid = '';
    if (hub.parent_id) {
      parentGid = (await mapGid(env, 'task', hub.parent_id)) || '';
      if (!parentGid) throw new Error('retry: the parent task is not in Asana yet');
    }
    const secGid = parentGid ? '' : await asanaSection(c, client, sp, hub.section_id);
    const f = fromHub(hub, secGid);
    const body: Record<string, unknown> = asanaBody({ name: f.name, notes: f.notes, assignee: f.assignee, completed: f.completed, due_on: f.due_on, start_on: f.start_on }, f);
    if (!parentGid) body.projects = [sp.project_gid];
    if (secGid) body.memberships = [{ project: sp.project_gid, section: secGid }];
    let made: any;
    try {
      made = await client.req('POST', parentGid ? `/tasks/${parentGid}/subtasks` : '/tasks', body);
    } catch (err) {
      if (!(err instanceof AsanaError && err.status === 400 && body.assignee)) throw err;
      delete body.assignee; // the person has no Asana account in this workspace
      made = await client.req('POST', parentGid ? `/tasks/${parentGid}/subtasks` : '/tasks', body);
      c.log.push({ dir: 'info', gid: made.gid, hub: hub.id, text: `${hub.owner_email} has no Asana account, so the task has no assignee there` });
      f.assignee = '';
    }
    gid = made.gid;
    const full = await client.task(gid, sp.project_gid);
    const snap = full ? fromAsana(full, c.people, !!parentGid) : f;
    await env.DB.batch([
      mapPut(env, 'task', gid, hub.id, sp.project_gid, full?.modified_at || ''),
      env.DB.prepare('INSERT INTO hub_asana_snap (gid, hub_id, fields, at) VALUES (?, ?, ?, ?) ON CONFLICT(gid) DO UPDATE SET fields = excluded.fields, at = excluded.at').bind(gid, hub.id, JSON.stringify({ ...snap, assignee: f.assignee || snap.assignee }), nowIso()),
    ]);
    c.log.push({ dir: 'out', gid, hub: hub.id, text: `made in Asana (${client.via})${parentGid ? ' as a subtask' : ''}: ${f.name}` });
    return 'created in Asana';
  }

  // Deleted in Asana: dropped here, never removed.
  let a: ATask | null = o.prefetched ?? null;
  if (!a && gid && !o.deleted) a = await c.pat.task(gid, sp.project_gid);
  if (!a) {
    if (hub && hub.status !== 'dropped' && hub.status !== 'done') {
      await env.DB.batch([
        env.DB.prepare("UPDATE hub_tasks SET status = 'dropped', updated_at = ? WHERE id = ?").bind(nowIso(), hub.id),
        env.DB.prepare("INSERT INTO hub_task_events (id, task_id, project_id, actor_email, kind, detail, created_at) VALUES (?, ?, ?, 'asana', 'updated', ?, ?)").bind(newId('evt'), hub.id, hub.project_id, JSON.stringify({ fields: ['status'], note: 'deleted in Asana' }), nowIso()),
      ]);
      c.log.push({ dir: 'in', gid, hub: hub.id, text: 'deleted in Asana, set to dropped' });
      return 'dropped';
    }
    return 'gone';
  }
  const isSub = !!a.parent;
  // A top-level task with no section under this project has left it (moved to another project); FavorOS keeps its copy as is.
  if (!isSub && !a.section) return 'not in this project';

  // An Asana task FavorOS has not seen: make it here (unless a FavorOS create for it is still on its way out).
  if (!hub) {
    const busy = await env.DB.prepare("SELECT 1 FROM hub_asana_outbox WHERE kind = 'task' AND status = 'working' AND next_at > ? LIMIT 1").bind(nowIso()).first();
    if (busy) throw new Error('retry: a FavorOS task is being created in Asana');
    let parentId: string | null = null;
    if (a.parent) {
      const pm = await mapHub(env, 'task', a.parent);
      if (!pm) return 'parent not in FavorOS';
      parentId = pm.hub_id;
    }
    const f = fromAsana(a, c.people, isSub);
    const section = isSub ? (await env.DB.prepare('SELECT section_id FROM hub_tasks WHERE id = ?').bind(parentId).first<{ section_id: string | null }>())?.section_id || null : await hubSection(c, sp, f.section, a.section?.name || '');
    const proj = await env.DB.prepare('SELECT key, lead_email FROM hub_projects WHERE id = ?').bind(sp.hub_project_id).first<{ key: string; lead_email: string }>();
    const n = await env.DB.prepare('UPDATE hub_projects SET next_num = next_num + 1 WHERE id = ? RETURNING next_num - 1 AS n').bind(sp.hub_project_id).first<{ n: number }>();
    const id = newId('tsk');
    const now = nowIso();
    const creator = matchPerson(c.people, a.created_by).email || proj?.lead_email || 'asana';
    const sortRow = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) + 1024 AS s FROM hub_tasks WHERE project_id = ? AND parent_id IS ?').bind(sp.hub_project_id, parentId).first<{ s: number }>();
    const stmts = [
      env.DB.prepare(
        `INSERT INTO hub_tasks (id, project_id, section_id, code, title, description, status, priority, owner_email, start_date, due_date, due_time, done_at, done_by, parent_id, sort, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, sp.hub_project_id, section, `${proj?.key || 'AS'}-${String(n?.n ?? 0).padStart(4, '0')}`, f.name.slice(0, 300), f.notes.slice(0, 20000), f.completed ? 'done' : 'open',
        f.assignee || null, f.start_on || null, f.due_on || null, f.due_time || null, f.completed ? a.completed_at || now : null, f.completed ? matchPerson(c.people, a.completed_by).email : null,
        parentId, sortRow?.s || 1024, creator, a.created_at || now, now),
      mapPut(env, 'task', a.gid, id, sp.project_gid, a.modified_at),
      env.DB.prepare('INSERT INTO hub_asana_snap (gid, hub_id, fields, at) VALUES (?, ?, ?, ?) ON CONFLICT(gid) DO UPDATE SET hub_id = excluded.hub_id, fields = excluded.fields, at = excluded.at').bind(a.gid, id, JSON.stringify(f), now),
      env.DB.prepare("INSERT INTO hub_task_events (id, task_id, project_id, actor_email, kind, detail, created_at) VALUES (?, ?, ?, 'asana', 'created', ?, ?)").bind(newId('evt'), id, sp.hub_project_id, JSON.stringify({ title: f.name, asana: a.gid }), now),
      ...extrasStmts(c, id, a),
    ];
    if (f.assignee) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, 'member', ?)").bind(sp.hub_project_id, f.assignee, now));
    await env.DB.batch(stmts);
    c.log.push({ dir: 'in', gid: a.gid, hub: id, text: `made in FavorOS: ${f.name}` });
    await storiesAndFiles(c, sp, a, id);
    if (a.num_subtasks > 0) await subtasksOf(c, sp, a.gid);
    return 'created in FavorOS';
  }

  // Both sides have it. An echo of our own last write, with no FavorOS change since, needs nothing.
  const snapRow = await env.DB.prepare('SELECT fields, at FROM hub_asana_snap WHERE gid = ?').bind(gid).first<{ fields: string; at: string }>();
  if (snapRow && m && m.asana_modified && a.modified_at <= m.asana_modified && hub.updated_at <= snapRow.at && !o.actor) return 'same';
  const secGid = isSub ? '' : (await mapGid(env, 'section', hub.section_id || '')) || (hub.section_id ? await asanaSection(c, client, sp, hub.section_id) : '');
  const h = fromHub(hub, secGid);
  const av = fromAsana(a, c.people, isSub);
  let base: Fields | null = null;
  try {
    base = snapRow ? (JSON.parse(snapRow.fields) as Fields) : null;
  } catch {
    base = null;
  }
  const hubNewer = hub.updated_at > a.modified_at;
  // No snapshot yet (a task brought over by the one-time import): each side counts as changed if it was edited after the import.
  const hubEdited = base ? null : !!(m && hub.updated_at > m.synced_at);
  const asanaEdited = base ? null : !!(m && m.asana_modified && a.modified_at > m.asana_modified);
  const toAsana: Partial<Fields> = {};
  const toHub: Partial<Fields> = {};
  for (const k of KEYS) {
    const hv = h[k];
    const avk = av[k];
    if (hv === avk) continue;
    // A FavorOS task with no section takes Asana's (Asana always has one).
    if (k === 'section' && !hv) {
      if (avk) (toHub as any)[k] = avk;
      continue;
    }
    // An Asana assignee with no FavorOS account reads as nobody here, so it is never pushed over or cleared.
    if (k === 'assignee' && !avk && a.assignee) continue;
    let hCh: boolean;
    let aCh: boolean;
    if (base) {
      hCh = hv !== base[k];
      aCh = avk !== base[k];
    } else {
      hCh = !!hubEdited;
      aCh = !!asanaEdited || !hubEdited;
    }
    if (hCh && aCh) {
      const win = hubNewer ? 'FavorOS' : 'Asana';
      c.log.push({ dir: 'conflict', gid, hub: hub.id, text: `${k}: FavorOS "${String(hv).slice(0, 80)}" (${hub.updated_at}), Asana "${String(avk).slice(0, 80)}" (${a.modified_at}); ${win} wins` });
      if (hubNewer) (toAsana as any)[k] = hv;
      else (toHub as any)[k] = avk;
    } else if (hCh) (toAsana as any)[k] = hv;
    else if (aCh) (toHub as any)[k] = avk;
  }
  const merged: Fields = { ...h, ...toHub };
  let modified = a.modified_at;
  const done: string[] = [];

  if (Object.keys(toAsana).length) {
    const body = asanaBody(toAsana, merged);
    const sectionMove = 'section' in toAsana && toAsana.section;
    if (Object.keys(body).length) {
      try {
        await client.req('PUT', `/tasks/${gid}`, body);
      } catch (err) {
        if (!(err instanceof AsanaError && err.status === 400 && 'assignee' in body)) throw err;
        delete body.assignee;
        if (Object.keys(body).length) await client.req('PUT', `/tasks/${gid}`, body);
        c.log.push({ dir: 'info', gid, hub: hub.id, text: `${merged.assignee} has no Asana account; the Asana assignee was left as it was` });
      }
    }
    if (sectionMove) await client.req('POST', `/sections/${toAsana.section}/addTask`, { task: gid });
    const after = await client.task(gid, sp.project_gid);
    if (after) modified = after.modified_at;
    done.push(`to Asana (${client.via}): ${Object.keys(toAsana).join(', ')}`);
  }

  const fieldStmts = extrasStmts(c, hub.id, a);
  if (Object.keys(toHub).length) {
    const now = nowIso();
    const sets: string[] = [];
    const args: unknown[] = [];
    if ('name' in toHub) { sets.push('title = ?'); args.push(merged.name.slice(0, 300)); }
    if ('notes' in toHub) { sets.push('description = ?'); args.push(merged.notes.slice(0, 20000)); }
    if ('assignee' in toHub) { sets.push('owner_email = ?'); args.push(merged.assignee || null); }
    if ('due_on' in toHub || 'due_time' in toHub) { sets.push('due_date = ?', 'due_time = ?'); args.push(merged.due_on || null, merged.due_time || null); }
    if ('start_on' in toHub) { sets.push('start_date = ?'); args.push(merged.start_on || null); }
    if ('completed' in toHub) {
      if (merged.completed) { sets.push("status = 'done'", 'done_at = ?', 'done_by = ?'); args.push(a.completed_at || now, matchPerson(c.people, a.completed_by).email); }
      else { sets.push("status = CASE WHEN status = 'done' THEN 'open' ELSE status END", 'done_at = NULL', 'done_by = NULL'); }
    }
    if ('section' in toHub) { sets.push('section_id = ?'); args.push(await hubSection(c, sp, merged.section, a.section?.name || '')); }
    sets.push('updated_at = ?');
    args.push(now);
    fieldStmts.push(env.DB.prepare(`UPDATE hub_tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...args, hub.id));
    fieldStmts.push(env.DB.prepare("INSERT INTO hub_task_events (id, task_id, project_id, actor_email, kind, detail, created_at) VALUES (?, ?, ?, 'asana', 'updated', ?, ?)").bind(newId('evt'), hub.id, hub.project_id, JSON.stringify({ fields: Object.keys(toHub), from: 'asana' }), now));
    if (merged.assignee && 'assignee' in toHub) fieldStmts.push(env.DB.prepare("INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, 'member', ?)").bind(sp.hub_project_id, merged.assignee, now));
    done.push(`to FavorOS: ${Object.keys(toHub).join(', ')}`);
  }
  const snapAt = nowIso();
  await env.DB.batch([
    ...fieldStmts,
    mapPut(env, 'task', gid, hub.id, sp.project_gid, modified),
    env.DB.prepare('INSERT INTO hub_asana_snap (gid, hub_id, fields, at) VALUES (?, ?, ?, ?) ON CONFLICT(gid) DO UPDATE SET fields = excluded.fields, at = excluded.at').bind(gid, hub.id, JSON.stringify(merged), snapAt),
  ]);
  // Comments and files changed in Asana (the task's modified_at moves when one is added).
  if (!m || !m.asana_modified || a.modified_at > m.asana_modified) await storiesAndFiles(c, sp, a, hub.id);
  if (done.length) c.log.push({ dir: Object.keys(toAsana).length ? 'out' : 'in', gid, hub: hub.id, text: done.join('; ') });
  return done.join('; ') || 'same';
}

/** Followers, tags and custom fields from Asana. Followers are only added; tags and fields are replaced. */
function extrasStmts(c: SyncCtx, hubId: string, a: ATask): D1PreparedStatement[] {
  const env = c.env;
  const out: D1PreparedStatement[] = [];
  for (const f of a.followers) {
    const e = matchPerson(c.people, f).email;
    if (e) out.push(env.DB.prepare("INSERT OR IGNORE INTO hub_task_people (task_id, email, role) VALUES (?, ?, 'follower')").bind(hubId, e));
  }
  const rows = [
    ...a.tags.map((x) => ({ kind: 'tag', name: x, value: '' })),
    ...a.fields.map((f) => ({ kind: 'field', name: f.name, value: f.value || f.people.map((p) => p.name || p.email).join(', ') })),
  ];
  if (a.assignee && !matchPerson(c.people, a.assignee).email) rows.push({ kind: 'field', name: 'Asana assignee', value: a.assignee.name || a.assignee.email });
  out.push(env.DB.prepare('DELETE FROM hub_task_fields WHERE task_id = ?').bind(hubId));
  for (const r of rows) out.push(env.DB.prepare('INSERT OR IGNORE INTO hub_task_fields (task_id, kind, name, value) VALUES (?, ?, ?, ?)').bind(hubId, r.kind, r.name.slice(0, 120), r.value.slice(0, 1000)));
  return out;
}

const FROM_HUB = /^From FavorOS, [^:\n]+:\n/;

/** Comments and attachments Asana has that FavorOS does not. Our own comments come back as stories already mapped, or matched by text. */
async function storiesAndFiles(c: SyncCtx, sp: SyncProject, a: ATask, hubId: string) {
  const env = c.env;
  const src = new AsanaApiSource({ token: c.pat.token });
  const [stories, files] = await Promise.all([src.stories(a), src.attachments(a)]);
  c.pat.calls += src.calls;
  const stmts: D1PreparedStatement[] = [];
  const known = new Set(
    ((await env.DB.prepare("SELECT gid FROM hub_asana_map WHERE kind IN ('story','attachment') AND project_gid = ? AND hub_id IN (SELECT id FROM hub_task_comments WHERE task_id = ? UNION SELECT id FROM hub_task_files WHERE task_id = ?)").bind(sp.project_gid, hubId, hubId).all<{ gid: string }>()).results || []).map((r) => r.gid)
  );
  const recent = (await env.DB.prepare('SELECT id, body FROM hub_task_comments WHERE task_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50').bind(hubId).all<{ id: string; body: string }>()).results || [];
  for (const s of stories) {
    if (known.has(s.gid) || (await mapHub(env, 'story', s.gid))) continue;
    const text = s.text.trim();
    const mine = recent.find((r) => r.body.trim() === text.replace(FROM_HUB, '').trim());
    if (mine) {
      stmts.push(mapPut(env, 'story', s.gid, mine.id, sp.project_gid));
      continue;
    }
    const author = matchPerson(c.people, s.author).email;
    const who = s.author ? s.author.name || s.author.email : '';
    const body = author || !who ? text : `${who} wrote in Asana:\n${text}`;
    const id = newId('cmt');
    stmts.push(env.DB.prepare("INSERT INTO hub_task_comments (id, task_id, author_email, body, mentions, source, created_at) VALUES (?, ?, ?, ?, '[]', 'asana', ?)").bind(id, hubId, author || 'asana', body.slice(0, 8000), s.created_at || nowIso()));
    stmts.push(mapPut(env, 'story', s.gid, id, sp.project_gid));
    c.log.push({ dir: 'in', gid: s.gid, hub: hubId, text: `comment from ${who || 'Asana'}` });
  }
  for (const f of files) {
    if (known.has(f.gid) || (await mapHub(env, 'attachment', f.gid))) continue;
    if (f.permanent_url.startsWith(HUB_URL)) continue; // a FavorOS file we sent as a link
    if (!f.permanent_url) continue;
    const id = newId('fil');
    stmts.push(env.DB.prepare("INSERT INTO hub_task_files (id, task_id, kind, name, url, added_by, added_at) VALUES (?, ?, 'link', ?, ?, 'asana', ?)").bind(id, hubId, f.name.slice(0, 200), f.permanent_url, f.created_at || nowIso()));
    stmts.push(mapPut(env, 'attachment', f.gid, id, sp.project_gid));
    c.log.push({ dir: 'in', gid: f.gid, hub: hubId, text: `file ${f.name}` });
  }
  if (stmts.length) await env.DB.batch(stmts);
}

async function subtasksOf(c: SyncCtx, sp: SyncProject, parentGid: string) {
  const r = await c.pat.req('GET', `/tasks/${parentGid}/subtasks?limit=100&opt_fields=${TASK_FIELDS}`);
  for (const row of r?.data || []) {
    const t = taskFromApi(row, '');
    t.parent = parentGid;
    await syncTask(c, sp, { gid: t.gid, prefetched: t });
  }
}

/* ---------------------------------------------------------------------------------------- outbound: the queue */

/** The project event hook: a FavorOS change on a synced project goes in the outbox and is sent at once (and by the cron if that fails). */
export async function onEvent(env: Env, ev: { kind: string; actor: string; task?: TaskRow | null; detail?: Record<string, unknown> }): Promise<void> {
  const t = ev.task;
  if (!t || !ev.kind.startsWith('task.')) return;
  if (ev.actor === 'asana') return;
  const sp = await syncedProject(env, t.project_id);
  if (!sp || !(await syncOn(env))) return;
  let kind = 'task';
  let ref = '';
  if (ev.kind === 'task.comment') {
    kind = 'comment';
    ref = String((ev.detail?.comment as any)?.id || ev.detail?.comment || '');
  } else if (ev.kind === 'task.file') {
    kind = 'file';
    ref = String((ev.detail?.file as any)?.id || '');
  } else if (ev.kind === 'task.people') kind = 'people';
  else if (ev.kind === 'task.deleted') {
    if (!ev.detail?.hard) kind = 'task';
    else kind = 'delete';
  } else if (ev.kind === 'task.deps' || ev.kind === 'task.waiting') return;
  if ((kind === 'comment' || kind === 'file') && !ref) return;
  // A hard delete removes the map row's task, so the gid travels in ref.
  if (kind === 'delete') ref = (await mapGid(env, 'task', t.id)) || '';
  if (kind === 'delete' && !ref) return;
  await env.DB.prepare('INSERT INTO hub_asana_outbox (kind, hub_id, ref, actor, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(kind, t.id, ref, lower(ev.actor), nowIso(), nowIso()).run();
  await pumpOutbox(env, 10).catch((err) => console.error('[asana] pump', String(err)));
}

export async function pumpOutbox(env: Env, max = 40, ctxIn?: SyncCtx): Promise<{ sent: number; failed: number }> {
  if (!(await syncOn(env)) || (await waiting(env))) return { sent: 0, failed: 0 };
  const now = nowIso();
  const lease = new Date(Date.now() + 120000).toISOString();
  const rows = (
    await env.DB.prepare(
      `UPDATE hub_asana_outbox SET status = 'working', tries = tries + 1, next_at = ?
        WHERE id IN (SELECT id FROM hub_asana_outbox WHERE (status = 'queued' OR status = 'working') AND next_at <= ? ORDER BY id LIMIT ?)
        RETURNING id, kind, hub_id, ref, actor, tries`
    ).bind(lease, now, max).all<{ id: number; kind: string; hub_id: string; ref: string; actor: string; tries: number }>()
  ).results || [];
  if (!rows.length) return { sent: 0, failed: 0 };
  rows.sort((x, y) => x.id - y.id);
  const c = ctxIn || (await newCtx(env));
  let sent = 0;
  let failed = 0;
  const seenTask = new Set<string>();
  for (const r of rows) {
    try {
      await sendOne(c, r, seenTask);
      await env.DB.prepare("UPDATE hub_asana_outbox SET status = 'done', done_at = ?, error = '' WHERE id = ?").bind(nowIso(), r.id).run();
      sent++;
    } catch (err) {
      const msg = String((err as Error).message || err).slice(0, 300);
      const give = r.tries >= 6 || (err instanceof AsanaError && err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 404);
      const next = new Date(Date.now() + (err instanceof RateLimited ? err.waitSec * 1000 : /^retry:/.test(msg) ? 8000 : Math.min(3600, 30 * 2 ** r.tries) * 1000)).toISOString();
      await env.DB.prepare('UPDATE hub_asana_outbox SET status = ?, next_at = ?, error = ? WHERE id = ?').bind(give ? 'failed' : 'queued', next, msg, r.id).run();
      if (give) c.log.push({ dir: 'error', hub: r.hub_id, text: `${r.kind}: ${msg}` });
      failed++;
      if (err instanceof RateLimited) break;
    }
  }
  if (!ctxIn) await writeLog(env, c.log.splice(0));
  return { sent, failed };
}

async function sendOne(c: SyncCtx, r: { kind: string; hub_id: string; ref: string; actor: string }, seenTask: Set<string>) {
  const env = c.env;
  if (r.kind === 'delete') {
    const sp = await env.DB.prepare('SELECT s.* FROM hub_asana_sync_projects s JOIN hub_asana_map m ON m.project_gid = s.project_gid WHERE m.kind = ? AND m.gid = ? AND s.enabled = 1').bind('task', r.ref).first<SyncProject>();
    if (!sp) return;
    const client = await clientFor(env, r.actor, c.pat);
    await client.req('DELETE', `/tasks/${r.ref}`).catch((err) => {
      if (!(err instanceof AsanaError && err.status === 404)) throw err;
    });
    c.log.push({ dir: 'out', gid: r.ref, hub: r.hub_id, text: `deleted in Asana (${client.via})` });
    return;
  }
  const hub = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ?').bind(r.hub_id).first<TaskRow>();
  if (!hub) return;
  const sp = await syncedProject(env, hub.project_id);
  if (!sp) return;
  if (r.kind === 'task' || !(await mapGid(env, 'task', hub.id))) {
    if (seenTask.has(hub.id) && r.kind === 'task') return;
    seenTask.add(hub.id);
    await syncTask(c, sp, { hub, actor: r.actor });
    if (r.kind === 'task') return;
  }
  const gid = await mapGid(env, 'task', hub.id);
  if (!gid) throw new Error('the task is not in Asana yet');
  const client = await clientFor(env, r.actor, c.pat);
  if (r.kind === 'comment') {
    if (await mapGid(env, 'story', r.ref)) return;
    const cm = await env.DB.prepare('SELECT author_email, body, source FROM hub_task_comments WHERE id = ?').bind(r.ref).first<{ author_email: string; body: string; source: string }>();
    if (!cm || cm.source === 'asana') return;
    let text = cm.body;
    if (client.via === 'pat' && lower(cm.author_email) !== (await patOwner(env))) {
      const name = (await env.DB.prepare('SELECT name FROM hub_users WHERE lower(email) = ?').bind(lower(cm.author_email)).first<{ name: string }>())?.name || cm.author_email;
      text = `From FavorOS, ${name}:\n${cm.body}`;
    }
    const s = await client.req('POST', `/tasks/${gid}/stories`, { text });
    await mapPut(env, 'story', s.gid, r.ref, sp.project_gid).run();
    c.log.push({ dir: 'out', gid: s.gid, hub: hub.id, text: `comment (${client.via})` });
  } else if (r.kind === 'file') {
    if (await mapGid(env, 'attachment', r.ref)) return;
    const f = await env.DB.prepare('SELECT name, url, added_by FROM hub_task_files WHERE id = ?').bind(r.ref).first<{ name: string; url: string; added_by: string }>();
    if (!f || f.added_by === 'asana') return;
    const url = f.url.startsWith('/') ? HUB_URL + f.url : f.url;
    const form = new FormData();
    form.set('parent', gid);
    form.set('resource_subtype', 'external');
    form.set('url', url);
    form.set('name', f.name);
    const made = await client.req('POST', '/attachments', undefined, form);
    await mapPut(env, 'attachment', made.gid, r.ref, sp.project_gid).run();
    c.log.push({ dir: 'out', gid: made.gid, hub: hub.id, text: `file link ${f.name} (${client.via})` });
  } else if (r.kind === 'people') {
    const ppl = (await env.DB.prepare('SELECT DISTINCT email FROM hub_task_people WHERE task_id = ?').bind(hub.id).all<{ email: string }>()).results || [];
    const emails = ppl.map((p) => p.email).filter((e) => /@favorintl\.org$/.test(e) && !/^tester/.test(e));
    for (const e of emails) {
      // One at a time: Asana refuses the whole call when one address has no account.
      await client.req('POST', `/tasks/${gid}/addFollowers`, { followers: [e] }).catch((err) => {
        if (!(err instanceof AsanaError && err.status === 400)) throw err;
      });
    }
    c.log.push({ dir: 'out', gid, hub: hub.id, text: `followers (${emails.length})` });
  }
}

let ownerCache: string | null = null;
async function patOwner(env: Env): Promise<string> {
  if (ownerCache) return ownerCache;
  try {
    ownerCache = lower(JSON.parse((await hubGet(env, 'projects.asana.who'))?.value || '{}').email);
  } catch {
    ownerCache = '';
  }
  return ownerCache || '';
}

/* ----------------------------------------------------------------------------------------- inbound: webhooks */

async function hmacHex(secret: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function sameStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** POST /api/asana/hook/<project gid>: the handshake, then signed event batches. */
export async function webhook(env: Env, request: Request, projectGid: string, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM hub_asana_sync_projects WHERE project_gid = ?').bind(projectGid).first<SyncProject>();
  if (!row) return new Response('unknown project', { status: 404 });
  const hello = request.headers.get('X-Hook-Secret');
  if (hello) {
    // Only while we are registering this project's webhook (webhook_at set a moment ago and no secret yet).
    const fresh = row.webhook_at && Date.now() - Date.parse(row.webhook_at) < 120000;
    if (!fresh || row.webhook_secret) return new Response('not expecting a handshake', { status: 403 });
    await env.DB.prepare('UPDATE hub_asana_sync_projects SET webhook_secret = ?, updated_at = ? WHERE project_gid = ?').bind(await seal(env, hello), nowIso(), projectGid).run();
    return new Response('', { status: 200, headers: { 'X-Hook-Secret': hello } });
  }
  const body = await request.text();
  if (!row.webhook_secret) return new Response('no secret', { status: 403 });
  const secret = await open(env, row.webhook_secret);
  const got = request.headers.get('X-Hook-Signature') || '';
  if (!sameStr(await hmacHex(secret, body), got)) return new Response('bad signature', { status: 401 });
  let events: any[] = [];
  try {
    events = JSON.parse(body).events || [];
  } catch {
    events = [];
  }
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const type = String(e?.resource?.resource_type || '');
    let gid = '';
    let action = String(e?.action || '');
    if (type === 'task') gid = String(e.resource.gid);
    else if ((type === 'story' || type === 'attachment') && e?.parent?.resource_type === 'task') {
      gid = String(e.parent.gid);
      action = 'changed';
    } else continue;
    const k = gid + action;
    if (!gid || seen.has(k)) continue;
    seen.add(k);
    stmts.push(env.DB.prepare('INSERT INTO hub_asana_inbox (project_gid, type, gid, action, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(projectGid, 'task', gid, action, now, now));
  }
  stmts.push(env.DB.prepare('UPDATE hub_asana_sync_projects SET last_event_at = ? WHERE project_gid = ?').bind(now, projectGid));
  await env.DB.batch(stmts);
  if (row.enabled && stmts.length > 1) waitUntil(pumpInbox(env, 15).catch((err) => console.error('[asana] inbox', String(err))));
  return new Response('', { status: 200 });
}

export async function pumpInbox(env: Env, max = 40, ctxIn?: SyncCtx): Promise<{ read: number; failed: number }> {
  if (!(await syncOn(env)) || (await waiting(env))) return { read: 0, failed: 0 };
  const now = nowIso();
  const lease = new Date(Date.now() + 120000).toISOString();
  const rows = (
    await env.DB.prepare(
      `UPDATE hub_asana_inbox SET status = 'working', tries = tries + 1, next_at = ?
        WHERE id IN (SELECT id FROM hub_asana_inbox WHERE (status = 'queued' OR status = 'working') AND next_at <= ? ORDER BY id LIMIT ?)
        RETURNING id, project_gid, gid, action, tries`
    ).bind(lease, now, max).all<{ id: number; project_gid: string; gid: string; action: string; tries: number }>()
  ).results || [];
  if (!rows.length) return { read: 0, failed: 0 };
  const c = ctxIn || (await newCtx(env));
  const sps = new Map((await syncRows(env)).filter((s) => s.enabled).map((s) => [s.project_gid, s]));
  const done = new Set<string>();
  let read = 0;
  let failed = 0;
  for (const r of rows.sort((x, y) => x.id - y.id)) {
    const sp = sps.get(r.project_gid);
    const key = r.gid + (r.action === 'deleted' ? 'd' : '');
    try {
      if (sp && !done.has(key)) {
        done.add(key);
        await syncTask(c, sp, { gid: r.gid, deleted: r.action === 'deleted' });
      }
      await env.DB.prepare("UPDATE hub_asana_inbox SET status = 'done', error = '' WHERE id = ?").bind(r.id).run();
      read++;
    } catch (err) {
      const msg = String((err as Error).message || err).slice(0, 300);
      const give = r.tries >= 6;
      const next = new Date(Date.now() + (err instanceof RateLimited ? err.waitSec * 1000 : Math.min(3600, 20 * 2 ** r.tries) * 1000)).toISOString();
      await env.DB.prepare('UPDATE hub_asana_inbox SET status = ?, next_at = ?, error = ? WHERE id = ?').bind(give ? 'failed' : 'queued', next, msg, r.id).run();
      if (give) c.log.push({ dir: 'error', gid: r.gid, text: msg });
      failed++;
      if (err instanceof RateLimited) break;
    }
  }
  if (!ctxIn) await writeLog(env, c.log.splice(0));
  return { read, failed };
}

/** Registers the project's webhook. Asana calls the hook URL with the handshake before this call returns. */
export async function registerWebhook(env: Env, sp: SyncProject, c?: SyncCtx): Promise<string> {
  const client = c?.pat || (await patClient(env));
  await env.DB.prepare('UPDATE hub_asana_sync_projects SET webhook_at = ?, webhook_secret = NULL, webhook_gid = NULL WHERE project_gid = ?').bind(nowIso(), sp.project_gid).run();
  const made = await client.req('POST', '/webhooks', { resource: sp.project_gid, target: `${HUB_URL}/api/asana/hook/${sp.project_gid}` });
  await env.DB.prepare('UPDATE hub_asana_sync_projects SET webhook_gid = ?, updated_at = ? WHERE project_gid = ?').bind(made.gid, nowIso(), sp.project_gid).run();
  return made.gid;
}

export async function removeWebhook(env: Env, sp: SyncProject): Promise<void> {
  if (!sp.webhook_gid) return;
  const client = await patClient(env);
  await client.req('DELETE', `/webhooks/${sp.webhook_gid}`).catch((err) => {
    if (!(err instanceof AsanaError && err.status === 404)) throw err;
  });
  await env.DB.prepare('UPDATE hub_asana_sync_projects SET webhook_gid = NULL, webhook_secret = NULL, updated_at = ? WHERE project_gid = ?').bind(nowIso(), sp.project_gid).run();
}

/* -------------------------------------------------------------------------------------------- the cron pass */

const PASS_CALLS = 90; // Asana allows about 150 a minute on Favor's plan; the pass runs every 5 minutes and stops well short.
const PASS_MS = 22000;

/** The scheduled pass: outbox, inbox, then everything Asana changed since the last pass, FavorOS changes the hook missed, a subtask sweep. */
export async function runPass(env: Env): Promise<Record<string, unknown>> {
  if (!(await syncOn(env))) return { off: true };
  if (await waiting(env)) return { waiting: (await hubGet(env, WAIT_KEY))?.value };
  const t0 = Date.now();
  const c = await newCtx(env);
  const out: Record<string, unknown> = {};
  try {
    out.asana_users = await refreshAsanaUsers(env, c).catch((err) => `failed: ${String((err as Error).message).slice(0, 120)}`);
    out.outbox = await pumpOutbox(env, 40, c);
    out.inbox = await pumpInbox(env, 40, c);
    const sps = (await syncRows(env)).filter((s) => s.enabled);
    const per: Record<string, unknown> = {};
    for (const sp of sps) {
      if (Date.now() - t0 > PASS_MS || c.calls() > PASS_CALLS) break;
      if (!sp.webhook_gid || !sp.webhook_secret) {
        try {
          await registerWebhook(env, sp, c);
        } catch (err) {
          c.log.push({ dir: 'error', gid: sp.project_gid, text: `webhook: ${String((err as Error).message).slice(0, 200)}` });
        }
      }
      per[sp.name] = await reconcileProject(c, sp, t0);
    }
    out.projects = per;
    // Prune: queues a week, the log ninety days.
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM hub_asana_outbox WHERE status IN ('done','failed') AND created_at < ?").bind(week),
      env.DB.prepare("DELETE FROM hub_asana_inbox WHERE status IN ('done','failed') AND created_at < ?").bind(week),
      env.DB.prepare('DELETE FROM hub_asana_sync_log WHERE at < ?').bind(new Date(Date.now() - 90 * 86400000).toISOString()),
    ]);
  } finally {
    await writeLog(env, c.log.splice(0));
  }
  out.calls = c.calls();
  return out;
}

async function reconcileProject(c: SyncCtx, sp: SyncProject, t0: number): Promise<Record<string, number | string>> {
  const env = c.env;
  const started = new Date(Date.now() - 60000).toISOString();
  const curKey = `projects.asana.cursor.${sp.project_gid}`;
  // A pass that runs out of time keeps Asana's page offset (good for 15 minutes) and the time it started, and the next pass goes on.
  let saved: { offset?: string; started?: string } = {};
  try {
    saved = JSON.parse((await hubGet(env, curKey).catch(() => null))?.value || '{}');
  } catch {
    saved = {};
  }
  const passStart = saved.started || started;
  // Overlap two minutes with the last pass so an edit made during it is not missed.
  const since = sp.last_reconcile ? new Date(Date.parse(sp.last_reconcile) - 120000).toISOString() : '';
  const st: Record<string, number | string> = { read: 0, changed: 0 };
  let offset: string | null = saved.offset || null;
  let finished = false;
  try {
    for (;;) {
      if (Date.now() - t0 > PASS_MS || c.calls() > PASS_CALLS) break;
      const q = new URLSearchParams({ project: sp.project_gid, limit: '50', opt_fields: TASK_FIELDS });
      if (since) q.set('modified_since', since);
      if (offset) q.set('offset', offset);
      const r = await c.pat.req('GET', `/tasks?${q}`);
      for (const row of r.data || []) {
        const a = taskFromApi(row, sp.project_gid);
        st.read = Number(st.read) + 1;
        const did = await syncTask(c, sp, { gid: a.gid, prefetched: a });
        if (did !== 'same') st.changed = Number(st.changed) + 1;
        if (a.num_subtasks > 0 && since) await subtasksOf(c, sp, a.gid);
      }
      offset = r.next;
      if (!offset) {
        finished = true;
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof AsanaError && err.status === 400 && /offset/i.test(err.message))) throw err;
    offset = null; // the saved offset expired: start this list again
  }
  if (finished) {
    await hubPut(env, curKey, '{}', 'system');
    await env.DB.prepare('UPDATE hub_asana_sync_projects SET last_reconcile = ?, updated_at = ? WHERE project_gid = ?').bind(passStart, nowIso(), sp.project_gid).run();
    sp.last_reconcile = passStart;
  } else await hubPut(env, curKey, JSON.stringify(offset ? { offset, started: passStart } : {}), 'system');
  st.done = finished ? 'yes' : 'continues';

  // FavorOS changes the hook did not send (or that were made before sync was on): tasks edited after their snapshot, or never sent.
  if (Date.now() - t0 < PASS_MS && c.calls() < PASS_CALLS) {
    const rows = (
      await env.DB.prepare(
        `SELECT t.* FROM hub_tasks t LEFT JOIN hub_asana_map m ON m.kind = 'task' AND m.hub_id = t.id LEFT JOIN hub_asana_snap s ON s.gid = m.gid
          WHERE t.project_id = ? AND (m.gid IS NULL OR (s.at IS NOT NULL AND t.updated_at > s.at))
            AND NOT EXISTS (SELECT 1 FROM hub_asana_outbox o WHERE o.hub_id = t.id AND o.status IN ('queued','working'))
          ORDER BY t.parent_id IS NOT NULL, t.updated_at LIMIT 15`
      ).bind(sp.hub_project_id).all<TaskRow>()
    ).results || [];
    let sent = 0;
    for (const t of rows) {
      if (Date.now() - t0 > PASS_MS || c.calls() > PASS_CALLS) break;
      if (/^tester/.test(lower(t.created_by)) && !/sync test/i.test(sp.name)) continue;
      await syncTask(c, sp, { hub: t, actor: t.created_by });
      sent++;
    }
    st.caught_up = sent;
  }

  // Subtask sweep: a subtask edit does not move its parent's modified_at, so a few parents are re-read each pass in turn.
  if (Date.now() - t0 < PASS_MS && c.calls() < PASS_CALLS) {
    const parents = (
      await env.DB.prepare(
        `SELECT DISTINCT m.gid, p.rowid AS rid FROM hub_tasks p JOIN hub_asana_map m ON m.kind = 'task' AND m.hub_id = p.id
          WHERE p.project_id = ? AND p.status NOT IN ('done','dropped') AND EXISTS (SELECT 1 FROM hub_tasks k WHERE k.parent_id = p.id) AND p.rowid > ?
          ORDER BY p.rowid LIMIT 4`
      ).bind(sp.hub_project_id, sp.sub_cursor || 0).all<{ gid: string; rid: number }>()
    ).results || [];
    for (const p of parents) await subtasksOf(c, sp, p.gid);
    const next = parents.length ? parents[parents.length - 1].rid : 0;
    await env.DB.prepare('UPDATE hub_asana_sync_projects SET sub_cursor = ? WHERE project_gid = ?').bind(next, sp.project_gid).run();
    st.sub_parents = parents.length;
  }
  return st;
}

/* ------------------------------------------------------------------------------------------- admin: projects */

export async function adminState(env: Env) {
  const c = await patClient(env);
  const me = await c.req('GET', '/users/me?opt_fields=workspaces.name,email');
  const list: any[] = [];
  for (const w of me.workspaces || []) {
    const r = await c.req('GET', `/projects?workspace=${w.gid}&archived=false&limit=100&opt_fields=name,modified_at,team.name`);
    for (const p of r.data || []) list.push({ gid: p.gid, name: p.name, modified_at: p.modified_at, team: p.team?.name || '', workspace: w.name });
  }
  list.sort((a, b) => String(b.modified_at).localeCompare(String(a.modified_at)));
  const rows = await syncRows(env);
  const byGid = new Map(rows.map((r) => [r.project_gid, r]));
  const q = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>().catch(() => null))?.n || 0;
  return {
    sync: (await syncOn(env)) ? 'on' : 'off',
    waiting_until: (await hubGet(env, WAIT_KEY).catch(() => null))?.value || '',
    projects: list.map((p) => {
      const r = byGid.get(p.gid);
      return { ...p, enabled: !!r?.enabled, hub_project_id: r?.hub_project_id || null, webhook: !!(r?.webhook_gid && r?.webhook_secret), last_event_at: r?.last_event_at || null, last_reconcile: r?.last_reconcile || null };
    }),
    queue: {
      outbox: await q("SELECT COUNT(*) AS n FROM hub_asana_outbox WHERE status IN ('queued','working')"),
      outbox_failed: await q("SELECT COUNT(*) AS n FROM hub_asana_outbox WHERE status = 'failed'"),
      inbox: await q("SELECT COUNT(*) AS n FROM hub_asana_inbox WHERE status IN ('queued','working')"),
    },
    connected: await q('SELECT COUNT(*) AS n FROM hub_asana_oauth'),
    require: await (async () => {
      const r = await requiredPeople(env);
      const con = new Set(((await env.DB.prepare('SELECT email FROM hub_asana_oauth').all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }))).results || []).map((x) => lower(x.email)));
      return { ...r, people: r.emails.map((e) => ({ email: e, connected: con.has(e) })) };
    })(),
    log: ((await env.DB.prepare('SELECT at, dir, gid, hub_id, text FROM hub_asana_sync_log ORDER BY id DESC LIMIT 60').all().catch(() => ({ results: [] }))).results || []),
  };
}

/** Turns one Asana project's sync on or off. On: links it to the FavorOS project imported from it, or makes a new members-only one. */
export async function setProjectSync(env: Env, actor: string, gid: string, on: boolean): Promise<SyncProject> {
  if (!/^\d+$/.test(gid)) throw new HttpError(400, 'bad_gid', 'Pick an Asana project.');
  let row = await env.DB.prepare('SELECT * FROM hub_asana_sync_projects WHERE project_gid = ?').bind(gid).first<SyncProject>();
  const now = nowIso();
  if (on) {
    const c = await patClient(env);
    const p = await c.req('GET', `/projects/${gid}?opt_fields=name,members.email,members.name`);
    let hubId = row?.hub_project_id || (await mapHub(env, 'project', gid))?.hub_id || '';
    if (hubId && !(await env.DB.prepare('SELECT 1 FROM hub_projects WHERE id = ?').bind(hubId).first())) hubId = '';
    // A team's request pipeline is never synced: requests would make Asana sections and tasks nobody asked for.
    if (hubId && (await isPipelineProject(env, hubId))) throw new HttpError(409, 'pipeline', 'That FavorOS project is a team request pipeline, which is not synced with Asana.');
    if (!hubId) {
      hubId = newId('prj');
      let key = '';
      for (const k of projectKeyCandidates(p.name)) {
        if (!(await env.DB.prepare('SELECT 1 FROM hub_projects WHERE key = ?').bind(k).first())) {
          key = k;
          break;
        }
      }
      const people = await loadPeople(env);
      const members = new Set<string>([lower(actor)]);
      for (const m of p.members || []) {
        const e = matchPerson(people, { name: m.name || '', email: m.email || '' }).email;
        if (e) members.add(e);
      }
      await env.DB.batch([
        env.DB.prepare("INSERT INTO hub_projects (id, key, name, description, team, lead_email, visibility, status, color, next_num, created_by, created_at, updated_at) VALUES (?, ?, ?, '', '', ?, 'members', 'active', 'leaf', 1, ?, ?, ?)").bind(hubId, key, p.name, lower(actor), lower(actor), now, now),
        ...[...members].map((e) => env.DB.prepare("INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, ?, ?)").bind(hubId, e, e === lower(actor) ? 'lead' : 'member', now)),
        mapPut(env, 'project', gid, hubId, gid),
      ]);
    }
    await env.DB.prepare(
      `INSERT INTO hub_asana_sync_projects (project_gid, hub_project_id, name, enabled, enabled_by, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(project_gid) DO UPDATE SET hub_project_id = excluded.hub_project_id, name = excluded.name, enabled = 1, enabled_by = excluded.enabled_by, updated_at = excluded.updated_at`
    ).bind(gid, hubId, p.name, lower(actor), now, now).run();
    row = (await env.DB.prepare('SELECT * FROM hub_asana_sync_projects WHERE project_gid = ?').bind(gid).first<SyncProject>())!;
    if (!row.webhook_gid || !row.webhook_secret) {
      try {
        await registerWebhook(env, row, { env, pat: c, people: await loadPeople(env), log: [], calls: () => c.calls });
      } catch (err) {
        await writeLog(env, [{ dir: 'error', gid, text: `webhook: ${String((err as Error).message).slice(0, 200)}` }]);
      }
    }
  } else if (row) {
    await removeWebhook(env, row).catch(() => null);
    await env.DB.prepare('UPDATE hub_asana_sync_projects SET enabled = 0, updated_at = ? WHERE project_gid = ?').bind(now, gid).run();
  }
  await audit(env, { actor, area: 'projects', key: `projects.asana.sync.${gid}`, label: `Asana sync: ${row?.name || gid}`, before: null, after: on ? 'on' : 'off' });
  await writeLog(env, [{ dir: 'info', gid, text: `sync ${on ? 'on' : 'off'} by ${actor}` }]);
  return (await env.DB.prepare('SELECT * FROM hub_asana_sync_projects WHERE project_gid = ?').bind(gid).first<SyncProject>())!;
}

/* ------------------------------------------------------------------------------- who must connect Asana first */

export const REQUIRE_KEY = 'projects.asana.require_connect';
const USERS_KEY = 'projects.asana.users';
const EXTRA_KEY = 'projects.asana.require_extra';
const SKIP_KEY = 'projects.asana.require_skip';
const TESTER = /^tester2?@favorintl\.org$/;

async function listSetting(env: Env, key: string): Promise<string[]> {
  try {
    const v = JSON.parse((await hubGet(env, key).catch(() => null))?.value || '[]');
    return Array.isArray(v) ? v.map(lower).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Everyone in Will's Asana workspace and on the synced projects, by email. Read again every 12 hours by the pass. */
async function refreshAsanaUsers(env: Env, c: SyncCtx): Promise<number | string> {
  const have = (await hubGet(env, USERS_KEY).catch(() => null))?.value;
  try {
    if (have && Date.now() - Date.parse(JSON.parse(have).at) < 12 * 3600000) return 'fresh';
  } catch {
    // read again
  }
  const emails = new Set<string>();
  const me = await c.pat.req('GET', '/users/me?opt_fields=workspaces.name');
  for (const w of me.workspaces || []) {
    let offset: string | null = null;
    do {
      const r: any = await c.pat.req('GET', `/users?workspace=${w.gid}&limit=100&opt_fields=email${offset ? `&offset=${offset}` : ''}`);
      for (const u of r.data || []) if (u.email) emails.add(lower(u.email));
      offset = r.next;
    } while (offset);
  }
  for (const sp of (await syncRows(env)).filter((s) => s.enabled)) {
    const p = await c.pat.req('GET', `/projects/${sp.project_gid}?opt_fields=members.email`);
    for (const m of p.members || []) if (m.email) emails.add(lower(m.email));
  }
  await hubPut(env, USERS_KEY, JSON.stringify({ at: nowIso(), emails: [...emails].filter((e) => /@favorintl\.org$/.test(e)).sort() }), 'system');
  return emails.size;
}

/** Who must connect Asana before Projects opens: Asana users and the Marketing team, plus the extra list, less the skip list. */
export async function requiredPeople(env: Env): Promise<{ on: boolean; mode: string; emails: string[]; extra: string[]; skip: string[]; asana_at: string }> {
  // on: everyone below. test: only the added list, to try the screen without touching real staff.
  const mode = (await hubGet(env, REQUIRE_KEY).catch(() => null))?.value || 'off';
  const on = mode === 'on' || mode === 'test';
  const extra = await listSetting(env, EXTRA_KEY);
  const skip = new Set(await listSetting(env, SKIP_KEY));
  let asana: string[] = [];
  let at = '';
  try {
    const j = JSON.parse((await hubGet(env, USERS_KEY).catch(() => null))?.value || '{}');
    asana = Array.isArray(j.emails) ? j.emails : [];
    at = j.at || '';
  } catch {
    asana = [];
  }
  const mk = ((await env.DB.prepare("SELECT email FROM meet_directory WHERE team = 'Marketing' AND active = 1").all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }))).results || []).map((r) => lower(r.email));
  const all = new Set<string>([...asana, ...mk].filter((e) => !TESTER.test(e)));
  for (const e of extra) all.add(e);
  // Real, active staff only: an Asana account that is a shared mailbox, a typo or a person who left is not on the staff directory.
  const staff = new Set(((await env.DB.prepare(
    `SELECT lower(d.email) AS email FROM meet_directory d LEFT JOIN hub_users u ON lower(u.email) = lower(d.email)
      WHERE d.active = 1 AND COALESCE(u.blocked, 0) = 0`
  ).all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }))).results || []).map((r) => r.email));
  const real = (e: string) => staff.has(e) || extra.includes(e);
  const emails = mode === 'test' ? extra : [...all].filter((e) => real(e) && !skip.has(e)).sort();
  return { on, mode, emails, extra, skip: [...skip], asana_at: at };
}

export async function mustConnect(env: Env, email: string): Promise<boolean> {
  const r = await requiredPeople(env);
  return r.on && r.emails.includes(lower(email));
}

/** On the list (whether or not the requirement is switched on): Projects shows this person the Connect Asana button. */
export async function asanaUser(env: Env, email: string): Promise<boolean> {
  const r = await requiredPeople(env);
  return r.emails.includes(lower(email));
}

export async function setRequire(env: Env, actor: string, b: { require?: unknown; extra?: unknown; skip?: unknown }): Promise<void> {
  const clean = (v: unknown) => JSON.stringify([...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).map(lower).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)))]);
  if (b.require === 'on' || b.require === 'off' || b.require === 'test') {
    const before = (await hubGet(env, REQUIRE_KEY).catch(() => null))?.value || 'off';
    await hubPut(env, REQUIRE_KEY, b.require, actor);
    await audit(env, { actor, area: 'projects', key: REQUIRE_KEY, label: 'Connect Asana before Projects', before, after: b.require });
  }
  if (b.extra !== undefined) await hubPut(env, EXTRA_KEY, clean(b.extra), actor);
  if (b.skip !== undefined) await hubPut(env, SKIP_KEY, clean(b.skip), actor);
}

/* ------------------------------------------------------------------------------------------ deleting a project */

/**
 * Removes a FavorOS project and everything in it. A synced project stops syncing first; with archiveInAsana the Asana project is
 * archived too (never deleted there). Returns what it removed.
 */
export async function deleteHubProject(env: Env, actor: string, projectId: string, archiveInAsana: boolean): Promise<{ tasks: number; asana: string }> {
  const sp = await env.DB.prepare('SELECT * FROM hub_asana_sync_projects WHERE hub_project_id = ?').bind(projectId).first<SyncProject>().catch(() => null);
  let asana = 'not synced';
  if (sp) {
    if (sp.enabled) await setProjectSync(env, actor, sp.project_gid, false).catch(() => null);
    asana = 'sync stopped';
    if (archiveInAsana) {
      const c = await patClient(env);
      await c.req('PUT', `/projects/${sp.project_gid}`, { archived: true });
      asana = 'archived in Asana';
    }
  }
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_tasks WHERE project_id = ?').bind(projectId).first<{ n: number }>())?.n || 0;
  const inP = 'SELECT id FROM hub_tasks WHERE project_id = ?';
  const stmts = [
    ...['hub_task_comments', 'hub_task_files', 'hub_task_people', 'hub_task_notices', 'hub_task_events', 'hub_task_fields'].map((tb) => env.DB.prepare(`DELETE FROM ${tb} WHERE task_id IN (${inP})`).bind(projectId)),
    env.DB.prepare(`DELETE FROM hub_task_deps WHERE task_id IN (${inP}) OR depends_on IN (${inP})`).bind(projectId, projectId),
    env.DB.prepare(`DELETE FROM hub_asana_snap WHERE hub_id IN (${inP})`).bind(projectId),
    env.DB.prepare('DELETE FROM hub_task_events WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM hub_tasks WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM hub_project_sections WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM hub_project_members WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM hub_projects WHERE id = ?').bind(projectId),
  ];
  if (sp) {
    stmts.push(env.DB.prepare('DELETE FROM hub_asana_map WHERE project_gid = ?').bind(sp.project_gid));
    stmts.push(env.DB.prepare('DELETE FROM hub_asana_sync_projects WHERE project_gid = ?').bind(sp.project_gid));
  } else stmts.push(env.DB.prepare("DELETE FROM hub_asana_map WHERE kind = 'project' AND hub_id = ?").bind(projectId));
  // hub_task_nudges exists once db/notify.sql is applied
  await env.DB.prepare(`DELETE FROM hub_task_nudges WHERE task_id IN (${inP})`).bind(projectId).run().catch(() => null);
  await env.DB.batch(stmts);
  await audit(env, { actor, area: 'projects', key: `project.${projectId}`, label: 'Project deleted', before: `${n} tasks`, after: asana });
  return { tasks: n, asana };
}
