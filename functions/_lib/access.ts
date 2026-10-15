// Access groups. Chat, Mail and Learn each have a hub setting "<feature>.enabled" with these values:
//   admins   hub admins only (the default)
//   staff    every signed-in staff member
//   group    hub admins plus the people and teams named in "<feature>.access"
//   off      nobody
// "<feature>.access" holds {"emails":["a@favorintl.org"],"teams":["Operations"]}. A team means everyone active in that team in the
// staff directory (meet_directory), so a new hire in the team is in the group on their first day. Admins always keep everything.
// A person who is not in the group keeps their stored chat and mail data; it is hidden, never deleted.
import type { Env as FullEnv } from './http';
import { hubValue } from './admin/hubcache';
import { PROBE_EMAILS } from './testuser';

type Env = Pick<FullEnv, 'DB'>;
export type Feature = 'chat' | 'mail' | 'learn';
export type AccessMode = 'admins' | 'staff' | 'group' | 'off';
export interface AccessList {
  emails: string[];
  teams: string[];
}

export const FEATURES: Feature[] = ['chat', 'mail', 'learn'];
export const EMPTY_ACCESS = '{"emails":[],"teams":[]}';
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export function normMode(v: unknown): AccessMode {
  const s = lower(v);
  return s === 'staff' || s === 'off' || s === 'group' ? s : 'admins';
}

/** Reads the stored value leniently: bad JSON is an empty list. */
export function parseAccess(raw: unknown): AccessList {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const o = (v && typeof v === 'object' ? v : {}) as { emails?: unknown; teams?: unknown };
  const emails = [...new Set((Array.isArray(o.emails) ? o.emails : []).map(lower).filter((e) => EMAIL.test(e)))].sort();
  const teams = [...new Set((Array.isArray(o.teams) ? o.teams : []).map((t) => String(t || '').trim().replace(/\s+/g, ' ')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { emails, teams };
}

/** Strict form for saving: a person that is not an email address, or a list that is not JSON, is an error the admin sees. */
export function cleanAccess(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return { ok: true, value: EMPTY_ACCESS };
    try {
      v = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'The list is not valid. Pick people and teams from the picker.' };
    }
  }
  const o = (v && typeof v === 'object' ? v : null) as { emails?: unknown; teams?: unknown } | null;
  if (!o) return { ok: false, error: 'The list is not valid. Pick people and teams from the picker.' };
  const badMail = (Array.isArray(o.emails) ? o.emails : []).map(lower).filter((e) => !EMAIL.test(e));
  if (badMail.length) return { ok: false, error: `${badMail[0]} is not an email address.` };
  return { ok: true, value: JSON.stringify(parseAccess(o)) };
}

export async function featureMode(env: Env, feature: Feature): Promise<AccessMode> {
  return normMode(await hubValue(env as FullEnv, `${feature}.enabled`).catch(() => null));
}

export async function accessList(env: Env, feature: Feature): Promise<AccessList> {
  return parseAccess(await hubValue(env as FullEnv, `${feature}.access`).catch(() => null));
}

/** Everyone the group names: the listed emails plus every active person on a listed team. Lowercase. */
export async function groupMembers(env: Env, feature: Feature): Promise<Set<string>> {
  // Chat and Mail follow the Early access list (hub setting early_access), so one list holds them back from staff.
  if (feature === 'chat' || feature === 'mail') return (await import('./early')).earlyMembers(env as FullEnv);
  const list = await accessList(env, feature);
  const out = new Set(list.emails);
  if (list.teams.length) {
    const r = await env.DB.prepare(`SELECT lower(email) AS email, team FROM meet_directory WHERE active = 1`).all<{ email: string; team: string }>().catch(() => ({ results: [] as Array<{ email: string; team: string }> }));
    const want = new Set(list.teams.map(lower));
    for (const p of r.results || []) if (want.has(lower(p.team))) out.add(lower(p.email));
  }
  return out;
}

export interface Who {
  email: string;
  role?: string;
  via?: string;
}

/** The test, given the mode and the group already read. Admins pass in every mode except off. */
export function allowedBy(mode: AccessMode, members: Set<string> | null, user: Who | null): boolean {
  if (!user || mode === 'off') return false;
  if (user.via === 'agent') return false;
  if (mode === 'staff') return true;
  if (user.role === 'admin') return true;
  // The privacy check's made-up people read as ordinary staff in every mode that serves staff; they are in no real list.
  if (mode === 'group') return (!!members && members.has(lower(user.email))) || PROBE_EMAILS.includes(lower(user.email));
  return false;
}

/** One person, one feature. Reads the mode and, only in group mode, the group. */
export async function mayFeature(env: Env, feature: Feature, user: Who | null): Promise<boolean> {
  const mode = await featureMode(env, feature);
  return allowedBy(mode, mode === 'group' ? await groupMembers(env, feature) : null, user);
}

/** Of these addresses, the ones who may use the feature. Admins are found in hub_users. */
export async function allowedAmong(env: Env, feature: Feature, emails: string[]): Promise<string[]> {
  const list = [...new Set(emails.map(lower).filter(Boolean))];
  if (!list.length) return [];
  const mode = await featureMode(env, feature);
  if (mode === 'staff') return list;
  if (mode === 'off') return [];
  const admins = new Set<string>();
  const r = await env.DB.prepare(`SELECT lower(email) AS email FROM hub_users WHERE role = 'admin' AND blocked = 0`).all<{ email: string }>().catch(() => ({ results: [] as Array<{ email: string }> }));
  for (const a of r.results || []) admins.add(a.email);
  const members = mode === 'group' ? await groupMembers(env, feature) : new Set<string>();
  return list.filter((e) => admins.has(e) || members.has(e));
}

/** The error text a route returns for someone outside the feature. */
export function refusal(mode: AccessMode, name: string): string {
  if (mode === 'off') return `${name} is switched off.`;
  if (mode === 'group') return `${name} is open to a chosen group for now.`;
  return `${name} is open to FavorOS admins for now.`;
}

/**
 * For notices, pushes, emails and timelines: drops people only when the feature is in group mode and they are outside the group.
 * Other modes keep today's behavior (Chat and Mail already refuse people they do not serve; an assigned Learn course still reaches
 * a person while Learn is in its admins mode).
 */
export async function keepAllowed(env: Env, feature: Feature, emails: string[]): Promise<string[]> {
  const list = [...new Set(emails.map(lower).filter(Boolean))];
  if (!list.length || (await featureMode(env, feature)) !== 'group') return list;
  return allowedAmong(env, feature, list);
}
