import { requireFoundationsUser } from '../../_lib/foundations/auth';
import { connection } from '../../_lib/foundations/blackbaud';
import { getSetting } from '../../_lib/foundations/db';
import { handleError, json, type Env } from '../../_lib/http';

/** Whether this page can reach Blackbaud for writes and the mirror for reads. No Blackbaud call is made. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireFoundationsUser(env, request);
    const c = await connection(env);
    const rule = (await getSetting(env, 'rule:tags')).split('|')[0];
    return json({ ok: true, blackbaud: c.blackbaud, mirror: c.mirror, tags: rule === '1' ? 'on' : rule === '0' ? 'waiting' : 'unknown' });
  } catch (err) {
    return handleError(err);
  }
};
