// The people list the client needs for names, avatars and the @ picker. Admin only mode lists admins; staff mode lists everyone who can sign in.
import type { Env } from '../http';
import type { HubUser } from '../session';
import type { ChatMode } from './gate';
import { BRAIN_ID, MEETINGS_ID } from './text';

export interface PersonOut {
  id: string;
  name: string;
  picture: string;
  title: string;
}

export async function directory(env: Env, mode: ChatMode, me: HubUser): Promise<Record<string, PersonOut>> {
  const where = mode === 'staff' ? '' : `AND role = 'admin'`;
  const r = await env.DB.prepare(`SELECT email, name, picture FROM hub_users WHERE blocked = 0 ${where} ORDER BY name`).all<{ email: string; name: string; picture: string }>();
  const out: Record<string, PersonOut> = {};
  for (const u of r.results || []) {
    const id = u.email.toLowerCase();
    if (id === BRAIN_ID || id === MEETINGS_ID) continue;
    out[id] = { id, name: u.name || id.split('@')[0], picture: u.picture || '', title: '' };
  }
  const mine = me.email.toLowerCase();
  if (!out[mine]) out[mine] = { id: mine, name: me.name || mine.split('@')[0], picture: me.picture || '', title: '' };
  return out;
}

/** The people a conversation names must all be in the directory: nobody outside the allowed group joins by email. */
export function onlyKnown(emails: string[], dir: Record<string, PersonOut>): string[] {
  return [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()))].filter((e) => !!dir[e]);
}
