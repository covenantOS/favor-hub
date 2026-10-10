// Who may use the Work Center. Admins only until leadership releases it; then admins plus everyone on the staff list marked for it.
// Every route checks the gate itself, because hiding the menu item hides nothing from a person who knows the address.
import { HttpError, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { getRelease, staffByEmail, type Release, type StaffRow } from './db';
import { scopeFor, type Scope } from './role';

export interface WorkAccess {
  ok: boolean;
  admin: boolean;
  release: Release;
  staff: StaffRow | null;
  /** Why the page stays closed: before release (admins are testing) or not on the Support Team. */
  reason: 'open' | 'before_release' | 'not_support';
}

export async function workAccessFor(env: Env, email: string, admin: boolean, opts: { ignoreRelease?: boolean } = {}): Promise<WorkAccess> {
  const release = await getRelease(env).catch(() => 'admins' as Release);
  const staff = await staffByEmail(env, email).catch(() => null);
  const listed = !!staff && staff.work_center === 1 && staff.active === 1;
  if (admin) return { ok: true, admin: true, release, staff, reason: 'open' };
  if ((release === 'support' || opts.ignoreRelease) && listed) return { ok: true, admin: false, release, staff, reason: 'open' };
  return { ok: false, admin: false, release, staff, reason: listed ? 'before_release' : 'not_support' };
}

export interface WorkUser {
  user: HubUser;
  access: WorkAccess;
  /** The person's name on every change, whoever the access check was run as. */
  actor: string;
  /** The address changes and saved views are filed under: the signed-in person, or the person a test run acts as. */
  email: string;
  /** What this person sees and may change. Admins carry an all-access scope. */
  scope: Scope;
  /** Set on a test run by the agent key as another role: writes are limited to this one partner record. */
  testCid?: string;
}

/** The one record a role test may change. */
export const TEST_RECORD = '27202';

/**
 * The signed-in person, checked against the gate. An admin may add ?as=<email> to see what that person would get (the gate
 * screens and the Support Team's lists) while changes are still made, and logged, as the admin.
 */
export async function requireWork(env: Env, request: Request, opts: { adminOnly?: boolean } = {}): Promise<WorkUser> {
  const user = hubUserOf(request);
  if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  let email = user.email;
  let admin = user.role === 'admin';
  let name = user.name || user.email;
  let testCid: string | undefined;
  // Role tests. Only the agent key (never a person's browser session) may act as someone else, and then only on the test record.
  const actAs = (request.headers.get('X-Act-As') || '').trim().toLowerCase();
  if (actAs && user.via === 'agent') {
    if (!/^[a-z0-9._-]+@favorintl\.org$/.test(actAs)) throw new HttpError(400, 'bad_email', 'Use a favorintl.org address.');
    email = actAs;
    admin = false;
    testCid = TEST_RECORD;
    const st = await staffByEmail(env, actAs).catch(() => null);
    name = `${st ? st.name : actAs} (role test)`;
  }
  const as = new URL(request.url).searchParams.get('as');
  if (as && admin) {
    email = as.trim().toLowerCase();
    admin = false;
  }
  if (opts.adminOnly && !admin) throw new HttpError(403, 'admin_only', 'Only an admin can change this.');
  const access = await workAccessFor(env, email, admin, { ignoreRelease: !!testCid });
  if (!access.ok) {
    const msg =
      access.reason === 'before_release'
        ? 'The Work Center opens for you soon. Admins are testing it first.'
        : 'The Work Center is for the people whose job touches it. If yours does, tell the technology team through Feedback.';
    throw new HttpError(403, 'admin_only', msg);
  }
  const scope = (await scopeFor(env, email, admin)) || { role: 'admin' as const, email, name, fid: null, team: '', all: false, fids: new Set<string>() };
  // An admin using ?as= is only looking at the gate screens and lists: changes stay the admin's own.
  const viewing = !!as && user.role === 'admin' && !actAs;
  return { user, access, actor: viewing ? user.name || user.email : name, email: viewing ? user.email : email, scope: viewing ? { ...scope, all: true } : scope, testCid };
}
