// Rebuilding the lists snapshot from the Blackbaud mirror, one run at a time, and the background rebuild when the copy is old.
import type { Env } from '../http.ts';
import { mirror } from '../foundations/blackbaud';
import { buildSnapshot, type SnapshotResult } from './snapshot.ts';
import { hubQ, snapshotMeta, todayET, type SnapMeta } from './service.ts';

const LOCK_MS = 4 * 60 * 1000;
export const STALE_MS = 6 * 60 * 60 * 1000;

/** Rebuild the snapshot from the Blackbaud mirror. One run at a time; a second caller inside four minutes gets `busy`. */
export async function mirrorStamp(env: Env): Promise<string> {
  const r = await mirror<{ m: string }>(env, 'SELECT MAX(synced_at) AS m FROM constituents').catch(() => []);
  return String(r[0]?.m ?? '');
}

/** The hourly pass: rebuild only when the mirror has synced since the last copy (or the copy is a day old), so the copy follows each sync within the hour. */
export async function refreshIfMirrorNewer(env: Env, now = new Date()): Promise<{ ok: boolean; skipped?: string; busy?: boolean; result?: SnapshotResult }> {
  const meta = (await snapshotMeta(env)) as (SnapMeta & { mirrorAt?: string }) | null;
  const stamp = await mirrorStamp(env);
  const old = !meta || now.getTime() - Date.parse(meta.builtAt) > 24 * 3600 * 1000;
  if (!old && stamp && meta?.mirrorAt === stamp) return { ok: true, skipped: 'the mirror has not synced since the last copy' };
  const r = await refreshSnapshot(env, now);
  if (r.ok && stamp) await env.DB.prepare(`UPDATE lr_meta SET value = json_set(value, '$.mirrorAt', ?1) WHERE key = 'snapshot'`).bind(stamp).run().catch(() => undefined);
  return r;
}

export async function refreshSnapshot(env: Env, now = new Date()): Promise<{ ok: boolean; busy?: boolean; result?: SnapshotResult }> {
  const lock = await env.DB.prepare(`SELECT value FROM lr_meta WHERE key = 'refreshing'`).first<{ value: string }>().catch(() => null);
  if (lock && now.getTime() - Date.parse(lock.value) < LOCK_MS) return { ok: false, busy: true };
  await env.DB.prepare(`INSERT INTO lr_meta (key, value) VALUES ('refreshing', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(now.toISOString()).run();
  try {
    const result = await buildSnapshot(
      {
        read: (sql, params = []) => mirror(env, sql, params),
        hub: (sql, params = []) => hubQ(env)(sql, params),
        write: async (stmts) => {
          await env.DB.batch(stmts.map((s) => env.DB.prepare(s.sql).bind(...s.params)));
        },
      },
      todayET(now)
    );
    return { ok: true, result };
  } finally {
    await env.DB.prepare(`DELETE FROM lr_meta WHERE key = 'refreshing'`).run().catch(() => undefined);
  }
}

/** Start a background rebuild when the copy is older than six hours. Never blocks the request. */
export function refreshIfStale(env: Env, meta: SnapMeta | null, waitUntil?: (p: Promise<unknown>) => void): void {
  const age = meta ? Date.now() - Date.parse(meta.builtAt) : Infinity;
  if (age < STALE_MS || !waitUntil) return;
  waitUntil(refreshSnapshot(env).catch((err) => console.warn('[lists] refresh', err)));
}

