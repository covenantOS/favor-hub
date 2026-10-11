// Who may use Favor Chat. The whole feature is admin only until the hub setting chat.enabled says otherwise:
//   admins (default)  hub admins
//   staff             every signed-in staff member
//   off               nobody
// The setting lives in hub_settings, so an admin changes it in Admin > Chat and the change is audited like any other.
import { HttpError, type Env } from '../http';
import { effective } from '../admin/settings';
import type { HubUser } from '../session';

export type ChatMode = 'admins' | 'staff' | 'off';

export async function chatMode(env: Env): Promise<ChatMode> {
  const v = (await effective(env, 'chat.enabled', undefined, 'admins').catch(() => 'admins')).toLowerCase();
  return v === 'staff' || v === 'off' ? v : 'admins';
}

export function mayUse(mode: ChatMode, user: Pick<HubUser, 'role' | 'via' | 'email'> | null): boolean {
  if (!user || mode === 'off') return false;
  // The agent key and the script password session are not people in the directory, so they cannot chat.
  if (user.via === 'agent') return false;
  if (mode === 'staff') return true;
  return user.role === 'admin';
}

/** The signed-in person when they may use Chat, else a 401 or 403 the route returns as is. */
export async function chatUser(env: Env, user: HubUser | null): Promise<HubUser> {
  if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const mode = await chatMode(env);
  if (!mayUse(mode, user)) throw new HttpError(403, 'forbidden', mode === 'off' ? 'Chat is switched off.' : 'Chat is open to hub admins for now.');
  return user;
}
