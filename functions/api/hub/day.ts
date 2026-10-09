import { mirror } from '../../_lib/foundations/blackbaud';
import { accessToken, recentFiles, todaysEvents, unreadMail } from '../../_lib/hub/google';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Your day, for Today: open Blackbaud actions assigned to you (overdue and the next 7 days), and,
// once you have connected Google, today's meetings, files shared or changed by others this week,
// and unread mail. Meetings and mail are matched to partners in Blackbaud by email address.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const email = user.via === 'google' ? user.email.toLowerCase() : 'will@favorintl.org';

    const bb = (async () => {
      const fr = await mirror<{ id: string }>(env, 'SELECT id FROM fundraisers WHERE lower(fundraiser_email) = ? LIMIT 1', [email]);
      if (!fr.length) return { linked: false, actions: [] as any[], overdue: 0 };
      const rows = await mirror<any>(
        env,
        `SELECT a.id, substr(a.action_date_due, 1, 10) AS due, a.action_type AS type, a.action_category AS category, a.action_summary AS summary,
                a.constituent_record_id AS cid, COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS partner
           FROM actions a LEFT JOIN constituents c ON c.id = a.constituent_record_id
          WHERE a.action_completed_date IS NULL AND a.action_date_due <= date('now', '+7 day')
            AND EXISTS (SELECT 1 FROM json_each(a.raw_json, '$.fundraisers') j WHERE j.value = ?)
          ORDER BY a.action_date_due LIMIT 60`,
        [fr[0].id]
      );
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      return { linked: true, actions: rows.slice(0, 12), overdue: rows.filter((r) => r.due < today).length, total: rows.length };
    })().catch((e) => ({ linked: false, actions: [], overdue: 0, error: String(e.message || e) }));

    const google = (async () => {
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
    })().catch((e) => ({ connected: true, error: String(e.message || e) }));

    const [blackbaud, g] = await Promise.all([bb, google]);
    return json({ ok: true, blackbaud, google: g });
  } catch (err) {
    return handleError(err);
  }
};
