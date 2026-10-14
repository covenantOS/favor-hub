// Move to FavorOS for a whole repeating series (day-move.ts with series: true).
// Organizer: the one Google series event gets the FavorOS series link in place of the Zoom, Meet or Teams link (one PATCH on the
// series, so every occurrence changes and no second event is made). FavorOS keeps the same rule, skipped dates and moved ones.
// Not the organizer: a new repeating event on the mover's own calendar from this occurrence on, with the same people and the
// organizer invited, and the mover can email the organizer to delete the old series.
import { HttpError, nowIso } from './http';
import { getMeeting, guestsOn, hex, type MeetEnv } from './meet';
import { calFetch } from './meetcal';
import { fromRRule, restAfter } from './meetrecur';
import { createSeries, loadSeries, seriesUrl } from './meetseries';
import { providerOf } from './meetprovider';

const clean = (v: unknown, n: number) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);

interface GEvent {
  id: string; status?: string; summary?: string; description?: string; recurringEventId?: string; recurrence?: string[];
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string }; originalStartTime?: { dateTime?: string };
  organizer?: { email?: string; self?: boolean; displayName?: string }; attendees?: Array<{ email?: string; self?: boolean; resource?: boolean; displayName?: string }>; conferenceData?: unknown;
}

export async function moveSeries(env: MeetEnv, user: { email: string; name: string }, inst: GEvent, o: { emailInvitees: boolean; origin: string }) {
  const me = user.email.toLowerCase();
  if (!inst.recurringEventId) throw new HttpError(400, 'not_series', 'This meeting does not repeat.');
  const mr = await calFetch(env, me, `/events/${encodeURIComponent(inst.recurringEventId)}`);
  if (!mr.ok) throw new HttpError(502, 'calendar', 'Google Calendar did not give the series.');
  const master = (await mr.json()) as GEvent;
  if (!master.start?.dateTime || !master.end?.dateTime) throw new HttpError(400, 'all_day', 'An all-day series has no time to move.');
  const tz = master.start.timeZone || 'America/New_York';
  const parsed = fromRRule(master.recurrence, master.start.dateTime, tz);
  if (!parsed) throw new HttpError(400, 'rule', 'FavorOS cannot repeat this series the same way. Move this one meeting instead.');
  const have = await env.DB.prepare(`SELECT id FROM hub_meeting_series WHERE status = 'active' AND calendar_event_id IN (?1, ?2) LIMIT 1`).bind(master.id, 'ext:' + master.id).first<{ id: string }>();
  if (have || providerOf(master as never).provider === 'favor') throw new HttpError(409, 'already', 'This series is already in FavorOS.');
  const durationMin = Math.max(10, Math.round((Date.parse(master.end.dateTime) - Date.parse(master.start.dateTime)) / 60000));
  const organizer = !!master.organizer?.self || String(master.organizer?.email || '').toLowerCase() === me;
  const invitees = (master.attendees || []).filter((a) => !a.self && !a.resource && a.email && String(a.email).toLowerCase() !== me).slice(0, 200)
    .map((a) => ({ email: String(a.email).toLowerCase(), name: clean(a.displayName, 120), team: '', guest: false }));
  const sid = hex(12);
  const gkey = guestsOn(env) ? hex(16) : '';
  const title = clean(master.summary, 140) || 'Meeting';
  const room = seriesUrl(o.origin, sid);

  if (organizer) {
    await createSeries(env, user, {
      title, agenda: '', durationMin, rec: 'video', access: gkey ? 'guests' : 'invited', invitees, remind: 0, rule: parsed.rule, startsAt: new Date(master.start.dateTime).toISOString(), tz,
      calendar: false, calendarEventId: master.id, exdates: parsed.exdates, gkey: gkey || undefined, roomUrl: room,
    }, sid);
    const desc = String(master.description || '');
    const gap = /<[a-z][^>]*>/i.test(desc) ? '<br><br>' : '\n\n';
    const stripped = providerOf({ description: desc }).urls.reduce((a, u) => a.split(u).join(room), desc);
    const patch: Record<string, unknown> = { location: room, description: stripped.includes(room) ? stripped : `Join in FavorOS: ${room}${desc ? gap + desc : ''}` };
    if (master.conferenceData) patch.conferenceData = null;
    const pr = await calFetch(env, me, `/events/${encodeURIComponent(master.id)}?conferenceDataVersion=1&sendUpdates=${o.emailInvitees ? 'all' : 'none'}`, { method: 'PATCH', body: patch });
    if (!pr.ok) {
      await env.DB.batch([env.DB.prepare('DELETE FROM hub_meetings WHERE series_id = ?').bind(sid), env.DB.prepare('DELETE FROM hub_meeting_series WHERE id = ?').bind(sid)]);
      throw new HttpError(502, 'calendar', 'Google Calendar did not accept the change. Nothing moved.');
    }
    await syncExceptions(env, me, master.id, sid);
    return { ok: true, series: true, seriesId: sid, id: sid, room: `/meet/s/?id=${sid}`, linked: true, created: false, invited: 0, organizer: null };
  }

  // Not the organizer: a new series from this occurrence on, on the mover's calendar. Google invites the people and the organizer.
  const from = new Date(inst.originalStartTime?.dateTime || inst.start?.dateTime || master.start.dateTime).toISOString();
  const org = String(master.organizer?.email || '').toLowerCase();
  const people = [...invitees];
  if (org && org !== me && !org.endsWith('calendar.google.com') && !people.some((p) => p.email === org)) people.push({ email: org, name: clean(master.organizer?.displayName, 120), team: '', guest: false });
  await createSeries(env, user, {
    title, agenda: '', durationMin, rec: 'video', access: gkey ? 'guests' : 'invited', invitees: people, remind: 0, rule: restAfter(parsed.rule, master.start.dateTime, from, tz), startsAt: from, tz,
    calendar: true, exdates: parsed.exdates.filter((x) => x > from), gkey: gkey || undefined, roomUrl: room,
  }, sid);
  if (org && org !== me) await env.DB.prepare('INSERT INTO hub_meeting_events (meeting_id, kind, from_pid, to_pid, body, ts) VALUES (?, ?, ?, ?, ?, ?)').bind(sid, 'moved_from', '', '', JSON.stringify({ org, ext: master.id, series: true }), Date.now()).run().catch(() => undefined);
  await getMeeting(env, sid);
  return {
    ok: true, series: true, seriesId: sid, id: sid, room: `/meet/s/?id=${sid}`, linked: false, created: true, invited: people.length,
    organizer: org && org !== me ? { email: org, name: clean(master.organizer?.displayName, 120) } : null,
  };
}

/** Occurrences Google has moved or cancelled one at a time: the FavorOS rows take the same times, or are cancelled. */
async function syncExceptions(env: MeetEnv, owner: string, masterId: string, sid: string) {
  const q = new URLSearchParams({ timeMin: new Date(Date.now() - 86400_000).toISOString(), timeMax: new Date(Date.now() + 62 * 86400_000).toISOString(), showDeleted: 'true', maxResults: '100' });
  const r = await calFetch(env, owner, `/events/${encodeURIComponent(masterId)}/instances?${q}`).catch(() => null);
  if (!r?.ok) return;
  const items = (((await r.json()) as { items?: GEvent[] }).items || []);
  const s = await loadSeries(env, sid);
  const ex = new Set<string>(JSON.parse(s.exdates || '[]'));
  for (const it of items) {
    const orig = it.originalStartTime?.dateTime ? new Date(it.originalStartTime.dateTime).toISOString() : '';
    if (!orig) continue;
    if (it.status === 'cancelled') {
      ex.add(orig);
      await env.DB.prepare(`UPDATE hub_meetings SET status = 'cancelled' WHERE series_id = ? AND orig_start = ? AND status = 'scheduled'`).bind(sid, orig).run();
    } else if (it.start?.dateTime && new Date(it.start.dateTime).toISOString() !== orig) {
      const st = new Date(it.start.dateTime).toISOString(), en = new Date(it.end?.dateTime || it.start.dateTime).toISOString();
      await env.DB.prepare(`UPDATE hub_meetings SET starts_at = ?, ends_at = ?, detached = 1 WHERE series_id = ? AND orig_start = ? AND status = 'scheduled'`).bind(st, en, sid, orig).run();
    }
  }
  await env.DB.prepare('UPDATE hub_meeting_series SET exdates = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify([...ex].sort()), nowIso(), sid).run();
}
