import { errorJson, handleError, type Env } from '../../_lib/http';
import { agentKeyOk } from '../../_lib/testuser';
import { accessToken } from '../../_lib/hub/google';

// One-time cleanup (2026-10-13): take the Google Meet link off upcoming calendar events FavorOS made. Agent key only. ?apply=1 writes; otherwise a dry run.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!agentKeyOk(env, request)) return errorJson('forbidden', 'Needs the agent key.', 403);
    const apply = new URL(request.url).searchParams.get('apply') === '1';
    const rows = (await env.DB.prepare(
      `SELECT id, title, starts_at, host_email, calendar_event_id, series_id FROM hub_meetings
       WHERE calendar_event_id != '' AND calendar_event_id NOT LIKE 'ext:%' AND starts_at > ? AND status != 'cancelled' ORDER BY starts_at`
    ).bind(new Date().toISOString()).all<{ id: string; title: string; starts_at: string; host_email: string; calendar_event_id: string; series_id: string }>()).results || [];
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const m of rows) {
      const key = m.host_email + '|' + m.calendar_event_id;
      const line: Record<string, unknown> = { title: m.title, start: m.starts_at, host: m.host_email };
      if (seen.has(key)) { line.result = 'same event as a row above'; out.push(line); continue; }
      seen.add(key);
      const t = await accessToken(env, m.host_email).catch(() => null);
      if (!t || !/auth\/calendar(\.events)?(\s|$)|auth\/calendar$/.test(t.scopes + ' ')) { line.result = 'skipped: no calendar write scope'; out.push(line); continue; }
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(m.calendar_event_id)}`;
      const H = { Authorization: `Bearer ${t.token}`, 'content-type': 'application/json' };
      const g = await fetch(url, { headers: H });
      if (!g.ok) { line.result = 'skipped: event read ' + g.status; out.push(line); continue; }
      const ev = (await g.json()) as { organizer?: { email?: string }; hangoutLink?: string; conferenceData?: unknown; location?: string; description?: string; status?: string };
      if (ev.status === 'cancelled') { line.result = 'skipped: cancelled'; out.push(line); continue; }
      if ((ev.organizer?.email || '').toLowerCase() !== m.host_email.toLowerCase()) { line.result = 'skipped: host is not the organizer'; out.push(line); continue; }
      const room = `https://dash.favorintl.org/meet/room/?m=${m.id}`;
      const hasMeet = !!(ev.hangoutLink || ev.conferenceData);
      line.hadMeet = hasMeet;
      if (!apply) { line.result = hasMeet ? 'would remove Meet' : 'no Meet link already'; out.push(line); continue; }
      if (hasMeet || !(ev.location || '').includes('/meet/room/')) {
        const body: Record<string, unknown> = {};
        if (hasMeet) body.conferenceData = null;
        if (!(ev.location || '').includes('/meet/room/')) body.location = room;
        if (!(ev.description || '').includes('/meet/room/')) body.description = `Join in FavorOS: ${room}${ev.description ? '\n\n' + ev.description : ''}`;
        const p = await fetch(url + '?conferenceDataVersion=1&sendUpdates=none', { method: 'PATCH', headers: H, body: JSON.stringify(body) });
        if (!p.ok) { line.result = 'failed: patch ' + p.status; out.push(line); continue; }
      }
      const back = (await (await fetch(url, { headers: H })).json()) as { hangoutLink?: string; conferenceData?: unknown };
      line.result = back.hangoutLink || back.conferenceData ? 'STILL HAS MEET' : 'cleaned, read back clean';
      if (!back.hangoutLink && !back.conferenceData) await env.DB.prepare(`UPDATE hub_meetings SET backup_link = '' WHERE calendar_event_id = ? AND host_email = ?`).bind(m.calendar_event_id, m.host_email).run();
      out.push(line);
    }
    return new Response(JSON.stringify({ apply, count: out.length, out }, null, 1), { headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleError(err);
  }
};
