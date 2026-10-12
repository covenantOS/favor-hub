// A stand-in world for the request board's task tests: an in-memory D1 built from the repository's schema files, made-up people,
// a fake Chat room and a mail hook that collects what would be sent. Nothing here can reach the live database or send email.
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.mjs';
import './resolve-ts.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
export const NOW = '2026-10-11T12:00:00.000Z';

export const WILL = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
export const VIDEO = { email: 'vic@favorintl.org', name: 'Vic Video', picture: '', role: 'staff', via: 'google', kpi: true };
export const DESIGN = { email: 'dan@favorintl.org', name: 'Dan Design', picture: '', role: 'staff', via: 'google', kpi: true };
export const FOUNDER = { email: 'flo@favorintl.org', name: 'Flo Founder', picture: '', role: 'staff', via: 'google', kpi: true };
export const OUTSIDER = { email: 'ozzy@favorintl.org', name: 'Ozzy Other', picture: '', role: 'staff', via: 'google', kpi: true };

export function world({ notify = 'on', tables = true, email = true } = {}) {
  const d1 = memoryD1();
  d1.exec(read('db/schema.sql'));
  d1.exec(read('db/admin-home.sql'));
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  d1.exec(read('db/meetings.sql'));
  d1.exec(read('db/work.sql'));
  d1.exec(read('db/clips.sql'));
  d1.exec(read('db/clips-v2.sql'));
  d1.exec(read('db/favor-chat.sql'));
  d1.exec(read('db/favor-chat-private.sql'));
  if (tables) d1.exec(read('db/request-tasks.sql'));
  if (tables && email) d1.exec(read('db/request-email.sql'));
  const ins = (sql, ...a) => d1.db.prepare(sql).run(...a);
  for (const u of [WILL, VIDEO, DESIGN, FOUNDER, OUTSIDER]) ins('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', u.email, u.name, '', u.role, NOW, NOW);
  // Two people who left: one blocked in the hub, one marked inactive in the directory.
  ins('INSERT INTO hub_users (email, name, role, blocked, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)', 'gone@favorintl.org', 'Gina Gone', 'staff', NOW, NOW);
  ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', 'left@favorintl.org', 'Lee Left', 'Director', 'Leadership', 0);
  ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', WILL.email, WILL.name, 'Lead Developer', 'Marketing', 1);
  ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', VIDEO.email, VIDEO.name, 'Videographer', 'Marketing', 1);
  ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', DESIGN.email, DESIGN.name, 'Creative Director', 'Marketing', 1);
  ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', OUTSIDER.email, OUTSIDER.name, 'Assistant', 'Support Team', 1);
  // The founder is only on the Work Center roster, as team exec, the way the live data had it.
  ins('INSERT INTO act_staff (email, name, team, active, updated_at) VALUES (?, ?, ?, 1, ?)', FOUNDER.email, FOUNDER.name, 'exec', NOW);
  ins('INSERT INTO act_staff (email, name, team, active, updated_at) VALUES (?, ?, ?, 1, ?)', 'gone@favorintl.org', 'Gina Gone', 'support', NOW);
  if (notify) ins("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', ?, 'test', ?)", notify, NOW);
  const events = [];
  const room = {
    idFromName: (n) => n,
    get: () => ({ fetch: async (input, init) => { if (String(input).endsWith('/event')) events.push(JSON.parse(init.body)); return Response.json({}); } }),
  };
  // Every email the hub would send lands here; nothing leaves the test.
  const mail = [];
  const env = { DB: d1, CHAT_ROOM: room, UPLOADS: { put: async () => {}, get: async () => null }, MAIL_HOOK: (m) => { mail.push(m); return true; } };
  return { d1, env, events, mail, pending: [] };
}

export function addRequest(w, title = 'Hero video: faces', email = 'asker@favorintl.org') {
  const id = 'req_' + Math.random().toString(16).slice(2, 14);
  w.d1.db.prepare(`INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at) VALUES (?, ?, 'Show faces', 'website', 'inbox', 'Asker', ?, 'form', ?, ?)`).run(id, title, email, NOW, NOW);
  return id;
}

export async function call(w, user, method, path, body, headers = {}) {
  const { handle } = await import('../../functions/_lib/requests/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/requests/' + path, init), env: w.env, user, path: path.split('?')[0].split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json() };
}

export async function chat(w, user, method, path, body) {
  const { handle } = await import('../../functions/_lib/chat/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/chat/' + path, init), env: w.env, user, path: path.split('?')[0].split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json().catch(() => null) };
}

export const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
