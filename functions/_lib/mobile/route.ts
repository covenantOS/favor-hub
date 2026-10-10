// The wrapper every iPhone route uses. It takes the signed-in person from the middleware (a device token, nothing else), applies the
// Work Center's gate (admins until leadership releases it, so these routes stay inert for staff the same way the web page does),
// finds the person's row in the staff list, and answers in the staff-worded error shape.
import { hitRateLimit } from '../auth';
import { HttpError, handleError, json, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { staffByEmail, type StaffRow } from '../work/db';
import { workAccessFor, type WorkAccess } from '../work/gate';
import { scopeFor } from '../work/role';
import { blackbaudRepo, type ActionsRepo } from '../work/repo';
import type { Ctx } from '../work/service';
import type { MobileEnv } from './auth';

export interface MobileArgs {
  request: Request;
  env: MobileEnv;
  params: Record<string, string | string[]>;
  waitUntil: (p: Promise<unknown>) => void;
  url: URL;
  user: HubUser;
  access: WorkAccess;
  staff: StaffRow | null;
  /** The person's Blackbaud fundraiser id, from the staff list. Empty when they are not on it. */
  fid: string;
  /** What the shared Work Center functions take. The repo is replaceable so tests never reach Blackbaud. */
  ctx: Ctx;
}

/** Tests replace the Blackbaud repo; the live routes build the real one. */
export const hooks: { repo?: (env: Env) => ActionsRepo } = {};

export function mobile(
  handler: (a: MobileArgs) => Promise<Response | Record<string, unknown>>,
  opts: { write?: boolean; noGate?: boolean } = {}
): PagesFunction<Env> {
  return async ({ request, env, params, waitUntil }) => {
    try {
      const user = hubUserOf(request);
      if (!user || user.via !== 'device') throw new HttpError(401, 'signin', 'Sign in again.');
      const access = await workAccessFor(env, user.email, user.role === 'admin');
      if (!access.ok && !opts.noGate) throw new HttpError(403, 'not_released', 'The app is not open for your account yet.');
      if (opts.write && (await hitRateLimit(env, `mobile:w:${user.email}`, 60, 60))) throw new HttpError(429, 'slow_down', 'Too many changes in a minute. Wait a moment.');
      const staff = await staffByEmail(env, user.email).catch(() => null);
      const fid = staff && staff.active === 1 && staff.bb_fundraiser_id ? String(staff.bb_fundraiser_id) : '';
      const repo = (hooks.repo || blackbaudRepo)(env);
      // The phone gets the same scope as the web page: what the person's role sees and may change.
      const admin = user.role === 'admin';
      const scope = (await scopeFor(env, user.email, admin).catch(() => null)) || { role: 'admin' as const, email: user.email, name: user.name || user.email, fid: null, team: '', all: false, fids: new Set<string>() };
      const ctx: Ctx = { env, repo, actor: user.name || user.email, email: user.email, scope };
      const out = await handler({ request, env: env as MobileEnv, params: params as Record<string, string | string[]>, waitUntil, url: new URL(request.url), user, access, staff, fid, ctx });
      if (out instanceof Response) return out;
      return json(out);
    } catch (err) {
      return handleError(err);
    }
  };
}

export const param = (p: Record<string, string | string[]>, k: string): string => String(Array.isArray(p[k]) ? p[k][0] : p[k] || '');

export async function jsonBody(request: Request): Promise<Record<string, any>> {
  const b = (await request.json().catch(() => ({}))) as unknown;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {};
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientIdOf(v: unknown): string {
  const id = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!UUID.test(id)) throw new HttpError(400, 'bad_client_id', 'client_id must be a UUID.');
  return id;
}

/** Claim a client_id for a write. A repeat returns the stored answer; one still running reports 409. */
export async function claimWrite(env: Env, email: string, clientId: string, op: string): Promise<{ stored: unknown } | { claimed: true }> {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO mobile_writes (email, client_id, op, state, created_at) VALUES (?, ?, ?, 'pending', ?)")
    .bind(email, clientId, op, new Date().toISOString())
    .run();
  if (Number(r.meta?.changes || 0) > 0) return { claimed: true };
  const row = await env.DB.prepare('SELECT state, result FROM mobile_writes WHERE email = ? AND client_id = ?').bind(email, clientId).first<{ state: string; result: string | null }>();
  if (row && row.state === 'done' && row.result) return { stored: JSON.parse(row.result) };
  throw new HttpError(409, 'in_progress', 'That change is already on its way.');
}

export async function finishWrite(env: Env, email: string, clientId: string, result: unknown): Promise<void> {
  await env.DB.prepare("UPDATE mobile_writes SET state = 'done', result = ? WHERE email = ? AND client_id = ?").bind(JSON.stringify(result), email, clientId).run();
}

export async function dropWrite(env: Env, email: string, clientId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM mobile_writes WHERE email = ? AND client_id = ? AND state = 'pending'").bind(email, clientId).run().catch(() => undefined);
}
