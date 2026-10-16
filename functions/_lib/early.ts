// Early access: the hub setting early_access ({"emails":[...],"teams":[...]}, edited in Admin > Settings) names who sees Alpha and Beta
// features and the apps held back from staff (Meetings, Chat, Mail, Clips). Admins always do. It starts empty. src/data/early.ts says which pages.
import { hubValue } from './admin/hubcache';
import { EMPTY_ACCESS, parseAccess } from './access';
import { PROBE_EMAILS } from './testuser';
import type { Env } from './http';

export const EARLY_SETTING = 'early_access';

export async function earlyMembers(env: Env): Promise<Set<string>> {
  const list = parseAccess(await hubValue(env, EARLY_SETTING).catch(() => EMPTY_ACCESS));
  const out = new Set(list.emails);
  if (list.teams.length) {
    const want = new Set(list.teams.map((t) => t.toLowerCase()));
    const r = await env.DB.prepare(`SELECT lower(email) AS email, team FROM meet_directory WHERE active = 1`).all<{ email: string; team: string }>().catch(() => ({ results: [] as Array<{ email: string; team: string }> }));
    for (const p of r.results || []) if (want.has(String(p.team || '').toLowerCase())) out.add(p.email);
  }
  return out;
}

/** On the Early access list by address (the people's own rows; roles and agents are not read). Leadership sees every Alpha and Beta page with data. */
export async function isEarlyEmail(env: Env, email: string): Promise<boolean> {
  const e = email.toLowerCase();
  if (PROBE_EMAILS.includes(e)) return false;
  return (await earlyMembers(env).catch(() => new Set<string>())).has(e);
}

/** An admin, or on the Early access list. Field staff and agents are not. */
export async function isEarly(env: Env, user: { email: string; role?: string; via?: string } | null): Promise<boolean> {
  if (!user || user.via === 'agent' || user.role === 'field') return false;
  if (user.role === 'admin') return true;
  if (PROBE_EMAILS.includes(user.email.toLowerCase())) return false;
  return (await earlyMembers(env)).has(user.email.toLowerCase());
}
