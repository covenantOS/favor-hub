// hub_settings is small (a few dozen rows) and was read about 211,000 times a day, once or more per request. Each isolate keeps
// the whole table for 30 seconds. A save goes through hubPut()/hubDel(), which update this copy at once, and the save response
// sets a short hub_sv cookie: a request carrying a hub_sv newer than this isolate's copy reloads the table, so the admin who saved
// reads the new value on the next request whichever isolate answers it. Other people see it within 30 seconds.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../http';

export interface HubRow {
  value: string;
  by: string;
  at: string;
}

const TTL_MS = 30_000;
// On in Cloudflare's runtime. Node tests change rows behind the code's back with raw SQL, so there every read goes to the table
// unless a test turns the copy on (tests/hub-settings-cache.test.mjs).
let enabled = typeof navigator !== 'undefined' && (navigator as { userAgent?: string }).userAgent === 'Cloudflare-Workers';
export const SAVED_COOKIE = 'hub_sv';

// The copy belongs to the database binding it was read from (the binding is one object for the life of an isolate; each test's
// database is its own, so tests never read another test's settings).
let snap: { loaded: number; rows: Map<string, HubRow>; db: unknown } | null = null;
let inflight: { db: unknown; p: Promise<Map<string, HubRow>> } | null = null;

async function load(env: Env): Promise<Map<string, HubRow>> {
  const started = Date.now();
  const r = await env.DB.prepare('SELECT key, value, updated_by AS by, updated_at AS at FROM hub_settings').all<{ key: string } & HubRow>();
  const rows = new Map<string, HubRow>();
  for (const x of r.results || []) rows.set(x.key, { value: x.value, by: x.by, at: x.at });
  snap = { loaded: started, rows, db: env.DB };
  return rows;
}

/** Every hub_settings row, at most 30 seconds old. Throws when the table cannot be read, so each caller keeps its own fallback. */
export async function hubSettings(env: Env): Promise<Map<string, HubRow>> {
  if (!enabled) return load(env);
  if (snap && snap.db === env.DB && Date.now() - snap.loaded < TTL_MS) return snap.rows;
  if (!inflight || inflight.db !== env.DB) {
    const p = load(env).finally(() => {
      if (inflight && inflight.p === p) inflight = null;
    });
    inflight = { db: env.DB, p };
  }
  return inflight.p;
}

export async function hubValue(env: Env, key: string): Promise<string | null> {
  const row = (await hubSettings(env)).get(key);
  return row ? row.value : null;
}

export async function hubPrefix(env: Env, prefix: string): Promise<{ key: string; value: string }[]> {
  const out: { key: string; value: string }[] = [];
  for (const [key, row] of await hubSettings(env)) if (key.startsWith(prefix)) out.push({ key, value: row.value });
  return out;
}

const writes = new AsyncLocalStorage<{ wrote: boolean }>();

/** Runs one request and adds the hub_sv cookie to its response when it saved a setting. */
export async function withHubWrites(fn: () => Promise<Response>): Promise<Response> {
  const mark = { wrote: false };
  const res = await writes.run(mark, fn);
  if (!mark.wrote) return res;
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', savedCookie());
  return out;
}

/** Write-through after a save in this isolate. */
export function noteHubWrite(key: string, row: HubRow | null, db?: unknown): void {
  const mark = writes.getStore();
  if (mark) mark.wrote = true;
  if (!snap) return;
  if (db !== undefined && snap.db !== db) return void (snap = null);
  if (row) snap.rows.set(key, row);
  else snap.rows.delete(key);
}

export function dropHubSettings(): void {
  snap = null;
}

/** Called by the middleware: a hub_sv cookie newer than this isolate's copy means the person saved a setting moments ago. */
export function honorSavedCookie(cookie: string | null): void {
  if (!snap || !cookie) return;
  const m = /(?:^|;\s*)hub_sv=(\d+)/.exec(cookie);
  if (m && Number(m[1]) >= snap.loaded) snap = null;
}

export function savedCookie(): string {
  return `${SAVED_COOKIE}=${Date.now()}; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax`;
}

/** For tests. */
export function resetHubCache(on?: boolean): void {
  snap = null;
  inflight = null;
  if (on !== undefined) enabled = on;
}
