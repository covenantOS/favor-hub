// Blackbaud users, read only. SKY has no user endpoint, so the list comes from the Blackbaud users page itself: a desktop job reads the page
// in a signed-in browser (webview/nxt_users.py) and sends the rows here. The hub keeps the latest read as one setting and shows it to
// admins. Nothing here changes a Blackbaud user.
import { HttpError, nowIso, type Env } from '../http';
import { getSetting, setSetting } from './db';

export interface BbUser {
  /** Blackbaud's row id for the user. */
  id: string;
  name: string;
  email: string;
  active: boolean;
  /** The admin types the list shows (Organization, Solution and the like). */
  admin: string[];
  /** The access the list shows for each product: Admin, User, or blank. */
  access: Record<string, string>;
}

export interface BbUsersSnapshot {
  users: BbUser[];
  /** When the desktop job read the page. */
  at: string;
  /** The count the page itself reported. */
  reported: number;
}

const KEY = 'bbusers:snapshot';
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The product columns, in the order the page shows them. */
export const PRODUCTS: Record<string, string> = {
  renxt: "Raiser's Edge NXT",
  bbms: 'Merchant Services',
  apps: 'Blackbaud apps',
  marketplace: 'Marketplace',
  paymentsapi: 'Payments API',
};

export function cleanUsers(input: unknown): BbUser[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'bad_users', 'Send the users as a list.');
  const seen = new Set<string>();
  const out: BbUser[] = [];
  for (const raw of input.slice(0, 1000)) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const email = clean(r.email, 160).toLowerCase();
    const name = clean(r.name, 120);
    if (!name && !email) continue;
    const id = clean(r.id, 80) || email;
    if (seen.has(id)) continue;
    seen.add(id);
    const access: Record<string, string> = {};
    const a = r.access && typeof r.access === 'object' ? (r.access as Record<string, unknown>) : {};
    for (const k of Object.keys(PRODUCTS)) {
      const v = clean(a[k], 20);
      if (v) access[k] = v;
    }
    out.push({ id, name, email, active: r.active !== false, admin: Array.isArray(r.admin) ? r.admin.map((x) => clean(x, 40)).filter(Boolean).slice(0, 8) : [], access });
  }
  return out;
}

export async function saveUsers(env: Env, input: { users: unknown; reported?: unknown }): Promise<BbUsersSnapshot> {
  const users = cleanUsers(input.users);
  if (users.length < 5) throw new HttpError(400, 'too_few', 'That list is too short to be the Blackbaud users page. Nothing was saved.');
  const snap: BbUsersSnapshot = { users, at: nowIso(), reported: Number(input.reported) || users.length };
  await setSetting(env, KEY, JSON.stringify(snap));
  return snap;
}

export async function loadUsers(env: Env): Promise<BbUsersSnapshot | null> {
  const raw = await getSetting(env, KEY, '');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BbUsersSnapshot;
  } catch {
    return null;
  }
}

/** Counts for the page header. */
export function summarize(users: BbUser[]) {
  const active = users.filter((u) => u.active);
  return {
    total: users.length,
    active: active.length,
    inactive: users.length - active.length,
    renxtAdmins: active.filter((u) => u.access.renxt === 'Admin').length,
    renxtUsers: active.filter((u) => u.access.renxt === 'User').length,
  };
}
