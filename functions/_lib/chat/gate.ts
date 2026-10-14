// Who may use Favor Chat. The whole feature is admin only until the hub setting chat.enabled says otherwise:
//   admins (default)  hub admins
//   staff             every signed-in staff member
//   group             admins plus the people and teams in chat.access (functions/_lib/access.ts)
//   off               nobody
// The setting lives in hub_settings, so an admin changes it in Admin > Chat and the change is audited like any other.
import { HttpError, type Env } from '../http';
import { allowedBy, featureMode, groupMembers, refusal, type AccessMode } from '../access';
import type { HubUser } from '../session';

export type ChatMode = AccessMode;

export async function chatMode(env: Env): Promise<ChatMode> {
  return featureMode(env, 'chat');
}

/** `members` is the group (chat.access) and only matters in group mode; see chatAllowed(). */
export function mayUse(mode: ChatMode, user: Pick<HubUser, 'role' | 'via' | 'email'> | null, members: Set<string> | null = null): boolean {
  return allowedBy(mode, members, user);
}

/** The people the group names, or null outside group mode. */
export async function chatGroup(env: Env, mode?: ChatMode): Promise<Set<string> | null> {
  return (mode || (await chatMode(env))) === 'group' ? groupMembers(env, 'chat') : null;
}

/** The signed-in person when they may use Chat, else a 401 or 403 the route returns as is. */
export async function chatUser(env: Env, user: HubUser | null): Promise<HubUser> {
  if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const mode = await chatMode(env);
  if (!mayUse(mode, user, await chatGroup(env, mode))) throw new HttpError(403, 'forbidden', refusal(mode, 'Chat'));
  return user;
}
