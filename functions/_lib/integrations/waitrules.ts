// The rules that keep Today's Waiting on list honest. Pure functions, so they can be tested without a database.
//   * A line is never about the signed-in person (their address, a connected mailbox, or Gmail's "me" label).
//   * A line is never about someone who left Favor: a blocked account, or a hub account that is off the staff roster.
//     Addresses the hub has never seen (partners, shared mailboxes) stay.
//   * A wait you started is dropped after WAIT_MAX_DAYS. A question someone put to you stays until you answer it.
import type { Env } from '../http';
import { listBoxes } from '../mail/boxes';
import { isHiddenAccount } from '../testuser';

/** A wait on someone else older than this many days is let go: it is no longer a wait, it is a dropped thread. */
export const WAIT_MAX_DAYS = 14;

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export interface Who {
  email: string;
  name?: string;
}

/** Everything the signed-in person writes as: their address and the mailboxes they connected. */
export function selfSet(me: string, boxes: string[] = []): Set<string> {
  return new Set([me, ...boxes].map(lower).filter(Boolean));
}

/** True when this is the signed-in person: a matching address, or Gmail's "me" display name with no other address to go on. */
export function isSelf(p: Who, self: Set<string>): boolean {
  const e = lower(p.email);
  if (e) return self.has(e);
  return lower(p.name) === 'me';
}

/**
 * The accounts that have left. `users` is every hub account with its blocked flag; `active` is the staff roster
 * (meet_directory and act_staff, blocked people already removed); null or empty when the roster could not be read, so only blocked accounts count. A hub account that is off the roster has left,
 * and so has a blocked one. Test accounts and probes are not people who left.
 */
export function departedSet(users: Array<{ email: string; blocked?: number | boolean }>, active: Set<string> | null): Set<string> {
  const out = new Set<string>();
  for (const u of users) {
    const e = lower(u.email);
    if (!e || isHiddenAccount(e)) continue;
    if (u.blocked || (active && active.size > 0 && !active.has(e))) out.add(e);
  }
  return out;
}

/** Who the signed-in person writes as, and who has left Favor. One small read of the hub's account table; `dir` is the staff roster (email to name). */
export async function guards(env: Env, me: string, dir: Map<string, string>): Promise<{ self: Set<string>; gone: Set<string> }> {
  const [users, boxes] = await Promise.all([
    env.DB.prepare('SELECT lower(email) AS email, blocked FROM hub_users').all<{ email: string; blocked: number }>().then((r) => r.results || []).catch(() => [] as Array<{ email: string; blocked: number }>),
    listBoxes(env, lower(me)).catch(() => []),
  ]);
  return { self: selfSet(me, boxes.map((b) => b.mailbox)), gone: departedSet(users, dir.size ? new Set(dir.keys()) : null) };
}

/** Gmail shows sent mail as "To: Name". The name is the person. */
export const plainName = (name: string) => String(name || '').replace(/^\s*To:\s*/i, '').trim();

/** The first person on a mail thread who is not the signed-in person and has not left, or null when nobody else is on it. */
export function waitTarget(people: Who[] | undefined, self: Set<string>, gone: Set<string>): { email: string; name: string } | null {
  for (const p of people || []) {
    if (isSelf(p, self)) continue;
    const e = lower(p.email);
    if (!e || gone.has(e)) continue;
    return { email: e, name: plainName(p.name || '') || e };
  }
  return null;
}

/** False for a wait on someone else that has run past WAIT_MAX_DAYS. A question to the signed-in person (dir 'in') always stays. */
export function keepWait(i: { dir: 'in' | 'out'; days: number }): boolean {
  return i.dir === 'in' || i.days <= WAIT_MAX_DAYS;
}
