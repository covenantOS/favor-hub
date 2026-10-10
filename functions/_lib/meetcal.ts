// Meetings: booking against Google Calendar, with the booker's own Google connection (Connect my Google, the meetings step).
// Free and busy: the booker's token reads everyone's busy times in the Workspace. Nothing about what a meeting is ever comes back.
// The meeting itself is created on the booker's calendar with the guests invited, so Google sends the invitations.
import { accessToken, CAL_EVENTS, CAL_FREEBUSY, hasScopes } from './hub/google';
import { HttpError } from './http';
import type { MeetEnv } from './meet';

const CAL_DEFAULT = 'https://www.googleapis.com/calendar/v3';
const cal = (env: MeetEnv) => env.MEET_CAL_URL || CAL_DEFAULT;
export const TZ = 'America/New_York';

export interface Busy { start: string; end: string }

async function token(env: MeetEnv, email: string, want: string[]): Promise<string> {
  const t = await accessToken(env, email).catch(() => null);
  if (!t) throw new HttpError(409, 'consent', 'Connect your Google Calendar to book meetings.');
  if (!hasScopes(t.scopes, want) && !hasScopes(t.scopes, ['https://www.googleapis.com/auth/calendar.readonly'])) {
    throw new HttpError(409, 'consent', 'Allow Favor to read free and busy times and to add meetings to your calendar. Google asks once.');
  }
  return t.token;
}

/** Whether this person has already allowed what booking needs. */
export async function mayBook(env: MeetEnv, email: string): Promise<{ ok: boolean; connected: boolean }> {
  const t = await accessToken(env, email).catch(() => null);
  if (!t) return { ok: false, connected: false };
  return { ok: hasScopes(t.scopes, [CAL_FREEBUSY, CAL_EVENTS]), connected: true };
}

export async function freeBusy(env: MeetEnv, booker: string, emails: string[], from: string, to: string): Promise<Record<string, { busy: Busy[]; error?: string }>> {
  const tok = await token(env, booker, [CAL_FREEBUSY]);
  const out: Record<string, { busy: Busy[]; error?: string }> = {};
  const list = [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 100);
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const r = await fetch(`${cal(env)}/freeBusy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: from, timeMax: to, timeZone: TZ, items: chunk.map((id) => ({ id })) }),
    });
    const j = (await r.json().catch(() => ({}))) as { calendars?: Record<string, { busy?: Busy[]; errors?: Array<{ reason?: string }> }>; error?: { message?: string } };
    if (!r.ok) throw new HttpError(502, 'calendar', j.error?.message ? 'Google Calendar said: ' + j.error.message : 'Google Calendar did not answer.');
    for (const id of chunk) {
      const c = j.calendars?.[id];
      out[id] = { busy: c?.busy || [], ...(c?.errors?.length ? { error: c.errors[0].reason || 'unavailable' } : {}) };
    }
  }
  return out;
}

export interface EventInput {
  title: string;
  agenda: string;
  roomUrl: string;
  startsAt: string;
  endsAt: string;
  attendees: string[];
  recording: string;
  backupMeet: boolean;
  repeat: string;
}

const RRULE: Record<string, string> = { weekly: 'RRULE:FREQ=WEEKLY', biweekly: 'RRULE:FREQ=WEEKLY;INTERVAL=2', monthly: 'RRULE:FREQ=MONTHLY' };

export async function createEvent(env: MeetEnv, booker: string, ev: EventInput): Promise<{ id: string; meetLink: string }> {
  const tok = await token(env, booker, [CAL_EVENTS]);
  const recLine = ev.recording === 'video' ? 'This meeting is recorded on video and written up in the hub.' : ev.recording === 'notes' ? 'The sound of this meeting is recorded to make notes.' : 'This meeting is not recorded.';
  const body: Record<string, unknown> = {
    summary: ev.title,
    description: `Join in the Favor hub: ${ev.roomUrl}\n\n${ev.agenda ? ev.agenda + '\n\n' : ''}${recLine}`,
    start: { dateTime: ev.startsAt, timeZone: TZ },
    end: { dateTime: ev.endsAt, timeZone: TZ },
    attendees: ev.attendees.map((email) => ({ email })),
    reminders: { useDefault: true },
    location: ev.roomUrl,
    guestsCanModify: false,
    ...(RRULE[ev.repeat] ? { recurrence: [RRULE[ev.repeat]] } : {}),
    ...(ev.backupMeet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  };
  const r = await fetch(`${cal(env)}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; hangoutLink?: string; error?: { message?: string } };
  if (!r.ok || !j.id) throw new HttpError(502, 'calendar', 'Google Calendar did not accept the meeting' + (j.error?.message ? ': ' + j.error.message : '.'));
  return { id: j.id, meetLink: j.hangoutLink || '' };
}

export async function patchEvent(env: MeetEnv, booker: string, eventId: string, patch: { startsAt?: string; endsAt?: string; title?: string }): Promise<void> {
  const tok = await token(env, booker, [CAL_EVENTS]);
  const body: Record<string, unknown> = {};
  if (patch.title) body.summary = patch.title;
  if (patch.startsAt && patch.endsAt) { body.start = { dateTime: patch.startsAt, timeZone: TZ }; body.end = { dateTime: patch.endsAt, timeZone: TZ }; }
  const r = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new HttpError(502, 'calendar', 'Google Calendar did not accept the change.');
}

export async function deleteEvent(env: MeetEnv, booker: string, eventId: string): Promise<void> {
  const tok = await token(env, booker, [CAL_EVENTS]);
  const r = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new HttpError(502, 'calendar', 'Google Calendar did not cancel the meeting.');
}

// ---------------------------------------------------------------- reminder emails

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

export function whenLine(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Eastern';
}

export async function sendReminder(env: MeetEnv, to: string[], m: { title: string; startsAt: string; roomUrl: string; backup: string; rec: string; kind: 'day' | 'soon'; host: string }): Promise<void> {
  const key = env.RESEND_API_KEY;
  if (!key || !to.length) return;
  const from = env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>';
  const lead = m.kind === 'day' ? 'Tomorrow' : 'Starting in 15 minutes';
  const rec = m.rec === 'video' ? 'This meeting is recorded on video and written up in the hub.' : m.rec === 'notes' ? 'The sound is recorded to make notes.' : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#2a2722;line-height:1.5"><p>${lead}: <b>${esc(m.title)}</b></p><p>${esc(whenLine(m.startsAt))}<br/>Host: ${esc(m.host)}</p><p><a href="${esc(m.roomUrl)}" style="background:#2b4d24;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Join the meeting</a></p>${rec ? `<p>${esc(rec)}</p>` : ''}${m.backup ? `<p>If the room does not load, use the backup: <a href="${esc(m.backup)}">${esc(m.backup)}</a></p>` : ''}</div>`;
  for (let i = 0; i < to.length; i += 40) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: to.slice(i, i + 40), subject: `${lead}: ${m.title}`, html }),
    });
    if (!r.ok) console.error('[meet] reminder failed', r.status, (await r.text()).slice(0, 200));
  }
}
