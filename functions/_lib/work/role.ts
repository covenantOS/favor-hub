// Who sees what in the Work Center and who may change what (2026-10-10, opened to every role that touches it).
// The role comes from the staff list (act_staff.team) and the hub's own admin flag. Everything here is checked on the server;
// the page only hides what the server would refuse.
import { HttpError, type Env } from '../http';
import { getSetting, listStaff } from './db';
import type { BoardRow } from '../actions/board';

export type Role = 'admin' | 'support' | 'director' | 'partner_care' | 'grants';

export interface Scope {
  role: Role;
  email: string;
  name: string;
  /** The person's own Blackbaud fundraiser id, when they have one. */
  fid: string | null;
  /** The team word the board uses for this person (RDD, Support, Partner Care, Church Engagement, Grants, Executive). */
  team: string;
  /** Admins see everything. */
  all: boolean;
  /** Fundraiser ids whose portfolios this person sees: an action shows when one of them works it or holds the partner. */
  fids: Set<string>;
}

const TEAM_WORDS: Record<string, string> = { support: 'Support', rdd: 'RDD', partner_care: 'Partner Care', church: 'Church Engagement', grants: 'Grants', admin: 'Operations', exec: 'Executive' };

export const ADMIN_SCOPE: Scope = { role: 'admin', email: '', name: '', fid: null, team: '', all: true, fids: new Set() };

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  support: 'Support Team',
  director: 'Director',
  partner_care: 'Partner Care',
  grants: 'Grants writer',
};

export function roleOfTeam(team: string): Role | null {
  if (team === 'support') return 'support';
  if (team === 'rdd' || team === 'church' || team === 'exec') return 'director';
  if (team === 'partner_care') return 'partner_care';
  if (team === 'grants') return 'grants';
  return null;
}

/**
 * The person's scope. Defaults by role, which an admin can override per person with an act_settings row
 * scope:<email> = comma list of fundraiser ids ("*" for everything):
 *   director      their own id
 *   support       the id of every director with an Entry chip (RDDs, church engagement, executives) and their own
 *   partner_care  every Partner Care fundraiser (the team shares its partners)
 *   grants        their own id
 */
export async function scopeFor(env: Env, email: string, admin: boolean): Promise<Scope | null> {
  email = email.toLowerCase();
  if (admin) return { ...ADMIN_SCOPE, email, name: 'Admin' };
  const staff = await listStaff(env).catch(() => []);
  const me = staff.find((s) => s.email === email && s.active === 1 && s.work_center === 1);
  if (!me) return null;
  const role = roleOfTeam(me.team);
  if (!role) return null;
  const own = me.bb_fundraiser_id ? String(me.bb_fundraiser_id) : null;
  const fids = new Set<string>();
  if (own) fids.add(own);
  const over = await getSetting(env, `scope:${email}`, '').catch(() => '');
  if (over) {
    if (over.trim() === '*') return { role, email, name: me.name, fid: own, team: TEAM_WORDS[me.team] || me.team, all: true, fids };
    for (const x of over.split(',')) if (/^\d+$/.test(x.trim())) fids.add(x.trim());
  } else if (role === 'support') {
    for (const s of staff) if (s.active === 1 && s.entry_owner === 1 && s.bb_fundraiser_id) fids.add(String(s.bb_fundraiser_id));
  } else if (role === 'partner_care') {
    for (const s of staff) if (s.active === 1 && s.team === 'partner_care' && s.bb_fundraiser_id) fids.add(String(s.bb_fundraiser_id));
  }
  return { role, email, name: me.name, fid: own, team: TEAM_WORDS[me.team] || me.team, all: false, fids };
}

export const inScope = (s: Scope | undefined, r: Pick<BoardRow, 'fundraisers' | 'holders'>): boolean =>
  !s || s.all || r.fundraisers.some((f) => s.fids.has(f)) || r.holders.some((f) => s.fids.has(f));

export function scopeRows(s: Scope | undefined, rows: BoardRow[]): BoardRow[] {
  return !s || s.all ? rows : rows.filter((r) => inScope(s, r));
}

/** What this role may do. Defaults: only admins and Support delete; only admins reassign across teams. */
export function can(s: Scope | undefined, what: 'delete' | 'move' | 'partner_edit' | 'entry'): boolean {
  if (!s || s.role === 'admin') return true;
  if (what === 'delete' || what === 'move') return s.role === 'support';
  if (what === 'entry') return s.role === 'support' || s.role === 'director';
  if (what === 'partner_edit') return s.role !== 'grants';
  return false;
}

const NO = (msg: string) => new HttpError(403, 'not_yours', msg);

export function refuse(s: Scope | undefined, what: 'delete' | 'move' | 'partner_edit' | 'entry', msg: string): void {
  if (!can(s, what)) throw NO(msg);
}

/** Whether this person may put an action on the given fundraiser. Same team, or inside their own scope; across teams is an admin's call. */
export function mayAssignTo(s: Scope | undefined, fid: string, teamOf: (fid: string) => string): boolean {
  if (!s || s.all) return true;
  if (fid === s.fid || s.fids.has(fid)) return true;
  return !!s.team && teamOf(fid) === s.team;
}

/** The tab the Work Center opens on before a person picks their own (Group 0, 2026-10-10). The ids are the ones tabs register with. */
export const DEFAULT_TAB: Record<Role, string> = { admin: 'open', director: 'gifts', support: 'hqty', partner_care: 'cadence', grants: 'open' };
export const START_SCOPES = ['mine', 'partners', 'all'] as const;
export type StartScope = (typeof START_SCOPES)[number];
