// Where the Work Center opens for each person: a tab and what Open actions shows. Kept in act_settings under start:<email>
// (the saved views table already has its own "opens first" flag for filters, so the two stay apart).
import { HttpError, type Env } from '../http';
import { getSetting, setSetting } from './db';
import { DEFAULT_TAB, START_SCOPES, type Scope, type StartScope } from './role';

export interface StartPref {
  tab: string;
  scope: StartScope | '';
}

const TAB_ID = /^[a-z][a-z0-9_-]{1,31}$/;

export async function getStart(env: Env, email: string, s: Scope | undefined) {
  const raw = await getSetting(env, `start:${email.toLowerCase()}`, '').catch(() => '');
  let pref: StartPref | null = null;
  try {
    const p = raw ? JSON.parse(raw) : null;
    if (p && TAB_ID.test(String(p.tab || ''))) pref = { tab: String(p.tab), scope: (START_SCOPES as readonly string[]).includes(p.scope) ? p.scope : '' };
  } catch {
    pref = null;
  }
  const role = s ? s.role : 'admin';
  return { pref, role, defaultTab: DEFAULT_TAB[role], scopes: START_SCOPES };
}

export async function putStart(env: Env, email: string, s: Scope | undefined, v: { tab?: unknown; scope?: unknown; reset?: unknown }) {
  const key = `start:${email.toLowerCase()}`;
  if (v.reset) await setSetting(env, key, '');
  else {
    const tab = String(v.tab || '');
    if (!TAB_ID.test(tab)) throw new HttpError(400, 'bad_tab', 'Pick a tab to open on.');
    const scope = (START_SCOPES as readonly string[]).includes(String(v.scope)) ? String(v.scope) : '';
    await setSetting(env, key, JSON.stringify({ tab, scope }));
  }
  return getStart(env, email, s);
}
