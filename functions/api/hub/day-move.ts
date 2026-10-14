import { accessToken, CAL_EVENTS, hasScopes } from '../../_lib/hub/google';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { providerOf, PROVIDER_LABEL } from '../../_lib/meetprovider';
import { sendMoveInvites, sourceLabel } from '../../_lib/moveinvite';
import { ensureGuestUrl } from '../../_lib/meetroute';
import { getMeeting, guestsOn } from '../../_lib/meet';
import { withMeetSettings } from '../../_lib/admin/settings';
import { sendReminder } from '../../_lib/meetcal';
import { isTester } from '../../_lib/testuser';

// Move to FavorOS, from Today. An outside meeting on the person's calendar (Zoom, Google Meet, Teams, a phone call or no link at all)
// becomes a FavorOS meeting at the same time with the same people. The calendar event is left as it is, except when the person
// confirmed the sheet that says so: then one line with the FavorOS link is added to the event's notes, with no email to anyone
// (sendUpdates=none). The meeting is made without recording and without reminders. With emailInvitees the sheet's box was checked:
// each invitee except the mover gets one FavorOS email with the join link and a calendar file (see moveinvite.ts).
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events/';
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const clean = (v: unknown, n: number) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via !== 'google') return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const me = user.email.toLowerCase();
    const b = (await request.json().catch(() => ({}))) as { eventId?: string; writeLink?: boolean; emailInvitees?: boolean; tellOrganizer?: string };
    if (b.tellOrganizer) return json(await tellOrganizer(env, user, clean(b.tellOrganizer, 30), new URL(request.url).origin));
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

    // The organizer's calendar event always gets the FavorOS link and loses the old video link. Someone else's event cannot be edited.
    const organizer = !!ev.organizer?.self || String(ev.organizer?.email || '').toLowerCase() === me;
    const writeLink = organizer;
    // Organizer or not, the FavorOS meeting goes on a calendar: the organizer's event is changed, anyone else gets a new event of
    // their own with the same people. Both need the calendar events permission.
    if (!hasScopes(t.scopes, [CAL_EVENTS])) return errorJson('consent', 'Allow FavorOS to add to your calendar events. Google asks once.', 409);

    const id = hex(12);
    const dur = Math.max(10, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000));
    const invitees = ((ev.attendees || []) as any[])
      .filter((a) => !a.self && !a.resource && a.email && String(a.email).toLowerCase() !== me)
      .slice(0, 200)
      .map((a) => ({ email: String(a.email).toLowerCase(), name: clean(a.displayName, 120), team: '', guest: false }));
    const stamp = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, repeat, series_id, calendar_event_id, backup_link, remind)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, 'video', 'guests', ?, 'scheduled', ?, 'none', '', ?, '', 0)`
    ).bind(id, clean(ev.summary, 140) || 'Meeting', me, user.name, startsAt, endsAt, dur, JSON.stringify(invitees), stamp, 'ext:' + ev.id).run();

    // Every signed-in staff member with the link may join, and the guest link works from the first minute.
    if (guestsOn(env as any)) await ensureGuestUrl(env as any, await getMeeting(env as any, id), new URL(request.url).origin);
    const room = `${new URL(request.url).origin}/meet/room/?m=${id}`;
    let linked = false;
    let linkError = '';
    if (writeLink) {
      const desc = String(ev.description || '');
      const gap = /<[a-z][^>]*>/i.test(desc) ? '<br><br>' : '\n\n';
      const line = `Join in FavorOS: ${room}`;
      // Link at the top of the notes and in the location; the old video link is removed. Time and guests stay.
      const patch: Record<string, unknown> = { location: room, description: desc ? line + gap + desc : line };
      if (ev.conferenceData) patch.conferenceData = null;
      const res = await fetch(`${CAL}${encodeURIComponent(ev.id)}?conferenceDataVersion=1&sendUpdates=${b.emailInvitees === true ? 'all' : 'none'}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        linked = true;
        await env.DB.prepare('UPDATE hub_meetings SET calendar_event_id = ? WHERE id = ?').bind(ev.id, id).run();
      } else {
        linkError = res.status === 403 ? 'Google lets only the organizer change this event. The FavorOS meeting is made; the calendar event is untouched.' : 'Google Calendar did not accept the change. The FavorOS meeting is made; the calendar event is untouched.';
      }
    }
    let emailed = 0;
    let emailFailed = 0;
    // Until Meetings is released to staff, only admins can open a room. Say so instead of emailing a link that answers not found.
    const released = String((await withMeetSettings(env as any)).MEET_RELEASE || 'admin').toLowerCase() === 'staff';
    // Not the organizer, or Google refused the change: a new event on the mover's calendar, same time, same people (a group address
    // stays a group address; Google sends it to the members). Google invites them, so FavorOS sends no second email.
    let created = false;
    if (!linked) {
      const people = ((ev.attendees || []) as any[]).filter((a) => !a.self && !a.resource && a.email && String(a.email).toLowerCase() !== me).map((a) => ({ email: String(a.email) }));
      const org = String(ev.organizer?.email || '').toLowerCase();
      if (org && org !== me && !org.endsWith('calendar.google.com') && !people.some((p) => p.email.toLowerCase() === org)) people.push({ email: org });
      const body = {
        summary: clean(ev.summary, 140) || 'Meeting',
        description: `Join in FavorOS: ${room}${ev.description ? '\n\n' + String(ev.description).slice(0, 3000) : ''}`,
        location: room,
        start: { dateTime: startsAt, timeZone: ev.start.timeZone || 'America/New_York' },
        end: { dateTime: endsAt, timeZone: ev.end.timeZone || 'America/New_York' },
        attendees: people.slice(0, 200),
        guestsCanModify: false,
        reminders: { useDefault: true },
      };
      const cr = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${b.emailInvitees === false ? 'none' : 'all'}`, {
        method: 'POST', headers: { Authorization: `Bearer ${t.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const cj = (await cr.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (cr.ok && cj.id) {
        created = true;
        linkError = '';
        if (org && org !== me) await env.DB.prepare('INSERT INTO hub_meeting_events (meeting_id, kind, from_pid, to_pid, body, ts) VALUES (?, ?, ?, ?, ?, ?)').bind(id, 'moved_from', '', '', JSON.stringify({ org, ext: ev.id }), Date.now()).run().catch(() => undefined);
        await env.DB.prepare('UPDATE hub_meetings SET calendar_event_id = ? WHERE id = ?').bind(cj.id, id).run();
      } else {
        linkError = `Google Calendar did not take the new event${cj.error?.message ? ` (${clean(cj.error.message, 120)})` : ''}. The FavorOS meeting is made, but it is on no calendar. Copy the link and send it.`;
      }
    }
    if (b.emailInvitees === true && invitees.length && released && !created) {
      const origin = new URL(request.url).origin;
      const nice = (i: { email: string; name: string }) => i.name || i.email.split('@')[0].replace(/[._]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const r = await sendMoveInvites(env, {
        mover: { name: user.name || me, email: me },
        title: clean(ev.summary, 140) || 'Meeting',
        startsAt,
        endsAt,
        people: [user.name || me, ...invitees.map(nice)],
        source: sourceLabel(ev, providerOf(ev).provider, (p) => PROVIDER_LABEL[p as keyof typeof PROVIDER_LABEL] || p),
        meetingId: id,
        origin,
        invitees,
        guestUrl: async () => (guestsOn(env as any) ? ensureGuestUrl(env as any, await getMeeting(env as any, id), origin) : null),
      });
      emailed = r.sent.length;
      emailFailed = r.failed.length + r.skipped.length;
    }
    return json({
      ok: true, released, id, room: `/meet/room/?m=${id}`, linked, created, linkError, emailed, emailFailed,
      invited: created ? invitees.length : 0, series: !!ev.recurringEventId,
      organizer: organizer ? null : { email: String(ev.organizer?.email || '').toLowerCase(), name: clean(ev.organizer?.displayName, 120) },
    });
  } catch (err) {
    return handleError(err);
  }
};

/** The mover asks FavorOS to tell the organizer of the original event that the meeting moved, so they can delete their event. */
async function tellOrganizer(env: Env, user: { email: string; name: string }, id: string, origin: string) {
  if (!/^[0-9a-f]{24}$/.test(id)) return { ok: false, message: 'That meeting does not exist.' };
  const m = await getMeeting(env as any, id);
  if (m.host_email.toLowerCase() !== user.email.toLowerCase()) return { ok: false, message: 'Only the person who moved it can send this.' };
  // The organizer of the original event, recorded when the meeting was moved.
  const row = await env.DB.prepare(`SELECT body FROM hub_meeting_events WHERE meeting_id = ? AND kind = 'moved_from' ORDER BY seq DESC LIMIT 1`).bind(id).first<{ body: string }>().catch(() => null);
  let to = '';
  try { to = String(JSON.parse(row?.body || '{}').org || '').toLowerCase(); } catch { to = ''; }
  if (!to) return { ok: false, message: 'FavorOS does not know who organizes the original event.' };
  if (isTester(user.email) && !(isTester(to) || to === 'will@favorintl.org')) return { ok: false, message: 'The test user sends only to test accounts.' };
  const ok = await sendReminder(env as any, [to], {
    title: m.title, startsAt: m.starts_at as string, endsAt: m.ends_at, durationMin: m.duration_min, roomUrl: `${origin}/meet/room/?m=${id}`, backup: '', rec: m.rec_mode,
    kind: 'link', host: m.host_name || m.host_email, sender: user.name || user.email,
    note: 'I moved this meeting to FavorOS and put it on our calendars with this link. Your original calendar event still exists, so you can delete it.',
  });
  return { ok, message: ok ? 'Email sent.' : 'The email did not go.' };
}
