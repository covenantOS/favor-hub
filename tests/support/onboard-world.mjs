// A stand-in world for the onboarding tests: an in-memory D1 built from the repository's schema files, invented people, the Projects
// and Learn tables the build contracts name, and a mail hook that collects what would be sent. Nothing here can reach the live
// database or send email.
import { readFileSync } from 'node:fs';
import { world as base, NOW, WILL } from './request-world.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
export { NOW, WILL };

export const HR = { email: 'hana@favorintl.org', name: 'Hana HR', picture: '', role: 'staff', via: 'google', kpi: true };
export const DIRECT = { email: 'dora@favorintl.org', name: 'Dora Directory', picture: '', role: 'staff', via: 'google', kpi: true };
export const BOSS = { email: 'boss@favorintl.org', name: 'Bo Boss', picture: '', role: 'staff', via: 'google', kpi: true };
export const NEWBIE = { email: 'nia@favorintl.org', name: 'Nia Newhire', picture: '', role: 'staff', via: 'google', kpi: true };
export const PLAIN = { email: 'pat@favorintl.org', name: 'Pat Plain', picture: '', role: 'staff', via: 'google', kpi: true };

// The Projects tables as the Projects build contract names them (db/projects.sql, lane CORE), reduced to what onboarding writes.
const PROJECTS = `
CREATE TABLE hub_projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', team TEXT NOT NULL DEFAULT '', lead_email TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'staff', status TEXT NOT NULL DEFAULT 'active', color TEXT NOT NULL DEFAULT 'leaf', start_date TEXT, due_date TEXT, chat_channel_id TEXT, drive_folder_id TEXT, next_num INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE hub_tasks (id TEXT PRIMARY KEY, project_id TEXT, section_id TEXT, code TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', owner_email TEXT, start_date TEXT, due_date TEXT, due_time TEXT, done_at TEXT, done_by TEXT, parent_id TEXT, sort REAL NOT NULL DEFAULT 0, waiting_on_email TEXT, waiting_on_task TEXT, appeal_code TEXT, source_code TEXT, fund_code TEXT, campaign_code TEXT, request_id TEXT, meeting_id TEXT, meeting_action_idx INTEGER, chat_message_id TEXT, expense_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE hub_task_events (id TEXT PRIMARY KEY, task_id TEXT, project_id TEXT, actor_email TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE hub_task_notices (id TEXT PRIMARY KEY, email TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL, actor_email TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, read_at TEXT, emailed_at TEXT);`;

// The Learn tables as db/learn.sql writes them, reduced to what onboarding reads and writes.
const LEARN = `
CREATE TABLE learn_paths (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published');
CREATE TABLE learn_assignments (id TEXT PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, due_date TEXT, source TEXT NOT NULL DEFAULT 'manual', group_label TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', assigned_by TEXT NOT NULL DEFAULT '', assigned_at TEXT NOT NULL, task_id TEXT, closed_at TEXT, closed_why TEXT, UNIQUE (email, kind, target_id));`;

export function onboardWorld({ projects = true, learn = true, notify = 'on', owners = true } = {}) {
  const w = base({ notify, tables: true, email: true });
  const d1 = w.d1;
  d1.exec(read('db/people-dev.sql'));
  d1.exec(read('db/onboard.sql'));
  d1.exec(`CREATE TABLE IF NOT EXISTS hub_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '')`);
  d1.exec(`CREATE TABLE IF NOT EXISTS hub_google (email TEXT PRIMARY KEY, refresh_enc TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '', connected_at TEXT NOT NULL, last_used TEXT)`);
  if (projects) d1.exec(PROJECTS);
  if (learn) d1.exec(LEARN);
  const ins = (sql, ...a) => d1.db.prepare(sql).run(...a);
  for (const u of [HR, DIRECT, BOSS, NEWBIE, PLAIN]) {
    ins('INSERT OR IGNORE INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', u.email, u.name, '', u.role, NOW, NOW);
    ins('INSERT OR IGNORE INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)', u.email, u.name, u === BOSS ? 'Director' : 'Associate', 'Support Team');
  }
  ins('INSERT INTO hub_hr (email, set_by, set_at) VALUES (?, ?, ?)', HR.email, WILL.email, NOW);
  if (owners) {
    for (const [duty, email] of [['hr', HR.email], ['directory', DIRECT.email], ['whatsapp', DIRECT.email], ['training', BOSS.email], ['tech', WILL.email]]) {
      ins('INSERT INTO onb_owners (duty, email, updated_by, updated_at) VALUES (?, ?, ?, ?)', duty, email, WILL.email, NOW);
    }
  }
  if (learn) {
    ins("INSERT INTO learn_paths (id, slug, title) VALUES ('p_os', 'new-hire-favoros', 'New hire: FavorOS')");
    ins("INSERT INTO learn_paths (id, slug, title) VALUES ('p_fav', 'new-hire-favor', 'New hire: Favor')");
  }
  return w;
}

export async function call(w, user, method, path, body, headers = {}) {
  const { handle } = await import('../../functions/_lib/onboard/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json', Origin: 'https://dash.favorintl.org', ...headers } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/onboarding/' + path, init), env: w.env, user, path: path.split('?')[0].split('/').filter(Boolean), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json() };
}

export const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
