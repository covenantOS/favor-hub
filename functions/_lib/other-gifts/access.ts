// Who sees Other gifts. One hub setting, gifts.other: off (the default), admins, or on. Off means staff never see the page, the menu entry
// or the routes. Will and the two test accounts always do, so the page can be checked before anyone else gets it. Turning it on is Will's
// call, after Michael agrees to the new way these gifts are entered. Approving a batch also needs an admin or a person an admin switched on
// for posting (the same switch Gift entry uses).
import { hubSettings } from '../admin/hubcache';
import { hubPut } from '../admin/settings';
import { HttpError, type Env } from '../http';
import { mayOpen, mayPost } from '../gifts/perm';
import { isEarlyEmail } from '../early';
import { isTester } from '../testuser';

export const SETTING = 'gifts.other';
export type OgMode = 'off' | 'admins' | 'on';
export const OWNER = 'will@favorintl.org';

export async function ogMode(env: Env): Promise<OgMode> {
  try {
    const v = String((await hubSettings(env)).get(SETTING)?.value || '').trim().toLowerCase();
    return v === 'on' || v === 'admins' ? v : 'off';
  } catch {
    return 'off';
  }
}

export async function setOgMode(env: Env, by: string, mode: string): Promise<OgMode> {
  if (mode !== 'off' && mode !== 'admins' && mode !== 'on') throw new HttpError(400, 'bad_mode', 'Choose off, admins or on.');
  await hubPut(env, SETTING, mode, by);
  return mode;
}

export async function mayUseOther(env: Env, user: { email: string; role: string }): Promise<boolean> {
  const email = user.email.toLowerCase();
  if (isTester(email) || email === OWNER) return true;
  if (await isEarlyEmail(env, String(user.email || '')).catch(() => false)) return true;
  const mode = await ogMode(env);
  if (mode === 'off') return false;
  if (mode === 'admins') return user.role === 'admin';
  return mayOpen(env, user);
}

export async function mayApprove(env: Env, user: { email: string; role: string }): Promise<boolean> {
  if (!(await mayUseOther(env, user))) return false;
  const email = user.email.toLowerCase();
  if (user.role === 'admin' || isTester(email)) return true;
  return mayPost(env, email);
}
