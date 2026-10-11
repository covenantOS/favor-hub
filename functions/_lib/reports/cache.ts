// Mirror reads for reports, kept two ways so a page load skips the slow read through the sync worker:
// in the isolate for MEM_TTL_MS, and in BB_KV under hub:reports:* for KV_TTL_S. The mirror changes only when the sync runs,
// so a copy five minutes old is never staler than the mirror already is. A failed read is never kept.
import { mirror } from '../foundations/blackbaud';
import type { Env } from '../http';

export const MEM_TTL_MS = 60_000;
export const KV_TTL_S = 300;
/** KV values top out at 25 MiB; a read bigger than this stays in the isolate only. */
const KV_MAX_BYTES = 20 * 1024 * 1024;
const MEM_MAX_ENTRIES = 40;

type Kv = { get(key: string, type: 'json'): Promise<unknown>; put(key: string, value: string, o?: { expirationTtl?: number }): Promise<void> };
type Rows = Record<string, unknown>[];
type Reader = (sql: string, params: unknown[]) => Promise<Rows>;

const memory = new Map<string, { at: number; p: Promise<Rows> }>();

/** Drops every kept read (tests that change mirror rows). */
export const clearReportCache = () => memory.clear();

async function keyOf(sql: string, params: unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([sql, params]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return 'hub:reports:' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Each caller gets its own copy, so a report that sorts or edits its rows never changes what the next request reads. */
export function cachedMirror(env: Env, sql: string, params: unknown[] = [], read?: Reader): Promise<Rows> {
  return shared(env, sql, params, read).then((r) => structuredClone(r));
}

function shared(env: Env, sql: string, params: unknown[], read?: Reader): Promise<Rows> {
  const kv = (env as unknown as { BB_KV?: Kv }).BB_KV;
  const doRead: Reader = read || ((s, p) => mirror(env, s, p) as Promise<Rows>);
  const memKey = JSON.stringify([sql, params]);
  const hit = memory.get(memKey);
  if (hit && Date.now() - hit.at < MEM_TTL_MS) return hit.p;
  const p = (async () => {
    let key = '';
    if (kv) {
      key = await keyOf(sql, params);
      const stored = (await kv.get(key, 'json').catch(() => null)) as Rows | null;
      if (Array.isArray(stored)) return stored;
    }
    const fresh = await doRead(sql, params);
    if (kv) {
      const text = JSON.stringify(fresh);
      if (text.length < KV_MAX_BYTES) await kv.put(key, text, { expirationTtl: KV_TTL_S }).catch((err) => console.warn('[reports] kv put', err));
    }
    return fresh;
  })();
  if (memory.size >= MEM_MAX_ENTRIES) memory.delete(memory.keys().next().value as string);
  memory.set(memKey, { at: Date.now(), p });
  p.catch(() => { if (memory.get(memKey)?.p === p) memory.delete(memKey); });
  return p;
}
