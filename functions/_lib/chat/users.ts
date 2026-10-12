// The people list the client needs for names, avatars and the @ picker. Admin only mode lists admins; staff mode lists everyone who can sign in.
import type { Env } from '../http';
import type { HubUser } from '../session';
import type { ChatMode } from './gate';
import { BRAIN_ID, MEETINGS_ID } from './text';
import { isTester } from '../testuser';

export interface PersonOut {
  id: string;
  name: string;
  picture: string;
  title: string;
}

export async function directory(env: Env, mode: ChatMode, me: HubUser): Promise<Record<string, PersonOut>> {
  const where = mode === 'staff' ? '' : `AND role = 'admin'`;
  // The title under each name comes from the staff directory (meet_directory), so the @ picker reads "Founder", not blank.
  const r = await env.DB.prepare(
    `SELECT u.email, u.name, u.picture, COALESCE(d.title, '') AS title FROM hub_users u LEFT JOIN meet_directory d ON lower(d.email) = lower(u.email) AND d.active = 1
      WHERE u.blocked = 0 ${where.replace('role', 'u.role')} ORDER BY u.name`
  ).all<{ email: string; name: string; picture: string; title: string }>().catch(() => env.DB.prepare(`SELECT email, name, picture, '' AS title FROM hub_users WHERE blocked = 0 ${where} ORDER BY name`).all<{ email: string; name: string; picture: string; title: string }>());
  const out: Record<string, PersonOut> = {};
  for (const u of r.results || []) {
    const id = u.email.toLowerCase();
    if (id === BRAIN_ID || id === MEETINGS_ID) continue;
    // The test users are in no real person's list and see only each other, so they cannot message staff.
    if (isTester(id) !== isTester(me.email)) continue;
    out[id] = { id, name: u.name || id.split('@')[0], picture: u.picture || '', title: u.title || '' };
  }
  const mine = me.email.toLowerCase();
  if (!out[mine]) out[mine] = { id: mine, name: me.name || mine.split('@')[0], picture: me.picture || '', title: '' };
  return out;
}

/** The people a conversation names must all be in the directory: nobody outside the allowed group joins by email. */
export function onlyKnown(emails: string[], dir: Record<string, PersonOut>): string[] {
  return [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()))].filter((e) => !!dir[e]);
}
