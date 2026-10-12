// Mail in FavorOS talks to the Gmail API with the signed-in person's own token (functions/_lib/hub/google.ts). Every call here is
// that person's mailbox only. The fetcher is passed in so the route tests answer for Gmail with invented mail.

export type Fetcher = typeof fetch;
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailError extends Error {
  status: number;
  reason: string;
  constructor(status: number, reason: string, message: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export interface Gmail {
  get<T = any>(path: string, q?: Record<string, string | string[] | undefined>): Promise<T>;
  send<T = any>(method: string, path: string, body?: unknown): Promise<T>;
  raw(url: string, init?: RequestInit): Promise<Response>;
}

export function gmail(token: string, fetcher: Fetcher = fetch, base = API): Gmail {
  const call = async (method: string, path: string, body?: unknown, q?: Record<string, string | string[] | undefined>) => {
    const u = new URL(path.startsWith('http') ? path : base + path);
    for (const [k, v] of Object.entries(q || {})) {
      if (v === undefined || v === '') continue;
      for (const one of Array.isArray(v) ? v : [v]) u.searchParams.append(k, one);
    }
    const res = await fetcher(u.toString(), {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return {} as any;
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
      throw new GmailError(res.status, String(reason), String(data?.error?.message || `Gmail ${res.status}`));
    }
    return data;
  };
  return {
    get: (path, q) => call('GET', path, undefined, q),
    send: (method, path, body) => call(method, path, body),
    raw: (url, init) => fetcher(url, { ...(init || {}), headers: { Authorization: `Bearer ${token}`, ...((init && (init.headers as Record<string, string>)) || {}) } }),
  };
}

/** Runs the jobs at most `n` at a time (Gmail allows about 250 units a second per person; a thread read costs 10). */
export async function pool<T, R>(items: T[], n: number, job: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await job(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

/* ------------------------------------------------------------------ parsing */

export const b64urlToBytes = (s: string): Uint8Array => {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
export const b64urlToText = (s: string): string => new TextDecoder().decode(b64urlToBytes(s));

export interface Addr { name: string; email: string }

/** Splits an address header ("A <a@x>, "B, C" <b@x>, c@x") into names and addresses. */
export function parseAddrs(h: string): Addr[] {
  const out: Addr[] = [];
  let cur = '';
  let q = false;
  let angle = 0;
  const push = () => {
    const s = cur.trim();
    cur = '';
    if (!s) return;
    const m = s.match(/^(.*)<([^>]+)>\s*$/);
    if (m) out.push({ name: m[1].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').trim(), email: m[2].trim().toLowerCase() });
    else if (s.includes('@')) out.push({ name: '', email: s.replace(/^"|"$/g, '').trim().toLowerCase() });
  };
  for (const ch of String(h || '')) {
    if (ch === '"') q = !q;
    if (!q && ch === '<') angle++;
    if (!q && ch === '>') angle = Math.max(0, angle - 1);
    if (ch === ',' && !q && !angle) push();
    else cur += ch;
  }
  push();
  return out;
}

export interface Part {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: Part[];
}

export interface AttachmentOut { id: string; name: string; mime: string; size: number; inline: boolean; cid: string }

export interface MessageOut {
  id: string;
  threadId: string;
  labelIds: string[];
  date: string;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  replyTo: Addr[];
  subject: string;
  snippet: string;
  html: string;
  text: string;
  attachments: AttachmentOut[];
  messageId: string;
  references: string;
  unread: boolean;
  starred: boolean;
  draft: boolean;
}

const hdr = (headers: Part['headers'], name: string) => (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

/** One Gmail message (format=full) as the page shows it: addresses, the HTML or text body, and the files. */
export function shapeMessage(m: any): MessageOut {
  const p: Part = m.payload || {};
  const H = (n: string) => hdr(p.headers, n);
  let html = '';
  let text = '';
  const attachments: AttachmentOut[] = [];
  const walk = (part: Part) => {
    const mime = String(part.mimeType || '').toLowerCase();
    const disp = hdr(part.headers, 'Content-Disposition').toLowerCase();
    const cid = hdr(part.headers, 'Content-ID').replace(/^<|>$/g, '');
    if (part.parts && part.parts.length) {
      part.parts.forEach(walk);
      return;
    }
    const isFile = !!part.filename || (!!part.body?.attachmentId && !mime.startsWith('text/'));
    if (isFile && part.body?.attachmentId) {
      attachments.push({ id: part.body.attachmentId, name: part.filename || (cid ? 'image' : 'file'), mime: mime || 'application/octet-stream', size: Number(part.body.size) || 0, inline: !!cid && !disp.startsWith('attachment'), cid });
      return;
    }
    if (mime === 'text/html' && !html && part.body?.data) html = b64urlToText(part.body.data);
    else if (mime === 'text/plain' && !text && part.body?.data) text = b64urlToText(part.body.data);
  };
  walk(p);
  const labelIds: string[] = m.labelIds || [];
  return {
    id: String(m.id),
    threadId: String(m.threadId),
    labelIds,
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '',
    from: parseAddrs(H('From'))[0] || { name: '', email: '' },
    to: parseAddrs(H('To')),
    cc: parseAddrs(H('Cc')),
    bcc: parseAddrs(H('Bcc')),
    replyTo: parseAddrs(H('Reply-To')),
    subject: H('Subject'),
    snippet: decodeEntities(String(m.snippet || '')),
    html,
    text,
    attachments,
    messageId: H('Message-ID') || H('Message-Id'),
    references: H('References'),
    unread: labelIds.includes('UNREAD'),
    starred: labelIds.includes('STARRED'),
    draft: labelIds.includes('DRAFT'),
  };
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|#39|apos|nbsp);/gi, (all, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === '#39' || k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : all;
  });
}

export interface ThreadRow {
  id: string;
  historyId: string;
  subject: string;
  snippet: string;
  date: string;
  people: Addr[];
  from: Addr;
  count: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  files: boolean;
  draft: boolean;
  labelIds: string[];
  /** The newest message that is not a draft: its id, whether it is mine, and whether it was sent to me by name or only copied. */
  lastId: string;
  fromMe: boolean;
  toMe: boolean;
  /** Mailing-list or automatic mail: List-Unsubscribe, List-Id, Precedence bulk or Auto-Submitted on a message from someone else. */
  bulk: boolean;
}

/** The headers a list row reads. The extra four tell mailing lists and automatic mail from people. */
export const ROW_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted'];

/** A thread (format=metadata) as one row of the list: who wrote, the subject, the newest date, unread and starred. */
export function shapeThreadRow(t: any, me: string): ThreadRow {
  const msgs: any[] = t.messages || [];
  const labels = new Set<string>();
  const people: Addr[] = [];
  let unread = false;
  let starred = false;
  let files = false;
  let draft = false;
  for (const m of msgs) {
    (m.labelIds || []).forEach((l: string) => labels.add(l));
    if ((m.labelIds || []).includes('UNREAD')) unread = true;
    if ((m.labelIds || []).includes('STARRED')) starred = true;
    if ((m.labelIds || []).includes('DRAFT')) draft = true;
    if (/multipart\/(mixed|related)/i.test(String(m.payload?.mimeType || ''))) files = files || /multipart\/mixed/i.test(String(m.payload?.mimeType || ''));
    if ((m.labelIds || []).includes('DRAFT')) continue;
    const f = parseAddrs(hdr(m.payload?.headers, 'From'))[0];
    if (f && !people.some((x) => x.email === f.email)) people.push(f.email === me ? { name: 'me', email: f.email } : f);
  }
  const first = msgs[0] || {};
  const last = [...msgs].reverse().find((m) => !(m.labelIds || []).includes('DRAFT')) || msgs[msgs.length - 1] || {};
  const lastFrom = parseAddrs(hdr(last.payload?.headers, 'From'))[0] || { name: '', email: '' };
  const lastTo = [...parseAddrs(hdr(last.payload?.headers, 'To'))];
  let bulk = false;
  for (const m of msgs) {
    const h = m.payload?.headers;
    const f = parseAddrs(hdr(h, 'From'))[0];
    if (!f || f.email === me) continue;
    const auto = hdr(h, 'Auto-Submitted').toLowerCase();
    if (hdr(h, 'List-Unsubscribe') || hdr(h, 'List-Id') || /^(bulk|list|junk)$/i.test(hdr(h, 'Precedence').trim()) || (auto && auto !== 'no')) bulk = true;
  }
  const toFirst = parseAddrs(hdr(first.payload?.headers, 'To'))[0];
  // Sent mail shows who it went to, as Gmail does.
  const shown = people.length === 1 && people[0].email === me && toFirst ? [{ name: 'To: ' + (toFirst.name || toFirst.email), email: toFirst.email }] : people;
  return {
    id: String(t.id),
    historyId: String(t.historyId || ''),
    subject: hdr(first.payload?.headers, 'Subject'),
    snippet: decodeEntities(String(last.snippet || t.snippet || '')),
    date: last.internalDate ? new Date(Number(last.internalDate)).toISOString() : '',
    people: shown.slice(0, 4),
    from: lastFrom,
    count: msgs.filter((m) => !(m.labelIds || []).includes('DRAFT')).length,
    unread,
    starred,
    important: labels.has('IMPORTANT'),
    files,
    draft,
    labelIds: [...labels],
    lastId: String(last.id || ''),
    fromMe: lastFrom.email === me,
    toMe: lastTo.some((a) => a.email === me),
    bulk,
  };
}
