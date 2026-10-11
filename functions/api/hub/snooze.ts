import { setSnooze, validSnoozeDate, etToday } from '../../_lib/hub/snooze';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Snooze a Today card until a day, or clear it with until: null (Undo). Blackbaud actions do not come here.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const b = (await request.json().catch(() => ({}))) as { key?: unknown; until?: unknown };
    const key = typeof b.key === 'string' ? b.key : '';
    if (!/^card:[a-z0-9-]{1,40}$/.test(key)) return errorJson('bad_key', 'That card cannot be snoozed.', 400);
    let until: string | null = null;
    if (b.until !== null && b.until !== undefined) {
      until = validSnoozeDate(b.until, etToday());
      if (!until) return errorJson('bad_date', 'Pick a day after today.', 400);
    }
    await setSnooze(env, user.email, key, until);
    return json({ ok: true, key, until });
  } catch (err) {
    return handleError(err);
  }
};
