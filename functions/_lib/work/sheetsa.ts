// Reads the RDD tracking sheet for Entry. The hub signs in to Google as the Favor service account (the key is a Pages secret, never in the
// repository) with the read-only Sheets scope, so it can open the sheet without anyone being signed in. It never writes to the sheet:
// the tick back on a row that Entry sent to Blackbaud stays a manual step.
import type { Env } from '../http';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetReadError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlText = (t: string): string => b64url(new TextEncoder().encode(t));

const memos = new Map<string, { token: string; exp: number }>();

/** A short-lived access token for the service account, signed with its key (RS256). Kept in memory until a few minutes before it ends. */
export async function saToken(env: Env, fetchFn: typeof fetch = fetch, scope: string = SCOPE): Promise<string> {
  const memo = memos.get(scope);
  if (memo && memo.exp > Date.now() + 120000) return memo.token;
  if (!env.GOOGLE_SA_JSON) throw new SheetReadError('no_key', 'The hub cannot open the tracking sheet yet. Tell the technology team through Feedback.');
  let acct: { client_email?: string; private_key?: string; private_key_id?: string };
  try {
    acct = JSON.parse(env.GOOGLE_SA_JSON);
  } catch {
    throw new SheetReadError('bad_key', 'The hub cannot open the tracking sheet yet. Tell the technology team through Feedback.');
  }
  if (!acct.client_email || !acct.private_key) throw new SheetReadError('bad_key', 'The hub cannot open the tracking sheet yet. Tell the technology team through Feedback.');
  const pem = acct.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(acct.private_key_id ? { kid: acct.private_key_id } : {}) }));
  const claim = b64urlText(JSON.stringify({ iss: acct.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`)));
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !data?.access_token) throw new SheetReadError('token', 'Google did not let the hub in to the tracking sheet. Try again in a minute.');
  memos.set(scope, { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

export function forgetToken(): void {
  memos.clear();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The tabs that hold one person's contacts for a month. Tabs read "Brian's OCT Sheet" (the person's name, a month, the word Sheet), sometimes with a
 * trailing space or SEPT for September. `prefix` is the part before the month ("Brian's"); `months` are 1 to 12.
 */
export function tabsFor(titles: string[], prefix: string, months: number[]): string[] {
  const p = prefix.trim().toLowerCase();
  const wanted = new Set(months.map((m) => MONTHS[m - 1]));
  return titles.filter((t) => {
    const x = t.trim().toLowerCase();
    if (!x.startsWith(p)) return false;
    const rest = x.slice(p.length).trim();
    const m = rest.match(/^([a-z]{3,9})\b/);
    return !!m && wanted.has(m[1].slice(0, 3));
  });
}

/** The current month and the one before it. Rows from late last month are often still waiting. */
export function monthsBack(todayIso: string, back = 1): number[] {
  const m = Number(todayIso.slice(5, 7));
  const out = [m];
  for (let i = 1; i <= back; i++) out.push(((m - 1 - i + 12) % 12) + 1);
  return out;
}

const quoteTab = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** Rows of a tab as tab-separated text, the shape parseSheetText reads. Cell line breaks become spaces. */
export function valuesToText(values: unknown[][]): string {
  return values.map((r) => r.map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t')).join('\n');
}

export interface TabText {
  tab: string;
  text: string;
  rows: number;
}

/** Read the named person's tabs for the given months from the tracking sheet. Two or three Google calls. */
export async function readOwnerTabs(env: Env, sheetId: string, prefix: string, months: number[], fetchFn: typeof fetch = fetch): Promise<TabText[]> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) throw new SheetReadError('no_sheet', 'The tracking sheet is not set up in the hub yet. Tell the technology team through Feedback.');
  const token = await saToken(env, fetchFn);
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetchFn(`${SHEETS}/${sheetId}?fields=sheets.properties.title`, { headers: auth });
  if (meta.status === 403 || meta.status === 404) throw new SheetReadError('no_access', 'The hub cannot see the tracking sheet. Tell the technology team through Feedback.');
  if (!meta.ok) throw new SheetReadError('google', 'Google did not answer. Try again in a minute.');
  const titles = (((await meta.json()) as { sheets?: { properties?: { title?: string } }[] }).sheets || []).map((s) => String(s.properties?.title || ''));
  const tabs = tabsFor(titles, prefix, months);
  if (!tabs.length) return [];
  const q = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' });
  for (const t of tabs) q.append('ranges', `${quoteTab(t)}!A1:J1500`);
  const res = await fetchFn(`${SHEETS}/${sheetId}/values:batchGet?${q}`, { headers: auth });
  if (!res.ok) throw new SheetReadError('google', 'Google did not answer. Try again in a minute.');
  const data = (await res.json()) as { valueRanges?: { values?: unknown[][] }[] };
  return (data.valueRanges || []).map((v, i) => ({ tab: tabs[i], text: valuesToText(v.values || []), rows: (v.values || []).length }));
}
