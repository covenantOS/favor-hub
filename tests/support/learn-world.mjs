// A stand-in world for Learn's tests: the request board's world (in-memory D1, made-up people, a mail hook that collects what would
// be sent) plus Learn's and the people helpers' tables and a minimal hub_tasks, the table Projects writes tasks to. Nothing here can
// reach the live database or send email.
import { readFileSync } from 'node:fs';
import { world as requestWorld, WILL, VIDEO, DESIGN, FOUNDER, OUTSIDER, NOW } from './request-world.mjs';
import './resolve-ts.mjs';

export { WILL, VIDEO, DESIGN, FOUNDER, OUTSIDER, NOW };
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

// The columns of Projects' hub_tasks that Learn writes and reads (db/projects.sql on the proj-core branch has the whole table).
const TASKS_SQL = `
CREATE TABLE IF NOT EXISTS hub_tasks (id TEXT PRIMARY KEY, project_id TEXT, section_id TEXT, code TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', owner_email TEXT, start_date TEXT, due_date TEXT, due_time TEXT, done_at TEXT, done_by TEXT,
  parent_id TEXT, sort REAL NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_task_files (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', ref_id TEXT, mime TEXT, size INTEGER, added_by TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_task_events (id TEXT PRIMARY KEY, task_id TEXT, project_id TEXT, actor_email TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
`;

export const HR = { email: 'hana@favorintl.org', name: 'Hana Resources', picture: '', role: 'staff', via: 'google', kpi: true };
export const GRANTS = { email: 'gus@favorintl.org', name: 'Gus Grants', picture: '', role: 'staff', via: 'google', kpi: true };

export function learnWorld({ notify = 'on', projects = true, learn = 'admins' } = {}) {
  const w = requestWorld({ notify });
  w.d1.exec(read('db/people-dev.sql'));
  w.d1.exec(read('db/learn.sql'));
  if (projects) w.d1.exec(TASKS_SQL);
  const ins = (sql, ...a) => w.d1.db.prepare(sql).run(...a);
  for (const u of [HR, GRANTS]) {
    ins('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', u.email, u.name, '', u.role, NOW, NOW);
  }
  ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', HR.email, HR.name, 'HR Assistant', 'Operations', 1);
  ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', GRANTS.email, GRANTS.name, 'Grant Writer', 'Grants', 1);
  ins('INSERT INTO hub_hr (email, set_by, set_at) VALUES (?, ?, ?)', HR.email, WILL.email, NOW);
  if (learn) ins("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('learn.enabled', ?, 'test', ?)", learn, NOW);
  return w;
}

export async function call(w, user, method, path, body, headers = {}) {
  const { handle } = await import('../../functions/_lib/learn/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/learn/' + path, init), env: w.env, user, path: path.split('?')[0].split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json() };
}

export const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
