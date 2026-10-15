// The stand-in world for the requests-in-Projects tests: the request board's world plus the Projects, Asana and intake tables, made-up
// people, and callers that go through the same router the Pages functions use. The live database is never touched.
import { readFileSync } from 'node:fs';
import './resolve-ts.mjs';
import { NOW, WILL, world } from './request-world.mjs';

export { DESIGN, FOUNDER, NOW, OUTSIDER, VIDEO, WILL, rows } from './request-world.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

/** A second test account, an admin like the first. Test accounts see test rows only. */
export const T = { email: 'tester2@favorintl.org', name: 'FavorOS Tester Two', picture: '', role: 'admin', via: 'google', kpi: true };

export function iw(opts = {}) {
  const w = world(opts);
  for (const f of ['db/projects.sql', 'db/projects-links.sql', 'db/projects-asana.sql', 'db/projects-asana-sync.sql', 'db/meetings-scheduling.sql', 'db/google.sql', 'db/integrations.sql', 'db/projects-intake.sql']) {
    for (const part of read(f).split(/;\s*(?:\r?\n|$)/)) if (part.trim()) { try { w.d1.exec(part + ';'); } catch { /* an ALTER on a table this world lacks */ } }
  }
  const set = (k, v) => w.d1.db.prepare('INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v, 'test', NOW);
  set('projects.enabled', 'staff');
  set('chat.enabled', 'staff');
  // The fixture puts the lead developer on Marketing; here Tech is Tech and Marketing is led by its creative director.
  w.d1.db.prepare("UPDATE meet_directory SET team = 'Tech' WHERE email = ?").run(WILL.email);
  w.d1.db.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(T.email, T.name, 'Test', 'Tech');
  w.d1.db.prepare('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(T.email, T.name, '', 'admin', NOW, NOW);
  return { ...w, set };
}

/** One call to /api/tasks/intake/... through the Projects router, so the registration in hooks.ts is part of what runs. */
export async function ic(w, user, method, path, body) {
  const { handle } = await import('../../functions/_lib/projects/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const url = new URL('https://dash.favorintl.org/api/tasks/intake/' + path);
  const res = await handle({ request: new Request(url, init), env: w.env, user, path: ['tasks', 'intake', ...url.pathname.replace('/api/tasks/intake/', '').split('/').filter(Boolean)], waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** One call to /api/tasks/... or /api/projects/... (Projects itself), as the board and the drawer make it. */
export async function pc(w, user, method, path, body) {
  const { handle } = await import('../../functions/_lib/projects/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const url = new URL('https://dash.favorintl.org/api/' + path);
  const res = await handle({ request: new Request(url, init), env: w.env, user, path: url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json().catch(() => null) };
}
