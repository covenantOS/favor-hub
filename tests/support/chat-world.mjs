// A stand-in world for Favor Chat tests: an in-memory D1 with the chat tables and the few hub tables the routes read, a fake
// room (the Durable Object) that records every event, and a fake R2 bucket. Nothing here can reach the live database.
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.mjs';
import './resolve-ts.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

export const ADMIN = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
export const ADMIN2 = { email: 'bo@favorintl.org', name: 'Bo Builder', picture: '', role: 'admin', via: 'google', kpi: true };
export const ADMIN3 = { email: 'cy@favorintl.org', name: 'Cy Writer', picture: '', role: 'admin', via: 'google', kpi: true };
export const STAFF = { email: 'dee@favorintl.org', name: 'Dee Staff', picture: '', role: 'staff', via: 'google', kpi: true };

export function world({ mode } = {}) {
  const d1 = memoryD1();
  d1.exec(read('db/admin-home.sql'));
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  d1.exec(read('db/clips.sql'));
  d1.exec(read('db/clips-v2.sql'));
  d1.exec(read('db/meetings.sql'));
  d1.exec(read('db/favor-chat.sql'));
  d1.exec(read('db/favor-chat-private.sql'));
  const now = '2026-10-11T12:00:00.000Z';
  for (const u of [ADMIN, ADMIN2, ADMIN3, STAFF]) {
    d1.db.prepare('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.email, u.name, u.picture, u.role, now, now);
  }
  if (mode) d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('chat.enabled', ?, 'test', ?)").run(mode, now);

  const events = [];
  const room = {
    idFromName: (n) => n,
    get: () => ({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith('/event')) events.push(JSON.parse(init.body));
        if (url.endsWith('/presence')) return Response.json({ 'ada@favorintl.org': 'online' });
        return new Response('ok');
      },
    }),
  };
  const files = new Map();
  const UPLOADS = {
    async put(key, buf, opts) { files.set(key, { buf, type: opts?.httpMetadata?.contentType }); },
    async get(key) { const f = files.get(key); return f ? { body: new Response(f.buf).body, size: f.buf.byteLength ?? f.buf.length, arrayBuffer: async () => (typeof f.buf === 'string' ? new TextEncoder().encode(f.buf).buffer : f.buf.buffer ? f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.byteLength) : f.buf), httpMetadata: { contentType: f.type } } : null; },
  };
  const env = { DB: d1, UPLOADS, CHAT_ROOM: room, BRAIN_HUB_KEY: 'test-key' };
  const pending = [];
  return { d1, env, events, files, pending };
}

/** Calls the chat router the way the Pages Function does, and waits for the work it left in waitUntil. */
export async function call(w, user, method, path, body, extra = {}) {
  const { handle } = await import('../../functions/_lib/chat/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json', ...(extra.headers || {}) } };
  if (extra.raw !== undefined) init.body = extra.raw;
  else if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({
    request: new Request('https://dash.favorintl.org/api/chat/' + path, init),
    env: { ...w.env, ...(extra.env || {}) },
    user,
    path: path.split('?')[0].split('/'),
    waitUntil: (p) => w.pending.push(p),
    fetcher: extra.fetcher,
  });
  await Promise.allSettled(w.pending.splice(0));
  const ct = res.headers.get('Content-Type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  return { status: res.status, data, res };
}
