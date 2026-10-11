// The staff directory the people pickers use (request board Send to, @mentions, Waiting on, the filter by person).
// Three hub tables answer it together, and no name lives in this repository:
//   meet_directory  name, title and team from Favor's staff directory (seeded by hand; active = 0 for someone who left)
//   act_staff       the Work Center roster; its team word fills in for someone the directory does not list
//   hub_users       the Google picture, and blocked = 1 for an account an admin closed
// A person is listed when the directory or the roster has them active and their hub account is not blocked.
import type { Env } from './http';

export interface Person {
  email: string;
  name: string;
  title: string;
  team: string;
  picture: string;
}

/** The roster's team codes in the words the hub shows. Founders and directors (team exec) are Leadership, as in the staff directory. */
export const TEAM_WORD: Record<string, string> = {
  support: 'Support Team',
  rdd: 'Development (RDD)',
  partner_care: 'Partner Care',
  church: 'Church Engagement',
  grants: 'Grants',
  admin: 'Operations',
  exec: 'Leadership',
};

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

type Row = { email: string; name: string; title: string; team: string; active: number };

async function rows<T>(env: Pick<Env, 'DB'>, sql: string): Promise<T[]> {
  try {
    return ((await env.DB.prepare(sql).all<T>()).results || []) as T[];
  } catch {
    // A table that is not there yet answers nothing.
    return [];
  }
}

export async function staffDirectory(env: Pick<Env, 'DB'>): Promise<Person[]> {
  const [dir, roster, users] = await Promise.all([
    rows<Row>(env, 'SELECT email, name, title, team, active FROM meet_directory'),
    rows<Row>(env, `SELECT email, name, '' AS title, team, active FROM act_staff`),
    rows<{ email: string; name: string; picture: string; blocked: number }>(env, 'SELECT email, name, picture, blocked FROM hub_users'),
  ]);
  const user = new Map(users.map((u) => [lower(u.email), u]));
  const out = new Map<string, Person>();
  const gone = new Set<string>();
  for (const d of dir) {
    const email = lower(d.email);
    if (!email) continue;
    if (!d.active) {
      gone.add(email);
      continue;
    }
    out.set(email, { email, name: d.name || email.split('@')[0], title: d.title || '', team: d.team || '', picture: '' });
  }
  for (const s of roster) {
    const email = lower(s.email);
    if (!email || !s.active) continue;
    const word = TEAM_WORD[s.team] || '';
    const have = out.get(email);
    if (have) {
      if (!have.team) have.team = word;
      continue;
    }
    // The roster alone lists someone active the directory marked as gone: the directory's word stands.
    if (gone.has(email)) continue;
    out.set(email, { email, name: s.name || email.split('@')[0], title: '', team: word, picture: '' });
  }
  for (const [email, p] of out) {
    const u = user.get(email);
    if (u && u.blocked) {
      out.delete(email);
      continue;
    }
    if (u && u.picture) p.picture = u.picture;
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function personByEmail(env: Pick<Env, 'DB'>, email: string): Promise<Person | null> {
  const e = lower(email);
  return (await staffDirectory(env)).find((p) => p.email === e) || null;
}
