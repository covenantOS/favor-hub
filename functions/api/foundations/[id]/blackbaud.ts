import { requireFoundationsUser } from '../../../_lib/foundations/auth';
import { orgByLookup, searchOrgs } from '../../../_lib/foundations/blackbaud';
import { getFoundation, nameKey } from '../../../_lib/foundations/db';
import { errorJson, handleError, json, type Env } from '../../../_lib/http';

/** What Blackbaud holds on this foundation: its own record when linked, look-alike records when not. */
export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireFoundationsUser(env, request);
    const f = await getFoundation(env, String(params.id));
    if (!f) return errorJson('not_found', 'That foundation is not on the list.', 404);
    try {
      if (f.bb_lookup_id) {
        return json({ ok: true, linked: await orgByLookup(env, f.bb_lookup_id), suggestions: [] });
      }
      const distinct = nameKey(f.name).split(' ').sort((a, b) => b.length - a.length).slice(0, 3).join(' ');
      return json({ ok: true, linked: null, suggestions: distinct ? await searchOrgs(env, distinct, 4) : [] });
    } catch (err) {
      console.error('[foundations] mirror', err);
      return json({ ok: true, linked: null, suggestions: [], offline: true });
    }
  } catch (err) {
    return handleError(err);
  }
};
