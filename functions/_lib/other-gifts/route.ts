// The wrapper every Other gifts route uses: signed in, from this site's own page, and switched on for this person (access.ts). Errors read
// in staff words. The test accounts get a stand-in for Blackbaud, so nothing they do can write there.
import { HttpError, handleError, json, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { sameSite } from '../work/route';
import { blackbaudRepo, type ActionsRepo } from '../work/repo';
import { mirrorQ, type Q } from '../work/partner';
import { bbSender } from '../gifts/bb';
import { giftHooks } from '../gifts/route';
import { etParts } from '../actions/intake';
import { isTester } from '../testuser';
import { mayApprove, mayUseOther } from './access';
import { simulatedSender, type PostCtx } from './post';

export interface OgArgs {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (p: Promise<unknown>) => void;
  user: HubUser;
  actor: string;
  url: URL;
  repo: ActionsRepo;
  q: Q;
  today: string;
  /** This person may approve batches (an admin, or switched on for posting). The second-person rule is checked per batch. */
  canApprove: boolean;
  isTest: boolean;
  post: PostCtx;
}

export function og(handler: (a: OgArgs) => Promise<Response | Record<string, unknown>>, opts: { adminOnly?: boolean } = {}): PagesFunction<Env> {
  return async ({ request, env, params, waitUntil }) => {
    try {
      if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That request was blocked. Try again.');
      const user = hubUserOf(request);
      if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
      if (opts.adminOnly && user.role !== 'admin') throw new HttpError(403, 'admin_only', 'Admins only.');
      if (!opts.adminOnly && !(await mayUseOther(env, user))) throw new HttpError(403, 'not_on', 'Other gifts is not switched on for you yet.');
      const test = isTester(user.email);
      const repo = (giftHooks.repo || blackbaudRepo)(env);
      const actor = user.name || user.email;
      const send = test ? simulatedSender() : (giftHooks.send || bbSender)(env);
      const bucket = giftHooks.bucket ? giftHooks.bucket(env) : ((env as any).GIFT_CAPTURES as R2Bucket);
      const out = await handler({
        request, env, params: params as Record<string, string | string[]>, waitUntil: waitUntil || (() => undefined), user, actor, url: new URL(request.url),
        repo, q: mirrorQ(env), today: etParts(new Date()).date,
        canApprove: opts.adminOnly ? false : await mayApprove(env, user),
        isTest: test,
        post: {
          env, send, simulated: test,
          letterBytes: async (key) => {
            const o = await bucket.get(key);
            return o ? new Uint8Array(await o.arrayBuffer()) : null;
          },
        },
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

export const bucketOf = (env: Env): R2Bucket => (giftHooks.bucket ? giftHooks.bucket(env) : ((env as any).GIFT_CAPTURES as R2Bucket));
