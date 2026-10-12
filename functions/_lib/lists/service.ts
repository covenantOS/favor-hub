// What the Lists routes share: the hub database as a query function, the person's partner scope, the snapshot's freshness and refresh,
// and saved lists with their sharing rules.
import { HttpError, newId, nowIso, type Env } from '../http.ts';
import type { WorkUser } from '../work/gate';
import { normalizeSpec, type ListSpec, type Scope } from './criteria.ts';
import type { Q } from './run.ts';

export const todayET = (now = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

export const hubQ =
  (env: Env): Q =>
  async (sql, params) =>
    ((await env.DB.prepare(sql).bind(...params).all()).results || []) as Array<Record<string, any>>;

/** Lists follow the Work Center's partner access: an admin sees every partner, everyone else sees the partners their scope holds. */
export function scopeOf(w: WorkUser): Scope {
  return { all: Boolean(w.scope.all), fids: [...w.scope.fids] };
}

export interface SnapMeta {
  asOf: string;
  builtAt: string;
  households: number;
  gifts: number;
  ms: number;
}

export async function snapshotMeta(env: Env): Promise<SnapMeta | null> {
  const row = await env.DB.prepare(`SELECT value FROM lr_meta WHERE key = 'snapshot'`).first<{ value: string }>().catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SnapMeta;
  } catch {
    return null;
  }
}

// ---- saved lists ----
export interface Saved {
  id: string;
  owner: string;
  ownerName: string;
  name: string;
  kind: string;
  spec: ListSpec;
  scope: 'private' | 'team' | 'all';
  team: string | null;
  updatedAt: string;
  mine: boolean;
}

interface SavedRow {
  id: string;
  owner: string;
  owner_name: string;
  name: string;
  kind: string;
  spec: string;
  scope: string;
  team: string | null;
  updated_at: string;
}

const shape = (r: SavedRow, email: string): Saved => ({
  id: r.id,
  owner: r.owner,
  ownerName: r.owner_name,
  name: r.name,
  kind: r.kind,
  spec: normalizeSpec(JSON.parse(r.spec)),
  scope: r.scope === 'team' || r.scope === 'all' ? r.scope : 'private',
  team: r.team,
  updatedAt: r.updated_at,
  mine: r.owner === email,
});

/** A person's team code from the staff list (support, rdd, partner_care ...), or ''. */
export async function teamOf(env: Env, email: string): Promise<string> {
  const r = await env.DB.prepare(`SELECT team FROM act_staff WHERE email = ?1 AND active = 1`).bind(email.toLowerCase()).first<{ team: string }>().catch(() => null);
  return r?.team || '';
}

export async function listSaved(env: Env, email: string): Promise<Saved[]> {
  const team = await teamOf(env, email);
  const rows = await env.DB.prepare(
    `SELECT * FROM lr_saved WHERE owner = ?1 OR scope = 'all' OR (scope = 'team' AND team = ?2 AND ?2 <> '') ORDER BY updated_at DESC LIMIT 200`
  )
    .bind(email.toLowerCase(), team)
    .all<SavedRow>();
  return (rows.results || []).map((r) => shape(r, email.toLowerCase()));
}

export async function getSaved(env: Env, email: string, id: string): Promise<Saved | null> {
  return (await listSaved(env, email)).find((s) => s.id === id) ?? null;
}

export interface SaveInput {
  name?: unknown;
  spec?: unknown;
  scope?: unknown;
}

export async function saveList(env: Env, who: { email: string; name: string }, input: SaveInput, id?: string): Promise<Saved> {
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'name', 'Name the list.');
  const spec = normalizeSpec(input.spec);
  const scope = input.scope === 'team' || input.scope === 'all' ? input.scope : 'private';
  const team = scope === 'team' ? await teamOf(env, who.email) : '';
  if (scope === 'team' && !team) throw new HttpError(400, 'no_team', 'You are not on a team, so there is no team to share with.');
  const email = who.email.toLowerCase();
  const now = nowIso();
  if (id) {
    const own = await env.DB.prepare(`SELECT owner FROM lr_saved WHERE id = ?1`).bind(id).first<{ owner: string }>();
    if (!own) throw new HttpError(404, 'not_found', 'That list is gone.');
    if (own.owner !== email) throw new HttpError(403, 'not_yours', 'Only the person who saved a list can change it.');
    await env.DB.prepare(`UPDATE lr_saved SET name = ?2, kind = ?3, spec = ?4, scope = ?5, team = ?6, updated_at = ?7 WHERE id = ?1`).bind(id, name, spec.kind, JSON.stringify(spec), scope, team || null, now).run();
  } else {
    id = newId('lst');
    await env.DB.prepare(`INSERT INTO lr_saved (id, owner, owner_name, name, kind, spec, scope, team, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`)
      .bind(id, email, who.name, name, spec.kind, JSON.stringify(spec), scope, team || null, now)
      .run();
  }
  return (await getSaved(env, email, id))!;
}

export async function deleteSaved(env: Env, email: string, id: string): Promise<void> {
  const r = await env.DB.prepare(`DELETE FROM lr_saved WHERE id = ?1 AND owner = ?2`).bind(id, email.toLowerCase()).run();
  if (!r.meta?.changes) throw new HttpError(404, 'not_found', 'That list is not yours to delete, or it is already gone.');
}

/**
 * Who may add email and phone columns. Admins always. Everyone else only when the staff list puts them on Support or Partner Care (the teams
 * that call and write to partners), unless Admin set act_settings lists:contacts to "*" (every Work Center user) or a comma list of emails.
 */
export async function contactAccess(env: Env, email: string, admin: boolean): Promise<boolean> {
  if (admin) return true;
  const e = email.toLowerCase();
  const row = await env.DB.prepare(`SELECT value FROM act_settings WHERE key = 'lists:contacts'`).first<{ value: string }>().catch(() => null);
  const v = (row?.value || '').trim();
  if (v === '*') return true;
  if (v) return v.toLowerCase().split(',').map((x) => x.trim()).includes(e);
  const team = await teamOf(env, e);
  return team === 'support' || team === 'partner_care';
}
