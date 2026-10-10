import { mirror } from '../../_lib/foundations/blackbaud';
import { yourDayBlackbaud } from '../../_lib/hub/actions';
import { accessToken, recentFiles, todaysEvents, unreadMail } from '../../_lib/hub/google';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Your day, for Today: open Blackbaud actions assigned to you (overdue and the next 7 days) and,
// once you have connected Google, today's meetings, files shared or changed by others this week,
// and unread mail. What counts as an open action is defined in _lib/hub/actions.ts. Meetings and
// mail are matched to partners in Blackbaud by email address.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const email = user.via === 'google' ? user.email.toLowerCase() : 'will@favorintl.org';

    const t0 = Date.now();
    const marks: string[] = [];
    const mark = <T,>(n: string, p: Promise<T>) => p.finally(() => marks.push(`${n};dur=${Date.now() - t0}`));
    const bb = mark('bb', (async () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      return await yourDayBlackbaud((sql, params) => mirror(env, sql, params), email, today);
    })()).catch((e) => ({ linked: false, actions: [] as any[], total: 0, overdue: 0, error: String(e.message || e) }));

    const google = mark('google', (async () => {
      if (user.via !== 'google') return { connected: false };
      const t = await accessToken(env, email);
      if (!t) return { connected: false };
      const [events, files, mail] = await Promise.all([
        todaysEvents(t.token).catch(() => null),
        recentFiles(t.token).catch(() => null),
        unreadMail(t.token).catch(() => null),
      ]);
      // Who among meeting guests and mail senders is a partner in Blackbaud.
      const emails = [...new Set([...(events || []).flatMap((e) => e.people), ...(mail || []).map((m) => m.fromEmail)])].filter((e) => e && !e.endsWith('@favorintl.org')).slice(0, 60);
      let partners: Record<string, { name: string; id: string }> = {};
      if (emails.length) {
        const rows = await mirror<any>(
          env,
          `SELECT lower(e.email_address) AS email, e.constituent_record_id AS id,
                  COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS name
             FROM emails e JOIN constituents c ON c.id = e.constituent_record_id
            WHERE lower(e.email_address) IN (${emails.map(() => '?').join(',')})`,
          emails
        ).catch(() => []);
        partners = Object.fromEntries(rows.map((r: any) => [r.email, { name: r.name, id: String(r.id) }]));
      }
      return { connected: true, events, files, mail, partners };
    })()).catch((e) => ({ connected: true, error: String(e.message || e) }));

    const [blackbaud, g] = await Promise.all([bb, google]);
    const res = json({ ok: true, blackbaud, google: g });
    res.headers.set('Server-Timing', marks.join(', '));
    return res;
  } catch (err) {
    return handleError(err);
  }
};
