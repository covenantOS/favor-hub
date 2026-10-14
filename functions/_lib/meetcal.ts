// Meetings: booking against Google Calendar, with the booker's own Google connection (Connect my Google, the meetings step).
// Free and busy: the booker's token reads everyone's busy times in the Workspace. Nothing about what a meeting is ever comes back.
// The meeting itself is created on the booker's calendar with the guests invited, so Google sends the invitations.
import { accessToken, CAL_EVENTS, CAL_FREEBUSY, hasScopes } from './hub/google';
import { HttpError } from './http';
import { providerOf, summarize, type CalEvent, type CalMeeting } from './meetprovider';
import type { MeetEnv } from './meet';
import { icsBase64 } from './meetics';

const CAL_DEFAULT = 'https://www.googleapis.com/calendar/v3';
const cal = (env: MeetEnv) => env.MEET_CAL_URL || CAL_DEFAULT;
export const TZ = 'America/New_York';

export interface Busy { start: string; end: string }

export async function token(env: MeetEnv, email: string, want: string[]): Promise<string> {
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
  guestUrl?: string;
  startsAt: string;
  endsAt: string;
  attendees: string[];
  recording: string;
  repeat: string;
  /** RRULE and EXDATE lines for a series (meetseries.ts). Wins over repeat. */
  recurrence?: string[];
  /** The time zone the series repeats in; Google needs it on a repeating event. */
  tz?: string;
}

const RRULE: Record<string, string> = { weekly: 'RRULE:FREQ=WEEKLY', biweekly: 'RRULE:FREQ=WEEKLY;INTERVAL=2', monthly: 'RRULE:FREQ=MONTHLY' };

/** The insert body. It never carries conferenceData, so Google makes no Meet link. */
export function eventBody(ev: EventInput, requestTz = TZ): Record<string, unknown> {
  const recLine = ev.recording === 'video' ? 'This meeting is recorded on video and written up in FavorOS.' : ev.recording === 'notes' ? 'The sound of this meeting is recorded to make notes.' : 'This meeting is not recorded.';
  return {
    summary: ev.title,
    description: `Join in FavorOS: ${ev.roomUrl}\n${ev.guestUrl ? `Guests from outside Favor, join here: ${ev.guestUrl}\n` : ''}\n${ev.agenda ? ev.agenda + '\n\n' : ''}${recLine}`,
    start: { dateTime: ev.startsAt, timeZone: requestTz },
    end: { dateTime: ev.endsAt, timeZone: requestTz },
    attendees: ev.attendees.map((email) => ({ email })),
    reminders: { useDefault: true },
    location: ev.roomUrl,
    guestsCanModify: false,
    ...(ev.recurrence?.length ? { recurrence: ev.recurrence } : RRULE[ev.repeat] ? { recurrence: [RRULE[ev.repeat]] } : {}),
  };
}

/** A call to the Calendar API on this person's primary calendar. path starts after /calendars/primary (for example /events/abc). */
export async function calFetch(env: MeetEnv, owner: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const tok = await token(env, owner, [CAL_EVENTS]);
  return fetch(`${cal(env)}/calendars/primary${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function createEvent(env: MeetEnv, booker: string, ev: EventInput): Promise<{ id: string; meetLink: string }> {
  const tok = await token(env, booker, [CAL_EVENTS]);
  const body = eventBody(ev, ev.tz || TZ);
  const r = await fetch(`${cal(env)}/calendars/primary/events?sendUpdates=all`, {
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
  if (!patch.title && !(patch.startsAt && patch.endsAt)) return;
  if (patch.startsAt && patch.endsAt) { body.start = { dateTime: patch.startsAt, timeZone: TZ }; body.end = { dateTime: patch.endsAt, timeZone: TZ }; }
  const r = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(eventId.replace(/^ext:/, ''))}?sendUpdates=all`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new HttpError(502, 'calendar', 'Google Calendar did not accept the change.');
}

/** Add people to the booker's event without a Google email (FavorOS sends its own). A failure is reported, never thrown. */
export async function addAttendees(env: MeetEnv, booker: string, eventId: string, emails: string[]): Promise<boolean> {
  if (!emails.length) return true;
  try {
    const tok = await token(env, booker, [CAL_EVENTS]);
    const url = `${cal(env)}/calendars/primary/events/${encodeURIComponent(eventId.replace(/^ext:/, ''))}`;
    const g = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    if (!g.ok) return false;
    const ev = (await g.json()) as { attendees?: Array<{ email?: string }> };
    const have = new Set((ev.attendees || []).map((a) => String(a.email || '').toLowerCase()));
    const add = emails.filter((e) => !have.has(e.toLowerCase()));
    if (!add.length) return true;
    const r = await fetch(`${url}?sendUpdates=none`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ attendees: [...(ev.attendees || []), ...add.map((email) => ({ email }))] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteEvent(env: MeetEnv, booker: string, eventId: string): Promise<void> {
  const tok = await token(env, booker, [CAL_EVENTS]);
  const r = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(eventId.replace(/^ext:/, ''))}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new HttpError(502, 'calendar', 'Google Calendar did not cancel the meeting.');
}

// ---------------------------------------------------------------- reminder emails

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

export function whenLine(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Eastern';
}

const LOGO = 'https://dash.favorintl.org/images/favor-icon.png';

export interface ReminderInput {
  title: string;
  startsAt: string;
  roomUrl: string;
  backup: string;
  rec: string;
  /** day and soon are the timed reminders, now an invitation to a meeting that is running, link the link sent again by hand,
   * moved and cancelled the notices for a meeting that has no Google Calendar event to carry them. */
  kind: 'day' | 'soon' | 'now' | 'link' | 'moved' | 'cancelled';
  host: string;
  /** Minutes ahead the soon reminder goes (Admin > Meetings). 15 when not given. */
  leadMin?: number;
  /** A short line from the person who sent the link, shown above the Join button. */
  note?: string;
  /** Who sent the link again, when that is not the host. */
  sender?: string;
  hostEmail?: string;
  endsAt?: string | null;
  durationMin?: number;
  agenda?: string;
  people?: string[];
  /** A calendar file to attach (meetics.ts), for people without a Google invite. */
  ics?: string;
  /** Times shown in this zone first (the partner's own), before the team zones. */
  tz?: string;
}

const ZONES: Array<[string, string]> = [['Eastern', TZ], ['Kampala', 'Africa/Kampala'], ['Juba', 'Africa/Juba']];
const C = { bg: '#f4efe0', card: '#fffdf8', ink: '#1d211b', ink2: '#57534a', ink3: '#8a8578', line: '#e7e0cf', green: '#2b4d24', leaf: '#e6efdc', sun: '#fbe9c6', red: '#b3412b' };

const fmt = (iso: string, zone: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { timeZone: zone, ...o });
const timeOf = (iso: string, zone = TZ) => fmt(iso, zone, { hour: 'numeric', minute: '2-digit' });
const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const gcalDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** The reminder: a date tile, the time where each team works, who is coming, one Join button, calendar links and a way to say no. */
export function buildReminder(m: ReminderInput): { subject: string; html: string; text: string } {
  const endIso = m.endsAt || new Date(Date.parse(m.startsAt) + (m.durationMin || 30) * 60_000).toISOString();
  const mins = Math.max(5, Math.round((Date.parse(endIso) - Date.parse(m.startsAt)) / 60_000));
  const day = fmt(m.startsAt, TZ, { weekday: 'short', month: 'short', day: 'numeric' });
  const lead = m.leadMin && m.leadMin > 0 ? m.leadMin : 15;
  const soonT = lead >= 60 && lead % 60 === 0 ? `${lead / 60} hour${lead === 60 ? '' : 's'}` : `${lead} minutes`;
  const subject =
    m.kind === 'day' ? `Tomorrow, ${day}: ${m.title}`
    : m.kind === 'now' ? `Join now: ${m.title}`
    : m.kind === 'link' ? `Meeting link: ${m.title}, ${day} at ${timeOf(m.startsAt)} Eastern`
    : m.kind === 'moved' ? `New time: ${m.title}, ${day} at ${timeOf(m.startsAt)} Eastern`
    : m.kind === 'cancelled' ? `Cancelled: ${m.title}, ${day}`
    : `Starting in ${soonT}: ${m.title}`;
  const pill =
    m.kind === 'day' ? { t: 'Tomorrow', bg: C.sun, fg: '#7a5410' }
    : m.kind === 'now' ? { t: 'Live now', bg: '#f7dcd5', fg: C.red }
    : m.kind === 'link' ? { t: 'Meeting link', bg: C.leaf, fg: C.green }
    : m.kind === 'moved' ? { t: 'New time', bg: C.sun, fg: '#7a5410' }
    : m.kind === 'cancelled' ? { t: 'Cancelled', bg: '#f7dcd5', fg: C.red }
    : { t: `In ${soonT}`, bg: C.leaf, fg: C.green };
  const off = m.kind === 'cancelled';
  const noteLine = (m.note || '').trim().slice(0, 300);
  const noteBy = m.sender || m.host;
  const rec = m.rec === 'video' ? 'Recorded on video, with notes written up in FavorOS.' : m.rec === 'notes' ? 'The sound is recorded to make notes.' : '';
  const when = `${fmt(m.startsAt, TZ, { weekday: 'long', month: 'long', day: 'numeric' })}, ${timeOf(m.startsAt)} to ${timeOf(endIso)} Eastern`;
  const zoneList: Array<[string, string]> = m.tz && !ZONES.some(([, z]) => z === m.tz) ? [['Your time', m.tz], ...ZONES] : ZONES;
  const zones = zoneList.map(([label, z]) => ({ label, t: `${fmt(m.startsAt, z, { weekday: 'short' })} ${timeOf(m.startsAt, z)}` }));
  const people = (m.people || []).filter(Boolean);
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(m.title)}&dates=${gcalDate(m.startsAt)}/${gcalDate(endIso)}&details=${encodeURIComponent(`Join: ${m.roomUrl}${m.agenda ? `\n\n${m.agenda}` : ''}`)}&location=${encodeURIComponent(m.roomUrl)}`;
  const outlook = `https://outlook.office.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(m.title)}&startdt=${encodeURIComponent(m.startsAt)}&enddt=${encodeURIComponent(endIso)}&body=${encodeURIComponent(`Join: ${m.roomUrl}`)}&location=${encodeURIComponent(m.roomUrl)}`;
  const decline = m.hostEmail
    ? `mailto:${m.hostEmail}?subject=${encodeURIComponent(`Can't make it: ${m.title}`)}&body=${encodeURIComponent(`I can't make ${m.title} on ${day} at ${timeOf(m.startsAt)} Eastern.`)}`
    : '';
  const join = m.kind === 'day' || m.kind === 'link' || m.kind === 'moved' ? 'Join the meeting' : 'Join now';

  const label = (t: string) => `<div style="font:700 11px/1 Arial,sans-serif;letter-spacing:1.4px;color:${C.ink3};text-transform:uppercase;padding-bottom:10px">${t}</div>`;
  const tile =
    `<td width="72" valign="top" style="padding:0 16px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" width="72" style="border-collapse:separate;background:${C.green};border-radius:16px">` +
    `<tr><td align="center" style="padding:10px 0 0;font:700 11px/1 Arial,sans-serif;letter-spacing:1.5px;color:#cfe3c4;text-transform:uppercase">${esc(fmt(m.startsAt, TZ, { month: 'short' }))}</td></tr>` +
    `<tr><td align="center" style="padding:5px 0 3px;font:400 32px/1 Georgia,'Times New Roman',serif;color:#ffffff">${esc(fmt(m.startsAt, TZ, { day: 'numeric' }))}</td></tr>` +
    `<tr><td align="center" style="padding:0 0 10px;font:700 11px/1 Arial,sans-serif;letter-spacing:1px;color:#cfe3c4;text-transform:uppercase">${esc(fmt(m.startsAt, TZ, { weekday: 'short' }))}</td></tr></table></td>`;
  const chip = (name: string, t: string, on: boolean) =>
    `<span style="display:inline-block;white-space:nowrap;margin:0 6px 6px 0;padding:7px 11px;border-radius:999px;background:${on ? C.leaf : C.bg};font:400 13px/1.2 Arial,sans-serif;color:${C.ink2}"><b style="color:${C.ink}">${esc(name)}</b>&nbsp; ${esc(t)}</span>`;
  const avatar = (n: string) =>
    `<td style="padding:0 6px 0 0"><span title="${esc(n)}" style="display:inline-block;width:32px;height:32px;border-radius:999px;background:${C.leaf};color:${C.green};font:700 12px/32px Arial,sans-serif;text-align:center">${esc(initialsOf(n))}</span></td>`;
  const shown = people.slice(0, 7);
  const who = people.length
    ? `<tr><td style="padding:20px 28px 0">${label('Who is coming')}<table role="presentation" cellpadding="0" cellspacing="0"><tr>${shown.map(avatar).join('')}${people.length > shown.length ? `<td style="font:400 13px Arial,sans-serif;color:${C.ink2}">+${people.length - shown.length}</td>` : ''}</tr></table>` +
      `<div style="padding-top:8px;font:400 13px/1.5 Arial,sans-serif;color:${C.ink2}">Hosted by <b style="color:${C.ink}">${esc(m.host)}</b>, with ${esc(people.slice(0, 3).join(', '))}${people.length > 3 ? ` and ${people.length - 3} more` : ''}</div></td></tr>`
    : `<tr><td style="padding:20px 28px 0;font:400 13px/1.5 Arial,sans-serif;color:${C.ink2}">Hosted by <b style="color:${C.ink}">${esc(m.host)}</b></td></tr>`;
  const agenda =
    m.agenda && m.agenda.trim()
      ? `<tr><td style="padding:18px 28px 0"><div style="background:${C.bg};border-radius:14px;padding:14px 16px">${label('Agenda')}<div style="font:400 14px/1.55 Arial,sans-serif;color:${C.ink};white-space:pre-line">${esc(m.agenda.trim().slice(0, 1200))}</div></div></td></tr>`
      : '';
  const smallBtn = (href: string, text: string) =>
    `<a href="${esc(href)}" style="display:inline-block;white-space:nowrap;margin:0 8px 8px 0;padding:10px 14px;border:1px solid ${C.line};border-radius:12px;background:#ffffff;font:600 13px/1 Arial,sans-serif;color:${C.ink};text-decoration:none">${esc(text)}</a>`;

  const html =
    `<!doctype html><html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:${C.bg}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:24px;border-collapse:separate">` +
    `<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:600 13px/1 Arial,sans-serif;color:${C.ink3}"><img src="${LOGO}" alt="" width="28" height="24" style="vertical-align:middle;border:0" />&nbsp; Favor Meetings</td>` +
    `<td align="right"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${pill.bg};color:${pill.fg};font:700 12px/1 Arial,sans-serif">${m.kind === 'now' ? '&#9679;&nbsp;' : ''}${pill.t}</span></td></tr></table></td></tr>` +
    `<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tile}<td valign="middle"><div style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${esc(m.title)}</div>` +
    `<div style="padding-top:6px;font:400 14px/1.45 Arial,sans-serif;color:${C.ink2}">${esc(when)} &middot; ${mins} min</div></td></tr></table></td></tr>` +
    `<tr><td style="padding:16px 28px 0;font-size:0">${zones.map((z, i) => chip(z.label, z.t, i === 0)).join('')}</td></tr>` +
    (noteLine ? `<tr><td style="padding:16px 28px 0"><div style="border-left:3px solid ${C.green};padding:4px 0 4px 12px;font:400 15px/1.5 Arial,sans-serif;color:${C.ink}"><b>${esc(noteBy)}:</b> ${esc(noteLine)}</div></td></tr>` : '') +
    (off
      ? `<tr><td style="padding:16px 28px 0;font:400 14px/1.5 Arial,sans-serif;color:${C.ink2}">${esc(m.host)} cancelled this meeting. Nothing to join.</td></tr>`
      : `<tr><td style="padding:16px 28px 0"><a href="${esc(m.roomUrl)}" style="display:block;text-align:center;padding:16px 20px;border-radius:16px;background:${C.green};color:#ffffff;font:700 16px/1 Arial,sans-serif;text-decoration:none">${join} &rarr;</a></td></tr>` +
        `<tr><td style="padding:12px 28px 0;font-size:0">${smallBtn(gcal, 'Google Calendar')}${smallBtn(outlook, 'Outlook')}${decline ? smallBtn(decline, "Can't make it") : ''}</td></tr>`) +
    who +
    agenda +
    `<tr><td style="padding:20px 28px 24px"><div style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">${rec ? `${esc(rec)}<br/>` : ''}` +
    `${m.backup && !off ? `Room not loading? Use the backup: <a href="${esc(m.backup)}" style="color:${C.green}">${esc(m.backup.replace(/^https?:\/\//, ''))}</a>` : ''}</div></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const text = [
    `${pill.t}: ${m.title}`,
    ...(noteLine ? [`${noteBy}: ${noteLine}`] : []),
    when,
    zones.map((z) => `${z.label} ${z.t}`).join(' · '),
    `Host: ${m.host}`,
    ...(people.length ? [`Who is coming: ${people.join(', ')}`] : []),
    '',
    ...(off ? [`${m.host} cancelled this meeting.`] : [`${join}: ${m.roomUrl}`, `Add to Google Calendar: ${gcal}`]),
    ...(m.agenda ? ['', 'Agenda', m.agenda.trim()] : []),
    ...(rec ? ['', rec] : []),
    ...(m.backup && !off ? ['', `Backup: ${m.backup}`] : []),
  ].join('\n');
  return { subject, html, text };
}

export async function sendReminder(env: MeetEnv, to: string[], m: ReminderInput): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  if (!key || !to.length) return false;
  let all = true;
  const from = env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>';
  const { subject, html, text } = buildReminder(m);
  for (let i = 0; i < to.length; i += 40) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: to.slice(i, i + 40), subject, html, text, ...(m.ics ? { attachments: [{ filename: 'invite.ics', content: icsBase64(m.ics), content_type: 'text/calendar' }] } : {}) }),
    });
    if (!r.ok) {
      all = false;
      console.error('[meet] reminder failed', r.status, (await r.text()).slice(0, 200));
    }
  }
  return all;
}

// ---------------------------------------------------------------- the person's own calendar, every provider

const READ_SCOPES = ['https://www.googleapis.com/auth/calendar.events.readonly', CAL_EVENTS, 'https://www.googleapis.com/auth/calendar.readonly'];
const canRead = (granted: string) => READ_SCOPES.some((s) => hasScopes(granted, [s]));

/** Meetings with a video link on this person's calendar for the next two weeks, from every provider. Meetings already made in Favor Meetings are left out; they show from the hub's own list. */
export async function calendarMeetings(env: MeetEnv, email: string, ours: (ids: string[]) => Promise<Set<string>>, win?: { from: number; to: number }): Promise<{ connected: boolean; canWrite: boolean; meetings: CalMeeting[]; error?: string; from: number; to: number }> {
  const from = win ? win.from : Date.now();
  const to = win ? win.to : Date.now() + 14 * 86400_000;
  const t = await accessToken(env, email).catch(() => null);
  if (!t || !canRead(t.scopes)) return { connected: false, canWrite: false, meetings: [], from, to };
  const canWrite = hasScopes(t.scopes, [CAL_EVENTS]);
  // A wide window can hold more than one page of events. Page until Google has no more (six pages at most), so later events are never cut off.
  const raw: CalEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < (win ? 6 : 1); page++) {
    const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: win ? '250' : '100', timeZone: TZ });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await fetch(`${cal(env)}/calendars/primary/events?${q}`, { headers: { Authorization: `Bearer ${t.token}` } });
    if (!r.ok) return { connected: true, canWrite, meetings: [], error: 'Google Calendar did not answer.', from, to };
    const j = (await r.json().catch(() => ({}))) as { items?: CalEvent[]; nextPageToken?: string };
    raw.push(...(j.items || []));
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  const j = { items: raw };
  const items = (j.items || []).filter((e) => e.status !== 'cancelled');
  const mine = await ours([...new Set(items.flatMap((e) => [e.id, e.recurringEventId || e.id]))]);
  const out: CalMeeting[] = [];
  for (const e of items) {
    const m = summarize(e, email, canWrite);
    if (!m || m.provider === 'favor' || (mine.has(e.id) || mine.has(e.recurringEventId || e.id))) continue;
    out.push(m);
  }
  return { connected: true, canWrite, meetings: out };
}

/** The event as Google has it, for the checks before a switch. */
export async function getEvent(env: MeetEnv, booker: string, eventId: string): Promise<CalEvent> {
  const tok = await token(env, booker, [CAL_EVENTS]);
  const r = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, 'calendar', r.status === 404 ? 'That event is no longer on your calendar.' : 'Google Calendar did not answer.');
  return (await r.json()) as CalEvent;
}

/** Swap the video link on an existing event for a Favor room. Google sends the guests an updated invite. */
export async function swapConferencing(env: MeetEnv, booker: string, ev: CalEvent, roomUrl: string): Promise<void> {
  const tok = await token(env, booker, [CAL_EVENTS]);
  const desc = (ev.description || '').trim();
  const swapped = providerOf({ description: desc }).urls.reduce((a, u) => a.split(u).join(roomUrl), desc);
  const body: Record<string, unknown> = {
    location: roomUrl,
    description: swapped.includes(roomUrl) ? swapped : `Join in Favor Meetings: ${roomUrl}${swapped ? '\n\n' + swapped : ''}`,
  };
  if (ev.conferenceData) body.conferenceData = null;
  const r = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(ev.id)}?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new HttpError(502, 'calendar', 'Google Calendar did not accept the change.');
}

/** Change the title, time or notes of an event on the person's own calendar (a Zoom, Meet or Teams meeting they organize).
 * Only the organizer may. Google sends no email for this change (sendUpdates=none); the guests' copies update on their own.
 * The video link is never touched: an edited description keeps the join links the original held. */
export async function patchCalendarEvent(env: MeetEnv, email: string, eventId: string, patch: { startsAt?: string; endsAt?: string; title?: string; description?: string }): Promise<void> {
  const tok = await token(env, email, [CAL_EVENTS]);
  const ev = await getEvent(env, email, eventId);
  if (ev.status === 'cancelled') throw new HttpError(404, 'calendar', 'That event is no longer on your calendar.');
  if (!ev.start?.dateTime || !ev.end?.dateTime) throw new HttpError(400, 'all_day', 'An all-day event has no time to change.');
  const organizer = !!ev.organizer?.self || String(ev.organizer?.email || '').toLowerCase() === email.toLowerCase();
  if (!organizer) throw new HttpError(403, 'not_organizer', 'Only the organizer can change this event.');
  const body: Record<string, unknown> = {};
  if (typeof patch.title === 'string') {
    const t = patch.title.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 300);
    if (t) body.summary = t;
  }
  if (patch.startsAt && patch.endsAt) {
    const s = Date.parse(patch.startsAt), e = Date.parse(patch.endsAt);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) throw new HttpError(400, 'bad_time', 'The end must be after the start.');
    body.start = { dateTime: new Date(s).toISOString(), timeZone: TZ };
    body.end = { dateTime: new Date(e).toISOString(), timeZone: TZ };
  }
  if (typeof patch.description === 'string') {
    const text = patch.description.replace(/\r/g, '').trim().slice(0, 4000);
    const links = providerOf({ description: ev.description || '' }).urls.filter((u) => !text.includes(u));
    body.description = [text, links.join('\n')].filter(Boolean).join('\n\n');
  }
  if (!Object.keys(body).length) return;
  const r = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new HttpError(r.status === 403 ? 403 : 502, 'calendar', r.status === 403 ? 'Google lets only the organizer change this event.' : 'Google Calendar did not accept the change.');
}
