// Meetings: calendar files (.ics) for guests and partners whose meeting is not on a Google Calendar invite from FavorOS.
// REQUEST adds or updates the event in the guest's calendar (same UID, higher SEQUENCE); CANCEL takes it off.

export interface IcsInput {
  uid: string;
  method: 'REQUEST' | 'CANCEL' | 'PUBLISH';
  sequence?: number;
  startsAt: string;
  endsAt: string;
  title: string;
  description?: string;
  url?: string;
  location?: string;
  organizer?: { name: string; email: string };
  attendees?: Array<{ name?: string; email: string }>;
  /** An RRULE line ("RRULE:FREQ=WEEKLY;...") for a repeating series, and EXDATE lines for skipped ones. */
  rrule?: string;
  exdate?: string;
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
const cn = (s: string) => s.replace(/[";:,\r\n]/g, ' ').trim();

/** Lines longer than 75 octets fold onto the next line with a leading space (RFC 5545 3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildIcs(e: IcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Favor International//FavorOS Meetings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence || 0}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.startsAt)}`,
    `DTEND:${stamp(e.endsAt)}`,
    ...(e.rrule ? [e.rrule] : []),
    ...(e.exdate ? [e.exdate] : []),
    `SUMMARY:${text(e.title)}`,
    ...(e.description || e.url ? [`DESCRIPTION:${text([e.url ? 'Join: ' + e.url : '', e.description || ''].filter(Boolean).join('\n\n'))}`] : []),
    ...(e.location || e.url ? [`LOCATION:${text(e.location || e.url || '')}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    ...(e.organizer ? [`ORGANIZER;CN=${cn(e.organizer.name || e.organizer.email)}:mailto:${e.organizer.email}`] : []),
    ...(e.attendees || []).map((a) => `ATTENDEE;CN=${cn(a.name || a.email)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${a.email}`),
    `STATUS:${e.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(e.method === 'CANCEL' ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Base64 of the file's UTF-8 bytes, for an email attachment. */
export function icsBase64(ics: string): string {
  const bytes = new TextEncoder().encode(ics);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
