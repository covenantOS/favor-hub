// Shared test world for the Projects tests: an in-memory D1 built from the repository's own schema files, made-up people, and a
// caller that goes through the same router the Pages functions use. The live database is never touched.
import { readFileSync } from 'node:fs';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

export const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
export const NOW = '2026-10-11T12:00:00.000Z';

const mk = (email, name, role = 'staff') => ({ email, name, picture: '', role, via: 'google', kpi: true });
export const ADA = mk('ada@favorintl.org', 'Ada Admin', 'admin');
export const VIC = mk('vic@favorintl.org', 'Vic Video');
export const DAN = mk('dan@favorintl.org', 'Dan Design');
export const FLO = mk('flo@favorintl.org', 'Flo Founder');
export const OZZY = mk('ozzy@favorintl.org', 'Ozzy Other');
export const AGENT = { email: 'agent', name: 'Agent', picture: '', role: 'admin', via: 'agent', kpi: true };

export function world({ notify = null, mode = 'staff', only = '', tables = true } = {}) {
  const d1 = memoryD1();
  d1.exec(read('db/schema.sql'));
  d1.exec(read('db/admin-home.sql'));
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  d1.exec(read('db/meetings.sql'));
  d1.exec(read('db/work.sql'));
  if (tables) d1.exec(read('db/projects.sql'));
  const ins = (sql, ...a) => d1.db.prepare(sql).run(...a);
  for (const u of [ADA, VIC, DAN, FLO, OZZY]) {
    ins('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', u.email, u.name, '', u.role, NOW, NOW);
    ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)', u.email, u.name, 'Staff', 'Marketing');
  }
  const set = (k, v) => ins('INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)', k, v, 'test', NOW);
  if (mode) set('projects.enabled', mode);
  if (notify) set('requests.notify', notify);
  if (only) set('requests.notify.only', only);
  const store = new Map();
  const env = {
    DB: d1,
    UPLOADS: {
      put: async (k, v, o) => { store.set(k, { v, o }); },
      get: async (k) => (store.has(k) ? { body: new Blob([store.get(k).v]).stream() } : null),
      delete: async (k) => { store.delete(k); },
    },
  };
  return { d1, env, store, pending: [], ins, set, rows: (sql, ...a) => d1.db.prepare(sql).all(...a) };
}

/** One call through the router. path is like 'projects/MKT' or 'tasks?project=MKT&status=all'. */
export async function call(w, user, method, path, body, headers = {}) {
  const { handle } = await import('../functions/_lib/projects/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined && method !== 'GET') init.body = body instanceof FormData ? body : JSON.stringify(body);
  if (body instanceof FormData) delete init.headers['Content-Type'];
  const url = new URL('https://dash.favorintl.org/api/' + path);
  const res = await handle({
    request: new Request(url, init),
    env: w.env,
    user,
    path: url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean),
    waitUntil: (p) => w.pending.push(p),
  });
  await Promise.allSettled(w.pending.splice(0));
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : null, res };
}

/** A project with ADA as lead and VIC, DAN as members. */
export async function seedProject(w, over = {}) {
  const r = await call(w, ADA, 'POST', 'projects', { name: 'Fall campaign', key: 'MKT', members: [VIC.email, DAN.email], ...over });
  if (r.status !== 201) throw new Error('seed project failed: ' + JSON.stringify(r.data));
  return r.data.project;
}

export async function seedTask(w, user, over = {}) {
  const r = await call(w, user, 'POST', 'tasks', { title: 'Write the letter', project_id: 'MKT', ...over });
  if (r.status !== 201 && r.status !== 200) throw new Error('seed task failed: ' + JSON.stringify(r.data));
  return r.data.task;
}
