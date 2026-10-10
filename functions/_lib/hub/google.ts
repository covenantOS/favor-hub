// Connect my Google: each person's calendar, Drive file list and inbox headers, for Today, and the
// Google Sheets the hub makes for them. The refresh token is stored encrypted (AES-GCM with
// GOOGLE_TOKEN_KEY). The three base scopes are the narrowest Google offers: event details, file names and
// dates, and mail headers (never a mail body or a file). The one extra scope, drive.file, is asked for only
// when a person first presses "Open in Google Sheets", and lets the hub create and open only the sheets it
// makes.
import type { Env } from '../http';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
];
/** Create and open only the files this app made (the hub's Google Sheets). Asked for on the first export. */
export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
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
async function open(env: Env, sealed: string): Promise<string> {
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

/** A fresh access token for this person, or null when they have not connected (or revoked it). */
export async function accessToken(env: Env, email: string): Promise<{ token: string; scopes: string } | null> {
  const row = await env.DB.prepare('SELECT refresh_enc, scopes FROM hub_google WHERE email = ?').bind(email).first<{ refresh_enc: string; scopes: string }>();
  if (!row) return null;
  const res = await fetch(tokenUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: await open(env, row.refresh_enc), client_id: clientId(env), client_secret: env.GOOGLE_CLIENT_SECRET || '', grant_type: 'refresh_token' }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (data.error === 'invalid_grant') {
    await env.DB.prepare('DELETE FROM hub_google WHERE email = ?').bind(email).run();
    return null;
  }
  if (!res.ok) throw new Error(data.error_description || `refresh ${res.status}`);
  await env.DB.prepare('UPDATE hub_google SET last_used = ? WHERE email = ?').bind(new Date().toISOString(), email).run();
  return { token: data.access_token, scopes: row.scopes };
}

export async function revoke(env: Env, email: string): Promise<void> {
  const row = await env.DB.prepare('SELECT refresh_enc FROM hub_google WHERE email = ?').bind(email).first<{ refresh_enc: string }>();
  if (row) {
    const token = await open(env, row.refresh_enc).catch(() => '');
    if (token) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => undefined);
  }
  await env.DB.prepare('DELETE FROM hub_google WHERE email = ?').bind(email).run();
}

const g = async (token: string, url: string) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json() as Promise<any>;
};

export interface DayEvent { start: string; end: string; allDay: boolean; title: string; link: string; meet: string; people: string[] }
export interface DayFile { name: string; link: string; modified: string; by: string; icon: string }
export interface DayMail { from: string; fromEmail: string; subject: string; date: string; link: string }

/** Today's meetings (Eastern), from the primary calendar. */
export async function todaysEvents(token: string): Promise<DayEvent[]> {
  const now = new Date();
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const offset = now.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/)?.[1] || '-4';
  const tz = `${offset.startsWith('-') ? '-' : '+'}${String(Math.abs(Number(offset))).padStart(2, '0')}:00`;
  const q = new URLSearchParams({ timeMin: `${day}T00:00:00${tz}`, timeMax: `${day}T23:59:59${tz}`, singleEvents: 'true', orderBy: 'startTime', maxResults: '20' });
  const data = await g(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
  return (data.items || [])
    .filter((e: any) => e.status !== 'cancelled')
    .map((e: any) => ({
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      allDay: !e.start?.dateTime,
      title: e.summary || '(No title)',
      link: e.htmlLink || '',
      meet: e.hangoutLink || '',
      people: (e.attendees || []).filter((a: any) => !a.self && !a.resource).map((a: any) => String(a.email || '').toLowerCase()),
    }));
}

/** Files shared with the person or changed by someone else in the last week. */
export async function recentFiles(token: string): Promise<DayFile[]> {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const q = new URLSearchParams({
    q: `(sharedWithMe = true or 'me' in owners) and modifiedTime > '${since}' and trashed = false`,
    orderBy: 'modifiedTime desc',
    pageSize: '8',
    fields: 'files(name,webViewLink,modifiedTime,iconLink,lastModifyingUser(displayName,me))',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    corpora: 'allDrives',
  });
  const data = await g(token, `https://www.googleapis.com/drive/v3/files?${q}`);
  return (data.files || [])
    .filter((f: any) => !f.lastModifyingUser?.me)
    .slice(0, 6)
    .map((f: any) => ({ name: f.name, link: f.webViewLink, modified: f.modifiedTime, by: f.lastModifyingUser?.displayName || '', icon: f.iconLink || '' }));
}

/** Unread inbox mail from the last three days, headers only. */
export async function unreadMail(token: string): Promise<DayMail[]> {
  const list = await g(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=15');
  const ids: string[] = (list.messages || []).map((m: any) => m.id);
  const cutoff = Date.now() - 3 * 864e5;
  const out: DayMail[] = [];
  for (const id of ids) {
    const m = await g(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null);
    if (!m || Number(m.internalDate) < cutoff) continue;
    const h = (n: string) => (m.payload?.headers || []).find((x: any) => x.name === n)?.value || '';
    const from = h('From');
    const email = (from.match(/<([^>]+)>/)?.[1] || from).toLowerCase().trim();
    out.push({ from: from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || email, fromEmail: email, subject: h('Subject') || '(No subject)', date: new Date(Number(m.internalDate)).toISOString(), link: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}` });
  }
  return out;
}
