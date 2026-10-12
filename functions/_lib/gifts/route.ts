// The wrapper every gift entry route uses: admins and the people an admin gave access (the admin desk, Partner Care), a change must
// come from this site's own page, and errors read in staff words. `adminOnly` is for the settings routes.
import { HttpError, handleError, json, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { sameSite } from '../work/route';
import { blackbaudRepo, type ActionsRepo } from '../work/repo';
import { mirrorQ, type Q } from '../work/partner';
import { bbSender } from './bb';
import { mayOpen, mayPost, POSTING_OFF } from './perm';
import type { Ctx } from './flow';
import type { CaptureDeps } from './capture';
import type { BbSend } from './bb';

/** Tests replace Blackbaud, the two readers and the photo bucket. The live routes leave this empty. */
export const giftHooks: { repo?: (env: Env) => ActionsRepo; send?: (env: Env) => BbSend; read?: CaptureDeps['read']; triage?: CaptureDeps['triage']; bucket?: (env: Env) => R2Bucket } = {};

export interface GiftArgs {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (p: Promise<unknown>) => void;
  user: HubUser;
  actor: string;
  url: URL;
  flow: Ctx;
  deps: CaptureDeps;
  repo: ActionsRepo;
  q: Q;
  /** This person was switched on to send deposits to Blackbaud. Off for everyone until an admin says otherwise. */
  canPost: boolean;
}

export function gift(handler: (a: GiftArgs) => Promise<Response | Record<string, unknown>>, opts: { adminOnly?: boolean } = {}): PagesFunction<Env> {
  return async ({ request, env, params, waitUntil }) => {
    try {
      if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That request was blocked. Try again.');
      const user = hubUserOf(request);
      if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
      if (opts.adminOnly && user.role !== 'admin') throw new HttpError(403, 'admin_only', 'Admins only.');
      if (!(await mayOpen(env, user))) throw new HttpError(403, 'admin_only', 'Admins and the admin desk only.');
      const repo = (giftHooks.repo || blackbaudRepo)(env);
      const q = mirrorQ(env);
      const actor = user.name || user.email;
      const out = await handler({
        request, env, params: params as Record<string, string | string[]>, waitUntil, user, actor, url: new URL(request.url),
        flow: { env, send: (giftHooks.send || bbSender)(env), actor },
        deps: { repo, q, read: giftHooks.read, triage: giftHooks.triage, bucket: giftHooks.bucket ? giftHooks.bucket(env) : undefined },
        repo, q, canPost: await mayPost(env, user.email),
      });
      if (out instanceof Response) return out;
      return json(out.ok === undefined ? { ok: true, ...out } : out);
    } catch (err) {
      return handleError(err);
    }
  };
}

export const pid = (p: Record<string, string | string[]>, k = 'id'): string => String(Array.isArray(p[k]) ? p[k][0] : p[k] || '');

export async function jsonBody(request: Request): Promise<Record<string, any>> {
  const b = (await request.json().catch(() => ({}))) as unknown;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {};
}

/** Sending to Blackbaud, retrying a send and taking a batch back need a person an admin switched on. Everyone starts off. */
export function requirePosting(canPost: boolean): void {
  if (!canPost) throw new HttpError(409, 'posting_off', POSTING_OFF);
}
