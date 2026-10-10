// What the signed-in person's clips take up against their 10 GB, and the oldest clips nobody has watched once they pass 80%.
import { handleError, json } from '../../_lib/http';
import { staffOrError, usageOf, type ClipsEnv } from '../../_lib/clips';

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    return json({ ok: true, usage: await usageOf(env, who.user.email) }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
