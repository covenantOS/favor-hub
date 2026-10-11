// Snooze for Today's Needs you cards. A snoozed card stays hidden until its date, counted in Eastern time.
// Blackbaud actions are not stored here: snoozing one moves its due date in Blackbaud through the Work Center write path.
import type { Env } from '../http';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const etToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A snooze date: after today, up to two years out. */
export function validSnoozeDate(s: unknown, today = etToday()): string | null {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!DATE.test(v) || v <= today || v > addDays(today, 730)) return null;
  return v;
}

/** The keys this person has snoozed that are still hidden today. A missing table hides nothing, so Today always loads. */
export async function snoozedKeys(env: Env, email: string, today = etToday()): Promise<Set<string>> {
  try {
    const rows = await env.DB.prepare('SELECT item_key FROM hub_snoozes WHERE user_email = ? AND until_date > ?')
      .bind(email.toLowerCase(), today)
      .all<{ item_key: string }>();
    return new Set((rows.results || []).map((r) => r.item_key));
  } catch {
    return new Set();
  }
}

/** Set the day a card comes back, or clear the snooze with null. */
export async function setSnooze(env: Env, email: string, key: string, until: string | null): Promise<void> {
  if (until === null) {
    await env.DB.prepare('DELETE FROM hub_snoozes WHERE user_email = ? AND item_key = ?').bind(email.toLowerCase(), key).run();
    return;
  }
  await env.DB.prepare(
    'INSERT INTO hub_snoozes (user_email, item_key, until_date) VALUES (?, ?, ?) ON CONFLICT(user_email, item_key) DO UPDATE SET until_date = excluded.until_date'
  )
    .bind(email.toLowerCase(), key, until)
    .run();
}
