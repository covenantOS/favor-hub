import { mirror } from '../../_lib/foundations/blackbaud';
import { yourDayBlackbaud } from '../../_lib/hub/actions';
import { mailUnreadCount } from '../../_lib/mail/route';
import { accessToken, CAL_EVENTS, easternDay, hasScopes, recentFiles, todaysEvents, unreadMail, type DayEvent } from '../../_lib/hub/google';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { isTester } from '../../_lib/testuser';

/** Which FavorOS room an event already has: a link to a room in the event, a room made from it, or a room moved from it without touching the event. */
async function withRooms(env: Env, email: string, events: DayEvent[] | null): Promise<DayEvent[] | null> {
  if (!events) return events;
  const out = events.map((e) => ({ ...e }));
  const ids = out.map((e) => e.id).filter(Boolean);
  try {
    if (ids.length) {
      const keys = ids.flatMap((i) => [i, 'ext:' + i]);
      const rows = await env.DB.prepare(`SELECT id, calendar_event_id FROM hub_meetings WHERE status != 'cancelled' AND calendar_event_id IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ id: string; calendar_event_id: string }>();
      const by = new Map((rows.results || []).map((r) => [r.calendar_event_id.replace(/^ext:/, ''), r.id]));
      for (const e of out) if (!e.hub && by.has(e.id)) e.hub = by.get(e.id) as string;
    }
    // Rooms for today that are not on the calendar at all (booked without a calendar event, or a huddle) still belong in the day.
    const d = easternDay();
    const rows = await env.DB.prepare(
      `SELECT id, title, starts_at, ends_at, invitees, host_email FROM hub_meetings WHERE status IN ('scheduled', 'live') AND starts_at >= ?1 AND starts_at <= ?2
          AND (lower(host_email) = ?3 OR instr(lower(invitees), '"' || ?3 || '"') > 0)`
    ).bind(new Date(d.start).toISOString(), new Date(d.end).toISOString(), email).all<{ id: string; title: string; starts_at: string; ends_at: string | null; invitees: string }>();
    const have = new Set(out.map((e) => e.hub).filter(Boolean));
    for (const r of rows.results || []) {
      if (have.has(r.id)) continue;
      let people: string[] = [];
      try { people = (JSON.parse(r.invitees || '[]') as Array<{ email?: string }>).map((i) => String(i.email || '').toLowerCase()).filter((x) => x && x !== email); } catch { people = []; }
      out.push({ id: '', start: r.starts_at, end: r.ends_at || r.starts_at, allDay: false, title: r.title || 'Meeting', link: '', meet: '', phone: '', provider: 'favor', source: 'Favor Meetings', people, hub: r.id, organizer: true, canEdit: false, declined: false });
    }
  } catch {
    // The hub's own list could not be read; the calendar still shows.
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

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
      if (user.via !== 'google') return { connected: false, events: await withRooms(env, email, []) };
      // A test user has no Google account: Today shows the sample mailbox's unread mail so the card and the menu count agree.
      if (isTester(email)) {
        const [sample, count, sampleP] = await Promise.all([import('../../_lib/mail/sample').then((m) => m.sampleUnread(env, email)).catch(() => null), mailUnreadCount(env, email).catch(() => null), import('../../_lib/mail/sample').then((m) => m.samplePartners(env, ['maya.okafor@example.org', 'tom@whitfieldfamily.example', 'dortiz@example.com'])).catch(() => ({}))]);
        return { connected: true, events: await withRooms(env, email, []), mayWrite: false, files: null, mail: sample, mailUnread: count, partners: Object.fromEntries(Object.entries(sampleP as Record<string, { id: string; name: string }>).map(([k, v]) => [k, { id: v.id, name: v.name }])) };
      }
      const t = await accessToken(env, email);
      if (!t) return { connected: false, events: await withRooms(env, email, []) };
      const [events, files, mail, mailUnread] = await Promise.all([
        todaysEvents(t.token).catch(() => null),
        recentFiles(t.token).catch(() => null),
        unreadMail(t.token).catch((e) => (console.error('[day] unread mail', String(e && e.message ? e.message : e)), null)),
        mailUnreadCount(env, email).catch(() => null),
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
      const mayWrite = hasScopes(t.scopes, [CAL_EVENTS]);
      return { connected: true, events: await withRooms(env, email, events), mayWrite, files, mail, mailUnread, partners };
    })()).catch((e) => ({ connected: true, error: String(e.message || e) }));

    const [blackbaud, g] = await Promise.all([bb, google]);
    const res = json({ ok: true, blackbaud, google: g });
    res.headers.set('Server-Timing', marks.join(', '));
    return res;
  } catch (err) {
    return handleError(err);
  }
};
