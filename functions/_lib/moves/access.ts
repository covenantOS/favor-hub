// Who gets Moves and the relationship map. One hub setting, moves.board: off (the default), admins, or on. Off means staff never see the
// page, the menu entry, the map on the partner record or the routes. Will and the two test accounts always do, so the feature is checked
// before anyone else gets it. On opens it to everyone the Work Center lets in; the board's own role and portfolio rules still apply.
import { hubSettings } from '../admin/hubcache';
import type { Env } from '../http';
import { isTester } from '../testuser';

export const SETTING = 'moves.board';
export type MovesMode = 'off' | 'admins' | 'on';
export const OWNER = 'will@favorintl.org';

export async function movesMode(env: Env): Promise<MovesMode> {
  try {
    const v = String((await hubSettings(env)).get(SETTING)?.value || '').trim().toLowerCase();
    return v === 'on' || v === 'admins' ? v : 'off';
  } catch {
    return 'off';
  }
}

export function mayUseMovesIn(mode: MovesMode, user: { email: string; role: string }): boolean {
  const email = String(user.email || '').toLowerCase();
  if (isTester(email) || email === OWNER) return true;
  if (mode === 'off') return false;
  if (mode === 'admins') return user.role === 'admin';
  return true;
}

export async function mayUseMoves(env: Env, user: { email: string; role: string }): Promise<boolean> {
  return mayUseMovesIn(await movesMode(env), user);
}
