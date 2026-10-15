// Connect my Google: each person's calendar, Drive file list and inbox headers, for Today, and the
// Google Sheets the hub makes for them. The refresh token is stored encrypted (AES-GCM with
// GOOGLE_TOKEN_KEY). The three base scopes are the narrowest Google offers: event details, file names and
// dates, and mail headers (never a mail body or a file). The one extra scope, drive.file, is asked for only
// when a person first presses "Open in Google Sheets", and lets the hub create and open only the sheets it
// makes.
import type { Env } from '../http';
import { PROVIDER_LABEL, providerOf } from '../meetprovider';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
];
/** Create and open only the files this app made (the hub's Google Sheets). Asked for on the first export. */
export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
/** Booking a meeting: read everyone's free and busy times, and put the meeting on the booker's own calendar with the guests invited. Asked for on the first booking. */
export const CAL_FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy';
export const CAL_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
export const MEET_SCOPES = [CAL_FREEBUSY, CAL_EVENTS];
/** Mail in FavorOS. Reading a message, its attachments and searching need gmail.readonly; asked for the first time a person opens Mail. */
export const GMAIL_METADATA = 'https://www.googleapis.com/auth/gmail.metadata';
export const GMAIL_READ = 'https://www.googleapis.com/auth/gmail.readonly';
/** Archive, delete, labels, star, read and unread, drafts and sending; plus the person's own contacts for the To box. Asked for on the first change or send. */
export const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
export const CONTACTS_READ = 'https://www.googleapis.com/auth/contacts.readonly';
export const CONTACTS_OTHER = 'https://www.googleapis.com/auth/contacts.other.readonly';
export const MAIL_READ_SCOPES = [GMAIL_READ];
export const MAIL_WRITE_SCOPES = [GMAIL_MODIFY, CONTACTS_READ, CONTACTS_OTHER];
/**
 * Everything FavorOS uses, asked for on one Google screen the first time a person signs in, so no tool asks again later.
 * gmail.modify covers reading and headers, and calendar.events covers reading events; gmail.metadata is left out because a
 * token that carries it reads headers only.
 */
export const ALL_SCOPES = [CAL_EVENTS, CAL_FREEBUSY, 'https://www.googleapis.com/auth/drive.metadata.readonly', DRIVE_FILE, GMAIL_MODIFY, CONTACTS_READ, CONTACTS_OTHER];
/** What a stored grant lets Mail do. gmail.modify reads too. */
export function mailLevel(granted: string): { read: boolean; write: boolean; contacts: boolean; headers: boolean } {
  const g = String(granted || '').split(/\s+/);
  const write = g.includes(GMAIL_MODIFY);
  const read = write || g.includes(GMAIL_READ);
  return { read, write, contacts: g.includes(CONTACTS_READ) || g.includes(CONTACTS_OTHER), headers: read || g.includes(GMAIL_METADATA) };
}
export const hasScopes = (granted: string, want: string[]) => want.every((w) => String(granted || '').split(/\s+/).includes(w));
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const tokenUrl = (env: Env) => env.GOOGLE_TOKEN_URL || TOKEN_URL;
const CLIENT_ID = '538890082341-5ka1icfropum9nl9csq8adaiusbuesea.apps.googleusercontent.com';
export const clientId = (env: Env) => env.GOOGLE_CLIENT_ID || CLIENT_ID;
export const redirectUri = (req: Request) => new URL('/api/google/callback', req.url).origin + '/api/google/callback';

const enc = new TextEncoder();
const hex = (h: string) => Uint8Array.from(h.match(/../g) || [], (b) => parseInt(b, 16));
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(env: Env): Promise<CryptoKey> {
  if (!env.GOOGLE_TOKEN_KEY) throw new Error('GOOGLE_TOKEN_KEY missing');
  return crypto.subtle.importKey('raw', hex(env.GOOGLE_TOKEN_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), enc.encode(text)));
  return b64(iv) + '.' + b64(ct);
}
export async function open(env: Env, sealed: string): Promise<string> {
  const [iv, ct] = sealed.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(env), unb64(ct)));
}

export async function exchangeCode(env: Env, req: Request, code: string) {
  const res = await fetch(tokenUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId(env), client_secret: env.GOOGLE_CLIENT_SECRET || '', redirect_uri: redirectUri(req), grant_type: 'authorization_code' }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data.error_description || data.error || `token ${res.status}`);
  return data as { access_token: string; refresh_token?: string; scope: string; id_token?: string };
}

// Access tokens last an hour. Each server copy keeps the ones it made, so a page that asks Gmail several times in a row refreshes once.
const TOKENS = new Map<string, { token: string; exp: number }>();

/**
 * A fresh access token for this person, or null when they have not connected (or revoked it).
 * Gmail treats any token that carries gmail.metadata as headers only, even beside gmail.readonly, so once a person has granted
 * reading the token is asked for without the metadata scope (Google allows a refresh to ask for less than the grant).
 */
export async function accessToken(env: Env, email: string): Promise<{ token: string; scopes: string } | null> {
  const row = await env.DB.prepare('SELECT refresh_enc, scopes FROM hub_google WHERE email = ?').bind(email).first<{ refresh_enc: string; scopes: string }>();
  if (!row) return null;
  const granted = String(row.scopes || '').split(/\s+/).filter(Boolean);
  const drop = granted.includes(GMAIL_METADATA) && (granted.includes(GMAIL_READ) || granted.includes(GMAIL_MODIFY));
  const scopes = drop ? granted.filter((s) => s !== GMAIL_METADATA).join(' ') : row.scopes;
  const ck = email + '|' + row.scopes + '|' + row.refresh_enc.slice(-24);
  const hit = TOKENS.get(ck);
  if (hit && hit.exp > Date.now()) return { token: hit.token, scopes };
  const refresh = await open(env, row.refresh_enc);
  const ask = (scope?: string) => {
    const p = new URLSearchParams({ refresh_token: refresh, client_id: clientId(env), client_secret: env.GOOGLE_CLIENT_SECRET || '', grant_type: 'refresh_token' });
    if (scope) p.set('scope', scope);
    return fetch(tokenUrl(env), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
  };
  let res = await ask(drop ? scopes : undefined);
  let data = (await res.json().catch(() => ({}))) as any;
  // A refresh that may not narrow the grant falls back to the whole grant (headers only for mail until the person reconnects).
  if (drop && !res.ok && data.error === 'invalid_scope') {
    res = await ask();
    data = (await res.json().catch(() => ({}))) as any;
  }
  if (data.error === 'invalid_grant') {
    await env.DB.prepare('DELETE FROM hub_google WHERE email = ?').bind(email).run();
    return null;
  }
  if (!res.ok) throw new Error(data.error_description || `refresh ${res.status}`);
  await env.DB.prepare('UPDATE hub_google SET last_used = ? WHERE email = ?').bind(new Date().toISOString(), email).run();
  if (TOKENS.size > 500) TOKENS.clear();
  TOKENS.set(ck, { token: data.access_token, exp: Date.now() + Math.max(60, Number(data.expires_in) || 3000) * 1000 - 120000 });
  return { token: data.access_token, scopes };
}

/** Forget the access tokens kept for this person (after a disconnect or a new grant). */
export function forgetTokens(email: string): void {
  for (const k of TOKENS.keys()) if (k.startsWith(email + '|')) TOKENS.delete(k);
}

export async function revoke(env: Env, email: string): Promise<void> {
  const row = await env.DB.prepare('SELECT refresh_enc FROM hub_google WHERE email = ?').bind(email).first<{ refresh_enc: string }>();
  if (row) {
    const token = await open(env, row.refresh_enc).catch(() => '');
    if (token) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => undefined);
  }
  await env.DB.prepare('DELETE FROM hub_google WHERE email = ?').bind(email).run();
  // Disconnecting Google also deletes the saved copy of the person's mail headers and what was worked out from them.
  await env.DB.batch(['hub_mail_rows WHERE mailbox', 'hub_mail_sync WHERE mailbox', 'hub_mail_class WHERE email', 'hub_mail_cat WHERE email', 'hub_mail_logged WHERE email', 'hub_mail_waits WHERE email', 'hub_mail_brief WHERE email', 'hub_mail_snooze WHERE email'].map((t) => env.DB.prepare('DELETE FROM ' + t + ' = ?').bind(email))).catch(() => undefined);
  forgetTokens(email);
}

// Google answers 429 or 5xx when one person's calls bunch up (Today, the menu badge and Mail all ask at once), so a refusal waits a
// moment and asks again, and the last one is logged with Google's own reason.
const g = async (token: string, url: string, f: typeof fetch = fetch) => {
  let last = '';
  for (let i = 0; i < 4; i++) {
    const res = await f(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res.json() as Promise<any>;
    const body = (await res.json().catch(() => ({}))) as any;
    last = `${new URL(url).hostname} ${res.status} ${String(body?.error?.errors?.[0]?.reason || body?.error?.status || '').slice(0, 60)} ${String(body?.error?.message || '').slice(0, 120)}`.trim();
    if (res.status !== 429 && res.status < 500 && !(res.status === 403 && /rate|quota/i.test(last))) break;
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  console.error('[google]', last);
  throw new Error(last);
};

export interface DayEvent {
  id: string;
  start: string;
  end: string;
  allDay: boolean;
  title: string;
  /** The event in Google Calendar. Shown only as a secondary link. */
  link: string;
  /** The join address of an outside meeting (Zoom, Meet, Teams, Webex); empty when there is none. */
  meet: string;
  /** A dial-in number when the event is a phone call. */
  phone: string;
  provider: string;
  /** What the meeting is held on, in words: Zoom, Google Meet, Microsoft Teams, Webex, FavorOS, Phone call, or empty for an event with no link. */
  source: string;
  people: string[];
  /** The FavorOS meeting id when this event already has a room; set by the Today route. */
  hub: string;
  /** The FavorOS series this meeting belongs to, when it repeats in FavorOS (meetseries.ts). */
  series?: string;
  /** One meeting of a repeating Google Calendar series. */
  recurring?: boolean;
  organizer: boolean;
  /** Whether this person's calendar lets them add text to the event (they organize it, or guests may edit it). */
  canEdit: boolean;
  declined: boolean;
}
export interface DayFile { id: string; name: string; link: string; modified: string; by: string; icon: string; mime: string }
export interface DayMail { id: string; threadId: string; from: string; fromEmail: string; subject: string; date: string; link: string }

/** Today in Eastern: the date, the UTC offset and the two instants that bound the day. */
export function easternDay(now = new Date()): { day: string; tz: string; start: string; end: string } {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const offset = now.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/)?.[1] || '-4';
  const tz = `${offset.startsWith('-') ? '-' : '+'}${String(Math.abs(Number(offset))).padStart(2, '0')}:00`;
  return { day, tz, start: `${day}T00:00:00${tz}`, end: `${day}T23:59:59${tz}` };
}

const phoneOf = (e: any): string => {
  const ep = (e.conferenceData?.entryPoints || []).find((x: any) => x.entryPointType === 'phone');
  if (ep?.uri) return String(ep.uri).replace(/^tel:/i, '').split(',')[0];
  const m = String(e.location || '').match(/^\s*(?:tel:)?(\+?\d[\d\s().-]{6,}\d)\s*$/i);
  return m ? m[1].trim() : '';
};

/** The source label of a meeting held in FavorOS, wherever the row comes from. */
export const FAVOR_SOURCE = 'FavorOS';

/** Every event on the person's primary calendar today (Eastern), whatever the meeting is held on. */
export async function todaysEvents(token: string): Promise<DayEvent[]> {
  const d = easternDay();
  const q = new URLSearchParams({ timeMin: d.start, timeMax: d.end, singleEvents: 'true', orderBy: 'startTime', maxResults: '60' });
  const data = await g(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
  return (data.items || [])
    .filter((e: any) => e.status !== 'cancelled')
    .map((e: any): DayEvent => {
      const p = providerOf(e);
      const phone = p.provider ? '' : phoneOf(e);
      const provider = p.provider || (phone ? 'phone' : 'none');
      const me = (e.attendees || []).find((a: any) => a.self);
      const organizer = !!e.organizer?.self || !e.attendees?.length;
      return {
        id: String(e.id || ''),
        start: e.start?.dateTime || e.start?.date || '',
        end: e.end?.dateTime || e.end?.date || '',
        allDay: !e.start?.dateTime,
        title: e.summary || '(No title)',
        link: e.htmlLink || '',
        meet: p.provider && p.provider !== 'favor' ? p.url : e.hangoutLink || '',
        phone,
        provider,
        // A plain calendar event with no video link has nothing to name, so the source is empty.
        source: p.provider === 'favor' ? FAVOR_SOURCE : p.provider ? PROVIDER_LABEL[p.provider] : phone ? 'Phone call' : '',
        people: (e.attendees || []).filter((a: any) => !a.self && !a.resource).map((a: any) => String(a.email || '').toLowerCase()),
        hub: p.provider === 'favor' ? p.url.match(/[?&]m=([A-Za-z0-9]+)/)?.[1] || '' : '',
        series: p.provider === 'favor' ? p.url.match(/\/meet\/s\/\?id=([0-9a-f]{24})/)?.[1] || '' : '',
        recurring: !!e.recurringEventId,
        organizer,
        canEdit: organizer || e.guestsCanModify === true,
        declined: me?.responseStatus === 'declined',
      };
    });
}

/** Files shared with the person or changed by someone else in the last week. */
export async function recentFiles(token: string): Promise<DayFile[]> {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const q = new URLSearchParams({
    q: `(sharedWithMe = true or 'me' in owners) and modifiedTime > '${since}' and trashed = false`,
    orderBy: 'modifiedTime desc',
    pageSize: '8',
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,iconLink,lastModifyingUser(displayName,me))',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    corpora: 'allDrives',
  });
  const data = await g(token, `https://www.googleapis.com/drive/v3/files?${q}`);
  return (data.files || [])
    .filter((f: any) => !f.lastModifyingUser?.me)
    .slice(0, 6)
    .map((f: any) => ({ id: String(f.id || ''), name: f.name, link: f.webViewLink, modified: f.modifiedTime, by: f.lastModifyingUser?.displayName || '', icon: f.iconLink || '', mime: f.mimeType || '' }));
}

/** How many unread conversations Today lists. */
export const TODAY_MAIL_ROWS = 6;

/**
 * The newest unread conversations in the Inbox, headers only, whatever their age, one row per conversation (the Inbox's unread
 * number counts conversations, so a count of 2 comes with 2 rows). At most TODAY_MAIL_ROWS; a larger count is shown as the number.
 */
export async function unreadMail(token: string, f: typeof fetch = fetch): Promise<DayMail[]> {
  // A headers-only grant cannot search, so it lists the inbox's unread label instead.
  const list = await g(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=' + encodeURIComponent('in:inbox is:unread') + '&maxResults=25', f).catch(() => g(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=25', f));
  // Newest first. Keep the first message of each conversation, then fetch only the rows that will show.
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of list.messages || []) {
    const t = String(m.threadId || m.id);
    if (seen.has(t)) continue;
    seen.add(t);
    ids.push(m.id);
    if (ids.length >= TODAY_MAIL_ROWS) break;
  }
  // One request per message, all at once (they ran one after another and took about 3 s).
  const msgs = await Promise.all(ids.map((id) => g(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, f).catch(() => null)));
  const out: DayMail[] = [];
  for (const m of msgs) {
    if (!m) continue;
    const h = (n: string) => (m.payload?.headers || []).find((x: any) => x.name === n)?.value || '';
    const from = h('From');
    const email = (from.match(/<([^>]+)>/)?.[1] || from).toLowerCase().trim();
    out.push({ id: String(m.id), threadId: String(m.threadId), from: from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || email, fromEmail: email, subject: h('Subject') || '(No subject)', date: new Date(Number(m.internalDate)).toISOString(), link: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}` });
  }
  return out;
}
