import { checkPassword } from '../../_lib/auth';
import { actorOf, requireFoundationsUser } from '../../_lib/foundations/auth';
import { logEvent, setSetting } from '../../_lib/foundations/db';
import { HttpError, asTrimmed, handleError, json, type Env } from '../../_lib/http';

/** Switch posting to Blackbaud on or off. Needs Will's board password, since the page code is shared. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireFoundationsUser(env, request);
    const data = (await request.json()) as Record<string, unknown>;
    if (!(await checkPassword(env, asTrimmed(data.password, 'password', 200)))) {
      throw new HttpError(401, 'bad_password', 'That is not the board password.');
    }
    const posting = data.posting === 'on' || data.posting === 'off' ? String(data.posting) : '';
    if (!posting) throw new HttpError(400, 'nothing', 'Nothing to change.');
    await setSetting(env, 'posting', posting);
    await logEvent(env, { kind: 'setting', actor: actorOf(request), detail: `posting ${posting}` });
    return json({ ok: true, posting });
  } catch (err) {
    return handleError(err);
  }
};
