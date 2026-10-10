// Who may use the Work Center. Admins only until leadership releases it; then admins plus everyone on the staff list marked for it.
// Every route checks the gate itself, because hiding the menu item hides nothing from a person who knows the address.
import { HttpError, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { getRelease, staffByEmail, type Release, type StaffRow } from './db';

export interface WorkAccess {
  ok: boolean;
  admin: boolean;
  release: Release;
  staff: StaffRow | null;
  /** Why the page stays closed: before release (admins are testing) or not on the Support Team. */
  reason: 'open' | 'before_release' | 'not_support';
}

export async function workAccessFor(env: Env, email: string, admin: boolean): Promise<WorkAccess> {
  const release = await getRelease(env).catch(() => 'admins' as Release);
  const staff = await staffByEmail(env, email).catch(() => null);
  const listed = !!staff && staff.work_center === 1 && staff.active === 1;
  if (admin) return { ok: true, admin: true, release, staff, reason: 'open' };
  if (release === 'support' && listed) return { ok: true, admin: false, release, staff, reason: 'open' };
  return { ok: false, admin: false, release, staff, reason: listed ? 'before_release' : 'not_support' };
}

export interface WorkUser {
  user: HubUser;
  access: WorkAccess;
  /** The person's name on every change, whoever the access check was run as. */
  actor: string;
}

/**
 * The signed-in person, checked against the gate. An admin may add ?as=<email> to see what that person would get (the gate
 * screens and the Support Team's lists) while changes are still made, and logged, as the admin.
 */
export async function requireWork(env: Env, request: Request, opts: { adminOnly?: boolean } = {}): Promise<WorkUser> {
  const user = hubUserOf(request);
  if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  let email = user.email;
  let admin = user.role === 'admin';
  const as = new URL(request.url).searchParams.get('as');
  if (as && admin) {
    email = as.trim().toLowerCase();
    admin = false;
  }
  if (opts.adminOnly && !admin) throw new HttpError(403, 'admin_only', 'Only an admin can change this.');
  const access = await workAccessFor(env, email, admin);
  if (!access.ok) {
    const msg =
      access.reason === 'before_release'
        ? 'The Work Center opens for you soon. Admins are testing it first. The Support Team gets it next.'
        : 'The Work Center is for the Support Team. If your work needs it, tell the technology team through Feedback.';
    throw new HttpError(403, 'admin_only', msg);
  }
  return { user, access, actor: user.name || user.email };
}
