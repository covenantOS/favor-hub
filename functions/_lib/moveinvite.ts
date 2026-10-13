// The email Move to FavorOS sends when the mover leaves "Email them the FavorOS link" checked. One email per invitee, never the mover.
// Staff with a FavorOS account get the room link; everyone else gets the meeting's guest link. The email carries an .ics so the
// meeting goes onto a calendar with one tap. Look matches the chat welcome email: logo, dark green banner, cream card, pill button.
// Pure builders below; sendMoveInvites reads who is staff and writes hub_meeting_invite_log so a meeting never mails a person twice.
import { clip, esc } from './requests/email';
import { isTester } from './testuser';
import type { Env } from './http';

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TZ = 'America/New_York';
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export interface MoveInviteInput {
  mover: { name: string; email: string };
  to: { name: string; email: string };
  title: string;
  startsAt: string;
  endsAt: string;
  /** Names of everyone in the meeting, the mover first. */
  people: string[];
  /** Where the meeting was held: Zoom, Google Meet, Microsoft Teams, Webex, phone, or empty. */
  source: string;
  link: string;
  meetingId: string;
  origin: string;
}

const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'there';

export function nameList(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}

/** "Tuesday, October 13", "1:15 PM to 2:00 PM EDT". */
export function whenParts(startsAt: string, endsAt: string): { day: string; time: string; mins: number } {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const day = s.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(s).find((p) => p.type === 'timeZoneName')?.value || 'ET';
  return { day, time: `${t(s)} to ${t(e)} ${zone}`, mins: Math.max(1, Math.round((e.getTime() - s.getTime()) / 60000)) };
}

export const durationWord = (m: number) => (m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} ${m === 60 ? 'hour' : 'hours'}` : `${Math.floor(m / 60)} hr ${m % 60} min`);

/** The place named on the calendar invite that this link replaces, or '' when there was none. */
export function sourceLabel(ev: { location?: string }, provider: string | null, label: (p: string) => string): string {
  if (provider && provider !== 'favor') return label(provider);
  if (/^\+?[\d\s().-]{7,}$/.test(String(ev.location || '').trim())) return 'phone';
  return '';
}

const icsStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

/** A calendar file for the meeting. METHOD:PUBLISH, so it adds the event without asking anyone to reply. */
export function buildIcs(m: Pick<MoveInviteInput, 'title' | 'startsAt' | 'endsAt' | 'link' | 'meetingId' | 'mover'>, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Favor International//FavorOS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.meetingId}@dash.favorintl.org`,
    `DTSTAMP:${icsStamp(now.toISOString())}`,
    `DTSTART:${icsStamp(m.startsAt)}`,
    `DTEND:${icsStamp(m.endsAt)}`,
    `SUMMARY:${icsText(m.title)}`,
    `DESCRIPTION:${icsText('Join in FavorOS: ' + m.link)}`,
    `LOCATION:${icsText(m.link)}`,
    `URL:${m.link}`,
    `ORGANIZER;CN=${icsText(m.mover.name)}:mailto:${m.mover.email}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function buildMoveInvite(m: MoveInviteInput): { subject: string; html: string; text: string; ics: string } {
  const w = whenParts(m.startsAt, m.endsAt);
  const moverFirst = first(m.mover.name);
  const headline = `${m.mover.name} moved your meeting to FavorOS`;
  const subject = clip(`${headline}: ${m.title}`, 140);
  const replace = m.source ? `Use this link instead of the ${m.source} link on the calendar invite.` : '';
  const rows: Array<[string, string]> = [
    ['Day', w.day],
    ['Time', w.time],
    ['Length', durationWord(w.mins)],
    ['Who', nameList(m.people)],
  ];
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 16px 7px 0;font-family:${SANS};font-size:13px;color:#7a7f78;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:7px 0;font-family:${SANS};font-size:15px;line-height:1.45;color:#1d241f;font-weight:600">${esc(v)}</td></tr>`;
  const side = 'border-left:1px solid #e3dccd;border-right:1px solid #e3dccd;';
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(headline)}</title></head>` +
    `<body style="margin:0;padding:0;background:#efe9dd"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(clip(`${m.title}, ${w.day}, ${w.time}`, 110))}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe9dd"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">` +
    `<tr><td style="padding:0 6px 18px 6px"><img src="${m.origin}/images/favor-logo-color.png" width="128" alt="Favor International" style="display:block;border:0;height:auto"></td></tr>` +
    `<tr><td style="background:#173b27;border-radius:18px 18px 0 0;padding:38px 36px 34px 36px"><div style="font-family:${SANS};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#a9c7a4;margin:0 0 14px 0">FavorOS</div>` +
    `<div style="font-family:${SERIF};font-size:30px;line-height:1.15;color:#ffffff;margin:0 0 14px 0">${esc(headline)}</div>` +
    `<div style="font-family:${SANS};font-size:17px;line-height:1.55;color:#dbe7d6">${esc(m.title)}</div></td></tr>` +
    `<tr><td style="background:#fffdf8;padding:26px 36px 4px 36px;${side}"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows.map(([k, v]) => row(k, v)).join('')}</table></td></tr>` +
    `<tr><td align="center" style="background:#fffdf8;padding:26px 36px 34px 36px;${side}border-bottom:1px solid #e3dccd;border-radius:0 0 18px 18px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#1f5a35;border-radius:999px"><a href="${esc(m.link)}" style="display:inline-block;padding:17px 44px;font-family:${SANS};font-size:18px;font-weight:600;color:#ffffff;text-decoration:none">Join in FavorOS</a></td></tr></table>` +
    `<div style="font-family:${SANS};font-size:14px;line-height:1.55;color:#57534a;margin:18px 0 0 0">The meeting runs in your browser. There is nothing to install.</div>` +
    (replace ? `<div style="font-family:${SANS};font-size:14px;line-height:1.55;color:#57534a;margin:8px 0 0 0">${esc(replace)}</div>` : '') +
    `<div style="font-family:${SANS};font-size:13px;line-height:1.5;color:#7a7f78;margin:16px 0 0 0">The attached file adds this meeting to your calendar. Reply to this email to reach ${esc(moverFirst)}.</div>` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:22px 10px 0 10px;font-family:${SANS};font-size:12px;line-height:1.6;color:#8d8a80">FavorOS &middot; <a href="https://dash.favorintl.org" style="color:#8d8a80">dash.favorintl.org</a><br>Favor International</td></tr>` +
    `</table></td></tr></table></body></html>`;
  const text = [headline, m.title, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Join in FavorOS: ${m.link}`, 'The meeting runs in your browser. There is nothing to install.', ...(replace ? [replace] : []), '', `Reply to this email to reach ${moverFirst}.`].join('\n');
  return { subject, html, text, ics: buildIcs(m) };
}

export interface Invitee {
  email: string;
  name?: string;
}

/** Who gets the email: everyone on the meeting except the mover, once each, never a test user. */
export function recipients(invitees: Invitee[], mover: string): Invitee[] {
  const seen = new Set<string>([lower(mover)]);
  const out: Invitee[] = [];
  for (const i of invitees) {
    const e = lower(i.email);
    if (!e || !e.includes('@') || seen.has(e) || isTester(e)) continue;
    seen.add(e);
    out.push({ email: e, name: i.name || '' });
  }
  return out;
}

/** The link for one person: the room for staff with a FavorOS account, the meeting's guest link for everyone else. */
export const linkFor = (staff: boolean, room: string, guest: string) => (staff ? room : guest);

export interface OutMail {
  to: string;
  replyTo: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
  ics: string;
}

async function deliver(env: Env, m: OutMail): Promise<boolean> {
  const hook = (env as unknown as { MAIL_HOOK?: (m: OutMail) => Promise<boolean> | boolean }).MAIL_HOOK;
  if (hook) return !!(await hook(m));
  const key = env.RESEND_API_KEY;
  if (!key) return false;
  const from = (env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>').replace(/^[^<]*</, `${m.fromName.replace(/[<>"]/g, '')} via FavorOS <`);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [m.to],
      reply_to: m.replyTo,
      subject: m.subject,
      html: m.html,
      text: m.text,
      attachments: [{ filename: 'meeting.ics', content: btoa(unescape(encodeURIComponent(m.ics))), content_type: 'text/calendar; method=PUBLISH' }],
    }),
  });
  if (!res.ok) console.error('[move-invite] email failed', res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

/** Sends the email to each person once for this meeting. Returns who got it, who failed and who was skipped. */
export async function sendMoveInvites(
  env: Env,
  a: Omit<MoveInviteInput, 'to' | 'link'> & { invitees: Invitee[]; guestUrl: () => Promise<string | null> }
): Promise<{ sent: string[]; failed: string[]; skipped: string[] }> {
  const res = { sent: [] as string[], failed: [] as string[], skipped: [] as string[] };
  const list = recipients(a.invitees, a.mover.email);
  if (!list.length) return res;
  const staff = new Set<string>();
  const rows = await env.DB.prepare(`SELECT lower(email) AS e FROM hub_users WHERE blocked = 0 AND lower(email) IN (${list.map(() => '?').join(',')})`).bind(...list.map((x) => x.email)).all<{ e: string }>();
  for (const r of rows.results || []) staff.add(r.e);
  const room = `${a.origin}/meet/room/?m=${a.meetingId}`;
  let guest: string | null | undefined;
  for (const p of list) {
    let link = room;
    if (!staff.has(p.email)) {
      if (guest === undefined) guest = await a.guestUrl();
      if (!guest) {
        res.skipped.push(p.email);
        continue;
      }
      link = linkFor(false, room, guest);
    }
    const took = await env.DB.prepare(`INSERT OR IGNORE INTO hub_meeting_invite_log (meeting_id, email, sent_at, state) VALUES (?, ?, ?, 'sending')`).bind(a.meetingId, p.email, new Date().toISOString()).run();
    if (!Number((took.meta as { changes?: number }).changes)) {
      res.skipped.push(p.email);
      continue;
    }
    const mail = buildMoveInvite({ ...a, to: { name: p.name || p.email, email: p.email }, link });
    let ok = false;
    try {
      ok = await deliver(env, { to: p.email, replyTo: a.mover.email, fromName: a.mover.name, subject: mail.subject, html: mail.html, text: mail.text, ics: mail.ics });
    } catch (err) {
      console.error('[move-invite] send threw', err);
    }
    // A failed send frees the row so a retry can try again; a sent one stays as the record.
    if (ok) await env.DB.prepare(`UPDATE hub_meeting_invite_log SET state = 'sent', sent_at = ? WHERE meeting_id = ? AND email = ?`).bind(new Date().toISOString(), a.meetingId, p.email).run();
    else await env.DB.prepare(`DELETE FROM hub_meeting_invite_log WHERE meeting_id = ? AND email = ? AND state = 'sending'`).bind(a.meetingId, p.email).run();
    (ok ? res.sent : res.failed).push(p.email);
  }
  return res;
}
