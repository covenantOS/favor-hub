// Blocked and offboarded people (hub_users.blocked = 1, which also covers field accounts still waiting for approval).
// Mail, push and held quiet-hours items skip them. A failed lookup, such as a missing table, counts as nobody blocked,
// so a broken lookup never stops delivery to everyone else.
import type { Env } from './http';

type Db = Pick<Env, 'DB'>;

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** The blocked ones among these addresses, lowercased. One query for the whole list. */
export async function blockedSet(env: Db, emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.map(lower).filter(Boolean))];
  const out = new Set<string>();
  if (!list.length || !env.DB) return out;
  try {
    for (let i = 0; i < list.length; i += 80) {
      const chunk = list.slice(i, i + 80);
      const { results } = await env.DB.prepare(`SELECT lower(email) AS email FROM hub_users WHERE blocked = 1 AND lower(email) IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<{ email: string }>();
      for (const r of results || []) out.add(lower(r.email));
    }
  } catch (err) {
    console.warn('[blocked] lookup failed, treating everyone as not blocked', err);
    return new Set();
  }
  return out;
}

export async function isBlocked(env: Db, email: string): Promise<boolean> {
  return (await blockedSet(env, [email])).has(lower(email));
}
