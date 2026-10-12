import { accessToken, CAL_EVENTS, hasScopes } from '../../_lib/hub/google';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { providerOf } from '../../_lib/meetprovider';

// Move to FavorOS, from Today. An outside meeting on the person's calendar (Zoom, Google Meet, Teams, a phone call or no link at all)
// becomes a FavorOS meeting at the same time with the same people. The calendar event is left as it is, except when the person
// confirmed the sheet that says so: then one line with the FavorOS link is added to the event's notes, with no email to anyone
// (sendUpdates=none). The meeting is made without recording and without reminders, so moving never emails or records anyone.
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events/';
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const clean = (v: unknown, n: number) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via !== 'google') return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const me = user.email.toLowerCase();
    const b = (await request.json().catch(() => ({}))) as { eventId?: string; writeLink?: boolean };
    const eventId = clean(b.eventId, 200);
    if (!eventId) return errorJson('event', 'Pick a meeting to move.', 400);

    const t = await accessToken(env, me).catch(() => null);
    if (!t) return errorJson('consent', 'Connect your Google Calendar first.', 409);
    const read = await fetch(CAL + encodeURIComponent(eventId), { headers: { Authorization: `Bearer ${t.token}` } });
    if (!read.ok) return errorJson('calendar', read.status === 404 ? 'That event is no longer on your calendar.' : 'Google Calendar did not answer.', read.status === 404 ? 404 : 502);
    const ev = (await read.json()) as any;
    if (ev.status === 'cancelled') return errorJson('calendar', 'That event is no longer on your calendar.', 404);
    if (!ev.start?.dateTime || !ev.end?.dateTime) return errorJson('all_day', 'An all-day event has no time to move.', 400);

    const startsAt = new Date(ev.start.dateTime).toISOString();
    const endsAt = new Date(ev.end.dateTime).toISOString();
    if (Date.parse(endsAt) < Date.now()) return errorJson('past', 'That meeting has already ended.', 400);

    const have = await env.DB.prepare(`SELECT id FROM hub_meetings WHERE status != 'cancelled' AND calendar_event_id IN (?1, ?2) LIMIT 1`).bind(ev.id, 'ext:' + ev.id).first<{ id: string }>();
    if (have) return json({ ok: false, error: 'already', message: 'This meeting is already in FavorOS.', id: have.id }, 409);
    if (providerOf(ev).provider === 'favor') return errorJson('already', 'This meeting is already in FavorOS.', 409);

    const writeLink = b.writeLink === true;
    if (writeLink && !hasScopes(t.scopes, [CAL_EVENTS])) return errorJson('consent', 'Allow FavorOS to add to your calendar events. Google asks once.', 409);

    const id = hex(12);
    const dur = Math.max(10, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000));
    const invitees = ((ev.attendees || []) as any[])
      .filter((a) => !a.self && !a.resource && a.email && String(a.email).toLowerCase() !== me)
      .slice(0, 200)
      .map((a) => ({ email: String(a.email).toLowerCase(), name: clean(a.displayName, 120), team: '', guest: false }));
    const stamp = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, repeat, series_id, calendar_event_id, backup_link, remind)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, 'off', 'invited', ?, 'scheduled', ?, 'none', '', ?, '', 0)`
    ).bind(id, clean(ev.summary, 140) || 'Meeting', me, user.name, startsAt, endsAt, dur, JSON.stringify(invitees), stamp, 'ext:' + ev.id).run();

    const room = `${new URL(request.url).origin}/meet/room/?m=${id}`;
    let linked = false;
    let linkError = '';
    if (writeLink) {
      const desc = String(ev.description || '');
      const gap = /<[a-z][^>]*>/i.test(desc) ? '<br><br>' : '\n\n';
      const line = `Join in FavorOS: ${room}`;
      const res = await fetch(`${CAL}${encodeURIComponent(ev.id)}?sendUpdates=none`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ description: desc ? desc + gap + line : line }),
      });
      if (res.ok) {
        linked = true;
        await env.DB.prepare('UPDATE hub_meetings SET calendar_event_id = ? WHERE id = ?').bind(ev.id, id).run();
      } else {
        linkError = res.status === 403 ? 'Google lets only the organizer change this event. The FavorOS meeting is made; the calendar event is untouched.' : 'Google Calendar did not accept the change. The FavorOS meeting is made; the calendar event is untouched.';
      }
    }
    return json({ ok: true, id, room: `/meet/room/?m=${id}`, linked, linkError });
  } catch (err) {
    return handleError(err);
  }
};
