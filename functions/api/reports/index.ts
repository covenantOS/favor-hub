import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { audiencesOf } from '../../_lib/reports/audience';
import { GROUPS, isReady, listFor, QUERY_MAP_ENTRY } from '../../_lib/reports/registry';

// The reports this person may open, each marked ready or coming soon, and the groups to sort them under.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const { admin, mine } = await audiencesOf(env, user);
    return json({ ok: true, groups: GROUPS, reports: listFor(mine, admin), queryMap: { ...QUERY_MAP_ENTRY, ready: isReady(QUERY_MAP_ENTRY.id) } });
  } catch (err) {
    return handleError(err);
  }
};
