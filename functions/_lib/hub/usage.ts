// Page usage for the adoption tracker (Admin > Adoption). The middleware calls noteUse() for each signed-in page request.
// The write is one UPSERT into hub_usage (db/adoption.sql), run after the response goes out, and each person, day and area
// is written at most once per ten minutes per server instance, so the count is visits and D1 sees a handful of writes a day.
import type { Env } from '../http';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_KEYS = 5000;
const seen = new Map<string, number>();

/** The Eastern calendar day (YYYY-MM-DD) of a moment. */
export function easternDay(at: number | Date = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at);
}

/** The area a page belongs to: its first path segment ("/work/gifts" is work, "/" is today). Empty means do not count. */
export function usageArea(method: string, path: string): string {
  if (method !== 'GET') return '';
  if (path === '/' || path === '') return 'today';
  const segs = path.split('/').filter(Boolean);
  const first = segs[0].toLowerCase();
  if (first === 'api' || first === 'login' || first === 'connect' || first.startsWith('_')) return '';
  // A file (an image, a script, the manifest) is not a page.
  if (/\.[a-z0-9]{1,5}$/i.test(segs[segs.length - 1])) return '';
  if (!/^[a-z0-9-]{1,32}$/.test(first)) return '';
  return first;
}

/** True when this person, day and area should be written now. Marks it written. */
export function shouldWrite(email: string, day: string, area: string, now = Date.now()): boolean {
  const key = `${email}|${day}|${area}`;
  const last = seen.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  if (seen.size >= MAX_KEYS) {
    for (const [k, t] of seen) if (now - t >= WINDOW_MS) seen.delete(k);
    if (seen.size >= MAX_KEYS) seen.clear();
  }
  seen.set(key, now);
  return true;
}

export function resetUsageGuard(): void {
  seen.clear();
}

export async function writeUse(env: Pick<Env, 'DB'>, email: string, day: string, area: string, at: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO hub_usage (email, day, area, n, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(email, day, area) DO UPDATE SET n = n + 1, last_at = excluded.last_at`
  ).bind(email, day, area, at, at).run();
}

/** Record one page visit without holding up the response. A failure (the table not added yet, a D1 cap) is logged and dropped. */
export function noteUse(ctx: { env: Pick<Env, 'DB'>; waitUntil: (p: Promise<unknown>) => void }, user: { email: string; via: string }, method: string, path: string): void {
  if (user.via !== 'google' && user.via !== 'password') return;
  const area = usageArea(method, path);
  if (!area) return;
  const email = user.email.trim().toLowerCase();
  const now = Date.now();
  const day = easternDay(now);
  if (!shouldWrite(email, day, area, now)) return;
  ctx.waitUntil(writeUse(ctx.env, email, day, area, new Date(now).toISOString()).catch((err) => console.error('[usage]', String((err as Error)?.message || err))));
}
