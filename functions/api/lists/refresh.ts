import { HttpError, errorJson, handleError, json, type Env } from '../../_lib/http';
import { snapshotMeta } from '../../_lib/lists/service.ts';
import { refreshIfMirrorNewer, refreshSnapshot } from '../../_lib/lists/refresh.ts';
import { hubUserOf } from '../../_lib/session';
import { sameSite } from '../../_lib/work/route';

// Rebuild the lists snapshot now. An admin, the agent key (the overnight Worker and tests) may; everyone else reads the copy that exists.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'Reload the page and try again.');
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (user.role !== 'admin' && user.via !== 'agent') return errorJson('admin_only', 'Only an admin can rebuild the lists data.', 403);
    const r = new URL(request.url).searchParams.get('ifnewer') ? await refreshIfMirrorNewer(env) : await refreshSnapshot(env);
    return json({ ok: r.ok, busy: (r as any).busy ?? false, skipped: (r as any).skipped ?? null, result: (r as any).result ?? null, snapshot: await snapshotMeta(env) });
  } catch (err) {
    return handleError(err);
  }
};
